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
    advisorEnabled?: HostMethod;
    advisorActive?: HostMethod;
    advisorOverview?: HostMethod;
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
  // The stored methods are the originals, not the publication wrappers.
  // Calling them here therefore cannot re-enter publish(). Each accessor is
  // feature-detected on its own: an OMP too old for one still projects the rest.
  const todos = call(state.readers.todos, []);
  const advisorEnabled = call(state.readers.advisorEnabled, undefined);
  return {
    todos: Array.isArray(todos) ? todos : [],
    planMode: call(state.readers.planMode, null),
    prewalk: call(state.readers.prewalk, null),
    // getGoalModeState() returns undefined until a goal exists.
    goal: call(state.readers.goal, null) ?? null,
    advisor: typeof advisorEnabled === "boolean" ? {
      enabled: advisorEnabled,
      active: call(state.readers.advisorActive, false) === true,
      overview: call(state.readers.advisorOverview, null) ?? null,
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
  const alreadyPatched = proto[PATCHED_KEY] === true;
  proto[PATCHED_KEY] = true;

  const capture = (name: string, readerKey?: keyof ObserverState["readers"]) => {
    // State survives extension reloads. Readers already present point at the
    // unwrapped host methods and must not be replaced with an older wrapper
    // (that would recurse through publish). A previously patched prototype may
    // still need newly added readers, while its existing setters need no wrap.
    if (readerKey && state.readers[readerKey]) return;
    if (!readerKey && alreadyPatched) return;
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
  // Advisor runtime status can change after model discovery without going
  // through a setter. OMP's status line reads this overview on render; wrap
  // the read as a publication trigger while readProjection calls the stored
  // original methods to avoid recursion.
  capture("isAdvisorEnabled", "advisorEnabled");
  capture("isAdvisorActive", "advisorActive");
  capture("getAdvisorStatusOverview", "advisorOverview");
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
