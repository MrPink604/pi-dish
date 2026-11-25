import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import type { RequestHandler } from 'express';
import { BridgeSession } from './bridge-session';
import { PrimeDaemonSession } from './prime-daemon';
import { getHarness } from './harnesses';
import { asRecord } from './wire-protocol';
import { record as isRecord } from './helper-values';
import { primeLiveSession } from './live-sessions';
import type { CatalogRuntime } from './session-catalog-runtime';
import { errorMessage } from './http-boundary';
import { extractTextContent, getToolSummary } from './helper-content.js';
import { isVideoMimeType } from './helper-media';
import { sendRangedBuffer } from './range-response';
import { collectActivePath, walkBranchTree } from './helper-tree';
import { refreshHarnessPricing } from './harness-pricing';
import * as piSDK from './pi-sdk';
import { subsessionLabel } from './session-catalog';
import { createNestedSubsessionResolver } from './session-discovery';
import { extractTaskSubagents, type TaskSubagentProjection } from './tool-event-stream';
import {
  getSessionStats, readSessionMessageById, readSessionMessages, readSessionMessagesAtLeaf, readSessionSearchText,
} from './session-files';
import type { SessionMessage } from './session-files';
import { liveSessionSupports, routeIdentity, sessionIdentityFields } from './session-ownership';
import type { LiveSession, SessionOwnership } from './session-ownership';
import type { SessionSource } from './session-source';

export interface SessionReadPorts {
  ownership: SessionOwnership;
  catalog: CatalogRuntime;
  findSessionSource(id: string, options?: { exact?: boolean }): SessionSource | null;
}

export interface SessionExportOptions {
  /** External native snapshot; the OMP exporter narrows consumed members. */
  shareSnapshot?: unknown;
  snapshotResolved?: boolean;
}

type ReadHandler = RequestHandler<Record<string, string>, unknown, unknown,
  Record<string, unknown>, Record<string, unknown>>;

export interface SessionReadHandlers {
  image: ReadHandler;
  media: ReadHandler;
  messages: ReadHandler;
  search: ReadHandler;
  stats: ReadHandler;
  tree: ReadHandler;
  export: ReadHandler;
  exportSessionHtml(source: SessionSource, outputPath: string, options?: SessionExportOptions): Promise<string>;
  getOmpShareSnapshot(source: SessionSource): Promise<unknown>;
}

const VALID_ENTRY_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198}[A-Za-z0-9])?$/;
const BLOB_REF_RE = /^blob:sha256:([0-9a-f]{64})$/;

interface TaskMessageProjection {
  forCall(msgIdx: number, blockIdx: number): readonly TaskSubagentProjection[] | undefined;
  forResult(msgIdx: number): readonly TaskSubagentProjection[] | undefined;
}

/** Normalize provider-suffixed toolCallIds (`call_X|fc_Y` -> `call_X`). */
function normalizeTaskToolCallId(id: string): string {
  const pipe = id.indexOf('|');
  return pipe > 0 ? id.slice(0, pipe) : id;
}

interface PendingTaskCall {
  readonly callKey: string;
  readonly rawId: string;
  readonly normId: string;
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
export function pairTaskCallsInMemory(messages: readonly SessionMessage[]): Map<string, number> {
  const pairs = new Map<string, number>();
  const pending: PendingTaskCall[] = [];
  const recentPairedByRaw = new Map<string, string>();
  const recentPairedByNorm = new Map<string, string>();
  const poisonedNorms = new Set<string>();

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (let blockIdx = 0; blockIdx < msg.content.length; blockIdx++) {
        const block = asRecord(msg.content[blockIdx]);
        if (block.type !== 'toolCall' || block.name !== 'task' || typeof block.id !== 'string' || !block.id) continue;
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
      const matched = exactMatches[0]!;
      pending.splice(pending.indexOf(matched), 1);
      pairs.set(matched.callKey, msgIdx);
      recentPairedByRaw.set(matched.rawId, matched.callKey);
      recentPairedByNorm.set(resNorm, matched.callKey);
      continue;
    }
    if (exactMatches.length === 0 && normMatches.length === 1 && !poisonedNorms.has(resNorm)) {
      const matched = normMatches[0]!;
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
        if (pending[i]!.normId === resNorm) pending.splice(i, 1);
      }
      poisonedNorms.add(resNorm);
      const prevNormKey = recentPairedByNorm.get(resNorm);
      if (prevNormKey) { pairs.delete(prevNormKey); recentPairedByNorm.delete(resNorm); }
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
function messageForClient(sessionId: string, message: SessionMessage, index: number, taskProjection?: TaskMessageProjection) {
  let content: unknown = message.content;
  let contentChanged = false;
  if (Array.isArray(message.content)) {
    const resourceId = typeof message.id === 'string' && VALID_ENTRY_ID_RE.test(message.id)
      ? message.id : String(index);
    content = message.content.map((value: unknown, blockIndex: number) => {
      const block = asRecord(value);
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
          mimeType: isVideoMimeType(block.mimeType) ? block.mimeType : 'video/mp4',
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
  let details: unknown = message.details;
  let detailsChanged = false;
  if (message.role === 'toolResult' && message.toolName === 'task') {
    const verified = taskProjection?.forResult(index);
    const rawDetails = isRecord(message.details) ? message.details : null;
    const hasRawSubagents = !!(rawDetails && Object.prototype.hasOwnProperty.call(rawDetails, 'subagents'));
    if (verified?.length) {
      detailsChanged = true;
      details = { ...(rawDetails || {}), subagents: verified };
    } else if (hasRawSubagents) {
      // Strip any persisted/untrusted details.subagents when the server produced no verified entries.
      detailsChanged = true;
      const { subagents: _stripped, ...rest } = rawDetails!;
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

function imageBlockBytes(session: SessionSource, data: string): Buffer | null {
  const ref = BLOB_REF_RE.exec(data);
  if (!ref) return Buffer.from(data, 'base64');
  const blobsPath = getHarness(session.harnessId)?.blobsPath?.();
  if (!blobsPath) return null;
  try { return fs.readFileSync(path.join(blobsPath, ref[1])); } catch { return null; }
}

/**
 * Prime's `get_session_tree` answers `{ flatNodes: [{ entry }], leafId }`; the
 * browser expects pi's projected node shape, built from the daemon's in-memory
 * entries because the file can lag the leaf.
 */
function primeSessionTree(value: unknown): piSDK.SessionTree {
  const source = asRecord(value);
  const flatNodes = Array.isArray(source.flatNodes) ? source.flatNodes : [];
  interface PrimeTreeNode { entry: Record<string, unknown>; label: string | null; children: PrimeTreeNode[] }
  const byId = new Map<string, PrimeTreeNode>();
  const ordered: PrimeTreeNode[] = [];
  for (const flat of flatNodes) {
    const entry = asRecord(asRecord(flat).entry);
    if (typeof entry.id !== 'string' || !entry.id || byId.has(entry.id)) continue;
    const label = asRecord(flat).label;
    const node = { entry, label: typeof label === 'string' && label ? label : null, children: [] };
    byId.set(entry.id, node);
    ordered.push(node);
  }
  const roots: PrimeTreeNode[] = [];
  for (const node of ordered) {
    const parent = typeof node.entry.parentId === 'string' ? byId.get(node.entry.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const leafId = typeof source.leafId === 'string' && byId.has(source.leafId) ? source.leafId : null;
  const activePathIds = collectActivePath(leafId, id => {
    const parentId = byId.get(id)?.entry.parentId;
    return typeof parentId === 'string' ? parentId : null;
  });
  const preview = (content: unknown) => extractTextContent(content).replace(/[\n\t]/g, ' ').trim().slice(0, 120);
  const nodes: piSDK.SessionTreeNode[] = [];
  // Same flattening as pi's getSessionTree: depth grows only at branch points.
  walkBranchTree(roots, (node, depth) => {
    const entry = node.entry;
    const id = String(entry.id);
    const result: piSDK.SessionTreeNode = {
      id, parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
      type: entry.type as piSDK.SessionTreeNode['type'], timestamp: String(entry.timestamp ?? ''),
      depth, active: activePathIds.has(id), isLeaf: id === leafId, label: node.label, childCount: node.children.length,
    };
    if (entry.type === 'message') {
      const message = asRecord(entry.message);
      result.role = typeof message.role === 'string' ? message.role : undefined;
      if (message.role === 'user' || message.role === 'assistant') result.text = preview(message.content);
      if (message.role === 'assistant') {
        result.model = typeof message.model === 'string' ? message.model : undefined;
        result.stopReason = typeof message.stopReason === 'string' ? message.stopReason : undefined;
        result.errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage : undefined;
        result.toolCalls = Array.isArray(message.content) ? message.content.flatMap((block: unknown) => {
          const call = asRecord(block);
          return call.type === 'toolCall' && typeof call.id === 'string'
            ? [{ id: call.id, name: String(call.name ?? ''), args: getToolSummary(String(call.name ?? ''), call.arguments) }]
            : [];
        }) : [];
      } else if (message.role === 'toolResult') {
        result.toolName = typeof message.toolName === 'string' ? message.toolName : undefined;
        result.toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined;
        result.isError = message.isError === true;
      }
    } else if (entry.type === 'compaction') {
      result.tokensBefore = typeof entry.tokensBefore === 'number' ? entry.tokensBefore : undefined;
    } else if (entry.type === 'model_change') {
      result.modelId = typeof entry.modelId === 'string' ? entry.modelId : undefined;
      result.provider = typeof entry.provider === 'string' ? entry.provider : undefined;
    } else if (entry.type === 'branch_summary') {
      result.summary = typeof entry.summary === 'string' ? entry.summary.slice(0, 120) : undefined;
    }
    nodes.push(result);
    return node.children;
  });
  return { nodes, leafId, activePathIds: [...activePathIds] };
}

/** Leaf-only tree read, falling back to the full tree for older bridges. */
async function liveTreeLeafId(session: InstanceType<typeof BridgeSession>): Promise<unknown> {
  if (!session.treeLeafUnsupported) {
    try {
      const result = await session.readTreeLeaf();
      return (isRecord(result) ? result.leafId : undefined) ?? null;
    } catch (error) {
      if (!/unknown command/i.test(errorMessage(error))) throw error;
      // Remember per connection: a reconnect may be a newer extension.
      session.treeLeafUnsupported = true;
    }
  }
  const result = await session.readTree();
  return (isRecord(result) ? result.leafId : undefined) ?? null;
}

export function createSessionReadHandlers({ ownership, catalog, findSessionSource }: SessionReadPorts): SessionReadHandlers {
  const { liveSessionHistoryPending, getRegisteredSession, getRPCSession, getLiveSession, describeRuntime } = ownership;

  /** Any transport: bridge registry, pi-dish RPC child, Prime daemon root. */
  function isLive(sessionId: string): boolean {
    return !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId)?.alive
      || !!primeLiveSession(sessionId);
  }

  /** Live context usage, whichever backend reports it (roster beats transport stats). */
  function getLiveContextUsage(sessionId: string): unknown {
    const registered = getRegisteredSession(sessionId);
    if (registered?.contextUsage) return registered.contextUsage;
    const stats = getRPCSession(sessionId)?.lastStats;
    if (stats != null) return (isRecord(stats) && stats.contextUsage) || null;
    const primeStats = primeLiveSession(sessionId)?.lastStats;
    return isRecord(primeStats) ? primeStats.contextUsage || null : null;
  }

  async function getOmpShareSnapshot(session: SessionSource): Promise<unknown> {
    if (session.profileId !== 'omp-v1') return undefined;
    const registered = getRegisteredSession(session.routeId);
    if (asRecord(registered?.capabilities).shareSnapshot !== true) return undefined;
    try {
      const live = await getLiveSession(session.routeId);
      if (!(live instanceof BridgeSession) || !liveSessionSupports(live, 'shareSnapshot')) return undefined;
      return await live.getShareSnapshot();
    } catch {
      // A native export remains useful when the live-only snapshot is unavailable.
      return undefined;
    }
  }

  async function exportSessionHtml(session: SessionSource, outputPath: string,
    { shareSnapshot, snapshotResolved = false }: SessionExportOptions = {}): Promise<string> {
    if (!snapshotResolved) shareSnapshot = await getOmpShareSnapshot(session);
    return piSDK.exportSessionHtml(session.file, outputPath, session.profileId, { shareSnapshot });
  }

  function serveMessageMediaBlock(req: Parameters<ReadHandler>[0], res: Parameters<ReadHandler>[1], allowVideo: boolean) {
    const messageId = req.params.messageId;
    const blockIndex = Number(req.params.blockIndex);
    if (!VALID_ENTRY_ID_RE.test(messageId) || !Number.isInteger(blockIndex) || blockIndex < 0) {
      res.status(400).json({ error: allowVideo ? 'valid message id and media index required' : 'valid message id and image index required' });
      return;
    }
    const session = findSessionSource(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    let message = readSessionMessageById(session, messageId);
    if (!message && /^\d+$/.test(messageId)) {
      const legacyIndex = Number(messageId);
      if (Number.isSafeInteger(legacyIndex)) message = readSessionMessages(session)[legacyIndex];
    }
    const content = message?.content;
    const block = asRecord(content == null ? undefined : Reflect.get(Object(content), String(blockIndex)));
    const isImage = block.type === 'image';
    const isVideo = allowVideo && block.type === 'video';
    if ((!isImage && !isVideo) || typeof block.data !== 'string' || !block.data) {
      res.status(404).json({ error: allowVideo ? 'Media not found' : 'Image not found' }); return;
    }
    const bytes = imageBlockBytes(session, block.data);
    if (!bytes) { res.status(404).json({ error: allowVideo ? 'Media not found' : 'Image not found' }); return; }
    const mimeType = isVideo
      ? (isVideoMimeType(block.mimeType) ? block.mimeType.trim().toLowerCase() : 'video/mp4')
      : (typeof block.mimeType === 'string' && /^image\/[A-Za-z0-9.+-]+$/.test(block.mimeType)
          ? block.mimeType : 'image/png');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // An SVG opened as a page would run its scripts on pi-dish's origin; sandboxed it still shows in an <img>.
    if (/^image\/svg/i.test(mimeType)) res.setHeader('Content-Security-Policy', 'sandbox');
    if (isVideo) {
      sendRangedBuffer(req, res, bytes, { mimeType });
      return;
    }
    res.type(mimeType).send(bytes);
  }

  const image: ReadHandler = (req, res) => serveMessageMediaBlock(req, res, false);
  const media: ReadHandler = (req, res) => serveMessageMediaBlock(req, res, true);

  const messages: ReadHandler = async (req, res) => {
    const sessionId = req.params.id;
    const isActive = isLive(sessionId);
    const source = findSessionSource(sessionId);
    if (!source) {
      res.json({ messages: [], session: { id: sessionId, isActive }, totalMessages: 0,
        firstIndex: null, lastIndex: null, hasMore: false });
      return;
    }
    // Pricing is optional response metadata, never a transcript dependency.
    if (source.harnessId === 'pi' || source.harnessId === 'omp') void refreshHarnessPricing(source.harnessId);
    const cursor = (value: unknown): number | null => {
      const n = parseInt(String(value), 10);
      return Number.isFinite(n) ? n : null;
    };
    const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit), 10) || 50));
    const before = req.query.before != null ? cursor(req.query.before) : null;
    const after = req.query.after != null ? cursor(req.query.after) : null;
    const routeId = source.routeId;
    const identity = sessionIdentityFields(source.harnessId, source.nativeSessionId);
    const info: Record<string, unknown> = { ...catalog.parseSessionFile(source) };
    const label = subsessionLabel(source);
    if (label) info.name = label;
    const liveUsage = asRecord(getLiveContextUsage(sessionId));
    if (liveUsage.tokens != null) info.contextTokens = liveUsage.tokens;
    if (liveUsage.percent != null) info.contextPercent = Math.round(Number(liveUsage.percent) * 10) / 10;
    if (liveUsage.contextWindow) info.contextWindow = liveUsage.contextWindow;
    let all: readonly SessionMessage[] | undefined;
    if (source.harnessId === 'omp' && isActive) {
      try {
        const sess = await getLiveSession(sessionId);
        if (sess instanceof BridgeSession && liveSessionSupports(sess, 'treeRead')) {
          all = readSessionMessagesAtLeaf(source, await liveTreeLeafId(sess));
        }
      } catch {
        // History stays readable when the captured bridge disappears.
      }
    }
    if (!all) all = readSessionMessages(source);
    const totalMessages = all.length;
    let startIdx: number, endIdx: number;
    if (after != null) {
      startIdx = after + 1; endIdx = totalMessages - 1;
    } else if (before != null) {
      endIdx = before - 1; startIdx = Math.max(0, endIdx - limit + 1);
    } else {
      endIdx = totalMessages - 1; startIdx = Math.max(0, endIdx - limit + 1);
    }
    if (startIdx > endIdx || totalMessages === 0) {
      res.json({ messages: [], session: { ...identity, isActive, ...info }, totalMessages,
        firstIndex: null, lastIndex: null, hasMore: startIdx > 0 && totalMessages > 0 });
      return;
    }
    const pageMessages = all.slice(startIdx, endIdx + 1);
    const descriptor = getHarness(source.harnessId);
    let taskProjection: TaskMessageProjection | undefined;
    if (descriptor?.nestedSubsessions && source.file.endsWith('.jsonl')) {
      const hasTaskCallInPage = pageMessages.some(m =>
        m.role === 'assistant' && Array.isArray(m.content)
          && m.content.some(block => isRecord(block) && block.type === 'toolCall' && block.name === 'task'));
      const hasTaskResultInPage = pageMessages.some(m => m.role === 'toolResult' && m.toolName === 'task');
      if (hasTaskCallInPage || hasTaskResultInPage) {
        // Pure in-memory occurrence pairing (zero filesystem work for off-page invocations).
        const pairedResultByCall = hasTaskCallInPage ? pairTaskCallsInMemory(all) : null;
        // Lazily builds at most ONE authoritative discovery snapshot for the whole page request.
        const resolveAgent = createNestedSubsessionResolver({
          descriptor,
          snapshotTtlMs: 0,
          live: route => ownership.liveSourceObservations(route),
        }).forParentFrame(source.file);
        const resolvedByMsgIdx = new Map<number, readonly TaskSubagentProjection[]>();
        const resolveResultMsg = (msgIdx: number): readonly TaskSubagentProjection[] => {
          const cached = resolvedByMsgIdx.get(msgIdx);
          if (cached) return cached;
          const msg = all[msgIdx];
          const subagents = msg && msg.role === 'toolResult' && msg.toolName === 'task'
            ? extractTaskSubagents(msg.details, resolveAgent, { allowProjectedSubagents: false })
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

  const search: ReadHandler = (req, res) => {
    const rawQuery = req.query.q || '';
    // Express permits structured query values; those fail like a string method call would.
    if (typeof rawQuery !== 'string') throw new TypeError('query.trim is not a function');
    const query = rawQuery.trim().toLowerCase();
    if (!query) { res.json({ matches: [], totalMessages: 0 }); return; }
    const mode = String(req.query.mode || 'message');
    if (mode !== 'message' && mode !== 'any') {
      res.status(400).json({ error: 'mode must be message or any' }); return;
    }
    const source = findSessionSource(req.params.id);
    if (!source) { res.status(404).json({ error: 'Session not found' }); return; }
    const tokens = query.split(/\s+/).filter(Boolean);
    // Per-message text is memoized with the parsed messages, so a repeat search
    // over an unchanged session only scans strings.
    const { messages: all, texts } = readSessionSearchText(source);
    const matches = [];
    for (let i = 0; i < all.length; i++) {
      const text = texts[i] || '';
      const matched = mode === 'any' ? tokens.some(t => text.includes(t)) : tokens.every(t => text.includes(t));
      if (text && matched) matches.push({ index: i, role: all[i].role });
    }
    res.json({ matches, totalMessages: all.length });
  };

  const stats: ReadHandler = async (req, res) => {
    const sessionId = req.params.id;
    try {
      const source = findSessionSource(sessionId);
      if (!source) {
        if (liveSessionHistoryPending(sessionId)) {
          res.status(409).json({ error: 'Session has no persisted history yet' }); return;
        }
        res.status(404).json({ error: 'Session not found' }); return;
      }
      if (source.harnessId === 'pi' || source.harnessId === 'omp') await refreshHarnessPricing(source.harnessId);
      const {
        tokens, reasoningTokens, hardCacheMisses, cost, costs, costUnavailable, responseTiming, ttftTiming,
        userMessages, assistantMessages, toolCalls, toolResults, compactions,
        genMs, genOutput, streamMs, streamOutput, providers, apis, fastCalls,
      } = getSessionStats(source);
      const reg = getRegisteredSession(sessionId);
      const contextUsage = getLiveContextUsage(sessionId);
      const info = catalog.parseSessionFile(source);
      res.json({
        sessionFile: source.file,
        sessionId: source.routeId,
        ...sessionIdentityFields(source.harnessId, source.nativeSessionId),
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
    } catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  };

  const tree: ReadHandler = async (req, res) => {
    try {
      const identity = routeIdentity(req.params.id);
      if (!identity) { res.status(400).json({ error: 'Invalid session ID' }); return; }
      if (identity.harnessId === 'omp') {
        // Resolve before connecting: a definitive socket failure can prune registry state.
        const source = findSessionSource(req.params.id);
        let sess: LiveSession | null;
        try { sess = await getLiveSession(req.params.id); } catch {
          if (!source) { res.status(404).json({ error: 'Session not found' }); return; }
          res.status(409).json({ error: 'This Oh My Pi session has no reachable live bridge for tree reads.' }); return;
        }
        if (!sess) {
          if (!source) { res.status(404).json({ error: 'Session not found' }); return; }
          res.status(409).json({ error: 'Reading the tree of an inactive Oh My Pi session is not supported.' }); return;
        }
        if (!liveSessionSupports(sess, 'treeRead')) {
          res.status(409).json({ error: 'This Oh My Pi session does not advertise live tree reads.' }); return;
        }
        if (!(sess instanceof BridgeSession)) {
          res.status(409).json({ error: 'This Oh My Pi session has no live bridge connection for tree reads.' }); return;
        }
        try { res.json(await sess.readTree()); return; } catch (error) {
          const message = errorMessage(error);
          if (/unknown command/i.test(message)) {
            res.status(409).json({ error: 'The Oh My Pi session is running an older pi-dish bridge; reload or restart it to enable tree reads.' }); return;
          }
          if (/unavailable|does not expose/i.test(message)) {
            res.status(409).json({ error: message }); return;
          }
          throw error;
        }
      }
      if (identity.harnessId === 'prime') {
        // The daemon is the only authority on the live leaf; map its flat Pi
        // entries into the projected node shape the tree UI consumes.
        let sess: LiveSession | null = null;
        try { sess = await getLiveSession(req.params.id); } catch { sess = null; }
        if (!(sess instanceof PrimeDaemonSession)) {
          res.status(409).json({ error: 'Reading the tree of an inactive Prime Agent session is not supported.' }); return;
        }
        if (!liveSessionSupports(sess, 'treeRead')) {
          res.status(409).json({ error: 'This Prime Agent session does not support live tree reads.' }); return;
        }
        res.json(primeSessionTree(await sess.readTree()));
        return;
      }
      if (identity.harnessId === 'agy') {
        res.status(409).json({ error: 'Antigravity sessions have no pi-dish session tree; agy owns its transcript and ACP exposes no tree.' }); return;
      }
      if (identity.harnessId !== 'pi') {
        res.status(409).json({ error: 'Session tree reads are not supported for this harness.' }); return;
      }
      const source = findSessionSource(req.params.id);
      if (!source) { res.status(404).json({ error: 'Session not found' }); return; }
      res.json(await piSDK.getSessionTree(source.file));
    } catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  };

  const exportHandler: ReadHandler = async (req, res) => {
    try {
      const source = findSessionSource(req.params.id);
      if (!source) {
        if (liveSessionHistoryPending(req.params.id)) {
          res.status(409).json({ error: 'Session has no persisted history yet' }); return;
        }
        res.status(404).json({ error: 'Session not found' }); return;
      }
      if (source.harnessId !== 'pi' && source.harnessId !== 'omp' && source.harnessId !== 'agy') {
        res.status(409).json({ error: 'HTML export is only supported for Pi, OMP, and Antigravity sessions.' }); return;
      }
      const outPath = path.join(os.tmpdir(), `pi-dish-export-${req.params.id.slice(-12)}.html`);
      const htmlPath = await exportSessionHtml(source, outPath);
      const downloadName = source.profileId === 'agy-brain-v1'
        ? `${source.nativeSessionId}.html`
        : path.basename(source.file, '.jsonl') + '.html';
      res.download(htmlPath, downloadName);
    } catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  };

  return { image, media, messages, search, stats, tree, export: exportHandler, exportSessionHtml, getOmpShareSnapshot };
}
