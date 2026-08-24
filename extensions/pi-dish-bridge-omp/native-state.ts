export type OmpNativeProjection = {
  todos: unknown[];
  planMode: unknown | null;
  prewalk: unknown | null;
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
  const todos = call(state.readers.todos, []);
  return {
    todos: Array.isArray(todos) ? todos : [],
    planMode: call(state.readers.planMode, null),
    prewalk: call(state.readers.prewalk, null),
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
  capture("setTodoPhases");
  capture("setPlanModeState");
  capture("subscribe");
}

// Runtime plugin boundary: OMP's standalone executable provides this package,
// while pi-dish's fake lineage hosts intentionally do not install it. Keep the
// optional host module runtime-selected so those hosts can exercise the wrapper.
const OMP_HOST_PACKAGE = "@oh-my-pi/pi-coding-agent";
try {
  const host: unknown = await import(OMP_HOST_PACKAGE);
  if (host && typeof host === "object" && "AgentSession" in host && isHostConstructor(host.AgentSession)) {
    patchAgentSession(host.AgentSession);
  }
} catch {}

export function getOmpNativeProjection(): OmpNativeProjection | null {
  return state.current ? readProjection(state.current) : null;
}

export function subscribeOmpNativeProjection(listener: (projection: OmpNativeProjection) => void): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
