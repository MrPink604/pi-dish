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
import { collectActivePath, walkBranchTree } from './helper-tree';
import { refreshHarnessPricing } from './harness-pricing';
import * as piSDK from './pi-sdk';
import { subsessionLabel } from './session-catalog';
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

/** Copy only the projected image blocks; never mutate the borrowed parser cache. */
function messageForClient(sessionId: string, message: SessionMessage, index: number) {
  if (!Array.isArray(message.content)) return { ...message, index };
  let changed = false;
  const resourceId = typeof message.id === 'string' && VALID_ENTRY_ID_RE.test(message.id)
    ? message.id : String(index);
  const content = message.content.map((value: unknown, blockIndex: number) => {
    const block = asRecord(value);
    if (block.type !== 'image' || typeof block.data !== 'string' || !block.data) return value;
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

  /** Any transport: bridge registry, pi-dish RPC child, or Prime daemon root. */
  function isLive(sessionId: string): boolean {
    return !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId)?.alive || !!primeLiveSession(sessionId);
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

  const image: ReadHandler = (req, res) => {
    const messageId = req.params.messageId;
    const blockIndex = Number(req.params.blockIndex);
    if (!VALID_ENTRY_ID_RE.test(messageId) || !Number.isInteger(blockIndex) || blockIndex < 0) {
      res.status(400).json({ error: 'valid message id and image index required' });
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
    if (block.type !== 'image' || typeof block.data !== 'string' || !block.data) {
      res.status(404).json({ error: 'Image not found' }); return;
    }
    const bytes = imageBlockBytes(session, block.data);
    if (!bytes) { res.status(404).json({ error: 'Image not found' }); return; }
    const mimeType = typeof block.mimeType === 'string' && /^image\/[A-Za-z0-9.+-]+$/.test(block.mimeType)
      ? block.mimeType : 'image/png';
    res.setHeader('Cache-Control', 'private, no-cache');
    res.type(mimeType).send(bytes);
  };

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
    const slice = all.slice(startIdx, endIdx + 1).map((m, i) => messageForClient(routeId, m, startIdx + i));
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
        tokens, reasoningTokens, hardCacheMisses, cost, costs, costUnavailable, responseTiming,
        userMessages, assistantMessages, toolCalls, toolResults, compactions, genMs, genOutput,
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
        cost, costs, costUnavailable, reasoningTokens, hardCacheMisses, responseTiming, genMs, genOutput,
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
      if (source.harnessId !== 'pi' && source.harnessId !== 'omp') {
        res.status(409).json({ error: 'HTML export is only supported for Pi and OMP sessions.' }); return;
      }
      const outPath = path.join(os.tmpdir(), `pi-dish-export-${req.params.id.slice(-12)}.html`);
      const htmlPath = await exportSessionHtml(source, outPath);
      res.download(htmlPath, path.basename(source.file, '.jsonl') + '.html');
    } catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  };

  return { image, messages, search, stats, tree, export: exportHandler, exportSessionHtml, getOmpShareSnapshot };
}
