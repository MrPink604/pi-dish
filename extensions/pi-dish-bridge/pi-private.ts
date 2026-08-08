import { AgentSession } from "@earendil-works/pi-coding-agent";

const HOLDER = Symbol.for("pi-dish-bridge.agentSession");
const PATCHED = Symbol.for("pi-dish-bridge.sessionPatch");

try {
  const proto: any = (AgentSession as any)?.prototype;
  if (proto && !proto[PATCHED]) {
    proto[PATCHED] = true;
    for (const name of ["subscribe", "prompt"]) {
      const original = proto[name];
      if (typeof original !== "function") continue;
      proto[name] = function (this: any, ...args: any[]) {
        try { (globalThis as any)[HOLDER] = { current: this }; } catch {}
        return Reflect.apply(original, this, args);
      };
    }
  }
} catch (e) {
  try { process.stderr.write(`[pi-dish-bridge] AgentSession capture patch failed (queue editing disabled): ${e}\n`); } catch {}
}

export function getPiPrivateSession(): any {
  return (globalThis as any)[HOLDER]?.current ?? null;
}
