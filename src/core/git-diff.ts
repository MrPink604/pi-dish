/**
 * Aggregate git diffs for every repo under a session's cwd.
 *
 * The user works in polyrepo workspaces: the agent cwd is a parent directory
 * holding several git checkouts side by side, so "what did the agent change"
 * means walking the tree for repos and collecting each one's working-tree
 * diff against HEAD (staged + unstaged + untracked — everything not yet
 * committed). One response powers the diff modal in the UI.
 *
 * Every git invocation goes through execFile with a timeout and an argv
 * array (never a shell string) — same rules as lib/tmux.js. A repo that
 * fails (huge diff, index lock, weird state) degrades to an `error` field on
 * its entry; one broken repo must not blank the whole modal. Missing git
 * degrades to `{ gitAvailable: false }` like fff/node-pty do.
 */
import { execFile, execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { record } from './helper-values';

export interface GitRepoDiscoveryOptions {
  maxDepth?: number;
  maxRepos?: number;
}

export interface GitDiffOptions {
  inlineLimit?: number | null;
}

export interface GitStatusChange {
  status: string | undefined;
  oldPath: string | null | undefined;
}

export interface GitStatusV2 {
  branch: string | null;
  oid: string | null;
  ahead: number;
  behind: number;
  changed: Map<string, GitStatusChange>;
  untracked: string[];
}

interface GitFileCounts {
  path: string;
  oldPath: string | null | undefined;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface GitNumstatFile extends GitFileCounts {
  oldPath: string | null;
}

/** A materialized patch; tracked patches omit status, untracked patches carry '?'. */
export interface GitFilePatch extends GitNumstatFile {
  patch: string | null;
  truncated: boolean;
  status?: '?';
}

/** Deferred entries omit patch; binary/oversized materialized stubs carry null. */
export interface GitDiffFile extends GitFileCounts {
  status: string | undefined;
  truncated: boolean;
  patch?: string | null;
  patchDeferred?: boolean;
}

/** The selected snapshot member, not an arbitrary client-supplied path. */
export interface GitFilePatchSelection {
  path: string;
  oldPath?: string | null;
  status?: string;
}

export interface GitRepoDiff {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitDiffFile[];
  additions: number;
  deletions: number;
  error?: string;
  moreUntracked?: number;
}

export interface GitDiffRepo extends GitRepoDiff {
  path: string;
}

export type GitDiffAggregate = {
  root: string;
  gitAvailable: false;
  repos: [];
  version: null;
} | {
  root: string;
  gitAvailable: true;
  repos: GitDiffRepo[];
  version: string;
};

interface GitRepoState {
  repo: GitRepoDiff;
  status: GitStatusV2 | null;
  hasHead: boolean;
  version: string;
}

interface PatchSection {
  newPath: string | null;
  oldPath: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
  lines: string[];
}

type UntrackedPatch = GitFilePatch & { status: '?'; oldPath: null };
type UntrackedFile = GitDiffFile & { status: '?'; oldPath: null };

// Same heavies the file-search walker skips; a repo hiding inside one of
// these is vendored code, not the user's workspace.
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '__pycache__', 'venv', '.git']);
const MAX_DEPTH = 3;       // cwd + 2 levels — polyrepos sit directly under the workspace dir
const MAX_DIRS = 2000;     // hard stop for huge trees
const MAX_REPOS = 30;
const MAX_FILE_PATCH = 100 * 1024;      // per-file patch cap (bytes of text kept)
const MAX_UNTRACKED_READ = 100 * 1024;  // synthesize a patch only for small text files
const MAX_UNTRACKED_FILES = 100;

function runGit(cwd: string, args: readonly string[], { timeout = 10000, maxBuffer = 20 * 1024 * 1024 } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, timeout, maxBuffer, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) { err.stderr = stderr; return reject(err); }
        resolve(stdout);
      });
  });
}

function gitErrorLine(error: unknown): string {
  const detail = record(error) ? error.stderr || error.message || '' : '';
  return (typeof detail === 'string' ? detail : '').trim().split('\n')[0];
}

let gitAvailable: boolean | null = null;
export function isGitAvailable(): boolean {
  if (gitAvailable !== null) return gitAvailable;
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 2000 });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

/**
 * Find git repos under `root` (including root itself): any directory holding
 * a `.git` entry — dir or file, so worktrees count. Found repos are not
 * descended into (submodules show as pointer changes in the parent). BFS,
 * bounded depth and dir count; symlinked dirs are skipped (no cycles).
 */
export function findGitRepos(root: string, { maxDepth = MAX_DEPTH, maxRepos = MAX_REPOS }: GitRepoDiscoveryOptions = {}): string[] {
  const repos: string[] = [];
  let visited = 0;
  const queue: [string, number][] = [[root, 0]];
  while (queue.length && repos.length < maxRepos && visited < MAX_DIRS) {
    const [dir, depth] = queue.shift()!;
    visited++;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    if (entries.some((e) => e.name === '.git')) {
      repos.push(dir);
      continue;
    }
    if (depth >= maxDepth) continue;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      queue.push([path.join(dir, e.name), depth + 1]);
    }
  }
  return repos;
}

// --- porcelain v2 parsing ------------------------------------------------

// `git status --porcelain=v2 --branch -z`: NUL-terminated records. Rename
// records ("2 ...") are followed by one extra NUL-terminated token — the
// original path. XY is staged/unstaged; the display letter prefers the
// staged side ("M." → M, ".M" → M).
export function parseStatusV2(out: string): GitStatusV2 {
  const tokens = out.split('\0');
  const result: GitStatusV2 = { branch: null, oid: null, ahead: 0, behind: 0, changed: new Map(), untracked: [] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (t.startsWith('# branch.head ')) result.branch = t.slice('# branch.head '.length);
    else if (t.startsWith('# branch.oid ')) result.oid = t.slice('# branch.oid '.length);
    else if (t.startsWith('# branch.ab ')) {
      const m = t.match(/\+(\d+) -(\d+)/);
      if (m) { result.ahead = Number(m[1]); result.behind = Number(m[2]); }
    } else if (t[0] === '1' || t[0] === '2') {
      const isRename = t[0] === '2';
      // 1 XY sub mH mI mW hH hI path / 2 XY sub mH mI mW hH hI Xscore path
      const parts = t.split(' ');
      const xy = parts[1] || '..';
      const fixed = isRename ? 9 : 8;
      const p = parts.slice(fixed).join(' ');
      const origPath = isRename ? tokens[++i] : null;
      const letter = xy[0] !== '.' ? xy[0] : xy[1];
      result.changed.set(p, { status: letter, oldPath: origPath });
    } else if (t[0] === 'u') {
      const parts = t.split(' ');
      result.changed.set(parts.slice(10).join(' '), { status: 'U', oldPath: null });
    } else if (t[0] === '?') {
      result.untracked.push(t.slice(2));
    }
  }
  return result;
}

// --- patch splitting -------------------------------------------------------

// Strip git's C-style quoting from a header path ("a/x y" when quotepath
// kicks in despite core.quotepath=false — e.g. embedded quotes).
function unquotePath(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(p);
      if (typeof decoded === 'string') return decoded;
    } catch { return p.slice(1, -1); }
  }
  return p;
}

/**
 * Split one `git diff` output into per-file entries with counts. Content
 * lines can't collide with the "diff --git " sentinel — they always start
 * with ' ', '+', '-', or '\'. Returns [{ path, oldPath, additions,
 * deletions, binary, patch }]; `path` is the post-change side (the pre-change
 * side for deletions).
 */
export function splitPatch(patchText: unknown): GitFilePatch[] {
  const files: PatchSection[] = [];
  let cur: PatchSection | null = null;
  let inHunk = false;
  for (const line of String(patchText).split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { newPath: null, oldPath: null, additions: 0, deletions: 0, binary: false, lines: [line] };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    cur.lines.push(line);
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (inHunk) {
      // Only count inside hunks: an added line whose content starts with
      // "++ " would otherwise look like a `+++` header.
      if (line[0] === '+') cur.additions++;
      else if (line[0] === '-') cur.deletions++;
      continue;
    }
    if (line.startsWith('+++ ')) cur.newPath = line.slice(4).trim();
    else if (line.startsWith('--- ')) cur.oldPath = line.slice(4).trim();
    else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) cur.binary = true;
    else if (line.startsWith('rename from ')) cur.oldPath = 'a/' + line.slice('rename from '.length);
    else if (line.startsWith('rename to ')) cur.newPath = 'b/' + line.slice('rename to '.length);
  }
  const strip = (p: string | null): string | null => {
    if (!p || p === '/dev/null') return null;
    const un = unquotePath(p);
    return un.startsWith('a/') || un.startsWith('b/') ? un.slice(2) : un;
  };
  return files.map((f) => {
    let newPath = strip(f.newPath);
    let oldPath = strip(f.oldPath);
    if (!newPath && !oldPath) {
      // Binary entries carry no ---/+++ lines; fall back to the "diff --git
      // a/x b/y" header (ambiguous for paths with spaces — acceptable there).
      const m = f.lines[0].match(/^diff --git a\/(.*) b\/(.*)$/);
      if (m) { oldPath = m[1]; newPath = m[2]; }
    }
    let patch = f.lines.join('\n');
    let truncated = false;
    if (patch.length > MAX_FILE_PATCH) { patch = patch.slice(0, MAX_FILE_PATCH); truncated = true; }
    return {
      path: newPath || oldPath || '(unknown)',
      oldPath: oldPath && newPath && oldPath !== newPath ? oldPath : null,
      additions: f.additions, deletions: f.deletions,
      binary: f.binary, patch: f.binary ? null : patch, truncated,
    };
  });
}

// Machine-readable `git diff --numstat -z` output. Ordinary records keep the
// path in the first NUL token (`add\tdel\tpath`); renames put an empty path
// there and follow it with old + new path tokens. Binary counts are `-`.
export function parseNumstat(out: unknown): GitNumstatFile[] {
  const tokens = String(out).split('\0');
  const files: GitNumstatFile[] = [];
  for (let i = 0; i < tokens.length;) {
    const head = tokens[i++];
    if (!head) continue;
    const match = head.match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/);
    if (!match) continue;
    let filePath = match[3];
    let oldPath: string | null = null;
    if (!filePath) {
      oldPath = tokens[i++] || null;
      filePath = tokens[i++] || '';
    }
    if (!filePath) continue;
    const binary = match[1] === '-' || match[2] === '-';
    files.push({
      path: filePath,
      oldPath: oldPath && oldPath !== filePath ? oldPath : null,
      additions: binary ? 0 : Number(match[1]),
      deletions: binary ? 0 : Number(match[2]),
      binary,
    });
  }
  return files;
}

// A new untracked file has no blob for git to diff, so synthesize the patch
// a `git add` would produce. Big or binary files get a stub entry instead.
function untrackedEntry(repoPath: string, relPath: string): UntrackedPatch | null;
function untrackedEntry(repoPath: string, relPath: string, options: { includePatch?: boolean }): UntrackedFile | null;
function untrackedEntry(repoPath: string, relPath: string, { includePatch = true } = {}): UntrackedFile | null {
  const abs = path.join(repoPath, relPath);
  let stat: fs.Stats;
  try { stat = fs.statSync(abs); } catch { return null; }
  if (!stat.isFile()) return null;
  const base = { path: relPath, oldPath: null, status: '?' as const, binary: false, truncated: false };
  if (stat.size > MAX_UNTRACKED_READ) {
    return { ...base, additions: 0, deletions: 0, patch: null, truncated: true };
  }
  let buf: Buffer;
  try { buf = fs.readFileSync(abs); } catch { return null; }
  if (buf.subarray(0, 8192).includes(0)) {
    return { ...base, additions: 0, deletions: 0, patch: null, binary: true };
  }
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (!includePatch) {
    return { ...base, additions: lines.length, deletions: 0, patchDeferred: true };
  }
  const patch = [
    `diff --git a/${relPath} b/${relPath}`,
    'new file',
    '--- /dev/null',
    `+++ b/${relPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => '+' + l),
  ].join('\n');
  return { ...base, additions: lines.length, deletions: 0, patch };
}

/**
 * One repo's uncommitted state: branch, ahead/behind upstream, per-file
 * entries with patches. Never throws — failures land in `error` (with
 * whatever file list still resolved).
 */
async function getRepoState(repoPath: string): Promise<GitRepoState> {
  const repo: GitRepoDiff = { branch: null, ahead: 0, behind: 0, files: [], additions: 0, deletions: 0 };
  let status: GitStatusV2, statusRaw: string;
  try {
    statusRaw = await runGit(repoPath, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    status = parseStatusV2(statusRaw);
  } catch (e) {
    repo.error = `git status failed: ${gitErrorLine(e)}`;
    return { repo, status: null, hasHead: false, version: `error:${repo.error}` };
  }
  repo.branch = status.branch;
  repo.ahead = status.ahead;
  repo.behind = status.behind;

  return {
    repo,
    status,
    hasHead: !!(status.oid && status.oid !== '(initial)'),
    version: repoStateVersion(repoPath, statusRaw, status),
  };
}

/**
 * Cheap but conservative working-tree identity. Porcelain v2 carries exact
 * HEAD/index object ids; worktree and untracked bytes are represented by
 * nanosecond stat identity. A mere touch may mark a pane stale, which is safe
 * and far cheaper than materializing every large patch up front.
 */
function repoStateVersion(repoPath: string, statusRaw: string, status: GitStatusV2): string {
  const hash = crypto.createHash('sha256').update(statusRaw);
  const paths = new Set(status.untracked);
  for (const [filePath, state] of status.changed) {
    paths.add(filePath);
    if (state.oldPath) paths.add(state.oldPath);
  }
  for (const relPath of [...paths].sort()) {
    hash.update('\0' + relPath + '\0');
    try {
      const stat = fs.statSync(path.join(repoPath, relPath), { bigint: true });
      hash.update([
        stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs,
      ].join(':'));
    } catch {
      hash.update('missing');
    }
  }
  return hash.digest('hex');
}

function aggregateVersion(root: string, repoPaths: readonly string[], states: readonly GitRepoState[]): string {
  const hash = crypto.createHash('sha256');
  const entries = repoPaths.map((repoPath, index) => ({
    path: path.relative(root, repoPath) || '.',
    version: states[index].version,
  })).sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of entries) hash.update(`${entry.path}\0${entry.version}\0`);
  return hash.digest('hex');
}

export async function getDiffVersion(root: string): Promise<string | null> {
  if (!isGitAvailable()) return null;
  const repoPaths = findGitRepos(root);
  const states = await Promise.all(repoPaths.map(getRepoState));
  return aggregateVersion(root, repoPaths, states);
}

function repoStateFileCount(state: GitRepoState): number {
  if (!state.status) return 0;
  const untracked = new Set(state.status.untracked);
  if (!state.hasHead) for (const filePath of state.status.changed.keys()) untracked.add(filePath);
  return (state.hasHead ? state.status.changed.size : 0) +
    Math.min(untracked.size, MAX_UNTRACKED_FILES);
}

async function buildRepoDiff(repoPath: string, state: GitRepoState, { includePatches = true } = {}): Promise<GitRepoDiff> {
  const { repo, status, hasHead } = state;
  if (!status) return repo;

  // Tracked changes: one diff against HEAD covers staged + unstaged. An
  // unborn branch (no commits yet) has no HEAD — everything meaningful is in
  // the untracked/added lists, synthesized below.
  if (hasHead && status.changed.size > 0) {
    try {
      const out = await runGit(repoPath, includePatches
        ? ['diff', 'HEAD', '--no-color', '--no-ext-diff', '-M', '--']
        : ['diff', 'HEAD', '--numstat', '-z', '--no-ext-diff', '-M', '--']);
      const files: (GitFilePatch | GitNumstatFile)[] = includePatches ? splitPatch(out) : parseNumstat(out);
      for (const f of files) {
        const st = status.changed.get(f.path) || status.changed.get(f.oldPath || '');
        repo.files.push({
          status: st ? st.status : 'M',
          ...f,
          truncated: 'truncated' in f ? f.truncated : false,
          ...(includePatches ? {} : { patchDeferred: !f.binary }),
        });
      }
    } catch (e) {
      // Diff too large / repo busy: keep the file list from status, no patches.
      repo.error = `git diff failed: ${gitErrorLine(e)}`;
      for (const [p, st] of status.changed) {
        repo.files.push({ status: st.status, path: p, oldPath: st.oldPath, additions: 0, deletions: 0, binary: false, patch: null, truncated: false });
      }
    }
  } else if (!hasHead) {
    // Staged-on-unborn files show as changed ("A") but diff HEAD can't see
    // them; fold them into the untracked synthesis instead.
    status.untracked.push(...status.changed.keys());
  }

  const uniqueUntracked = [...new Set(status.untracked)];
  for (const rel of uniqueUntracked.slice(0, MAX_UNTRACKED_FILES)) {
    const entry = untrackedEntry(repoPath, rel, { includePatch: includePatches });
    if (!entry) continue;
    repo.files.push(entry);
  }
  if (uniqueUntracked.length > MAX_UNTRACKED_FILES) {
    repo.moreUntracked = uniqueUntracked.length - MAX_UNTRACKED_FILES;
  }

  for (const f of repo.files) { repo.additions += f.additions; repo.deletions += f.deletions; }
  return repo;
}

export async function getRepoDiff(repoPath: string): Promise<GitRepoDiff> {
  return buildRepoDiff(repoPath, await getRepoState(repoPath));
}

/** Generate one patch selected from a previously gated repo summary. */
export async function getFilePatch(repoPath: string, file: GitFilePatchSelection | null | undefined): Promise<GitFilePatch | null> {
  if (!file || typeof file.path !== 'string' || !file.path) return null;
  const abs = path.resolve(repoPath, file.path);
  const root = path.resolve(repoPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (file.status === '?') return untrackedEntry(repoPath, file.path);

  const paths = [file.path];
  if (file.oldPath && file.oldPath !== file.path) paths.push(file.oldPath);
  const out = await runGit(repoPath,
    ['diff', 'HEAD', '--no-color', '--no-ext-diff', '-M', '--', ...paths]);
  const files = splitPatch(out);
  return files.find(item => item.path === file.path ||
    (file.oldPath && item.oldPath === file.oldPath)) || null;
}

/**
 * The full aggregate for the diff modal: every repo under `root` with its
 * uncommitted changes. Repo paths are root-relative ('.' for root itself);
 * dirty repos sort before clean ones, then by path.
 */
export async function aggregateDiffs(root: string, { inlineLimit = null }: GitDiffOptions = {}): Promise<GitDiffAggregate> {
  if (!isGitAvailable()) return { root, gitAvailable: false, repos: [], version: null };
  const repoPaths = findGitRepos(root);
  const states = await Promise.all(repoPaths.map(getRepoState));
  const version = aggregateVersion(root, repoPaths, states);
  const totalFiles = states.reduce((sum, state) => sum + repoStateFileCount(state), 0);
  const includePatches = inlineLimit == null || totalFiles <= inlineLimit;
  const repos = await Promise.all(repoPaths.map(async (abs, index) => ({
    path: path.relative(root, abs) || '.',
    ...(await buildRepoDiff(abs, states[index], { includePatches })),
  })));
  repos.sort((a, b) =>
    Number(b.files.length > 0) - Number(a.files.length > 0) || a.path.localeCompare(b.path));
  return { root, gitAvailable: true, repos, version };
}
