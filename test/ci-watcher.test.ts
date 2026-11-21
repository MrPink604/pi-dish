import test = require('node:test');
import assert = require('node:assert/strict');
import { createCiWatcher, readCiConfig, type CiConfig, type CiEvent } from '../lib/ci-watcher';
import { createGitHubCi, type GitHubCi } from '../lib/github-ci';

const REPO = 'MrPink604/pi-dish';
const SETTINGS = { bots: true, ciWatcher: { hostId: 'hub-id' } };
const CONFIG = readCiConfig(SETTINGS, 'hub-id')!;
const HOLD = 'a restart delivers each durable batch exactly once and empties the inbox';
const HOLD_ANNOTATION = `✖ failing tests:\n\ntest at test/message-hold.test.js:136:1\n✖ ${HOLD} (37.886ms)\n  AssertionError: 2 !== 1`;
const RENAME_ANNOTATION = "  ✘ smoke test crashed: page.click: Timeout 30000ms exceeded.\n    waiting for locator('#sessionName')";

function run(id: number, conclusion: string, branch = 'main', attempt = 1) {
  return {
    id, run_number: id, run_attempt: attempt, head_branch: branch, head_sha: 'deadbeef',
    head_commit: { message: 'Fix the notifier\n\nDetails.' }, display_title: 'PR title',
    status: conclusion === 'in_progress' ? conclusion : 'completed', conclusion,
  };
}

function fixture(config: CiConfig | null = CONFIG) {
  let saved: unknown;
  const requests: { path: string; headers: Headers }[] = [];
  const bot: { target: string; event: CiEvent }[] = [];
  const push: typeof bot = [];
  const errors: string[] = [];
  const mock = {
    runs: [run(1, 'failure')],
    annotations: [HOLD_ANNOTATION],
    job: 'Backend (Node 24.x)',
    step: 'Backend, bridge and lifecycle tests',
    notModified: false,
    botDown: false,
    rateLimited: false,
  };
  const github: GitHubCi = createGitHubCi('test-token', {
    async fetch(input, init) {
      const { pathname } = new URL(String(input));
      requests.push({ path: pathname, headers: new Headers(init?.headers) });
      if (mock.rateLimited) return new Response(null, { status: 429, headers: { 'Retry-After': '3600' } });
      if (pathname === `/repos/${REPO}/actions/workflows`) return Response.json({ workflows: [{ id: 1, name: 'Tests' }] });
      if (pathname === `/repos/${REPO}/actions/workflows/1/runs`) {
        return mock.notModified ? new Response(null, { status: 304 }) :
          Response.json({ workflow_runs: mock.runs }, { headers: { etag: '"ci-runs"' } });
      }
      if (/\/actions\/runs\/\d+\/attempts\/\d+\/jobs$/.test(pathname)) {
        return Response.json({ jobs: [{ id: 20, name: mock.job, conclusion: 'failure', steps: [{ name: mock.step, conclusion: 'failure' }] }] });
      }
      if (pathname === `/repos/${REPO}/check-runs/20/annotations`) {
        return Response.json(mock.annotations.map(message => ({ annotation_level: 'failure', message })));
      }
      return new Response(null, { status: 404 });
    },
  });
  const create = () => createCiWatcher({
    config, github, load: () => saved, save: state => { saved = JSON.parse(JSON.stringify(state)); },
    deliverBot: async (target, event) => {
      if (mock.botDown) throw new Error('bot temporarily down');
      bot.push({ target, event });
    },
    notify: async (target, event) => { push.push({ target, event }); },
    log: message => { errors.push(message); },
  });
  return { create, mock, bot, push, requests, errors };
}

test('only the configured bot host polls GitHub, even with the same settings on a peer', async () => {
  assert.equal(readCiConfig({ bots: true }, 'hub-id'), null);
  assert.equal(readCiConfig({ ...SETTINGS, bots: false }, 'hub-id'), null);
  const peer = fixture(readCiConfig(SETTINGS, 'peer-id'));
  const hub = fixture();
  await Promise.all([peer.create().poll(), hub.create().poll()]);
  assert.deepEqual(peer.requests, []);
  assert.deepEqual(hub.requests.map(request => request.path), [
    `/repos/${REPO}/actions/workflows`, `/repos/${REPO}/actions/workflows/1/runs`,
  ]);
  assert.throws(() => readCiConfig({ bots: true, ciWatcher: { hostId: 'hub-id', repos: [{ repo: REPO }, { repo: REPO.toLowerCase() }] } }, 'hub-id'), /duplicate/);
});

test('publish failure metadata once per attempt, even after restart, and skip work on a 304', async () => {
  const { create, mock, bot, push, requests, errors } = fixture();
  const watcher = create();
  await watcher.poll();
  assert.equal(bot.length, 0, 'first poll does not replay historical failures');
  mock.runs.unshift(run(2, 'failure', 'feature'));
  await watcher.poll();
  assert.equal(bot.length, 1);
  assert.equal(bot[0].target, 'pi-dish');
  assert.deepEqual(bot[0].event, {
    id: 'ci:mrpink604/pi-dish:2:1', kind: 'failure', repo: REPO, workflow: 'Tests', branch: 'feature',
    sha: 'deadbeef', title: 'Fix the notifier', url: `https://github.com/${REPO}/actions/runs/2`,
    runId: 2, attempt: 1, jobs: ['Backend (Node 24.x)'], tests: [HOLD], likelyKnownFlake: true,
  });
  assert.deepEqual(push, bot);
  assert.equal(requests[0].headers.get('authorization'), 'Bearer test-token');
  const before304 = requests.length;
  mock.notModified = true;
  await watcher.poll();
  assert.equal(requests.length - before304, 1);
  assert.equal(requests.at(-1)?.headers.get('if-none-match'), '"ci-runs"');
  assert.deepEqual(errors, []);

  mock.notModified = false;
  const restarted = create();
  await restarted.poll();
  assert.equal(bot.length, 1);
  assert.equal(requests.filter(request => request.path.endsWith('/jobs')).length, 1);
  mock.runs[0] = run(2, 'failure', 'feature', 2);
  await restarted.poll();
  assert.deepEqual(bot.map(({ event }) => event.attempt), [1, 2]);
  assert.ok(requests.some(request => request.path.endsWith('/runs/2/attempts/2/jobs')));
});

test('recover only the failing branch, once, after a newer green result; ignore cancellation', async () => {
  const { create, mock, bot, push } = fixture();
  const watcher = create();
  mock.runs = [run(1, 'in_progress', 'main'), run(2, 'in_progress', 'feature')];
  await watcher.poll();
  mock.runs = [run(1, 'timed_out', 'main'), run(2, 'success', 'feature'), run(3, 'cancelled', 'main')];
  await watcher.poll();
  mock.runs.push(run(4, 'success'));
  await watcher.poll();
  mock.runs.push(run(5, 'success'));
  await watcher.poll();
  assert.deepEqual(bot.map(({ event }) => [event.kind, event.branch, event.runId, event.likelyKnownFlake]), [
    ['failure', 'main', 1, false], ['recovered', 'main', 4, false],
  ]);
  assert.deepEqual(push, bot);
});

test('retry a queued bot delivery after restart without repeating push, at the configured target', async () => {
  const config = readCiConfig({ bots: true, ciWatcher: { hostId: 'hub-id', repos: [{ repo: REPO, bot: 'release-bot', recovery: false }] } }, 'hub-id');
  const { create, mock, bot, push } = fixture(config);
  const watcher = create();
  await watcher.poll();
  mock.botDown = true;
  mock.runs.unshift(run(2, 'failure'));
  await watcher.poll();
  assert.equal(bot.length, 0);
  assert.deepEqual(push.map(delivery => delivery.target), ['release-bot']);
  mock.botDown = false;
  mock.runs.unshift(run(3, 'success'));
  await create().poll();
  assert.deepEqual(bot, push);
  assert.deepEqual(bot.map(({ event }) => event.kind), ['failure']);
});

test('label the smoke rename timeout only if no other failures are present', async () => {
  const { create, mock, bot } = fixture();
  const watcher = create();
  await watcher.poll();
  mock.job = 'Browser (Node 24)';
  mock.step = 'Run npm run test:ui 2>&1 | tee -a "$RUNNER_TEMP/browser.log"';
  mock.annotations = [RENAME_ANNOTATION];
  mock.runs.unshift(run(2, 'failure'));
  await watcher.poll();
  mock.annotations.push('✘  10 test/browser/foo.spec.js:12:4 › unrelated failing test (7.5s)');
  mock.runs.unshift(run(3, 'failure'));
  await watcher.poll();
  assert.deepEqual(bot.map(({ event }) => [event.likelyKnownFlake, ...event.tests]), [
    [true, '#sessionName rename timeout'],
    [false, '#sessionName rename timeout', 'test/browser/foo.spec.js:12:4 › unrelated failing test'],
  ]);
});

test('a rate limit on the first request suppresses later polls during the cooldown', async () => {
  const { create, mock, requests, errors } = fixture();
  mock.rateLimited = true;
  const watcher = create();
  await watcher.poll();
  await watcher.poll();
  assert.equal(requests.length, 1);
  assert.match(errors[0], /rate limited/);
});
