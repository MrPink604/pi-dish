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
exports.pairTaskCallsInMemory = pairTaskCallsInMemory;
exports.createSessionReadHandlers = createSessionReadHandlers;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bridge_session_1 = require("./bridge-session");
const prime_daemon_1 = require("./prime-daemon");
const harnesses_1 = require("./harnesses");
const wire_protocol_1 = require("./wire-protocol");
const helper_values_1 = require("./helper-values");
const live_sessions_1 = require("./live-sessions");
const http_boundary_1 = require("./http-boundary");
const helper_content_js_1 = require("./helper-content.js");
const helper_media_1 = require("./helper-media");
const range_response_1 = require("./range-response");
const helper_tree_1 = require("./helper-tree");
const harness_pricing_1 = require("./harness-pricing");
const piSDK = __importStar(require("./pi-sdk"));
const session_catalog_1 = require("./session-catalog");
const session_discovery_1 = require("./session-discovery");
const tool_event_stream_1 = require("./tool-event-stream");
const session_files_1 = require("./session-files");
const session_ownership_1 = require("./session-ownership");
const VALID_ENTRY_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198}[A-Za-z0-9])?$/;
const BLOB_REF_RE = /^blob:sha256:([0-9a-f]{64})$/;
/** Normalize provider-suffixed toolCallIds (`call_X|fc_Y` -> `call_X`). */
function normalizeTaskToolCallId(id) {
    const pipe = id.indexOf('|');
    return pipe > 0 ? id.slice(0, pipe) : id;
}
/**
 * Pair task toolCall occurrences to their matching toolResult message index in
 * chronological order, purely in memory (zero filesystem reads).
 * - Matches exact IDs first and provider-normalized IDs (`call_X` <-> `call_X|fc_Y`).
 * - A reused ID in a later turn pairs only with its own occurrence and never relinks
 *   an earlier card.
 * - Fails closed on ambiguity (duplicate open calls sharing a raw/normalized ID, or
 *   multiple toolResults claiming the same call occurrence).
 */
function pairTaskCallsInMemory(messages) {
    const pairs = new Map();
    const pending = [];
    const recentPairedByRaw = new Map();
    const recentPairedByNorm = new Map();
    const poisonedNorms = new Set();
    for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
        const msg = messages[msgIdx];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            for (let blockIdx = 0; blockIdx < msg.content.length; blockIdx++) {
                const block = (0, wire_protocol_1.asRecord)(msg.content[blockIdx]);
                if (block.type !== 'toolCall' || block.name !== 'task' || typeof block.id !== 'string' || !block.id)
                    continue;
                const rawId = block.id;
                const normId = normalizeTaskToolCallId(rawId);
                // Only start a clean pairing scope for this normalized ID if no earlier
                // call sharing it is still awaiting a result.
                if (!pending.some(c => c.normId === normId)) {
                    recentPairedByNorm.delete(normId);
                    poisonedNorms.delete(normId);
                }
                recentPairedByRaw.delete(rawId);
                pending.push({ callKey: `${msgIdx}:${blockIdx}`, rawId, normId });
            }
            continue;
        }
        if (msg.role !== 'toolResult' || msg.toolName !== 'task' || typeof msg.toolCallId !== 'string' || !msg.toolCallId) {
            continue;
        }
        const resRaw = msg.toolCallId;
        const resNorm = normalizeTaskToolCallId(resRaw);
        const exactMatches = pending.filter(c => c.rawId === resRaw);
        const normMatches = pending.filter(c => c.normId === resNorm);
        if (exactMatches.length === 1 && (resRaw.includes('|') || normMatches.length === 1) && !poisonedNorms.has(resNorm)) {
            const matched = exactMatches[0];
            pending.splice(pending.indexOf(matched), 1);
            pairs.set(matched.callKey, msgIdx);
            recentPairedByRaw.set(matched.rawId, matched.callKey);
            recentPairedByNorm.set(resNorm, matched.callKey);
            continue;
        }
        if (exactMatches.length === 0 && normMatches.length === 1 && !poisonedNorms.has(resNorm)) {
            const matched = normMatches[0];
            if (resRaw.includes('|') || matched.rawId.includes('|')) {
                pending.splice(pending.indexOf(matched), 1);
                pairs.set(matched.callKey, msgIdx);
                recentPairedByRaw.set(matched.rawId, matched.callKey);
                recentPairedByNorm.set(resNorm, matched.callKey);
                continue;
            }
        }
        if (exactMatches.length > 1 || normMatches.length > 1) {
            for (let i = pending.length - 1; i >= 0; i--) {
                if (pending[i].normId === resNorm)
                    pending.splice(i, 1);
            }
            poisonedNorms.add(resNorm);
            const prevNormKey = recentPairedByNorm.get(resNorm);
            if (prevNormKey) {
                pairs.delete(prevNormKey);
                recentPairedByNorm.delete(resNorm);
            }
            continue;
        }
        // A second toolResult with no matching pending call invalidates the already-paired call for this ID.
        const prevRawKey = recentPairedByRaw.get(resRaw);
        if (prevRawKey) {
            pairs.delete(prevRawKey);
            recentPairedByRaw.delete(resRaw);
        }
        if (normMatches.length === 0) {
            const prevNormKey = recentPairedByNorm.get(resNorm);
            if (prevNormKey) {
                pairs.delete(prevNormKey);
                recentPairedByNorm.delete(resNorm);
                poisonedNorms.add(resNorm);
            }
        }
    }
    return pairs;
}
/** Copy only the projected image/video blocks and verified task subagent links; never mutate the borrowed parser cache. */
function messageForClient(sessionId, message, index, taskProjection) {
    let content = message.content;
    let contentChanged = false;
    if (Array.isArray(message.content)) {
        const resourceId = typeof message.id === 'string' && VALID_ENTRY_ID_RE.test(message.id)
            ? message.id : String(index);
        content = message.content.map((value, blockIndex) => {
            const block = (0, wire_protocol_1.asRecord)(value);
            if (block.type === 'image' && typeof block.data === 'string' && block.data) {
                contentChanged = true;
                const { data: _data, ...metadata } = block;
                return {
                    ...metadata,
                    mimeType: block.mimeType || 'image/png',
                    url: `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(resourceId)}/images/${blockIndex}`,
                };
            }
            if (block.type === 'video' && typeof block.data === 'string' && block.data) {
                contentChanged = true;
                const { data: _data, ...metadata } = block;
                return {
                    ...metadata,
                    mimeType: (0, helper_media_1.isVideoMimeType)(block.mimeType) ? block.mimeType : 'video/mp4',
                    url: `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(resourceId)}/media/${blockIndex}`,
                };
            }
            if (block.type === 'toolCall') {
                const verified = block.name === 'task' ? taskProjection?.forCall(index, blockIndex) : undefined;
                const hasRaw = Object.prototype.hasOwnProperty.call(block, 'taskSubagents');
                if (verified?.length) {
                    contentChanged = true;
                    return { ...block, taskSubagents: verified };
                }
                if (hasRaw) {
                    // Strip any persisted/untrusted taskSubagents from raw JSONL blocks.
                    contentChanged = true;
                    const { taskSubagents: _stripped, ...rest } = block;
                    return rest;
                }
            }
            return value;
        });
    }
    let details = message.details;
    let detailsChanged = false;
    if (message.role === 'toolResult' && message.toolName === 'task') {
        const verified = taskProjection?.forResult(index);
        const rawDetails = (0, helper_values_1.record)(message.details) ? message.details : null;
        const hasRawSubagents = !!(rawDetails && Object.prototype.hasOwnProperty.call(rawDetails, 'subagents'));
        if (verified?.length) {
            detailsChanged = true;
            details = { ...(rawDetails || {}), subagents: verified };
        }
        else if (hasRawSubagents) {
            // Strip any persisted/untrusted details.subagents when the server produced no verified entries.
            detailsChanged = true;
            const { subagents: _stripped, ...rest } = rawDetails;
            details = rest;
        }
    }
    return {
        ...message,
        ...(contentChanged ? { content } : {}),
        ...(detailsChanged ? { details } : {}),
        index,
    };
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
/**
 * Prime's `get_session_tree` answers `{ flatNodes: [{ entry }], leafId }`; the
 * browser expects pi's projected node shape, built from the daemon's in-memory
 * entries because the file can lag the leaf.
 */
function primeSessionTree(value) {
    const source = (0, wire_protocol_1.asRecord)(value);
    const flatNodes = Array.isArray(source.flatNodes) ? source.flatNodes : [];
    const byId = new Map();
    const ordered = [];
    for (const flat of flatNodes) {
        const entry = (0, wire_protocol_1.asRecord)((0, wire_protocol_1.asRecord)(flat).entry);
        if (typeof entry.id !== 'string' || !entry.id || byId.has(entry.id))
            continue;
        const label = (0, wire_protocol_1.asRecord)(flat).label;
        const node = { entry, label: typeof label === 'string' && label ? label : null, children: [] };
        byId.set(entry.id, node);
        ordered.push(node);
    }
    const roots = [];
    for (const node of ordered) {
        const parent = typeof node.entry.parentId === 'string' ? byId.get(node.entry.parentId) : undefined;
        (parent ? parent.children : roots).push(node);
    }
    const leafId = typeof source.leafId === 'string' && byId.has(source.leafId) ? source.leafId : null;
    const activePathIds = (0, helper_tree_1.collectActivePath)(leafId, id => {
        const parentId = byId.get(id)?.entry.parentId;
        return typeof parentId === 'string' ? parentId : null;
    });
    const preview = (content) => (0, helper_content_js_1.extractTextContent)(content).replace(/[\n\t]/g, ' ').trim().slice(0, 120);
    const nodes = [];
    // Same flattening as pi's getSessionTree: depth grows only at branch points.
    (0, helper_tree_1.walkBranchTree)(roots, (node, depth) => {
        const entry = node.entry;
        const id = String(entry.id);
        const result = {
            id, parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
            type: entry.type, timestamp: String(entry.timestamp ?? ''),
            depth, active: activePathIds.has(id), isLeaf: id === leafId, label: node.label, childCount: node.children.length,
        };
        if (entry.type === 'message') {
            const message = (0, wire_protocol_1.asRecord)(entry.message);
            result.role = typeof message.role === 'string' ? message.role : undefined;
            if (message.role === 'user' || message.role === 'assistant')
                result.text = preview(message.content);
            if (message.role === 'assistant') {
                result.model = typeof message.model === 'string' ? message.model : undefined;
                result.stopReason = typeof message.stopReason === 'string' ? message.stopReason : undefined;
                result.errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage : undefined;
                result.toolCalls = Array.isArray(message.content) ? message.content.flatMap((block) => {
                    const call = (0, wire_protocol_1.asRecord)(block);
                    return call.type === 'toolCall' && typeof call.id === 'string'
                        ? [{ id: call.id, name: String(call.name ?? ''), args: (0, helper_content_js_1.getToolSummary)(String(call.name ?? ''), call.arguments) }]
                        : [];
                }) : [];
            }
            else if (message.role === 'toolResult') {
                result.toolName = typeof message.toolName === 'string' ? message.toolName : undefined;
                result.toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined;
                result.isError = message.isError === true;
            }
        }
        else if (entry.type === 'compaction') {
            result.tokensBefore = typeof entry.tokensBefore === 'number' ? entry.tokensBefore : undefined;
        }
        else if (entry.type === 'model_change') {
            result.modelId = typeof entry.modelId === 'string' ? entry.modelId : undefined;
            result.provider = typeof entry.provider === 'string' ? entry.provider : undefined;
        }
        else if (entry.type === 'branch_summary') {
            result.summary = typeof entry.summary === 'string' ? entry.summary.slice(0, 120) : undefined;
        }
        nodes.push(result);
        return node.children;
    });
    return { nodes, leafId, activePathIds: [...activePathIds] };
}
/** Leaf-only tree read, falling back to the full tree for older bridges. */
async function liveTreeLeafId(session) {
    if (!session.treeLeafUnsupported) {
        try {
            const result = await session.readTreeLeaf();
            return ((0, helper_values_1.record)(result) ? result.leafId : undefined) ?? null;
        }
        catch (error) {
            if (!/unknown command/i.test((0, http_boundary_1.errorMessage)(error)))
                throw error;
            // Remember per connection: a reconnect may be a newer extension.
            session.treeLeafUnsupported = true;
        }
    }
    const result = await session.readTree();
    return ((0, helper_values_1.record)(result) ? result.leafId : undefined) ?? null;
}
function createSessionReadHandlers({ ownership, catalog, findSessionSource }) {
    const { liveSessionHistoryPending, getRegisteredSession, getRPCSession, getLiveSession, describeRuntime } = ownership;
    /** Any transport: bridge registry, pi-dish RPC child, Prime daemon root. */
    function isLive(sessionId) {
        return !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId)?.alive
            || !!(0, live_sessions_1.primeLiveSession)(sessionId);
    }
    /** Live context usage, whichever backend reports it (roster beats transport stats). */
    function getLiveContextUsage(sessionId) {
        const registered = getRegisteredSession(sessionId);
        if (registered?.contextUsage)
            return registered.contextUsage;
        const stats = getRPCSession(sessionId)?.lastStats;
        if (stats != null)
            return ((0, helper_values_1.record)(stats) && stats.contextUsage) || null;
        const primeStats = (0, live_sessions_1.primeLiveSession)(sessionId)?.lastStats;
        return (0, helper_values_1.record)(primeStats) ? primeStats.contextUsage || null : null;
    }
    async function getOmpShareSnapshot(session) {
        if (session.profileId !== 'omp-v1')
            return undefined;
        const registered = getRegisteredSession(session.routeId);
        if ((0, wire_protocol_1.asRecord)(registered?.capabilities).shareSnapshot !== true)
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
    function serveMessageMediaBlock(req, res, allowVideo) {
        const messageId = req.params.messageId;
        const blockIndex = Number(req.params.blockIndex);
        if (!VALID_ENTRY_ID_RE.test(messageId) || !Number.isInteger(blockIndex) || blockIndex < 0) {
            res.status(400).json({ error: allowVideo ? 'valid message id and media index required' : 'valid message id and image index required' });
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
        const block = (0, wire_protocol_1.asRecord)(content == null ? undefined : Reflect.get(Object(content), String(blockIndex)));
        const isImage = block.type === 'image';
        const isVideo = allowVideo && block.type === 'video';
        if ((!isImage && !isVideo) || typeof block.data !== 'string' || !block.data) {
            res.status(404).json({ error: allowVideo ? 'Media not found' : 'Image not found' });
            return;
        }
        const bytes = imageBlockBytes(session, block.data);
        if (!bytes) {
            res.status(404).json({ error: allowVideo ? 'Media not found' : 'Image not found' });
            return;
        }
        const mimeType = isVideo
            ? ((0, helper_media_1.isVideoMimeType)(block.mimeType) ? block.mimeType.trim().toLowerCase() : 'video/mp4')
            : (typeof block.mimeType === 'string' && /^image\/[A-Za-z0-9.+-]+$/.test(block.mimeType)
                ? block.mimeType : 'image/png');
        res.setHeader('Cache-Control', 'private, no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // An SVG opened as a page would run its scripts on pi-dish's origin; sandboxed it still shows in an <img>.
        if (/^image\/svg/i.test(mimeType))
            res.setHeader('Content-Security-Policy', 'sandbox');
        if (isVideo) {
            (0, range_response_1.sendRangedBuffer)(req, res, bytes, { mimeType });
            return;
        }
        res.type(mimeType).send(bytes);
    }
    const image = (req, res) => serveMessageMediaBlock(req, res, false);
    const media = (req, res) => serveMessageMediaBlock(req, res, true);
    const messages = async (req, res) => {
        const sessionId = req.params.id;
        const isActive = isLive(sessionId);
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
        const info = { ...catalog.parseSessionFile(source) };
        const label = (0, session_catalog_1.subsessionLabel)(source);
        if (label)
            info.name = label;
        const liveUsage = (0, wire_protocol_1.asRecord)(getLiveContextUsage(sessionId));
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
        const pageMessages = all.slice(startIdx, endIdx + 1);
        const descriptor = (0, harnesses_1.getHarness)(source.harnessId);
        let taskProjection;
        if (descriptor?.nestedSubsessions && source.file.endsWith('.jsonl')) {
            const hasTaskCallInPage = pageMessages.some(m => m.role === 'assistant' && Array.isArray(m.content)
                && m.content.some(block => (0, helper_values_1.record)(block) && block.type === 'toolCall' && block.name === 'task'));
            const hasTaskResultInPage = pageMessages.some(m => m.role === 'toolResult' && m.toolName === 'task');
            if (hasTaskCallInPage || hasTaskResultInPage) {
                // Pure in-memory occurrence pairing (zero filesystem work for off-page invocations).
                const pairedResultByCall = hasTaskCallInPage ? pairTaskCallsInMemory(all) : null;
                // Lazily builds at most ONE authoritative discovery snapshot for the whole page request.
                const resolveAgent = (0, session_discovery_1.createNestedSubsessionResolver)({
                    descriptor,
                    snapshotTtlMs: 0,
                    live: route => ownership.liveSourceObservations(route),
                }).forParentFrame(source.file);
                const resolvedByMsgIdx = new Map();
                const resolveResultMsg = (msgIdx) => {
                    const cached = resolvedByMsgIdx.get(msgIdx);
                    if (cached)
                        return cached;
                    const msg = all[msgIdx];
                    const subagents = msg && msg.role === 'toolResult' && msg.toolName === 'task'
                        ? (0, tool_event_stream_1.extractTaskSubagents)(msg.details, resolveAgent, { allowProjectedSubagents: false })
                        : [];
                    resolvedByMsgIdx.set(msgIdx, subagents);
                    return subagents;
                };
                taskProjection = {
                    forCall(msgIdx, blockIdx) {
                        const resIdx = pairedResultByCall?.get(`${msgIdx}:${blockIdx}`);
                        return resIdx !== undefined ? resolveResultMsg(resIdx) : undefined;
                    },
                    forResult(msgIdx) {
                        return resolveResultMsg(msgIdx);
                    },
                };
            }
        }
        const slice = pageMessages.map((m, i) => messageForClient(routeId, m, startIdx + i, taskProjection));
        res.json({ messages: slice, session: { ...identity, isActive, ...info }, totalMessages,
            firstIndex: startIdx, lastIndex: endIdx, hasMore: startIdx > 0 });
    };
    const search = (req, res) => {
        const rawQuery = req.query.q || '';
        // Express permits structured query values; those fail like a string method call would.
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
        // Per-message text is memoized with the parsed messages, so a repeat search
        // over an unchanged session only scans strings.
        const { messages: all, texts } = (0, session_files_1.readSessionSearchText)(source);
        const matches = [];
        for (let i = 0; i < all.length; i++) {
            const text = texts[i] || '';
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
            const { tokens, reasoningTokens, hardCacheMisses, cost, costs, costUnavailable, responseTiming, ttftTiming, userMessages, assistantMessages, toolCalls, toolResults, compactions, genMs, genOutput, streamMs, streamOutput, providers, apis, fastCalls, } = (0, session_files_1.getSessionStats)(source);
            const reg = getRegisteredSession(sessionId);
            const contextUsage = getLiveContextUsage(sessionId);
            const info = catalog.parseSessionFile(source);
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
                cost, costs, costUnavailable, reasoningTokens, hardCacheMisses,
                responseTiming, ttftTiming, genMs, genOutput, streamMs, streamOutput, providers, apis, fastCalls,
                contextUsage: contextUsage || {
                    tokens: info.contextTokens || null,
                    contextWindow: info.contextWindow,
                    percent: info.contextPercent ?? null,
                },
            });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
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
                    const message = (0, http_boundary_1.errorMessage)(error);
                    if (/unknown command/i.test(message)) {
                        res.status(409).json({ error: 'The Oh My Pi session is running an older pi-dish bridge; reload or restart it to enable tree reads.' });
                        return;
                    }
                    if (/unavailable|does not expose/i.test(message)) {
                        res.status(409).json({ error: message });
                        return;
                    }
                    throw error;
                }
            }
            if (identity.harnessId === 'prime') {
                // The daemon is the only authority on the live leaf; map its flat Pi
                // entries into the projected node shape the tree UI consumes.
                let sess = null;
                try {
                    sess = await getLiveSession(req.params.id);
                }
                catch {
                    sess = null;
                }
                if (!(sess instanceof prime_daemon_1.PrimeDaemonSession)) {
                    res.status(409).json({ error: 'Reading the tree of an inactive Prime Agent session is not supported.' });
                    return;
                }
                if (!(0, session_ownership_1.liveSessionSupports)(sess, 'treeRead')) {
                    res.status(409).json({ error: 'This Prime Agent session does not support live tree reads.' });
                    return;
                }
                res.json(primeSessionTree(await sess.readTree()));
                return;
            }
            if (identity.harnessId === 'agy') {
                res.status(409).json({ error: 'Antigravity sessions have no pi-dish session tree; agy owns its transcript and ACP exposes no tree.' });
                return;
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
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
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
            if (source.harnessId !== 'pi' && source.harnessId !== 'omp' && source.harnessId !== 'agy') {
                res.status(409).json({ error: 'HTML export is only supported for Pi, OMP, and Antigravity sessions.' });
                return;
            }
            const outPath = path.join(os.tmpdir(), `pi-dish-export-${req.params.id.slice(-12)}.html`);
            const htmlPath = await exportSessionHtml(source, outPath);
            const downloadName = source.profileId === 'agy-brain-v1'
                ? `${source.nativeSessionId}.html`
                : path.basename(source.file, '.jsonl') + '.html';
            res.download(htmlPath, downloadName);
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    };
    return { image, media, messages, search, stats, tree, export: exportHandler, exportSessionHtml, getOmpShareSnapshot };
}
