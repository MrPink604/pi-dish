export type OmpNativeProjection = {
  todos: unknown[];
  planMode: unknown | null;
  prewalk: unknown | null;
  goal: unknown | null;
  advisor: { enabled: boolean; active: boolean; overview: unknown | null } | null;
};

type HostSession = Record<PropertyKey, unknown>;
type HostMethod = (this: HostSession, ...args: unknown[]) => unknown;
type Readers = {
  todos?: HostMethod;
  planMode?: HostMethod;
  prewalk?: HostMethod;
  goal?: HostMethod;
  advisorEnabled?: HostMethod;
  advisorActive?: HostMethod;
  advisorOverview?: HostMethod;
};
type Subscriber = { owner: object; listener: (projection: OmpNativeProjection) => void; signature: string | null };
type ObserverState = {
  // Diagnostics for "capture never fired" reports: how many AgentSession
  // classes got patched and how many accessor calls ever published.
  patches: number;
  publishes: number;
  readers: Readers;
  // The patched prototype is shared by every AgentSession in the process,
  // including OMP's in-process subagents. Captures are keyed by the session's
  // SessionManager — the same object OMP hands the extension runner as
  // ctx.sessionManager — so a bridge only ever sees its own session.
  sessions: WeakMap<object, HostSession>;
  subscribers: Set<Subscriber>;
  // Wrappers dispatch through the shared state, so a reloaded module copy
  // takes over publication without re-wrapping the prototype.
  publish: (session: HostSession) => void;
};

const STATE_KEY = Symbol.for("pi-dish-bridge.omp-native-state");
const PATCHED_KEY = Symbol.for("pi-dish-bridge.omp-native-state-patched");
// Prototypes marked `true` carry the unscoped wrappers of module copies that
// predate ownership; they are re-patched on load.
const PATCH_VERSION = 2;
// The symbol registry deliberately survives OMP's extension module reload.
const sharedGlobal = globalThis as unknown as Record<PropertyKey, unknown>;
const cachedState = sharedGlobal[STATE_KEY];
const state: ObserverState = isObserverState(cachedState) ? cachedState : {
  patches: counter(cachedState, "patches"),
  publishes: counter(cachedState, "publishes"),
  // Readers captured by an older copy are the host originals; keep them so
  // re-patching can drop that copy's reader wrappers.
  readers: legacyReaders(cachedState),
  sessions: new WeakMap<object, HostSession>(),
  subscribers: new Set<Subscriber>(),
  publish,
};
state.publish = publish;
sharedGlobal[STATE_KEY] = state;

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return !!value && typeof value === "object";
}

function isObserverState(value: unknown): value is ObserverState {
  return isObject(value) && value.sessions instanceof WeakMap && value.subscribers instanceof Set &&
    isObject(value.readers) && typeof value.patches === "number" && typeof value.publishes === "number";
}

function counter(value: unknown, key: string): number {
  return isObject(value) && typeof value[key] === "number" ? value[key] : 0;
}

function legacyReaders(value: unknown): Readers {
  if (!isObject(value) || !isObject(value.readers)) return {};
  const readers: Readers = {};
  for (const [key, reader] of Object.entries(value.readers)) {
    if (typeof reader === "function") readers[key as keyof Readers] = reader as HostMethod;
  }
  return readers;
}

function isHostConstructor(value: unknown): value is { prototype: HostSession } {
  return typeof value === "function" && "prototype" in value && !!value.prototype && typeof value.prototype === "object";
}

function isHostMethod(value: unknown): value is HostMethod {
  return typeof value === "function";
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
  state.publishes += 1;
  const owner = session.sessionManager;
  if (!isObject(owner)) return;
  state.sessions.set(owner, session);
  let projection: OmpNativeProjection | null = null;
  let signature = "";
  for (const subscriber of state.subscribers) {
    if (subscriber.owner !== owner) continue;
    if (!projection) {
      projection = readProjection(session);
      try { signature = JSON.stringify(projection); } catch { return; }
    }
    if (signature === subscriber.signature) continue;
    subscriber.signature = signature;
    try { subscriber.listener(projection); } catch {}
  }
}

function patchAgentSession(AgentSession: { prototype: HostSession }): void {
  const proto = AgentSession.prototype;
  const marker = proto[PATCHED_KEY];
  const legacy = marker === true;
  const current = marker === PATCH_VERSION;
  proto[PATCHED_KEY] = PATCH_VERSION;
  state.patches += 1;

  const capture = (name: string, readerKey?: keyof Readers) => {
    // Readers already present point at the unwrapped host methods and must not
    // be replaced with a wrapper (that would recurse through publish). A
    // current prototype may still need newly added readers, while its existing
    // setters need no wrap. A legacy prototype gets fresh reader wrappers
    // around the stored originals; its setter wrappers stay underneath the new
    // ones and publish only to legacy listeners.
    if (readerKey && state.readers[readerKey] && !legacy) return;
    if (!readerKey && current) return;
    const candidate = proto[name];
    if (!isHostMethod(candidate)) return;
    const original = (readerKey && state.readers[readerKey]) || candidate;
    if (readerKey) state.readers[readerKey] = original;
    proto[name] = function (this: HostSession, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      state.publish(this);
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

// The live AgentSession owning `sessionManager` (the bridge's
// ctx.sessionManager), stashed by its first patched-accessor call. /btw needs
// the instance (AgentSession.runEphemeralTurn) — the projection only exposes
// derived state. Null until OMP first calls one of the patched accessors on
// that session (subscribe at session start, or any status-line read), so
// callers must treat null as "no session yet", not an error.
export function getOmpNativeSession(sessionManager: unknown): HostSession | null {
  return isObject(sessionManager) ? state.sessions.get(sessionManager) ?? null : null;
}

export function getOmpNativeProjection(sessionManager: unknown): OmpNativeProjection | null {
  const session = getOmpNativeSession(sessionManager);
  return session ? readProjection(session) : null;
}

// Capture health for /btw-style consumers: a patched class that never
// published means the host built its session from a different AgentSession
// (or an import failure kept the patch from ever applying).
export function getOmpNativeCaptureStats(sessionManager: unknown): { patches: number; publishes: number; captured: boolean } {
  return { patches: state.patches, publishes: state.publishes, captured: getOmpNativeSession(sessionManager) !== null };
}

export function subscribeOmpNativeProjection(
  sessionManager: unknown,
  listener: (projection: OmpNativeProjection) => void,
): () => void {
  if (!isObject(sessionManager)) return () => {};
  const subscriber: Subscriber = { owner: sessionManager, listener, signature: null };
  state.subscribers.add(subscriber);
  return () => state.subscribers.delete(subscriber);
}
