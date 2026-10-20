// Pi and OMP implement ExtensionAPI.sendUserMessage() as a synchronous call
// into AgentSession.sendUserMessage() whose rejection reaches only the host's
// own TUI (`.catch(...)`; verified Pi 0.85, OMP 18.11). A prompt the host
// refused before admitting it — a signed-out provider, no model — therefore
// looked delivered to pi-dish and was lost. Adapters holding the host's
// AgentSession class patch it here once; the bridge core then captures the
// promise of the call its own public sendUserMessage() makes, leaving the
// host's delivery path (and its TUI error) intact.
//
// The sink lives in the symbol registry because an extension reload evaluates
// a new module copy against the already-patched prototype.

const PATCHED = Symbol.for("pi-dish-bridge.sendUserMessageObserved");
const SINK = Symbol.for("pi-dish-bridge.sendUserMessageSink");
const sharedGlobal = globalThis as unknown as Record<PropertyKey, unknown>;

type HostRecord = Record<PropertyKey, unknown>;
type HostMethod = (this: unknown, ...args: unknown[]) => unknown;

function isObject(value: unknown): value is HostRecord {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function isMethod(value: unknown): value is HostMethod {
  return typeof value === "function";
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && isMethod(value.then);
}

export function observeSendUserMessage(AgentSession: unknown): void {
  const proto = isObject(AgentSession) ? AgentSession.prototype : undefined;
  if (!isObject(proto) || proto[PATCHED]) return;
  const original = proto.sendUserMessage;
  if (!isMethod(original)) return;
  Object.defineProperty(proto, PATCHED, { value: true });
  proto.sendUserMessage = function (this: unknown, ...args: unknown[]) {
    const result = Reflect.apply(original, this, args);
    const sink = sharedGlobal[SINK];
    if (isMethod(sink)) Reflect.apply(sink, undefined, [result]);
    return result;
  } satisfies HostMethod;
}

/**
 * Run `send` and return what it returned plus the promise of the first
 * AgentSession.sendUserMessage() it made synchronously. `promise` is null when
 * the host never reached a patched session (no adapter, or a host whose public
 * API stopped delegating synchronously); callers keep the public outcome then.
 */
export function captureSendUserMessage(send: () => unknown): { returned: unknown; promise: Promise<unknown> | null } {
  const slot: { promise: Promise<unknown> | null } = { promise: null };
  const previous = sharedGlobal[SINK];
  sharedGlobal[SINK] = (result: unknown) => {
    if (!slot.promise && isThenable(result)) slot.promise = Promise.resolve(result);
  };
  try {
    const returned = send();
    return { returned, promise: slot.promise };
  } finally {
    sharedGlobal[SINK] = previous;
  }
}
