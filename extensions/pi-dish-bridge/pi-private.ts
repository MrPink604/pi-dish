import { AgentSession } from "@earendil-works/pi-coding-agent";

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

export function getPiPrivateSession(): unknown {
  const holder = sharedGlobal[HOLDER];
  return holder && typeof holder === "object" && "current" in holder ? holder.current : null;
}
