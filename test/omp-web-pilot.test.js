const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-pilot-'));
const cwd = path.join(home, 'project');
const fixture = path.join(__dirname, 'fixtures', 'fake-pi.js');
fs.mkdirSync(path.join(home, '.omp', 'agent'), { recursive: true });
fs.mkdirSync(path.join(home, '.omp'), { recursive: true });
fs.mkdirSync(cwd, { recursive: true });

fs.writeFileSync(path.join(cwd, '.env'), [
  'export FIXTURE_PROJECT_API_KEY="project-value"',
  'FIXTURE_BLANK_API_KEY=""',
].join('\n') + '\n');
fs.writeFileSync(path.join(home, '.omp', 'agent', '.env'), 'ZAI_API_KEY=agent-value\n');
fs.writeFileSync(path.join(home, '.omp', '.env'), 'FIXTURE_CONFIG_API_KEY=config-value\n');
fs.writeFileSync(path.join(home, '.env'), 'FIXTURE_HOME_API_KEY=home-value\n');

process.env.HOME = home;
process.env.PORT = '0';
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-pilot-tmux-'));
process.env.PI_DISH_OMP_COMMAND = `env PI_FIXTURE_HARNESS=omp ${process.execPath} ${fixture}`;
process.env.FIXTURE_PROCESS_API_KEY = 'process-value';

const server = require('../server.js');
let base;

test.before(async () => {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(process.env.TMUX_TMPDIR, { recursive: true, force: true });
});

async function get(resource) {
  const response = await fetch(base + resource);
  return { status: response.status, body: await response.json() };
}

async function post(resource, body) {
  const response = await fetch(base + resource, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('OMP catalog preserves selector and per-model thinking while annotating readiness', async () => {
  const query = new URLSearchParams({ harness: 'omp', cwd });
  const { status, body } = await get(`/api/models?${query}`);
  assert.equal(status, 200);

  const flash = body.find(model => model.selector === 'zai/glm-4.7-flash');
  assert.deepEqual(flash.thinking, ['minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(flash.providerReady, true);
  assert.equal(flash.contextWindow, 200000);

  const restricted = body.find(model => model.selector === 'zai/glm-5.2');
  assert.deepEqual(restricted.thinking, ['high', 'max']);
  assert.equal(restricted.providerReady, true);

  const missing = body.find(model => model.provider === 'fixture-missing');
  assert.equal(missing.providerReady, false);
  assert.equal(Object.hasOwn(missing, 'credential'), false);
});

test('OMP readiness checks process env and every documented dotenv location without values', async () => {
  const query = new URLSearchParams({ cwd });
  const { status, body } = await get(`/api/harnesses/omp/readiness?${query}`);
  assert.equal(status, 200);
  assert.deepEqual(body.providers, {
    anthropic: false,
    zai: true,
    'fixture-project': true,
    'fixture-config': true,
    'fixture-home': true,
    'fixture-process': true,
    'fixture-missing': false,
    'fixture-blank': false,
  });
  assert.ok(Object.values(body.providers).every(value => typeof value === 'boolean'));
  assert.doesNotMatch(JSON.stringify(body), /API_KEY|project-value|agent-value|config-value|home-value|process-value/);
});

test('OMP config endpoint exposes only curated launch defaults', async () => {
  const query = new URLSearchParams({ cwd });
  const { status, body } = await get(`/api/harnesses/omp/config?${query}`);
  assert.equal(status, 200);
  assert.deepEqual(body, {
    defaultModel: 'zai/glm-4.7-flash',
    defaultThinkingLevel: 'high',
  });
});

test('OMP launch rejects a thinking level outside the selected model catalog entry', async () => {
  const invalid = await post('/api/sessions/new', {
    harness: 'omp', cwd, model: 'zai/glm-5.2', thinking: 'minimal', async: true,
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /valid levels: high, max/i);
});
