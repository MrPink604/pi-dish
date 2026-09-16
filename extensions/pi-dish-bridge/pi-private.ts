import { AgentSession } from "@earendil-works/pi-coding-agent";

// Pi's extension runner omits queue/private compaction events. Capture the live
// receiver once; the global holder survives extension reloads on the same session.
// Only the consumed operations below cross into the shared bridge core.
export interface PiPrivateOperations {
  readQueue(): { steering: string[]; followUp: string[] } | null;
  followUpCount(): number | null;
  cancelQueued(kind: "steering" | "followUp", index: number, text: string): void;
  subscribe(listener: (event: unknown) => void): (() => void) | null;
  isCompacting(): boolean;
  abortCompactionIfRunning(buffering: boolean): void;
  captureCommand(command: "/dish-prime" | "/dish-reload" | "/dish-bounce-reload"): (() => unknown) | null;
}

const HOLDER = Symbol.for("pi-dish-bridge.agentSession");
const PATCHED = Symbol.for("pi-dish-bridge.sessionPatch");

const sharedGlobal = globalThis as unknown as Record<PropertyKey, unknown>;

try {
  const proto = AgentSession.prototype;
  if (!Reflect.get(proto, PATCHED)) {
    Object.defineProperty(proto, PATCHED, { value: true });
    const subscribe = proto.subscribe;
    if (typeof subscribe === "function") {
      proto.subscribe = function (this: AgentSession, ...args: Parameters<AgentSession["subscribe"]>) {
        try { sharedGlobal[HOLDER] = { current: this }; } catch {}
        return subscribe.apply(this, args);
      };
    }
    const prompt = proto.prompt;
    if (typeof prompt === "function") {
      proto.prompt = function (this: AgentSession, ...args: Parameters<AgentSession["prompt"]>) {
        try { sharedGlobal[HOLDER] = { current: this }; } catch {}
        return prompt.apply(this, args);
      };
    }
  }
} catch (e) {
  try { process.stderr.write(`[pi-dish-bridge] AgentSession capture patch failed (queue editing disabled): ${e}\n`); } catch {}
}

type PrivateSession = Record<PropertyKey, unknown>;
type PrivateMethod = (this: unknown, ...args: unknown[]) => unknown;

function isObject(value: unknown): value is PrivateSession {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function field(value: unknown, key: PropertyKey): unknown {
  return isObject(value) ? value[key] : undefined;
}

function isMethod(value: unknown): value is PrivateMethod {
  return typeof value === "function";
}

function call(target: unknown, name: string, ...args: unknown[]): unknown {
  const method = field(target, name);
  if (!isMethod(method)) throw new Error(`host does not expose ${name}`);
  return Reflect.apply(method, target, args);
}

function capturedSession(): PrivateSession | null {
  try {
    const holder = sharedGlobal[HOLDER];
    const session = holder && typeof holder === "object" && "current" in holder ? holder.current : null;
    if (isObject(session) && isMethod(session.subscribe)) return session;
  } catch {}
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item: unknown) => typeof item === "string")) {
    throw new Error("host returned an invalid string array");
  }
  return value;
}

// Match AgentSession's delivery text without discarding images or metadata from
// the agent-core queue. Only the selected index is removed from either array.
function queueEntryText(entry: unknown): string {
  if (typeof entry === "string") return entry;
  const content = Array.isArray(entry) ? entry : field(entry, "content");
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content.filter((part: unknown) => field(part, "type") === "text").map((part: unknown) => field(part, "text")).join("")
    : "";
}

export const piPrivate: PiPrivateOperations = {
  readQueue() {
    const session = capturedSession();
    if (!session) return null;
    try {
      return {
        steering: [...stringArray(call(session, "getSteeringMessages"))],
        followUp: [...stringArray(call(session, "getFollowUpMessages"))],
      };
    } catch {
      return null;
    }
  },

  followUpCount() {
    const session = capturedSession();
    try {
      if (!isMethod(field(session, "getFollowUpMessages"))) return null;
      const visible = call(session, "getFollowUpMessages");
      return Array.isArray(visible) ? visible.length : null;
    } catch {
      return null;
    }
  },

  cancelQueued(kind, index, text) {
    const session = capturedSession();
    const unavailable = "queue editing unavailable (pi internals changed — update pi-dish-bridge)";
    if (!session) throw new Error(unavailable);
    const display = kind === "steering" ? session._steeringMessages : session._followUpMessages;
    if (!Array.isArray(display) || typeof session._emitQueueUpdate !== "function") {
      throw new Error(unavailable);
    }
    const messages = field(field(session.agent, kind === "steering" ? "steeringQueue" : "followUpQueue"), "messages");
    if (!Array.isArray(messages)) throw new Error(unavailable);
    // Validate both aligned projections before mutating either. Searching by
    // text would remove the wrong duplicate and its associated image payload.
    if (display.length !== messages.length) {
      throw new Error("queue editing unavailable (pi queues are out of sync — retry after the next queue update)");
    }
    if (index >= display.length || queueEntryText(display[index]) !== text ||
        queueEntryText(messages[index]) !== text) {
      throw new Error("message already delivered or queue changed");
    }
    display.splice(index, 1);
    messages.splice(index, 1);
    call(session, "_emitQueueUpdate");
  },

  subscribe(listener) {
    const session = capturedSession();
    if (!session) return null;
    const unsubscribe = call(session, "subscribe", listener);
    return isMethod(unsubscribe) ? () => { Reflect.apply(unsubscribe, undefined, []); } : null;
  },

  isCompacting() {
    return !!capturedSession()?.isCompacting;
  },

  // Pi's ordinary abort leaves its separate compaction controllers running.
  // The private compaction_end event releases shared core's send buffer.
  abortCompactionIfRunning(buffering) {
    const session = capturedSession();
    if ((buffering || session?.isCompacting) && typeof session?.abortCompaction === "function") {
      try { call(session, "abortCompaction"); } catch {}
    }
  },

  captureCommand(command) {
    const session = capturedSession();
    if (!session || typeof session.prompt !== "function") return null;
    // Keep this receiver even if another session is captured before a deferred
    // reload runs. Resolve its method at invocation, as the original path did.
    return () => call(session, "prompt", command);
  },
};
