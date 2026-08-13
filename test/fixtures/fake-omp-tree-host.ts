import * as fs from "node:fs";
import * as path from "node:path";
import { createBridge, type BridgeDescriptor } from "../../extensions/pi-dish-bridge/core.js";

const mode = process.env.FAKE_OMP_TREE_MODE || "normal";
const sessionId = "fake-omp-tree";
const sessionFile = path.join(process.env.HOME!, ".omp", "agent", "sessions", "fixture", `${sessionId}.jsonl`);
const operationLog = process.env.FAKE_OMP_TREE_LOG!;
fs.mkdirSync(path.dirname(sessionFile), { recursive: true });

const entries: any[] = [
  { type: "message", id: "u1", parentId: null, timestamp: "2026-08-13T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "first prompt" }] } },
  { type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-13T10:00:01.000Z", message: { role: "assistant", model: "glm-4.7-flash", content: [{ type: "text", text: "first answer" }] } },
  { type: "message", id: "u2", parentId: "a1", timestamp: "2026-08-13T10:00:02.000Z", message: { role: "user", content: [{ type: "text", text: "second prompt" }] } },
];
fs.writeFileSync(sessionFile, [
  JSON.stringify({ type: "title", title: "Fake OMP tree" }),
  JSON.stringify({ type: "session", version: 3, id: sessionId, cwd: process.cwd() }),
  ...entries.map(JSON.stringify),
].join("\n") + "\n");

let leafId: string | null = "u2";
let insideCommand = false;

function tree() {
  const nodes = new Map(entries.map((entry) => [entry.id, { entry, children: [] as any[] }]));
  const roots: any[] = [];
  for (const entry of entries) {
    const node = nodes.get(entry.id)!;
    const parent = entry.parentId ? nodes.get(entry.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const manager: any = {
  getSessionFile: () => sessionFile,
  getSessionId: () => sessionId,
  getSessionName: () => "Fake OMP tree",
  getEntries: () => entries,
  getTree: tree,
  getLeafId: () => leafId,
  getEntry: (id: string) => entries.find((entry) => entry.id === id),
};
if (mode === "missing-tree-api") {
  delete manager.getTree;
  delete manager.getLeafId;
  delete manager.getEntry;
}

const plainContext: any = {
  cwd: process.cwd(),
  sessionManager: manager,
  modelRegistry: { getAvailable: async () => [] },
  model: { provider: "zai", id: "glm-4.7-flash" },
  ui: {},
  getContextUsage: () => ({ tokens: 10, contextWindow: 1000, percent: 1 }),
  abort: () => {},
  compact: async () => {},
};

function logOperation(value: any) {
  fs.appendFileSync(operationLog, JSON.stringify(value) + "\n");
}

const commandContext: any = {
  ...plainContext,
  branch: async (entryId: string) => {
    logOperation({ operation: "branch", entryId, insideCommand });
    if (mode === "cancel-branch") return { cancelled: true };
    leafId = entryId;
    return { cancelled: false };
  },
  navigateTree: async (targetId: string, options?: { summarize?: boolean }) => {
    logOperation({ operation: "navigate", targetId, summarize: !!options?.summarize, insideCommand });
    if (mode === "cancel-navigate") return { cancelled: true };
    if (mode === "operation-timeout") return await new Promise(() => {});
    leafId = targetId;
    return { cancelled: false };
  },
};
if (mode === "missing-command-api") delete commandContext.navigateTree;

const eventHandlers = new Map<string, Function[]>();
const commands = new Map<string, any>();
const fakePi: any = {
  on(event: string, handler: Function) {
    const handlers = eventHandlers.get(event) || [];
    handlers.push(handler);
    eventHandlers.set(event, handlers);
  },
  registerCommand(name: string, options: any) {
    commands.set(name, { name, source: "extension", ...options });
  },
  // Match OMP 17.2.15: this public API forwards a user prompt with command
  // expansion disabled, so it cannot be used to invoke our own extension
  // command. Throw to catch any bridge regression that assumes otherwise.
  sendUserMessage() { throw new Error("sendUserMessage does not dispatch extension commands"); },
  getCommands: () => [...commands.values()],
  getThinkingLevel: () => "minimal",
  setThinkingLevel: () => {},
  setModel: async () => true,
  setSessionName: async () => {},
  getActiveTools: () => [],
  getAllTools: () => [],
  setActiveTools: async () => {},
};

const descriptor: BridgeDescriptor = {
  harnessId: "omp",
  name: "Fake Oh My Pi",
  hostVersion: "test",
  wrapperVersion: "test",
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

createBridge(descriptor)(fakePi);
for (const handler of eventHandlers.get("session_start") || []) {
  await handler({ type: "session_start" }, plainContext);
}

process.on("SIGUSR1", () => {
  if (mode === "acquisition-timeout") return;
  const command = commands.get("dish-tree-service");
  if (!command) return;
  queueMicrotask(async () => {
    insideCommand = true;
    try {
      await command.handler("", commandContext);
    } finally {
      insideCommand = false;
    }
  });
});

process.on("SIGTERM", async () => {
  for (const handler of eventHandlers.get("session_shutdown") || []) {
    await handler({ type: "session_shutdown" }, plainContext);
  }
  process.exit(0);
});

setInterval(() => {}, 1 << 30);
