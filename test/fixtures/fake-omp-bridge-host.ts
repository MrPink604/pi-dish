import * as fs from "node:fs";
import * as path from "node:path";
import { createBridge } from "../../extensions/pi-dish-bridge/core.js";
import { bridgeDescriptor, createHarnessBridge } from "../../extensions/pi-dish-bridge-omp/index.js";
import { patchOmpAgentSession } from "../../extensions/pi-dish-bridge-omp/native-state.js";

const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
const pi: any = {
  on(event: string, handler: (event: any, ctx: any) => any) {
    const list = handlers.get(event) || [];
    list.push(handler);
    handlers.set(event, list);
  },
  registerCommand() {},
  getCommands() { return []; },
  getActiveTools() { return ["read"]; },
  getAllTools() {
    return [
      { name: "read", description: "Read a file", parameters: { type: "object" } },
      { name: "bash", description: "Run a command", parameters: { type: "object" } },
    ];
  },
  getThinkingLevel() { return "minimal"; },
  setThinkingLevel() {},
  setSessionName() {},
};

function createHandlerContext(ctx: any) {
  const baseUI = ctx.ui;
  const delegated = new Map<PropertyKey, unknown>();
  const handlerUI = new Proxy(baseUI, {
    get(target, property) {
      const cached = delegated.get(property);
      if (cached) return cached;
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      // OMP gives each extension handler a fresh Proxy whose methods delegate
      // to the shared UI target. Assignment still writes through to that target.
      const delegate = value.bind(target);
      delegated.set(property, delegate);
      return delegate;
    },
  });
  return { ...ctx, ui: handlerUI };
}

async function emit(event: string, data: any, ctx: any) {
  for (const handler of handlers.get(event) || []) await handler(data, createHandlerContext(ctx));
}

const sessionFile = process.env.FAKE_OMP_SESSION_FILE!;
fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
fs.writeFileSync(sessionFile, JSON.stringify({ type: "session", id: "fake-omp", cwd: process.cwd() }) + "\n");

const nativeAskDialog = () => {
  if (process.env.FAKE_OMP_ASK_THROW === "1") throw new Error("fake ask presentation failed");
  return Promise.withResolvers<unknown>().promise;
};
const ui = { askDialog: nativeAskDialog };
const ctx: any = {
  ui,
  cwd: process.cwd(),
  model: { provider: "zai", id: "glm-4.7-flash" },
  getSystemPrompt() { return "effective fake OMP system prompt"; },
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

// The fake host cannot install OMP's package, so native-state's prototype
// patch is pointed at a stand-in carrying the same AgentSession methods the
// bridge observes in a real OMP process. State moves only through the setters
// OMP itself calls on a transition, so the capture wiring is what publishes.
class FakeOmpAgentSession {
  todos: unknown[] = [];
  planMode: unknown = null;
  goal: unknown = undefined;
  advisor: { enabled: boolean; active: boolean; advisors: Array<{ name: string; status: string }> } =
    { enabled: false, active: false, advisors: [] };
  getTodoPhases() { return this.todos; }
  setTodoPhases(phases: unknown[]) { this.todos = phases; }
  getPlanModeState() { return this.planMode; }
  setPlanModeState(state: unknown) { this.planMode = state; }
  getGoalModeState() { return this.goal; }
  setGoalModeState(state: unknown) { this.goal = state; }
  isAdvisorEnabled() { return this.advisor.enabled; }
  isAdvisorActive() { return this.advisor.enabled && this.advisor.active; }
  getAdvisorStatusOverview() {
    return { configured: this.advisor.advisors.length > 0, advisors: this.advisor.advisors };
  }
  setAdvisorEnabled(enabled: boolean) { this.advisor.enabled = enabled; return this.isAdvisorActive(); }
  subscribe() { return () => {}; }
}

const stepFile = process.env.FAKE_OMP_NATIVE_STEP_FILE || "";
let nativeSession: FakeOmpAgentSession | null = null;
if (stepFile) {
  patchOmpAgentSession(FakeOmpAgentSession);
  nativeSession = new FakeOmpAgentSession();
  let appliedSeq: number | null = null;
  setInterval(() => {
    if (!fs.existsSync(stepFile)) return;
    let step: any;
    try { step = JSON.parse(fs.readFileSync(stepFile, "utf8")); } catch { return; }
    if (!step || step.seq === appliedSeq) return;
    appliedSeq = step.seq;
    const session = nativeSession!;
    if ("todos" in step) session.setTodoPhases(step.todos);
    if ("planMode" in step) session.setPlanModeState(step.planMode);
    if ("goal" in step) session.setGoalModeState(step.goal ?? undefined);
    if ("advisor" in step) {
      session.advisor.active = step.advisor?.active === true;
      session.advisor.advisors = step.advisor?.advisors ?? [];
      if (step.advisor?.readOnly) {
        session.advisor.enabled = step.advisor?.enabled === true;
        session.getAdvisorStatusOverview();
      } else {
        session.setAdvisorEnabled(step.advisor?.enabled === true);
      }
    }
    fs.writeFileSync(`${stepFile}.ack`, String(step.seq));
  }, 20);
}

const nativeProjection = process.env.FAKE_OMP_NATIVE_PROJECTION
  ? JSON.parse(process.env.FAKE_OMP_NATIVE_PROJECTION)
  : null;
const projectionListeners = new Set<(projection: unknown) => void>();
const bridgeFactory = nativeProjection
  ? createBridge({
      ...bridgeDescriptor,
      nativeProjection: {
        get: () => nativeProjection,
        subscribe(listener: (projection: unknown) => void) {
          projectionListeners.add(listener);
          return () => projectionListeners.delete(listener);
        },
      },
    })
  : createHarnessBridge("fake-spawn-token");
bridgeFactory(pi);
await emit("session_start", {}, ctx);

if (process.env.FAKE_OMP_ASK_RESULT) {
  // Exercise several event-scoped UI proxies before the native tool reaches
  // the shared UI. A bridge must not add another wrapper for each proxy.
  for (let index = 0; index < 8; index++) {
    await emit("tool_execution_update", { toolCallId: `warmup-${index}`, toolName: "read" }, ctx);
  }
  void Promise.resolve().then(() => ctx.ui.askDialog([
    {
      id: "deploy",
      question: "Deploy now?",
      header: "Release",
      options: [
        { label: "Yes", description: "Ship the current build." },
        { label: "No", description: "Keep it staged." },
      ],
      recommended: 0,
    },
  ])).then((result: unknown) => {
    fs.writeFileSync(process.env.FAKE_OMP_ASK_RESULT!, JSON.stringify(result) ?? "null");
  }, (error: unknown) => {
    fs.writeFileSync(process.env.FAKE_OMP_ASK_RESULT!, JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}

const registryDir = path.join(process.env.HOME!, ".pi", "dish", "sessions");
for (let attempt = 0; attempt < 100; attempt++) {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 20);
  await promise;
}
const shutdown = async () => {
  await emit("session_shutdown", {}, ctx);
  if (process.env.FAKE_OMP_UI_RESTORE_RESULT) {
    fs.writeFileSync(process.env.FAKE_OMP_UI_RESTORE_RESULT, JSON.stringify(ctx.ui.askDialog === nativeAskDialog));
  }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
console.log("READY");
setInterval(() => {}, 1000);
