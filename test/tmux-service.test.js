'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const MANAGER = path.join(ROOT, 'scripts', 'pi-dish-tmux.sh');

test('tmux service manager ignores the caller tmux socket', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-tmux-service-'));
  const bin = path.join(temp, 'bin');
  const log = path.join(temp, 'tmux-env.log');
  fs.mkdirSync(bin);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\nif [ "\${TMUX+x}" = x ]; then\n  printf 'set:%s\\n' "$TMUX" >> "$TMUX_LOG"\nelse\n  printf 'unset\\n' >> "$TMUX_LOG"\nfi\nexit 0\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const result = spawnSync(MANAGER, ['status'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TMUX: '/tmp/tmux-1000/other,123,0',
      TMUX_LOG: log,
      HOST: '127.0.0.1',
      PORT: '3333',
      PI_DISH_TMUX_SESSION: 'test-service',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['unset']);
});
