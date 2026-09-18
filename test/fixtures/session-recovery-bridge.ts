import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createBridge, PUBLIC_EVENT_PROFILE } from '../../extensions/pi-dish-bridge/core.js';

const home = process.env.HOME;
if (!home) throw new Error('session recovery bridge fixture needs HOME');

let current = path.join(home, 'bridge-old.jsonl');
const writeHeader = (): void => {
  fs.writeFileSync(current, `${JSON.stringify({ type: 'session', id: path.basename(current, '.jsonl'), cwd: home })}\n`);
};
writeHeader();

type Handler = (event: unknown, context: unknown) => unknown;
const handlers = new Map<string, Handler[]>();
const host = {
  on(name: string, handler: Handler): void {
    handlers.set(name, [...(handlers.get(name) ?? []), handler]);
  },
  registerCommand(_name: string, _options: unknown): void {},
  getCommands(): unknown[] { return []; },
  getThinkingLevel(): string { return 'high'; },
};
const context = {
  ui: {},
  cwd: home,
  model: { provider: 'test', id: 'model' },
  getContextUsage(): null { return null; },
  sessionManager: {
    getSessionFile(): string { return current; },
    getSessionId(): string { return path.basename(current, '.jsonl'); },
    getSessionName(): string { return 'Bridge work'; },
  },
};
const emit = async (name: string, data: unknown = {}): Promise<void> => {
  for (const handler of handlers.get(name) ?? []) await handler(data, context);
};

createBridge({
  harnessId: 'omp', name: 'Test OMP', hostVersion: 'test', wrapperVersion: 'test',
  eventProfile: PUBLIC_EVENT_PROFILE, capabilities: {}, sessionSwitchEvents: true, nestedSubsessions: true,
})(host);
createBridge({
  harnessId: 'pi', name: 'Embedded Pi', hostVersion: 'test', wrapperVersion: 'test',
  eventProfile: PUBLIC_EVENT_PROFILE, capabilities: {},
})(host);

await emit('session_start');
console.log('READY');
for await (const line of readline.createInterface({ input: process.stdin })) {
  const command: unknown = JSON.parse(line);
  if (typeof command !== 'string') throw new Error('bridge fixture command must be a string');
  if (command === 'run') {
    await emit('agent_start');
    await emit('message_end', { message: { role: 'user', content: 'work' } });
    fs.appendFileSync(current, `${JSON.stringify({ type: 'message', message: { role: 'user', content: 'work' } })}\n`);
  } else if (command === 'turn') {
    await emit('turn_end');
  } else if (command === 'switch') {
    current = path.join(home, 'bridge-new.jsonl');
    writeHeader();
    await emit('session_switch', { reason: 'new' });
  } else if (command === 'child') {
    current = path.join(home, 'bridge-new', 'worker.jsonl');
    fs.mkdirSync(path.dirname(current), { recursive: true });
    writeHeader();
    await emit('session_switch', { reason: 'resume' });
    await emit('agent_start');
  } else if (command === 'shutdown') {
    await emit('session_shutdown');
  } else {
    throw new Error(`unknown bridge fixture command: ${command}`);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  console.log(`ACK:${command}`);
  if (command === 'shutdown') process.exit(0);
}
