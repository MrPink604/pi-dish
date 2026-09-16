import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type * as WS from 'ws';
import { attachPaneArgv, getPrefixKey } from './tmux';
import type { PaneTarget } from './tmux';
import { attachClient, isTerminalEnabled, killAllTerminals } from './terminal';
import type { TerminalErrorFrame, TerminalOptions } from './terminal';

export interface TerminalPorts {
  upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
  // Observations are used only for existence, never as process authority.
  getRegisteredSession(id: string): object | null | undefined;
  getRPCSession(id: string): object | null | undefined;
  findSessionFile(id: string): string | null | undefined;
  resolveSessionCwd(id: string): string | null | undefined;
  locatePiPane(id: string): Promise<PaneTarget | null>;
}

export interface TerminalHandlers {
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean;
  shutdown(): void;
}

/** Local terminal only; peer upgrades remain ahead of it in the dispatcher. */
export function createTerminalHandlers(ports: TerminalPorts): TerminalHandlers {
  // Disabled requests must remain indistinguishable from an absent endpoint.
  if (!isTerminalEnabled()) return { upgrade: () => false, shutdown: () => {} };

  const { WebSocketServer } = require('ws') as typeof WS;
  const wss = new WebSocketServer({ noServer: true });
  const TERMINAL_PATH_RE = /^\/api\/sessions\/([^/]+)\/terminal$/;

  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean {
    const match = TERMINAL_PATH_RE.exec(url.pathname);
    if (!match) return false;
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
      let opts: TerminalOptions | undefined;
      if (url.searchParams.get('mode') === 'tmux') {
        const pane = await ports.locatePiPane(sessionId);
        const command = pane && await attachPaneArgv(pane.socket, pane.paneId);
        if (!pane || !command) {
          return wss.handleUpgrade(req, socket, head, (ws) => {
            const frame: TerminalErrorFrame = { type: 'error', error: 'No tmux pane found for this session' };
            try { ws.send(JSON.stringify(frame)); } catch {}
            ws.close(1011, 'no tmux pane');
          });
        }
        // Shell and grouped pane viewer coexist. Strip inherited nesting hints.
        key = `${sessionId}:tmux`;
        opts = {
          command,
          env: { TMUX: undefined, TMUX_PANE: undefined },
          meta: { tmuxPrefix: await getPrefixKey(pane.socket) },
        };
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        try {
          attachClient(key, ports.resolveSessionCwd(sessionId), ws, opts);
        } catch (error) {
          try {
            // Preserve property access inside this catch: null/undefined skip
            // the frame, while function/object errors may carry a message.
            const failure = error as { message?: unknown };
            const frame: TerminalErrorFrame = { type: 'error', error: failure.message };
            ws.send(JSON.stringify(frame));
          } catch {}
          ws.close(1011, 'terminal failed');
        }
      });
    })().catch(() => socket.destroy());
    return true;
  }

  // Keep the original shutdown policy: kill PTYs, not a new WS lifecycle owner.
  return { upgrade, shutdown: killAllTerminals };
}
