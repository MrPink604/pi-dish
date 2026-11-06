// Generated from src/core/session-mutation-handlers.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sideChatSupported = sideChatSupported;
exports.createSessionMutationHandlers = createSessionMutationHandlers;
const http_boundary_1 = require("./http-boundary");
const bridge_session_1 = require("./bridge-session");
const prime_daemon_1 = require("./prime-daemon");
const http_boundary_2 = require("./http-boundary");
const extension_ui_state_1 = require("./extension-ui-state");
const helper_models_js_1 = require("./helper-models.js");
const piSDK = __importStar(require("./pi-sdk"));
const session_api_1 = require("./session-api");
const wire_protocol_1 = require("./wire-protocol");
const session_ownership_1 = require("./session-ownership");
const tmux = require("./tmux");
function sideChatSnapshot(data) {
    return { success: true, sideChat: (0, wire_protocol_1.isRecord)(data) ? data.sideChat ?? null : null };
}
function sideChatSupported(sess, res) {
    if ((0, session_ownership_1.liveSessionSupports)(sess, 'sideChat'))
        return true;
    // A harness started before side chats still runs the old blocking /btw
    // bridge; only a restart loads the new extension.
    res.status(409).json({
        error: sess.capabilities.btw === true
            ? 'This session runs an older pi-dish bridge; restart it to use side chats.'
            : 'This session does not support side chats.',
    });
    return false;
}
function createSessionMutationHandlers(ports) {
    const thinking = async (req, res) => {
        const { level } = (0, http_boundary_1.requestBody)(req);
        if (typeof level !== 'string' || !helper_models_js_1.ALL_THINKING_LEVEL_NAMES.includes(level)) {
            return res.status(400).json({ error: `level must be one of: ${helper_models_js_1.ALL_THINKING_LEVEL_NAMES.join(', ')}` });
        }
        try {
            const sess = await ports.getLiveSession(req.params.id);
            if (!sess)
                return res.status(404).json({ error: 'Session not active' });
            if (!(0, session_ownership_1.liveSessionSupports)(sess, 'setThinking')) {
                return res.status(409).json({ error: 'This session does not support changing thinking level.' });
            }
            const levels = (0, helper_models_js_1.thinkingLevelNamesFor)((0, session_ownership_1.routeIdentity)(req.params.id)?.harnessId ?? 'pi');
            if (!levels.includes(level)) {
                return res.status(400).json({ error: `level must be one of: ${levels.join(', ')}` });
            }
            res.json((0, session_api_1.thinkingResult)(await sess.setThinkingLevel(level), level));
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_2.errorMessage)(error) });
        }
    };
    const fast = async (req, res) => {
        const { enabled } = (0, http_boundary_1.requestBody)(req);
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean' });
        }
        try {
            const sess = await ports.getLiveSession(req.params.id);
            if (!sess)
                return res.status(404).json({ error: 'Session not active' });
            if (!(sess instanceof bridge_session_1.BridgeSession) || !(0, session_ownership_1.liveSessionSupports)(sess, 'fastMode')) {
                return res.status(409).json({ error: 'This session does not support fast mode.' });
            }
            const data = await sess.setFastMode(enabled);
            res.json({ success: true, fastMode: data?.fastMode ?? null });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_2.errorMessage)(error) });
        }
    };
    const abort = async (req, res) => {
        try {
            const sess = await ports.getLiveSession(req.params.id);
            if (!sess)
                return res.status(404).json({ error: 'Session not active' });
            if (!(0, session_ownership_1.liveSessionSupports)(sess, 'abort'))
                return res.status(409).json({ error: 'This session does not support abort.' });
            await sess.abort();
            res.json({ success: true });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_2.errorMessage)(error) });
        }
    };
    async function sideChatBridge(req, res) {
        const sess = await ports.getLiveSession(req.params.id);
        if (!sess) {
            res.status(404).json({ error: 'Session not active' });
            return null;
        }
        if (!(sess instanceof bridge_session_1.BridgeSession)) {
            res.status(409).json({ error: 'This session does not support side chats.' });
            return null;
        }
        return sess;
    }
    function withSideChat(route) {
        return async (req, res) => {
            try {
                const sess = await sideChatBridge(req, res);
                if (sess)
                    await route(sess, req, res);
            }
            catch (error) {
                res.status((0, http_boundary_2.errorStatus)(error, 400)).json({ error: (0, http_boundary_2.errorMessage)(error) });
            }
        };
    }
    const sideChat = withSideChat(async (sess, _req, res) => {
        res.json({ sideChat: sess.sideChat ?? null });
    });
    const sideChatAsk = withSideChat(async (sess, req, res) => {
        if (!sideChatSupported(sess, res))
            return;
        const { question, chatId } = (0, http_boundary_1.requestBody)(req);
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
        if (!sideChatSupported(sess, res))
            return;
        const { chatId } = (0, http_boundary_1.requestBody)(req);
        if (typeof chatId !== 'string' || !chatId) {
            return res.status(400).json({ error: 'chatId required' });
        }
        res.json(sideChatSnapshot(await sess.sideChatCancel(chatId)));
    });
    const sideChatClose = withSideChat(async (sess, req, res) => {
        if (!sideChatSupported(sess, res))
            return;
        const { chatId } = (0, http_boundary_1.requestBody)(req);
        if (typeof chatId !== 'string' || !chatId) {
            return res.status(400).json({ error: 'chatId required' });
        }
        res.json(sideChatSnapshot(await sess.sideChatClose(chatId)));
    });
    const uiResponse = async (req, res) => {
        const body = (0, http_boundary_1.requestBody)(req);
        if (!body.requestId || typeof body.requestId !== 'string') {
            return res.status(400).json({ error: 'requestId required' });
        }
        const response = {};
        if (body.value !== undefined)
            response.value = body.value;
        if (body.confirmed !== undefined)
            response.confirmed = body.confirmed;
        if (body.cancelled !== undefined)
            response.cancelled = body.cancelled;
        try {
            const sess = await ports.getLiveSession(req.params.id);
            if (!sess)
                return res.status(404).json({ error: 'Session not active' });
            if (!(0, session_ownership_1.liveSessionSupports)(sess, 'extensionUI')) {
                return res.status(409).json({ error: 'This session does not support remote extension UI.' });
            }
            await sess.respondExtensionUI(body.requestId, response);
            // RPC has no resolved event; acknowledge against the captured session.
            (0, extension_ui_state_1.removeExtensionUIDialog)(sess.extUIState, body.requestId);
            res.json({ success: true });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_2.errorMessage)(error) });
        }
    };
    const rename = async (req, res) => {
        const { name } = (0, http_boundary_1.requestBody)(req);
        if (typeof name !== 'string' || !name)
            return res.status(400).json({ error: 'Name required' });
        try {
            const sess = await ports.getLiveSession(req.params.id);
            if (sess) {
                if (!(0, session_ownership_1.liveSessionSupports)(sess, 'rename')) {
                    return res.status(409).json({ error: 'This session does not support renaming.' });
                }
                await sess.setName(name);
                const tmuxState = ports.getRegisteredSession(req.params.id)?.tmux;
                const spawn = tmux.getSpawn(req.params.id);
                const socket = tmuxState?.socket || spawn?.socket;
                const pane = tmuxState?.pane || spawn?.paneId;
                if (socket && pane)
                    await tmux.renameWindow(socket, pane, name).catch(() => { });
                return res.json({ success: true });
            }
            const session = ports.findSessionSource(req.params.id);
            if (!session)
                return res.status(404).json({ error: 'Session not found' });
            if (session.harnessId !== 'pi') {
                return res.status(409).json({ error: 'Renaming an inactive session is only supported for Pi.' });
            }
            await piSDK.renameSession(session.file, name);
            res.json({ success: true });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_2.errorMessage)(error) });
        }
    };
    const model = async (req, res) => {
        const { modelId, model: alias } = (0, http_boundary_1.requestBody)(req);
        const requested = modelId || alias;
        if (typeof requested !== 'string' || !requested) {
            return res.status(400).json({ error: 'modelId or model required' });
        }
        const { provider, id } = (0, helper_models_js_1.parseModelId)(requested);
        if (!provider || !id)
            return res.status(400).json({ error: `Invalid model ID: ${requested}` });
        try {
            const sess = await ports.getLiveSession(req.params.id);
            if (sess) {
                if (!(0, session_ownership_1.liveSessionSupports)(sess, 'setModel')) {
                    return res.status(409).json({ error: 'This session does not support changing models.' });
                }
                await sess.setModel(provider, id);
                return res.json({ success: true });
            }
            const session = ports.findSessionSource(req.params.id);
            if (!session)
                return res.status(404).json({ error: 'Session not found' });
            if (session.harnessId !== 'pi') {
                return res.status(409).json({ error: 'Changing the model of an inactive session is only supported for Pi.' });
            }
            await piSDK.switchModel(session.file, provider, id);
            res.json({ success: true });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_2.errorMessage)(error) });
        }
    };
    // Remove a not-yet-delivered queued steer/follow-up so its text can go back
    // to the composer. Bridge sessions own the queue inside pi; a Prime root's
    // queue lives in the daemon. RPC children have no remote queue editing.
    const cancelQueued = async (req, res) => {
        const { kind, index, text } = (0, http_boundary_1.requestBody)(req);
        const validationError = (kind !== 'steering' && kind !== 'followUp')
            || typeof text !== 'string' || !text
            ? 'kind (steering|followUp) and non-empty text required'
            : !Number.isInteger(index) || index < 0
                ? 'index must be a non-negative integer'
                : null;
        try {
            const sess = await ports.getLiveSession(req.params.id);
            if (!sess) {
                if (validationError)
                    return res.status(400).json({ error: validationError });
                return res.status(404).json({ error: 'Session not active' });
            }
            if (!(sess instanceof bridge_session_1.BridgeSession) && !(sess instanceof prime_daemon_1.PrimeDaemonSession)) {
                return res.status(501).json({ error: 'queue editing requires a live pi-dish bridge or Prime daemon session' });
            }
            if (!(0, session_ownership_1.liveSessionSupports)(sess, 'queueCancel')) {
                return res.status(409).json({ error: 'This session does not support queue cancellation.' });
            }
            if (validationError)
                return res.status(400).json({ error: validationError });
            const result = await sess.cancelQueued(kind, index, text);
            res.json({ success: true, result });
        }
        catch (error) {
            res.status(409).json({ error: (0, http_boundary_2.errorMessage)(error) });
        }
    };
    return {
        thinking, fast, abort, sideChat, sideChatAsk, sideChatCancel, sideChatClose,
        uiResponse, rename, model, cancelQueued,
    };
}
