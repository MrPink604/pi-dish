/**
 * Unit tests for lib/git-diff.js — polyrepo discovery and aggregate
 * uncommitted-diff collection behind GET /api/sessions/:id/diff.
 *
 * Uses real `git` against throwaway repos in a temp dir (skips if git is
 * missing, like the tmux suite does for tmux).
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const GD = require('../lib/git-diff.js');

const gitOk = GD.isGitAvailable();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-gd-'));
test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
}

function makeRepo(rel, files = {}) {
  const dir = path.join(tmpDir, rel);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  if (Object.keys(files).length) {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
  }
  return dir;
}

// --- splitPatch (pure — runs even without git) ------------------------------

test('splitPatch splits per file and counts only inside hunks', () => {
  const patch = [
    'diff --git a/x.txt b/x.txt',
    'index 000..111 100644',
    '--- a/x.txt',
    '+++ b/x.txt',
    '@@ -1,2 +1,3 @@',
    ' keep',
    '-old line',
    '+new line',
    '+++ tricky added line starting with plusses',
    'diff --git a/bin.dat b/bin.dat',
    'index 000..111 100644',
    'Binary files a/bin.dat and b/bin.dat differ',
  ].join('\n');
  const files = GD.splitPatch(patch);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'x.txt');
  assert.equal(files[0].additions, 2, 'the "+++ tricky" line is an addition, not a header');
  assert.equal(files[0].deletions, 1);
  assert.equal(files[1].path, 'bin.dat');
  assert.equal(files[1].binary, true);
  assert.equal(files[1].patch, null);
});

test('splitPatch resolves deletions and renames', () => {
  const patch = [
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
    'diff --git a/old.txt b/new.txt',
    'similarity index 100%',
    'rename from old.txt',
    'rename to new.txt',
  ].join('\n');
  const files = GD.splitPatch(patch);
  assert.equal(files[0].path, 'gone.txt', 'deletion falls back to the pre-image path');
  assert.equal(files[1].path, 'new.txt');
  assert.equal(files[1].oldPath, 'old.txt');
});

// --- repo walking + aggregation ---------------------------------------------

test('findGitRepos finds nested repos but skips heavies and repo interiors', { skip: !gitOk }, () => {
  const root = path.join(tmpDir, 'walk');
  makeRepo('walk/repo-a', { 'a.txt': 'a\n' });
  makeRepo('walk/group/repo-b', { 'b.txt': 'b\n' });
  makeRepo('walk/repo-a/vendored-inner', {}); // inside a repo — must not be listed
  makeRepo('walk/node_modules/dep', {});      // skipped dir
  fs.mkdirSync(path.join(root, 'plain'), { recursive: true });
  const repos = GD.findGitRepos(root).map((p) => path.relative(root, p)).sort();
  assert.deepEqual(repos, ['group/repo-b', 'repo-a']);
});

test('aggregateDiffs collects modified, untracked, and clean repos across the tree', { skip: !gitOk }, async () => {
  const root = path.join(tmpDir, 'agg');
  const a = makeRepo('agg/repo-a', { 'src/main.js': 'line1\nline2\n', 'README.md': 'hi\n' });
  makeRepo('agg/repo-clean', { 'x.txt': 'x\n' });

  fs.writeFileSync(path.join(a, 'src/main.js'), 'line1\nchanged\nline3\n'); // modified (unstaged)
  fs.writeFileSync(path.join(a, 'fresh.txt'), 'new file\ntwo lines\n');     // untracked
  git(a, 'rm', '-q', 'README.md');                                          // staged deletion

  const out = await GD.aggregateDiffs(root);
  assert.equal(out.gitAvailable, true);
  assert.equal(out.repos.length, 2);
  assert.equal(out.repos[0].path, 'repo-a', 'dirty repo sorts first');
  assert.equal(out.repos[1].path, 'repo-clean');
  assert.equal(out.repos[1].files.length, 0);
  assert.equal(out.repos[1].branch, 'main');

  const files = Object.fromEntries(out.repos[0].files.map((f) => [f.path, f]));
  assert.equal(files['src/main.js'].status, 'M');
  assert.ok(files['src/main.js'].patch.includes('+changed'), 'patch carries the hunk');
  assert.equal(files['src/main.js'].additions, 2);
  assert.equal(files['src/main.js'].deletions, 1);
  assert.equal(files['README.md'].status, 'D');
  assert.equal(files['fresh.txt'].status, '?');
  assert.equal(files['fresh.txt'].additions, 2);
  assert.ok(files['fresh.txt'].patch.includes('+new file'), 'untracked patch is synthesized');
  assert.ok(out.repos[0].additions >= 4, 'repo totals aggregate per-file counts');
});

test('cwd that is itself a repo reports as "."; staged changes count', { skip: !gitOk }, async () => {
  const dir = makeRepo('self', { 'f.txt': 'one\n' });
  fs.writeFileSync(path.join(dir, 'f.txt'), 'one\ntwo\n');
  git(dir, 'add', 'f.txt'); // staged, not committed — still uncommitted work
  const out = await GD.aggregateDiffs(dir);
  assert.equal(out.repos.length, 1);
  assert.equal(out.repos[0].path, '.');
  assert.equal(out.repos[0].files[0].path, 'f.txt');
  assert.equal(out.repos[0].files[0].additions, 1);
});

test('binary untracked files get a stub entry, not a patch', { skip: !gitOk }, async () => {
  const dir = makeRepo('bin', { 'f.txt': 'one\n' });
  fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255]));
  const out = await GD.aggregateDiffs(dir);
  const blob = out.repos[0].files.find((f) => f.path === 'blob.bin');
  assert.equal(blob.binary, true);
  assert.equal(blob.patch, null);
});

test('repo with no commits yet synthesizes everything as new files', { skip: !gitOk }, async () => {
  const dir = path.join(tmpDir, 'unborn');
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'w.txt'), 'work\n');
  fs.writeFileSync(path.join(dir, 's.txt'), 'staged\n');
  git(dir, 'add', 's.txt');
  const out = await GD.aggregateDiffs(dir);
  const paths = out.repos[0].files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['s.txt', 'w.txt']);
  assert.ok(out.repos[0].files.every((f) => f.patch.includes('+++ b/')));
});

test('a non-repo cwd with no repos below returns an empty list', { skip: !gitOk }, async () => {
  const dir = path.join(tmpDir, 'norepos/deep');
  fs.mkdirSync(dir, { recursive: true });
  const out = await GD.aggregateDiffs(path.join(tmpDir, 'norepos'));
  assert.deepEqual(out.repos, []);
});
