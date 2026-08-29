export type OmpNativeProjection = {
  todos: unknown[];
  planMode: unknown | null;
  prewalk: unknown | null;
  goal: unknown | null;
  advisor: { enabled: boolean; active: boolean; overview: unknown | null } | null;
};

type HostSession = Record<PropertyKey, unknown>;
type HostMethod = (this: HostSession, ...args: unknown[]) => unknown;
type ObserverState = {
  current: HostSession | null;
  signature: string | null;
  listeners: Set<(projection: OmpNativeProjection) => void>;
  readers: {
    todos?: HostMethod;
    planMode?: HostMethod;
    prewalk?: HostMethod;
    goal?: HostMethod;
  };
};

const STATE_KEY = Symbol.for("pi-dish-bridge.omp-native-state");
const PATCHED_KEY = Symbol.for("pi-dish-bridge.omp-native-state-patched");
// The symbol registry deliberately survives OMP's extension module reload.
const sharedGlobal = globalThis as unknown as Record<PropertyKey, unknown>;
const cachedState = sharedGlobal[STATE_KEY];
let state: ObserverState;
if (isObserverState(cachedState)) {
  state = cachedState;
} else {
  state = {
    current: null,
    signature: null,
    listeners: new Set<(projection: OmpNativeProjection) => void>(),
    readers: {},
  };
  sharedGlobal[STATE_KEY] = state;
}

function isObserverState(value: unknown): value is ObserverState {
  return !!value && typeof value === "object" && "listeners" in value && value.listeners instanceof Set;
}

function isHostConstructor(value: unknown): value is { prototype: HostSession } {
  return typeof value === "function" && "prototype" in value && !!value.prototype && typeof value.prototype === "object";
}

function readProjection(session: HostSession): OmpNativeProjection {
  const call = (reader: HostMethod | undefined, fallback: unknown): unknown => {
    if (!reader) return fallback;
    try { return Reflect.apply(reader, session, []); } catch { return fallback; }
  };
  // The advisor accessors are pure reads OMP never routes state changes
  // through, so they are called straight off the session instead of being
  // captured — nothing here can re-enter publish(). Each is feature-detected
  // on its own: an OMP too old for one of them still projects the rest.
  const read = (name: string): unknown => {
    const method = session[name];
    if (typeof method !== "function") return undefined;
    try { return Reflect.apply(method as HostMethod, session, []); } catch { return undefined; }
  };
  const todos = call(state.readers.todos, []);
  const advisorEnabled = read("isAdvisorEnabled");
  return {
    todos: Array.isArray(todos) ? todos : [],
    planMode: call(state.readers.planMode, null),
    prewalk: call(state.readers.prewalk, null),
    // getGoalModeState() returns undefined until a goal exists.
    goal: call(state.readers.goal, null) ?? null,
    advisor: typeof advisorEnabled === "boolean" ? {
      enabled: advisorEnabled,
      active: read("isAdvisorActive") === true,
      overview: read("getAdvisorStatusOverview") ?? null,
    } : null,
  };
}

function publish(session: HostSession): void {
  state.current = session;
  const projection = readProjection(session);
  let signature: string;
  try { signature = JSON.stringify(projection); } catch { return; }
  if (signature === state.signature) return;
  state.signature = signature;
  for (const listener of state.listeners) {
    try { listener(projection); } catch {}
  }
}

function patchAgentSession(AgentSession: { prototype: HostSession }): void {
  const proto = AgentSession.prototype;
  if (proto[PATCHED_KEY]) return;
  proto[PATCHED_KEY] = true;

  const capture = (name: string, readerKey?: keyof ObserverState["readers"]) => {
    const candidate = proto[name];
    if (typeof candidate !== "function") return;
    const original = candidate as HostMethod;
    if (readerKey) state.readers[readerKey] = original;
    proto[name] = function (this: HostSession, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      publish(this);
      return result;
    } satisfies HostMethod;
  };

  capture("getTodoPhases", "todos");
  capture("getPlanModeState", "planMode");
  capture("getPrewalkState", "prewalk");
  // OMP reads goal state on every status-line render and writes it on every
  // mode transition, so capturing both keeps the projection fresh without a
  // poller of our own.
  capture("getGoalModeState", "goal");
  capture("setTodoPhases");
  capture("setPlanModeState");
  capture("setGoalModeState");
  capture("setAdvisorEnabled");
  capture("toggleAdvisorEnabled");
  capture("applyAdvisorConfigs");
  capture("subscribe");
}

// Runtime plugin boundary: OMP's standalone executable provides this package,
// while pi-dish's fake lineage hosts intentionally do not install it — the
// dynamic import stays inside try/catch so those hosts can exercise the
// wrapper. The specifier MUST be a string literal: OMP's extension loader
// statically rewrites literal bare pi-package specifiers to its bundled
// modules, and a variable specifier falls through to plain filesystem
// resolution, which cannot find the package and silently disabled the whole
// projection in real sessions.
try {
  const host: unknown = await import("@oh-my-pi/pi-coding-agent");
  if (host && typeof host === "object" && "AgentSession" in host && isHostConstructor(host.AgentSession)) {
    patchAgentSession(host.AgentSession);
  }
} catch {}

// Exported for pi-dish's fake OMP host, which cannot install OMP's package and
// so patches a stand-in AgentSession class with the same prototype shape.
export function patchOmpAgentSession(AgentSession: unknown): void {
  if (isHostConstructor(AgentSession)) patchAgentSession(AgentSession);
}

export function getOmpNativeProjection(): OmpNativeProjection | null {
  return state.current ? readProjection(state.current) : null;
}

export function subscribeOmpNativeProjection(listener: (projection: OmpNativeProjection) => void): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
