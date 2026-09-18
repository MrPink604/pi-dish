import * as fs from 'node:fs';
import * as path from 'node:path';
import { createBridge, type BridgeDescriptor } from '../../extensions/pi-dish-bridge/core.js';

const mode = process.env.FAKE_OMP_TREE_MODE || 'normal';
const sessionId = 'fake-omp-tree';
const sessionFile = path.join(process.env.HOME!, '.omp', 'agent', 'sessions', 'fixture', `${sessionId}.jsonl`);
const operationLog = process.env.FAKE_OMP_TREE_LOG!;
fs.mkdirSync(path.dirname(sessionFile), { recursive: true });

type HostRecord = Record<PropertyKey, unknown>;
interface TreeEntry extends HostRecord {
  type: string;
  id: string;
  parentId: string | null;
}
interface TreeNode {
  entry: TreeEntry;
  children: TreeNode[];
}
interface CommandRegistration extends HostRecord {
  name: string;
  source: string;
  handler(args: string, context: HostRecord): unknown;
}
interface ShortcutRegistration extends HostRecord {
  chord: string;
  handler(context: HostRecord): unknown;
}
function record(value: unknown): value is HostRecord {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}
function callable(value: unknown): value is (this: unknown, ...args: unknown[]) => unknown {
  return typeof value === 'function';
}

const entries: TreeEntry[] = [
  { type: 'message', id: 'u1', parentId: null, timestamp: '2026-08-13T10:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'first prompt' }] } },
  { type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-08-13T10:00:01.000Z', message: { role: 'assistant', model: 'glm-4.7-flash', content: [{ type: 'text', text: 'first answer' }] } },
  { type: 'message', id: 'u2', parentId: 'a1', timestamp: '2026-08-13T10:00:02.000Z', message: { role: 'user', content: [{ type: 'text', text: 'second prompt' }] } },
];
fs.writeFileSync(sessionFile, [
  JSON.stringify({ type: 'title', title: 'Fake OMP tree' }),
  JSON.stringify({ type: 'session', version: 3, id: sessionId, cwd: process.cwd() }),
  ...entries.map(entry => JSON.stringify(entry)),
].join('\n') + '\n');

let leafId: string | null = 'u2';
let insideCommand = false;
// Which trigger produced the command context servicing an operation: OMP's
// TUI builds one for an extension command and one per extension shortcut.
let trigger: 'command' | 'shortcut' | null = null;

function tree(): TreeNode[] {
  const nodes = new Map(entries.map(entry => [entry.id, { entry, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const entry of entries) {
    const node = nodes.get(entry.id)!;
    const parent = entry.parentId ? nodes.get(entry.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const manager = {
  getSessionFile: () => sessionFile,
  getSessionId: () => sessionId,
  getSessionName: () => 'Fake OMP tree',
  getEntries: () => entries,
  getTree: tree,
  getLeafId: () => leafId,
  getEntry: (id: string) => entries.find(entry => entry.id === id),
};
if (mode === 'missing-tree-api') {
  Reflect.deleteProperty(manager, 'getTree');
  Reflect.deleteProperty(manager, 'getLeafId');
  Reflect.deleteProperty(manager, 'getEntry');
}

const plainContext = {
  cwd: process.cwd(),
  sessionManager: manager,
  modelRegistry: { getAvailable: async () => [] },
  model: { provider: 'zai', id: 'glm-4.7-flash' },
  ui: {},
  getContextUsage: () => ({ tokens: 10, contextWindow: 1000, percent: 1 }),
  abort: () => {},
  compact: async () => {},
};

function logOperation(value: HostRecord): void {
  fs.appendFileSync(operationLog, JSON.stringify({ ...value, trigger }) + '\n');
}

const commandContext = {
  ...plainContext,
  branch: async (entryId: string) => {
    logOperation({ operation: 'branch', entryId, insideCommand });
    if (mode === 'cancel-branch') return { cancelled: true };
    leafId = entryId;
    return { cancelled: false };
  },
  navigateTree: async (targetId: string, options?: { summarize?: boolean }) => {
    logOperation({ operation: 'navigate', targetId, summarize: !!options?.summarize, insideCommand });
    if (mode === 'cancel-navigate') return { cancelled: true };
    if (mode === 'operation-timeout') return await new Promise<never>(() => {});
    leafId = targetId;
    return { cancelled: false };
  },
};
if (mode === 'missing-command-api') Reflect.deleteProperty(commandContext, 'navigateTree');

const eventHandlers = new Map<string, Array<(event: HostRecord, context: HostRecord) => unknown>>();
const commands = new Map<string, CommandRegistration>();
const shortcuts = new Map<string, ShortcutRegistration>();
const fakePi = {
  on(event: string, handler: (event: HostRecord, context: HostRecord) => unknown) {
    const handlers = eventHandlers.get(event) || [];
    handlers.push(handler);
    eventHandlers.set(event, handlers);
  },
  registerCommand(name: string, options: unknown) {
    if (!record(options) || !callable(options.handler)) throw new Error('invalid command registration');
    const handler = options.handler;
    commands.set(name, {
      ...options,
      name,
      source: 'extension',
      handler: (args, context) => Reflect.apply(handler, options, [args, context]),
    });
  },
  registerShortcut(chord: string, options: unknown) {
    if (!record(options) || !callable(options.handler)) throw new Error('invalid shortcut registration');
    const handler = options.handler;
    shortcuts.set(chord, {
      ...options,
      chord,
      handler: context => Reflect.apply(handler, options, [context]),
    });
  },
  // Match OMP 17.2.15: this public API forwards a user prompt with command
  // expansion disabled, so it cannot invoke our own extension command.
  sendUserMessage() { throw new Error('sendUserMessage does not dispatch extension commands'); },
  getCommands: () => [...commands.values()],
  getThinkingLevel: () => 'minimal',
  setThinkingLevel: () => {},
  setModel: async () => true,
  setSessionName: async () => {},
  getActiveTools: () => [],
  getAllTools: () => [],
  setActiveTools: async () => {},
};

const descriptor: BridgeDescriptor = {
  harnessId: 'omp',
  name: 'Fake Oh My Pi',
  hostVersion: 'test',
  wrapperVersion: 'test',
  eventProfile: [],
  capabilities: {
    prompt: true, steer: true, followUp: true, abort: true, compact: false,
    models: true, setModel: true, setThinking: true, rename: true,
    commands: true, reload: false, queueRead: false, queueCancel: false,
    treeRead: true, treeNavigation: true, extensionUI: false,
  },
  treeCommandContext: true,
  treeCommandAcquireTimeoutMs: Number(process.env.FAKE_OMP_TREE_ACQUIRE_TIMEOUT_MS) || 100,
  treeCommandOperationTimeoutMs: Number(process.env.FAKE_OMP_TREE_OPERATION_TIMEOUT_MS) || 100,
};

// Hosts that predate extension shortcuts leave pi-dish on the typed command.
if (mode === 'no-shortcut') Reflect.deleteProperty(fakePi, 'registerShortcut');

createBridge(descriptor)(fakePi);
for (const handler of eventHandlers.get('session_start') || []) {
  await handler({ type: 'session_start' }, plainContext);
}

// SIGUSR1 stands in for the legacy trigger: pi-dish typing the service
// command into the pane. SIGUSR2 stands in for the shortcut keypress, which
// OMP's TUI services with a command context of its own.
process.on('SIGUSR1', () => {
  if (mode === 'acquisition-timeout') return;
  const command = commands.get('dish-tree-service');
  if (!command) return;
  queueMicrotask(async () => {
    insideCommand = true;
    trigger = 'command';
    try {
      await command.handler('', commandContext);
    } finally {
      insideCommand = false;
      trigger = null;
    }
  });
});

process.on('SIGUSR2', () => {
  const shortcut = shortcuts.get('ctrl+alt+shift+f12');
  if (!shortcut) return;
  insideCommand = true;
  trigger = 'shortcut';
  try {
    shortcut.handler(commandContext);
  } finally {
    // The host never awaits a shortcut handler; the bridge must settle each
    // operation itself. Clear the markers once its microtasks have drained.
    queueMicrotask(() => { insideCommand = false; trigger = null; });
  }
});

process.on('SIGTERM', async () => {
  for (const handler of eventHandlers.get('session_shutdown') || []) {
    await handler({ type: 'session_shutdown' }, plainContext);
  }
  process.exit(0);
});

setInterval(() => {}, 1 << 30);
