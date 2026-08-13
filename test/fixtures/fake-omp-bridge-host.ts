import * as fs from "node:fs";
import * as path from "node:path";
import { createHarnessBridge } from "../../extensions/pi-dish-bridge-omp/index.ts";

const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
const pi: any = {
  on(event: string, handler: (event: any, ctx: any) => any) {
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

async function emit(event: string, data: any, ctx: any) {
  for (const handler of handlers.get(event) || []) await handler(data, ctx);
}

const sessionFile = process.env.FAKE_OMP_SESSION_FILE!;
fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
fs.writeFileSync(sessionFile, JSON.stringify({ type: "session", id: "fake-omp", cwd: process.cwd() }) + "\n");

const ui = {};
const ctx: any = {
  ui,
  cwd: process.cwd(),
  model: { provider: "zai", id: "glm-4.7-flash" },
  getContextUsage() { return { tokens: 100, contextWindow: 200000, percent: 0.05 }; },
  sessionManager: {
    getSessionFile() { return sessionFile; },
    getSessionId() { return "fake-omp"; },
  },
  modelRegistry: { async getAvailable() { return []; } },
  abort() {},
};

if (process.env.FAKE_OMP_HAS_COMPACT === "1") {
  ctx.compact = async (instructions?: string) => {
    fs.writeFileSync(process.env.FAKE_OMP_COMPACT_CALL!, JSON.stringify({ instructions }));
    // Interactive OMP catches compaction failures itself (TUI-only error) and
    // resolves without emitting any session_before_compact/session_compact.
    if (process.env.FAKE_OMP_COMPACT_SWALLOW === "1") return;
    await emit("session_before_compact", { reason: "manual" }, ctx);
    setTimeout(() => {
      emit("session_compact", {
        reason: "manual",
        compactionEntry: { tokensBefore: 100 },
      }, ctx);
    }, 80);
  };
}

createHarnessBridge("fake-spawn-token")(pi);
await emit("session_start", {}, ctx);

const registryDir = path.join(process.env.HOME!, ".pi", "dish", "sessions");
for (let attempt = 0; attempt < 100; attempt++) {
  if (fs.existsSync(registryDir) && fs.readdirSync(registryDir).some(name => name.endsWith(".json"))) break;
  await Bun.sleep(20);
}
if (!fs.existsSync(registryDir) || !fs.readdirSync(registryDir).some(name => name.endsWith(".json"))) {
  throw new Error("bridge registry was not written");
}

const shutdown = async () => {
  await emit("session_shutdown", {}, ctx);
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
console.log("READY");
setInterval(() => {}, 1000);
