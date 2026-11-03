'use strict';

import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import test = require('node:test');
import type { TestContext } from 'node:test';

interface AgentDirectories {
  pi: string;
  omp: string;
  prime: string;
}

const ROOT = path.resolve(__dirname, '..');
const INSTALL = path.join(ROOT, 'install.sh');
const SKILLS = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  // Mirror install.sh: only directories carrying a SKILL.md are skills;
  // skills/lib is the shared CLI core and must not be linked.
  .filter(name => fs.existsSync(path.join(ROOT, 'skills', name, 'SKILL.md')))
  .sort();

function isolatedAgentDirs(t: TestContext): AgentDirectories {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-install-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return {
    pi: path.join(temp, 'pi-agent'),
    omp: path.join(temp, 'omp-agent'),
    prime: path.join(temp, 'prime-agent'),
  };
}

function runInstall(dirs: AgentDirectories): SpawnSyncReturns<string> {
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

test('installer links the correct bridge and every skill into Pi, OMP and Prime', t => {
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
  // Prime 0.10 has no extension loader, so the installer must not plant a
  // Prime bridge link at all.
  assert.ok(!fs.existsSync(path.join(dirs.prime, 'extensions', 'pi-dish-bridge-prime')));
  assert.ok(!fs.existsSync(path.join(dirs.prime, 'extensions', 'pi-dish-bridge')));

  for (const agentDir of [dirs.pi, dirs.omp, dirs.prime]) {
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

  const repeated = runInstall(dirs);
  assert.equal(repeated.status, 0, repeated.stderr);
});

test('installer removes stale Prime bridge links that resolve into this checkout only', t => {
  const dirs = isolatedAgentDirs(t);
  const extensions = path.join(dirs.prime, 'extensions');
  fs.mkdirSync(extensions, { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'extensions', 'pi-dish-bridge-prime'), path.join(extensions, 'pi-dish-bridge-prime'));
  fs.symlinkSync(path.join(ROOT, 'extensions', 'pi-dish-bridge'), path.join(extensions, 'pi-dish-bridge'));
  // A user's own file, a user link to somewhere else, and a directory named
  // like the retired wrapper must all survive.
  fs.writeFileSync(path.join(extensions, 'owned.txt'), 'keep\n');
  const userTarget = path.join(dirs.prime, 'user-extension');
  fs.mkdirSync(userTarget);
  fs.symlinkSync(userTarget, path.join(extensions, 'my-extension'));
  fs.mkdirSync(path.join(extensions, 'pi-dish-bridge-user'));

  const result = runInstall(dirs);
  assert.equal(result.status, 0, result.stderr);

  assert.equal(fs.existsSync(path.join(extensions, 'pi-dish-bridge-prime')), false);
  assert.equal(fs.existsSync(path.join(extensions, 'pi-dish-bridge')), false);
  assert.equal(fs.readFileSync(path.join(extensions, 'owned.txt'), 'utf8'), 'keep\n');
  assert.equal(fs.readlinkSync(path.join(extensions, 'my-extension')), userTarget);
  assert.ok(fs.existsSync(path.join(extensions, 'pi-dish-bridge-user')));
});

test('installer refuses to replace an existing non-symlink', t => {
  const dirs = isolatedAgentDirs(t);
  const destination = path.join(dirs.pi, 'extensions', 'pi-dish-bridge');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'owned.txt'), 'keep\n');

  const result = runInstall(dirs);
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(path.join(destination, 'owned.txt'), 'utf8'), 'keep\n');
});
