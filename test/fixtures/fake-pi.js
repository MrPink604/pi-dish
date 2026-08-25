#!/usr/bin/env node
/**
 * Test fixture standing in for the `pi` binary when spawned inside tmux by the
 * tmux.test.js suite. Reads PI_DISH_SPAWN_TOKEN (set via tmux `-e`), then —
 * unless PI_FIXTURE_NOREGISTER is set — writes a pi-dish-bridge-style registry
 * entry stamped with that token (plus a listening Unix socket and a dummy
 * session JSONL), exactly as the real bridge extension would. Then it sleeps so
 * its pid stays alive and its tmux pane stays open.
 */
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { processIdentity } = require('../../lib/process-identity');

const home = process.env.HOME || os.homedir();
const args = process.argv.slice(2);
const harnessId = process.env.PI_FIXTURE_HARNESS || 'pi';

// The OMP descriptor uses the same configured executable for short-lived
// catalog/config reads and long-lived TUI launches. Speak those CLI surfaces
// before entering the bridge-registration fixture below.
if (harnessId === 'omp' && args[0] === 'models' && args.includes('--json')) {
  if (process.env.PI_FIXTURE_MODEL_EVENTS_FILE) {
    fs.appendFileSync(process.env.PI_FIXTURE_MODEL_EVENTS_FILE, `start ${process.pid}\n`);
  }
  const model = (provider, id, thinking, name = id) => ({
    provider, id, selector: `${provider}/${id}`, name,
    contextWindow: id === 'glm-5.2' ? 1000000 : 200000,
    maxTokens: 32000, reasoning: Array.isArray(thinking) && thinking.length > 0,
    thinking, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  });
  fs.writeSync(1, JSON.stringify({ models: [
    model('anthropic', 'claude-opus-4', ['low', 'high'], 'Claude Opus 4'),
    model('zai', 'glm-4.7-flash', ['minimal', 'low', 'medium', 'high', 'xhigh'], 'GLM-4.7-Flash'),
    model('zai', 'glm-5.2', ['high', 'max'], 'GLM-5.2'),
    model('fixture-project', 'project-model', ['minimal']),
    model('fixture-config', 'config-model', ['low']),
    model('fixture-home', 'home-model', ['medium']),
    model('fixture-process', 'process-model', ['high']),
    model('fixture-missing', 'missing-model', null),
    model('fixture-blank', 'blank-model', null),
  ] }) + '\n');
  const lingerMs = Number(process.env.PI_FIXTURE_MODELS_LINGER_MS) || 0;
  if (lingerMs > 0) {
    setTimeout(() => {
      if (process.env.PI_FIXTURE_MODEL_EVENTS_FILE) {
        fs.appendFileSync(process.env.PI_FIXTURE_MODEL_EVENTS_FILE, `finish ${process.pid}\n`);
      }
      process.exit(0);
    }, lingerMs);
  } else {
    process.exit(0);
  }
  return;
}

// OMP's global config lives under $HOME; a project `.omp/config.yml` overlays
// it project-over-global for the invocation cwd only. Emulate both stores so
// the server's empty-tmpdir global read is observable in tests.
const fakeGlobalConfigFile = path.join(home, '.omp', 'agent', 'fake-config.json');
const readJsonFile = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
};

if (harnessId === 'omp' && args[0] === 'config' && args.includes('--json')) {
  const key = args[2];
  const baseRoles = { default: 'zai/glm-4.7-flash' };
  const globalRoles = { ...baseRoles, ...(readJsonFile(fakeGlobalConfigFile).modelRoles || {}) };
  if (args[1] === 'set') {
    if (key !== 'modelRoles') {
      fs.writeSync(2, `Setting is not writable: ${key}\n`);
      process.exit(1);
    }
    const stored = readJsonFile(fakeGlobalConfigFile);
    stored.modelRoles = JSON.parse(args[3]);
    fs.mkdirSync(path.dirname(fakeGlobalConfigFile), { recursive: true });
    fs.writeFileSync(fakeGlobalConfigFile, JSON.stringify(stored));
    fs.writeSync(1, JSON.stringify({ key, value: stored.modelRoles, type: 'record' }) + '\n');
    process.exit(0);
  }
  if (args[1] === 'get') {
    const projectRoles = readJsonFile(path.join(process.cwd(), '.omp', 'fake-project-roles.json'));
    const values = {
      modelRoles: { key, value: { ...globalRoles, ...projectRoles }, type: 'record', description: '' },
      defaultThinkingLevel: { key, value: 'high', type: 'enum', description: 'Reasoning depth' },
    };
    if (!values[key]) {
      fs.writeSync(2, `Unknown setting: ${key}\n`);
      process.exit(1);
    }
    fs.writeSync(1, JSON.stringify(values[key]) + '\n');
    process.exit(0);
  }
}

const extensionIndex = args.indexOf('--extension');
let wrapperToken = '';
if (extensionIndex >= 0 && args[extensionIndex + 1]) {
  try {
    const source = fs.readFileSync(args[extensionIndex + 1], 'utf8');
    const match = source.match(/createHarnessBridge\(("[a-f0-9]+")\)/);
    if (match) wrapperToken = JSON.parse(match[1]);
  } catch {}
}
const token = wrapperToken || process.env.PI_DISH_SPAWN_TOKEN || '';

// Prime's launcher/client is not its resident worker. Reproduce that split with
// a short-lived broker so the worker is genuinely reparented outside the tmux
// client tree. The unsafe-descendant mode deliberately skips the broker for a
// fail-closed lifecycle test.
if (harnessId === 'prime' && !process.env.PI_FIXTURE_PRIME_WORKER) {
  const workerEnv = { ...process.env, PI_FIXTURE_PRIME_WORKER: '1' };
  // A warm Prime daemon forwards the extension path but not arbitrary client
  // environment. The generated wrapper must carry the correlation token.
  delete workerEnv.PI_DISH_SPAWN_TOKEN;
  const childEnv = process.env.PI_FIXTURE_PRIME_BROKER
    ? workerEnv
    : process.env.PI_FIXTURE_PRIME_DESCENDANT_WORKER
      ? workerEnv
      : { ...process.env, PI_FIXTURE_PRIME_BROKER: '1' };
  const worker = spawn(process.execPath, [__filename, ...args], {
    detached: true,
    stdio: 'ignore',
    env: childEnv,
  });
  worker.unref();
  if (process.env.PI_FIXTURE_PRIME_BROKER) return;
  setInterval(() => {}, 1 << 30);
  return;
}

const sessionFlag = harnessId === 'pi' ? '--session' : '--resume';
const sessionIdx = args.indexOf(sessionFlag);
let sessionFile;
let sessionId;
if (sessionIdx >= 0 && args[sessionIdx + 1]) {
  sessionFile = args[sessionIdx + 1];
  sessionId = path.basename(sessionFile, '.jsonl');
} else {
  sessionId = '2026-07-09T00-00-00-' + (token.slice(0, 8) || 'newsess1');
  sessionFile = harnessId === 'prime'
    ? path.join(home, '.prime', 'agent', 'sessions', sessionId + '.jsonl')
    : path.join(home, harnessId === 'omp' ? '.omp' : '.pi', 'agent', 'sessions', 'proj', sessionId + '.jsonl');
}

// Never register — exercises the server's 30s spawn timeout path.
if (process.env.PI_FIXTURE_NOREGISTER) {
  if (process.env.PI_FIXTURE_SURVIVOR_FILE) {
    const child = spawn(process.execPath, ['-e', 'process.on("SIGHUP", () => {}); setInterval(() => {}, 1 << 30);'], {
      detached: true,
      stdio: 'ignore',
    });
    fs.writeFileSync(process.env.PI_FIXTURE_SURVIVOR_FILE, String(child.pid));
    child.unref();
  }
  setInterval(() => {}, 1 << 30);
} else {
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  if (!fs.existsSync(sessionFile)) {
    const header = JSON.stringify({ type: 'session', id: sessionId, cwd: process.cwd() });
    fs.writeFileSync(sessionFile, harnessId === 'omp'
      ? `${JSON.stringify({ type: 'title', title: 'OMP tmux spawn' })}\n${header}\n`
      : `${header}\n`);
  }

  const regDir = path.join(home, '.pi', 'dish', 'sessions');
  const sockDir = path.join(home, '.pi', 'dish', 'sockets');
  fs.mkdirSync(regDir, { recursive: true });
  fs.mkdirSync(sockDir, { recursive: true, mode: 0o700 });

  const socketPath = path.join(sockDir, `${harnessId}-${sessionId}.sock`);
  const bridgeInstanceId = `test-${token}`;
  const startTime = processIdentity(process.pid)?.startTime;
  const capabilities = {
    prompt: true, steer: true, followUp: true, abort: true,
    models: true, setModel: true, setThinking: true, rename: true,
    commands: true, reload: false, queueCancel: false, treeNavigation: false,
  };
  try { fs.unlinkSync(socketPath); } catch {}
  const srv = net.createServer((sock) => {
    sock.write(JSON.stringify(harnessId === 'pi'
      ? { type: 'hello', turnInProgress: false }
      : {
          type: 'hello',
          protocolVersion: 2,
          wrapper: { harnessId, name: harnessId, wrapperVersion: 'test' },
          harnessId,
          nativeSessionId: sessionId,
          sessionId,
          sessionFile,
          bridgeInstanceId,
          instanceId: bridgeInstanceId,
          pid: process.pid,
          startTime,
          socketPath,
          spawnToken: token,
          capabilities: process.env.PI_FIXTURE_HELLO_MISMATCH
            ? { ...capabilities, reload: true }
            : capabilities,
          turnInProgress: false,
        }) + '\n');
    // Answer commands like an *old* bridge: command discovery works, but
    // run_command is unknown. This lets tmux.test.js verify both discovery of
    // pane-backed commands and the server's send-keys fallbacks — leaving
    // commands unanswered would instead hang callers for the full
    // BridgeSession timeout.
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === undefined) continue;
        let response;
        if (msg.command === 'get_commands') {
          response = { type: 'response', id: msg.id, success: true, data: { commands: [] } };
        } else if (msg.command === 'set_session_name') {
          response = { type: 'response', id: msg.id, success: true };
        } else {
          response = { type: 'response', id: msg.id, success: false, error: `unknown command: ${msg.command}` };
        }
        sock.write(JSON.stringify(response) + '\n');
      }
    });
    sock.on('error', () => {});
  });

  // Log whatever lands on stdin (tmux send-keys types into this pane) so
  // tests can assert keystrokes actually reached the pi TUI stand-in.
  try {
    process.stdin.on('data', (chunk) => {
      fs.appendFileSync(sessionFile + '.keys', chunk.toString());
    });
  } catch {}
  const register = () => {
    srv.listen(socketPath, () => {
      const registryName = harnessId === 'pi' ? `${sessionId}.json` : `${harnessId}-${sessionId}-${token}.json`;
      fs.writeFileSync(path.join(regDir, registryName), JSON.stringify({
        ...(harnessId === 'pi' ? {} : {
          protocolVersion: 2,
          wrapper: { harnessId, name: harnessId, wrapperVersion: 'test' },
          harnessId,
          nativeSessionId: sessionId,
          bridgeInstanceId,
          instanceId: bridgeInstanceId,
          capabilities,
        }),
        sessionId,
        sessionFile,
        cwd: process.cwd(),
        pid: process.pid,
        ...(process.env.PI_FIXTURE_INCOMPLETE_CLAIM ? {} : { startTime }),
        socketPath,
        name: 'tmux spawn',
        model: 'anthropic/claude-opus-4',
        launchArgs: args,
        spawnToken: token,
      }));
    });
  };
  const registerDelay = Number(process.env.PI_FIXTURE_REGISTER_DELAY_MS) || 0;
  if (registerDelay > 0) setTimeout(register, registerDelay);
  else register();
  setInterval(() => {}, 1 << 30);
}
