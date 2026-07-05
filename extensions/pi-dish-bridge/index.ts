import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.join(os.homedir(), ".pi", "dish");
const REGISTRY_DIR = path.join(ROOT, "sessions");
const SOCKET_DIR = path.join(ROOT, "sockets");

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
  "queue_update",
  "compaction_start",
  "compaction_end",
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

export default function (pi: ExtensionAPI) {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  fs.mkdirSync(SOCKET_DIR, { recursive: true });

  let server: net.Server | null = null;
  let socketPath: string | null = null;
  let registryPath: string | null = null;
  let sessionId: string | null = null;
  let sessionFile: string | null = null;
  let cwd: string | null = null;
  const clients = new Set<net.Socket>();
  const wrappedUIs = new WeakSet<object>();

  let turnInProgress = false;
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

  function emitExtensionUIRequest(req: any) {
    if (!req?.id) req.id = crypto.randomUUID();

    if (req.method === "setWidget") {
      if (req.widgetLines === undefined || (Array.isArray(req.widgetLines) && req.widgetLines.length === 0)) {
        uiState.widgets.delete(req.widgetKey || "default");
      } else {
        uiState.widgets.set(req.widgetKey || "default", req);
      }
    } else if (req.method === "setStatus") {
      if (!req.statusText) uiState.statuses.delete(req.statusKey || "default");
      else uiState.statuses.set(req.statusKey || "default", req);
    } else if (req.method === "setTitle") {
      uiState.title = req;
    } else if (req.method === "set_editor_text") {
      uiState.editorText = req;
    }

    broadcast({ type: "event", event: "extension_ui_request", data: req });
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

  function writeRegistry() {
    if (!sessionId || !registryPath || !sessionFile) return;
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
      updatedAt: new Date().toISOString(),
    };
    try {
      fs.writeFileSync(registryPath, JSON.stringify(entry, null, 2));
    } catch (e) {
      // best effort
    }
  }

  function cleanup() {
    for (const c of clients) { try { c.destroy(); } catch {} }
    clients.clear();
    if (server) { try { server.close(); } catch {} server = null; }
    if (socketPath) { try { fs.unlinkSync(socketPath); } catch {} }
    if (registryPath) { try { fs.unlinkSync(registryPath); } catch {} }
    socketPath = null;
    registryPath = null;
    sessionId = null;
    sessionFile = null;
    cwd = null;
    turnInProgress = false;
    contextUsage = null;
    pendingDialogs.clear();
    dialogRequests.clear();
    uiState.widgets.clear();
    uiState.statuses.clear();
    uiState.title = null;
    uiState.editorText = null;
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
      model: modelId,
      contextUsage,
      thinkingLevel: getThinkingLevel(),
      name: sessionName,
      pid: process.pid,
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

    emitTo(sock, { type: "hello", ...stateSnapshot() });
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
      lastCtx.compact(args ? { customInstructions: args } : undefined);
      return { ok: true, info: "Compaction started" };
    }
    if (name === "abort") {
      if (!lastCtx) return { ok: false, error: "no active context" };
      lastCtx.abort();
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
      await pi.sendUserMessage(expanded, deliverAsOptions(deliverAs));
      return { ok: true };
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
      await pi.sendUserMessage(expanded, deliverAsOptions(deliverAs));
      return { ok: true };
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
          const opts: any = {};
          if (cmd.deliverAs) opts.deliverAs = cmd.deliverAs;
          await pi.sendUserMessage(content, opts);
          respond(true);
          return;
        }

        case "steer": {
          const content = buildUserContent(cmd);
          if (!content) return respond(false, undefined, "message required");
          await pi.sendUserMessage(content, { deliverAs: "steer" });
          respond(true);
          return;
        }

        case "follow_up": {
          const content = buildUserContent(cmd);
          if (!content) return respond(false, undefined, "message required");
          await pi.sendUserMessage(content, { deliverAs: "followUp" });
          respond(true);
          return;
        }

        case "abort": {
          if (!lastCtx) return respond(false, undefined, "no active context");
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
            // Extension commands can't be invoked over the bridge.
            supported: c.source !== "extension",
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
    refreshModel(ctx);
    refreshContextUsage(ctx);
    const sf = ctx.sessionManager.getSessionFile();
    if (!sf) return; // ephemeral, skip
    sessionFile = sf;
    sessionId = path.basename(sf, ".jsonl");
    cwd = ctx.cwd;
    socketPath = path.join(SOCKET_DIR, `${sessionId}.sock`);
    registryPath = path.join(REGISTRY_DIR, `${sessionId}.json`);

    // Stale socket cleanup
    try { fs.unlinkSync(socketPath); } catch {}

    server = net.createServer(handleClient);
    server.on("error", (e) => {
      // best effort: log to stderr
      try { process.stderr.write(`[pi-dish-bridge] server error: ${e}\n`); } catch {}
    });
    server.listen(socketPath, () => {
      try { fs.chmodSync(socketPath!, 0o600); } catch {}
    });

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
      } else if (ev === "compaction_end") {
        refreshContextUsage(ctx);
        writeRegistry();
      }
      broadcast({ type: "event", event: ev, data: event });
    });
  }
}
