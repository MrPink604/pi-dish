/**
 * The knowledge base: topic pages in a Git repository, kept as a working clone
 * at `~/.pi/dish/knowledge`. The remote comes from `knowledgeRemote` in this
 * machine's `~/.pi/dish/settings.json`; without one the feature is off.
 *
 * Pages are Markdown, one per topic, under `topics/`, and `index.md` holds one
 * line per page. pi-dish is the only committer: a write pulls, commits with the
 * writer's name in the message, and pushes. A push that fails leaves its commit
 * in the clone, and the next write pushes it with its own; the write succeeds
 * either way. Search is plain text search over the clone, with no index.
 */
import fs = require('fs');
import path = require('path');
import { execFile } from 'child_process';

export const KNOWLEDGE_SETTING = 'knowledgeRemote';
const INDEX = 'index.md';
const TOPICS = 'topics';
const PAGE_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SEARCH_PAGES = 20;
const SEARCH_LINES_PER_PAGE = 5;
const SEARCH_LINE_CHARS = 300;
const GIT_TIMEOUT_MS = 60_000;

/** A request the knowledge base refuses; `status` is the HTTP answer. */
export class KnowledgeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface KnowledgeHit {
  path: string;
  lines: { line: number; text: string }[];
}

export interface KnowledgeSearch {
  results: KnowledgeHit[];
  /** Pages that matched; more than `results` holds when the cap cut the list. */
  total: number;
}

export interface KnowledgeWrite {
  /** The page's slug, such as `beelink`; `topics/beelink.md` and `beelink.md` name it too. */
  page: string;
  /** `append` adds one entry; `replace` writes the whole page, for tidying it. */
  mode: 'append' | 'replace';
  text: string;
  /** Where the fact comes from; required for an entry. */
  source?: string;
  /** A new page's title; the slug's words by default. */
  title?: string;
  /** Who wrote it: stamped on an entry and named in the commit. */
  author: string;
}

export interface KnowledgeWriteResult {
  path: string;
  created: boolean;
  /** The new commit, or null when the page was unchanged. */
  commit: string | null;
  pushed: boolean;
  pushError?: string;
}

export interface KnowledgeBase {
  readonly remote: string;
  readonly dir: string;
  search(query: string): Promise<KnowledgeSearch>;
  /** A page, or the index when none is named. */
  read(page?: string): Promise<{ path: string; text: string }>;
  write(entry: KnowledgeWrite): Promise<KnowledgeWriteResult>;
}

/** The repository path a page name means; the index for an empty name. */
export function knowledgePagePath(page: string | undefined): string {
  const name = String(page ?? '').trim().replace(/^\/+/, '');
  if (!name || name === 'index' || name === INDEX) return INDEX;
  const slug = name.replace(/^topics\//, '').replace(/\.md$/, '');
  if (!PAGE_RE.test(slug)) {
    throw new KnowledgeError(`"${page}" is not a page name: use lowercase letters, digits and hyphens, such as "beelink" or "backups".`, 400);
  }
  return `${TOPICS}/${slug}.md`;
}

/** Pages that hold every term (case-insensitive), with the lines holding any of them. */
export function searchPages(pages: readonly { path: string; text: string }[], query: string): KnowledgeSearch {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) throw new KnowledgeError('search needs at least one term', 400);
  const matched = pages.filter(page => {
    const text = page.text.toLowerCase();
    return terms.every(term => text.includes(term));
  });
  const results = matched.slice(0, SEARCH_PAGES).map(page => ({
    path: page.path,
    lines: page.text.split('\n').flatMap((text, index) => {
      const lower = text.toLowerCase();
      return terms.some(term => lower.includes(term)) ? [{ line: index + 1, text: text.slice(0, SEARCH_LINE_CHARS) }] : [];
    }).slice(0, SEARCH_LINES_PER_PAGE),
  }));
  return { results, total: matched.length };
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** An entry ends with its source, the day it was added and who added it. */
export function stampEntry(text: string, source: string, author: string, day: string): string {
  return `${text.trim()} (Source: ${oneLine(source).replace(/\.$/, '')}. Added ${day} by ${oneLine(author)}.)`;
}

export interface KnowledgeOptions {
  remote: string;
  dir: string;
  /** The day an entry is stamped with, `YYYY-MM-DD`; today in UTC by default. */
  today?: () => string;
}

export function openKnowledgeBase({ remote, dir, today = () => new Date().toISOString().slice(0, 10) }: KnowledgeOptions): KnowledgeBase {
  // One git operation at a time: a write is pull, commit and push in order.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };
  let cloned = false;

  function git(args: string[], cwd = dir): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 << 20,
        // Never wait on a password or host-key prompt: an unreachable remote fails fast. pi-dish
        // commits (and rebases unpushed commits) as itself; each commit's author is its writer.
        env: {
          ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_COMMITTER_NAME: 'pi-dish', GIT_COMMITTER_EMAIL: 'bots@pi-dish.invalid',
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o ConnectTimeout=15',
        },
      }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        reject(new Error(`git ${args[0]}: ${String(stderr).trim() || error.message}`));
      });
    });
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

  function pages(): { path: string; text: string }[] {
    const found: { path: string; text: string }[] = [];
    const index = path.join(dir, INDEX);
    if (fs.existsSync(index)) found.push({ path: INDEX, text: fs.readFileSync(index, 'utf8') });
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(dir, TOPICS)).filter(name => name.endsWith('.md')).sort(); } catch {}
    for (const name of names) found.push({ path: `${TOPICS}/${name}`, text: fs.readFileSync(path.join(dir, TOPICS, name), 'utf8') });
    return found;
  }

  /** Adds the page's line to the index, creating the index when the repository has none. */
  function indexPage(rel: string, title: string): void {
    const file = path.join(dir, INDEX);
    const body = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Knowledge\n\nOne line per topic page.').trimEnd();
    if (body.includes(`](${rel})`)) return;
    const lastLine = body.slice(body.lastIndexOf('\n') + 1);
    fs.writeFileSync(file, `${body}\n${lastLine.startsWith('- ') ? '' : '\n'}- [${oneLine(title)}](${rel})\n`);
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
    search: query => serial(async () => {
      await ensureClone();
      return searchPages(pages(), query);
    }),
    read: page => serial(async () => {
      const rel = knowledgePagePath(page);
      await ensureClone();
      const file = path.join(dir, rel);
      if (!fs.existsSync(file)) throw new KnowledgeError(rel === INDEX ? 'The knowledge base has no index yet.' : `There is no page ${rel}.`, 404);
      return { path: rel, text: fs.readFileSync(file, 'utf8') };
    }),
    write: entry => serial(async () => {
      const rel = knowledgePagePath(entry.page);
      if (rel === INDEX) throw new KnowledgeError('index.md is kept by pi-dish: write to a topic page and its line is added for you.', 400);
      const author = oneLine(entry.author ?? '');
      if (!author) throw new KnowledgeError('a write needs its author', 400);
      if (!entry.text?.trim()) throw new KnowledgeError('a write needs text', 400);
      if (entry.mode !== 'append' && entry.mode !== 'replace') throw new KnowledgeError('mode is append or replace', 400);
      if (entry.mode === 'append' && !entry.source?.trim()) throw new KnowledgeError('an entry needs its source: where the fact comes from', 400);
      await ensureClone();
      // Up to date first; an unreachable remote leaves the clone as it is.
      await git(['pull', '-q', '--rebase']).catch(() => git(['rebase', '--abort']).catch(() => {}));
      const file = path.join(dir, rel);
      const created = !fs.existsSync(file);
      const slug = path.basename(rel, '.md');
      const title = oneLine(entry.title ?? '') || slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (entry.mode === 'replace') {
        fs.writeFileSync(file, `${entry.text.trim()}\n`);
      } else {
        const stamped = stampEntry(entry.text, entry.source!, author, today());
        fs.writeFileSync(file, created ? `# ${title}\n\n${stamped}\n` : `${fs.readFileSync(file, 'utf8').replace(/\s*$/, '\n\n')}${stamped}\n`);
      }
      if (created) indexPage(rel, title);
      // The clone is pi-dish's own: whatever is in it is committed, with whatever a crash left behind.
      await git(['add', '-A']);
      let commit: string | null = null;
      if ((await git(['status', '--porcelain'])).trim()) {
        const verb = entry.mode === 'replace' ? 'rewrite' : created ? 'start' : 'add to';
        await git(['commit', '-q', '--author', `${author} <bots@pi-dish.invalid>`, '-m', `${author}: ${verb} ${rel}`]);
        commit = (await git(['rev-parse', 'HEAD'])).trim();
      }
      return { path: rel, created, commit, ...await push() };
    }),
  };
}
