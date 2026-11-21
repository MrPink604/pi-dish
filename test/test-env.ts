/**
 * The environment every test process starts from: the operator's deployment
 * variables (tailnet HOST, PORT, share port, token) must not reach a suite that
 * boots server.js, and the bind target is pinned to an ephemeral loopback port.
 */
import fs = require('fs');
import os = require('os');
import path = require('path');
import { createHash } from 'node:crypto';
import { processIdentity } from '../lib/process-identity.js';

const OWNER = '.pi-dish-test-owner';
const STALE_MS = 60 * 60_000;
const TEMP_DIRS = new Set<string>();
const SCANNED_TMP = new Set<string>();

// Exact mkdtemp prefixes from the test runners, including pre-owner-marker
// releases. Do not match arbitrary pi-dish-* deployment or user directories.
const TEST_PREFIXES = new Set(`
acp-session agy-import dish-bounce dish-multi dish-omp dish-policy
dish-policy-git dish-policy-js dish-policy-shell dish-prime-daemon dish-recovery
dish-recovery-private dish-recovery-runner dish-skill-ingress dish-source dish-source-private
pd-frames pd-home pd-int pd-lineage-real pd-native pd-native-boundary pd-pi-private
pd-test pd-tmux pd-tt prime-daemon-test
pi-dish-acp-img pi-dish-acp-out pi-dish-acp-reconcile pi-dish-agy pi-dish-agy-brain pi-dish-agy-life
pi-dish-artifacts pi-dish-artifacts-tmux pi-dish-bot pi-dish-bot-restart pi-dish-bots pi-dish-bots-dir
pi-dish-bridge-test pi-dish-browser pi-dish-browser-build pi-dish-cl pi-dish-cli-bounds
pi-dish-cli-bounds-tmux pi-dish-comments-alt pi-dish-comments-cli pi-dish-comments-help
pi-dish-core-build pi-dish-core-home pi-dish-discovery pi-dish-drm pi-dish-edge-build
pi-dish-edge-client pi-dish-fake-tmux pi-dish-fleet pi-dish-fleet-bin pi-dish-fleet-tmux
pi-dish-gd pi-dish-hibernation pi-dish-host pi-dish-host-tmux pi-dish-idx pi-dish-install
pi-dish-knowledge pi-dish-listener pi-dish-login-omp pi-dish-login-pi pi-dish-mention
pi-dish-message-hold pi-dish-npm pi-dish-omp-compact pi-dish-omp-export-fail pi-dish-omp-export-test
pi-dish-omp-native pi-dish-omp-pilot pi-dish-omp-pilot-tmux pi-dish-omp-side-chat
pi-dish-omp-tree-acquisition-timeout pi-dish-omp-tree-cancel-branch pi-dish-omp-tree-cancel-navigate
pi-dish-omp-tree-invalid-node pi-dish-omp-tree-missing-command-api pi-dish-omp-tree-missing-tree-api
pi-dish-omp-tree-no-shortcut pi-dish-omp-tree-normal pi-dish-omp-tree-operation-timeout
pi-dish-omp-tree-parent-cycle pi-dish-omp-tree-projection pi-dish-path pi-dish-pricing
pi-dish-pricing-agy pi-dish-pricing-card pi-dish-pricing-missing pi-dish-pricing-operation
pi-dish-pricing-plan pi-dish-pricing-recorded pi-dish-pricing-timeout pi-dish-provenance
pi-dish-push pi-dish-racy-prune pi-dish-routines-api pi-dish-routines-test pi-dish-rpc-test
pi-dish-service pi-dish-session-attach pi-dish-session-cli pi-dish-sf pi-dish-shots
pi-dish-skill-fleet pi-dish-skill-fleet-tmux pi-dish-skills-cli pi-dish-skills-cli-tmux
pi-dish-switch-omp pi-dish-switch-pi pi-dish-term-test pi-dish-test pi-dish-test-tmux
pi-dish-testenv pi-dish-ui pi-dish-ui-remote pi-dish-ui-remote-tmux pi-dish-ui-tmux
pi-dish-vault pi-dish-vault-cli`.trim().split(/\s+/));

function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
  } catch (error) {
    console.warn(`Could not remove test temp directory ${dir}:`, error);
  }
}

// An unreadable or malformed owner is not proof that a run is dead. For a
// valid marker, compare Linux start ticks, not just the potentially reused PID.
function readTempOwner(dir: string): 'legacy' | 'live' | 'dead' {
  try {
    const file = path.join(dir, OWNER);
    if (!fs.lstatSync(file).isFile()) return 'live';
    const match = /^([1-9]\d*) (\d+)\n$/.exec(fs.readFileSync(file, 'utf8'));
    if (!match) return 'live';
    const pid = Number(match[1]);
    const identity = processIdentity(pid);
    if (identity) return identity.startTime === match[2] ? 'live' : 'dead';
    try { process.kill(pid, 0); return 'live'; } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'live';
    }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'legacy' : 'live';
  }
}

function reapTestTempDirs(base: string): void {
  // /proc supplies both exact owner identities and a conservative compatibility
  // check for unmarked directories from older checkouts.
  if (process.platform !== 'linux' || !process.getuid) return;
  const uid = process.getuid();
  const cutoff = Date.now() - STALE_MS;
  const candidates = new Map<string, 'legacy' | 'dead'>();
  for (const name of fs.readdirSync(base)) {
    const match = /^(.+)-[a-zA-Z0-9]{6}$/.exec(name);
    if (!match || !TEST_PREFIXES.has(match[1])) continue;
    const dir = path.join(base, name);
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.uid !== uid || stat.mtimeMs > cutoff) continue;
    const owner = readTempOwner(dir);
    if (owner !== 'live') candidates.set(dir, owner);
  }
  if (!candidates.size) return;

  let legacyBusy = false;
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    const proc = `/proc/${pid}`;
    if (fs.statSync(proc, { throwIfNoEntry: false })?.uid !== uid) continue;
    try {
      const argv = fs.readFileSync(`${proc}/cmdline`, 'utf8').split('\0');
      // Legacy Node processes may change HOME in-process, which /proc/environ
      // does not reflect. Defer unmarked cleanup while such a runner is alive.
      if (argv.some(arg => arg === '--test' ||
        /(?:^|\/)(?:[^/]+\.test|ui-smoke|remote-server-host|browser-server|run-tests|run-ui-scenarios|readme-shots|native-extensions\.smoke|test-real-lineage-harnesses|workerProcessEntry)\.js$|(?:^|\/)playwright$/.test(arg))) {
        legacyBusy = true;
      }
      // A subprocess may have survived a killed runner. Don't remove a
      // directory that another process inherited, even after the owner died.
      const env = fs.readFileSync(`${proc}/environ`, 'utf8');
      for (const ref of env.matchAll(/(?:^|\0)(?:HOME|TMPDIR|TMUX_TMPDIR)=([^\0]+)/g)) {
        for (let dir = path.resolve(ref[1]); dir !== path.dirname(dir); dir = path.dirname(dir)) {
          candidates.delete(dir);
          if (dir === base) break;
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ESRCH' && code !== 'EACCES') throw error;
    }
  }
  for (const [dir, owner] of candidates) {
    if (owner === 'dead' || !legacyBusy) removeTempDir(dir);
  }
}

function createTestTempDir(prefix: string): string {
  const base = fs.realpathSync(os.tmpdir());
  if (!SCANNED_TMP.has(base)) {
    reapTestTempDirs(base);
    SCANNED_TMP.add(base);
  }
  const dir = fs.mkdtempSync(path.join(base, prefix));
  try {
    const owner = processIdentity(process.pid);
    if (owner) fs.writeFileSync(path.join(dir, OWNER), `${owner.pid} ${owner.startTime}\n`, { flag: 'wx' });
  } catch (error) {
    removeTempDir(dir);
    throw error;
  }
  if (!TEMP_DIRS.size) process.once('exit', () => {
    for (const dir of TEMP_DIRS) removeTempDir(dir);
  });
  TEMP_DIRS.add(dir);
  return dir;
}

function exitOnTestSignals(): void {
  process.once('SIGINT', () => setImmediate(() => process.exit(130)));
  process.once('SIGTERM', () => setImmediate(() => process.exit(143)));
}

function shareOmpTestNatives(executable: string, home: string): string {
  // The compiled OMP loader honors PI_NATIVES_DIR and manages versioned
  // extraction there. Keep test builds separate from the operator's cache and
  // from each other: OMP can prune older versions on successful load.
  const binary = fs.statSync(executable);
  const key = createHash('sha256')
    .update(`${binary.dev}:${binary.ino}:${binary.size}:${binary.mtimeMs}`).digest('hex');
  const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const natives = path.resolve(cache, 'pi-dish', 'omp-test-natives', key);
  fs.mkdirSync(natives, { recursive: true, mode: 0o700 });
  // Older compiled builds don't honor PI_NATIVES_DIR.
  const ompHome = path.join(home, '.omp');
  fs.mkdirSync(ompHome, { recursive: true });
  fs.symlinkSync(natives, path.join(ompHome, 'natives'), 'dir');
  return natives;
}

const fakeOmpModelsCommand = `env OMP_FIXTURE=1 "${process.execPath}" "${path.join(__dirname, 'fixtures', 'fake-omp-models.js')}"`;

let isolatedHarnessPaths: string | undefined;

// Each names a host binary or opts a suite out; none can retarget the server.
const KEEP: Record<string, true> = {
  PI_DISH_SKIP_INTEGRATION: true,
  PI_DISH_PI_COMMAND: true,
  PI_DISH_OMP_COMMAND: true,
  PI_DISH_PRIME_COMMAND: true,
  PI_DISH_REAL_OMP_BIN: true,
  PI_DISH_REAL_PRIME_BIN: true,
  PI_DISH_REAL_BUN_BIN_DIR: true,
};

// Read straight by server.js at listen time. XDG_STATE_HOME locates the
// private-session root; dropped, it follows each suite's temp HOME, so no test
// reads the operator's private transcripts.
const DROP = ['HOST', 'PORT', 'XDG_STATE_HOME'];

// The OMP bridge suites spawn `bun`, which a non-interactive shell does not
// find in its usual `~/.bun/bin`.
function withBunOnPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const executable = (dir: string): boolean => {
    try { fs.accessSync(path.join(dir, 'bun'), fs.constants.X_OK); return true; } catch { return false; }
  };
  const entries = (env.PATH || '').split(path.delimiter).filter(Boolean);
  if (entries.some(executable)) return env;
  const found = [
    env.BUN_INSTALL && path.join(env.BUN_INSTALL, 'bin'),
    env.HOME && path.join(env.HOME, '.bun', 'bin'),
  ].filter((dir): dir is string => Boolean(dir)).find(executable);
  if (found) env.PATH = [found, ...entries].join(path.delimiter);
  return env;
}

function sanitizeTestEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.startsWith('PI_DISH_') && KEEP[key] !== true) delete next[key];
  }
  for (const key of DROP) delete next[key];
  // Prime live rows come from a resident daemon socket outside HOME, and `agy`
  // `/usage` probes a host binary on PATH; pin nonexistent paths so no test
  // touches the operator's live daemon or Antigravity account unless opted in.
  const isolated = isolatedHarnessPaths ??= createTestTempDir('dish-prime-daemon-');
  next.PRIME_AGENT_DAEMON_SOCKET = path.join(isolated, 'daemon.sock');
  next.PI_DISH_AGY_COMMAND = path.join(isolated, 'no-agy');
  // A server a suite boots never starts a bot relay (or its model).
  next.PI_DISH_BOTS = 'off';
  next.HOST = '127.0.0.1';
  next.PORT = '0';
  return withBunOnPath(next);
}

function applyTestEnv(): NodeJS.ProcessEnv {
  const sanitized = sanitizeTestEnv(process.env);
  for (const key of Object.keys(process.env)) {
    if (!(key in sanitized)) delete process.env[key];
  }
  Object.assign(process.env, sanitized);
  return process.env;
}

export { sanitizeTestEnv, applyTestEnv, createTestTempDir, exitOnTestSignals, shareOmpTestNatives, fakeOmpModelsCommand };
