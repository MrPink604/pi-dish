// The knowledge base against a local bare repository standing in for Forgejo.
import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { execFileSync } from 'node:child_process';
const { openKnowledgeBase, KnowledgeError }: typeof import('../lib/knowledge') = require('../lib/knowledge');
const { createKnowledgeHandlers }: typeof import('../lib/knowledge-handlers') = require('../lib/knowledge-handlers');

const IDENTITY = ['-c', 'user.name=seed', '-c', 'user.email=seed@example.invalid'];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

/** A bare remote holding one commit with an index, and a knowledge base whose clone does not exist yet. */
function setup(t: test.TestContext, { index = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-knowledge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'knowledge.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  const seed = path.join(root, 'seed');
  git(root, 'clone', '-q', remote, seed);
  fs.writeFileSync(path.join(seed, index ? 'index.md' : 'README.md'), '# Knowledge\n\nOne line per topic page.\n');
  git(seed, 'add', '-A');
  git(seed, ...IDENTITY, 'commit', '-q', '-m', 'Initial commit');
  git(seed, 'push', '-q', 'origin', 'HEAD:main');
  const base = openKnowledgeBase({ remote, dir: path.join(root, 'home', '.pi', 'dish', 'knowledge'), today: () => '2026-11-20' });
  return { root, remote, base, remoteLog: () => git(remote, 'log', '--format=%an|%s', 'main').trim().split('\n') };
}

test('an entry starts a page, joins the index, and is pushed with its writer in the commit', async t => {
  const { base, remoteLog } = setup(t);
  const result = await base.write({ page: 'beelink', mode: 'append', text: 'beelink is the hub; pi-dish runs there on port 3333.', source: 'pi-dish-sessions hosts', author: 'Fleet' });
  assert.equal(result.path, 'topics/beelink.md');
  assert.equal(result.created, true);
  assert.equal(result.pushed, true);
  assert.match(String(result.commit), /^[0-9a-f]{40}$/);
  assert.deepEqual(remoteLog(), ['Fleet|Fleet: start topics/beelink.md', 'seed|Initial commit']);
  assert.equal((await base.read('beelink')).text,
    '# Beelink\n\nbeelink is the hub; pi-dish runs there on port 3333. (Source: pi-dish-sessions hosts. Added 2026-11-20 by Fleet.)\n');
  assert.equal((await base.read()).text, '# Knowledge\n\nOne line per topic page.\n\n- [Beelink](topics/beelink.md)\n');

  // A second entry appends to the page; the index already has its line.
  await base.write({ page: 'topics/beelink.md', mode: 'append', text: 'Backups go to aeor nightly.', source: 'crontab -l on beelink', author: 'Fleet' });
  const page = (await base.read('beelink.md')).text;
  assert.match(page, /3333\. \(Source: pi-dish-sessions hosts\. Added 2026-11-20 by Fleet\.\)\n\nBackups go to aeor nightly\. \(Source: crontab -l on beelink\. Added 2026-11-20 by Fleet\.\)\n$/);
  await base.write({ page: 'tycho', mode: 'append', text: 'tycho has the GPU.', source: 'nvidia-smi', title: 'Tycho, the GPU box', author: 'Fleet' });
  assert.equal((await base.read()).text,
    '# Knowledge\n\nOne line per topic page.\n\n- [Beelink](topics/beelink.md)\n- [Tycho, the GPU box](topics/tycho.md)\n');
  assert.equal(remoteLog()[0], 'Fleet|Fleet: start topics/tycho.md');
});

test('replace rewrites a whole page, and an unchanged page makes no commit', async t => {
  const { base, remoteLog } = setup(t);
  await base.write({ page: 'backups', mode: 'append', text: 'Old fact.', source: 'memory', author: 'Fleet' });
  const tidy = '# Backups\n\n- Nightly to aeor. (Source: crontab. Added 2026-11-20 by Fleet.)';
  const replaced = await base.write({ page: 'backups', mode: 'replace', text: tidy, author: 'Fleet' });
  assert.equal(replaced.created, false);
  assert.equal((await base.read('backups')).text, `${tidy}\n`);
  assert.equal(remoteLog()[0], 'Fleet|Fleet: rewrite topics/backups.md');
  const again = await base.write({ page: 'backups', mode: 'replace', text: tidy, author: 'Fleet' });
  assert.equal(again.commit, null);
  assert.equal(remoteLog().length, 3);
});

test('search finds pages holding every term, case-insensitive, with the matching lines', async t => {
  const { base } = setup(t);
  await base.write({ page: 'beelink', mode: 'append', text: 'Beelink runs Backups to aeor.', source: 'crontab', author: 'Fleet' });
  await base.write({ page: 'tycho', mode: 'append', text: 'tycho has no backups.', source: 'ls', author: 'Fleet' });
  const both = await base.search('BACKUPS');
  assert.deepEqual(both.results.map(hit => hit.path), ['topics/beelink.md', 'topics/tycho.md']);
  assert.equal(both.total, 2);
  const one = await base.search('backups aeor');
  assert.deepEqual(one.results, [{ path: 'topics/beelink.md', lines: [{ line: 3, text: 'Beelink runs Backups to aeor. (Source: crontab. Added 2026-11-20 by Fleet.)' }] }]);
  assert.equal((await base.search('backups gpu')).total, 0);
  await assert.rejects(base.search('  '), (error: unknown) => error instanceof KnowledgeError && error.status === 400);
});

test('a write with the remote unreachable lands in the clone and is pushed by the next write', async t => {
  const { base, remote, remoteLog } = setup(t);
  await base.read();
  fs.renameSync(remote, `${remote}.away`);
  const offline = await base.write({ page: 'beelink', mode: 'append', text: 'Written offline.', source: 'test', author: 'Fleet' });
  assert.equal(offline.pushed, false);
  assert.match(String(offline.pushError), /git push/);
  assert.match(git(base.dir, 'log', '-1', '--format=%s'), /^Fleet: start topics\/beelink\.md/);
  assert.match((await base.read('beelink')).text, /Written offline\./);

  fs.renameSync(`${remote}.away`, remote);
  assert.deepEqual(remoteLog(), ['seed|Initial commit'], 'nothing reached the remote');
  const online = await base.write({ page: 'beelink', mode: 'append', text: 'Written online.', source: 'test', author: 'Fleet' });
  assert.equal(online.pushed, true);
  assert.deepEqual(remoteLog(), ['Fleet|Fleet: add to topics/beelink.md', 'Fleet|Fleet: start topics/beelink.md', 'seed|Initial commit']);
});

test('a repository without an index reads as empty, and its first page creates one', async t => {
  const { base } = setup(t, { index: false });
  assert.deepEqual(await base.read(), { path: 'index.md', text: 'The knowledge base has no pages yet.\n' });
  await base.write({ page: 'beelink', mode: 'append', text: 'The hub.', source: 'hosts', author: 'Fleet' });
  assert.equal((await base.read()).text, '# Knowledge\n\nOne line per topic page.\n\n- [Beelink](topics/beelink.md)\n');
});

test('writes are refused without a source, a page name or with the index as their page', async t => {
  const { base, remoteLog } = setup(t);
  const status = (expected: number) => (error: unknown) => error instanceof KnowledgeError && error.status === expected;
  await assert.rejects(base.write({ page: 'beelink', mode: 'append', text: 'x', author: 'Fleet' }), status(400));
  await assert.rejects(base.write({ page: '../etc', mode: 'append', text: 'x', source: 's', author: 'Fleet' }), status(400));
  await assert.rejects(base.write({ page: 'index', mode: 'replace', text: 'x', author: 'Fleet' }), status(400));
  await assert.rejects(base.read('missing'), status(404));
  assert.deepEqual(remoteLog(), ['seed|Initial commit']);
});

test('the routes say the knowledge base is off without a remote', async () => {
  const handlers = createKnowledgeHandlers(() => null);
  let answer: { status: number; body: unknown } | null = null;
  const res = {
    status(code: number) { return { json(body: unknown) { answer = { status: code, body }; } }; },
  } as unknown as Parameters<typeof handlers.search>[1];
  handlers.search({ query: { q: 'x' } } as unknown as Parameters<typeof handlers.search>[0], res, () => {});
  assert.equal(answer!.status, 503);
  assert.match(String((answer!.body as Record<string, unknown>).error), /knowledgeRemote/);
});
