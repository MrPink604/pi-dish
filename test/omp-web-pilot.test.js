const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-pilot-'));
const cwd = path.join(home, 'project');
const fixture = path.join(__dirname, 'fixtures', 'fake-pi.js');
const modelEventsFile = path.join(home, 'model-events.log');
fs.mkdirSync(path.join(home, '.omp', 'agent'), { recursive: true });
fs.mkdirSync(path.join(home, '.omp'), { recursive: true });
fs.mkdirSync(cwd, { recursive: true });


process.env.HOME = home;
process.env.PORT = '0';
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-pilot-tmux-'));
process.env.PI_DISH_OMP_COMMAND = `env PI_FIXTURE_HARNESS=omp ${process.execPath} ${fixture}`;
process.env.PI_FIXTURE_MODEL_EVENTS_FILE = modelEventsFile;
process.env.PI_FIXTURE_MODELS_LINGER_MS = '1000';

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

test('OMP catalog preserves the command\'s authoritative availability list', async () => {
  const query = new URLSearchParams({ harness: 'omp', cwd });
  const { status, body } = await get(`/api/models?${query}`);
  assert.equal(status, 200);

  const events = fs.readFileSync(modelEventsFile, 'utf8').trim().split('\n');
  assert.equal(events.filter(event => event.startsWith('start ')).length, 1);
  assert.equal(events.filter(event => event.startsWith('finish ')).length, 0,
    'complete model JSON is accepted without waiting for a lingering CLI');

  const flash = body.find(model => model.selector === 'zai/glm-4.7-flash');
  assert.deepEqual(flash.thinking, ['minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(Object.hasOwn(flash, 'providerReady'), false);
  assert.equal(flash.contextWindow, 200000);

  const restricted = body.find(model => model.selector === 'zai/glm-5.2');
  assert.deepEqual(restricted.thinking, ['high', 'max']);
  assert.equal(Object.hasOwn(restricted, 'providerReady'), false);

  const commandListed = body.find(model => model.provider === 'fixture-missing');
  assert.ok(commandListed);
  assert.equal(Object.hasOwn(commandListed, 'providerReady'), false);
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

test('OMP agents endpoint lists definitions per source with global and effective settings', async () => {
  // A user definition overrides the bundled one of the same name; a project
  // definition adds a row that only exists in this cwd.
  fs.mkdirSync(path.join(home, '.omp', 'agent', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.omp', 'agent', 'agents', 'scout.md'),
    '---\nname: scout\ndescription: My scout\nmodel: openai/gpt-5\n---\n');
  fs.mkdirSync(path.join(cwd, '.omp', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.omp', 'agents', 'porter.md'),
    '---\nname: porter\ndescription: Project porter\nthinkingLevel: high\n---\n');
  fs.writeFileSync(path.join(cwd, '.omp', 'fake-project-agents.json'),
    JSON.stringify({ 'task.disabledAgents': ['porter'] }));

  const { status, body } = await get(`/api/harnesses/omp/agents?${new URLSearchParams({ cwd })}`);
  assert.equal(status, 200);
  assert.deepEqual(body.agents.map(agent => [agent.name, agent.source]), [
    ['porter', 'project'], ['reviewer', 'bundled'], ['scout', 'user'],
  ]);
  const scout = body.agents.find(agent => agent.name === 'scout');
  assert.equal(scout.description, 'My scout');
  assert.equal(scout.model, 'openai/gpt-5');
  assert.equal(body.agents.find(agent => agent.name === 'reviewer').model, '@slow');
  assert.equal(body.agents.find(agent => agent.name === 'porter').thinkingLevel, 'high');
  // The project overlay disables an agent only in this directory, so it shows
  // up as effective without polluting the editable global record.
  assert.deepEqual(body.settings.disabled, ['porter']);
  assert.deepEqual(body.globalSettings.disabled, []);
});

test('OMP agents PUT patches only the records the caller moved', async () => {
  const first = await put('/api/harnesses/omp/agents', {
    cwd, agents: { scout: { disabled: true, model: 'zai/glm-5.2', prewalk: true } },
  });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.globalSettings.disabled, ['scout']);
  assert.deepEqual(first.body.globalSettings.modelOverrides, { scout: 'zai/glm-5.2' });
  assert.deepEqual(first.body.globalSettings.prewalk, { scout: true });
  assert.deepEqual(first.body.globalSettings.advisor, {});
  // The project overlay stays out of the global record it just rewrote.
  assert.deepEqual(first.body.settings.disabled, ['scout', 'porter']);

  // null drops an override back to inherited; false is a real stored value.
  const second = await put('/api/harnesses/omp/agents', {
    cwd, agents: { scout: { model: null, prewalk: false }, reviewer: { advisor: true } },
  });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.globalSettings.modelOverrides, {});
  assert.deepEqual(second.body.globalSettings.prewalk, { scout: false });
  assert.deepEqual(second.body.globalSettings.advisor, { reviewer: true });
  assert.deepEqual(second.body.globalSettings.disabled, ['scout'], 'an untouched record is left alone');

  const reenabled = await put('/api/harnesses/omp/agents', { agents: { scout: { disabled: false } } });
  assert.equal(reenabled.status, 200);
  assert.deepEqual(reenabled.body.globalSettings.disabled, []);
});

test('OMP agents PUT validates the patch and is unsupported for pi', async () => {
  for (const agents of [null, 'scout', ['scout'], {}]) {
    assert.equal((await put('/api/harnesses/omp/agents', { agents })).status, 400);
  }
  assert.equal((await put('/api/harnesses/omp/agents', { agents: { '-bad': {} } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/agents', { agents: { scout: 'off' } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/agents', { agents: { scout: { disabled: 'yes' } } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/agents', { agents: { scout: { prewalk: 1 } } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/agents', { agents: { scout: { model: '' } } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/agents', { agents: { scout: { model: 'x'.repeat(201) } } })).status, 400);
  assert.equal((await put('/api/harnesses/omp/agents', { cwd: 7, agents: { scout: { disabled: true } } })).status, 400);

  assert.equal((await put('/api/harnesses/nope/agents', { agents: { scout: { disabled: true } } })).status, 404);
  assert.equal((await put('/api/harnesses/pi/agents', { agents: { scout: { disabled: true } } })).status, 501);
  assert.equal((await get('/api/harnesses/pi/agents')).status, 501);
});

test('OMP launch rejects a thinking level outside the selected model catalog entry', async () => {
  const invalid = await post('/api/sessions/new', {
    harness: 'omp', cwd, model: 'zai/glm-5.2', thinking: 'minimal', async: true,
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /valid levels: high, max/i);
  assert.equal(fs.readFileSync(modelEventsFile, 'utf8').trim().split('\n').length, 1,
    'launch validation reuses the catalog loaded by the new-session view');
});
