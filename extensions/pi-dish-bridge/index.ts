import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
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
] as const;

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
  let sessionName: string | null = null;
  let lastCtx: ExtensionContext | null = null;

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
      ?? null;
  }

  function refreshModel(ctx?: ExtensionContext | null) {
    const model = formatModel(ctx?.model ?? lastCtx?.model);
    if (model) modelId = model;
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
  }

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

    const wrapDialog = (name: string, makeReq: (...args: any[]) => any) => {
      const original = ui[name];
      if (typeof original !== "function") return;
      ui[name] = function (...args: any[]) {
        try { emitExtensionUIRequest(makeReq(...args)); } catch {}
        return original.apply(this, args);
      };
    };
    wrapDialog("select", (title: string, options: string[], opts?: any) => ({ method: "select", title, options, timeout: opts?.timeout }));
    wrapDialog("confirm", (title: string, message: string, opts?: any) => ({ method: "confirm", title, message, timeout: opts?.timeout }));
    wrapDialog("input", (title: string, placeholder?: string, opts?: any) => ({ method: "input", title, placeholder, timeout: opts?.timeout }));
    wrapDialog("editor", (title: string, prefill?: string) => ({ method: "editor", title, prefill }));
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
    uiState.widgets.clear();
    uiState.statuses.clear();
    uiState.title = null;
    uiState.editorText = null;
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

    emitTo(sock, {
      type: "hello",
      sessionId,
      sessionFile,
      cwd,
      turnInProgress,
      model: modelId,
      name: sessionName,
      pid: process.pid,
    });
    replayExtensionUI(sock);
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
          respond(true, {
            sessionId,
            sessionFile,
            cwd,
            turnInProgress,
            model: modelId,
            name: sessionName,
            pid: process.pid,
          });
          return;

        case "prompt": {
          if (!cmd.message) return respond(false, undefined, "message required");
          const opts: any = {};
          if (cmd.deliverAs) opts.deliverAs = cmd.deliverAs;
          await pi.sendUserMessage(cmd.message, opts);
          respond(true);
          return;
        }

        case "steer": {
          if (!cmd.message) return respond(false, undefined, "message required");
          await pi.sendUserMessage(cmd.message, { deliverAs: "steer" });
          respond(true);
          return;
        }

        case "follow_up": {
          if (!cmd.message) return respond(false, undefined, "message required");
          await pi.sendUserMessage(cmd.message, { deliverAs: "followUp" });
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

        case "set_model": {
          const requested = cmd.model ?? (cmd.provider && cmd.modelId ? `${cmd.provider}/${cmd.modelId}` : null);
          if (!requested) return respond(false, undefined, "model required");
          const model = typeof requested === "string" ? await resolveModel(requested) : requested;
          if (!model) return respond(false, undefined, `model not found: ${requested}`);
          const ok = await pi.setModel(model);
          if (ok) {
            modelId = formatModel(model) ?? modelId;
            writeRegistry();
          }
          respond(!!ok, { model: modelId });
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
        writeRegistry();
      } else if (ev === "model_select") {
        modelId = formatModel(event?.model) ?? modelId;
        writeRegistry();
      }
      broadcast({ type: "event", event: ev, data: event });
    });
  }
}
