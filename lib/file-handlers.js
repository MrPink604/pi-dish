// Generated from src/core/file-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFileHandlers = createFileHandlers;
const helper_values_1 = require("./helper-values");
const file_search_1 = require("./file-search");
const file_mention_1 = require("./file-mention");
const session_files_1 = require("./session-files");
const git_diff_1 = require("./git-diff");
function createFileHandlers(ports) {
    const diffView = (0, git_diff_1.createDiffView)();
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
    async function prepareViewerFile(req) {
        const mention = String(req.query.path || '');
        if (!mention || mention.length > 1024) {
            return { status: 400, body: { error: 'path required' } };
        }
        const sessionId = req.params.id;
        const cwd = ports.resolveSessionCwd(sessionId);
        const session = ports.findSessionSource(sessionId);
        if (!cwd && !session)
            return { status: 404, body: { error: 'Unknown session' } };
        let messages = [];
        if (session) {
            try {
                messages = (0, session_files_1.readSessionMessages)(session);
            }
            catch { }
        }
        const resolved = await (0, file_mention_1.resolveFileMention)(mention, { cwd: cwd, messages });
        if (!resolved) {
            return { status: 404, body: { error: `Couldn't find "${mention}" among this session's files` } };
        }
        const file = (0, file_mention_1.readFileForViewer)(resolved.absPath, { imageData: false });
        if ('error' in file) {
            return { status: file.status || 415, body: { error: file.error, path: resolved.absPath } };
        }
        return { cwd, resolved, mention, file };
    }
    // Both preview and raw bytes use the same session-aware reach rules.
    const fileContent = async (req, res) => {
        try {
            const prepared = await prepareViewerFile(req);
            if (prepared.status !== undefined)
                return res.status(prepared.status).json(prepared.body);
            const { resolved, file } = prepared;
            res.setHeader('Cache-Control', 'private, no-cache');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            const safeImageMime = file.image && file.image.mimeType !== 'image/svg+xml'
                ? file.image.mimeType : 'text/plain; charset=utf-8';
            res.type(safeImageMime).sendFile(resolved.absPath);
        }
        catch (error) {
            res.status(500).json({ error: (0, helper_values_1.record)(error) ? error.message : undefined });
        }
    };
    const filePreview = async (req, res) => {
        try {
            const prepared = await prepareViewerFile(req);
            if (prepared.status !== undefined)
                return res.status(prepared.status).json(prepared.body);
            const { cwd, resolved, mention, file } = prepared;
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
    function staleDiffResponse(res) {
        return res.status(409).json({
            stale: true,
            error: 'The working tree changed since this diff was loaded; refresh the diff pane.',
        });
    }
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
            const patch = await diffView.patch(req.params.id, cwd, snapshotId, repoPath, filePath);
            if (patch === 'stale')
                return staleDiffResponse(res);
            if (!patch)
                return res.status(404).json({ error: 'Patch not found' });
            res.json(patch);
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
            res.json(await diffView.summary(req.params.id, cwd));
        }
        catch (error) {
            res.status(500).json({ error: (0, helper_values_1.record)(error) ? error.message : undefined });
        }
    };
    return {
        searchDirectories, directoryChildren, searchSessionFiles, fileContent,
        filePreview, diffPatch, diffSummary,
        retireSession: diffView.retireSession,
    };
}
