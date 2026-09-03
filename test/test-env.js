/**
 * The environment every test process must start from.
 *
 * pi-dish is normally launched by a wrapper (`scripts/pi-dish-tmux.sh`) that
 * exports the operator's real deployment into the shell: `HOST` (often a
 * tailnet address), `PORT`, `PI_DISH_SHARE_PORT`, `PI_DISH_URL`, a token…
 * Run `npm test` from that shell and every suite that boots server.js
 * inherits it — the test server binds the tailnet address while the suite
 * fetches 127.0.0.1 (hundreds of `fetch failed`), or its share listener
 * collides with the running deployment's (`EADDRINUSE 3334`). Both looked
 * like product failures and neither was.
 *
 * So the harness owns its environment: everything `PI_DISH_*` is stripped
 * unless it names a *host binary or an opt-out* (a suite that wants a knob
 * sets it itself, right before requiring the server), and the bind target is
 * pinned to an ephemeral loopback port.
 */
const fs = require('fs');
const path = require('path');

// Kept because they point the suite at real host tooling or turn a suite off;
// nothing here can retarget or rebind the server under test.
const KEEP = new Set([
  'PI_DISH_SKIP_INTEGRATION',
  'PI_DISH_PI_COMMAND',
  'PI_DISH_OMP_COMMAND',
  'PI_DISH_PRIME_COMMAND',
  'PI_DISH_REAL_OMP_BIN',
  'PI_DISH_REAL_PRIME_BIN',
  'PI_DISH_REAL_BUN_BIN_DIR',
]);

// Not PI_DISH_-prefixed, but read straight by server.js at listen time.
const DROP = ['HOST', 'PORT'];

/**
 * bun is a *test dependency*: the OMP bridge suites run the extension under
 * the host it actually ships on (test/fixtures/fake-omp-bridge-host.ts). Its
 * standard install is `~/.bun/bin`, which a login shell exports and a
 * non-interactive one does not — the whole OMP bridge file then fails with
 * `spawn bun ENOENT`, which reads as ten broken product tests. Only ever
 * *added*, and only when nothing named bun is already resolvable.
 */
function withBunOnPath(env) {
  const executable = (dir) => {
    try { fs.accessSync(path.join(dir, 'bun'), fs.constants.X_OK); return true; } catch { return false; }
  };
  const entries = (env.PATH || '').split(path.delimiter).filter(Boolean);
  if (entries.some(executable)) return env;
  const found = [
    env.BUN_INSTALL && path.join(env.BUN_INSTALL, 'bin'),
    env.HOME && path.join(env.HOME, '.bun', 'bin'),
  ].filter(Boolean).find(executable);
  if (found) env.PATH = [found, ...entries].join(path.delimiter);
  return env;
}

/** A copy of `env` a test process can safely boot server.js from. */
function sanitizeTestEnv(env = process.env) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.startsWith('PI_DISH_') && !KEEP.has(key)) delete next[key];
  }
  for (const key of DROP) delete next[key];
  // Loopback + ephemeral: a test listener must never be reachable off-box and
  // must never contend for the deployment's port.
  next.HOST = '127.0.0.1';
  next.PORT = '0';
  return withBunOnPath(next);
}

/** Same, applied to this process (for suites that boot the server in-process). */
function applyTestEnv() {
  const sanitized = sanitizeTestEnv(process.env);
  for (const key of Object.keys(process.env)) {
    if (!(key in sanitized)) delete process.env[key];
  }
  Object.assign(process.env, sanitized);
  return process.env;
}

module.exports = { sanitizeTestEnv, applyTestEnv, KEEP, DROP, TEST_ENV_FILE: path.basename(__filename) };
