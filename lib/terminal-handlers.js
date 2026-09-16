// Generated from src/core/terminal-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTerminalHandlers = createTerminalHandlers;
const helper_values_1 = require("./helper-values");
const tmux_1 = require("./tmux");
const terminal_1 = require("./terminal");
/** Local terminal only; peer upgrades remain ahead of it in the dispatcher. */
function createTerminalHandlers(ports) {
    // Disabled requests must remain indistinguishable from an absent endpoint.
    if (!(0, terminal_1.isTerminalEnabled)())
        return { upgrade: () => false, shutdown: () => { } };
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ noServer: true });
    const TERMINAL_PATH_RE = /^\/api\/sessions\/([^/]+)\/terminal$/;
    function upgrade(req, socket, head, url) {
        const match = TERMINAL_PATH_RE.exec(url.pathname);
        if (!match)
            return false;
        // Upgrades bypass Express; re-apply the API authentication and origin gate.
        if (!ports.upgradeAuthorized(req, url)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return true;
        }
        // Preserve synchronous malformed-percent failures from the original block.
        const sessionId = decodeURIComponent(match[1]);
        const known = ports.getRegisteredSession(sessionId) || ports.getRPCSession(sessionId) || ports.findSessionFile(sessionId);
        if (!known) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return true;
        }
        // Capture the requested identity above; async pane lookup never retargets it.
        void (async () => {
            let key = sessionId;
            let opts;
            if (url.searchParams.get('mode') === 'tmux') {
                const pane = await ports.locatePiPane(sessionId);
                const command = pane && await (0, tmux_1.attachPaneArgv)(pane.socket, pane.paneId);
                if (!pane || !command) {
                    return wss.handleUpgrade(req, socket, head, (ws) => {
                        const frame = { type: 'error', error: 'No tmux pane found for this session' };
                        try {
                            ws.send(JSON.stringify(frame));
                        }
                        catch { }
                        ws.close(1011, 'no tmux pane');
                    });
                }
                // Shell and grouped pane viewer coexist. Strip inherited nesting hints.
                key = `${sessionId}:tmux`;
                opts = {
                    command,
                    env: { TMUX: undefined, TMUX_PANE: undefined },
                    meta: { tmuxPrefix: await (0, tmux_1.getPrefixKey)(pane.socket) },
                };
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                try {
                    (0, terminal_1.attachClient)(key, ports.resolveSessionCwd(sessionId), ws, opts);
                }
                catch (error) {
                    try {
                        const frame = { type: 'error', error: (0, helper_values_1.record)(error) ? error.message : undefined };
                        ws.send(JSON.stringify(frame));
                    }
                    catch { }
                    ws.close(1011, 'terminal failed');
                }
            });
        })().catch(() => socket.destroy());
        return true;
    }
    // Keep the original shutdown policy: kill PTYs, not a new WS lifecycle owner.
    return { upgrade, shutdown: terminal_1.killAllTerminals };
}
