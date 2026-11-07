import { errorMessage, errorStatus, requestBody, type RouteHandler } from './http-boundary';
import { BridgeSession } from './bridge-session';
import { PrimeDaemonSession } from './prime-daemon';
import { removeExtensionUIDialog } from './extension-ui-state';
import { ALL_THINKING_LEVEL_NAMES, parseModelId, thinkingLevelNamesFor } from './helper-models.js';
import * as piSDK from './pi-sdk';
import { thinkingResult } from './session-api';
import { asRecord } from './wire-protocol';
import { liveSessionSupports, routeIdentity } from './session-ownership';
import tmux = require('./tmux');
import type { SessionOwnership } from './session-ownership';
import type { SessionSource } from './session-source';

export interface SessionMutationPorts {
  ownership: SessionOwnership;
  findSessionSource(id: string, options?: { exact?: boolean }): SessionSource | null;
}

function sideChatSnapshot(data: unknown) {
  return { success: true, sideChat: asRecord(data).sideChat ?? null };
}

export function sideChatSupported(sess: InstanceType<typeof BridgeSession>, res: Parameters<RouteHandler>[1]): boolean {
  if (liveSessionSupports(sess, 'sideChat')) return true;
  res.status(409).json({
    error: asRecord(sess.capabilities).btw === true
      ? 'This session runs an older pi-dish bridge; restart it to use side chats.'
      : 'This session does not support side chats.',
  });
  return false;
}

export function createSessionMutationHandlers({ ownership, findSessionSource }: SessionMutationPorts) {
  const thinking: RouteHandler = async (req, res) => {
    const { level } = requestBody(req);
    if (typeof level !== 'string' || !ALL_THINKING_LEVEL_NAMES.includes(level)) {
      return res.status(400).json({ error: `level must be one of: ${ALL_THINKING_LEVEL_NAMES.join(', ')}` });
    }
    try {
      const sess = await ownership.getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      if (!liveSessionSupports(sess, 'setThinking')) {
        return res.status(409).json({ error: 'This session does not support changing thinking level.' });
      }
      const levels = thinkingLevelNamesFor(routeIdentity(req.params.id)?.harnessId ?? 'pi');
      if (!levels.includes(level)) {
        return res.status(400).json({ error: `level must be one of: ${levels.join(', ')}` });
      }
      res.json(thinkingResult(await sess.setThinkingLevel(level), level));
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };

  const fast: RouteHandler = async (req, res) => {
    const { enabled } = requestBody(req);
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    try {
      const sess = await ownership.getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      if (!(sess instanceof BridgeSession) || !liveSessionSupports(sess, 'fastMode')) {
        return res.status(409).json({ error: 'This session does not support fast mode.' });
      }
      const data = await sess.setFastMode(enabled);
      res.json({ success: true, fastMode: asRecord(data).fastMode ?? null });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };

  const abort: RouteHandler = async (req, res) => {
    try {
      const sess = await ownership.getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      if (!liveSessionSupports(sess, 'abort')) return res.status(409).json({ error: 'This session does not support abort.' });
      await sess.abort();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };

  async function sideChatBridge(req: Parameters<RouteHandler>[0], res: Parameters<RouteHandler>[1]) {
    const sess = await ownership.getLiveSession(req.params.id);
    if (!sess) { res.status(404).json({ error: 'Session not active' }); return null; }
    if (!(sess instanceof BridgeSession)) {
      res.status(409).json({ error: 'This session does not support side chats.' });
      return null;
    }
    return sess;
  }

  function withSideChat(route: (sess: InstanceType<typeof BridgeSession>, req: Parameters<RouteHandler>[0], res: Parameters<RouteHandler>[1]) => Promise<unknown>): RouteHandler {
    return async (req, res) => {
      try {
        const sess = await sideChatBridge(req, res);
        if (sess) await route(sess, req, res);
      } catch (error) {
        res.status(errorStatus(error, 400)).json({ error: errorMessage(error) });
      }
    };
  }

  const sideChat = withSideChat(async (sess, _req, res) => {
    res.json({ sideChat: sess.sideChat ?? null });
  });

  const sideChatAsk = withSideChat(async (sess, req, res) => {
    if (!sideChatSupported(sess, res)) return;
    const { question, chatId } = requestBody(req);
    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'usage: /btw <question>' });
    }
    if (chatId !== undefined && chatId !== null && typeof chatId !== 'string') {
      return res.status(400).json({ error: 'chatId must be a string' });
    }
    const data = await sess.sideChatAsk(question.trim(), typeof chatId === 'string' && chatId ? chatId : undefined);
    res.json(sideChatSnapshot(data));
  });

  const sideChatCancel = withSideChat(async (sess, req, res) => {
    if (!sideChatSupported(sess, res)) return;
    const { chatId } = requestBody(req);
    if (typeof chatId !== 'string' || !chatId) {
      return res.status(400).json({ error: 'chatId required' });
    }
    res.json(sideChatSnapshot(await sess.sideChatCancel(chatId)));
  });

  const sideChatClose = withSideChat(async (sess, req, res) => {
    if (!sideChatSupported(sess, res)) return;
    const { chatId } = requestBody(req);
    if (typeof chatId !== 'string' || !chatId) {
      return res.status(400).json({ error: 'chatId required' });
    }
    res.json(sideChatSnapshot(await sess.sideChatClose(chatId)));
  });

  const uiResponse: RouteHandler = async (req, res) => {
    const body = requestBody(req);
    if (!body.requestId || typeof body.requestId !== 'string') {
      return res.status(400).json({ error: 'requestId required' });
    }
    const response: Record<string, unknown> = {};
    if (body.value !== undefined) response.value = body.value;
    if (body.confirmed !== undefined) response.confirmed = body.confirmed;
    if (body.cancelled !== undefined) response.cancelled = body.cancelled;
    try {
      const sess = await ownership.getLiveSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not active' });
      if (!liveSessionSupports(sess, 'extensionUI')) {
        return res.status(409).json({ error: 'This session does not support remote extension UI.' });
      }
      await sess.respondExtensionUI(body.requestId, response);
      // RPC has no resolved event; acknowledge against the captured session.
      removeExtensionUIDialog(sess.extUIState, body.requestId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };

  const rename: RouteHandler = async (req, res) => {
    const { name } = requestBody(req);
    if (typeof name !== 'string' || !name) return res.status(400).json({ error: 'Name required' });
    try {
      const sess = await ownership.getLiveSession(req.params.id);
      if (sess) {
        if (!liveSessionSupports(sess, 'rename')) {
          return res.status(409).json({ error: 'This session does not support renaming.' });
        }
        await sess.setName(name);
        const tmuxState = ownership.getRegisteredSession(req.params.id)?.tmux as { socket?: string; pane?: string } | undefined;
        const spawn = tmux.getSpawn(req.params.id);
        const socket = tmuxState?.socket || spawn?.socket;
        const pane = tmuxState?.pane || spawn?.paneId;
        if (socket && pane) await tmux.renameWindow(socket, pane, name).catch(() => {});
        return res.json({ success: true });
      }
      const session = findSessionSource(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (session.harnessId !== 'pi') {
        return res.status(409).json({ error: 'Renaming an inactive session is only supported for Pi.' });
      }
      await piSDK.renameSession(session.file, name);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };

  const model: RouteHandler = async (req, res) => {
    const { modelId, model: alias } = requestBody(req);
    const requested = modelId || alias;
    if (typeof requested !== 'string' || !requested) {
      return res.status(400).json({ error: 'modelId or model required' });
    }
    const { provider, id } = parseModelId(requested);
    if (!provider || !id) return res.status(400).json({ error: `Invalid model ID: ${requested}` });
    try {
      const sess = await ownership.getLiveSession(req.params.id);
      if (sess) {
        if (!liveSessionSupports(sess, 'setModel')) {
          return res.status(409).json({ error: 'This session does not support changing models.' });
        }
        await sess.setModel(provider, id);
        return res.json({ success: true });
      }
      const session = findSessionSource(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (session.harnessId !== 'pi') {
        return res.status(409).json({ error: 'Changing the model of an inactive session is only supported for Pi.' });
      }
      await piSDK.switchModel(session.file, provider, id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };

  // Remove a not-yet-delivered queued steer/follow-up so its text can go back
  // to the composer. Bridge sessions own the queue inside pi; a Prime root's
  // queue lives in the daemon. RPC children have no remote queue editing.
  const cancelQueued: RouteHandler = async (req, res) => {
    const { kind, index, text } = requestBody(req);
    const validationError = (kind !== 'steering' && kind !== 'followUp')
      || typeof text !== 'string' || !text
      ? 'kind (steering|followUp) and non-empty text required'
      : !Number.isInteger(index) || (index as number) < 0
        ? 'index must be a non-negative integer'
        : null;
    try {
      const sess = await ownership.getLiveSession(req.params.id);
      if (!sess) {
        if (validationError) return res.status(400).json({ error: validationError });
        return res.status(404).json({ error: 'Session not active' });
      }
      if (!(sess instanceof BridgeSession) && !(sess instanceof PrimeDaemonSession)) {
        return res.status(501).json({ error: 'queue editing requires a live pi-dish bridge or Prime daemon session' });
      }
      if (!liveSessionSupports(sess, 'queueCancel')) {
        return res.status(409).json({ error: 'This session does not support queue cancellation.' });
      }
      if (validationError) return res.status(400).json({ error: validationError });
      const result = await sess.cancelQueued(kind as 'steering' | 'followUp', index as number, text as string);
      res.json({ success: true, result });
    } catch (error) {
      res.status(409).json({ error: errorMessage(error) });
    }
  };

  return {
    thinking, fast, abort, sideChat, sideChatAsk, sideChatCancel, sideChatClose,
    uiResponse, rename, model, cancelQueued,
  };
}
