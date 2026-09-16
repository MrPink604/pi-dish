/**
 * Fuzzy file/directory search for the web UI.
 *
 * Backed by fff (@ff-labs/fff-node) — a Rust fuzzy finder that keeps an
 * in-memory index per project, so repeated searches from the @-mention
 * autocomplete stay fast. The package is ESM-only and ships a native
 * binary, so it's loaded lazily via dynamic import and everything degrades
 * to a plain recursive walk + the shared fuzzy scorer when it's missing
 * (unsupported platform, stripped install).
 *
 * Three entry points:
 *   searchFiles(basePath, query, limit) — files under a project dir
 *   searchHomeDirs(query, limit)        — directories under $HOME for the
 *     new-session cwd picker (fff refuses to index $HOME by design, so this
 *     is always the walker + scorer)
 *   completePath(token, { cwd, limit }) — shell-style completion for path
 *     tokens (/abs, ~/home, ../relative): readdir the parent, fuzzy-match the
 *     partial basename. Lets @-mentions reach anywhere on the filesystem
 *     without pretending the whole filesystem is indexable.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FileFinder, FileItem } from '@ff-labs/fff-node' with { 'resolution-mode': 'import' };
import type * as FffSdk from '@ff-labs/fff-node' with { 'resolution-mode': 'import' };
import { fuzzyMatch, fuzzyScore } from './helper-query.js';
import { record } from './helper-values';
import { fffImportSpecifier } from './runtime-resources';

export interface FileSearchResult {
  path: string;
  gitStatus: FileItem['gitStatus'] | null;
}

export interface HomeDirSearchResult {
  path: string;
  short: string;
  score?: number;
}

export interface DirChild {
  name: string;
  path: string;
}

export interface DirChildrenResult {
  path: string;
  dirs: DirChild[];
  error?: string;
}

export interface PathCompletionResult {
  path: string;
  isDir: boolean;
  gitStatus: null;
}

export interface PathCompletionOptions {
  cwd?: string | null;
  limit?: number;
}

interface FinderEntry {
  promise: Promise<FileFinder | null>;
  lastUsed: number;
}

interface HomeDirCache {
  at: number;
  dirs: string[];
}

type FffModule = typeof FffSdk;

// --- fff finder pool ---------------------------------------------------------

const MAX_FINDERS = 4;
const finders = new Map<string, FinderEntry>();

let fffModulePromise: Promise<FffModule | null> | null = null;
function loadFff(): Promise<FffModule | null> {
  if (!fffModulePromise) {
    fffModulePromise = (async (): Promise<FffModule> =>
      import(fffImportSpecifier(path.resolve(__dirname, '..'))))().catch((e: unknown) => {
      console.warn('fff unavailable, falling back to walker:', record(e) ? e.message : undefined);
      return null;
    });
  }
  return fffModulePromise;
}

async function createFinder(basePath: string): Promise<FileFinder | null> {
  const mod = await loadFff();
  if (!mod) return null;
  const created = mod.FileFinder.create({ basePath });
  if (!created.ok) {
    console.warn(`fff index failed for ${basePath}: ${created.error}`);
    return null;
  }
  const finder = created.value;
  await finder.waitForScan(10000).catch(() => {}); // partial index still usable
  return finder;
}

async function getFinder(basePath: string): Promise<FileFinder | null> {
  const entry = finders.get(basePath);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.promise;
  }

  if (finders.size >= MAX_FINDERS) {
    const oldest = [...finders.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    finders.delete(oldest[0]);
    oldest[1].promise.then((f) => { try { f?.destroy(); } catch {} });
  }

  const promise = createFinder(basePath).catch(() => null);
  finders.set(basePath, { promise, lastUsed: Date.now() });
  return promise;
}

/**
 * Fuzzy-search files under basePath. Returns [{ path, gitStatus }] with
 * paths relative to basePath. Empty query returns the index's
 * frecency/recency ordering — a useful "recent files" list.
 */
export async function searchFiles(basePath: string | null | undefined, query: string | null | undefined, limit = 20): Promise<FileSearchResult[]> {
  if (!basePath || !fs.existsSync(basePath)) return [];
  const finder = await getFinder(basePath);
  if (finder) {
    // try/catch, not just result.ok: under LRU pressure a concurrent
    // getFinder can destroy this finder before we call it, and the native
    // call then throws — degrade to the walker like every other fff failure.
    try {
      const result = finder.fileSearch(query || '', { pageSize: limit });
      if (result.ok) {
        return result.value.items.map(i => ({ path: i.relativePath, gitStatus: i.gitStatus }));
      }
      console.warn(`fff fileSearch failed for ${basePath}: ${result.error}`);
    } catch (e) {
      console.warn(`fff fileSearch threw for ${basePath}: ${record(e) ? e.message : undefined}`);
    }
  }
  return walkerSearch(basePath, query, limit);
}

// --- $HOME directory search (walker only) -------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '__pycache__', 'venv']);
const DIR_CACHE_MS = 60_000;
const MAX_WALK = 20_000; // hard stop for huge trees
let homeDirCache: HomeDirCache | null = null;

/** The one recursive walk both searches share: absolute dirs or files. */
function walk(root: string, { maxDepth, collect }: { maxDepth: number; collect: 'dirs' | 'files' }): string[] {
  const out: string[] = [];
  const stack: [string, number][] = [[root, 0]];
  while (stack.length && out.length < MAX_WALK) {
    const [dir, depth] = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (collect === 'dirs') out.push(full);
        if (depth + 1 < maxDepth) stack.push([full, depth + 1]);
      } else if (collect === 'files') {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Fuzzy-search directories under $HOME for the new-session cwd picker.
 * Returns [{ path, short }] best-first; `short` is the ~-relative form the
 * match was scored against.
 */
export function searchHomeDirs(query: string | null | undefined, limit = 15): HomeDirSearchResult[] {
  const home = os.homedir();
  if (!homeDirCache || Date.now() - homeDirCache.at > DIR_CACHE_MS) {
    homeDirCache = { at: Date.now(), dirs: walk(home, { maxDepth: 4, collect: 'dirs' }) };
  }

  const candidates = homeDirCache.dirs.map(p => ({
    path: p,
    short: '~/' + path.relative(home, p),
  }));

  if (!query) {
    return candidates.slice(0, limit);
  }

  return candidates
    .map(c => ({ ...c, score: fuzzyScore(fuzzyMatch(query, c.short), c.short) }))
    .filter(c => c.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Expand a leading `~` / `~/x` to the home directory; other forms pass through. */
function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * List the immediate subdirectories of `inputPath` for the new-session cwd
 * tree. Expands a leading `~`, then requires an absolute path (throws a
 * badRequest error otherwise — the route turns it into a 400). Directories
 * only, dotdirs and SKIP_DIRS excluded, locale-sorted, capped at 500. An
 * unreadable/nonexistent dir degrades to `{ path, dirs: [], error }` (200) so
 * the tree never blanks.
 */
export function getDirChildren(inputPath: unknown): DirChildrenResult {
  const resolved = expandHome(String(inputPath || ''));
  if (!path.isAbsolute(resolved)) {
    const e: Error & { badRequest?: boolean } = new Error('an absolute path (or ~) is required');
    e.badRequest = true;
    throw e;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (e) {
    return { path: resolved, dirs: [], error: record(e) && typeof e.message === 'string' ? e.message : undefined };
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 500);
  return { path: resolved, dirs };
}

// --- path completion (absolute / ~ / ../ tokens) -------------------------------

/** Does this @-mention token name a filesystem location rather than a
 *  cwd-relative fuzzy query? Matches /abs, ~ , ~/x, ./x, ../x. */
export function isPathCompletionToken(token: string): boolean {
  return /^(?:\/|~(?:\/|$)|\.\.?\/)/.test(token);
}

/**
 * Complete one path segment, shell-style. The directory part of the token is
 * kept verbatim in the results (so accepting a suggestion preserves the form
 * the user typed — ~/x stays ~-relative, /x stays absolute); only the partial
 * basename after the last slash is matched. Directories come back with
 * isDir:true so the client can drill into them. Dotfiles are hidden unless
 * the partial itself starts with a dot.
 */
export function completePath(token: string, { cwd = null, limit = 20 }: PathCompletionOptions = {}): PathCompletionResult[] {
  const slash = token.lastIndexOf('/');
  const prefix = slash === -1 ? token + '/' : token.slice(0, slash + 1); // bare '~'
  const partial = slash === -1 ? '' : token.slice(slash + 1);

  let dir: string;
  if (prefix.startsWith('~')) dir = path.join(os.homedir(), prefix.slice(1));
  else if (prefix.startsWith('/')) dir = prefix;
  else if (cwd) dir = path.resolve(cwd, prefix); // ./ and ../ need a session cwd
  else return [];

  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }

  const showHidden = partial.startsWith('.');
  const candidates: { name: string; isDir: boolean }[] = [];
  for (const e of entries) {
    if (!showHidden && e.name.startsWith('.')) continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try { isDir = fs.statSync(path.join(dir, e.name)).isDirectory(); } catch {}
    }
    candidates.push({ name: e.name, isDir });
  }

  const picked = !partial
    ? candidates
        .sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || a.name.localeCompare(b.name))
        .slice(0, limit)
    : candidates
        .map(c => ({ ...c, score: fuzzyScore(fuzzyMatch(partial, c.name), c.name) }))
        .filter(c => c.score > -Infinity)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

  return picked.map(c => ({ path: prefix + c.name, isDir: c.isDir, gitStatus: null }));
}

// --- walker fallback for file search ------------------------------------------

function walkerSearch(basePath: string, query: string | null | undefined, limit: number): FileSearchResult[] {
  const out = walk(basePath, { maxDepth: 6, collect: 'files' })
    .map(f => path.relative(basePath, f));
  if (!query) return out.slice(0, limit).map(p => ({ path: p, gitStatus: null }));
  return out
    .map(p => ({ path: p, score: fuzzyScore(fuzzyMatch(query, p), p) }))
    .filter(c => c.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(c => ({ path: c.path, gitStatus: null }));
}

/** Test hook: drop caches so temp-HOME fixtures are re-read. */
export function resetCaches(): void {
  homeDirCache = null;
  for (const [, entry] of finders) entry.promise.then((f) => { try { f?.destroy(); } catch {} });
  finders.clear();
}
