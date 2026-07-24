import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
// Runtime value import: pi's extension loader aliases this specifier to the
// host's own module instance, so `AgentSession` here is the exact class of the
// live session (see the queue-capture note below).
import { AgentSession } from "@earendil-works/pi-coding-agent";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.join(os.homedir(), ".pi", "dish");
const REGISTRY_DIR = path.join(ROOT, "sessions");
const SOCKET_DIR = path.join(ROOT, "sockets");

// bind() caps a Unix socket path at sun_path (~104-108 bytes), and session ids
// (JSONL basenames) can be long enough to blow it. The socket file is named by
// a hash of the id — nothing derives this path from the session name; every
// consumer reads socketPath from the registry entry.
function socketPathFor(sessionId: string): string {
  const digest = crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
  return path.join(SOCKET_DIR, `${digest}.sock`);
}

// Set by pi-dish when it spawns this pi inside a tmux window (see lib/tmux.js).
// Written into the registry entry so the server can correlate the tmux spawn
// with the session it registers. Harmless (and undefined) otherwise.
const SPAWN_TOKEN = process.env.PI_DISH_SPAWN_TOKEN || null;

// Where this pi lives, for pi-dish's "Running in" display: $TMUX is
// "socketPath,serverPid,sessionIdx" and $TMUX_PANE the %pane id. Stamped into
// the registry entry so even sessions pi-dish didn't spawn report their tmux
// location. Null outside tmux (a plain terminal, or an RPC child — the server
// distinguishes its own children before trusting this).
const TMUX_LOCATION = process.env.TMUX
  ? { socket: process.env.TMUX.split(",")[0], pane: process.env.TMUX_PANE || null }
  : null;

const FORWARDED_EVENTS = [
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  // queue_update is deliberately NOT here: pi never routes it through the
  // extension runner (verified pi 0.80.3), so pi.on("queue_update") never
  // fires. The real source is the AgentSession.subscribe() listener installed
  // in ensureSessionSubscription() — see the capture patch at module scope.
  "auto_retry_start",
  "auto_retry_end",
  "extension_error",
  "extension_ui_request",
  "model_select",
  "thinking_level_select",
] as const;

// Built-in TUI commands the bridge can emulate through the extension API.
// Everything else built-in (e.g. /settings, /tree, /resume) needs the TUI.
const EMULATED_BUILTINS = [
  { name: "compact", description: "Manually compact the session context" },
  { name: "model", description: "Switch model (usage: /model provider/model-id)" },
  { name: "name", description: "Set session display name" },
  { name: "thinking", description: "Set thinking level (off|minimal|low|medium|high|xhigh)" },
  { name: "abort", description: "Abort the current agent operation" },
  { name: "reload", description: "Reload extensions, skills, and prompt templates" },
];

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

// --- Prompt template arg substitution (mirrors pi's prompt-templates.ts) ---

function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (const char of argsString) {
    if (inQuote) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) { args.push(current); current = ""; }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");
  return content.replace(
    /\$\{(\d+):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_match, defaultNum, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultNum) {
        const value = args[parseInt(defaultNum, 10) - 1];
        return value ? value : defaultValue;
      }
      if (sliceStart) {
        let start = parseInt(sliceStart, 10) - 1;
        if (start < 0) start = 0;
        if (sliceLength) return args.slice(start, start + parseInt(sliceLength, 10)).join(" ");
        return args.slice(start).join(" ");
      }
      if (simple === "ARGUMENTS" || simple === "@") return allArgs;
      return args[parseInt(simple, 10) - 1] ?? "";
    },
  );
}

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length) : content;
}

// --- Live AgentSession capture (for the steering/follow-up queue) ------------
//
// pi never routes its `queue_update` event through the extension runner
// (verified pi 0.80.3) — it reaches only AgentSession.subscribe() listeners.
// To observe (and edit) the queue we need the live AgentSession instance. Both
// `subscribe` and `prompt` run with `this` bound to that instance, so a
// one-time prototype patch wrapping them stashes `this` into a *global* holder.
// The holder is global (not a module local) on purpose: pi's /reload
// re-evaluates this extension but keeps the same AgentSession instance — a
// fresh bridge load must still find the previously captured one. Everything
// downstream feature-detects, so a patch failure only loses queue editing.
const AGENT_SESSION_HOLDER = Symbol.for("pi-dish-bridge.agentSession");
const SESSION_PATCH_FLAG = Symbol.for("pi-dish-bridge.sessionPatch");
try {
  const proto: any = (AgentSession as any)?.prototype;
  if (proto && !proto[SESSION_PATCH_FLAG]) {
    proto[SESSION_PATCH_FLAG] = true;
    const stash = (instance: any) => {
      try { (globalThis as any)[AGENT_SESSION_HOLDER] = { current: instance }; } catch {}
    };
    for (const name of ["subscribe", "prompt"]) {
      const original = proto[name];
      if (typeof original !== "function") continue;
      proto[name] = function (this: any, ...args: any[]) {
        try { stash(this); } catch {}
        return Reflect.apply(original, this, args);
      };
    }
  }
} catch (e) {
  try { process.stderr.write(`[pi-dish-bridge] AgentSession capture patch failed (queue editing disabled): ${e}\n`); } catch {}
}

// Extract the delivery-match text of a queued message the way AgentSession's
// private _getUserMessageText does: a string is itself; otherwise join the
// text parts of the content array. Handles both raw content (compaction
// buffer) and AgentMessage-shaped entries (agent-core queues).
function queueEntryText(entry: any): string {
  if (typeof entry === "string") return entry;
  const content = Array.isArray(entry) ? entry : entry?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("");
  return "";
}

export default function (pi: ExtensionAPI) {
  // Two bridge copies loaded into one pi process (e.g. a stale copied install
  // alongside the repo symlink) would each unlink and re-bind the same session
  // socket — whichever loads last wins, and a stale winner silently downgrades
  // the protocol. First load claims the process; pi's /reload emits
  // session_shutdown before re-evaluating extensions, which releases the claim.
  const LOAD_SENTINEL = Symbol.for("pi-dish-bridge.loaded");
  const g = globalThis as any;
  if (g[LOAD_SENTINEL]) {
    try {
      process.stderr.write("[pi-dish-bridge] duplicate bridge extension load detected — this copy stays inactive. Remove the extra pi-dish-bridge install.\n");
    } catch {}
    return;
  }
  g[LOAD_SENTINEL] = true;

  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  fs.mkdirSync(SOCKET_DIR, { recursive: true });

  // Session-control methods (ctx.navigateTree, ctx.reload, …) exist only on
  // command contexts, which pi supplies when it executes an extension
  // command — events get a plain ctx without them. A command context stays
  // valid until the extension runner is replaced (reload / session switch),
  // so every bridge command stashes its ctx for the socket handlers to
  // reuse. RPC sessions can be primed remotely (`prompt` with "/dish-prime"
  // goes through pi's command executor — the server does this on demand);
  // TUI sessions have no remote path to a command context (pi.sendUserMessage
  // deliberately skips command handling), so they need any /dish-* command
  // run once in the TUI to enable remote tree navigation.
  let commandCtx: any = null;
  function stashCommandCtx(ctx: any) {
    if (ctx && typeof ctx.navigateTree === "function") commandCtx = ctx;
  }

  // Self-prime: the extension API alone has no remote path to a command
  // context, but the captured AgentSession's own prompt() executes extension
  // commands immediately (pi builds each command a fresh context carrying the
  // session-control methods, bound to the running mode's handlers — so a TUI
  // gets its own re-rendering navigateTree). Running our /dish-prime through
  // it stashes that ctx without the user ever typing in the TUI.
  // Feature-detected: no captured session, no self-prime.
  async function acquireCommandCtx(): Promise<void> {
    if (commandCtx) return;
    const s = getCapturedSession();
    if (!s || typeof s.prompt !== "function") return;
    try { await s.prompt("/dish-prime"); } catch {}
  }

  pi.registerCommand("dish-prime", {
    description: "Enable pi-dish remote session control (tree navigation)",
    handler: async (_args: string, ctx: any) => {
      stashCommandCtx(ctx);
    },
  });

  // Reload entrypoint: RPC sessions can invoke this via a plain `prompt`
  // command ("/dish-reload"); TUI sessions cannot (see commandCtx above).
  pi.registerCommand("dish-reload", {
    description: "Reload extensions, skills, and prompt templates (pi-dish)",
    handler: async (_args: string, ctx: any) => {
      await ctx.reload();
    },
  });

  // Manual recovery/debug: re-broadcast current widget/status state to
  // connected pi-dish clients (and re-check socket ownership). Usable from
  // the TUI and from the web composer (run_command → executeSlashCommand).
  pi.registerCommand("dish-push", {
    description: "Re-broadcast extension UI state to pi-dish clients (pi-dish)",
    handler: async (_args: string, ctx: any) => {
      stashCommandCtx(ctx);
      const r = forcePushExtensionUI();
      try { ctx.ui.notify(`pi-dish: pushed ${r.widgets} widget(s), ${r.statuses} status(es) to ${r.clients} client(s)`, "info"); } catch {}
    },
  });

  let server: net.Server | null = null;
  let socketPath: string | null = null;
  let registryPath: string | null = null;
  let sessionId: string | null = null;
  let sessionFile: string | null = null;
  let cwd: string | null = null;
  const clients = new Set<net.Socket>();
  const wrappedUIs = new WeakSet<object>();

  let turnInProgress = false;
  // Compaction has no active turn (turn_start never fires), yet pi has aborted
  // the agent and is rewriting its message list — a prompt sent now would start
  // a concurrent turn and race that rewrite. Gate sends while compacting and
  // replay them once it finishes. pi emits an extension event only on success
  // (session_compact), never on failure/cancel, so a stuck timer is the net
  // that keeps a failed compaction from swallowing every later prompt.
  let compacting = false;
  let compactionStuckTimer: ReturnType<typeof setTimeout> | null = null;
  const compactionQueue: Array<string | any[]> = [];
  const COMPACTION_STUCK_MS = 6 * 60 * 1000;
  // True once ensureSessionSubscription() is listening to the AgentSession's
  // real compaction_start/compaction_end events. While live, those drive the
  // gate and the wire broadcasts; the session_before_compact/session_compact
  // extension handlers below then skip their own broadcasts instead of
  // double-reporting. (The extension pair stays as the fallback for the rare
  // uncaptured session — nothing has called prompt/subscribe since load.)
  let compactionEventsLive = false;

  // Steering/follow-up queue, mirrored from the live AgentSession's own
  // queue_update events (see the capture patch at module scope). `lastQueue`
  // is the fallback snapshot; live reads via getCapturedSession() are preferred
  // when the instance is available.
  let lastQueue: { steering: string[]; followUp: string[] } = { steering: [], followUp: [] };
  let queueUnsub: (() => void) | null = null;
  let modelId: string | null = null;
  let contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | null = null;
  let sessionName: string | null = null;
  let lastCtx: ExtensionContext | null = null;

  // Dialog requests waiting for a remote (web) answer. id -> resolve(raw response)
  const pendingDialogs = new Map<string, (resp: any) => void>();

  function formatModel(model: any): string | null {
    if (!model) return null;
    if (typeof model === "string") return model;
    const provider = model.provider;
    const id = model.id ?? model.modelId;
    return provider && id ? `${provider}/${id}` : null;
  }

  async function resolveModel(ref: string): Promise<any | null> {
    if (!lastCtx) return null;
    const slashIdx = ref.indexOf("/");
    const provider = slashIdx > 0 ? ref.slice(0, slashIdx) : null;
    const id = slashIdx > 0 ? ref.slice(slashIdx + 1) : ref;
    const available = await lastCtx.modelRegistry.getAvailable();
    return available.find((m: any) => provider ? (m.provider === provider && m.id === id) : m.id === id)
      ?? available.find((m: any) => formatModel(m) === ref)
      // Loose fallback so "/model fable" works like the TUI's fuzzy picker.
      ?? available.find((m: any) => m.id.includes(id))
      ?? null;
  }

  function refreshModel(ctx?: ExtensionContext | null) {
    const model = formatModel(ctx?.model ?? lastCtx?.model);
    if (model) modelId = model;
  }

  function refreshContextUsage(ctx?: ExtensionContext | null) {
    const c = ctx ?? lastCtx;
    if (!c) return;
    try {
      const usage = c.getContextUsage();
      if (usage) contextUsage = usage;
    } catch {}
  }

  const uiState = {
    widgets: new Map<string, any>(),
    statuses: new Map<string, any>(),
    title: null as any,
    editorText: null as any,
  };

  function broadcast(obj: unknown) {
    const line = JSON.stringify(obj) + "\n";
    for (const c of clients) {
      try { c.write(line); } catch {}
    }
  }

  function emitTo(sock: net.Socket, obj: unknown) {
    try { sock.write(JSON.stringify(obj) + "\n"); } catch {}
  }

  // The live AgentSession, if the module-scope capture patch stashed one and it
  // still looks like an AgentSession. All queue features feature-detect on this.
  function getCapturedSession(): any {
    try {
      const holder = (globalThis as any)[AGENT_SESSION_HOLDER];
      const s = holder?.current;
      if (s && typeof s.subscribe === "function") return s;
    } catch {}
    return null;
  }

  // Current queue as clients should see it: pi's steering/follow-up queues
  // (live read when the instance is captured, else the mirrored fallback) plus
  // any messages we're holding through compaction — a send during compaction
  // should be just as visible and cancellable as a real queued one.
  function mergedQueue(): { steering: string[]; followUp: string[] } {
    let steering: string[];
    let followUp: string[];
    const s = getCapturedSession();
    if (s) {
      try {
        steering = [...s.getSteeringMessages()];
        followUp = [...s.getFollowUpMessages()];
      } catch {
        steering = [...lastQueue.steering];
        followUp = [...lastQueue.followUp];
      }
    } else {
      steering = [...lastQueue.steering];
      followUp = [...lastQueue.followUp];
    }
    for (const entry of compactionQueue) followUp.push(queueEntryText(entry));
    return { steering, followUp };
  }

  function broadcastQueue(): void {
    broadcast({ type: "event", event: "queue_update", data: mergedQueue() });
  }

  // Subscribe to the live AgentSession's own event stream once. Idempotent
  // and lazy: called from session_start and whenever a client connects, so a
  // session captured after the bridge loaded (or re-captured across /reload)
  // still gets wired up. Carries two event families pi's extension runner
  // never delivers:
  //  - queue_update (steering/follow-up queues)
  //  - compaction_start/compaction_end — unlike the extension-facing
  //    session_before_compact/session_compact pair, these also fire when a
  //    compaction fails or is aborted, so the send gate releases the moment
  //    compaction actually stops instead of waiting out the stuck timer.
  function ensureSessionSubscription(): void {
    if (queueUnsub) return;
    const s = getCapturedSession();
    if (!s) return;
    try {
      const unsub = s.subscribe((event: any) => {
        if (event?.type === "queue_update") {
          lastQueue = {
            steering: Array.isArray(event.steering) ? [...event.steering] : [],
            followUp: Array.isArray(event.followUp) ? [...event.followUp] : [],
          };
          broadcastQueue();
        } else if (event?.type === "compaction_start") {
          beginCompaction();
          broadcast({ type: "event", event: "compaction_start", data: { reason: event.reason } });
        } else if (event?.type === "compaction_end") {
          const r = event.result;
          broadcast({
            type: "event",
            event: "compaction_end",
            data: {
              reason: event.reason,
              aborted: !!event.aborted,
              willRetry: !!event.willRetry,
              errorMessage: event.errorMessage,
              result: r ? { tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter } : undefined,
            },
          });
          // Manual compaction emits this inside compact(), before its finally
          // reconnects the agent — defer the gate release so flushed prompts
          // don't start a turn mid-reconnect.
          setTimeout(endCompaction, 0);
        }
      });
      if (typeof unsub === "function") {
        queueUnsub = unsub;
        compactionEventsLive = true;
      }
    } catch (e) {
      try { process.stderr.write(`[pi-dish-bridge] session subscription failed: ${e}\n`); } catch {}
    }
  }

  function emitExtensionUIRequest(req: any) {
    if (!req?.id) req.id = crypto.randomUUID();

    if (req.method === "setWidget") {
      // Extensions re-set widgets on every internal tick (pi-processes does it
      // per output line) — don't rebroadcast content clients already have.
      const key = req.widgetKey || "default";
      if (req.widgetLines === undefined || (Array.isArray(req.widgetLines) && req.widgetLines.length === 0)) {
        if (!uiState.widgets.delete(key)) return;
      } else {
        const prev = uiState.widgets.get(key);
        if (prev && prev.widgetPlacement === req.widgetPlacement &&
            JSON.stringify(prev.widgetLines) === JSON.stringify(req.widgetLines)) return;
        uiState.widgets.set(key, req);
      }
    } else if (req.method === "setStatus") {
      const key = req.statusKey || "default";
      if (!req.statusText) {
        if (!uiState.statuses.delete(key)) return;
      } else {
        if (uiState.statuses.get(key)?.statusText === req.statusText) return;
        uiState.statuses.set(key, req);
      }
    } else if (req.method === "setTitle") {
      uiState.title = req;
    } else if (req.method === "set_editor_text") {
      uiState.editorText = req;
    }

    broadcast({ type: "event", event: "extension_ui_request", data: req });
    // Widget ticks are the only regular activity on an idle session — probe
    // (throttled) here too, or a socket stolen by a stale bridge copy stays
    // stolen until the next agent turn.
    ensureSocketOwnership();
  }

  // Re-broadcast current UI state to connected clients on demand. The
  // `forced` flag tells the pi-dish server to bypass its per-connection
  // content dedup — without it an unchanged widget would be swallowed.
  // Deliberately skips editorText: force-replacing what someone is typing
  // in the web composer is worse than a stale draft.
  function forcePushExtensionUI(): { widgets: number; statuses: number; clients: number } {
    ensureSocketOwnership();
    let widgets = 0;
    let statuses = 0;
    for (const req of uiState.widgets.values()) {
      broadcast({ type: "event", event: "extension_ui_request", data: { ...req, forced: true } });
      widgets++;
    }
    for (const req of uiState.statuses.values()) {
      broadcast({ type: "event", event: "extension_ui_request", data: { ...req, forced: true } });
      statuses++;
    }
    if (uiState.title) broadcast({ type: "event", event: "extension_ui_request", data: { ...uiState.title, forced: true } });
    return { widgets, statuses, clients: clients.size };
  }

  function replayExtensionUI(sock: net.Socket) {
    for (const req of uiState.widgets.values()) emitTo(sock, { type: "event", event: "extension_ui_request", data: req });
    for (const req of uiState.statuses.values()) emitTo(sock, { type: "event", event: "extension_ui_request", data: req });
    if (uiState.title) emitTo(sock, { type: "event", event: "extension_ui_request", data: uiState.title });
    if (uiState.editorText) emitTo(sock, { type: "event", event: "extension_ui_request", data: uiState.editorText });
    // Replay any dialogs still waiting so a freshly connected client can answer them.
    for (const id of pendingDialogs.keys()) {
      const req = dialogRequests.get(id);
      if (req) emitTo(sock, { type: "event", event: "extension_ui_request", data: req });
    }
  }

  // Keep the original request payload for replay to late-joining clients.
  const dialogRequests = new Map<string, any>();

  function wrapExtensionUI(ctx?: ExtensionContext | null) {
    const ui = ctx?.ui as any;
    if (!ui || wrappedUIs.has(ui)) return;
    wrappedUIs.add(ui);

    const wrapFireAndForget = (name: string, makeReq: (...args: any[]) => any) => {
      const original = ui[name];
      if (typeof original !== "function") return;
      ui[name] = function (...args: any[]) {
        const ret = original.apply(this, args);
        try { emitExtensionUIRequest(makeReq(...args)); } catch {}
        return ret;
      };
    };

    wrapFireAndForget("notify", (message: string, type?: string) => ({ method: "notify", message, notifyType: type }));
    wrapFireAndForget("setStatus", (key: string, text?: string) => ({ method: "setStatus", statusKey: key, statusText: text }));
    wrapFireAndForget("setTitle", (title: string) => ({ method: "setTitle", title }));
    wrapFireAndForget("setEditorText", (text: string) => ({ method: "set_editor_text", text }));
    wrapFireAndForget("pasteToEditor", (text: string) => ({ method: "set_editor_text", text }));

    const originalSetWidget = ui.setWidget;
    if (typeof originalSetWidget === "function") {
      ui.setWidget = function (key: string, content: any, options?: any) {
        const ret = originalSetWidget.apply(this, arguments as any);
        try {
          if (content === undefined || Array.isArray(content)) {
            emitExtensionUIRequest({
              method: "setWidget",
              widgetKey: key,
              widgetLines: content,
              widgetPlacement: options?.placement,
            });
          }
        } catch {}
        return ret;
      };
    }

    // Dialogs: broadcast the request and race the local TUI dialog against a
    // remote answer from a connected pi-dish client. Whichever side answers
    // first wins; the loser's UI is dismissed/ignored. The TUI dialog cannot
    // be programmatically closed, so after a remote answer it stays visible
    // until dismissed, but its (late) result is discarded.
    const wrapDialog = (
      name: string,
      makeReq: (...args: any[]) => any,
      mapResponse: (resp: any) => any,
    ) => {
      const original = ui[name];
      if (typeof original !== "function") return;
      ui[name] = function (...args: any[]) {
        const req = makeReq(...args);
        req.id = crypto.randomUUID();
        let settled = false;
        const settle = (source: string) => {
          if (settled) return;
          settled = true;
          pendingDialogs.delete(req.id);
          dialogRequests.delete(req.id);
          broadcast({ type: "event", event: "extension_ui_resolved", data: { id: req.id, source } });
        };
        const remote = new Promise((resolve) => {
          pendingDialogs.set(req.id, (resp: any) => resolve(mapResponse(resp)));
        });
        dialogRequests.set(req.id, req);
        try { emitExtensionUIRequest(req); } catch {}
        const local = original.apply(this, args);
        return Promise.race([
          Promise.resolve(local).then((v) => { settle("tui"); return v; }),
          remote.then((v) => { settle("web"); return v; }),
        ]);
      };
    };

    const valueResponse = (resp: any) => (resp?.cancelled ? undefined : resp?.value);
    wrapDialog("select", (title: string, options: string[], opts?: any) => ({ method: "select", title, options, timeout: opts?.timeout }), valueResponse);
    wrapDialog("confirm", (title: string, message: string, opts?: any) => ({ method: "confirm", title, message, timeout: opts?.timeout }), (resp) => (resp?.cancelled ? false : !!resp?.confirmed));
    wrapDialog("input", (title: string, placeholder?: string, opts?: any) => ({ method: "input", title, placeholder, timeout: opts?.timeout }), valueResponse);
    wrapDialog("editor", (title: string, prefill?: string) => ({ method: "editor", title, prefill }), valueResponse);
  }

  // Callers invoke this on every turn/message/model event; skip the disk
  // write when nothing but the timestamp would change (message_end fires per
  // assistant message and usually only moves contextUsage).
  let lastRegistrySig: string | null = null;

  // The load sentinel can't stop bridge copies that predate it: an old copy
  // loading after us unlinks and re-binds our socket path once, at its
  // session_start. Detect that by probing the path and matching the hello's
  // instanceId (old bridges send a hello without one, so they're caught too;
  // an inode check can't work here — listen() completes asynchronously, so
  // the theft can land before we could ever stat our own socket file). This
  // runs from writeRegistry, i.e. on every turn/message event, and the old
  // copy never re-checks, so one reclaim wins durably.
  const instanceId = crypto.randomUUID();
  let ownershipProbe = false;
  let lastOwnershipProbe = 0;

  function bindSocket() {
    if (!socketPath) return;
    try { fs.unlinkSync(socketPath); } catch {}
    server = net.createServer(handleClient);
    server.on("error", (e) => {
      // best effort: log to stderr
      try { process.stderr.write(`[pi-dish-bridge] server error: ${e}\n`); } catch {}
    });
    server.listen(socketPath, () => {
      try { fs.chmodSync(socketPath!, 0o600); } catch {}
    });
  }

  function ensureSocketOwnership() {
    if (!server || !server.listening || !socketPath || ownershipProbe) return;
    if (Date.now() - lastOwnershipProbe < 5000) return;
    ownershipProbe = true;
    lastOwnershipProbe = Date.now();
    const probePath = socketPath;
    const probe = net.connect(probePath);
    let buf = "";
    let settled = false;
    const done = (owned: boolean) => {
      if (settled) return;
      settled = true;
      ownershipProbe = false;
      try { probe.destroy(); } catch {}
      // Session may have shut down or moved while the probe was in flight.
      if (owned || !server || socketPath !== probePath) return;
      try {
        process.stderr.write("[pi-dish-bridge] session socket was re-bound by another bridge instance — reclaiming. Remove duplicate pi-dish-bridge installs.\n");
      } catch {}
      try { server.close(); } catch {}
      bindSocket();
    };
    probe.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      try { done(JSON.parse(buf.slice(0, nl)).instanceId === instanceId); } catch { done(false); }
    });
    probe.on("error", () => done(false)); // path unlinked/dead → rebind
    probe.setTimeout(2000, () => done(true)); // unresponsive: don't fight it
  }

  function writeRegistry() {
    if (!sessionId || !registryPath || !sessionFile) return;
    ensureSocketOwnership();
    const entry = {
      sessionId,
      sessionFile,
      cwd,
      pid: process.pid,
      socketPath,
      name: sessionName,
      model: modelId,
      contextUsage,
      thinkingLevel: getThinkingLevel(),
      turnInProgress,
      compacting,
      spawnToken: SPAWN_TOKEN,
      tmux: TMUX_LOCATION,
    };
    const sig = JSON.stringify(entry);
    if (sig === lastRegistrySig) return;
    try {
      fs.writeFileSync(registryPath, JSON.stringify({ ...entry, updatedAt: new Date().toISOString() }, null, 2));
      lastRegistrySig = sig;
    } catch (e) {
      // best effort
    }
  }

  function cleanup() {
    for (const c of clients) { try { c.destroy(); } catch {} }
    clients.clear();
    if (server) { try { server.close(); } catch {} server = null; }
    ownershipProbe = false;
    lastOwnershipProbe = 0;
    if (socketPath) { try { fs.unlinkSync(socketPath); } catch {} }
    if (registryPath) { try { fs.unlinkSync(registryPath); } catch {} }
    socketPath = null;
    registryPath = null;
    sessionId = null;
    sessionFile = null;
    cwd = null;
    commandCtx = null;
    turnInProgress = false;
    if (compactionStuckTimer) { clearTimeout(compactionStuckTimer); compactionStuckTimer = null; }
    compacting = false;
    compactionQueue.length = 0;
    if (queueUnsub) { try { queueUnsub(); } catch {} queueUnsub = null; }
    compactionEventsLive = false;
    lastQueue = { steering: [], followUp: [] };
    contextUsage = null;
    lastRegistrySig = null;
    pendingDialogs.clear();
    dialogRequests.clear();
    uiState.widgets.clear();
    uiState.statuses.clear();
    uiState.title = null;
    uiState.editorText = null;
    // Release the duplicate-load claim so /reload's re-evaluation can bind.
    g[LOAD_SENTINEL] = false;
  }

  function getThinkingLevel(): string | null {
    try { return pi.getThinkingLevel() ?? null; } catch { return null; }
  }

  function stateSnapshot() {
    return {
      sessionId,
      sessionFile,
      cwd,
      turnInProgress,
      compacting,
      model: modelId,
      contextUsage,
      thinkingLevel: getThinkingLevel(),
      name: sessionName,
      pid: process.pid,
      queue: mergedQueue(),
    };
  }

  function handleClient(sock: net.Socket) {
    clients.add(sock);
    sock.on("close", () => clients.delete(sock));
    sock.on("error", () => {});

    let buf = "";
    sock.on("data", async (chunk) => {
      buf += chunk.toString("utf-8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const cmd = JSON.parse(line);
          await handleCommand(cmd, sock);
        } catch (e: any) {
          try {
            sock.write(JSON.stringify({
              type: "response",
              id: null,
              success: false,
              error: String(e?.message || e),
            }) + "\n");
          } catch {}
        }
      }
    });

    ensureSessionSubscription();
    emitTo(sock, { type: "hello", instanceId, ...stateSnapshot() });
    replayExtensionUI(sock);
  }

  /**
   * Execute a slash command remotely. Supports:
   * - Emulated built-ins: /compact, /model, /name, /thinking, /abort
   * - Skills (/skill:name args): expanded like pi does, sent as a user message
   * - Prompt templates: expanded with arg substitution, sent as a user message
   * - Extension commands: NOT supported (pi's extension API has no way to
   *   invoke another extension's command handler) — returns a clear error.
   */
  async function executeSlashCommand(text: string, deliverAs?: string): Promise<{ ok: boolean; error?: string; info?: string }> {
    const spaceIdx = text.indexOf(" ");
    const name = (spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx)).trim();
    const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();

    // --- Emulated built-ins ---
    if (name === "compact") {
      if (!lastCtx) return { ok: false, error: "no active context" };
      // pi's compact() starts by aborting the agent and rewriting its message
      // list — triggered while a compaction (auto or manual) is already
      // running, the two race that rewrite and corrupt the session. Refuse
      // instead; isCompacting is pi's own authoritative flag (it also covers
      // branch summarization, which the same race applies to).
      if (compacting || getCapturedSession()?.isCompacting) {
        return { ok: false, error: "Compaction already in progress — wait for it to finish." };
      }
      // Raise the gate before the async events land so two rapid /compact
      // sends can't both get past the check above.
      beginCompaction();
      // ctx.compact() is fire-and-forget and returns void (pi >= 0.80);
      // outcome arrives via the AgentSession compaction events (or the
      // session_before_compact/session_compact fallback below). Older pi
      // returned a promise — report a rejection so the client isn't stuck.
      try {
        (lastCtx.compact(args ? { customInstructions: args } : undefined) as any)
          ?.catch?.((e: any) => {
            console.error("[pi-dish-bridge] compact failed:", e?.message || e);
            // With the session subscription live the AgentSession's own
            // compaction_end (errorMessage) already reported and released.
            if (!compactionEventsLive) {
              broadcast({ type: "event", event: "compaction_end", data: { reason: "manual", errorMessage: String(e?.message || e) } });
            }
            endCompaction();
          });
      } catch (e: any) {
        // Synchronous throw: compaction never started — drop the gate we
        // raised optimistically or it would swallow sends until the net.
        endCompaction();
        return { ok: false, error: String(e?.message || e) };
      }
      return { ok: true, info: "Compaction started" };
    }
    if (name === "dish-push") {
      const r = forcePushExtensionUI();
      return { ok: true, info: `Re-broadcast ${r.widgets} widget(s), ${r.statuses} status(es) to ${r.clients} client(s)` };
    }
    if (name === "abort") {
      if (!lastCtx) return { ok: false, error: "no active context" };
      abortCompactionIfRunning();
      (lastCtx.abort() as any)
        ?.catch?.((e: any) => console.error("[pi-dish-bridge] abort failed:", e?.message || e));
      return { ok: true, info: "Aborted" };
    }
    if (name === "model") {
      if (!args) return { ok: false, error: "usage: /model <provider/model-id>" };
      const model = await resolveModel(args);
      if (!model) return { ok: false, error: `model not found: ${args}` };
      const ok = await pi.setModel(model);
      if (ok) {
        modelId = formatModel(model) ?? modelId;
        refreshContextUsage();
        writeRegistry();
        return { ok: true, info: `Model set to ${modelId}` };
      }
      return { ok: false, error: `no API key for ${formatModel(model)}` };
    }
    if (name === "name") {
      if (!args) return { ok: false, error: "usage: /name <session name>" };
      pi.setSessionName(args);
      sessionName = args;
      writeRegistry();
      return { ok: true, info: `Session renamed` };
    }
    if (name === "thinking") {
      if (!THINKING_LEVELS.includes(args)) return { ok: false, error: `usage: /thinking <${THINKING_LEVELS.join("|")}>` };
      pi.setThinkingLevel(args as any);
      writeRegistry();
      return { ok: true, info: `Thinking level: ${args}` };
    }

    if (name === "reload") {
      // ctx.reload() lives on command contexts only; the captured
      // AgentSession's prompt() executes our /dish-reload to get one, so this
      // works on TUI sessions too. Fire-and-forget like /compact: reload
      // tears this module down and re-evaluates it, so awaiting completion
      // would race our own socket shutting down. The trigger is deferred a
      // beat further: fired in this tick, the teardown outruns the
      // run_command response frame and the server sees "socket closed" for a
      // reload that ran.
      const s = getCapturedSession();
      if (!s || typeof s.prompt !== "function") {
        return { ok: false, error: "pi's extension API can't trigger /reload on this session remotely — run /reload in the TUI." };
      }
      setTimeout(() => {
        (s.prompt("/dish-reload") as Promise<any>)
          ?.catch?.((e: any) => console.error("[pi-dish-bridge] reload failed:", e?.message || e));
      }, 50);
      return { ok: true, info: "Reload started" };
    }

    // --- Skills / prompt templates / extension commands via pi.getCommands() ---
    const commands = pi.getCommands();
    const skillCmd = commands.find((c) => c.source === "skill" && c.name === name);
    if (skillCmd) {
      const filePath = skillCmd.sourceInfo?.path;
      if (!filePath) return { ok: false, error: `skill file not found for /${name}` };
      let body: string;
      try {
        body = stripFrontmatter(fs.readFileSync(filePath, "utf-8")).trim();
      } catch (e: any) {
        return { ok: false, error: `failed to read skill: ${e?.message || e}` };
      }
      const baseDir = skillCmd.sourceInfo?.baseDir || path.dirname(filePath);
      const skillName = name.startsWith("skill:") ? name.slice(6) : name;
      const skillBlock = `<skill name="${skillName}" location="${filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
      const expanded = args ? `${skillBlock}\n\n${args}` : skillBlock;
      const { queued } = await deliverUserMessage(expanded, deliverAs);
      return { ok: true, info: queued ? "Queued until compaction finishes" : undefined };
    }

    const promptCmd = commands.find((c) => c.source === "prompt" && c.name === name);
    if (promptCmd) {
      const filePath = promptCmd.sourceInfo?.path;
      if (!filePath) return { ok: false, error: `template file not found for /${name}` };
      let content: string;
      try {
        content = stripFrontmatter(fs.readFileSync(filePath, "utf-8"));
      } catch (e: any) {
        return { ok: false, error: `failed to read template: ${e?.message || e}` };
      }
      const expanded = substituteArgs(content, parseCommandArgs(args));
      const { queued } = await deliverUserMessage(expanded, deliverAs);
      return { ok: true, info: queued ? "Queued until compaction finishes" : undefined };
    }

    const extCmd = commands.find((c) => c.source === "extension" && c.name === name);
    if (extCmd) {
      return { ok: false, error: `/${name} is an extension command — pi's extension API can't invoke it remotely. Run it in the TUI.` };
    }

    return { ok: false, error: `unknown or unsupported command: /${name}` };
  }

  // Text-only messages stay plain strings; attachments become a content
  // array in pi-ai's TextContent/ImageContent shape. Returns null when the
  // command carries neither text nor a usable image.
  function buildUserContent(cmd: any): string | any[] | null {
    const text = typeof cmd?.message === "string" ? cmd.message : "";
    const images = (Array.isArray(cmd?.images) ? cmd.images : []).filter(
      (i: any) => i && typeof i.data === "string" && i.data && typeof i.mimeType === "string",
    );
    if (!images.length) return text || null;
    const content: any[] = [];
    if (text) content.push({ type: "text", text });
    for (const i of images) content.push({ type: "image", data: i.data, mimeType: i.mimeType });
    return content;
  }

  function deliverAsOptions(deliverAs?: string): any {
    if (deliverAs === "steer" || deliverAs === "followUp") return { deliverAs };
    if (turnInProgress) return { deliverAs: "steer" };
    return {};
  }

  // Single chokepoint for user-message sends: buffer while compacting, else
  // hand off to pi with the usual mid-turn steer default. Returns whether the
  // message was queued so callers can tell the client.
  async function deliverUserMessage(content: string | any[], deliverAs?: string): Promise<{ queued: boolean }> {
    if (compacting) {
      compactionQueue.push(content);
      broadcastQueue();
      return { queued: true };
    }
    await pi.sendUserMessage(content, deliverAsOptions(deliverAs));
    return { queued: false };
  }

  // Drain messages buffered during compaction. Compaction just ended and no
  // turn is running, so the first message starts a fresh turn and any extras
  // ride as follow-ups (delivered after that turn) rather than racing a second
  // one. The original deliverAs is intentionally dropped — a steer aimed at a
  // now-finished compaction just resumes the conversation.
  function flushCompactionQueue(): void {
    const pending = compactionQueue.splice(0);
    if (!pending.length) return;
    // The buffer just emptied; the replayed sends re-enter pi's own queue and
    // re-emit queue_update, but reflect the drain immediately.
    broadcastQueue();
    (async () => {
      for (let i = 0; i < pending.length; i++) {
        try {
          await pi.sendUserMessage(pending[i], i === 0 ? {} : { deliverAs: "followUp" });
        } catch (e: any) {
          console.error("[pi-dish-bridge] queued send failed:", e?.message || e);
        }
      }
    })();
  }

  // pi keeps compaction on its own abort controller — plain abort() leaves a
  // running compaction untouched. A user hitting Stop mid-compaction expects
  // it to stop, so cancel that too. Feature-detected; the resulting
  // compaction_end (aborted) releases the gate and informs clients.
  function abortCompactionIfRunning(): void {
    const s = getCapturedSession();
    if ((compacting || s?.isCompacting) && typeof s?.abortCompaction === "function") {
      try { s.abortCompaction(); } catch {}
    }
  }

  // Raise the compaction gate: buffer user sends until it releases, and
  // (re-)arm the stuck-timer net. Idempotent — the manual /compact trigger,
  // the AgentSession compaction_start event, and the session_before_compact
  // fallback can each fire first.
  function beginCompaction(): void {
    if (compactionStuckTimer) clearTimeout(compactionStuckTimer);
    compactionStuckTimer = setTimeout(() => {
      console.error("[pi-dish-bridge] compaction end never observed; releasing queue gate");
      endCompaction();
    }, COMPACTION_STUCK_MS);
    if (compacting) return;
    compacting = true;
    writeRegistry();
  }

  // Clear the compaction gate and flush. Idempotent: the compaction_end
  // paths and the stuck-timer net can all call it.
  function endCompaction(): void {
    if (compactionStuckTimer) { clearTimeout(compactionStuckTimer); compactionStuckTimer = null; }
    if (!compacting) return;
    compacting = false;
    writeRegistry();
    flushCompactionQueue();
  }

  async function handleCommand(cmd: any, sock: net.Socket) {
    const respond = (success: boolean, data?: any, error?: string) => {
      try {
        sock.write(JSON.stringify({
          type: "response",
          id: cmd?.id ?? null,
          command: cmd?.command,
          success,
          data,
          error,
        }) + "\n");
      } catch {}
    };

    try {
      switch (cmd?.command) {
        case "ping":
          respond(true, { pong: true });
          return;

        case "get_state":
          refreshContextUsage();
          respond(true, stateSnapshot());
          return;

        case "prompt": {
          const content = buildUserContent(cmd);
          if (!content) return respond(false, undefined, "message required");
          // deliverUserMessage applies the mid-turn steer default (matching the
          // RPC backend and this file's own run_command paths) and buffers the
          // send while compacting instead of racing pi's message rewrite.
          const { queued } = await deliverUserMessage(content, cmd.deliverAs);
          respond(true, { queued });
          return;
        }

        case "steer": {
          const content = buildUserContent(cmd);
          if (!content) return respond(false, undefined, "message required");
          const { queued } = await deliverUserMessage(content, "steer");
          respond(true, { queued });
          return;
        }

        case "follow_up": {
          const content = buildUserContent(cmd);
          if (!content) return respond(false, undefined, "message required");
          const { queued } = await deliverUserMessage(content, "followUp");
          respond(true, { queued });
          return;
        }

        case "cancel_queued": {
          // Remove a not-yet-delivered queued message so pi-dish can return its
          // text to the composer. Splices pi's private queue arrays directly
          // (feature-detected, version-sensitive — verified pi 0.80.3) then
          // re-emits so the TUI's own display and our subscription reconcile.
          try {
            const kind = cmd?.kind;
            const text = typeof cmd?.text === "string" ? cmd.text : "";
            if ((kind !== "steering" && kind !== "followUp") || !text) {
              return respond(false, undefined, "kind (steering|followUp) and non-empty text required");
            }
            const index = cmd?.index;

            // Messages held through compaction live in our own buffer, not pi's
            // queue yet — only ever surfaced as follow-ups.
            if (kind === "followUp") {
              const ci = compactionQueue.findIndex((e) => queueEntryText(e) === text);
              if (ci >= 0) {
                compactionQueue.splice(ci, 1);
                broadcastQueue();
                return respond(true, { text });
              }
            }

            const s = getCapturedSession();
            const unavailable = "queue editing unavailable (pi internals changed — update pi-dish-bridge)";
            if (!s) return respond(false, undefined, unavailable);
            const arr: string[] = kind === "steering" ? s._steeringMessages : s._followUpMessages;
            if (!Array.isArray(arr) || typeof s._emitQueueUpdate !== "function") {
              return respond(false, undefined, unavailable);
            }
            const idx = Number.isInteger(index) && arr[index] === text ? index : arr.indexOf(text);
            if (idx < 0) return respond(false, undefined, "message already delivered");
            arr.splice(idx, 1);
            const coreQueue = kind === "steering" ? s.agent?.steeringQueue?.messages : s.agent?.followUpQueue?.messages;
            if (Array.isArray(coreQueue)) {
              const ci = coreQueue.findIndex((m: any) => queueEntryText(m) === text);
              if (ci >= 0) coreQueue.splice(ci, 1);
            }
            s._emitQueueUpdate();
            return respond(true, { text });
          } catch (e: any) {
            return respond(false, undefined, String(e?.message || e));
          }
        }

        case "abort": {
          if (!lastCtx) return respond(false, undefined, "no active context");
          abortCompactionIfRunning();
          await lastCtx.abort();
          respond(true);
          return;
        }

        case "get_available_models": {
          if (!lastCtx) return respond(false, undefined, "no active context");
          const models = await lastCtx.modelRegistry.getAvailable();
          respond(true, { models });
          return;
        }

        case "get_commands": {
          const commands = pi.getCommands().map((c) => ({
            name: c.name,
            description: c.description || "",
            source: c.source,
            path: c.sourceInfo?.path,
            // Extension commands can't be invoked over the bridge — except
            // the bridge's own, which executeSlashCommand handles directly.
            supported: c.source !== "extension" || c.name === "dish-push",
          }));
          for (const b of EMULATED_BUILTINS) {
            commands.unshift({ name: b.name, description: b.description, source: "builtin" as any, path: undefined, supported: true });
          }
          respond(true, { commands });
          return;
        }

        case "run_command": {
          if (!cmd.message || !String(cmd.message).startsWith("/")) {
            return respond(false, undefined, "message must start with /");
          }
          const result = await executeSlashCommand(String(cmd.message), cmd.deliverAs);
          if (result.ok) respond(true, { info: result.info });
          else respond(false, undefined, result.error);
          return;
        }

        case "extension_ui_response": {
          const requestId = String(cmd.requestId ?? "");
          const pending = pendingDialogs.get(requestId);
          if (!pending) return respond(false, undefined, `no pending dialog with id ${requestId}`);
          pending(cmd);
          respond(true);
          return;
        }

        case "set_model": {
          const requested = cmd.model ?? (cmd.provider && cmd.modelId ? `${cmd.provider}/${cmd.modelId}` : null);
          if (!requested) return respond(false, undefined, "model required");
          const model = typeof requested === "string" ? await resolveModel(requested) : requested;
          if (!model) return respond(false, undefined, `model not found: ${requested}`);
          const ok = await pi.setModel(model);
          if (ok) {
            modelId = formatModel(model) ?? modelId;
            refreshContextUsage();
            writeRegistry();
          }
          respond(!!ok, { model: modelId });
          return;
        }

        case "set_thinking_level": {
          if (!THINKING_LEVELS.includes(cmd.level)) {
            return respond(false, undefined, `level must be one of: ${THINKING_LEVELS.join(", ")}`);
          }
          pi.setThinkingLevel(cmd.level);
          writeRegistry();
          respond(true, { level: getThinkingLevel() });
          return;
        }

        case "navigate_tree": {
          // pi's /tree, remotely: move the session leaf to targetId,
          // optionally appending an LLM summary of the abandoned branch.
          // ctx.navigateTree does the heavy lifting in-process (summary via
          // the session's own model/auth, agent state update, TUI re-render)
          // but only command contexts carry it — see commandCtx above. Its
          // mode handlers also strip editorText from the result, so the
          // user-message re-edit text is computed here for the web composer.
          if (!lastCtx) return respond(false, undefined, "no active context");
          if (turnInProgress) return respond(false, undefined, "cannot navigate the tree while a turn is in progress");
          // Compaction (and branch summarization) rewrite the message list;
          // navigating the tree concurrently races that rewrite.
          if (compacting || getCapturedSession()?.isCompacting) {
            return respond(false, undefined, "cannot navigate the tree while compaction is in progress");
          }
          if (!commandCtx) await acquireCommandCtx();
          if (!commandCtx) return respond(false, undefined, "no command context");
          const targetId = typeof cmd.targetId === "string" ? cmd.targetId : "";
          if (!targetId) return respond(false, undefined, "targetId required");
          const target = lastCtx.sessionManager.getEntry(targetId);
          if (!target) return respond(false, undefined, `entry not found: ${targetId}`);
          let editorText: string | undefined;
          const textOf = (content: any): string =>
            typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("")
                : "";
          if (target.type === "message" && (target as any).message?.role === "user") {
            editorText = textOf((target as any).message.content) || undefined;
          } else if (target.type === "custom_message") {
            editorText = textOf((target as any).content) || undefined;
          }
          let result;
          for (let attempt = 0; ; attempt++) {
            try {
              result = await commandCtx.navigateTree(targetId, {
                summarize: !!cmd.summarize,
                customInstructions: typeof cmd.customInstructions === "string" && cmd.customInstructions.trim() ? cmd.customInstructions : undefined,
                label: typeof cmd.label === "string" && cmd.label.trim() ? cmd.label : undefined,
              });
              break;
            } catch (e: any) {
              const msg = String(e?.message || e);
              if (/stale/i.test(msg)) {
                // Captured before a reload/session switch — re-prime and retry
                // once before giving up.
                commandCtx = null;
                if (attempt === 0) {
                  await acquireCommandCtx();
                  if (commandCtx) continue;
                }
                return respond(false, undefined, "no command context");
              }
              return respond(false, undefined, msg);
            }
          }
          refreshContextUsage();
          writeRegistry();
          if (result?.cancelled) return respond(false, undefined, "tree navigation was cancelled");
          respond(true, { editorText });
          return;
        }

        case "set_session_name": {
          if (!cmd.name) return respond(false, undefined, "name required");
          pi.setSessionName(cmd.name);
          sessionName = cmd.name;
          writeRegistry();
          respond(true);
          return;
        }

        default:
          respond(false, undefined, `unknown command: ${cmd?.command}`);
      }
    } catch (e: any) {
      respond(false, undefined, String(e?.message || e));
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    wrapExtensionUI(ctx);
    lastCtx = ctx;
    commandCtx = null; // any stashed command ctx predates this runner/session
    refreshModel(ctx);
    refreshContextUsage(ctx);
    const sf = ctx.sessionManager.getSessionFile();
    if (!sf) return; // ephemeral, skip
    sessionFile = sf;
    sessionId = path.basename(sf, ".jsonl");
    cwd = ctx.cwd;
    socketPath = socketPathFor(sessionId);
    registryPath = path.join(REGISTRY_DIR, `${sessionId}.json`);

    bindSocket();
    ensureSessionSubscription();

    writeRegistry();
    broadcast({ type: "event", event: "session_start", data: { sessionId, sessionFile, cwd } });
  });

  pi.on("session_shutdown", async () => {
    broadcast({ type: "event", event: "session_shutdown", data: {} });
    cleanup();
  });

  for (const ev of FORWARDED_EVENTS) {
    pi.on(ev as any, (event: any, ctx: ExtensionContext) => {
      wrapExtensionUI(ctx);
      lastCtx = ctx ?? lastCtx;
      refreshModel(ctx);
      if (ev === "turn_start") {
        turnInProgress = true;
        writeRegistry();
      } else if (ev === "turn_end" || ev === "agent_end") {
        turnInProgress = false;
        refreshContextUsage(ctx);
        writeRegistry();
      } else if (ev === "message_end") {
        // Usage data lands with the assistant message; keep the registry fresh
        // so the session list shows accurate context numbers mid-turn too.
        refreshContextUsage(ctx);
        writeRegistry();
      } else if (ev === "model_select") {
        modelId = formatModel(event?.model) ?? modelId;
        refreshContextUsage(ctx);
        writeRegistry();
      } else if (ev === "thinking_level_select") {
        writeRegistry();
      }
      broadcast({ type: "event", event: ev, data: event });
    });
  }

  // pi's extension API has no compaction_start/compaction_end — those are
  // internal AgentSession events (subscribing to them never fires). The
  // extension-facing pair is session_before_compact/session_compact;
  // translate onto the wire names the server and client already speak.
  pi.on("session_before_compact", (event: any, ctx: ExtensionContext) => {
    wrapExtensionUI(ctx);
    lastCtx = ctx ?? lastCtx;
    // Gate + stuck-timer net regardless of source; with the session
    // subscription live the AgentSession's compaction_start already broadcast
    // (it fires before this extension event in both the manual and auto
    // paths), so only the fallback broadcasts here.
    beginCompaction();
    if (compactionEventsLive) return;
    // Don't forward the raw event: it carries branchEntries (the whole
    // pre-compaction transcript) and an AbortSignal.
    broadcast({ type: "event", event: "compaction_start", data: { reason: event?.reason, willRetry: event?.willRetry } });
  });
  pi.on("session_compact", (event: any, ctx: ExtensionContext) => {
    wrapExtensionUI(ctx);
    lastCtx = ctx ?? lastCtx;
    refreshContextUsage(ctx);
    writeRegistry();
    // With the subscription live, the richer compaction_end (result incl.
    // estimatedTokensAfter, aborted, errorMessage) follows via the
    // AgentSession event stream and releases the gate there.
    if (compactionEventsLive) return;
    const entry = event?.compactionEntry;
    broadcast({
      type: "event",
      event: "compaction_end",
      data: {
        reason: event?.reason,
        willRetry: event?.willRetry,
        result: entry ? { tokensBefore: entry.tokensBefore } : undefined,
      },
    });
    // This event fires synchronously inside pi's compact(), before its finally
    // reconnects the agent. Defer the gate release + queue flush a tick so the
    // replayed prompts don't start a turn mid-reconnect.
    setTimeout(endCompaction, 0);
  });

  // Tree navigation (pi's /tree — from the TUI, the web UI, or an extension).
  // Two jobs:
  //  1. Anchor the new leaf on disk. pi's no-summary branch() only moves an
  //     in-memory pointer; a reopened JSONL — and every external reader,
  //     pi-dish's transcript included — re-derives the leaf from the file's
  //     *last entry*. When the navigation appended nothing (no branch_summary,
  //     no label), append a no-op label entry, the same anchor lib/pi-sdk.js
  //     writes for inactive-session branches. Skipped automatically when the
  //     last entry already is the leaf.
  //  2. Broadcast the event so connected clients re-render the transcript
  //     from the (now anchored) file.
  pi.on("session_tree", (event: any, ctx: ExtensionContext) => {
    wrapExtensionUI(ctx);
    lastCtx = ctx ?? lastCtx;
    try {
      const sm: any = ctx?.sessionManager;
      const entries = sm?.getEntries?.() ?? [];
      const last = entries[entries.length - 1];
      const leafId = sm?.getLeafId?.() ?? null;
      if (last && last.id !== leafId) {
        // Navigating to the root resets the leaf to null — anchor via the old
        // tip then (appendLabelChange needs an existing target; parentId is
        // taken from the current leaf either way).
        const target = leafId ?? event?.oldLeafId ?? last.id;
        sm.appendLabelChange(target, sm.getLabel(target));
      }
    } catch (e) {
      console.error("[pi-dish-bridge] failed to anchor tree navigation:", e);
    }
    refreshContextUsage(ctx);
    writeRegistry();
    broadcast({ type: "event", event: "session_tree", data: { newLeafId: event?.newLeafId ?? null } });
  });
}
