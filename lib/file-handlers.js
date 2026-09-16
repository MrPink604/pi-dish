// Generated from src/core/file-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFileHandlers = createFileHandlers;
const crypto = require("crypto");
const path = require("path");
const helper_values_1 = require("./helper-values");
const file_search_1 = require("./file-search");
const file_mention_1 = require("./file-mention");
const session_files_1 = require("./session-files");
const git_diff_1 = require("./git-diff");
const DIFF_INLINE_FILE_LIMIT = 6;
const DIFF_SNAPSHOT_TTL_MS = 60 * 1000;
function createFileHandlers(ports) {
    const diffSnapshots = new Map();
    const searchDirectories = (req, res) => {
        try {
            res.json((0, file_search_1.searchHomeDirs)(String(req.query.q || ''), 15));
        }
        catch {
            res.status(500).json([]);
        }
    };
    const directoryChildren = (req, res) => {
        try {
            res.json((0, file_search_1.getDirChildren)(String(req.query.path || '')));
        }
        catch (error) {
            const fields = (0, helper_values_1.record)(error) ? error : {};
            if (fields.badRequest)
                return res.status(400).json({ error: fields.message });
            res.status(500).json({ error: fields.message });
        }
    };
    const searchSessionFiles = async (req, res) => {
        try {
            const q = String(req.query.q || '');
            const cwd = ports.resolveSessionCwd(req.params.id);
            if ((0, file_search_1.isPathCompletionToken)(q)) {
                return res.json({ cwd, files: (0, file_search_1.completePath)(q, { cwd: cwd, limit: 20 }) });
            }
            if (!cwd)
                return res.status(404).json({ error: 'Session cwd unknown' });
            const files = await (0, file_search_1.searchFiles)(cwd, q, 20);
            res.json({ cwd, files });
        }
        catch (error) {
            res.status(500).json({ error: (0, helper_values_1.record)(error) ? error.message : undefined });
        }
    };
    async function resolveViewerMention(sessionId, mention) {
        const cwd = ports.resolveSessionCwd(sessionId);
        const session = ports.findSessionSource(sessionId);
        if (!cwd && !session)
            return { error: 'Unknown session', status: 404 };
        let messages = [];
        if (session) {
            try {
                messages = (0, session_files_1.readSessionMessages)(session);
            }
            catch { }
        }
        const resolved = await (0, file_mention_1.resolveFileMention)(mention, { cwd: cwd, messages });
        if (!resolved)
            return { error: `Couldn't find "${mention}" among this session's files`, status: 404 };
        return { cwd, resolved };
    }
    // Both preview and raw bytes use the same session-aware reach rules.
    const fileContent = async (req, res) => {
        try {
            const mention = String(req.query.path || '');
            if (!mention || mention.length > 1024)
                return res.status(400).json({ error: 'path required' });
            const found = await resolveViewerMention(req.params.id, mention);
            if (found.error)
                return res.status(found.status).json({ error: found.error });
            const file = (0, file_mention_1.readFileForViewer)(found.resolved.absPath, { imageData: false });
            if ('error' in file)
                return res.status(file.status || 415).json({ error: file.error, path: found.resolved.absPath });
            res.setHeader('Cache-Control', 'private, no-cache');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            const safeImageMime = file.image && file.image.mimeType !== 'image/svg+xml'
                ? file.image.mimeType : 'text/plain; charset=utf-8';
            res.type(safeImageMime).sendFile(found.resolved.absPath);
        }
        catch (error) {
            res.status(500).json({ error: (0, helper_values_1.record)(error) ? error.message : undefined });
        }
    };
    const filePreview = async (req, res) => {
        try {
            const mention = String(req.query.path || '');
            if (!mention || mention.length > 1024)
                return res.status(400).json({ error: 'path required' });
            const found = await resolveViewerMention(req.params.id, mention);
            if (found.error)
                return res.status(found.status).json({ error: found.error });
            const { cwd, resolved } = found;
            const file = (0, file_mention_1.readFileForViewer)(resolved.absPath, { imageData: false });
            if ('error' in file)
                return res.status(file.status || 415).json({ error: file.error, path: resolved.absPath });
            if (file.image) {
                file.image.url = `/api/sessions/${encodeURIComponent(req.params.id)}/file/content?path=${encodeURIComponent(mention)}&v=${file.mtime}-${file.size}`;
            }
            res.json({
                path: resolved.absPath,
                relPath: cwd && resolved.absPath.startsWith(cwd + '/')
                    ? resolved.absPath.slice(cwd.length + 1) : null,
                line: resolved.line ?? null,
                ...file,
            });
        }
        catch (error) {
            res.status(500).json({ error: (0, helper_values_1.record)(error) ? error.message : undefined });
        }
    };
    function rememberDiffSnapshot(sessionId, cwd, data) {
        const { version, ...clientData } = data;
        const snapshot = {
            id: crypto.randomBytes(12).toString('hex'),
            cwd,
            at: Date.now(),
            version,
            data: clientData,
        };
        diffSnapshots.delete(sessionId);
        diffSnapshots.set(sessionId, snapshot);
        while (diffSnapshots.size > 4) {
            const oldest = diffSnapshots.keys().next();
            if (!oldest.done)
                diffSnapshots.delete(oldest.value);
        }
        return snapshot;
    }
    function staleDiffResponse(res) {
        return res.status(409).json({
            stale: true,
            error: 'The working tree changed since this diff was loaded; refresh the diff pane.',
        });
    }
    // Client paths only select entries in the captured aggregate. Preserve the
    // checks on both sides of patch generation, including already-inline patches.
    const diffPatch = async (req, res) => {
        try {
            const repoPath = String(req.query.repo || '');
            const filePath = String(req.query.path || '');
            const snapshotId = String(req.query.snapshot || '');
            if (!repoPath || !filePath || !/^[a-f0-9]{24}$/.test(snapshotId) ||
                repoPath.length > 2048 || filePath.length > 4096) {
                return res.status(400).json({ error: 'repo, path, and snapshot required' });
            }
            const cwd = ports.resolveSessionCwd(req.params.id);
            if (!cwd)
                return res.status(404).json({ error: 'Session cwd unknown' });
            const snapshot = diffSnapshots.get(req.params.id);
            if (!snapshot || snapshot.id !== snapshotId || snapshot.cwd !== cwd ||
                Date.now() - snapshot.at > DIFF_SNAPSHOT_TTL_MS)
                return staleDiffResponse(res);
            const repo = snapshot.data.repos.find(item => item.path === repoPath);
            const file = repo?.files.find(item => item.path === filePath);
            if (!repo || !file)
                return res.status(404).json({ error: 'Patch not found' });
            if (await (0, git_diff_1.getDiffVersion)(cwd) !== snapshot.version)
                return staleDiffResponse(res);
            const patch = file.patch ? file : await (0, git_diff_1.getFilePatch)(path.resolve(cwd, repo.path), file);
            if (await (0, git_diff_1.getDiffVersion)(cwd) !== snapshot.version)
                return staleDiffResponse(res);
            if (!patch?.patch)
                return res.status(404).json({ error: 'Patch not found' });
            snapshot.at = Date.now();
            diffSnapshots.delete(req.params.id);
            diffSnapshots.set(req.params.id, snapshot);
            res.json({ patch: patch.patch, truncated: !!patch.truncated, binary: !!patch.binary });
        }
        catch (error) {
            res.status(500).json({ error: (0, helper_values_1.record)(error) ? error.message : undefined });
        }
    };
    const diffSummary = async (req, res) => {
        try {
            const cwd = ports.resolveSessionCwd(req.params.id);
            if (!cwd)
                return res.status(404).json({ error: 'Session cwd unknown' });
            const data = await (0, git_diff_1.aggregateDiffs)(cwd, { inlineLimit: DIFF_INLINE_FILE_LIMIT });
            const snapshot = rememberDiffSnapshot(req.params.id, cwd, data);
            res.json({ ...snapshot.data, snapshotId: snapshot.id });
        }
        catch (error) {
            res.status(500).json({ error: (0, helper_values_1.record)(error) ? error.message : undefined });
        }
    };
    return {
        searchDirectories, directoryChildren, searchSessionFiles, fileContent,
        filePreview, diffPatch, diffSummary,
        retireSession(sessionId) { diffSnapshots.delete(sessionId); },
    };
}
