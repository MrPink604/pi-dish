import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import type { LoginAdapter, LoginEvent, LoginInteraction, LoginProvider } from "./login.js";

// Pi's extension API exposes no login. Its ModelRegistry facade wraps the
// session's ModelRuntime in a private `runtime` field, which owns the same
// provider catalog and login() the TUI's /login uses (verified pi 0.85.1 and
// 1.3.0). Unexpected shapes make the capability unavailable rather than throw.

type HostRecord = Record<PropertyKey, unknown>;
type HostMethod = (this: unknown, ...args: unknown[]) => unknown;

function isObject(value: unknown): value is HostRecord {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function method(target: unknown, name: string): HostMethod | null {
  const value = isObject(target) ? target[name] : undefined;
  return typeof value === "function" ? value as HostMethod : null;
}

function runtime(ctx: unknown): HostRecord | null {
  const registry = isObject(ctx) ? ctx.modelRegistry : undefined;
  const value = isObject(registry) ? registry.runtime : undefined;
  return isObject(value) && method(value, "login") && method(value, "getProviders") ? value : null;
}

function toLoginEvent(event: AuthEvent): LoginEvent | null {
  switch (event.type) {
    case "auth_url": return { type: "auth_url", url: event.url, instructions: event.instructions };
    case "device_code": return { type: "device_code", userCode: event.userCode, url: event.verificationUri };
    case "progress": return { type: "progress", message: event.message };
    case "info": return { type: "progress", message: event.message };
    default: return null;
  }
}

function promptFor(prompt: AuthPrompt, ui: LoginInteraction): Promise<string> {
  switch (prompt.type) {
    case "select":
      return ui.prompt({ kind: "select", message: prompt.message, options: prompt.options, signal: prompt.signal });
    case "manual_code":
      return ui.prompt({ kind: "code", message: prompt.message, placeholder: prompt.placeholder, signal: prompt.signal });
    case "secret":
      return ui.prompt({ kind: "secret", message: prompt.message, placeholder: prompt.placeholder, signal: prompt.signal });
    default:
      return ui.prompt({ kind: "text", message: prompt.message, placeholder: prompt.placeholder, signal: prompt.signal });
  }
}

export const piLogin: LoginAdapter = {
  available: ctx => runtime(ctx) !== null,
  providers(ctx) {
    const host = runtime(ctx);
    if (!host) throw new Error("pi model runtime unavailable");
    const listed = Reflect.apply(method(host, "getProviders")!, host, []);
    if (!Array.isArray(listed)) throw new Error("pi returned an invalid provider list");
    const status = method(host, "getProviderAuthStatus");
    const providers: LoginProvider[] = [];
    for (const provider of listed) {
      if (!isObject(provider) || typeof provider.id !== "string") continue;
      const name = typeof provider.name === "string" ? provider.name : provider.id;
      const auth = isObject(provider.auth) ? provider.auth : {};
      const authStatus = status ? Reflect.apply(status, host, [provider.id]) : undefined;
      const configured = isObject(authStatus) && authStatus.configured === true;
      // Mirrors pi's own /login options: every OAuth method, and api-key
      // methods that can prompt (ambient-only providers have no login()).
      if (isObject(auth.oauth)) providers.push({ id: provider.id, name, method: "oauth", configured });
      if (method(auth.apiKey, "login")) providers.push({ id: provider.id, name, method: "api_key", configured });
    }
    return providers;
  },
  async login(ctx, provider, ui) {
    const host = runtime(ctx);
    if (!host) throw new Error("pi model runtime unavailable");
    const interaction: AuthInteraction = {
      signal: ui.signal,
      prompt: prompt => promptFor(prompt, ui),
      notify(event) {
        const mapped = toLoginEvent(event);
        if (mapped) ui.notify(mapped);
      },
    };
    await Reflect.apply(method(host, "login")!, host, [provider.id, provider.method, interaction]);
    // Same post-login refresh as pi's TUI; a slow catalog is not a failed login.
    const refresh = method(host, "refresh");
    if (refresh) {
      try { await Reflect.apply(refresh, host, [{ providers: [provider.id], signal: AbortSignal.timeout(15_000) }]); } catch {}
    }
    return {};
  },
};
