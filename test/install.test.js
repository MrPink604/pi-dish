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
  .sort();

function isolatedAgentDirs(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-install-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return {
    pi: path.join(temp, 'pi-agent'),
    omp: path.join(temp, 'omp-agent'),
  };
}

function runInstall(dirs) {
  return spawnSync(INSTALL, ['--links-only'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PI_AGENT_DIR: dirs.pi,
      OMP_AGENT_DIR: dirs.omp,
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

  for (const agentDir of [dirs.pi, dirs.omp]) {
    for (const skill of SKILLS) {
      assert.equal(
        fs.readlinkSync(path.join(agentDir, 'skills', skill)),
        path.join(ROOT, 'skills', skill),
      );
    }
  }

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
