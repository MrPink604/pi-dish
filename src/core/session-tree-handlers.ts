import type { RouteHandler } from './http-boundary';
import { requestBody } from './http-boundary';
import { BridgeSession } from './bridge-session';
import { PrimeDaemonSession } from './prime-daemon';
import { errorMessage, httpError } from './http-boundary';
import * as piSDK from './pi-sdk';
import { liveSessionSupports, routeIdentity } from './session-ownership';
import { isRecord } from './wire-protocol';
import tmux = require('./tmux');
import type { BridgeRegistryEntry } from './contracts';
import type { BranchSessionOptions } from './pi-sdk';
import type { RPCSession } from './rpc-session';
import type { LiveSession } from './session-ownership';
import type { SessionSource } from './session-source';

export interface SessionTreePorts {
  getLiveSession(sessionId: string): Promise<LiveSession | null>;
  findSessionSource(id: string): SessionSource | null;
  getRegisteredSession(id: string): BridgeRegistryEntry | null;
  getRPCSession(id: string): InstanceType<typeof RPCSession> | null | undefined;
  locatePiPane(sessionId: string): Promise<tmux.PaneTarget | null>;
}

const TMUX_CHORD_MODIFIERS: Record<string, string> = { ctrl: 'C-', alt: 'M-', shift: 'S-' };

// The tmux key chord a bridge advertises for its tree service. Only F-keys are
// accepted: they are inert in a TUI and can never be delivered as literal text.
function tmuxKeyForChord(chord: unknown): string | null {
  if (typeof chord !== 'string' || !chord) return null;
  const parts = chord.toLowerCase().split('+');
  const base = parts.pop()!;
  if (!/^f([1-9]|1[0-2])$/.test(base)) return null;
  if (parts.some((part) => !TMUX_CHORD_MODIFIERS[part])) return null;
  const prefix = Object.keys(TMUX_CHORD_MODIFIERS)
    .filter((modifier) => parts.includes(modifier))
    .map((modifier) => TMUX_CHORD_MODIFIERS[modifier])
    .join('');
  return `${prefix}${base.toUpperCase()}`;
}

export function createSessionTreeHandler(ports: SessionTreePorts) {
  // Bridge navigate_tree needs a stashed pi command context. RPC-backed
  // sessions can prime one with an RPC prompt; tmux TUI sessions get the
  // command typed into their pane.
  async function navigateLiveTree(sessionId: string, sess: InstanceType<typeof BridgeSession>, entryId: string, opts: BranchSessionOptions) {
    try {
      return await sess.navigateTree(entryId, opts);
    } catch (error) {
      if (!/no command context/i.test(errorMessage(error))) throw error;
      const rpc = ports.getRPCSession(sessionId);
      if (rpc?.alive) {
        await rpc.prompt('/dish-prime');
        return sess.navigateTree(entryId, opts);
      }
      const spawn = tmux.getSpawn(sessionId);
      if (spawn && await tmux.paneExists(spawn.socket, spawn.paneId)) {
        await tmux.sendKeys(spawn.socket, spawn.paneId, '/dish-prime');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return sess.navigateTree(entryId, opts);
      }
      throw error;
    }
  }

  // OMP exposes branch/navigation only on command contexts, and its public
  // sendUserMessage bypasses command dispatch: queue the bridge request, then
  // trigger the bridge's internal tree service in the live TUI pane. The
  // trigger is the advertised shortcut, not its command name, because
  // send-keys of a command concatenates with the user's draft.
  async function navigateLiveOmpTree(sessionId: string, sess: InstanceType<typeof BridgeSession>, entryId: string, opts: BranchSessionOptions) {
    const pane = await ports.locatePiPane(sessionId);
    if (!pane) {
      throw httpError('Oh My Pi tree navigation requires a reachable tmux pane to acquire its command context.', 409);
    }
    const chordKey = tmuxKeyForChord(ports.getRegisteredSession(sessionId)?.treeServiceShortcut);
    const operation = sess.treeNavigate(entryId, opts);
    operation.catch(() => {});
    const handoff = new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        sess.off('tree_operation_queued', onQueued);
      };
      const onQueued = (data: unknown) => {
        if (!isRecord(data) || data.requestId !== operation.requestId) return;
        cleanup();
        resolve();
      };
      sess.on('tree_operation_queued', onQueued);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('bridge did not acknowledge the queued tree operation'));
      }, 2000);
    }).then(() => (chordKey
      ? tmux.sendKey(pane.socket, pane.paneId, chordKey)
      : tmux.sendKeys(pane.socket, pane.paneId, '/dish-tree-service')
    )).catch((cause: unknown) => {
      throw httpError(`Oh My Pi tree navigation could not acquire its command context: ${errorMessage(cause)}`, 409);
    });
    handoff.catch(() => {});
    // A bridge that refuses outright never acknowledges a queued operation;
    // race the two so its precise error wins over the acknowledgement timeout.
    await Promise.race([operation, handoff]);
    return operation;
  }

  const branch: RouteHandler = async (req, res) => {
    const body = requestBody(req);
    if (!body.entryId || typeof body.entryId !== 'string') {
      return res.status(400).json({ error: 'entryId required' });
    }
    const entryId = body.entryId;
    const opts: BranchSessionOptions = {
      summarize: !!body.summarize,
      customInstructions: typeof body.customInstructions === 'string' && body.customInstructions.trim()
        ? body.customInstructions.trim() : undefined,
    };
    try {
      const identity = routeIdentity(req.params.id);
      if (!identity) return res.status(400).json({ error: 'Invalid session ID' });
      if (identity.harnessId !== 'pi' && identity.harnessId !== 'omp' && identity.harnessId !== 'prime') {
        return res.status(409).json({ error: 'Session tree navigation is not supported for this harness.' });
      }
      const source = ports.findSessionSource(req.params.id);
      const sess = await ports.getLiveSession(req.params.id);
      if (sess) {
        if (!liveSessionSupports(sess, 'treeNavigation')) {
          return res.status(409).json({ error: 'This session does not support tree navigation.' });
        }
        // Prime owns the leaf in its daemon process.
        if (sess instanceof PrimeDaemonSession) {
          const data = await sess.navigateTree(entryId, opts);
          if (isRecord(data) && data.cancelled === true) {
            return res.status(409).json({ error: 'Prime Agent cancelled the tree navigation; the leaf was not moved.' });
          }
          return res.json({ success: true, editorText: isRecord(data) ? data.editorText : undefined });
        }
        if (!(sess instanceof BridgeSession)) {
          return res.status(409).json({ error: 'This live session has no bridge connection — install the pi-dish-bridge extension to navigate its tree.' });
        }
        try {
          const data = identity.harnessId === 'omp'
            ? await navigateLiveOmpTree(req.params.id, sess, entryId, opts)
            : await navigateLiveTree(req.params.id, sess, entryId, opts);
          return res.json({ success: true, editorText: isRecord(data) ? data.editorText : undefined });
        } catch (error) {
          const message = errorMessage(error);
          if (/unknown command/i.test(message)) {
            return res.status(409).json({ error: 'The pi session is running an older pi-dish-bridge — run /reload in it (or restart it) to enable tree navigation.' });
          }
          if (/no command context/i.test(message)) {
            return res.status(409).json({ error: "pi hands out session control only inside command handlers and this session couldn't be primed remotely — send any prompt to it (or run /dish-push once in its TUI), then retry." });
          }
          // Refusals about live session state are the caller's to act on.
          if (/turn is in progress|compaction is in progress|entry not found/i.test(message)) {
            return res.status(409).json({ error: message });
          }
          if (identity.harnessId === 'omp' && /timed out/i.test(message)) {
            return res.status(504).json({ error: message });
          }
          if (identity.harnessId === 'omp' && /cancelled|unavailable|command context/i.test(message)) {
            return res.status(409).json({ error: message });
          }
          throw error;
        }
      }
      if (!source) return res.status(404).json({ error: 'Session not found' });
      if (identity.harnessId === 'omp') {
        return res.status(409).json({ error: 'Navigating the tree of an inactive Oh My Pi session is not supported.' });
      }
      if (identity.harnessId === 'prime') {
        return res.status(409).json({ error: 'Navigating the tree of an inactive Prime Agent session is not supported.' });
      }
      const result = await piSDK.branchSession(source.file, entryId, opts);
      res.json({ success: true, editorText: result.editorText });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };

  return { branch };
}
