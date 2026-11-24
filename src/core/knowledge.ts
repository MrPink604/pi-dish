/**
 * The knowledge base: topic pages in a Git repository, kept as a working clone
 * at `~/.pi/dish/knowledge`. The remote comes from `knowledgeRemote` in this
 * machine's `~/.pi/dish/settings.json`; without one the feature is off.
 *
 * Shared pages live under `topics/` with `index.md`; each bot's own pages live
 * under `bots/<bot-id>/topics/` with `bots/<bot-id>/index.md`. pi-dish is the
 * only committer: a write syncs with origin, validates scope/revision/stamps/
 * sizes, commits with the writer's name in the message, and pushes. An offline
 * remote leaves commits queued in the clone for the next online write; an
 * online push race either rebases cleanly (non-overlapping edits) or rolls back
 * with 409 Conflict so the clone never stays permanently diverged.
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import { execFile } from 'child_process';

export const KNOWLEDGE_SETTING = 'knowledgeRemote';
export const ENTRY_MAX_BYTES = 2 * 1024;
export const PAGE_WARN_BYTES = 16 * 1024;
export const PAGE_MAX_BYTES = 64 * 1024;
export const SUMMARY_MAX_CHARS = 160;
export const SOURCE_MAX_CHARS = 500;
export const TITLE_MAX_CHARS = 120;

const INDEX = 'index.md';
const TOPICS = 'topics';
const BOTS = 'bots';
const PAGE_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const BOT_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SEARCH_PAGES = 20;
const SEARCH_LINES_PER_PAGE = 5;
const SEARCH_LINE_CHARS = 300;
const GIT_TIMEOUT_MS = 60_000;

export type KnowledgeScope = 'shared' | 'bot';

/** A request the knowledge base refuses; `status` is the HTTP answer. */
export class KnowledgeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface KnowledgeHit {
  path: string;
  scope: KnowledgeScope;
  botId?: string;
  botName?: string;
  lines: { line: number; text: string }[];
}

export interface KnowledgeSearch {
  results: KnowledgeHit[];
  /** Pages that matched; more than `results` holds when the cap cut the list. */
  total: number;
}

export interface KnowledgeReadResult {
  path: string;
  scope: KnowledgeScope;
  botId?: string;
  botName?: string;
  text: string;
  /** 12-char Git blob SHA-1 of the file on disk; null only when reading an uncreated empty index. */
  revision: string | null;
}

export interface KnowledgeReadOptions {
  scope?: KnowledgeScope;
  /** Calling or spawning bot id, used for `scope: 'bot'`, `bot:<slug>`, and fallback reads. */
  botId?: string;
  /** Explicit target bot id when reading a specific bot's KB (e.g. an ancestor's). */
  targetBotId?: string;
  /** Allowed bot ids this caller may read; when provided, any other bot id is refused with 403. */
  readableBotIds?: readonly string[];
  /** Optional display names for bot ids (e.g. from the bot registry). */
  botNames?: Readonly<Record<string, string>>;
  /** When reading a named page with shared default scope, fall back to `botId`'s KB on miss. */
  fallbackToBot?: boolean;
}

export interface KnowledgeSearchOptions {
  scope?: 'all' | KnowledgeScope;
  /** Readable bot ids to include when scope is `'all'` or `'bot'`. */
  botIds?: readonly string[];
  /** Optional display names for bot ids (e.g. from the bot registry). */
  botNames?: Readonly<Record<string, string>>;
}

export interface KnowledgeWrite {
  /** The page's slug, such as `beelink`; `topics/beelink.md` and `beelink.md` name it too. */
  page: string;
  /** Required: `'bot'` for the bot's own KB, `'shared'` for the shared KB. */
  scope: KnowledgeScope;
  /** Target bot id; required when `scope === 'bot'`. */
  botId?: string;
  /** Calling bot id for scope-isolation enforcement; must equal `botId` when writing a bot KB. */
  callerBotId?: string;
  /** Bot display name for `bots/<bot-id>/index.md`'s header. */
  botName?: string;
  /** `append` adds one entry; `replace` writes the whole page, for tidying it. */
  mode: 'append' | 'replace';
  text: string;
  /** Where the fact comes from (at most 500 chars); required for an entry. */
  source?: string;
  /** Page title in index.md (at most 120 chars); omitted: existing title, or slug words when new. */
  title?: string;
  /** One-line topic scope for index.md (at most 160 chars). Required when creating a new page; optional later. */
  summary?: string;
  /** Required when `mode === 'replace'` on an existing page; must be omitted when creating a new page. */
  revision?: string;
  /** Normalized source substrings intentionally removed or merged during `mode === 'replace'`; recorded in commit body. */
  droppedSources?: string[];
  /** Who wrote it: stamped on an entry and named in the commit. */
  author: string;
}

export interface KnowledgeWriteResult {
  path: string;
  scope: KnowledgeScope;
  botId?: string;
  created: boolean;
  revision: string;
  pageBytes: number;
  /** The new commit, or null when the page was unchanged. */
  commit: string | null;
  pushed: boolean;
  pushError?: string;
  warning?: string;
}

export interface KnowledgeBase {
  readonly remote: string;
  readonly dir: string;
  search(query: string, options?: KnowledgeSearchOptions): Promise<KnowledgeSearch>;
  /** A page, or the index when none is named. */
  read(page?: string, options?: KnowledgeReadOptions): Promise<KnowledgeReadResult>;
  write(entry: KnowledgeWrite): Promise<KnowledgeWriteResult>;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function defaultTitleFor(rel: string): string {
  const slug = path.basename(rel, '.md');
  return slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function validateBotId(botId: string): string {
  const normalized = botId.trim();
  if (!BOT_ID_RE.test(normalized)) {
    throw new KnowledgeError(`"${botId}" is not a valid bot id.`, 400);
  }
  return normalized;
}

/** Parses an explicit repo bot path `bots/<botId>/index.md` or `bots/<botId>/topics/<slug>.md`. */
function parseRepoBotPath(raw: string): { botId: string; subRel: string } | null {
  const cleaned = raw.trim().replace(/^\/+/, '');
  const match = /^bots\/([^/]+)\/(.+)$/.exec(cleaned);
  if (!match) return null;
  const botId = validateBotId(match[1]);
  const subRel = knowledgePagePath(match[2]);
  return { botId, subRel };
}

/** The repository path a page name means within a scope; `index.md` for an empty name. */
export function knowledgePagePath(page: string | undefined): string {
  const name = String(page ?? '').trim().replace(/^\/+/, '');
  if (!name || name === 'index' || name === INDEX) return INDEX;
  const slug = name.replace(/^topics\//, '').replace(/\.md$/, '');
  if (!PAGE_RE.test(slug)) {
    throw new KnowledgeError(`"${page}" is not a page name: use lowercase letters, digits and hyphens, such as "beelink" or "backups".`, 400);
  }
  return `${TOPICS}/${slug}.md`;
}

function pageBlobSha(content: Buffer | string): string {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

/** 12-character Git blob SHA-1 prefix of the file's exact UTF-8 bytes. */
export function pageRevision(content: Buffer | string): string {
  return pageBlobSha(content).slice(0, 12);
}

/**
 * Extracts normalized source strings from balanced `(Source: …)` citations on
 * each line, preserving duplicates as a multiset. Nested parentheses inside the
 * source (e.g. `(Opus)`) are kept intact.
 */
export function extractSourceStamps(markdown: string): string[] {
  const stamps: string[] = [];
  for (const line of markdown.split('\n')) {
    const re = /\(\s*source:\s*/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      const contentStart = match.index + match[0].length;
      let depth = 1;
      let i = contentStart;
      while (i < line.length && depth > 0) {
        if (line[i] === '(') depth++;
        else if (line[i] === ')') depth--;
        i++;
      }
      if (depth !== 0) continue;
      const inner = line.slice(contentStart, i - 1);
      const normalized = oneLine(inner)
        .replace(/\.\s*Added\s+\d{4}-\d{2}-\d{2}\s+by\s+[^.]+(?:\.)?$/i, '')
        .replace(/\.$/, '')
        .toLowerCase();
      if (normalized) stamps.push(normalized);
      re.lastIndex = i;
    }
  }
  return stamps;
}

/**
 * Multiset diff of `(Source: …)` stamps between `beforeText` and `afterText`,
 * accounting for merged citations (substring match up to the merged stamp's
 * count) and explicit `droppedSources` overrides.
 */
export function missingSourceStamps(
  beforeText: string,
  afterText: string,
  droppedSources: readonly string[] = [],
): { source: string; before: number; after: number }[] {
  const count = (items: string[]) => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
    return map;
  };
  const beforeCounts = count(extractSourceStamps(beforeText));
  const afterCounts = count(extractSourceStamps(afterText));
  const dropped = droppedSources.map(s => oneLine(s).replace(/\.$/, '').toLowerCase()).filter(Boolean);
  const missing: { source: string; before: number; after: number }[] = [];
  for (const [source, before] of beforeCounts) {
    let after = afterCounts.get(source) ?? 0;
    if (after === 0) {
      let merged = 0;
      for (const [candidate, candidateCount] of afterCounts) {
        if (candidate.includes(source)) merged += candidateCount;
      }
      after = merged;
    }
    if (after < before && !dropped.some(d => source.includes(d) || d.includes(source))) {
      missing.push({ source, before, after });
    }
  }
  return missing;
}

/**
 * Inserts or updates `- [Title](rel): summary` (or `- [Title](rel)` when no
 * summary is known) in an `index.md` body. Preserves existing title/summary
 * when omitted on update, and keeps summary-less legacy lines intact.
 */
export function upsertIndexLine(
  indexBody: string,
  rel: string,
  title?: string,
  summary?: string,
  _created = false,
  headerTitle = 'Knowledge',
): string {
  const cleanHeader = oneLine(headerTitle) || 'Knowledge';
  const base = (indexBody.trim() ? indexBody : `# ${cleanHeader}\n\nOne line per topic page.`).trimEnd();
  const lines = base.split('\n');
  if (lines[0]?.startsWith('# ') && cleanHeader !== 'Knowledge' && lines[0] !== `# ${cleanHeader}`) {
    lines[0] = `# ${cleanHeader}`;
  }
  const cleanTitle = title !== undefined ? oneLine(title) : '';
  const cleanSummary = summary !== undefined ? oneLine(summary).replace(/\.$/, '') : '';
  const token = `](${rel})`;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('- [')) continue;
    const close = line.indexOf(token);
    if (close < 3) continue;
    const rest = line.slice(close + token.length);
    if (rest !== '' && !rest.startsWith(':') && rest.trim() !== '') continue;
    const oldTitle = line.slice(3, close).trim();
    const oldSummary = rest.startsWith(':') ? rest.slice(1).trim() : '';
    const nextTitle = cleanTitle || oldTitle || defaultTitleFor(rel);
    const nextSummary = cleanSummary || oldSummary;
    lines[i] = nextSummary ? `- [${nextTitle}](${rel}): ${nextSummary}` : `- [${nextTitle}](${rel})`;
    return `${lines.join('\n')}\n`;
  }

  const nextTitle = cleanTitle || defaultTitleFor(rel);
  const newLine = cleanSummary ? `- [${nextTitle}](${rel}): ${cleanSummary}` : `- [${nextTitle}](${rel})`;
  if (!lines[lines.length - 1]?.startsWith('- ')) lines.push('');
  lines.push(newLine);
  return `${lines.join('\n')}\n`;
}

export interface SearchablePage {
  path: string;
  text: string;
  scope?: KnowledgeScope;
  botId?: string;
  botName?: string;
}

/** Pages that hold every term (case-insensitive), with the lines holding any of them. */
export function searchPages(pages: readonly SearchablePage[], query: string): KnowledgeSearch {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) throw new KnowledgeError('search needs at least one term', 400);
  const matched = pages.filter(page => {
    const text = page.text.toLowerCase();
    return terms.every(term => text.includes(term));
  });
  const results: KnowledgeHit[] = matched.slice(0, SEARCH_PAGES).map(page => ({
    path: page.path,
    scope: page.scope ?? 'shared',
    ...(page.botId ? { botId: page.botId } : {}),
    ...(page.botName ? { botName: page.botName } : {}),
    lines: page.text.split('\n').flatMap((text, index) => {
      const lower = text.toLowerCase();
      return terms.some(term => lower.includes(term)) ? [{ line: index + 1, text: text.slice(0, SEARCH_LINE_CHARS) }] : [];
    }).slice(0, SEARCH_LINES_PER_PAGE),
  }));
  return { results, total: matched.length };
}

/** An entry ends with its source, the day it was added and who added it. */
export function stampEntry(text: string, source: string, author: string, day: string): string {
  return `${text.trim()} (Source: ${oneLine(source).replace(/\.$/, '')}. Added ${day} by ${oneLine(author)}.)`;
}

/** Extracts a bot display name from a `bots/<id>/index.md` `# <Name> Knowledge` header, if present. */
function botNameFromIndex(indexText: string): string | undefined {
  const first = indexText.split('\n', 1)[0]?.trim() ?? '';
  const match = /^#\s+(.+?)\s+Knowledge$/i.exec(first);
  return match?.[1]?.trim() || undefined;
}

export interface KnowledgeOptions {
  remote: string;
  dir: string;
  /** The day an entry is stamped with, `YYYY-MM-DD`; today in UTC by default. */
  today?: () => string;
}

export const MISSING_SCOPE_ERROR =
  'Refused: scope is required ("bot" or "shared"). Use "bot" for your own area\'s working knowledge (repo conventions, your workflows), or "shared" for durable facts about hosts and the fleet that other bots and workers need.';

export function openKnowledgeBase({ remote, dir, today = () => new Date().toISOString().slice(0, 10) }: KnowledgeOptions): KnowledgeBase {
  // One git operation at a time: a write is pull, commit and push in order.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };
  let cloned = false;
  let recoverySeq = 0;
  const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

  function git(args: string[], cwd = dir, extraEnv?: NodeJS.ProcessEnv): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 << 20,
        // Never wait on a password or host-key prompt: an unreachable remote fails fast. pi-dish
        // commits (and rebases unpushed commits) as itself; each commit's author is its writer.
        env: {
          ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_COMMITTER_NAME: 'pi-dish', GIT_COMMITTER_EMAIL: 'bots@pi-dish.invalid',
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o ConnectTimeout=15',
          ...extraEnv,
        },
      }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        reject(new Error(`git ${args[0]}: ${String(stderr).trim() || error.message}`));
      });
    });
  }

  async function saveRecoveryRef(commitSha: string, reason: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    const ref = `refs/pi-dish/kb-recovery/${stamp}-${++recoverySeq}`;
    await git(['update-ref', ref, commitSha]);
    console.warn(`[kb] saved local commit ${commitSha} to ${ref} (${reason})`);
    return ref;
  }

  /**
   * Snapshots any uncommitted staged index and working-tree files into a named
   * recovery ref without altering HEAD or `.git/index`. Works across normal
   * HEAD, detached HEAD during an interrupted rebase, unmerged index entries,
   * and an unborn HEAD.
   */
  async function preserveDirtyTree(reason: string): Promise<string | null> {
    if (!(await git(['status', '--porcelain'])).trim()) return null;
    const headSha = (await git(['rev-parse', '--verify', 'HEAD']).catch(() => '')).trim() || null;
    const headTree = headSha ? (await git(['rev-parse', '--verify', 'HEAD^{tree}']).catch(() => '')).trim() || null : null;
    const indexTree = (await git(['write-tree']).catch(() => '')).trim() || null;
    const tmpIndex = path.join(dir, '.git', `pi-dish-recovery-${process.pid}-${Date.now()}-${++recoverySeq}.index`);
    let workTree: string;
    try {
      await git(['add', '-A'], dir, { GIT_INDEX_FILE: tmpIndex });
      workTree = (await git(['write-tree'], dir, { GIT_INDEX_FILE: tmpIndex })).trim();
    } finally {
      try { fs.unlinkSync(tmpIndex); } catch {}
    }
    const authorEnv = { GIT_AUTHOR_NAME: 'pi-dish', GIT_AUTHOR_EMAIL: 'bots@pi-dish.invalid' };
    let parent = headSha;
    const baseTree = headTree ?? EMPTY_TREE_SHA;
    if (indexTree && indexTree !== baseTree && indexTree !== workTree) {
      const idxArgs = ['commit-tree', indexTree, ...(parent ? ['-p', parent] : []), '-m', `pi-dish: preserve staged index (${reason})`];
      parent = (await git(idxArgs, dir, authorEnv)).trim();
    }
    const workArgs = ['commit-tree', workTree, ...(parent ? ['-p', parent] : []), '-m', `pi-dish: preserve working tree (${reason})`];
    const workCommit = (await git(workArgs, dir, authorEnv)).trim();
    return saveRecoveryRef(workCommit, reason);
  }

  async function ensureClone(): Promise<void> {
    if (cloned) return;
    if (!fs.existsSync(path.join(dir, '.git'))) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      try {
        await git(['-c', 'init.defaultBranch=main', 'clone', '-q', remote, dir], path.dirname(dir));
      } catch (error) {
        throw new KnowledgeError(`The knowledge base has no clone yet and ${remote} could not be cloned: ${error instanceof Error ? error.message : String(error)}`, 503);
      }
    } else if ((await git(['remote', 'get-url', 'origin']).catch(() => '')).trim() !== remote) {
      await git(['remote', 'set-url', 'origin', remote]).catch(() => git(['remote', 'add', 'origin', remote]));
    }
    cloned = true;
  }

  async function resolveRemoteRef(): Promise<string | null> {
    const upstream = (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => '')).trim();
    for (const candidate of [upstream, 'origin/main', 'origin/HEAD'].filter(Boolean)) {
      const ok = await git(['rev-parse', '--verify', candidate]).then(() => true, () => false);
      if (ok) return candidate;
    }
    return null;
  }

  async function isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    return git(['merge-base', '--is-ancestor', ancestor, descendant]).then(() => true, () => false);
  }

  function sharedPages(): SearchablePage[] {
    const found: SearchablePage[] = [];
    const index = path.join(dir, INDEX);
    if (fs.existsSync(index)) found.push({ path: INDEX, scope: 'shared', text: fs.readFileSync(index, 'utf8') });
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(dir, TOPICS)).filter(name => name.endsWith('.md')).sort(); } catch {}
    for (const name of names) {
      found.push({ path: `${TOPICS}/${name}`, scope: 'shared', text: fs.readFileSync(path.join(dir, TOPICS, name), 'utf8') });
    }
    return found;
  }

  function botPages(botId: string, providedName?: string): SearchablePage[] {
    const found: SearchablePage[] = [];
    const baseDir = path.join(dir, BOTS, botId);
    const index = path.join(baseDir, INDEX);
    let indexText: string | null = null;
    if (fs.existsSync(index)) indexText = fs.readFileSync(index, 'utf8');
    const botName = providedName || (indexText ? botNameFromIndex(indexText) : undefined);
    if (indexText !== null) {
      found.push({ path: `${BOTS}/${botId}/${INDEX}`, scope: 'bot', botId, ...(botName ? { botName } : {}), text: indexText });
    }
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(baseDir, TOPICS)).filter(name => name.endsWith('.md')).sort(); } catch {}
    for (const name of names) {
      found.push({
        path: `${BOTS}/${botId}/${TOPICS}/${name}`,
        scope: 'bot',
        botId,
        ...(botName ? { botName } : {}),
        text: fs.readFileSync(path.join(baseDir, TOPICS, name), 'utf8'),
      });
    }
    return found;
  }

  function readBotDisplayName(botId: string, providedNames?: Readonly<Record<string, string>>): string | undefined {
    const fromMap = providedNames?.[botId];
    if (fromMap) return fromMap;
    const indexFile = path.join(dir, BOTS, botId, INDEX);
    if (!fs.existsSync(indexFile)) return undefined;
    try { return botNameFromIndex(fs.readFileSync(indexFile, 'utf8')); } catch { return undefined; }
  }

  function assertReadableBot(targetBotId: string, readableBotIds?: readonly string[]): void {
    if (readableBotIds !== undefined && !readableBotIds.includes(targetBotId)) {
      throw new KnowledgeError(
        `Refused: you do not have access to bot "${targetBotId}"'s knowledge base. You can read only the shared KB, your own bot KB, and your ancestors' bot KBs.`,
        403,
      );
    }
  }

  function readBotFile(targetBotId: string, subRel: string, botNames?: Readonly<Record<string, string>>): KnowledgeReadResult {
    const repoRel = `${BOTS}/${targetBotId}/${subRel}`;
    const file = path.join(dir, repoRel);
    const botName = readBotDisplayName(targetBotId, botNames);
    if (!fs.existsSync(file)) {
      if (subRel === INDEX) {
        return {
          path: repoRel,
          scope: 'bot',
          botId: targetBotId,
          ...(botName ? { botName } : {}),
          text: 'This bot has no knowledge base pages yet.\n',
          revision: null,
        };
      }
      throw new KnowledgeError(`There is no page ${repoRel}.`, 404);
    }
    const buf = fs.readFileSync(file);
    return {
      path: repoRel,
      scope: 'bot',
      botId: targetBotId,
      ...(botName ? { botName } : {}),
      text: buf.toString('utf8'),
      revision: pageRevision(buf),
    };
  }

  /** Pushes every commit the remote lacks; a failure is reported, never thrown. */
  async function push(): Promise<{ pushed: boolean; pushError?: string }> {
    try {
      await git(['push', '-q', '-u', 'origin', 'HEAD']);
      return { pushed: true };
    } catch (error) {
      return { pushed: false, pushError: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    remote,
    dir,
    search: (query, options) => serial(async () => {
      if (!query.trim()) throw new KnowledgeError('search needs at least one term', 400);
      await ensureClone();
      const botIds = [...new Set((options?.botIds ?? []).map(validateBotId))];
      const scope = options?.scope ?? (botIds.length ? 'all' : 'shared');
      if (scope !== 'all' && scope !== 'shared' && scope !== 'bot') {
        throw new KnowledgeError('scope must be "shared", "bot", or "all"', 400);
      }
      const collected: SearchablePage[] = [];
      if (scope === 'shared' || scope === 'all') collected.push(...sharedPages());
      if (scope === 'bot' || scope === 'all') {
        for (const botId of botIds) collected.push(...botPages(botId, options?.botNames?.[botId]));
      }
      return searchPages(collected, query);
    }),

    read: (page, options) => serial(async () => {
      const opts = options ?? {};
      const rawPage = typeof page === 'string' ? page.trim() : '';
      await ensureClone();

      // Explicit repo bot path: `bots/<botId>/index.md` or `bots/<botId>/topics/<slug>.md`
      const explicitBot = rawPage ? parseRepoBotPath(rawPage) : null;
      if (explicitBot) {
        assertReadableBot(explicitBot.botId, opts.readableBotIds);
        return readBotFile(explicitBot.botId, explicitBot.subRel, opts.botNames);
      }

      // Shorthand `bot:<slug>` (or `bot:` / `bot:index`) for the calling bot's own KB.
      if (rawPage.toLowerCase().startsWith('bot:')) {
        if (!opts.botId) throw new KnowledgeError('reading a "bot:" page requires a bot context', 400);
        const ownBotId = validateBotId(opts.botId);
        assertReadableBot(ownBotId, opts.readableBotIds);
        const subRel = knowledgePagePath(rawPage.slice(4));
        return readBotFile(ownBotId, subRel, opts.botNames);
      }

      // Explicit bot scope
      if (opts.scope === 'bot') {
        const targetRaw = opts.targetBotId ?? opts.botId;
        if (!targetRaw) throw new KnowledgeError('reading scope "bot" requires a bot id', 400);
        const targetBotId = validateBotId(targetRaw);
        assertReadableBot(targetBotId, opts.readableBotIds);
        const subRel = knowledgePagePath(rawPage);
        return readBotFile(targetBotId, subRel, opts.botNames);
      }

      if (opts.scope !== undefined && opts.scope !== 'shared') {
        throw new KnowledgeError('scope must be "shared" or "bot"', 400);
      }

      // Shared scope (default), with optional fallback to the calling bot's own KB for named pages.
      const rel = knowledgePagePath(rawPage);
      const file = path.join(dir, rel);
      if (fs.existsSync(file)) {
        const buf = fs.readFileSync(file);
        return { path: rel, scope: 'shared', text: buf.toString('utf8'), revision: pageRevision(buf) };
      }
      if (rel === INDEX) {
        return { path: INDEX, scope: 'shared', text: 'The knowledge base has no pages yet.\n', revision: null };
      }
      if (opts.fallbackToBot && opts.botId) {
        const ownBotId = validateBotId(opts.botId);
        if (!opts.readableBotIds || opts.readableBotIds.includes(ownBotId)) {
          const botFile = path.join(dir, BOTS, ownBotId, rel);
          if (fs.existsSync(botFile)) return readBotFile(ownBotId, rel, opts.botNames);
        }
      }
      throw new KnowledgeError(`There is no page ${rel}.`, 404);
    }),

    write: entry => serial(async () => {
      if (entry.scope !== 'shared' && entry.scope !== 'bot') {
        throw new KnowledgeError(MISSING_SCOPE_ERROR, 400);
      }
      const author = oneLine(entry.author ?? '');
      if (!author) throw new KnowledgeError('a write needs its author', 400);
      const trimmedText = entry.text?.trim() ?? '';
      if (!trimmedText) throw new KnowledgeError('a write needs text', 400);
      if (entry.mode !== 'append' && entry.mode !== 'replace') throw new KnowledgeError('mode is append or replace', 400);

      // Resolve scope, bot id isolation, and target path.
      const rawPage = String(entry.page ?? '').trim();
      const explicitBot = rawPage ? parseRepoBotPath(rawPage) : null;
      let targetBotId: string | undefined;
      let subRel: string;
      let repoRel: string;
      let indexRepoRel: string;
      let indexHeaderTitle: string;

      if (entry.scope === 'bot') {
        if (!entry.botId?.trim()) throw new KnowledgeError('writing scope "bot" requires a bot id', 400);
        targetBotId = validateBotId(entry.botId);
        const callerBotId = entry.callerBotId?.trim() ? validateBotId(entry.callerBotId) : targetBotId;
        if (callerBotId !== targetBotId) {
          throw new KnowledgeError(
            `Refused: bot "${callerBotId}" cannot write to bot "${targetBotId}"'s knowledge base. A bot can write only to its own bot KB or the shared KB.`,
            403,
          );
        }
        if (explicitBot) {
          if (explicitBot.botId !== callerBotId) {
            throw new KnowledgeError(
              `Refused: bot "${callerBotId}" cannot write to bot "${explicitBot.botId}"'s knowledge base. A bot can write only to its own bot KB or the shared KB.`,
              403,
            );
          }
          subRel = explicitBot.subRel;
        } else if (rawPage.toLowerCase().startsWith('bot:')) {
          subRel = knowledgePagePath(rawPage.slice(4));
        } else {
          subRel = knowledgePagePath(rawPage);
        }
        if (subRel === INDEX) {
          throw new KnowledgeError('index.md is kept by pi-dish: write to a topic page and its line is added for you.', 400);
        }
        repoRel = `${BOTS}/${targetBotId}/${subRel}`;
        indexRepoRel = `${BOTS}/${targetBotId}/${INDEX}`;
        indexHeaderTitle = `${oneLine(entry.botName ?? '') || author} Knowledge`;
      } else {
        if (explicitBot) {
          throw new KnowledgeError(
            `Refused: "${rawPage}" is inside bot "${explicitBot.botId}"'s knowledge base, not the shared KB. Use scope "bot" for your own bot KB.`,
            403,
          );
        }
        if (rawPage.toLowerCase().startsWith('bot:')) {
          throw new KnowledgeError(
            `Refused: "${rawPage}" names a bot-scoped page, not a shared page. Pass scope "bot" (or omit the "bot:" prefix for a shared page).`,
            400,
          );
        }
        subRel = knowledgePagePath(rawPage);
        if (subRel === INDEX) {
          throw new KnowledgeError('index.md is kept by pi-dish: write to a topic page and its line is added for you.', 400);
        }
        repoRel = subRel;
        indexRepoRel = INDEX;
        indexHeaderTitle = 'Knowledge';
      }

      const rawTitle = entry.title !== undefined ? oneLine(entry.title) : '';
      if (rawTitle.length > TITLE_MAX_CHARS) {
        throw new KnowledgeError(`Refused: title is ${rawTitle.length} characters, over the ${TITLE_MAX_CHARS}-character cap.`, 400);
      }
      const summary = entry.summary !== undefined ? oneLine(entry.summary).replace(/\.$/, '') : '';
      if (summary.length > SUMMARY_MAX_CHARS) {
        throw new KnowledgeError(
          `Refused: summary is ${summary.length} characters, over the ${SUMMARY_MAX_CHARS}-character cap. Keep it to one short line saying what belongs on the page.`,
          400,
        );
      }
      const rawSource = entry.source !== undefined ? oneLine(entry.source) : '';
      if (entry.mode === 'append' && !rawSource) {
        throw new KnowledgeError('an entry needs its source: where the fact comes from', 400);
      }
      if (rawSource.length > SOURCE_MAX_CHARS) {
        throw new KnowledgeError(
          `Refused: source is ${rawSource.length} characters, over the ${SOURCE_MAX_CHARS}-character cap. Name where the fact came from (command + host, file, URL, or session ref) instead of pasting content into source.`,
          400,
        );
      }
      if (entry.mode === 'append') {
        const entryBytes = Buffer.byteLength(trimmedText, 'utf8');
        if (entryBytes > ENTRY_MAX_BYTES) {
          throw new KnowledgeError(
            `Refused: entry text is ${entryBytes} bytes, over the ${ENTRY_MAX_BYTES}-byte cap for append. Summarize the durable fact and cite the session ref, file path, or URL in source instead of pasting raw output.`,
            400,
          );
        }
      }

      const slug = path.basename(subRel, '.md');
      await ensureClone();

      // Recover from any crash-interrupted rebase or uncommitted working-tree residue before syncing with origin.
      // Always preserve any dirty index/working files into a recovery ref BEFORE aborting or resetting.
      const rebaseInProgress = fs.existsSync(path.join(dir, '.git', 'rebase-merge'))
        || fs.existsSync(path.join(dir, '.git', 'rebase-apply'));
      if (rebaseInProgress) {
        await preserveDirtyTree('before-rebase-abort');
        await git(['rebase', '--abort']).catch(() => {});
      }
      if ((await git(['status', '--porcelain'])).trim()) {
        await preserveDirtyTree('crash-dirty-tree');
        await git(['add', '-A']);
        if ((await git(['status', '--porcelain'])).trim()) {
          await git(['commit', '-q', '--author', 'pi-dish <bots@pi-dish.invalid>', '-m', 'pi-dish: recover uncommitted changes']);
        }
      }

      // Sync with origin before inspecting or modifying files. If origin is unreachable, proceed locally;
      // if origin is reachable and rebase conflicts, preserve local commits to a recovery ref and reset to remote
      // so subsequent unrelated writes succeed instead of failing with 409 forever.
      const fetchedBefore = await git(['fetch', '-q', 'origin']).then(() => true, () => false);
      if (fetchedBefore) {
        const remoteRef = await resolveRemoteRef();
        if (remoteRef) {
          const hasHead = await git(['rev-parse', '--verify', 'HEAD']).then(() => true, () => false);
          if (!hasHead) {
            await preserveDirtyTree('before-initial-checkout');
            await git(['checkout', '-q', '-B', 'main', remoteRef]);
          } else {
            try {
              await git(['rebase', '-q', remoteRef]);
            } catch (error) {
              await git(['rebase', '--abort']).catch(() => {});
              const localTip = (await git(['rev-parse', '--verify', 'HEAD']).catch(() => '')).trim();
              let recoveryRef: string | null = null;
              if (localTip && !(await isAncestor(localTip, remoteRef))) {
                recoveryRef = await saveRecoveryRef(localTip, 'pre-write-rebase-conflict');
              }
              await preserveDirtyTree('before-conflict-reset');
              await git(['reset', '--hard', remoteRef]);
              const detail = error instanceof Error ? error.message : String(error);
              const savedNote = recoveryRef ? ` Local unpushed commits were saved to ${recoveryRef}.` : '';
              throw new KnowledgeError(
                `Conflict: "${repoRel}" changed on the remote while committing (${detail}).${savedNote} Call kb_read("${slug}") to read the latest version and retry.`,
                409,
              );
            }
          }
        }
      }
      const headBefore = (await git(['rev-parse', '--verify', 'HEAD']).catch(() => '')).trim() || null;

      const file = path.join(dir, repoRel);
      const created = !fs.existsSync(file);
      const existingBuf = created ? null : fs.readFileSync(file);
      const existingText = existingBuf ? existingBuf.toString('utf8') : '';

      if (created && !summary) {
        throw new KnowledgeError(
          `Refused: "${repoRel}" does not exist yet. Pass summary (one line, at most ${SUMMARY_MAX_CHARS} characters) saying what belongs on this page so it can be listed in index.md.`,
          400,
        );
      }

      const droppedSources = Array.isArray(entry.droppedSources)
        ? entry.droppedSources.map(s => oneLine(s)).filter(Boolean)
        : [];
      let nextText: string;

      if (entry.mode === 'replace') {
        if (!created) {
          const fullSha = pageBlobSha(existingBuf!);
          const currentRev = fullSha.slice(0, 12);
          const givenRev = entry.revision?.trim().toLowerCase() ?? '';
          if (!givenRev) {
            throw new KnowledgeError(
              `Refused: "${repoRel}" already exists (current revision ${currentRev}), and mode "replace" requires revision. Read the page with kb_read first, merge your changes, and pass revision: "${currentRev}".`,
              400,
            );
          }
          if (givenRev !== currentRev && !(givenRev.length === 40 && givenRev === fullSha)) {
            throw new KnowledgeError(
              `Conflict: "${repoRel}" is at revision ${currentRev}, not "${entry.revision}" (another write landed since you read it). Call kb_read("${slug}") to read the current page, merge your changes without dropping newer entries, and retry with revision: "${currentRev}".`,
              409,
            );
          }
          const missing = missingSourceStamps(existingText, trimmedText, droppedSources);
          if (missing.length > 0) {
            throw new KnowledgeError(
              `Refused: rewrite of "${repoRel}" drops source stamp(s): ${missing.map(m => `"${m.source}" (${m.before} → ${m.after})`).join(', ')}. Keep every "(Source: …)" citation when tidying, or pass droppedSources naming only citations you intentionally merged or removed.`,
              400,
            );
          }
          nextText = `${trimmedText}\n`;
        } else {
          if (entry.revision?.trim()) {
            throw new KnowledgeError(
              `Conflict: "${repoRel}" does not exist yet, so revision "${entry.revision}" cannot match. Omit revision (and include summary) to create a new page, or check the page name.`,
              409,
            );
          }
          if (extractSourceStamps(trimmedText).length > 0) {
            nextText = `${trimmedText}\n`;
          } else if (rawSource) {
            nextText = `${stampEntry(trimmedText, rawSource, author, today())}\n`;
          } else {
            throw new KnowledgeError(
              'Refused: a new page written with mode "replace" must include at least one "(Source: …)" citation.',
              400,
            );
          }
        }
      } else {
        const title = rawTitle || defaultTitleFor(subRel);
        const stamped = stampEntry(trimmedText, rawSource, author, today());
        nextText = created ? `# ${title}\n\n${stamped}\n` : `${existingText.replace(/\s*$/, '\n\n')}${stamped}\n`;
      }

      const nextBytes = Buffer.byteLength(nextText, 'utf8');
      if (nextBytes > PAGE_MAX_BYTES) {
        throw new KnowledgeError(
          `Refused: "${repoRel}" would be ${nextBytes} bytes, over the ${PAGE_MAX_BYTES}-byte page cap. Split narrower sub-topics onto their own topic pages.`,
          400,
        );
      }

      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, nextText);

      const indexFile = path.join(dir, indexRepoRel);
      fs.mkdirSync(path.dirname(indexFile), { recursive: true });
      const indexBefore = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : '';
      const indexAfter = upsertIndexLine(
        indexBefore,
        subRel,
        rawTitle || undefined,
        summary || undefined,
        created,
        indexHeaderTitle,
      );
      if (indexAfter !== indexBefore) fs.writeFileSync(indexFile, indexAfter);

      // The clone is pi-dish's own: whatever is in it is committed, with whatever a crash left behind.
      await git(['add', '-A']);
      let commit: string | null = null;
      if ((await git(['status', '--porcelain'])).trim()) {
        const verb = entry.mode === 'replace' ? 'rewrite' : created ? 'start' : 'add to';
        const commitArgs = ['commit', '-q', '--author', `${author} <bots@pi-dish.invalid>`, '-m', `${author}: ${verb} ${repoRel}`];
        if (entry.mode === 'replace' && droppedSources.length > 0) {
          commitArgs.push('-m', `Dropped/merged sources: ${droppedSources.join('; ')}`);
        }
        await git(commitArgs);
        commit = (await git(['rev-parse', 'HEAD'])).trim();
      }

      let pushResult = await push();
      if (!pushResult.pushed && commit !== null) {
        const fetchedAfter = await git(['fetch', '-q', 'origin']).then(() => true, () => false);
        const remoteRef = fetchedAfter ? await resolveRemoteRef() : null;
        // Only treat a push failure as a conflict when the remote actually moved ahead of HEAD.
        // Non-conflict push errors (auth, hooks, read-only remote, transient push errors) must keep the local commit.
        if (fetchedAfter && remoteRef && !(await isAncestor(remoteRef, 'HEAD'))) {
          const remoteTouchedRel = headBefore
            ? !!(await git(['diff', '--name-only', `${headBefore}..${remoteRef}`, '--', repoRel]).catch(() => '')).trim()
            : true;
          let conflictDetail: string | null = null;
          let rollbackRef = remoteRef;
          if (entry.mode === 'replace' && remoteTouchedRel) {
            conflictDetail = `${repoRel} was updated on the remote`;
          } else {
            try {
              await git(['rebase', '-q', remoteRef]);
              commit = (await git(['rev-parse', 'HEAD'])).trim();
              const retry = await push();
              pushResult = retry;
              if (!retry.pushed) {
                const fetchedRetry = await git(['fetch', '-q', 'origin']).then(() => true, () => false);
                const retryRemoteRef = fetchedRetry ? await resolveRemoteRef() : null;
                if (fetchedRetry && retryRemoteRef && !(await isAncestor(retryRemoteRef, 'HEAD'))) {
                  rollbackRef = retryRemoteRef;
                  conflictDetail = retry.pushError ?? 'remote changed again while retrying push';
                }
              }
            } catch (error) {
              conflictDetail = error instanceof Error ? error.message : String(error);
              await git(['rebase', '--abort']).catch(() => {});
            }
          }
          if (conflictDetail !== null) {
            await git(['rebase', '--abort']).catch(() => {});
            const recoveryRefs: string[] = [];
            const currentTip = (await git(['rev-parse', '--verify', 'HEAD']).catch(() => '')).trim();
            if (currentTip && !(await isAncestor(currentTip, rollbackRef))) {
              recoveryRefs.push(await saveRecoveryRef(currentTip, 'push-conflict-rollback'));
            }
            await preserveDirtyTree('before-conflict-reset');
            if (headBefore) {
              await git(['reset', '--hard', headBefore]).catch(() => {});
              try {
                await git(['rebase', '-q', rollbackRef]);
              } catch {
                await git(['rebase', '--abort']).catch(() => {});
                if (headBefore !== currentTip && !(await isAncestor(headBefore, rollbackRef))) {
                  recoveryRefs.push(await saveRecoveryRef(headBefore, 'push-conflict-prior-commits'));
                }
                await git(['reset', '--hard', rollbackRef]).catch(() => {});
              }
            } else {
              await git(['reset', '--hard', rollbackRef]).catch(() => {});
            }
            const savedNote = recoveryRefs.length ? ` Local commits were saved to ${recoveryRefs.join(', ')}.` : '';
            throw new KnowledgeError(
              `Conflict: "${repoRel}" changed on the remote while committing (${conflictDetail}).${savedNote} Call kb_read("${slug}") to read the latest version and retry.`,
              409,
            );
          }
        }
      }

      const finalBuf = fs.readFileSync(file);
      const pageBytes = finalBuf.length;
      const revision = pageRevision(finalBuf);
      const warning = pageBytes > PAGE_WARN_BYTES
        ? `${repoRel} is now ${pageBytes} bytes (over the ${PAGE_WARN_BYTES}-byte guideline). Consider tidying superseded entries with mode "replace" or splitting sub-topics onto separate pages.`
        : undefined;

      return {
        path: repoRel,
        scope: entry.scope,
        ...(targetBotId ? { botId: targetBotId } : {}),
        created,
        revision,
        pageBytes,
        commit,
        ...pushResult,
        ...(warning ? { warning } : {}),
      };
    }),
  };
}
