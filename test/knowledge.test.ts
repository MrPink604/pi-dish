// The knowledge base against a local bare repository standing in for Forgejo.
import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { execFileSync } from 'node:child_process';
import type { RouteHandler } from '../lib/http-boundary';
const {
  openKnowledgeBase,
  KnowledgeError,
  pageRevision,
  extractSourceStamps,
  missingSourceStamps,
  upsertIndexLine,
  ENTRY_MAX_BYTES,
  PAGE_WARN_BYTES,
  PAGE_MAX_BYTES,
  SUMMARY_MAX_CHARS,
  SOURCE_MAX_CHARS,
}: typeof import('../lib/knowledge') = require('../lib/knowledge');
const { createKnowledgeHandlers }: typeof import('../lib/knowledge-handlers') = require('../lib/knowledge-handlers');
const { openBotRegistry }: typeof import('../lib/bot-registry') = require('../lib/bot-registry');

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
  const openClone = (name: string) =>
    openKnowledgeBase({ remote, dir: path.join(root, name), today: () => '2026-11-20' });
  const base = openClone(path.join('home', '.pi', 'dish', 'knowledge'));
  return { root, remote, seed, base, openClone, remoteLog: () => git(remote, 'log', '--format=%an|%s', 'main').trim().split('\n') };
}

const statusIs = (expected: number) => (error: unknown) => error instanceof KnowledgeError && error.status === expected;

async function callKnowledgeHandler(
  handler: RouteHandler,
  { query = {}, body = {} }: { query?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      status(code: number) { status = code; return res; },
      json(payload: unknown) { resolve({ status, body: payload as Record<string, unknown> }); return res; },
    };
    handler({ query, body } as never, res as never, () => {});
  });
}

test('an entry starts a page, joins the index with a summary, and is pushed with its writer in the commit', async t => {
  const { base, remoteLog } = setup(t);
  const result = await base.write({
    page: 'beelink', scope: 'shared', mode: 'append',
    text: 'beelink is the hub; pi-dish runs there on port 3333.',
    source: 'pi-dish-sessions hosts', summary: 'Hub host services, ports and maintenance.', author: 'Fleet',
  });
  assert.equal(result.path, 'topics/beelink.md');
  assert.equal(result.scope, 'shared');
  assert.equal(result.created, true);
  assert.equal(result.pushed, true);
  assert.match(result.revision, /^[0-9a-f]{12}$/);
  assert.ok(result.pageBytes > 0);
  assert.match(String(result.commit), /^[0-9a-f]{40}$/);
  assert.deepEqual(remoteLog(), ['Fleet|Fleet: start topics/beelink.md', 'seed|Initial commit']);
  const readBeelink = await base.read('beelink');
  assert.equal(readBeelink.text,
    '# Beelink\n\nbeelink is the hub; pi-dish runs there on port 3333. (Source: pi-dish-sessions hosts. Added 2026-11-20 by Fleet.)\n');
  assert.equal(readBeelink.revision, result.revision);
  assert.equal(readBeelink.revision, pageRevision(readBeelink.text));
  assert.equal((await base.read()).text, '# Knowledge\n\nOne line per topic page.\n\n- [Beelink](topics/beelink.md): Hub host services, ports and maintenance\n');

  // A second entry appends to the page; summary is optional on existing pages.
  await base.write({ page: 'topics/beelink.md', scope: 'shared', mode: 'append', text: 'Backups go to aeor nightly.', source: 'crontab -l on beelink', author: 'Fleet' });
  const page = (await base.read('beelink.md')).text;
  assert.match(page, /3333\. \(Source: pi-dish-sessions hosts\. Added 2026-11-20 by Fleet\.\)\n\nBackups go to aeor nightly\. \(Source: crontab -l on beelink\. Added 2026-11-20 by Fleet\.\)\n$/);
  await base.write({
    page: 'tycho', scope: 'shared', mode: 'append', text: 'tycho has the GPU.', source: 'nvidia-smi',
    title: 'Tycho, the GPU box', summary: 'GPU workstation hardware and jobs', author: 'Fleet',
  });
  assert.equal((await base.read()).text,
    '# Knowledge\n\nOne line per topic page.\n\n- [Beelink](topics/beelink.md): Hub host services, ports and maintenance\n- [Tycho, the GPU box](topics/tycho.md): GPU workstation hardware and jobs\n');
  assert.equal(remoteLog()[0], 'Fleet|Fleet: start topics/tycho.md');
});

test('replace rewrites a whole page with revision and stamp checks, and an unchanged page makes no commit', async t => {
  const { base, remoteLog } = setup(t);
  const started = await base.write({
    page: 'backups', scope: 'shared', mode: 'append', text: 'Old fact.', source: 'crontab',
    summary: 'Backup schedules and targets', author: 'Fleet',
  });
  const tidy = '# Backups\n\n- Nightly to aeor. (Source: crontab. Added 2026-11-20 by Fleet.)';
  const replaced = await base.write({ page: 'backups', scope: 'shared', mode: 'replace', text: tidy, revision: started.revision, author: 'Fleet' });
  assert.equal(replaced.created, false);
  assert.equal((await base.read('backups')).text, `${tidy}\n`);
  assert.equal(remoteLog()[0], 'Fleet|Fleet: rewrite topics/backups.md');
  const again = await base.write({ page: 'backups', scope: 'shared', mode: 'replace', text: tidy, revision: replaced.revision, author: 'Fleet' });
  assert.equal(again.commit, null);
  assert.equal(remoteLog().length, 3);
});

test('search finds pages holding every term, case-insensitive, with the matching lines and scope labels', async t => {
  const { base } = setup(t);
  await base.write({ page: 'beelink', scope: 'shared', mode: 'append', text: 'Beelink runs Backups to aeor.', source: 'crontab', summary: 'Beelink hub', author: 'Fleet' });
  await base.write({ page: 'tycho', scope: 'shared', mode: 'append', text: 'tycho has no backups.', source: 'ls', summary: 'Tycho host', author: 'Fleet' });
  const both = await base.search('BACKUPS');
  assert.deepEqual(both.results.map(hit => [hit.scope, hit.path]), [['shared', 'topics/beelink.md'], ['shared', 'topics/tycho.md']]);
  assert.equal(both.total, 2);
  const one = await base.search('backups aeor');
  assert.deepEqual(one.results, [{
    path: 'topics/beelink.md', scope: 'shared',
    lines: [{ line: 3, text: 'Beelink runs Backups to aeor. (Source: crontab. Added 2026-11-20 by Fleet.)' }],
  }]);
  assert.equal((await base.search('backups gpu')).total, 0);
  await assert.rejects(base.search('  '), statusIs(400));
});

test('a write with the remote unreachable lands in the clone and is pushed by the next write', async t => {
  const { base, remote, remoteLog } = setup(t);
  await base.read();
  fs.renameSync(remote, `${remote}.away`);
  const offline = await base.write({ page: 'beelink', scope: 'shared', mode: 'append', text: 'Written offline.', source: 'test', summary: 'Beelink notes', author: 'Fleet' });
  assert.equal(offline.pushed, false);
  assert.match(String(offline.pushError), /git push/);
  assert.match(git(base.dir, 'log', '-1', '--format=%s'), /^Fleet: start topics\/beelink\.md/);
  assert.match((await base.read('beelink')).text, /Written offline\./);

  fs.renameSync(`${remote}.away`, remote);
  assert.deepEqual(remoteLog(), ['seed|Initial commit'], 'nothing reached the remote');
  const online = await base.write({ page: 'beelink', scope: 'shared', mode: 'append', text: 'Written online.', source: 'test', author: 'Fleet' });
  assert.equal(online.pushed, true);
  assert.deepEqual(remoteLog(), ['Fleet|Fleet: add to topics/beelink.md', 'Fleet|Fleet: start topics/beelink.md', 'seed|Initial commit']);
});

test('a repository without an index reads as empty with null revision, and its first page creates one', async t => {
  const { base } = setup(t, { index: false });
  assert.deepEqual(await base.read(), { path: 'index.md', scope: 'shared', text: 'The knowledge base has no pages yet.\n', revision: null });
  await base.write({ page: 'beelink', scope: 'shared', mode: 'append', text: 'The hub.', source: 'hosts', summary: 'The hub host', author: 'Fleet' });
  assert.equal((await base.read()).text, '# Knowledge\n\nOne line per topic page.\n\n- [Beelink](topics/beelink.md): The hub host\n');
});

test('writes are refused without scope, source, summary on new page, a valid page name, or with index as page', async t => {
  const { base, remoteLog } = setup(t);
  await assert.rejects(
    base.write({ page: 'beelink', scope: undefined as never, mode: 'append', text: 'x', source: 's', summary: 'sum', author: 'Fleet' }),
    (error: unknown) => error instanceof KnowledgeError && error.status === 400 && /scope is required/.test(error.message) && /"bot"/.test(error.message) && /"shared"/.test(error.message),
  );
  await assert.rejects(base.write({ page: 'beelink', scope: 'shared', mode: 'append', text: 'x', summary: 'sum', author: 'Fleet' }), statusIs(400));
  await assert.rejects(base.write({ page: 'beelink', scope: 'shared', mode: 'append', text: 'x', source: 's', author: 'Fleet' }),
    (error: unknown) => error instanceof KnowledgeError && error.status === 400 && /Pass summary/.test(error.message));
  await assert.rejects(base.write({ page: 'beelink', scope: 'shared', mode: 'append', text: 'x', source: 's', summary: 'a'.repeat(SUMMARY_MAX_CHARS + 1), author: 'Fleet' }), statusIs(400));
  await assert.rejects(base.write({ page: '../etc', scope: 'shared', mode: 'append', text: 'x', source: 's', summary: 'sum', author: 'Fleet' }), statusIs(400));
  await assert.rejects(base.write({ page: 'index', scope: 'shared', mode: 'replace', text: 'x', summary: 'sum', author: 'Fleet' }), statusIs(400));
  await assert.rejects(base.read('missing'), statusIs(404));
  assert.deepEqual(remoteLog(), ['seed|Initial commit']);
});

test('legacy pages without a summary work without migration and update in place when summary or title is later passed', async t => {
  const { base, seed } = setup(t);
  fs.mkdirSync(path.join(seed, 'topics'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'topics', 'legacy.md'), '# Legacy\n\nOld note. (Source: seed. Added 2026-11-20 by Fleet.)\n');
  fs.writeFileSync(path.join(seed, 'index.md'), '# Knowledge\n\nOne line per topic page.\n\n- [Legacy](topics/legacy.md)\n');
  git(seed, 'add', '-A');
  git(seed, ...IDENTITY, 'commit', '-q', '-m', 'Seed legacy page');
  git(seed, 'push', '-q', 'origin', 'HEAD:main');

  // Appending without summary succeeds and preserves the fallback summary-less index line.
  await base.write({ page: 'legacy', scope: 'shared', mode: 'append', text: 'Another note.', source: 'check', author: 'Fleet' });
  assert.equal((await base.read()).text, '# Knowledge\n\nOne line per topic page.\n\n- [Legacy](topics/legacy.md)\n');

  // Later passing summary updates the line in place without losing the title; later passing title keeps the summary.
  await base.write({ page: 'legacy', scope: 'shared', mode: 'append', text: 'Third note.', source: 'check 2', summary: 'Legacy topic scope.', author: 'Fleet' });
  assert.equal((await base.read()).text, '# Knowledge\n\nOne line per topic page.\n\n- [Legacy](topics/legacy.md): Legacy topic scope\n');
  await base.write({ page: 'legacy', scope: 'shared', mode: 'append', text: 'Fourth note.', source: 'check 3', title: 'Legacy Renamed', author: 'Fleet' });
  assert.equal((await base.read()).text, '# Knowledge\n\nOne line per topic page.\n\n- [Legacy Renamed](topics/legacy.md): Legacy topic scope\n');

  // Pure helper also appends an orphan line cleanly.
  assert.equal(
    upsertIndexLine('# Knowledge\n\nOne line per topic page.\n', 'topics/orphan.md'),
    '# Knowledge\n\nOne line per topic page.\n\n- [Orphan](topics/orphan.md)\n',
  );
});

test('replace enforces revision tokens on existing pages and creation rules on new pages', async t => {
  const { base, remoteLog } = setup(t);
  // Creating a new page with replace + revision fails with 409.
  await assert.rejects(
    base.write({ page: 'fresh', scope: 'shared', mode: 'replace', text: '# Fresh\n\nFact. (Source: test)', summary: 'Fresh page', revision: 'deadbeef1234', author: 'Fleet' }),
    statusIs(409),
  );
  // Creating a new page with replace and zero stamps fails with 400.
  await assert.rejects(
    base.write({ page: 'fresh', scope: 'shared', mode: 'replace', text: '# Fresh\n\nUnattributed claim.', summary: 'Fresh page', author: 'Fleet' }),
    (error: unknown) => error instanceof KnowledgeError && error.status === 400 && /at least one/.test(error.message),
  );
  // Creating a new page with replace, summary, and a Source stamp succeeds and indexes it.
  const created = await base.write({
    page: 'fresh', scope: 'shared', mode: 'replace',
    text: '# Fresh\n\nStructured guide. (Source: deploy script. Added 2026-11-20 by Fleet.)',
    summary: 'Structured guide created via replace', author: 'Fleet',
  });
  assert.equal(created.created, true);
  assert.match((await base.read()).text, /- \[Fresh\]\(topics\/fresh\.md\): Structured guide created via replace/);

  // Existing page without revision -> 400 naming current revision.
  await assert.rejects(
    base.write({ page: 'fresh', scope: 'shared', mode: 'replace', text: '# Fresh\n\nEdited. (Source: deploy script. Added 2026-11-20 by Fleet.)', author: 'Fleet' }),
    (error: unknown) => error instanceof KnowledgeError && error.status === 400 && error.message.includes(created.revision),
  );

  // Intervening append changes revision; stale replace gets 409 and leaves file + git log unchanged.
  const appended = await base.write({ page: 'fresh', scope: 'shared', mode: 'append', text: 'Second fact.', source: 'audit', author: 'Fleet' });
  const commitsBefore = remoteLog().length;
  await assert.rejects(
    base.write({
      page: 'fresh', scope: 'shared', mode: 'replace',
      text: '# Fresh\n\nStale. (Source: deploy script. Added 2026-11-20 by Fleet.)',
      revision: created.revision, author: 'Fleet',
    }),
    (error: unknown) => error instanceof KnowledgeError && error.status === 409 && error.message.includes(appended.revision),
  );
  assert.equal(remoteLog().length, commitsBefore);
  assert.match((await base.read('fresh')).text, /Second fact\./);

  // Replace with current revision succeeds and returns a new revision.
  const updated = await base.write({
    page: 'fresh', scope: 'shared', mode: 'replace',
    text: '# Fresh\n\nCombined guide. (Source: deploy script; audit. Added 2026-11-20 by Fleet.)',
    revision: appended.revision, author: 'Fleet',
  });
  assert.notEqual(updated.revision, appended.revision);
});

test('balanced-paren multiset source-stamp guard preserves nested parens and duplicates, and records droppedSources in commit body', async t => {
  const { base } = setup(t);
  const nestedStamp = '(Source: Scout worker on desktop (Opus), 2026-11-21. Added 2026-11-21 by OSBG.)';
  const dupStamp = '(Source: user, 2026-11-21. Added 2026-11-21 by Fleet.)';
  assert.deepEqual(
    extractSourceStamps(`- One ${nestedStamp}\n- Two ${dupStamp}\n- Three ${dupStamp}`),
    ['scout worker on desktop (opus), 2026-11-21', 'user, 2026-11-21', 'user, 2026-11-21'],
  );

  const initialText = [
    '# Fleet hosts',
    '',
    `**Sources**: fleet survey`,
    '',
    `- Desktop zram note ${nestedStamp}`,
    `- Rule A ${dupStamp}`,
    `- Rule B ${dupStamp}`,
  ].join('\n');
  const created = await base.write({
    page: 'fleet-hosts', scope: 'shared', mode: 'replace',
    text: initialText, summary: 'Fleet host hardware and rules', author: 'Fleet',
  });

  // Rewriting while keeping all stamps (including nested parens + both duplicates) passes.
  const kept = await base.write({
    page: 'fleet-hosts', scope: 'shared', mode: 'replace',
    text: initialText.replace('fleet survey', 'updated fleet survey'),
    revision: created.revision, author: 'Fleet',
  });
  assert.equal(kept.pushed, true);

  // Dropping the nested-paren stamp is refused naming the full nested source.
  await assert.rejects(
    base.write({
      page: 'fleet-hosts', scope: 'shared', mode: 'replace',
      text: `# Fleet hosts\n\n- Rule A ${dupStamp}\n- Rule B ${dupStamp}`,
      revision: kept.revision, author: 'Fleet',
    }),
    (error: unknown) => error instanceof KnowledgeError && error.status === 400 && error.message.includes('scout worker on desktop (opus), 2026-11-21'),
  );

  // Reducing duplicate stamp count 2 -> 1 without droppedSources is refused.
  assert.deepEqual(
    missingSourceStamps(initialText, `# Fleet hosts\n\n- Desktop ${nestedStamp}\n- Merged ${dupStamp}`),
    [{ source: 'user, 2026-11-21', before: 2, after: 1 }],
  );
  await assert.rejects(
    base.write({
      page: 'fleet-hosts', scope: 'shared', mode: 'replace',
      text: `# Fleet hosts\n\n- Desktop ${nestedStamp}\n- Merged rules ${dupStamp}`,
      revision: kept.revision, author: 'Fleet',
    }),
    (error: unknown) => error instanceof KnowledgeError && error.status === 400 && error.message.includes('(2 → 1)'),
  );

  // Passing droppedSources succeeds and records the override in the commit body.
  const deduped = await base.write({
    page: 'fleet-hosts', scope: 'shared', mode: 'replace',
    text: `# Fleet hosts\n\n- Desktop ${nestedStamp}\n- Merged rules ${dupStamp}`,
    revision: kept.revision, droppedSources: ['user, 2026-11-21'], author: 'Fleet',
  });
  assert.equal(deduped.pushed, true);
  assert.match(git(base.dir, 'log', '-1', '--format=%B'), /Dropped\/merged sources: user, 2026-11-21/);
});

test('size caps enforce 2048-byte append text (excluding stamp), 500-char source, 16384-byte warning, and 65536-byte hard ceiling', async t => {
  const { base } = setup(t);
  await assert.rejects(
    base.write({ page: 'caps', scope: 'shared', mode: 'append', text: 'x'.repeat(ENTRY_MAX_BYTES + 1), source: 'test', summary: 'Cap tests', author: 'Fleet' }),
    (error: unknown) => error instanceof KnowledgeError && error.status === 400 && /2048-byte cap/.test(error.message),
  );
  await assert.rejects(
    base.write({ page: 'caps', scope: 'shared', mode: 'append', text: 'ok', source: 's'.repeat(SOURCE_MAX_CHARS + 1), summary: 'Cap tests', author: 'Fleet' }),
    (error: unknown) => error instanceof KnowledgeError && error.status === 400 && /500-character cap/.test(error.message),
  );

  // 2040-byte text + >100-byte source stamp succeeds because the stamp is excluded from ENTRY_MAX_BYTES.
  const ok = await base.write({
    page: 'caps', scope: 'shared', mode: 'append',
    text: 'a'.repeat(2040),
    source: 'long-source-url-or-command-on-beelink-' + 'z'.repeat(120),
    summary: 'Size cap test page', author: 'Fleet',
  });
  assert.equal(ok.warning, undefined);

  // Crossing 16384 bytes via replace succeeds with a non-blocking warning.
  const bigBody = `# Caps\n\n${'b'.repeat(PAGE_WARN_BYTES)} (Source: ${'long-source-url-or-command-on-beelink-' + 'z'.repeat(120)}. Added 2026-11-20 by Fleet.)`;
  const warned = await base.write({
    page: 'caps', scope: 'shared', mode: 'replace',
    text: bigBody, revision: ok.revision, author: 'Fleet',
  });
  assert.ok(warned.pageBytes > PAGE_WARN_BYTES);
  assert.match(String(warned.warning), /16384-byte guideline/);

  // Crossing 65536 bytes via replace -> 400.
  await assert.rejects(
    base.write({
      page: 'caps', scope: 'shared', mode: 'replace',
      text: `# Caps\n\n${'c'.repeat(PAGE_MAX_BYTES)} (Source: ${'long-source-url-or-command-on-beelink-' + 'z'.repeat(120)}. Added 2026-11-20 by Fleet.)`,
      revision: warned.revision, author: 'Fleet',
    }),
    (error: unknown) => error instanceof KnowledgeError && error.status === 400 && /65536-byte page cap/.test(error.message),
  );

  // Crossing 65536 bytes via append -> 400.
  const nearMax = `# Caps\n\n${'d'.repeat(PAGE_MAX_BYTES - 300)} (Source: ${'long-source-url-or-command-on-beelink-' + 'z'.repeat(120)}. Added 2026-11-20 by Fleet.)`;
  const near = await base.write({ page: 'caps', scope: 'shared', mode: 'replace', text: nearMax, revision: warned.revision, author: 'Fleet' });
  assert.ok(near.pageBytes <= PAGE_MAX_BYTES);
  await assert.rejects(
    base.write({ page: 'caps', scope: 'shared', mode: 'append', text: 'e'.repeat(400), source: 'overflow', author: 'Fleet' }),
    statusIs(400),
  );
});

test('per-bot KBs isolate writes, allow read-only ancestor access, label searches, and survive bot retirement', async t => {
  const { root, base } = setup(t);
  const registry = openBotRegistry(path.join(root, 'bots.sqlite'));
  t.after(() => registry.close());
  const chief = registry.create({ name: 'Chief', identity: 'Chief bot.', model: 'faux/faux-1' }, { actor: 'user' });
  const fleet = registry.create({ name: 'Fleet', identity: 'Fleet bot.', model: 'faux/faux-1', parentId: chief.id }, { actor: 'user' });
  const personal = registry.create({ name: 'Personal', identity: 'Personal bot.', model: 'faux/faux-1' }, { actor: 'user' });
  const handlers = createKnowledgeHandlers(() => base, () => registry);

  // Shared write + Chief bot write + Fleet bot write + Personal bot write.
  const sharedWrite = await callKnowledgeHandler(handlers.write, {
    body: { page: 'hosts', scope: 'shared', mode: 'append', text: 'beelink runs hub deploy.', source: 'hosts', summary: 'Fleet host overview', author: 'Fleet', botId: fleet.id },
  });
  assert.equal(sharedWrite.status, 200);
  const chiefWrite = await callKnowledgeHandler(handlers.write, {
    body: { page: 'policy', scope: 'bot', mode: 'append', text: 'Chief deploy policy requires green CI.', source: 'user', summary: 'Chief org policies', author: 'Chief', botId: chief.id },
  });
  assert.equal(chiefWrite.status, 200);
  assert.equal(chiefWrite.body.path, `bots/${chief.id}/topics/policy.md`);
  const fleetWrite = await callKnowledgeHandler(handlers.write, {
    body: { page: 'conventions', scope: 'bot', mode: 'append', text: 'Fleet deploy runs via systemd.', source: 'systemd', summary: 'Fleet repo conventions', author: 'Fleet', botId: fleet.id },
  });
  assert.equal(fleetWrite.status, 200);
  assert.equal(fleetWrite.body.path, `bots/${fleet.id}/topics/conventions.md`);
  const personalWrite = await callKnowledgeHandler(handlers.write, {
    body: { page: 'private', scope: 'bot', mode: 'append', text: 'Personal deploy secret.', source: 'user', summary: 'Personal notes', author: 'Personal', botId: personal.id },
  });
  assert.equal(personalWrite.status, 200);

  // Bot index carries bot display name in header and relative topic link.
  const fleetIndex = await callKnowledgeHandler(handlers.read, { query: { scope: 'bot', botId: fleet.id } });
  assert.equal(fleetIndex.status, 200);
  assert.equal(fleetIndex.body.path, `bots/${fleet.id}/index.md`);
  assert.match(String(fleetIndex.body.text), /^# Fleet Knowledge\n\nOne line per topic page\.\n\n- \[Conventions\]\(topics\/conventions\.md\): Fleet repo conventions\n$/);

  // Scope isolation: Fleet cannot write Chief's (ancestor's) or Personal's bot KB.
  const writeAncestor = await callKnowledgeHandler(handlers.write, {
    body: { page: 'policy', scope: 'bot', mode: 'append', text: 'hack', source: 'x', botId: fleet.id, targetBotId: chief.id, author: 'Fleet' },
  });
  assert.equal(writeAncestor.status, 403);
  const writeOtherPath = await callKnowledgeHandler(handlers.write, {
    body: { page: `bots/${personal.id}/topics/private.md`, scope: 'bot', mode: 'append', text: 'hack', source: 'x', botId: fleet.id, author: 'Fleet' },
  });
  assert.equal(writeOtherPath.status, 403);
  const writeOtherViaShared = await callKnowledgeHandler(handlers.write, {
    body: { page: `bots/${personal.id}/topics/private.md`, scope: 'shared', mode: 'append', text: 'hack', source: 'x', botId: fleet.id, author: 'Fleet' },
  });
  assert.equal(writeOtherViaShared.status, 403);

  // Revision, stamp, and size rules apply identically to bot KB pages.
  const botReplaceNoRev = await callKnowledgeHandler(handlers.write, {
    body: { page: 'conventions', scope: 'bot', mode: 'replace', text: '# Conventions\n\nUpdated. (Source: systemd)', botId: fleet.id, author: 'Fleet' },
  });
  assert.equal(botReplaceNoRev.status, 400);
  const botReplaceDropStamp = await callKnowledgeHandler(handlers.write, {
    body: { page: 'conventions', scope: 'bot', mode: 'replace', text: '# Conventions\n\nNo stamps.', revision: String(fleetWrite.body.revision), botId: fleet.id, author: 'Fleet' },
  });
  assert.equal(botReplaceDropStamp.status, 400);
  const botAppendTooBig = await callKnowledgeHandler(handlers.write, {
    body: { page: 'conventions', scope: 'bot', mode: 'append', text: 'x'.repeat(ENTRY_MAX_BYTES + 1), source: 'big', botId: fleet.id, author: 'Fleet' },
  });
  assert.equal(botAppendTooBig.status, 400);

  // Fleet search with ancestors=1 sees shared, own bot KB, and Chief's (ancestor's) bot KB, never Personal's.
  const searched = await callKnowledgeHandler(handlers.search, { query: { q: 'deploy', botId: fleet.id, ancestors: '1' } });
  assert.equal(searched.status, 200);
  const hits = searched.body.results as { path: string; scope: string; botId?: string; botName?: string }[];
  assert.deepEqual(
    hits.map(h => [h.scope, h.botName ?? null, h.path]),
    [
      ['shared', null, 'topics/hosts.md'],
      ['bot', 'Fleet', `bots/${fleet.id}/topics/conventions.md`],
      ['bot', 'Chief', `bots/${chief.id}/topics/policy.md`],
    ],
  );

  // Fleet reads its own page via default fallback and bot:<slug>, and reads Chief's page via path; Personal is 403.
  const fallbackRead = await callKnowledgeHandler(handlers.read, { query: { page: 'conventions', botId: fleet.id, ancestors: '1' } });
  assert.equal(fallbackRead.status, 200);
  assert.equal(fallbackRead.body.scope, 'bot');
  assert.equal(fallbackRead.body.path, `bots/${fleet.id}/topics/conventions.md`);

  const prefixRead = await callKnowledgeHandler(handlers.read, { query: { page: 'bot:conventions', botId: fleet.id, ancestors: '1' } });
  assert.equal(prefixRead.status, 200);
  assert.equal(prefixRead.body.path, `bots/${fleet.id}/topics/conventions.md`);

  const ancestorRead = await callKnowledgeHandler(handlers.read, { query: { page: `bots/${chief.id}/topics/policy.md`, botId: fleet.id, ancestors: '1' } });
  assert.equal(ancestorRead.status, 200);
  assert.equal(ancestorRead.body.botName, 'Chief');

  const otherRead = await callKnowledgeHandler(handlers.read, { query: { page: `bots/${personal.id}/topics/private.md`, botId: fleet.id, ancestors: '1' } });
  assert.equal(otherRead.status, 403);
  const descendantReadByChief = await callKnowledgeHandler(handlers.read, { query: { page: `bots/${fleet.id}/topics/conventions.md`, botId: chief.id, ancestors: '1' } });
  assert.equal(descendantReadByChief.status, 403);

  // Retiring Fleet keeps Fleet's KB intact in git and readable.
  registry.retire(fleet.id, { actor: 'user' });
  const afterRetire = await callKnowledgeHandler(handlers.read, { query: { page: 'conventions', scope: 'bot', botId: fleet.id } });
  assert.equal(afterRetire.status, 200);
  assert.match(String(afterRetire.body.text), /systemd/);
});

/** Installs a one-shot pre-push hook in `cloneDir` that runs `script` before git pushes (simulating a remote push race). */
function installOneShotPrePushRace(cloneDir: string, raceScript: string): void {
  const hook = path.join(cloneDir, '.git', 'hooks', 'pre-push');
  fs.writeFileSync(hook, `#!/bin/sh\nrm -f "$0"\n${raceScript}\nexit 0\n`, { mode: 0o755 });
}

test('two clones racing on the same page roll back cleanly with 409 and never stay diverged; bot + shared concurrent writes auto-rebase', async t => {
  const { openClone, remote, remoteLog } = setup(t);
  const baseA = openClone('clone-a');
  const baseB = openClone('clone-b');

  // Seed a shared page from clone A and clone B pulls it.
  const v1 = await baseA.write({
    page: 'beelink', scope: 'shared', mode: 'append', text: 'Initial fact.', source: 'init',
    summary: 'Beelink hub host', author: 'Fleet',
  });
  await baseB.read('beelink');

  // 1. Conflicting replace push race: while clone A commits and tries to push its replace,
  //    clone B pushes an edit to the same page first (triggered deterministically by pre-push hook).
  const raceScriptReplace = [
    `git -C ${JSON.stringify(baseB.dir)} pull -q --rebase`,
    `printf '\\nRemote edit. (Source: clone-b. Added 2026-11-20 by Other.)\\n' >> ${JSON.stringify(path.join(baseB.dir, 'topics', 'beelink.md'))}`,
    `git -C ${JSON.stringify(baseB.dir)} add -A`,
    `git -C ${JSON.stringify(baseB.dir)} -c user.name=Other -c user.email=other@example.invalid commit -q -m 'Other: add to topics/beelink.md'`,
    `git -C ${JSON.stringify(baseB.dir)} push -q origin HEAD`,
  ].join('\n');
  installOneShotPrePushRace(baseA.dir, raceScriptReplace);

  await assert.rejects(
    baseA.write({
      page: 'beelink', scope: 'shared', mode: 'replace',
      text: '# Beelink\n\nLocal rewrite. (Source: init. Added 2026-11-20 by Fleet.)',
      revision: v1.revision, author: 'Fleet',
    }),
    statusIs(409),
  );
  // Clone A must be clean and aligned with origin/main (NOT diverged), so a subsequent write pushes cleanly!
  assert.equal(git(baseA.dir, 'status', '--porcelain').trim(), '');
  assert.equal(git(baseA.dir, 'rev-parse', 'HEAD').trim(), git(remote, 'rev-parse', 'main').trim());
  const afterConflictRead = await baseA.read('beelink');
  assert.match(afterConflictRead.text, /Remote edit\./);
  const followUp = await baseA.write({
    page: 'beelink', scope: 'shared', mode: 'append', text: 'Clean follow-up after 409.', source: 'retry', author: 'Fleet',
  });
  assert.equal(followUp.pushed, true);

  // 2. Conflicting append push race on the same page also rolls back cleanly with 409.
  const raceScriptAppend = [
    `git -C ${JSON.stringify(baseB.dir)} pull -q --rebase`,
    `printf '\\nConcurrent append B. (Source: b2. Added 2026-11-20 by Other.)\\n' >> ${JSON.stringify(path.join(baseB.dir, 'topics', 'beelink.md'))}`,
    `git -C ${JSON.stringify(baseB.dir)} add -A`,
    `git -C ${JSON.stringify(baseB.dir)} -c user.name=Other -c user.email=other@example.invalid commit -q -m 'Other: append conflict'`,
    `git -C ${JSON.stringify(baseB.dir)} push -q origin HEAD`,
  ].join('\n');
  installOneShotPrePushRace(baseA.dir, raceScriptAppend);
  await assert.rejects(
    baseA.write({ page: 'beelink', scope: 'shared', mode: 'append', text: 'Concurrent append A.', source: 'a2', author: 'Fleet' }),
    statusIs(409),
  );
  assert.equal(git(baseA.dir, 'rev-parse', 'HEAD').trim(), git(remote, 'rev-parse', 'main').trim());

  // 3. Non-conflicting race: clone A writes a bot page while clone B pushes a shared page (different files + different indexes).
  const botId = '0b0c5a1e-0000-4000-8000-000000000001';
  const raceScriptShared = [
    `git -C ${JSON.stringify(baseB.dir)} pull -q --rebase`,
    `mkdir -p ${JSON.stringify(path.join(baseB.dir, 'topics'))}`,
    `printf '# Tycho\\n\\nTycho GPU. (Source: nvidia-smi. Added 2026-11-20 by Other.)\\n' > ${JSON.stringify(path.join(baseB.dir, 'topics', 'tycho.md'))}`,
    `printf -- '- [Tycho](topics/tycho.md): GPU box\\n' >> ${JSON.stringify(path.join(baseB.dir, 'index.md'))}`,
    `git -C ${JSON.stringify(baseB.dir)} add -A`,
    `git -C ${JSON.stringify(baseB.dir)} -c user.name=Other -c user.email=other@example.invalid commit -q -m 'Other: start topics/tycho.md'`,
    `git -C ${JSON.stringify(baseB.dir)} push -q origin HEAD`,
  ].join('\n');
  installOneShotPrePushRace(baseA.dir, raceScriptShared);
  const botWrite = await baseA.write({
    page: 'workflows', scope: 'bot', botId, botName: 'Fleet', mode: 'append',
    text: 'Check load before spawning.', source: 'ops', summary: 'Fleet workflows', author: 'Fleet',
  });
  assert.equal(botWrite.pushed, true, 'bot page auto-rebases cleanly over concurrent shared page push');
  assert.equal(git(baseA.dir, 'rev-parse', 'HEAD').trim(), git(remote, 'rev-parse', 'main').trim());
  assert.match((await baseA.read('tycho')).text, /Tycho GPU\./);
  assert.match((await baseA.read('workflows', { scope: 'bot', botId })).text, /Check load before spawning\./);
  assert.ok(remoteLog().some(line => line.includes(`bots/${botId}/topics/workflows.md`)));

  // 4. Non-conflicting concurrent appends to different existing shared pages auto-rebase and both push cleanly.
  const raceScriptOtherShared = [
    `git -C ${JSON.stringify(baseB.dir)} pull -q --rebase`,
    `printf '\\nSecond Tycho fact. (Source: lscpu. Added 2026-11-20 by Other.)\\n' >> ${JSON.stringify(path.join(baseB.dir, 'topics', 'tycho.md'))}`,
    `git -C ${JSON.stringify(baseB.dir)} add -A`,
    `git -C ${JSON.stringify(baseB.dir)} -c user.name=Other -c user.email=other@example.invalid commit -q -m 'Other: add to topics/tycho.md'`,
    `git -C ${JSON.stringify(baseB.dir)} push -q origin HEAD`,
  ].join('\n');
  installOneShotPrePushRace(baseA.dir, raceScriptOtherShared);
  const nonConflictingAppend = await baseA.write({
    page: 'beelink', scope: 'shared', mode: 'append', text: 'Another beelink fact.', source: 'host', author: 'Fleet',
  });
  assert.equal(nonConflictingAppend.pushed, true);
  assert.match((await baseA.read('tycho')).text, /Second Tycho fact\./);
  assert.match((await baseA.read('beelink')).text, /Another beelink fact\./);
});

test('the routes say the knowledge base is off without a remote', async () => {
  const handlers = createKnowledgeHandlers(() => null);
  const answer = await callKnowledgeHandler(handlers.search, { query: { q: 'x' } });
  assert.equal(answer.status, 503);
  assert.match(String(answer.body.error), /knowledgeRemote/);
});
