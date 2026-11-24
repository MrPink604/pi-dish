import crypto = require('crypto');
import fs = require('fs');
import os = require('os');
import path = require('path');
import type { Request, Response, RequestHandler } from 'express';
import type { ParsedQs } from 'qs';
import * as pages from './pages';
import * as pageForms from './page-forms';
import * as shares from './shares';
import * as comments from './comments';
import { canonicalSessionId } from './session-key';
import { registryIdentity, routeIdentity, routeSessionId } from './session-ownership';
import { asRecord } from './wire-protocol';
import { readFileForViewer } from './file-mention';
import { FILE_PAGE_VIDEO_SCRIPT_HASH, renderFilePage } from './file-page';
import { sendRangedFile } from './range-response';
import { readOmpExportData } from './omp-export';
import { isolateArtifact } from './artifact-isolation';
import type { SessionSource } from './session-source';
import type { SessionOwnership } from './session-ownership';
import type { CatalogRuntime } from './session-catalog-runtime';
import { listRegisteredSessions } from './bridge-session';
import type { BridgeRegistryEntry } from './contracts';
import type { SessionReadHandlers } from './session-read-handlers';
import type { PublicArtifactRelay } from './relay-handlers';
import { errorMessage, errorStatus } from './http-boundary';

type PublicationRequest = Request<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
type PublicationResponse = Response<unknown, Record<string, unknown>>;
type PublicationHandler = RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;

export interface PublicationPorts {
  ownership: SessionOwnership;
  catalog: CatalogRuntime;
  findSessionSource(id: string): SessionSource | null;
  reads: SessionReadHandlers;
  relay: PublicArtifactRelay;
  resourceRoot: string;
  /**
   * Text input for a live (or wakeable) session; rejects with an HTTP status
   * when it cannot be taken. Null once taken, else why that is unconfirmed.
   */
  deliverMessage(sessionId: string, text: string): Promise<string | null>;
  /** Whether the session is a private one (held outside every backed-up path). */
  sessionIsPrivate(sessionId: string): boolean;
  /** The private-session PIN gate: true when the request may not see that session. */
  privateRefused(req: PublicationRequest, sessionId: string): boolean;
}

export interface PublicationHandlers {
  importShare: PublicationHandler;
  createShare: PublicationHandler;
  revokeShare: PublicationHandler;
  getShare: PublicationHandler;
  serveSharedSession: PublicationHandler;
  createComment: PublicationHandler;
  commentIndex: PublicationHandler;
  commentCount: PublicationHandler;
  getComments: PublicationHandler;
  updateComment: PublicationHandler;
  deleteComment: PublicationHandler;
  acknowledgeComment: PublicationHandler;
  createPage: PublicationHandler;
  listPages: PublicationHandler;
  revokePage: PublicationHandler;
  page: PublicationHandler;
  pageAsset: PublicationHandler;
  listPageComments: PublicationHandler;
  createPageComment: PublicationHandler;
  updatePageComment: PublicationHandler;
  deletePageComment: PublicationHandler;
  publicPage: PublicationHandler;
  pageForm: PublicationHandler;
  pageFormReceipt: PublicationHandler;
  submitPageForm: PublicationHandler;
  formView: PublicationHandler;
  formStyles: PublicationHandler;
  publicPageAsset: PublicationHandler;
  fileStyles: PublicationHandler;
  highlightStyles: PublicationHandler;
}

interface ShareExportCacheEntry {
  mtimeMs: number;
  size: number;
  snapshotKey: string | null;
  htmlPath: string;
}

const PAGE_COMMENTS_HEADER = 'x-pi-dish-page-comments';
// Set on every hub->peer artifact request; with FORMS_FRONT_HEADER the hub
// also says it serves pi-dish's /forms view, so the owner's page may link there.
const ARTIFACT_HOP_HEADER = 'x-pi-dish-artifact-hop';
const FORMS_FRONT_HEADER = 'x-pi-dish-forms';

// Stored rows and HTTP bodies are external; members stay unknown until checked.
function commentBody(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= 10000 ? text : null;
}

export function createPublicationHandlers(ports: PublicationPorts): PublicationHandlers {
  const { findSessionSource } = ports;
  const { liveSessionHistoryPending, getRPCSession } = ports.ownership;
  const { enumerateSessionCandidates } = ports.catalog;
  const { exportSessionHtml, getOmpShareSnapshot } = ports.reads;
  // url is set only when PI_DISH_SHARE_BASE_URL is, so operators behind a
  // proxy can hand out an absolute link.
  function publicLink(pathname: string) {
    const base = process.env.PI_DISH_SHARE_BASE_URL;
    return base ? base.replace(/\/+$/, '') + pathname : null;
  }

  function sharePayload(token: string) {
    const sharePath = `/share/${token}`;
    return { token, path: sharePath, url: publicLink(sharePath) };
  }

  // Per-token export cache keyed on the JSONL's (mtimeMs, size) and live export
  // snapshot, so repeated hits on an unchanged session don't re-run the exporter.
  const shareExportCache = new Map<string, ShareExportCacheEntry>();

  async function serveSharedSession(req: PublicationRequest, res: PublicationResponse) {
    const share = shares.getShare(req.params.token);
    // A token this host doesn't own may still belong to a peer it fronts.
    if (!share) return ports.relay.serve(req, res, 'share');
    isolateArtifact(res, 'share');
    if (share.kind === 'html') {
      const htmlPath = shares.getShareHtmlPath(req.params.token);
      if (!htmlPath) return res.status(404).type('text/plain').send('Not found');
      res.type('html');
      return res.sendFile(htmlPath);
    }
    const session = typeof share.sessionId === 'string' ? findSessionSource(share.sessionId) : null;
    if (!session || (session.harnessId !== 'pi' && session.harnessId !== 'omp' && session.harnessId !== 'agy')) {
      return res.status(404).type('text/plain').send('Not found');
    }
    const sessionFile = session.file;
    try {
      const st = fs.statSync(sessionFile);
      const shareSnapshot = await getOmpShareSnapshot(session);
      const snapshotKey = shareSnapshot ? JSON.stringify(shareSnapshot) : null;
      const cached = shareExportCache.get(req.params.token);
      let htmlPath;
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size
        && cached.snapshotKey === snapshotKey && fs.existsSync(cached.htmlPath)) {
        htmlPath = cached.htmlPath;
      } else {
        // Token is base64url (A-Za-z0-9_-), so it's already a safe basename.
        const outPath = path.join(os.tmpdir(), `pi-dish-share-${req.params.token}.html`);
        htmlPath = await exportSessionHtml(session, outPath, { shareSnapshot, snapshotResolved: true });
        shareExportCache.set(req.params.token, { mtimeMs: st.mtimeMs, size: st.size, snapshotKey, htmlPath });
      }
      res.type('html');
      res.sendFile(htmlPath);
    } catch (e) {
      res.status(500).type('text/plain').send('Export failed');
    }
  }

  function validOmpShareHtml(html: unknown): html is string {
    if (typeof html !== 'string' || !html.includes('<html')) return false;
    try {
      return !!readOmpExportData(html, 'import').header;
    } catch {
      return false;
    }
  }

  // OMP's custom-share hook sends the complete native /share HTML; keep that
  // exact snapshot rather than reconstructing OMP-only metadata from JSONL.
  const importShare: PublicationHandler = (req, res) => {
    if (!validOmpShareHtml(req.body)) {
      return res.status(400).json({ error: 'Expected a standalone OMP HTML export' });
    }
    try {
      const token = shares.createHtmlShare(req.body);
      return res.json(sharePayload(token));
    } catch (e) {
      return res.status(500).json({ error: errorMessage(e) });
    }
  };

  const createShare: PublicationHandler = (req, res) => {
    const session = findSessionSource(req.params.id);
    if (!session) {
      if (liveSessionHistoryPending(req.params.id)) {
        return res.status(409).json({ error: 'Session has no persisted history yet' });
      }
      return res.status(404).json({ error: 'Session not found' });
    }
    if (session.harnessId !== 'pi' && session.harnessId !== 'omp' && session.harnessId !== 'agy') {
      return res.status(409).json({ error: 'Public HTML sharing is only supported for Pi, OMP, and Antigravity sessions.' });
    }
    const token = shares.createShare(req.params.id);
    res.json(sharePayload(token));
  };

  const revokeShare: PublicationHandler = (req, res) => {
    const existing = shares.getShareForSession(req.params.id);
    const revoked = shares.revokeShare(req.params.id);
    if (existing) shareExportCache.delete(existing.token);
    // The token is reported so a hub fronting this session can drop its fleet
    // mapping immediately instead of waiting to serve a 404.
    res.json({ revoked, token: existing?.token || null });
  };

  const getShare: PublicationHandler = (req, res) => {
    const existing = shares.getShareForSession(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No share' });
    res.json(sharePayload(existing.token));
  };

  // Comments: creating one never prompts, steers, or starts an agent turn; the
  // pi-dish-comments skill reads and acknowledges them when the user asks.

  function shortString(value: unknown, max: number): string | null {
    return typeof value === 'string' && value.length <= max ? value : null;
  }

  function inferSessionForPath(absPath: unknown): string | null {
    if (typeof absPath !== 'string' || !absPath) return null;
    const targetPath = absPath;
    // Nested cwds are normal, so the most specific containing cwd wins; only a
    // same-depth tie (e.g. the same cwd) is ambiguous.
    const candidates = listRegisteredSessions()
      .filter((entry): entry is BridgeRegistryEntry & { cwd: string } => {
        if (typeof entry.cwd !== 'string' || !entry.cwd) return false;
        const cwd = path.resolve(entry.cwd);
        return targetPath === cwd || targetPath.startsWith(cwd + path.sep);
      })
      .sort((a, b) => path.resolve(b.cwd).length - path.resolve(a.cwd).length);
    if (!candidates.length) return null;
    if (candidates[1] && path.resolve(candidates[1].cwd).length === path.resolve(candidates[0].cwd).length) return null;
    const identity = registryIdentity(candidates[0]);
    return identity ? routeSessionId(identity.harnessId, identity.nativeSessionId) : null;
  }

  function canonicalKnownSessionId(value: unknown): string | null {
    const identity = routeIdentity(value);
    if (!identity || typeof value !== 'string') return null;
    const registered = listRegisteredSessions().some((entry) => {
      const candidate = registryIdentity(entry);
      return candidate?.harnessId === identity.harnessId
        && candidate.nativeSessionId === identity.nativeSessionId;
    });
    const rpc = identity.harnessId === 'pi' && getRPCSession(value)?.id === identity.nativeSessionId;
    const active = registered || rpc;
    const historical = !active && enumerateSessionCandidates().some((candidate) =>
      candidate.harnessId === identity.harnessId
        && candidate.nativeSessionId === identity.nativeSessionId);
    return active || historical
      ? routeSessionId(identity.harnessId, identity.nativeSessionId)
      : null;
  }

  function cleanAnchor(value: unknown): comments.CommentAnchor | null {
    if (!value || typeof value !== 'object') return null;
    const raw = asRecord(value);
    const type = raw.type === 'lines' ? 'lines' : raw.type === 'text' ? 'text' : null;
    if (!type) return null;
    const anchor: comments.CommentAnchor = { type };
    for (const key of ['quote', 'prefix', 'suffix'] as const) {
      const value = shortString(raw[key], key === 'quote' ? 12000 : 500);
      if (value != null) anchor[key] = value;
    }
    for (const key of ['startLine', 'endLine', 'oldStart', 'oldEnd', 'newStart', 'newEnd'] as const) {
      const line = raw[key];
      if (typeof line === 'number' && Number.isInteger(line) && line >= 0) anchor[key] = line;
    }
    return (anchor.quote || type === 'lines') ? anchor : null;
  }

  function cleanCommentTarget(value: unknown): comments.CommentTarget | null {
    if (!value || typeof value !== 'object') return null;
    const raw = asRecord(value);
    const anchor = cleanAnchor(raw.anchor);
    if (!anchor) return null;
    if (raw.kind === 'file') {
      const filePath = shortString(raw.path, 4096);
      if (!filePath || !path.isAbsolute(filePath)) return null;
      return {
        kind: 'file', path: path.resolve(filePath),
        relPath: shortString(raw.relPath, 4096), anchor,
      };
    }
    if (raw.kind === 'diff') {
      const repo = shortString(raw.repo, 4096);
      const filePath = shortString(raw.path, 4096);
      if (!repo || !filePath) return null;
      return {
        kind: 'diff', repo, path: filePath,
        oldPath: shortString(raw.oldPath, 4096), anchor,
      };
    }
    if (raw.kind === 'page') {
      const pageToken = shortString(raw.pageToken, 256);
      const page = pageToken && pages.getPage(pageToken);
      if (!pageToken || !page || page.renderer === 'file') return null;
      return {
        kind: 'page', pageToken, root: page.root,
        title: page.title || null, anchor,
      };
    }
    return null;
  }

  const createComment: PublicationHandler = (req, res) => {
    const input = asRecord(req.body);
    const body = commentBody(input.body);
    const target = cleanCommentTarget(input.target);
    if (!body) return res.status(400).json({ error: 'comment body required (max 10000 characters)' });
    if (!target) return res.status(400).json({ error: 'valid anchored target required' });

    let sessionId: unknown = shortString(input.sessionId, 512);
    if (target.kind === 'page') {
      const page = pages.getPage(target.pageToken);
      sessionId = page?.sessionId || sessionId || inferSessionForPath(page!.root);
    }
    const knownSessionId = sessionId && canonicalKnownSessionId(sessionId);
    if (!knownSessionId) {
      return res.status(404).json({ error: 'target session not found' });
    }
    res.status(201).json(comments.createComment({ sessionId: knownSessionId, body, target }));
  };

  function commentPreview(value: unknown, label: string): unknown {
    // Strings, or arrays from older stores; both have a native slice.
    if (typeof value === 'string' || Array.isArray(value)) return value.slice(0, 240);
    throw new TypeError(`${label} is not a string or array`);
  }

  function commentIndexEntry(comment: comments.CommentDto) {
    const target = asRecord(comment.target || {});
    const anchor = asRecord(target.anchor || {});
    const indexedAnchor: Record<string, unknown> = { type: anchor.type };
    for (const key of ['startLine', 'endLine', 'oldStart', 'oldEnd', 'newStart', 'newEnd']) {
      if (Number.isInteger(anchor[key])) indexedAnchor[key] = anchor[key];
    }
    if (anchor.quote) indexedAnchor.quotePreview = commentPreview(anchor.quote, 'anchor.quote');
    const indexedTarget: Record<string, unknown> = { kind: target.kind, anchor: indexedAnchor };
    for (const key of ['path', 'relPath', 'repo', 'oldPath', 'root', 'title', 'pageToken']) {
      if (target[key] != null) indexedTarget[key] = target[key];
    }
    return {
      id: comment.id,
      // The comments CLI routes get/ack/edit by the session it reads here.
      sessionId: comment.sessionId,
      createdAt: comment.createdAt,
      bodyPreview: commentPreview(comment.body, 'comment.body'),
      target: indexedTarget,
    };
  }

  // Lightweight, unpaginated inventory with enough location/intent for the agent
  // to group comments without loading full bodies. Changes no comment state.
  const commentIndex: PublicationHandler = (req, res) => {
    const sessionId = shortString(req.query.sessionId, 512);
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const open = comments.listComments({ sessionId, state: 'open' });
    res.json({ comments: open.map(commentIndexEntry), total: open.length });
  };

  const commentCount: PublicationHandler = (req, res) => {
    const sessionId = shortString(req.query.sessionId, 512);
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    res.json({ total: comments.listComments({ sessionId, state: 'open' }).length });
  };

  // State-free read; acknowledgment is a separate explicit close.
  const getComments: PublicationHandler = (req, res) => {
    const input = asRecord(req.body);
    const sessionId = shortString(input.sessionId, 512);
    const rawIds = input.ids;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    if (!Array.isArray(rawIds) || !rawIds.length || rawIds.length > 200
        || rawIds.some((id) => typeof id !== 'string' || !id || id.length > 256)) {
      return res.status(400).json({ error: 'ids must contain 1-200 comment ids' });
    }
    const ids = [...new Set(rawIds)];
    const openById = new Map(comments.listComments({ sessionId, state: 'open' })
      .map((comment) => [comment.id, comment]));
    const selected = ids.map((id) => openById.get(id)).filter(Boolean);
    const missing = ids.filter((id) => !openById.has(id));
    res.json({ comments: selected, missing, total: selected.length, hasMore: false });
  };

  // Edit/delete is the user's correction path. Acknowledged comments are the
  // agent's record and stay immutable: a late edit would change what was acted on.
  function requestedComment(req: PublicationRequest, res: PublicationResponse, allowAcknowledged: boolean) {
    const existing = comments.getComment(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'comment not found' });
      return null;
    }
    let requestedSessionId = null;
    try { requestedSessionId = canonicalSessionId(asRecord(req.body).sessionId); } catch {}
    if (!requestedSessionId || requestedSessionId !== existing.sessionId) {
      res.status(403).json({ error: 'comment belongs to a different session' });
      return null;
    }
    if (!allowAcknowledged && existing.acknowledgedAt) {
      res.status(409).json({ error: 'comment already acknowledged' });
      return null;
    }
    return existing;
  }

  const resolveOpenComment = (req: PublicationRequest, res: PublicationResponse) =>
    requestedComment(req, res, false);

  const updateComment: PublicationHandler = (req, res) => {
    if (!resolveOpenComment(req, res)) return;
    const body = commentBody(asRecord(req.body).body);
    if (!body) return res.status(400).json({ error: 'comment body required (max 10000 characters)' });
    const comment = comments.updateComment(req.params.id, body);
    if (!comment) return res.status(409).json({ error: 'comment already acknowledged' });
    res.json(comment);
  };

  const deleteComment: PublicationHandler = (req, res) => {
    if (!resolveOpenComment(req, res)) return;
    if (!comments.deleteComment(req.params.id)) {
      return res.status(409).json({ error: 'comment already acknowledged' });
    }
    res.json({ ok: true });
  };

  const acknowledgeComment: PublicationHandler = (req, res) => {
    if (!requestedComment(req, res, true)) return;
    res.json(comments.acknowledgeComment(req.params.id));
  };

  // Page-scoped comments for the published-page overlay, which runs in an
  // opaque sandboxed origin. The page token is the whole scope: only open
  // comments anchored on that page, session from the page registration. Page
  // scripts share the overlay's capability and nothing more. These stay under
  // /api (bearer-gated, never on the public listener).

  function pageCommentView(comment: comments.CommentDto | comments.CommentRecord) {
    const anchor = asRecord(asRecord(comment.target).anchor);
    return {
      id: comment.id,
      body: comment.body,
      anchor: { type: anchor.type, quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix },
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }

  function commentablePage(req: PublicationRequest, res: PublicationResponse) {
    const page = pages.getPage(req.params.token);
    if (page && page.renderer !== 'file') return page;
    res.status(404).json({ error: 'page not found' });
    return null;
  }

  function openPageComment(req: PublicationRequest, res: PublicationResponse) {
    if (!commentablePage(req, res)) return null;
    const existing = comments.getComment(req.params.id);
    const target = asRecord(existing?.target);
    if (!existing || target.kind !== 'page' || target.pageToken !== req.params.token) {
      res.status(404).json({ error: 'comment not found' });
      return null;
    }
    if (existing.acknowledgedAt) {
      res.status(409).json({ error: 'comment already acknowledged' });
      return null;
    }
    return existing;
  }

  const listPageComments: PublicationHandler = (req, res) => {
    if (!commentablePage(req, res)) return;
    const open = comments.listComments({ pageToken: req.params.token, state: 'open' });
    res.json({ comments: open.map(pageCommentView) });
  };

  const createPageComment: PublicationHandler = (req, res) => {
    const page = commentablePage(req, res);
    if (!page) return;
    const input = asRecord(req.body);
    const body = commentBody(input.body);
    if (!body) return res.status(400).json({ error: 'comment body required (max 10000 characters)' });
    const target = cleanCommentTarget({ kind: 'page', pageToken: req.params.token, anchor: input.anchor });
    if (!target) return res.status(400).json({ error: 'a text anchor is required' });
    const sessionId = page.sessionId || inferSessionForPath(page.root);
    const knownSessionId = sessionId && canonicalKnownSessionId(sessionId);
    if (!knownSessionId) return res.status(404).json({ error: 'target session not found' });
    res.status(201).json(pageCommentView(comments.createComment({ sessionId: knownSessionId, body, target })));
  };

  const updatePageComment: PublicationHandler = (req, res) => {
    if (!openPageComment(req, res)) return;
    const body = commentBody(asRecord(req.body).body);
    if (!body) return res.status(400).json({ error: 'comment body required (max 10000 characters)' });
    const comment = comments.updateComment(req.params.id, body);
    if (!comment) return res.status(409).json({ error: 'comment already acknowledged' });
    res.json(pageCommentView(comment));
  };

  const deletePageComment: PublicationHandler = (req, res) => {
    if (!openPageComment(req, res)) return;
    if (!comments.deleteComment(req.params.id)) {
      return res.status(409).json({ error: 'comment already acknowledged' });
    }
    res.json({ ok: true });
  };

  function pagePayload(token: unknown, entry: pages.PageDto) {
    const pagePath = `/page/${token}`;
    return {
      token,
      path: pagePath,
      url: publicLink(pagePath),
      root: entry.root,
      title: entry.title || null,
      sessionId: entry.sessionId || null,
      renderer: entry.renderer || null,
      createdAt: entry.createdAt,
    };
  }

  // Deliberately no path gate: the main app is trusted-only and agents can
  // already copy any file into their cwd, so a workspace-path rule is theater.
  // The public share listener never registers, only serves known tokens.
  const createPage: PublicationHandler = (req, res) => {
    const input = asRecord(req.body);
    const { path: rawPath, title, sessionId, renderer } = input;
    const hasSessionId = Object.hasOwn(input, 'sessionId');
    if (typeof rawPath !== 'string' || !rawPath) {
      return res.status(400).json({ error: 'path required' });
    }
    if (renderer != null && renderer !== 'file') {
      return res.status(400).json({ error: 'renderer must be "file" when provided' });
    }
    if (!path.isAbsolute(rawPath)) {
      return res.status(400).json({ error: 'path must be absolute' });
    }
    const root = path.resolve(rawPath);
    let stat;
    try { stat = fs.statSync(root); } catch {
      return res.status(404).json({ error: `No such file: ${root}` });
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      return res.status(400).json({ error: 'path must be a file or directory' });
    }
    if (renderer === 'file' && !stat.isFile()) {
      return res.status(400).json({ error: 'the file renderer requires a file' });
    }
    if (stat.isDirectory() && !fs.existsSync(path.join(root, 'index.html'))) {
      return res.status(400).json({ error: 'directory pages need an index.html' });
    }
    // A form is checked when it is published so the agent sees its mistakes
    // now, not the user later; serving re-parses the live file.
    const form = renderer === 'file' ? null : pageForms.readPageForm(root);
    if (form && 'errors' in form) {
      return res.status(400).json({ error: `invalid pi-dish-form: ${form.errors.join('; ')}`, formErrors: form.errors });
    }
    let associatedSessionId;
    if (hasSessionId) {
      associatedSessionId = shortString(sessionId, 512);
      if (!associatedSessionId) {
        return res.status(400).json({ error: 'sessionId must be a non-empty string (max 512 characters)' });
      }
      associatedSessionId = canonicalKnownSessionId(associatedSessionId);
      if (!associatedSessionId) {
        return res.status(404).json({ error: 'sessionId does not identify a known active or historical session' });
      }
    } else {
      associatedSessionId = inferSessionForPath(root);
    }
    // Re-publishing keeps the session already recorded for this root.
    const existing = pages.listPages().find(page => page.root === root);
    const recipient = associatedSessionId || (typeof existing?.sessionId === 'string' ? existing.sessionId : null);
    if (form && !recipient) {
      return res.status(400).json({ error: 'a page with a pi-dish-form needs the session that publishes it, to receive the answers: pass sessionId (the pages CLI discovers it)' });
    }
    // A form would let whoever reaches the page's form view prompt the session; private ones stay behind their PIN.
    if (form && recipient && ports.sessionIsPrivate(recipient)) {
      return res.status(400).json({ error: 'a private session cannot publish a pi-dish-form' });
    }
    if (form) {
      // The whole state the form view loads must fit a hub's relay, with room for the largest answer set.
      const placeholder = 'x'.repeat(43);
      const empty: pageForms.FormRecord = { revision: 0, current: null, submissions: [], receipts: [] };
      const bytes = Buffer.byteLength(JSON.stringify(formStateBody(placeholder, title, root, form, placeholder, empty, () => false)))
        + pageForms.MAX_ANSWER_BYTES + 2 * Buffer.byteLength(JSON.stringify(form.spec.questions.map(question => question.id))) + 1024;
      if (bytes > pageForms.MAX_FORM_RESPONSE_BYTES) {
        return res.status(400).json({ error: `invalid pi-dish-form: the form view's data would be ${Math.ceil(bytes / 1024)} KiB with answers `
          + `(limit ${pageForms.MAX_FORM_RESPONSE_BYTES / 1024} KiB); shorten the title, labels or images` });
      }
    }
    // Answers belong to one recipient. A page once bound to a form's recipient
    // gets a new token when published for another session, whatever its HTML
    // or renderer now: the old link, its answers and receipts end with the old binding.
    const bound = typeof existing?.formRecipient === 'string' ? existing.formRecipient
      : form && typeof existing?.sessionId === 'string' ? existing.sessionId : null;
    let replacedToken: string | null = null;
    if (existing && typeof existing.token === 'string' && bound && associatedSessionId && bound !== associatedSessionId) {
      pages.revokePage(existing.token);
      replacedToken = existing.token;
    }
    const token = pages.createPage({
      root,
      title: title || null,
      sessionId: associatedSessionId || null,
      renderer: renderer || null,
      formRecipient: form ? recipient : null,
    });
    // The rotation is committed first; answers left under the revoked token are unreachable.
    if (replacedToken) {
      try { pageForms.deleteSubmissions(replacedToken); } catch (error) { console.error(`[page-forms] could not clear answers of a replaced page: ${errorMessage(error)}`); }
    }
    const formInfo = form ? { questions: form.spec.questions.length, answerPath: `/forms/${token}` } : null;
    res.json({ ...pagePayload(token, pages.getPage(token)!), form: formInfo, ...(replacedToken ? { replacedToken } : {}) });
  };

  const listPages: PublicationHandler = (req, res) => {
    let list = pages.listPages();
    let filterSessionId = null;
    try { filterSessionId = req.query.sessionId && canonicalSessionId(req.query.sessionId); } catch {}
    if (req.query.sessionId) list = list.filter((p) => p.sessionId === filterSessionId);
    res.json(list.map(({ token, ...entry }) => ({
      ...pagePayload(token, entry),
      missing: typeof entry.root !== 'string' || !fs.existsSync(entry.root),
    })));
  };

  const revokePage: PublicationHandler = (req, res) => {
    const revoked = pages.revokePage(req.params.token);
    // The token is dead either way; leftover answers under it are unreachable.
    if (revoked) {
      try { pageForms.deleteSubmissions(req.params.token); } catch (error) { console.error(`[page-forms] could not clear answers of a revoked page: ${errorMessage(error)}`); }
    }
    res.json({ revoked });
  };

  // Form routes live under /api (bearer- or auth-proxy-gated, same-origin
  // only, no-store; see accessHandlers.sameOriginOnly), relayed by a hub to
  // the owner host, never mounted on the public listener. Only pi-dish's own
  // form view calls them; the sandboxed artifact has no path to them. A page
  // switched to the file renderer keeps its answers and receipts.
  function formPage(req: PublicationRequest, res: PublicationResponse) {
    const entry = pages.getPage(req.params.token);
    if (entry && typeof entry.root === 'string') return { entry, root: entry.root };
    res.status(404).json({ error: 'page not found' });
    return null;
  }

  // The page's form binding: the recipient recorded when the form was
  // published (older rows: the page's session), refused exactly like
  // /api/sessions/:id while it is a locked private session.
  function ownerForm(req: PublicationRequest, res: PublicationResponse) {
    const page = formPage(req, res);
    if (!page) return null;
    const recorded = page.entry.formRecipient || page.entry.sessionId || inferSessionForPath(page.root);
    const binding = typeof recorded === 'string' ? recorded : null;
    if (binding && ports.privateRefused(req, binding)) {
      res.status(404).json({ error: 'page not found' });
      return null;
    }
    const sessionId = (binding && canonicalKnownSessionId(binding)) || null;
    // A stored submission or receipt shows only under the binding it was made
    // for, and only through that session's own PIN policy.
    const owns = (record: { sessionId: string }) =>
      (record.sessionId === sessionId || record.sessionId === binding) && !ports.privateRefused(req, record.sessionId);
    return { ...page, sessionId, owns };
  }

  // Relative option images resolve under a directory page's own asset route.
  function imageResolver(root: string, token: string) {
    let directory = false;
    try { directory = fs.statSync(root).isDirectory(); } catch {}
    return (url: string): string | null => {
      if (pageForms.isAbsoluteImage(url)) return url;
      if (!directory) return null;
      const resolved = new URL(url, `http://page.invalid/page/${token}/`);
      return resolved.origin === 'http://page.invalid' && resolved.pathname.startsWith(`/page/${token}/`)
        ? resolved.pathname + resolved.search : null;
    };
  }

  // Page token -> the submission id being delivered (one per page at a time).
  const delivering = new Map<string, string>();
  // An outcome whose store write failed. Its page admits no submission (whose
  // expected revision would be the stale stored one) until a retried write lands.
  const unrecorded = new Map<string, { id: string; outcome: Pick<pageForms.FormSubmission, 'state' | 'error' | 'finishedAt'> }>();

  function flushOutcome(token: string): boolean {
    const pending = unrecorded.get(token);
    if (!pending) return true;
    try {
      pageForms.finishSubmission(token, pending.id, pending.outcome);
      unrecorded.delete(token);
      return true;
    } catch {
      return false;
    }
  }

  // A record still marked delivering that no delivery of this process owns was
  // cut off by a restart: the agent may or may not have it.
  function settled<T extends pageForms.FormReceiptRecord>(token: string, record: T): T {
    if (record.state !== 'delivering' || delivering.get(token) === record.id) return record;
    const pending = unrecorded.get(token);
    if (pending?.id === record.id) return { ...record, ...pending.outcome };
    return { ...record, state: 'uncertain', error: 'pi-dish stopped while delivering; the agent may or may not have it', finishedAt: null };
  }

  function answerSet(token: string, submission: pageForms.FormSubmission) {
    const { sessionId: _destination, ...shown } = settled(token, submission);
    return shown;
  }

  // Everything the form view loads; also what publish and submit budget.
  function formStateBody(token: string, title: unknown, root: string, form: pageForms.ParsedForm | null, fingerprint: string | null,
    stored: pageForms.FormRecord, owns: (record: { sessionId: string }) => boolean) {
    const spec = form && 'spec' in form ? form.spec : null;
    const latest = stored.current && owns(stored.current) ? stored.current : null;
    const unresolved = stored.receipts
      .filter(item => owns(item) && item.id !== latest?.id && item.acceptedAt >= (latest?.acceptedAt ?? 0))
      .map(item => settled(token, item))
      .filter(item => item.state === 'delivering' || item.state === 'uncertain')
      .slice(-5)
      .map(pageForms.receiptOf);
    return {
      token,
      title: title || null,
      pagePath: `/page/${token}`,
      form: spec ? pageForms.clientSpec(spec, imageResolver(root, token)) : null,
      formErrors: form && 'errors' in form ? form.errors : null,
      fingerprint,
      revision: stored.revision,
      latest: latest ? answerSet(token, latest) : null,
      unresolved,
    };
  }

  // The store fails closed: an unreadable one answers 500, never "no submissions".
  function readStored(token: string, res: PublicationResponse): pageForms.FormRecord | null {
    try {
      return pageForms.readSubmissions(token);
    } catch (error) {
      res.status(500).json({ error: `the form answers store is unreadable: ${errorMessage(error)}` });
      return null;
    }
  }

  // A body a hub could not relay is replaced by a short, actionable refusal.
  function sendBudgeted(res: PublicationResponse, body: unknown) {
    const text = JSON.stringify(body);
    const bytes = Buffer.byteLength(text);
    if (bytes <= pageForms.MAX_FORM_RESPONSE_BYTES) return res.type('application/json').send(text);
    res.status(413).json({ error: `the form's data is ${Math.ceil(bytes / 1024)} KiB (limit ${pageForms.MAX_FORM_RESPONSE_BYTES / 1024} KiB); `
      + 'ask the agent to shorten the form' });
  }

  // The form view's data, the latest delivered answers and any unresolved
  // submissions (also the agent's fetch). `?submission=<id>` returns that
  // submission's own answer set, readable from the moment it was accepted.
  const pageForm: PublicationHandler = (req, res) => {
    const page = ownerForm(req, res);
    if (!page) return;
    const token = req.params.token;
    flushOutcome(token);
    const stored = readStored(token, res);
    if (!stored) return;
    if (typeof req.query.submission === 'string') {
      const id = req.query.submission;
      const submission = [...stored.submissions, ...(stored.current ? [stored.current] : [])].find(item => item.id === id && page.owns(item));
      if (submission) return sendBudgeted(res, { token, submission: answerSet(token, submission) });
      const receipt = stored.receipts.find(item => item.id === id && page.owns(item));
      return res.status(404).json({
        error: receipt ? 'this submission\'s answers are no longer kept' : 'no such submission',
        ...(receipt ? { receipt: pageForms.receiptOf(settled(token, receipt)) } : {}),
      });
    }
    const form = pageForms.readPageForm(page.root);
    const fingerprint = form && 'spec' in form && page.sessionId ? pageForms.formFingerprint(form.spec, page.sessionId) : null;
    sendBudgeted(res, formStateBody(token, page.entry.title, page.root, form, fingerprint, stored, page.owns));
  };

  const pageFormReceipt: PublicationHandler = (req, res) => {
    const page = ownerForm(req, res);
    if (!page) return;
    flushOutcome(req.params.token);
    const stored = readStored(req.params.token, res);
    if (!stored) return;
    const receipt = stored.receipts.find(item => item.id === req.params.id && page.owns(item));
    if (!receipt) return res.status(404).json({ error: 'no such submission' });
    res.json({ receipt: pageForms.receiptOf(settled(req.params.token, receipt)) });
  };

  const { SUBMISSION_ID_RE } = pageForms;

  // Accepts a submission (202 with a receipt) and delivers it in the
  // background, so neither a hub's relay timeout nor a bot's wake can turn
  // one submit into two: a retry with the same submissionId reads the receipt.
  const submitPageForm: PublicationHandler = (req, res) => {
    try {
      acceptPageForm(req, res);
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ error: `not accepted: ${errorMessage(error)}` });
    }
  };

  function acceptPageForm(req: PublicationRequest, res: PublicationResponse) {
    const token = req.params.token;
    const page = ownerForm(req, res);
    if (!page) return;
    const input = asRecord(req.body);
    const id = input.submissionId;
    if (typeof id !== 'string' || !SUBMISSION_ID_RE.test(id)) {
      return res.status(400).json({ error: 'submissionId must be 8-64 letters, digits, "_" or "-"' });
    }
    const recorded = flushOutcome(token);
    const stored = pageForms.readSubmissions(token);
    // Any id ever accepted here answers with its receipt, never a second send.
    const existing = stored.receipts.find(item => item.id === id);
    if (existing) {
      if (!page.owns(existing)) return res.status(409).json({ code: 'stale', error: 'that submission was made for another recipient' });
      const receipt = pageForms.receiptOf(settled(token, existing));
      return res.status(receipt.state === 'delivering' ? 202 : 200).json({ receipt, repeated: true });
    }
    if (!recorded) {
      return res.status(409).json({ code: 'busy', error: 'the last submission\'s outcome is not recorded yet; try again shortly' });
    }
    const form = pageForms.readPageForm(page.root);
    if (!form) return res.status(404).json({ error: 'this page has no form' });
    if ('errors' in form) return res.status(409).json({ code: 'invalid', error: `the page's form is invalid: ${form.errors.join('; ')}` });
    if (!page.sessionId) return res.status(409).json({ code: 'no-session', error: 'the session that published this page is unknown; nothing was sent' });
    const fingerprint = pageForms.formFingerprint(form.spec, page.sessionId);
    if (input.fingerprint !== fingerprint) {
      return res.status(409).json({ code: 'stale', error: 'the form or its recipient changed since this view loaded; reload and review the answers' });
    }
    if (input.expectedRevision !== stored.revision) {
      return res.status(409).json({ code: 'revision', revision: stored.revision, error: `answers were submitted from another view (revision ${stored.revision})` });
    }
    if (delivering.has(token)) {
      return res.status(409).json({ code: 'busy', error: 'another submission for this page is still being delivered' });
    }
    if (stored.receipts.length >= pageForms.MAX_RECEIPTS) {
      return res.status(409).json({ code: 'full', error: `this form has taken ${pageForms.MAX_RECEIPTS} submissions; ask the agent to publish it anew` });
    }
    const checked = pageForms.validateAnswers(form.spec, input.answers);
    if ('errors' in checked) return res.status(400).json({ error: checked.errors.join('; '), errors: checked.errors });
    const at = Date.now();
    const previous = stored.current;
    const submission: pageForms.FormSubmission = {
      id, state: 'delivering', revision: stored.revision + 1, acceptedAt: at, finishedAt: null, error: null,
      sessionId: page.sessionId, fingerprint, answers: checked.answers,
      changed: pageForms.changedQuestions(form.spec, checked.answers).map(question => question.id),
    };
    // Once delivered, the form view's state must still fit a hub's relay.
    const after = { ...stored, current: { ...submission, state: 'delivered' as const } };
    const bytes = Buffer.byteLength(JSON.stringify(formStateBody(token, page.entry.title, page.root, form, fingerprint, after, page.owns)));
    if (bytes > pageForms.MAX_FORM_RESPONSE_BYTES) {
      return res.status(413).json({ error: `these answers make the form's data ${Math.ceil(bytes / 1024)} KiB (limit ${pageForms.MAX_FORM_RESPONSE_BYTES / 1024} KiB); shorten them` });
    }
    const message = pageForms.formatFormMessage({
      spec: form.spec, answers: checked.answers, token, submissionId: id,
      pageTitle: typeof page.entry.title === 'string' ? page.entry.title : null,
      submittedAt: at, revision: submission.revision, previousAt: previous?.acceptedAt ?? null,
      ompRecipient: routeIdentity(page.sessionId)?.harnessId === 'omp',
    });
    // The answer set and its receipt are stored before anything is sent (a
    // failed write sends nothing), so the agent can read it when the message
    // arrives. A form added after publishing is bound to this recipient now.
    pages.bindFormRecipient(token, page.sessionId);
    pageForms.acceptSubmission(token, submission);
    delivering.set(token, id);
    res.status(202).json({ receipt: pageForms.receiptOf(submission) });
    void deliverForm(token, id, page.sessionId, message);
  }

  async function deliverForm(token: string, id: string, sessionId: string, message: string) {
    let outcome: Pick<pageForms.FormSubmission, 'state' | 'error' | 'finishedAt'>;
    try {
      // A message the session only buffered, or did not confirm taking in
      // time, is uncertain, not delivered, and advances nothing.
      const unconfirmed = await ports.deliverMessage(sessionId, message);
      outcome = { state: unconfirmed ? 'uncertain' : 'delivered', error: unconfirmed, finishedAt: Date.now() };
    } catch (error) {
      // Admission refusals (409, or the host refusing the command) happen
      // before anything reaches the agent; any other failure may follow a send.
      const refused = errorStatus(error, 0) === 409 || asRecord(error).hostRefused === true;
      outcome = { state: refused ? 'failed' : 'uncertain', error: errorMessage(error), finishedAt: Date.now() };
    }
    // Outcome and revision in one write (false when the page was unpublished
    // meanwhile: revocation wins). A failed write locks the page until a retry lands.
    unrecorded.set(token, { id, outcome });
    if (!flushOutcome(token)) console.error(`[page-forms] could not record the outcome of ${id}; retrying on the next request`);
    if (delivering.get(token) === id) delivering.delete(token);
  }

  // pi-dish's own form view: a trusted app page that cannot be framed and
  // reads and submits through the API above. The token is the only input.
  const formStylesVersion = crypto.createHash('sha256').update(pageForms.FORM_STYLE).digest('hex').slice(0, 16);
  const formView: PublicationHandler = (req, res) => {
    const token = req.params.token;
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) return res.status(404).type('text/plain').send('Not found');
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: http: https:; "
        + "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Answer · pi-dish</title>'
      + `<link rel="stylesheet" href="/forms.css?v=${formStylesVersion}"></head>`
      + `<body class="pdf-app"><main id="pdfApp" data-token="${token}"><p>Loading the form…</p></main>`
      + `<script src="/forms.js?v=${assetVersion('forms.js')}" defer></script></body></html>`);
  };
  const formStyles: PublicationHandler = (_req, res) => {
    res.set('Cache-Control', 'no-store').type('css').send(pageForms.FORM_STYLE);
  };

  // Shell scripts are mutable and unhashed on disk: the query names their bytes.
  const assetVersions = new Map<string, { key: string; version: string }>();
  function assetVersion(name: string): string {
    const file = path.join(ports.resourceRoot, 'public', name);
    try {
      const stat = fs.statSync(file);
      const key = `${stat.mtimeMs}:${stat.size}`;
      const cached = assetVersions.get(name);
      if (cached?.key === key) return cached.version;
      const version = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
      assetVersions.set(name, { key, version });
      return version;
    } catch {
      return '0';
    }
  }

  // File roots serve the file; directory roots serve index.html at
  // /page/:token/ (bare token redirects so relative assets resolve) and assets
  // at /page/:token/<rel>. sendFile's root option rejects traversal; failures 404.
  // A form renders as a read-only preview in every view. The owner view (the
  // main app's /page route) adds the comment overlay and, where the serving
  // front has pi-dish's form view, a plain link to it; nothing in the page
  // carries any authority.
  function sendPageFile(file: string, req: PublicationRequest, res: PublicationResponse, owner: boolean) {
    const sendRaw = () => res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(404).type('text/plain').send('Not found');
    });
    if (path.extname(file).toLowerCase() !== '.html') return sendRaw();
    fs.readFile(file, 'utf8', (err, html) => {
      if (err) return res.status(404).type('text/plain').send('Not found');
      const form = pageForms.parsePageForm(html);
      // A public page without a form stays the author's file, byte for byte.
      if (!owner && !form) return sendRaw();
      // A hub relaying this page says whether it serves /forms (older ones do not).
      const formsFront = req.headers[ARTIFACT_HOP_HEADER] === undefined || req.headers[FORMS_FRONT_HEADER] === '1';
      const answerHref = owner && formsFront ? `/forms/${req.params.token}` : null;
      let document = form ? pageForms.renderPageForm(html, form, answerHref) : html;
      if (owner) {
        const tag = `<script src="/artifact-comments.js?v=${assetVersion('artifact-comments.js')}" data-page-token="${req.params.token}"></script>`;
        const at = document.toLowerCase().lastIndexOf('</body>');
        document = at >= 0 ? document.slice(0, at) + tag + document.slice(at) : document + tag;
      }
      res.type('html').send(document);
    });
  }

  function sendRenderedFilePage(entry: pages.PageDto, root: string, req: PublicationRequest, res: PublicationResponse, notFound: () => void) {
    let file;
    try { file = readFileForViewer(root, { imageData: false }); } catch { return notFound(); }
    if ('error' in file) {
      return res.status(file.status || 415).type('text/plain').send('File cannot be previewed');
    }
    if (req.query.content != null) {
      if (!file.image && !file.video && !file.model) return notFound();
      const safeMime = file.video
        ? file.video.mimeType
        : file.model
          ? file.model.mimeType
          : file.image && file.image.mimeType !== 'image/svg+xml'
            ? file.image.mimeType : 'text/plain; charset=utf-8';
      res.setHeader('Cache-Control', 'public, no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (file.model) {
        const name = path.basename(root);
        const fallback = name.replace(/[^\x20-\x7e]|["\\;]/g, '_') || 'model.glb';
        const encoded = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
        res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
      }
      return sendRangedFile(req, res, root, { mimeType: safeMime, size: file.size, mtimeMs: file.mtime, onError: notFound });
    }
    res.setHeader('Cache-Control', 'public, no-cache');
    // Appended to the sandbox servePage already set: both policies apply.
    res.append('Content-Security-Policy', `default-src 'none'; script-src 'sha256-${FILE_PAGE_VIDEO_SCRIPT_HASH}'; style-src 'self'; img-src 'self' http: https:; media-src 'self' http: https:; base-uri 'none'; form-action 'none'`);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('html').send(renderFilePage({
      token: req.params.token,
      root,
      title: entry.title,
      file,
    }));
  }

  function servePage(req: PublicationRequest, res: PublicationResponse, annotate = false) {
    const entry = pages.getPage(req.params.token);
    // A token this host doesn't own may belong to a peer it fronts; the peer
    // injects its own overlay unless the public listener asks it not to.
    if (!entry) return ports.relay.serve(req, res, 'page', { annotate });
    if (req.headers[PAGE_COMMENTS_HEADER] === 'off') annotate = false;
    isolateArtifact(res, 'page');
    const notFound = () => { if (!res.headersSent) res.status(404).type('text/plain').send('Not found'); };
    const root = entry.root;
    if (typeof root !== 'string') return notFound();
    let stat;
    try { stat = fs.statSync(root); } catch { return notFound(); }
    // Non-strict routing sends /page/:token/ to the bare route too — read the
    // trailing slash off the real path or the redirect below would loop.
    const rest = req.params[0] || (req.path.endsWith('/') ? '/' : '');

    if (stat.isFile()) {
      if (rest) return notFound(); // a file page has no sub-paths
      if (entry.renderer === 'file') return sendRenderedFilePage(entry, root, req, res, notFound);
      return sendPageFile(root, req, res, annotate);
    }
    if (!rest) return res.redirect(302, `/page/${req.params.token}/`);
    const rel = rest === '/' ? 'index.html' : rest.replace(/^\//, '');
    if (rel === 'index.html') return sendPageFile(path.join(root, rel), req, res, annotate);
    res.sendFile(rel, { root }, (err) => { if (err) notFound(); });
  }

  const page: PublicationHandler = (req, res) => servePage(req, res, true);
  const pageAsset: PublicationHandler = (req, res) => {
    // Normalize express 4's wildcard into the shape servePage expects: the
    // rest including its leading slash ('/' for the bare trailing-slash URL).
    req.params[0] = '/' + (req.params[0] || '');
    servePage(req, res, true);
  };

  return {
    importShare, createShare, revokeShare, getShare, serveSharedSession,
    createComment, commentIndex, commentCount, getComments, updateComment,
    deleteComment, acknowledgeComment, createPage, listPages, revokePage,
    page, pageAsset, listPageComments, createPageComment,
    updatePageComment, deletePageComment, pageForm, pageFormReceipt, submitPageForm, formView, formStyles,
    publicPage: (req, res) => servePage(req, res),
    publicPageAsset: (req, res) => {
      req.params[0] = '/' + (req.params[0] || '');
      servePage(req, res);
    },
    fileStyles: (_req, res) => res.sendFile(path.join(ports.resourceRoot, 'public', 'style.css')),
    highlightStyles: (_req, res) => res.sendFile(path.join(ports.resourceRoot, 'public', 'vendor', 'hljs-theme.min.css')),
  };
}
