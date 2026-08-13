import * as fs from "node:fs";
import * as path from "node:path";
import { createBridge, type BridgeDescriptor } from "../../extensions/pi-dish-bridge/core.js";
import { createHarnessBridge } from "../../extensions/pi-dish-bridge-omp/index.ts";

const profile = process.env.FAKE_SWITCH_PROFILE || "omp";
const oldFile = process.env.FAKE_SWITCH_OLD_FILE!;
const newFile = process.env.FAKE_SWITCH_NEW_FILE!;
const marker = process.env.FAKE_SWITCH_MARKER!;
let currentFile = oldFile;

fs.mkdirSync(path.dirname(oldFile), { recursive: true });
fs.writeFileSync(oldFile, JSON.stringify({ type: "session", id: path.basename(oldFile, ".jsonl"), cwd: process.cwd() }) + "\n");

const handlers = new Map<string, Function[]>();
const pi: any = {
  on(event: string, handler: Function) {
    const list = handlers.get(event) || [];
    list.push(handler);
    handlers.set(event, list);
  },
  registerCommand() {},
  getCommands() { return []; },
  getThinkingLevel() { return "minimal"; },
  setThinkingLevel() {},
  setSessionName() {},
};

async function emit(event: string, data: any) {
  for (const handler of handlers.get(event) || []) await handler(data, ctx);
}

const ctx: any = {
  ui: {},
  get cwd() { return currentFile === oldFile ? "/workspace/old" : "/workspace/new"; },
  model: { provider: "zai", id: "glm-4.7-flash" },
  getContextUsage() { return { tokens: currentFile === oldFile ? 10 : 20, contextWindow: 200000, percent: 0.01 }; },
  sessionManager: {
    getSessionFile() { return currentFile; },
    getSessionId() { return path.basename(currentFile, ".jsonl"); },
    getSessionName() { return currentFile === oldFile ? "Old fake session" : "New fake session"; },
  },
  modelRegistry: { async getAvailable() { return []; } },
  abort() {},
};

if (profile === "omp") {
  createHarnessBridge("fake-switch-token")(pi);
} else {
  const descriptor: BridgeDescriptor = {
    harnessId: "pi", name: "Fake Pi", hostVersion: "test", wrapperVersion: "test",
    eventProfile: [], capabilities: {},
  };
  createBridge(descriptor)(pi);
}

await emit("session_start", { type: "session_start" });

const switchSession = async (reason: "new" | "resume") => {
  const previousSessionFile = currentFile;
  currentFile = reason === "new" ? newFile : oldFile;
  await emit("session_switch", { type: "session_switch", reason, previousSessionFile });
  fs.appendFileSync(marker, reason + "\n");
};

process.on("SIGUSR1", () => { void switchSession("new"); });
process.on("SIGUSR2", () => { void switchSession("resume"); });
process.on("SIGTERM", async () => {
  await emit("session_shutdown", { type: "session_shutdown" });
  process.exit(0);
});

console.log("READY");
setInterval(() => {}, 1 << 30);
