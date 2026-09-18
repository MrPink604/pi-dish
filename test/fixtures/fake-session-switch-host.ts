import * as fs from 'node:fs';
import * as path from 'node:path';
import { createBridge, type BridgeDescriptor } from '../../extensions/pi-dish-bridge/core.js';
import { createHarnessBridge } from '../../extensions/pi-dish-bridge-omp/index.js';

const profile = process.env.FAKE_SWITCH_PROFILE || 'omp';
const oldFile = process.env.FAKE_SWITCH_OLD_FILE!;
const newFile = process.env.FAKE_SWITCH_NEW_FILE!;
const marker = process.env.FAKE_SWITCH_MARKER!;
let currentFile = oldFile;

fs.mkdirSync(path.dirname(oldFile), { recursive: true });
fs.writeFileSync(oldFile, JSON.stringify({ type: 'session', id: path.basename(oldFile, '.jsonl'), cwd: process.cwd() }) + '\n');

type HostEvent = Readonly<Record<string, unknown>>;
interface SwitchContext {
  readonly ui: Readonly<Record<string, unknown>>;
  readonly cwd: string;
  readonly model: Readonly<{ provider: string; id: string }>;
  getContextUsage(): { tokens: number; contextWindow: number; percent: number };
  readonly sessionManager: {
    getSessionFile(): string;
    getSessionId(): string;
    getSessionName(): string;
  };
  readonly modelRegistry: { getAvailable(): Promise<readonly unknown[]> };
  abort(): void;
}
type HostHandler = (event: HostEvent, context: SwitchContext) => unknown | Promise<unknown>;

const handlers = new Map<string, HostHandler[]>();
const pi = {
  on(event: string, handler: HostHandler) {
    const list = handlers.get(event) || [];
    list.push(handler);
    handlers.set(event, list);
  },
  registerCommand() {},
  getCommands() { return []; },
  getThinkingLevel() { return 'minimal'; },
  setThinkingLevel() {},
  setSessionName() {},
};

const ctx: SwitchContext = {
  ui: {},
  get cwd() { return currentFile === oldFile ? '/workspace/old' : '/workspace/new'; },
  model: { provider: 'zai', id: 'glm-4.7-flash' },
  getContextUsage() { return { tokens: currentFile === oldFile ? 10 : 20, contextWindow: 200000, percent: 0.01 }; },
  sessionManager: {
    getSessionFile() { return currentFile; },
    getSessionId() { return path.basename(currentFile, '.jsonl'); },
    getSessionName() { return currentFile === oldFile ? 'Old fake session' : 'New fake session'; },
  },
  modelRegistry: { async getAvailable() { return []; } },
  abort() {},
};

async function emit(event: string, data: HostEvent): Promise<void> {
  for (const handler of handlers.get(event) || []) await handler(data, ctx);
}

if (profile === 'omp') {
  createHarnessBridge('fake-switch-token')(pi);
} else {
  const descriptor: BridgeDescriptor = {
    harnessId: 'pi', name: 'Fake Pi', hostVersion: 'test', wrapperVersion: 'test',
    eventProfile: [], capabilities: {},
  };
  createBridge(descriptor)(pi);
}

await emit('session_start', { type: 'session_start' });

async function switchSession(reason: 'new' | 'resume'): Promise<void> {
  const previousSessionFile = currentFile;
  currentFile = reason === 'new' ? newFile : oldFile;
  await emit('session_switch', { type: 'session_switch', reason, previousSessionFile });
  fs.appendFileSync(marker, reason + '\n');
}

process.on('SIGUSR1', () => { void switchSession('new'); });
process.on('SIGUSR2', () => { void switchSession('resume'); });
process.on('SIGTERM', async () => {
  await emit('session_shutdown', { type: 'session_shutdown' });
  process.exit(0);
});

console.log('READY');
setInterval(() => {}, 1 << 30);
