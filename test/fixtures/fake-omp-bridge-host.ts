import * as fs from 'node:fs';
import * as path from 'node:path';
import { createBridge } from '../../extensions/pi-dish-bridge/core.js';
import { bridgeDescriptor, createHarnessBridge } from '../../extensions/pi-dish-bridge-omp/index.js';
import { patchOmpAgentSession } from '../../extensions/pi-dish-bridge-omp/native-state.js';

type HostRecord = Record<PropertyKey, unknown>;
function record(value: unknown): value is HostRecord {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}
interface FixtureUI {
  askDialog(questions: unknown): Promise<unknown>;
}
interface FixtureContext {
  ui: FixtureUI;
  cwd: string;
  model: Readonly<{ provider: string; id: string }>;
  getSystemPrompt(): string;
  getContextUsage(): { tokens: number; contextWindow: number; percent: number };
  sessionManager: {
    getSessionFile(): string;
    getSessionId(): string;
  };
  modelRegistry: { getAvailable(): Promise<readonly unknown[]> };
  abort(): void;
  isIdle?: () => boolean;
  hasPendingMessages?: () => boolean;
  getAsyncJobSnapshot?: () => unknown;
  compact?: (instructions?: string) => Promise<void>;
}
type HostHandler = (event: HostRecord, context: FixtureContext) => unknown | Promise<unknown>;

const handlers = new Map<string, HostHandler[]>();
const pi = {
  on(event: string, handler: HostHandler) {
    const list = handlers.get(event) || [];
    list.push(handler);
    handlers.set(event, list);
  },
  registerCommand() {},
  getCommands() { return []; },
  getActiveTools() { return ['read']; },
  getAllTools() {
    return [
      { name: 'read', description: 'Read a file', parameters: { type: 'object' } },
      { name: 'bash', description: 'Run a command', parameters: { type: 'object' } },
    ];
  },
  getThinkingLevel() { return 'minimal'; },
  setThinkingLevel() {},
  setSessionName() {},
};

function createHandlerContext(ctx: FixtureContext): FixtureContext {
  const baseUI = ctx.ui;
  const delegated = new Map<PropertyKey, unknown>();
  const handlerUI = new Proxy(baseUI, {
    get(target, property) {
      const cached = delegated.get(property);
      if (cached) return cached;
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      // OMP gives each extension handler a fresh Proxy whose methods delegate
      // to the shared UI target. Assignment still writes through to that target.
      const delegate = value.bind(target);
      delegated.set(property, delegate);
      return delegate;
    },
  });
  return { ...ctx, ui: handlerUI };
}

async function emit(event: string, data: HostRecord, ctx: FixtureContext): Promise<void> {
  for (const handler of handlers.get(event) || []) await handler(data, createHandlerContext(ctx));
}

const sessionFile = process.env.FAKE_OMP_SESSION_FILE!;
fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
fs.writeFileSync(sessionFile, JSON.stringify({ type: 'session', id: 'fake-omp', cwd: process.cwd() }) + '\n');

const nativeAskDialog = (): Promise<unknown> => {
  if (process.env.FAKE_OMP_ASK_THROW === '1') throw new Error('fake ask presentation failed');
  return new Promise<unknown>(() => {});
};
const ui: FixtureUI = { askDialog: nativeAskDialog };
const ctx: FixtureContext = {
  ui,
  cwd: process.cwd(),
  model: { provider: 'zai', id: 'glm-4.7-flash' },
  getSystemPrompt() { return 'effective fake OMP system prompt'; },
  getContextUsage() { return { tokens: 100, contextWindow: 200000, percent: 0.05 }; },
  sessionManager: {
    getSessionFile() { return sessionFile; },
    getSessionId() { return 'fake-omp'; },
  },
  modelRegistry: { async getAvailable() { return []; } },
  abort() {},
};

if (process.env.FAKE_OMP_LIFECYCLE_FILE) {
  ctx.isIdle = () => true;
  ctx.hasPendingMessages = () => false;
  ctx.getAsyncJobSnapshot = () => JSON.parse(fs.readFileSync(process.env.FAKE_OMP_LIFECYCLE_FILE!, 'utf8'));
}

if (process.env.FAKE_OMP_HAS_COMPACT === '1') {
  ctx.compact = async (instructions?: string) => {
    fs.writeFileSync(process.env.FAKE_OMP_COMPACT_CALL!, JSON.stringify({ instructions }));
    // Interactive OMP catches compaction failures itself (TUI-only error) and
    // resolves without emitting any session_before_compact/session_compact.
    if (process.env.FAKE_OMP_COMPACT_SWALLOW === '1') return;
    await emit('session_before_compact', { reason: 'manual' }, ctx);
    setTimeout(() => {
      void emit('session_compact', {
        reason: 'manual',
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
  // /btw's backing API on the real AgentSession. The bridge mirrors OMP's
  // embedded btw-user template into promptText; the test asserts the question
  // arrived and that nothing touched the session file.
  async runEphemeralTurn(opts: { promptText?: string; onTextDelta?: (delta: string) => void } = {}) {
    if (process.env.FAKE_OMP_BTW_CALL) {
      fs.writeFileSync(process.env.FAKE_OMP_BTW_CALL, JSON.stringify({ promptText: opts.promptText ?? null }));
    }
    if (process.env.FAKE_OMP_BTW_ERROR) throw new Error(process.env.FAKE_OMP_BTW_ERROR);
    const text = process.env.FAKE_OMP_BTW_ANSWER || 'fake btw answer';
    opts.onTextDelta?.(text);
    return { replyText: text, assistantMessage: { role: 'assistant', content: [{ type: 'text', text }] } };
  }
}

const stepFile = process.env.FAKE_OMP_NATIVE_STEP_FILE || '';
let nativeSession: FakeOmpAgentSession | null = null;
// The bridge's getOmpNativeSession reads the native-state capture, which a
// patched-accessor call publishes — OMP's status line does this constantly;
// the fake calls subscribe() once instead. /btw tests need the capture even
// without the projection step driver.
if (stepFile || process.env.FAKE_OMP_HAS_BTW === '1') {
  patchOmpAgentSession(FakeOmpAgentSession);
  nativeSession = new FakeOmpAgentSession();
  nativeSession.subscribe();
}
if (stepFile) {
  let appliedSeq: unknown;
  setInterval(() => {
    if (!fs.existsSync(stepFile)) return;
    let step: unknown;
    try { step = JSON.parse(fs.readFileSync(stepFile, 'utf8')); } catch { return; }
    if (!record(step) || step.seq === appliedSeq) return;
    appliedSeq = step.seq;
    const session = nativeSession!;
    if (Array.isArray(step.todos)) session.setTodoPhases(step.todos);
    if ('planMode' in step) session.setPlanModeState(step.planMode);
    if ('goal' in step) session.setGoalModeState(step.goal ?? undefined);
    if (record(step.advisor)) {
      session.advisor.active = step.advisor.active === true;
      session.advisor.advisors = Array.isArray(step.advisor.advisors)
        ? step.advisor.advisors.flatMap((value: unknown) => record(value) && typeof value.name === 'string' && typeof value.status === 'string'
          ? [{ name: value.name, status: value.status }] : [])
        : [];
      if (step.advisor.readOnly) {
        session.advisor.enabled = step.advisor.enabled === true;
        session.getAdvisorStatusOverview();
      } else {
        session.setAdvisorEnabled(step.advisor.enabled === true);
      }
    }
    fs.writeFileSync(`${stepFile}.ack`, String(step.seq));
  }, 20);
}

const nativeProjection: unknown = process.env.FAKE_OMP_NATIVE_PROJECTION
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
  : createHarnessBridge('fake-spawn-token');
bridgeFactory(pi);
await emit('session_start', {}, ctx);

if (process.env.FAKE_OMP_ASK_RESULT) {
  const fireAsk = async (): Promise<void> => {
    // Exercise several event-scoped UI proxies before the native tool reaches
    // the shared UI. A bridge must not add another wrapper for each proxy.
    for (let index = 0; index < 8; index++) {
      await emit('tool_execution_update', { toolCallId: `warmup-${index}`, toolName: 'read' }, ctx);
    }
    void Promise.resolve().then(() => ctx.ui.askDialog([
      {
        id: 'deploy',
        question: 'Deploy now?',
        header: 'Release',
        options: [
          { label: 'Yes', description: 'Ship the current build.' },
          { label: 'No', description: 'Keep it staged.' },
        ],
        recommended: 0,
      },
    ])).then((result: unknown) => {
      fs.writeFileSync(process.env.FAKE_OMP_ASK_RESULT!, JSON.stringify(result) ?? 'null');
    }, (error: unknown) => {
      fs.writeFileSync(process.env.FAKE_OMP_ASK_RESULT!, JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  };
  const askTrigger = process.env.FAKE_OMP_ASK_TRIGGER_FILE;
  if (askTrigger) {
    // Deferred ask: the driver writes the trigger only after its socket client
    // is connected, so the request can only arrive through the live broadcast
    // — the connect-time replay cannot satisfy it.
    const poll = setInterval(() => {
      if (!fs.existsSync(askTrigger)) return;
      clearInterval(poll);
      void fireAsk();
    }, 20);
  } else {
    void fireAsk();
  }
}

for (let attempt = 0; attempt < 100; attempt++) {
  await new Promise<void>(resolve => setTimeout(resolve, 20));
}
async function shutdown(): Promise<void> {
  await emit('session_shutdown', {}, ctx);
  if (process.env.FAKE_OMP_UI_RESTORE_RESULT) {
    fs.writeFileSync(process.env.FAKE_OMP_UI_RESTORE_RESULT, JSON.stringify(ctx.ui.askDialog === nativeAskDialog));
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
console.log('READY');
setInterval(() => {}, 1000);
