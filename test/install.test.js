'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const INSTALL = path.join(ROOT, 'install.sh');
const SKILLS = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  // Mirror install.sh: only directories carrying a SKILL.md are skills;
  // skills/lib is the shared CLI core and must not be linked.
  .filter(name => fs.existsSync(path.join(ROOT, 'skills', name, 'SKILL.md')))
  .sort();

function isolatedAgentDirs(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-install-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return {
    pi: path.join(temp, 'pi-agent'),
    omp: path.join(temp, 'omp-agent'),
    prime: path.join(temp, 'prime-agent'),
  };
}

function runInstall(dirs) {
  return spawnSync(INSTALL, ['--links-only'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PI_AGENT_DIR: dirs.pi,
      OMP_AGENT_DIR: dirs.omp,
      PRIME_AGENT_DIR: dirs.prime,
      // Keep the uv bootstrap out of the test: it must not touch the network
      // or the developer's real prime installation.
      PI_DISH_PRIME_COMMAND: '/nonexistent/prime-agent',
    },
    encoding: 'utf8',
  });
}

test('installer links the correct bridge and every skill into Pi and OMP', t => {
  const dirs = isolatedAgentDirs(t);
  const result = runInstall(dirs);
  assert.equal(result.status, 0, result.stderr);

  assert.equal(
    fs.readlinkSync(path.join(dirs.pi, 'extensions', 'pi-dish-bridge')),
    path.join(ROOT, 'extensions', 'pi-dish-bridge'),
  );
  assert.equal(
    fs.readlinkSync(path.join(dirs.omp, 'extensions', 'pi-dish-bridge-omp')),
    path.join(ROOT, 'extensions', 'pi-dish-bridge-omp'),
  );
  assert.equal(
    fs.readlinkSync(path.join(dirs.prime, 'extensions', 'pi-dish-bridge-prime')),
    path.join(ROOT, 'extensions', 'pi-dish-bridge-prime'),
  );
  // Prime resolves the wrapper's ../pi-dish-bridge/core.js import from the
  // symlink path, so the shared core must sit beside it; that stock bridge
  // stands down under prime hosts.
  assert.equal(
    fs.readlinkSync(path.join(dirs.prime, 'extensions', 'pi-dish-bridge')),
    path.join(ROOT, 'extensions', 'pi-dish-bridge'),
  );

  for (const agentDir of [dirs.pi, dirs.omp]) {
    for (const skill of SKILLS) {
      assert.equal(
        fs.readlinkSync(path.join(agentDir, 'skills', skill)),
        path.join(ROOT, 'skills', skill),
      );
    }
    assert.ok(
      !fs.existsSync(path.join(agentDir, 'skills', 'lib')),
      'the shared CLI core (skills/lib) must not be linked as a skill',
    );
  }
  // Skills stay linked into Pi and OMP only: the pi-dish skills are Pi/OMP
  // tooling and Prime's skill loading is not part of this integration.
  assert.ok(!fs.existsSync(path.join(dirs.prime, 'skills')));

  const repeated = runInstall(dirs);
  assert.equal(repeated.status, 0, repeated.stderr);
});

test('installer refuses to replace an existing non-symlink', t => {
  const dirs = isolatedAgentDirs(t);
  const destination = path.join(dirs.pi, 'extensions', 'pi-dish-bridge');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'owned.txt'), 'keep\n');

  const result = runInstall(dirs);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to replace non-symlink/);
  assert.equal(fs.readFileSync(path.join(destination, 'owned.txt'), 'utf8'), 'keep\n');
});
