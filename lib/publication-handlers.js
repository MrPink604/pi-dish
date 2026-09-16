// Generated from src/core/publication-handlers.ts; edit that source and run npm run build:core.
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
exports.createPublicationHandlers = createPublicationHandlers;
const fs = require("fs");
const os = require("os");
const path = require("path");
const pages = __importStar(require("./pages"));
const shares = __importStar(require("./shares"));
const comments = __importStar(require("./comments"));
const session_key_1 = require("./session-key");
const session_ownership_1 = require("./session-ownership");
const file_mention_1 = require("./file-mention");
const file_page_1 = require("./file-page");
const omp_export_1 = require("./omp-export");
const PAGE_COMMENTS_HEADER = 'x-pi-dish-page-comments';
// Boxing preserves the legacy property reads on primitive JSON bodies/rows;
// members remain unknown until the consuming operation validates them.
function fields(value) {
    return Object(value);
}
function createPublicationHandlers(ports) {
    const { findSessionSource, liveSessionHistoryPending, listRegisteredSessions, enumerateSessionCandidates, getRPCSession, exportSessionHtml, getOmpShareSnapshot } = ports;
    // { path, url } for a token. url is set only when PI_DISH_SHARE_BASE_URL is,
    // so operators behind a proxy can hand out an absolute link.
    function sharePayload(token) {
        const sharePath = `/share/${token}`;
        const base = ports.publicBaseUrl();
        return { token, path: sharePath, url: base ? base.replace(/\/+$/, '') + sharePath : null };
    }
    // Per-token export cache keyed on the JSONL's (mtimeMs, size) and live export
    // snapshot, so repeated hits on an unchanged session don't re-run the exporter.
    const shareExportCache = new Map();
    async function serveSharedSession(req, res) {
        const share = shares.getShare(req.params.token);
        // A token this host doesn't own may still belong to a peer it fronts.
        if (!share)
            return ports.relay.serve(req, res, 'share');
        if (share.kind === 'html') {
            const htmlPath = shares.getShareHtmlPath(req.params.token);
            if (!htmlPath)
                return res.status(404).type('text/plain').send('Not found');
            res.type('html');
            return res.sendFile(htmlPath);
        }
        const session = typeof share.sessionId === 'string' ? findSessionSource(share.sessionId) : null;
        if (!session || (session.harnessId !== 'pi' && session.harnessId !== 'omp')) {
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
            }
            else {
                // Token is base64url (A-Za-z0-9_-), so it's already a safe basename.
                const outPath = path.join(os.tmpdir(), `pi-dish-share-${req.params.token}.html`);
                htmlPath = await exportSessionHtml(session, outPath, { shareSnapshot, snapshotResolved: true });
                shareExportCache.set(req.params.token, { mtimeMs: st.mtimeMs, size: st.size, snapshotKey, htmlPath });
            }
            res.type('html');
            res.sendFile(htmlPath);
        }
        catch (e) {
            res.status(500).type('text/plain').send('Export failed');
        }
    }
    function validOmpShareHtml(html) {
        if (typeof html !== 'string' || !html.includes('<html'))
            return false;
        try {
            return !!(0, omp_export_1.readOmpExportData)(html, 'import').header;
        }
        catch {
            return false;
        }
    }
    // OMP's supported custom-share hook gives us the complete native HTML that
    // /share generated from the live session. Preserve that exact snapshot rather
    // than trying to reconstruct OMP-only metadata from historical JSONL.
    const importShare = (req, res) => {
        if (!validOmpShareHtml(req.body)) {
            return res.status(400).json({ error: 'Expected a standalone OMP HTML export' });
        }
        try {
            const token = shares.createHtmlShare(req.body);
            return res.json(sharePayload(token));
        }
        catch (e) {
            return res.status(500).json({ error: fields(e).message });
        }
    };
    const createShare = (req, res) => {
        const session = findSessionSource(req.params.id);
        if (!session) {
            if (liveSessionHistoryPending(req.params.id)) {
                return res.status(409).json({ error: 'Session has no persisted history yet' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (session.harnessId !== 'pi' && session.harnessId !== 'omp') {
            return res.status(409).json({ error: 'Public HTML sharing is only supported for Pi and OMP sessions.' });
        }
        const token = shares.createShare(req.params.id);
        res.json(sharePayload(token));
    };
    const revokeShare = (req, res) => {
        const existing = shares.getShareForSession(req.params.id);
        const revoked = shares.revokeShare(req.params.id);
        if (existing)
            shareExportCache.delete(existing.token);
        // The token is reported so a hub fronting this session can drop its fleet
        // mapping immediately instead of waiting to serve a 404.
        res.json({ revoked, token: existing?.token || null });
    };
    const getShare = (req, res) => {
        const existing = shares.getShareForSession(req.params.id);
        if (!existing)
            return res.status(404).json({ error: 'No share' });
        res.json(sharePayload(existing.token));
    };
    // Public route — always available on the main app (the share listener is opt-in).
    // =========================================================================
    // Anchored comments (lib/comments.js)
    // =========================================================================
    //
    // The browser creates comments from a selected file/prose range or diff
    // lines. When the user later asks the agent to read comments, the
    // pi-dish-comments skill lists the open index, fetches whichever related ids
    // it needs, and acknowledges completed items. Creating a comment never
    // prompts, steers, or starts an agent turn.
    function shortString(value, max) {
        return typeof value === 'string' && value.length <= max ? value : null;
    }
    function inferSessionForPath(absPath) {
        // Nested session cwds are normal here (a checkout under a workspace root
        // that another session sits in), so the most specific containing cwd wins.
        // Only a genuine tie — two sessions at the same depth, e.g. the same cwd —
        // is ambiguous enough to give up on.
        const candidates = listRegisteredSessions()
            .filter((entry) => {
            if (!entry.cwd)
                return false;
            // path.resolve retains validation of a malformed persisted observation;
            // this input assertion does not validate or reclassify the registry row.
            const cwd = path.resolve(entry.cwd);
            if (absPath === cwd)
                return true;
            if (typeof absPath !== 'string')
                throw new TypeError('absPath.startsWith is not a function');
            return absPath.startsWith(cwd + path.sep);
        })
            .sort((a, b) => path.resolve(b.cwd).length - path.resolve(a.cwd).length);
        if (!candidates.length)
            return null;
        if (candidates[1] && path.resolve(candidates[1].cwd).length === path.resolve(candidates[0].cwd).length)
            return null;
        const identity = (0, session_ownership_1.registryIdentity)(candidates[0]);
        return identity ? (0, session_ownership_1.routeSessionId)(identity.harnessId, identity.nativeSessionId) : null;
    }
    function canonicalKnownSessionId(value) {
        const identity = (0, session_ownership_1.routeIdentity)(value);
        if (!identity || typeof value !== 'string')
            return null;
        const registered = listRegisteredSessions().some((entry) => {
            const candidate = (0, session_ownership_1.registryIdentity)(entry);
            return candidate?.harnessId === identity.harnessId
                && candidate.nativeSessionId === identity.nativeSessionId;
        });
        const rpc = identity.harnessId === 'pi' && getRPCSession(value)?.id === identity.nativeSessionId;
        const active = registered || rpc;
        const historical = !active && enumerateSessionCandidates().some((candidate) => candidate.harnessId === identity.harnessId
            && candidate.nativeSessionId === identity.nativeSessionId);
        return active || historical
            ? (0, session_ownership_1.routeSessionId)(identity.harnessId, identity.nativeSessionId)
            : null;
    }
    function cleanAnchor(value) {
        if (!value || typeof value !== 'object')
            return null;
        const raw = fields(value);
        const type = raw.type === 'lines' ? 'lines' : raw.type === 'text' ? 'text' : null;
        if (!type)
            return null;
        const anchor = { type };
        for (const key of ['quote', 'prefix', 'suffix']) {
            const value = shortString(raw[key], key === 'quote' ? 12000 : 500);
            if (value != null)
                anchor[key] = value;
        }
        for (const key of ['startLine', 'endLine', 'oldStart', 'oldEnd', 'newStart', 'newEnd']) {
            const line = raw[key];
            if (typeof line === 'number' && Number.isInteger(line) && line >= 0)
                anchor[key] = line;
        }
        return (anchor.quote || type === 'lines') ? anchor : null;
    }
    function cleanCommentTarget(value) {
        if (!value || typeof value !== 'object')
            return null;
        const raw = fields(value);
        const anchor = cleanAnchor(raw.anchor);
        if (!anchor)
            return null;
        if (raw.kind === 'file') {
            const filePath = shortString(raw.path, 4096);
            if (!filePath || !path.isAbsolute(filePath))
                return null;
            return {
                kind: 'file', path: path.resolve(filePath),
                relPath: shortString(raw.relPath, 4096), anchor,
            };
        }
        if (raw.kind === 'diff') {
            const repo = shortString(raw.repo, 4096);
            const filePath = shortString(raw.path, 4096);
            if (!repo || !filePath)
                return null;
            return {
                kind: 'diff', repo, path: filePath,
                oldPath: shortString(raw.oldPath, 4096), anchor,
            };
        }
        if (raw.kind === 'page') {
            const pageToken = shortString(raw.pageToken, 256);
            const page = pageToken && pages.getPage(pageToken);
            if (!pageToken || !page || page.renderer === 'file')
                return null;
            return {
                kind: 'page', pageToken, root: page.root,
                title: page.title || null, anchor,
            };
        }
        return null;
    }
    const createComment = (req, res) => {
        const input = fields(req.body);
        const rawBody = input.body;
        const body = typeof rawBody === 'string' ? shortString(rawBody.trim(), 10000) : null;
        const target = cleanCommentTarget(input.target);
        if (!body)
            return res.status(400).json({ error: 'comment body required (max 10000 characters)' });
        if (!target)
            return res.status(400).json({ error: 'valid anchored target required' });
        let sessionId = shortString(input.sessionId, 512);
        if (target.kind === 'page') {
            const page = pages.getPage(target.pageToken);
            sessionId = page?.sessionId || sessionId || inferSessionForPath(page.root);
        }
        const knownSessionId = sessionId && canonicalKnownSessionId(sessionId);
        if (!knownSessionId) {
            return res.status(404).json({ error: 'target session not found' });
        }
        res.status(201).json(comments.createComment({ sessionId: knownSessionId, body, target }));
    };
    function commentPreview(value, label) {
        // Persisted legacy values are not asserted to be strings. Arrays also
        // supported slice in the old implementation; other values still fail.
        if (value == null)
            throw new TypeError(`Cannot read properties of ${value} (reading 'slice')`);
        const slice = fields(value).slice;
        if (typeof slice !== 'function')
            throw new TypeError(`${label}.slice is not a function`);
        const preview = slice.call(value, 0, 240);
        return preview;
    }
    function commentIndexEntry(comment) {
        const target = fields(comment.target || {});
        const anchor = fields(target.anchor || {});
        const indexedAnchor = { type: anchor.type };
        for (const key of ['startLine', 'endLine', 'oldStart', 'oldEnd', 'newStart', 'newEnd']) {
            if (Number.isInteger(anchor[key]))
                indexedAnchor[key] = anchor[key];
        }
        if (anchor.quote)
            indexedAnchor.quotePreview = commentPreview(anchor.quote, 'anchor.quote');
        const indexedTarget = { kind: target.kind, anchor: indexedAnchor };
        for (const key of ['path', 'relPath', 'repo', 'oldPath', 'root', 'title', 'pageToken']) {
            if (target[key] != null)
                indexedTarget[key] = target[key];
        }
        return {
            id: comment.id,
            // The page overlay reads the index with only a page token in hand and
            // needs the session to fetch/edit/delete; /api is main-app only (the
            // public share listener never mounts it), which is the trust boundary.
            sessionId: comment.sessionId,
            createdAt: comment.createdAt,
            bodyPreview: commentPreview(comment.body, 'comment.body'),
            target: indexedTarget,
        };
    }
    // Lightweight, unpaginated inventory. It gives the agent enough location
    // and intent to infer useful groups without loading every full anchor/body.
    // Reading this index changes no comment state.
    const commentIndex = (req, res) => {
        const sessionId = shortString(req.query.sessionId, 512);
        // A published page knows its own token but not the session behind it, so
        // the overlay scopes the index that way instead.
        const pageToken = shortString(req.query.pageToken, 256);
        if (!sessionId && !pageToken) {
            return res.status(400).json({ error: 'sessionId or pageToken required' });
        }
        const open = comments.listComments({ sessionId, pageToken, state: 'open' });
        res.json({ comments: open.map(commentIndexEntry), total: open.length });
    };
    const commentCount = (req, res) => {
        const sessionId = shortString(req.query.sessionId, 512);
        if (!sessionId)
            return res.status(400).json({ error: 'sessionId required' });
        res.json({ total: comments.listComments({ sessionId, state: 'open' }).length });
    };
    // Fetch an agent-selected group from the inventory. This is a state-free
    // read; acknowledgment remains a separate, explicit close operation.
    const getComments = (req, res) => {
        const input = fields(req.body);
        const sessionId = shortString(input.sessionId, 512);
        const rawIds = input.ids;
        if (!sessionId)
            return res.status(400).json({ error: 'sessionId required' });
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
    // Editing/deleting is the user's own correction path from the views the
    // comment was written in. Acknowledged comments are the agent's record and
    // stay immutable — a late edit would silently change what was acted on.
    function resolveOpenComment(req, res) {
        const existing = comments.getComment(req.params.id);
        if (!existing) {
            res.status(404).json({ error: 'comment not found' });
            return null;
        }
        let requestedSessionId = null;
        try {
            requestedSessionId = (0, session_key_1.canonicalSessionId)(fields(req.body).sessionId);
        }
        catch { }
        if (!requestedSessionId || requestedSessionId !== existing.sessionId) {
            res.status(403).json({ error: 'comment belongs to a different session' });
            return null;
        }
        if (existing.acknowledgedAt) {
            res.status(409).json({ error: 'comment already acknowledged' });
            return null;
        }
        return existing;
    }
    const updateComment = (req, res) => {
        if (!resolveOpenComment(req, res))
            return;
        const rawBody = fields(req.body).body;
        const body = typeof rawBody === 'string' ? shortString(rawBody.trim(), 10000) : null;
        if (!body)
            return res.status(400).json({ error: 'comment body required (max 10000 characters)' });
        const comment = comments.updateComment(req.params.id, body);
        if (!comment)
            return res.status(409).json({ error: 'comment already acknowledged' });
        res.json(comment);
    };
    const deleteComment = (req, res) => {
        if (!resolveOpenComment(req, res))
            return;
        if (!comments.deleteComment(req.params.id)) {
            return res.status(409).json({ error: 'comment already acknowledged' });
        }
        res.json({ ok: true });
    };
    const acknowledgeComment = (req, res) => {
        const existing = comments.getComment(req.params.id);
        if (!existing)
            return res.status(404).json({ error: 'comment not found' });
        let requestedSessionId = null;
        try {
            requestedSessionId = (0, session_key_1.canonicalSessionId)(fields(req.body).sessionId);
        }
        catch { }
        if (!requestedSessionId || requestedSessionId !== existing.sessionId) {
            return res.status(403).json({ error: 'comment belongs to a different session' });
        }
        const comment = comments.acknowledgeComment(req.params.id);
        res.json(comment);
    };
    function pagePayload(token, entry) {
        const pagePath = `/page/${token}`;
        const base = ports.publicBaseUrl();
        return {
            token,
            path: pagePath,
            url: base ? base.replace(/\/+$/, '') + pagePath : null,
            root: entry.root,
            title: entry.title || null,
            sessionId: entry.sessionId || null,
            renderer: entry.renderer || null,
            createdAt: entry.createdAt,
        };
    }
    // Deliberately no path gate on registration: sharing governance rests with
    // the main app, which is assumed reachable only by trusted people (same
    // trust model as the rest of the API — anything on this port can already
    // drive agents with shell access, so a "no paths outside the workspace"
    // rule would only be theater: an agent can copy any file into its cwd).
    // The public share listener never registers, only serves known tokens.
    const createPage = (req, res) => {
        const { path: rawPath, title, sessionId, renderer } = fields(req.body);
        const hasSessionId = Object.prototype.hasOwnProperty.call(req.body || {}, 'sessionId');
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
        try {
            stat = fs.statSync(root);
        }
        catch {
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
        }
        else {
            associatedSessionId = inferSessionForPath(root);
        }
        const token = pages.createPage({
            root,
            title: title || null,
            sessionId: associatedSessionId || null,
            renderer: renderer || null,
        });
        res.json(pagePayload(token, pages.getPage(token)));
    };
    const listPages = (req, res) => {
        let list = pages.listPages();
        let filterSessionId = null;
        try {
            filterSessionId = req.query.sessionId && (0, session_key_1.canonicalSessionId)(req.query.sessionId);
        }
        catch { }
        if (req.query.sessionId)
            list = list.filter((p) => p.sessionId === filterSessionId);
        res.json(list.map(({ token, ...entry }) => ({
            ...pagePayload(token, entry),
            missing: typeof entry.root !== 'string' || !fs.existsSync(entry.root),
        })));
    };
    const revokePage = (req, res) => {
        res.json({ revoked: pages.revokePage(req.params.token) });
    };
    // The public serving routes. File roots serve the file itself; directory
    // roots serve index.html at /page/:token/ (the bare token URL redirects so
    // the document's relative asset URLs resolve under the token) and contained
    // assets at /page/:token/<rel>. res.sendFile rejects `..` traversal and
    // absolute rests via its root option — every failure is a bare 404.
    function sendPageFile(file, req, res, annotate) {
        if (!annotate || path.extname(file).toLowerCase() !== '.html') {
            return res.sendFile(file, (err) => {
                if (err && !res.headersSent)
                    res.status(404).type('text/plain').send('Not found');
            });
        }
        fs.readFile(file, 'utf8', (err, html) => {
            if (err)
                return res.status(404).type('text/plain').send('Not found');
            const tag = `<script src="/artifact-comments.js" data-page-token="${req.params.token}"></script>`;
            const at = html.toLowerCase().lastIndexOf('</body>');
            const annotated = at >= 0 ? html.slice(0, at) + tag + html.slice(at) : html + tag;
            res.type('html').send(annotated);
        });
    }
    function sendRenderedFilePage(entry, root, req, res, notFound) {
        let file;
        try {
            file = (0, file_mention_1.readFileForViewer)(root, { imageData: false });
        }
        catch {
            return notFound();
        }
        if ('error' in file) {
            return res.status(file.status || 415).type('text/plain').send('File cannot be previewed');
        }
        if (req.query.content != null) {
            if (!file.image)
                return notFound();
            const safeMime = file.image.mimeType !== 'image/svg+xml'
                ? file.image.mimeType : 'text/plain; charset=utf-8';
            res.setHeader('Cache-Control', 'public, no-cache');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            return res.type(safeMime).sendFile(root, (err) => { if (err)
                notFound(); });
        }
        res.setHeader('Cache-Control', 'public, no-cache');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src 'self' http: https:; base-uri 'none'; form-action 'none'");
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.type('html').send((0, file_page_1.renderFilePage)({
            token: req.params.token,
            root,
            title: entry.title,
            file,
        }));
    }
    function servePage(req, res, annotate = false) {
        const entry = pages.getPage(req.params.token);
        // A token this host doesn't own may still belong to a peer it fronts; the
        // peer answers the redirect and injects its own comment overlay — except
        // on the public listener, which asks the peer to leave it out (below).
        if (!entry)
            return ports.relay.serve(req, res, 'page', { annotate });
        if (req.headers[PAGE_COMMENTS_HEADER] === 'off')
            annotate = false;
        const notFound = () => { if (!res.headersSent)
            res.status(404).type('text/plain').send('Not found'); };
        const root = entry.root;
        if (typeof root !== 'string')
            return notFound();
        let stat;
        try {
            stat = fs.statSync(root);
        }
        catch {
            return notFound();
        }
        // Non-strict routing sends /page/:token/ to the bare route too — read the
        // trailing slash off the real path or the redirect below would loop.
        const rest = req.params[0] || (req.path.endsWith('/') ? '/' : '');
        if (stat.isFile()) {
            if (rest)
                return notFound(); // a file page has no sub-paths
            if (entry.renderer === 'file')
                return sendRenderedFilePage(entry, root, req, res, notFound);
            return sendPageFile(root, req, res, annotate);
        }
        if (!rest)
            return res.redirect(302, `/page/${req.params.token}/`);
        const rel = rest === '/' ? 'index.html' : rest.replace(/^\//, '');
        if (rel === 'index.html' && annotate) {
            return sendPageFile(path.join(root, rel), req, res, true);
        }
        res.sendFile(rel, { root }, (err) => { if (err)
            notFound(); });
    }
    const page = (req, res) => servePage(req, res, true);
    const pageAsset = (req, res) => {
        // Normalize express 4's wildcard into the shape servePage expects: the
        // rest including its leading slash ('/' for the bare trailing-slash URL).
        req.params[0] = '/' + (req.params[0] || '');
        servePage(req, res, true);
    };
    return {
        importShare, createShare, revokeShare, getShare, serveSharedSession,
        createComment, commentIndex, commentCount, getComments, updateComment,
        deleteComment, acknowledgeComment, createPage, listPages, revokePage,
        page, pageAsset,
        publicPage: (req, res) => servePage(req, res),
        publicPageAsset: (req, res) => {
            req.params[0] = '/' + (req.params[0] || '');
            servePage(req, res);
        },
        fileStyles: (_req, res) => res.sendFile(path.join(ports.resourceRoot, 'public', 'style.css')),
        highlightStyles: (_req, res) => res.sendFile(path.join(ports.resourceRoot, 'public', 'vendor', 'hljs-theme.min.css')),
    };
}
