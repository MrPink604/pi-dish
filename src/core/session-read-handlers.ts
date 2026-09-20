import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import type { RequestHandler } from 'express';
import { BridgeSession } from './bridge-session';
import type { BridgeRegistryEntry } from './contracts';
import { getHarness } from './harnesses';
import { extractTextContent } from './helper-content';
import { record as isRecord } from './helper-values';
import { refreshHarnessPricing } from './harness-pricing';
import * as piSDK from './pi-sdk';
import { subsessionLabel, withSessionContext } from './session-catalog';
import {
  getSessionStats, readSessionMessageById, readSessionMessages, readSessionMessagesAtLeaf,
} from './session-files';
import type { SessionMessage } from './session-files';
import { getSessionInfo } from './session-index';
import { liveSessionSupports, routeIdentity, sessionIdentityFields } from './session-ownership';
import type { LiveSession, RuntimeDescription } from './session-ownership';
import type { SessionSource } from './session-source-contracts';

/** Ports retain captured read identity, never lifecycle permission. */
export interface SessionReadPorts {
  findSessionSource(id: string, options?: { exact?: boolean }): SessionSource | null;
  liveSessionHistoryPending(id: string): boolean;
  getRegisteredSession(id: string): BridgeRegistryEntry | null;
  getRPCSession(id: string): unknown;
  getLiveSession(id: string): Promise<LiveSession | null>;
  liveTreeLeafId(session: InstanceType<typeof BridgeSession>): Promise<unknown>;
  getLiveContextUsage(id: string): unknown;
  getContextWindow(model: string | null | undefined): number;
  describeRuntime(id: string): Promise<RuntimeDescription | null>;
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

function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }

/** Copy only the projected image blocks; never mutate the borrowed parser cache. */
function messageForClient(sessionId: string, message: SessionMessage, index: number) {
  if (!Array.isArray(message.content)) return { ...message, index };
  let changed = false;
  const resourceId = typeof message.id === 'string' && VALID_ENTRY_ID_RE.test(message.id)
    ? message.id : String(index);
  const content = message.content.map((value: unknown, blockIndex: number) => {
    const block = record(value);
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

export function createSessionReadHandlers(ports: SessionReadPorts): SessionReadHandlers {
  const {
    findSessionSource, liveSessionHistoryPending, getRegisteredSession, getRPCSession,
    getLiveSession, liveTreeLeafId, getLiveContextUsage, getContextWindow, describeRuntime,
  } = ports;

  async function getOmpShareSnapshot(session: SessionSource): Promise<unknown> {
    if (session.profileId !== 'omp-v1') return undefined;
    const registered = getRegisteredSession(session.routeId);
    if (record(registered?.capabilities).shareSnapshot !== true) return undefined;
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
    const block = record(content == null ? undefined : Reflect.get(Object(content), String(blockIndex)));
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
    const isActive = !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId);
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
    const info: Record<string, unknown> = { ...withSessionContext(getSessionInfo(source), getContextWindow) };
    const label = subsessionLabel(source);
    if (label) info.name = label;
    const liveUsage = record(getLiveContextUsage(sessionId));
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
    // Express permits structured query values; retain the old non-string error path.
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
    const all = readSessionMessages(source);
    const matches = [];
    for (let i = 0; i < all.length; i++) {
      const text = extractTextContent(all[i].content).toLowerCase();
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
      const info = withSessionContext(getSessionInfo(source), getContextWindow);
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
    } catch (error) { res.status(500).json({ error: record(error).message }); }
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
          const message = record(error).message;
          if (/unknown command/i.test(String(message || ''))) {
            res.status(409).json({ error: 'The Oh My Pi session is running an older pi-dish bridge; reload or restart it to enable tree reads.' }); return;
          }
          if (/unavailable|does not expose/i.test(String(message || ''))) {
            res.status(409).json({ error: message }); return;
          }
          throw error;
        }
      }
      if (identity.harnessId !== 'pi') {
        res.status(409).json({ error: 'Session tree reads are not supported for this harness.' }); return;
      }
      const source = findSessionSource(req.params.id);
      if (!source) { res.status(404).json({ error: 'Session not found' }); return; }
      res.json(await piSDK.getSessionTree(source.file));
    } catch (error) { res.status(500).json({ error: record(error).message }); }
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
    } catch (error) { res.status(500).json({ error: record(error).message }); }
  };

  return { image, messages, search, stats, tree, export: exportHandler, exportSessionHtml, getOmpShareSnapshot };
}
