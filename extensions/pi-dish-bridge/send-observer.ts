// ExtensionAPI.sendUserMessage() calls AgentSession.sendUserMessage()
// synchronously and the rejection reaches only the host's TUI (verified Pi
// 0.85, OMP 18.11), so a refused prompt looked delivered to pi-dish. Patch the
// host's class once and capture that promise, leaving its delivery path intact.
// The sink lives in the symbol registry: a reload evaluates a new module copy
// against the already-patched prototype.

import { isHostMethod, isObject, type HostMethod } from "./host.js";

const PATCHED = Symbol.for("pi-dish-bridge.sendUserMessageObserved");
const SINK = Symbol.for("pi-dish-bridge.sendUserMessageSink");
const sharedGlobal = globalThis as unknown as Record<PropertyKey, unknown>;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && isHostMethod(value.then);
}

export function observeSendUserMessage(AgentSession: unknown): void {
  const proto = isObject(AgentSession) ? AgentSession.prototype : undefined;
  if (!isObject(proto) || proto[PATCHED]) return;
  const original = proto.sendUserMessage;
  if (!isHostMethod(original)) return;
  Object.defineProperty(proto, PATCHED, { value: true });
  proto.sendUserMessage = function (this: unknown, ...args: unknown[]) {
    const result = Reflect.apply(original, this, args);
    const sink = sharedGlobal[SINK];
    if (isHostMethod(sink)) Reflect.apply(sink, undefined, [result]);
    return result;
  } satisfies HostMethod;
}

/**
 * Run `send` and return the promise that settles with the host's delivery: the
 * first AgentSession.sendUserMessage() it made synchronously, else a thenable
 * the public API itself returned (OMP 18.18 returns the AgentSession promise).
 * Either may settle only when the whole turn ends. `null` when the host gave
 * neither; callers keep the public outcome then.
 */
export function captureSendUserMessage(send: () => unknown): Promise<unknown> | null {
  const slot: { promise: Promise<unknown> | null } = { promise: null };
  const previous = sharedGlobal[SINK];
  sharedGlobal[SINK] = (result: unknown) => {
    if (!slot.promise && isThenable(result)) slot.promise = Promise.resolve(result);
  };
  try {
    const returned = send();
    return slot.promise ?? (isThenable(returned) ? Promise.resolve(returned) : null);
  } finally {
    sharedGlobal[SINK] = previous;
  }
}
