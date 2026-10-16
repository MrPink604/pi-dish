import type { LoginAdapter, LoginInteraction, LoginProvider } from "../pi-dish-bridge/login.js";

// OMP keeps the callback-style login API: ctx.modelRegistry.authStorage.oauth
// .login(providerId, { onAuth, onPrompt, onProgress, onManualCodeInput, signal })
// persists the credential (OAuth or a prompted API key) and returns it
// (verified OMP 18.11). The selectable provider list lives in @oh-my-pi/pi-ai.

type HostRecord = Record<PropertyKey, unknown>;
type HostMethod = (this: unknown, ...args: unknown[]) => unknown;

function isObject(value: unknown): value is HostRecord {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function method(target: unknown, name: string): HostMethod | null {
  const value = isObject(target) ? target[name] : undefined;
  return typeof value === "function" ? value as HostMethod : null;
}

let authModule: HostRecord | null = null;

// Launch wrappers live outside this directory tree, where OMP does not
// rewrite bare host-package specifiers; they import the module themselves and
// hand it over (see materializeLaunchWrapper).
export function useOmpAuthModule(module: unknown): void {
  if (method(module, "getOAuthProviders") && isObject(module)) authModule = module;
}

// Runtime plugin boundary, as in native-state.ts: only OMP's executable
// provides this package and its loader rewrites only literal specifiers.
try {
  useOmpAuthModule(await import("@oh-my-pi/pi-ai"));
} catch {}

function oauthApi(ctx: unknown): HostRecord | null {
  const registry = isObject(ctx) ? ctx.modelRegistry : undefined;
  const storage = isObject(registry) ? registry.authStorage : undefined;
  const oauth = isObject(storage) ? storage.oauth : undefined;
  return isObject(oauth) && method(oauth, "login") ? oauth : null;
}

function promptText(value: unknown): { message: string; placeholder?: string } {
  if (typeof value === "string") return { message: value };
  const message = isObject(value) && typeof value.message === "string" ? value.message : "Enter a value:";
  const placeholder = isObject(value) && typeof value.placeholder === "string" ? value.placeholder : undefined;
  return { message, placeholder };
}

function callbacks(ui: LoginInteraction): HostRecord {
  return {
    signal: ui.signal,
    onAuth(info: unknown) {
      if (!isObject(info) || typeof info.url !== "string") return;
      ui.notify({ type: "auth_url", url: info.url, instructions: typeof info.instructions === "string" ? info.instructions : undefined });
    },
    onProgress(message: unknown) {
      if (typeof message === "string") ui.notify({ type: "progress", message });
    },
    onPrompt(prompt: unknown) {
      return ui.prompt({ kind: "text", ...promptText(prompt) });
    },
    // OMP races this against its loopback callback server, so a browser on
    // another device can paste the redirect URL it could not load.
    onManualCodeInput(signal?: unknown) {
      return ui.prompt({
        kind: "code",
        message: "Paste the authorization code or the full redirect URL:",
        signal: signal instanceof AbortSignal ? signal : undefined,
      });
    },
  };
}

export const ompLogin: LoginAdapter = {
  available: ctx => oauthApi(ctx) !== null && authModule !== null,
  providers() {
    const list = authModule ? method(authModule, "getOAuthProviders") : null;
    if (!authModule || !list) throw new Error("OMP's provider catalog is unavailable to the bridge");
    const listed = Reflect.apply(list, authModule, []);
    if (!Array.isArray(listed)) throw new Error("OMP returned an invalid provider list");
    const providers: LoginProvider[] = [];
    for (const provider of listed) {
      if (!isObject(provider) || typeof provider.id !== "string" || provider.available === false) continue;
      providers.push({ id: provider.id, name: typeof provider.name === "string" ? provider.name : provider.id, method: "oauth", configured: false });
    }
    return providers;
  },
  async login(ctx, provider, ui) {
    const oauth = oauthApi(ctx);
    if (!oauth) throw new Error("OMP auth storage unavailable");
    const result = await Reflect.apply(method(oauth, "login")!, oauth, [provider.id, callbacks(ui)]);
    // Same post-login refresh as OMP's TUI; the credential may be stored
    // under a different model provider (zai-coding-plan → zai).
    const registry = isObject(ctx) ? ctx.modelRegistry : undefined;
    const refresh = method(registry, "refreshProvider");
    const credentialProvider = authModule ? method(authModule, "getOAuthCredentialProvider") : null;
    if (refresh) {
      try {
        const target = credentialProvider ? Reflect.apply(credentialProvider, authModule, [provider.id]) : provider.id;
        await Reflect.apply(refresh, registry, [typeof target === "string" ? target : provider.id, "online"]);
      } catch {}
    }
    const email = isObject(result) && typeof result.email === "string" ? result.email : undefined;
    return { account: email, method: isObject(result) && result.type === "api_key" ? "api_key" : "oauth" };
  },
};
