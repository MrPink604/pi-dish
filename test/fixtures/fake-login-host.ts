import * as fs from 'node:fs';
import * as path from 'node:path';
import { createBridge } from '../../extensions/pi-dish-bridge/core.js';
import { piLogin } from '../../extensions/pi-dish-bridge/pi-login.js';
import { createHarnessBridge } from '../../extensions/pi-dish-bridge-omp/index.js';

// Stands in for the two host login APIs the bridge adapts: Pi's private
// ModelRuntime (FAKE_LOGIN_PROFILE=pi) and OMP's authStorage.oauth (omp).
// Every host-side call is appended to FAKE_LOGIN_LOG as JSON lines.

type HostRecord = Record<PropertyKey, unknown>;
type HostHandler = (event: HostRecord, context: HostRecord) => unknown | Promise<unknown>;
type Interaction = {
  signal: AbortSignal;
  prompt(prompt: HostRecord): Promise<string>;
  notify(event: HostRecord): void;
};
type OmpCallbacks = {
  signal: AbortSignal;
  onAuth(info: HostRecord): void;
  onProgress(message: string): void;
  onManualCodeInput(signal?: AbortSignal): Promise<string>;
};

const logFile = process.env.FAKE_LOGIN_LOG!;
const log = (entry: HostRecord) => fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');

function stateOf(input: string): string | null {
  try { return new URL(input).searchParams.get('state'); } catch { return null; }
}

const piRuntime = {
  getProviders() {
    return [
      { id: 'fake', name: 'Fake', auth: { oauth: {}, apiKey: { login() {} } } },
      // Ambient-only api-key auth has no login(): not offered, like pi's TUI.
      { id: 'ambient', name: 'Ambient', auth: { apiKey: {} } },
    ];
  },
  getProviderAuthStatus(id: string) { return { configured: id === 'fake' }; },
  async login(id: string, type: string, interaction: Interaction) {
    log({ op: 'login', id, type });
    if (type === 'api_key') {
      log({ op: 'key', key: await interaction.prompt({ type: 'secret', message: 'API key:' }) });
      return;
    }
    interaction.notify({ type: 'auth_url', url: 'https://auth.example/pi?state=p1', instructions: 'Finish in the browser.' });
    const manual = new AbortController();
    const pasted = interaction.prompt({ type: 'manual_code', message: 'Paste the redirect URL:', placeholder: 'http://localhost:53692/callback', signal: manual.signal });
    // The loopback callback server answering first (the test sends SIGUSR2
    // once the paste step is visible) aborts the paste prompt.
    const callback = new Promise<string>(resolve => {
      process.once('SIGUSR2', () => resolve('http://localhost:53692/callback?code=c&state=p1'));
    });
    const input = await Promise.race([pasted, callback]);
    manual.abort();
    await pasted.catch(() => log({ op: 'manual-aborted' }));
    if (stateOf(input) !== 'p1') throw new Error('OAuth state mismatch');
    interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens...' });
  },
  async refresh(options: HostRecord) { log({ op: 'refresh', providers: options.providers }); },
};

const ompAuthModule = {
  getOAuthProviders() {
    return [
      { id: 'fake-oauth', name: 'Fake OAuth', available: true },
      { id: 'fake-fail', name: 'Fake Failure', available: true },
      { id: 'hidden', name: 'Hidden', available: false },
    ];
  },
  getOAuthCredentialProvider(id: string) { return id === 'fake-oauth' ? 'fake-models' : id; },
};

const ompRegistry = {
  async getAvailable() { return []; },
  async refreshProvider(id: string, mode: string) { log({ op: 'refresh', id, mode }); },
  authStorage: {
    oauth: {
      async login(id: string, callbacks: OmpCallbacks) {
        log({ op: 'login', id });
        if (id === 'fake-fail') throw new Error('provider exploded\n    at stack frame');
        callbacks.onAuth({ url: 'https://auth.example/omp?state=s1', instructions: 'Finish in the browser.' });
        try {
          // OMP keeps asking until a paste carries this login's state.
          for (;;) {
            const input = await callbacks.onManualCodeInput(callbacks.signal);
            log({ op: 'code', input });
            if (stateOf(input) === 's1') break;
          }
        } catch (error) {
          if (callbacks.signal.aborted) log({ op: 'aborted' });
          throw error;
        }
        callbacks.onProgress('Exchanging authorization code for tokens...');
        return { type: 'oauth', email: 'me@example.com' };
      },
    },
  },
};

const handlers = new Map<string, HostHandler[]>();
const pi = {
  on(event: string, handler: HostHandler) {
    handlers.set(event, [...handlers.get(event) || [], handler]);
  },
  registerCommand() {},
  getCommands() { return []; },
  getThinkingLevel() { return 'minimal'; },
  setThinkingLevel() {},
  setSessionName() {},
};

const sessionFile = process.env.FAKE_SESSION_FILE!;
fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
fs.writeFileSync(sessionFile, JSON.stringify({ type: 'session', id: 'fake-login', cwd: process.cwd() }) + '\n');

const profile = process.env.FAKE_LOGIN_PROFILE;
const ctx: HostRecord = {
  ui: {},
  cwd: process.cwd(),
  model: { provider: 'zai', id: 'glm-4.7-flash' },
  getContextUsage() { return { tokens: 100, contextWindow: 200000, percent: 0.05 }; },
  sessionManager: {
    getSessionFile() { return sessionFile; },
    getSessionId() { return 'fake-login'; },
  },
  modelRegistry: profile === 'pi' ? { async getAvailable() { return []; }, runtime: piRuntime } : ompRegistry,
  abort() {},
};

if (profile === 'pi') {
  createBridge({
    harnessId: 'pi', name: 'Fake Pi', hostVersion: 'test', wrapperVersion: 'test',
    eventProfile: [],
    capabilities: { prompt: true, commands: true, extensionUI: true, login: true },
    login: piLogin,
  })(pi);
} else {
  createHarnessBridge('fake-login-token', undefined, ompAuthModule)(pi);
}
for (const handler of handlers.get('session_start') || []) await handler({}, ctx);

for (let attempt = 0; attempt < 100; attempt++) {
  await new Promise<void>(resolve => setTimeout(resolve, 20));
}
async function shutdown(): Promise<void> {
  for (const handler of handlers.get('session_shutdown') || []) await handler({}, ctx);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
console.log('READY');
setInterval(() => {}, 1000);
