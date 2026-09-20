// Generated from src/core/session-read-handlers.ts; edit that source and run npm run build:core.
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
exports.createSessionReadHandlers = createSessionReadHandlers;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bridge_session_1 = require("./bridge-session");
const harnesses_1 = require("./harnesses");
const helper_content_1 = require("./helper-content");
const helper_values_1 = require("./helper-values");
const harness_pricing_1 = require("./harness-pricing");
const piSDK = __importStar(require("./pi-sdk"));
const session_catalog_1 = require("./session-catalog");
const session_files_1 = require("./session-files");
const session_index_1 = require("./session-index");
const session_ownership_1 = require("./session-ownership");
const VALID_ENTRY_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198}[A-Za-z0-9])?$/;
const BLOB_REF_RE = /^blob:sha256:([0-9a-f]{64})$/;
function record(value) { return (0, helper_values_1.record)(value) ? value : {}; }
/** Copy only the projected image blocks; never mutate the borrowed parser cache. */
function messageForClient(sessionId, message, index) {
    if (!Array.isArray(message.content))
        return { ...message, index };
    let changed = false;
    const resourceId = typeof message.id === 'string' && VALID_ENTRY_ID_RE.test(message.id)
        ? message.id : String(index);
    const content = message.content.map((value, blockIndex) => {
        const block = record(value);
        if (block.type !== 'image' || typeof block.data !== 'string' || !block.data)
            return value;
        changed = true;
        const { data: _data, ...metadata } = block;
        return {
            ...metadata,
            mimeType: block.mimeType || 'image/png',
            url: `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(resourceId)}/images/${blockIndex}`,
        };
    });
    return { ...message, ...(changed ? { content } : {}), index };
}
function imageBlockBytes(session, data) {
    const ref = BLOB_REF_RE.exec(data);
    if (!ref)
        return Buffer.from(data, 'base64');
    const blobsPath = (0, harnesses_1.getHarness)(session.harnessId)?.blobsPath?.();
    if (!blobsPath)
        return null;
    try {
        return fs.readFileSync(path.join(blobsPath, ref[1]));
    }
    catch {
        return null;
    }
}
function createSessionReadHandlers(ports) {
    const { findSessionSource, liveSessionHistoryPending, getRegisteredSession, getRPCSession, getLiveSession, liveTreeLeafId, getLiveContextUsage, getContextWindow, describeRuntime, } = ports;
    async function getOmpShareSnapshot(session) {
        if (session.profileId !== 'omp-v1')
            return undefined;
        const registered = getRegisteredSession(session.routeId);
        if (record(registered?.capabilities).shareSnapshot !== true)
            return undefined;
        try {
            const live = await getLiveSession(session.routeId);
            if (!(live instanceof bridge_session_1.BridgeSession) || !(0, session_ownership_1.liveSessionSupports)(live, 'shareSnapshot'))
                return undefined;
            return await live.getShareSnapshot();
        }
        catch {
            // A native export remains useful when the live-only snapshot is unavailable.
            return undefined;
        }
    }
    async function exportSessionHtml(session, outputPath, { shareSnapshot, snapshotResolved = false } = {}) {
        if (!snapshotResolved)
            shareSnapshot = await getOmpShareSnapshot(session);
        return piSDK.exportSessionHtml(session.file, outputPath, session.profileId, { shareSnapshot });
    }
    const image = (req, res) => {
        const messageId = req.params.messageId;
        const blockIndex = Number(req.params.blockIndex);
        if (!VALID_ENTRY_ID_RE.test(messageId) || !Number.isInteger(blockIndex) || blockIndex < 0) {
            res.status(400).json({ error: 'valid message id and image index required' });
            return;
        }
        const session = findSessionSource(req.params.id);
        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        let message = (0, session_files_1.readSessionMessageById)(session, messageId);
        if (!message && /^\d+$/.test(messageId)) {
            const legacyIndex = Number(messageId);
            if (Number.isSafeInteger(legacyIndex))
                message = (0, session_files_1.readSessionMessages)(session)[legacyIndex];
        }
        const content = message?.content;
        const block = record(content == null ? undefined : Reflect.get(Object(content), String(blockIndex)));
        if (block.type !== 'image' || typeof block.data !== 'string' || !block.data) {
            res.status(404).json({ error: 'Image not found' });
            return;
        }
        const bytes = imageBlockBytes(session, block.data);
        if (!bytes) {
            res.status(404).json({ error: 'Image not found' });
            return;
        }
        const mimeType = typeof block.mimeType === 'string' && /^image\/[A-Za-z0-9.+-]+$/.test(block.mimeType)
            ? block.mimeType : 'image/png';
        res.setHeader('Cache-Control', 'private, no-cache');
        res.type(mimeType).send(bytes);
    };
    const messages = async (req, res) => {
        const sessionId = req.params.id;
        const isActive = !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId);
        const source = findSessionSource(sessionId);
        if (!source) {
            res.json({ messages: [], session: { id: sessionId, isActive }, totalMessages: 0,
                firstIndex: null, lastIndex: null, hasMore: false });
            return;
        }
        // Pricing is optional response metadata, never a transcript dependency.
        if (source.harnessId === 'pi' || source.harnessId === 'omp')
            void (0, harness_pricing_1.refreshHarnessPricing)(source.harnessId);
        const cursor = (value) => {
            const n = parseInt(String(value), 10);
            return Number.isFinite(n) ? n : null;
        };
        const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit), 10) || 50));
        const before = req.query.before != null ? cursor(req.query.before) : null;
        const after = req.query.after != null ? cursor(req.query.after) : null;
        const routeId = source.routeId;
        const identity = (0, session_ownership_1.sessionIdentityFields)(source.harnessId, source.nativeSessionId);
        const info = { ...(0, session_catalog_1.withSessionContext)((0, session_index_1.getSessionInfo)(source), getContextWindow) };
        const label = (0, session_catalog_1.subsessionLabel)(source);
        if (label)
            info.name = label;
        const liveUsage = record(getLiveContextUsage(sessionId));
        if (liveUsage.tokens != null)
            info.contextTokens = liveUsage.tokens;
        if (liveUsage.percent != null)
            info.contextPercent = Math.round(Number(liveUsage.percent) * 10) / 10;
        if (liveUsage.contextWindow)
            info.contextWindow = liveUsage.contextWindow;
        let all;
        if (source.harnessId === 'omp' && isActive) {
            try {
                const sess = await getLiveSession(sessionId);
                if (sess instanceof bridge_session_1.BridgeSession && (0, session_ownership_1.liveSessionSupports)(sess, 'treeRead')) {
                    all = (0, session_files_1.readSessionMessagesAtLeaf)(source, await liveTreeLeafId(sess));
                }
            }
            catch {
                // History stays readable when the captured bridge disappears.
            }
        }
        if (!all)
            all = (0, session_files_1.readSessionMessages)(source);
        const totalMessages = all.length;
        let startIdx, endIdx;
        if (after != null) {
            startIdx = after + 1;
            endIdx = totalMessages - 1;
        }
        else if (before != null) {
            endIdx = before - 1;
            startIdx = Math.max(0, endIdx - limit + 1);
        }
        else {
            endIdx = totalMessages - 1;
            startIdx = Math.max(0, endIdx - limit + 1);
        }
        if (startIdx > endIdx || totalMessages === 0) {
            res.json({ messages: [], session: { ...identity, isActive, ...info }, totalMessages,
                firstIndex: null, lastIndex: null, hasMore: startIdx > 0 && totalMessages > 0 });
            return;
        }
        const slice = all.slice(startIdx, endIdx + 1).map((m, i) => messageForClient(routeId, m, startIdx + i));
        res.json({ messages: slice, session: { ...identity, isActive, ...info }, totalMessages,
            firstIndex: startIdx, lastIndex: endIdx, hasMore: startIdx > 0 });
    };
    const search = (req, res) => {
        const rawQuery = req.query.q || '';
        // Express permits structured query values; retain the old non-string error path.
        if (typeof rawQuery !== 'string')
            throw new TypeError('query.trim is not a function');
        const query = rawQuery.trim().toLowerCase();
        if (!query) {
            res.json({ matches: [], totalMessages: 0 });
            return;
        }
        const mode = String(req.query.mode || 'message');
        if (mode !== 'message' && mode !== 'any') {
            res.status(400).json({ error: 'mode must be message or any' });
            return;
        }
        const source = findSessionSource(req.params.id);
        if (!source) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        const tokens = query.split(/\s+/).filter(Boolean);
        const all = (0, session_files_1.readSessionMessages)(source);
        const matches = [];
        for (let i = 0; i < all.length; i++) {
            const text = (0, helper_content_1.extractTextContent)(all[i].content).toLowerCase();
            const matched = mode === 'any' ? tokens.some(t => text.includes(t)) : tokens.every(t => text.includes(t));
            if (text && matched)
                matches.push({ index: i, role: all[i].role });
        }
        res.json({ matches, totalMessages: all.length });
    };
    const stats = async (req, res) => {
        const sessionId = req.params.id;
        try {
            const source = findSessionSource(sessionId);
            if (!source) {
                if (liveSessionHistoryPending(sessionId)) {
                    res.status(409).json({ error: 'Session has no persisted history yet' });
                    return;
                }
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            if (source.harnessId === 'pi' || source.harnessId === 'omp')
                await (0, harness_pricing_1.refreshHarnessPricing)(source.harnessId);
            const { tokens, reasoningTokens, hardCacheMisses, cost, costs, costUnavailable, responseTiming, userMessages, assistantMessages, toolCalls, toolResults, compactions, genMs, genOutput, } = (0, session_files_1.getSessionStats)(source);
            const reg = getRegisteredSession(sessionId);
            const contextUsage = getLiveContextUsage(sessionId);
            const info = (0, session_catalog_1.withSessionContext)((0, session_index_1.getSessionInfo)(source), getContextWindow);
            res.json({
                sessionFile: source.file,
                sessionId: source.routeId,
                ...(0, session_ownership_1.sessionIdentityFields)(source.harnessId, source.nativeSessionId),
                runtime: await describeRuntime(sessionId),
                cwd: reg?.cwd || info.cwd || null,
                model: reg?.model || info.model || null,
                thinkingLevel: reg?.thinkingLevel || null,
                userMessages, assistantMessages, toolCalls, toolResults, compactions,
                totalMessages: userMessages + assistantMessages + toolResults,
                tokens: { ...tokens, total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite },
                cost, costs, costUnavailable, reasoningTokens, hardCacheMisses, responseTiming, genMs, genOutput,
                contextUsage: contextUsage || {
                    tokens: info.contextTokens || null,
                    contextWindow: info.contextWindow,
                    percent: info.contextPercent ?? null,
                },
            });
        }
        catch (error) {
            res.status(500).json({ error: record(error).message });
        }
    };
    const tree = async (req, res) => {
        try {
            const identity = (0, session_ownership_1.routeIdentity)(req.params.id);
            if (!identity) {
                res.status(400).json({ error: 'Invalid session ID' });
                return;
            }
            if (identity.harnessId === 'omp') {
                // Resolve before connecting: a definitive socket failure can prune registry state.
                const source = findSessionSource(req.params.id);
                let sess;
                try {
                    sess = await getLiveSession(req.params.id);
                }
                catch {
                    if (!source) {
                        res.status(404).json({ error: 'Session not found' });
                        return;
                    }
                    res.status(409).json({ error: 'This Oh My Pi session has no reachable live bridge for tree reads.' });
                    return;
                }
                if (!sess) {
                    if (!source) {
                        res.status(404).json({ error: 'Session not found' });
                        return;
                    }
                    res.status(409).json({ error: 'Reading the tree of an inactive Oh My Pi session is not supported.' });
                    return;
                }
                if (!(0, session_ownership_1.liveSessionSupports)(sess, 'treeRead')) {
                    res.status(409).json({ error: 'This Oh My Pi session does not advertise live tree reads.' });
                    return;
                }
                if (!(sess instanceof bridge_session_1.BridgeSession)) {
                    res.status(409).json({ error: 'This Oh My Pi session has no live bridge connection for tree reads.' });
                    return;
                }
                try {
                    res.json(await sess.readTree());
                    return;
                }
                catch (error) {
                    const message = record(error).message;
                    if (/unknown command/i.test(String(message || ''))) {
                        res.status(409).json({ error: 'The Oh My Pi session is running an older pi-dish bridge; reload or restart it to enable tree reads.' });
                        return;
                    }
                    if (/unavailable|does not expose/i.test(String(message || ''))) {
                        res.status(409).json({ error: message });
                        return;
                    }
                    throw error;
                }
            }
            if (identity.harnessId !== 'pi') {
                res.status(409).json({ error: 'Session tree reads are not supported for this harness.' });
                return;
            }
            const source = findSessionSource(req.params.id);
            if (!source) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            res.json(await piSDK.getSessionTree(source.file));
        }
        catch (error) {
            res.status(500).json({ error: record(error).message });
        }
    };
    const exportHandler = async (req, res) => {
        try {
            const source = findSessionSource(req.params.id);
            if (!source) {
                if (liveSessionHistoryPending(req.params.id)) {
                    res.status(409).json({ error: 'Session has no persisted history yet' });
                    return;
                }
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            if (source.harnessId !== 'pi' && source.harnessId !== 'omp') {
                res.status(409).json({ error: 'HTML export is only supported for Pi and OMP sessions.' });
                return;
            }
            const outPath = path.join(os.tmpdir(), `pi-dish-export-${req.params.id.slice(-12)}.html`);
            const htmlPath = await exportSessionHtml(source, outPath);
            res.download(htmlPath, path.basename(source.file, '.jsonl') + '.html');
        }
        catch (error) {
            res.status(500).json({ error: record(error).message });
        }
    };
    return { image, messages, search, stats, tree, export: exportHandler, exportSessionHtml, getOmpShareSnapshot };
}
