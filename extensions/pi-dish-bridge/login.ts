import * as crypto from "node:crypto";

// Remote /login: the harness owns credentials and the provider flows; the
// bridge only relays each flow step to pi-dish as an `auth` dialog. Wrappers
// adapt their host's login API to this neutral interaction.

export type LoginMethod = "oauth" | "api_key";
export type LoginProvider = { id: string; name: string; method: LoginMethod; configured: boolean };
export type LoginOption = { id: string; label: string; description?: string };
export type LoginPrompt = {
  kind: "select" | "text" | "secret" | "code";
  message: string;
  placeholder?: string;
  options?: readonly LoginOption[];
  // Aborted by the flow when an out-of-band event (callback server) answers
  // the step first.
  signal?: AbortSignal;
};
export type LoginEvent =
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; url: string }
  | { type: "progress"; message: string };
export type LoginInteraction = {
  signal: AbortSignal;
  prompt(prompt: LoginPrompt): Promise<string>;
  notify(event: LoginEvent): void;
};
// `method` reports what the host actually stored when one flow can yield
// either (OMP providers that prompt for an API key).
export type LoginResult = { account?: string; method?: LoginMethod };
export type LoginAdapter = {
  /** Whether this host context exposes the login API at all. */
  available(ctx: unknown): boolean;
  providers(ctx: unknown): LoginProvider[];
  /** Runs the host flow, persists credentials, refreshes the provider's models. */
  login(ctx: unknown, provider: LoginProvider, interaction: LoginInteraction): Promise<LoginResult>;
};

export type LoginDialogPort = {
  /** Register a pending dialog and deliver it to connected clients. */
  open(request: Record<string, unknown> & { method: "auth"; id: string }, onResponse: (response: unknown) => void): void;
  /** Drop a pending dialog and tell clients it is gone. */
  close(id: string, source: "superseded" | "login"): void;
  notify(message: string, type: "info" | "error"): void;
};

class LoginCancelled extends Error {
  constructor() { super("Login cancelled"); }
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

// Links are rendered as clickable anchors in the browser; only web pages.
function webUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function methodLabel(method: LoginMethod): string {
  return method === "oauth" ? "Sign in with an account" : "API key";
}

const SUBMITTED = "Submitted — waiting for the provider…";
const STARTING = "Starting sign-in…";

type PendingPrompt = Omit<LoginPrompt, "signal"> & { resolve(value: string): void; reject(error: Error): void };

type Flow = {
  loginId: string;
  abort: AbortController;
  title: string;
  stepId: string | null;
  message?: string;
  url?: string;
  instructions?: string;
  userCode?: string;
  prompt: PendingPrompt | null;
  renderQueued: boolean;
};

export function createLoginController(port: LoginDialogPort, adapter: LoginAdapter) {
  let active: Flow | null = null;

  function render(flow: Flow) {
    if (active !== flow || flow.abort.signal.aborted) return;
    const id = crypto.randomUUID();
    const prompt = flow.prompt
      ? { kind: flow.prompt.kind, message: flow.prompt.message, placeholder: flow.prompt.placeholder, options: flow.prompt.options }
      : undefined;
    const previous = flow.stepId;
    flow.stepId = id;
    // Deliver the replacement before retiring the old step so clients swap
    // the card in place rather than flashing an empty dock.
    port.open({
      method: "auth", id, loginId: flow.loginId, title: flow.title,
      message: flow.message, url: flow.url, instructions: flow.instructions, userCode: flow.userCode, prompt,
    }, response => respond(flow, id, response));
    if (previous) port.close(previous, "superseded");
  }

  // Flows often notify and prompt in the same tick (auth URL, then the paste
  // prompt); coalesce so each visible state is one step.
  function scheduleRender(flow: Flow) {
    if (flow.renderQueued) return;
    flow.renderQueued = true;
    queueMicrotask(() => {
      flow.renderQueued = false;
      render(flow);
    });
  }

  function respond(flow: Flow, stepId: string, response: unknown) {
    if (active !== flow) return;
    if (field(response, "cancelled") === true) {
      flow.abort.abort(new LoginCancelled());
      return;
    }
    const prompt = flow.prompt;
    if (!prompt || stepId !== flow.stepId) return;
    const value = field(response, "value");
    flow.prompt = null;
    flow.message = prompt.kind === "select" ? STARTING : SUBMITTED;
    // Resolve first: the flow's continuation (next title/notify/prompt) then
    // lands before the coalesced render instead of as an extra empty step.
    prompt.resolve(typeof value === "string" ? value : "");
    scheduleRender(flow);
  }

  function interaction(flow: Flow): LoginInteraction {
    return {
      signal: flow.abort.signal,
      prompt(request) {
        const signals = [flow.abort.signal, ...(request.signal ? [request.signal] : [])];
        if (signals.some(signal => signal.aborted)) return Promise.reject(new LoginCancelled());
        return new Promise<string>((resolve, reject) => {
          const pending: PendingPrompt = {
            kind: request.kind, message: request.message, placeholder: request.placeholder, options: request.options,
            resolve: value => { cleanup(); resolve(value); },
            reject: error => { cleanup(); reject(error); },
          };
          const onAbort = () => {
            if (flow.prompt === pending) {
              flow.prompt = null;
              // The callback server answered on the harness machine.
              if (!flow.abort.signal.aborted) flow.message = "Sign-in received — finishing…";
              scheduleRender(flow);
            }
            pending.reject(new LoginCancelled());
          };
          const cleanup = () => { for (const signal of signals) signal.removeEventListener("abort", onAbort); };
          for (const signal of signals) signal.addEventListener("abort", onAbort, { once: true });
          // A newer prompt replaces an unanswered one; the flow is not
          // expected to wait on both.
          flow.prompt?.reject(new LoginCancelled());
          flow.prompt = pending;
          // Asked again right after a submission: the host rejected it
          // (wrong login's URL, truncated paste) and is waiting for another.
          if (flow.message === SUBMITTED && request.kind === "code") {
            flow.message = "That didn't complete sign-in. Paste the full address of the page this sign-in redirected to.";
          } else if (flow.message === STARTING) {
            flow.message = undefined;
          }
          scheduleRender(flow);
        });
      },
      notify(event) {
        if (event.type === "auth_url") {
          flow.url = webUrl(event.url);
          flow.instructions = event.instructions;
          flow.userCode = undefined;
          flow.message = undefined;
        } else if (event.type === "device_code") {
          flow.url = webUrl(event.url);
          flow.userCode = event.userCode;
          flow.instructions = "Open the page and enter this code.";
          flow.message = undefined;
        } else {
          flow.message = event.message;
        }
        scheduleRender(flow);
      },
    };
  }

  function finish(flow: Flow) {
    flow.prompt?.reject(new LoginCancelled());
    flow.prompt = null;
    if (flow.stepId) port.close(flow.stepId, "login");
    flow.stepId = null;
    if (active === flow) active = null;
  }

  async function run(flow: Flow, ctx: unknown, choices: readonly LoginProvider[]) {
    const ui = interaction(flow);
    let provider: LoginProvider | undefined = choices.length === 1 ? choices[0] : undefined;
    try {
      if (!provider) {
        const sameProvider = choices.every(choice => choice.id === choices[0]?.id);
        // Method labels only help when the list mixes sign-in and API keys.
        const mixed = choices.some(choice => choice.method !== choices[0]?.method);
        const options = choices.map(choice => ({
          id: `${choice.method}:${choice.id}`,
          label: sameProvider ? methodLabel(choice.method) : choice.name,
          description: [!sameProvider && mixed ? methodLabel(choice.method) : undefined, choice.configured ? "configured" : undefined]
            .filter(Boolean).join(" · ") || undefined,
        }));
        const picked = await ui.prompt({
          kind: "select",
          message: sameProvider ? `How do you want to sign in to ${choices[0]?.name}?` : "Choose a provider to sign in to:",
          options,
        });
        provider = choices.find(choice => `${choice.method}:${choice.id}` === picked);
        if (!provider) throw new LoginCancelled();
      }
      flow.title = `Log in to ${provider.name}`;
      flow.message = STARTING;
      scheduleRender(flow);
      const result = await adapter.login(ctx, provider, ui);
      if (flow.abort.signal.aborted) throw new LoginCancelled();
      finish(flow);
      const verb = (result.method ?? provider.method) === "oauth" ? "Logged in to" : "Saved API key for";
      port.notify(`${verb} ${provider.name}${result.account ? ` as ${result.account}` : ""}`, "info");
    } catch (error) {
      const cancelled = flow.abort.signal.aborted || error instanceof LoginCancelled;
      // A newer /login replaced this one; its own card is already showing.
      const replaced = active !== flow;
      finish(flow);
      if (replaced) return;
      if (cancelled) {
        port.notify("Login cancelled", "info");
        return;
      }
      // Host errors can embed request dumps and stacks; a toast needs the gist.
      const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 300);
      port.notify(`Login${provider ? ` to ${provider.name}` : ""} failed: ${reason}`, "error");
    }
  }

  return {
    /** Starts a login and returns once its first step is queued; a running login is replaced. */
    start(ctx: unknown, providerRef: string): { ok: true; info: string } | { ok: false; error: string } {
      let providers: LoginProvider[];
      try {
        providers = adapter.providers(ctx);
      } catch (error) {
        return { ok: false, error: `Could not list login providers: ${error instanceof Error ? error.message : String(error)}` };
      }
      const wanted = providerRef.trim().toLowerCase();
      const choices = wanted
        ? providers.filter(provider => provider.id.toLowerCase() === wanted || provider.name.toLowerCase() === wanted)
        : [...providers].sort((a, b) => Number(a.method !== "oauth") - Number(b.method !== "oauth") || a.name.localeCompare(b.name));
      const [first] = choices;
      if (!first) {
        return wanted
          ? { ok: false, error: `Unknown login provider "${providerRef.trim()}". Send /login to choose one.` }
          : { ok: false, error: "This harness has no login providers." };
      }
      active?.abort.abort(new LoginCancelled());
      const flow: Flow = {
        loginId: crypto.randomUUID(), abort: new AbortController(), title: "Log in",
        stepId: null, prompt: null, renderQueued: false,
      };
      active = flow;
      void run(flow, ctx, choices);
      return { ok: true, info: choices.length === 1 ? `Signing in to ${first.name}…` : "Choose a provider to sign in" };
    },
    cancel() {
      active?.abort.abort(new LoginCancelled());
    },
  };
}
