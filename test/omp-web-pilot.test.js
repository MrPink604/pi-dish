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

async function put(resource, body) {
  const response = await fetch(base + resource, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('OMP config endpoint exposes only curated launch defaults', async () => {
  const query = new URLSearchParams({ cwd });
  const { status, body } = await get(`/api/harnesses/omp/config?${query}`);
  assert.equal(status, 200);
  assert.deepEqual(body, {
    defaultModel: 'zai/glm-4.7-flash',
    defaultThinkingLevel: 'high',
    modelRoles: { default: 'zai/glm-4.7-flash' },
    globalModelRoles: { default: 'zai/glm-4.7-flash' },
  });
});

test('OMP config endpoint separates a project overlay from the global record', async () => {
  fs.mkdirSync(path.join(cwd, '.omp'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.omp', 'fake-project-roles.json'),
    JSON.stringify({ vision: 'zai/glm-5.2' }));
  const query = new URLSearchParams({ cwd });
  const { status, body } = await get(`/api/harnesses/omp/config?${query}`);
  assert.equal(status, 200);
  assert.equal(body.modelRoles.vision, 'zai/glm-5.2');
  assert.equal(Object.hasOwn(body.globalModelRoles, 'vision'), false);
});

test('OMP model-role PUT patches the global record without absorbing project overrides', async () => {
  const patched = await put('/api/harnesses/omp/model-roles', {
    cwd, roles: { default: 'zai/glm-5.2', smol: 'anthropic/claude-opus-4' },
  });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.body.globalModelRoles, {
    default: 'zai/glm-5.2', smol: 'anthropic/claude-opus-4',
  });
  // The project overlay still shadows `vision` in this cwd and — the no-leak
  // guarantee — never got copied into the global record.
  assert.equal(patched.body.modelRoles.vision, 'zai/glm-5.2');
  assert.equal(Object.hasOwn(patched.body.globalModelRoles, 'vision'), false);

  const reread = await get(`/api/harnesses/omp/config?${new URLSearchParams({ cwd })}`);
  assert.equal(reread.body.globalModelRoles.default, 'zai/glm-5.2');
  assert.equal(Object.hasOwn(reread.body.globalModelRoles, 'vision'), false);

  const unset = await put('/api/harnesses/omp/model-roles', { cwd, roles: { smol: null } });
  assert.equal(unset.status, 200);
  assert.deepEqual(unset.body.globalModelRoles, { default: 'zai/glm-5.2' });

  // Custom (non-canonical) role keys round-trip.
  const custom = await put('/api/harnesses/omp/model-roles', { roles: { 'my-role': 'zai/glm-4.7-flash' } });
  assert.equal(custom.status, 200);
  assert.equal(custom.body.globalModelRoles['my-role'], 'zai/glm-4.7-flash');
});

test('OMP model-role PUT serializes concurrent read-modify-writes', async () => {
  const [a, b] = await Promise.all([
    put('/api/harnesses/omp/model-roles', { roles: { commit: 'zai/glm-4.7-flash' } }),
    put('/api/harnesses/omp/model-roles', { roles: { tiny: 'zai/glm-5.2' } }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const { body } = await get('/api/harnesses/omp/config');
  assert.equal(body.globalModelRoles.commit, 'zai/glm-4.7-flash');
  assert.equal(body.globalModelRoles.tiny, 'zai/glm-5.2');
});

test('OMP model-role PUT validates the patch and is unsupported for pi', async () => {
  for (const roles of [null, 'default', ['default'], {}]) {
    const { status } = await put('/api/harnesses/omp/model-roles', { roles });
    assert.equal(status, 400);
  }
  assert.equal((await put('/api/harnesses/omp/model-roles', { roles: { '9bad': 'zai/glm-5.2' } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/model-roles', { roles: { default: '' } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/model-roles', { roles: { default: '  ' } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/model-roles', { roles: { default: 'x'.repeat(201) } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/model-roles', { roles: { default: 42 } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/model-roles', { cwd: 7, roles: { default: 'zai/glm-5.2' } })).status, 400);

  assert.equal((await put('/api/harnesses/nope/model-roles', { roles: { default: 'x' } })).status, 404);
  assert.equal((await put('/api/harnesses/pi/model-roles', { roles: { default: 'x' } })).status, 501);
});

test('OMP launch rejects a thinking level outside the selected model catalog entry', async () => {
  const invalid = await post('/api/sessions/new', {
    harness: 'omp', cwd, model: 'zai/glm-5.2', thinking: 'minimal', async: true,
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /valid levels: high, max/i);
});
