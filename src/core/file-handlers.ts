import type { Request, Response, RequestHandler } from 'express';
import type { SessionSource } from './session-source-contracts';
import { record } from './helper-values';
import { searchHomeDirs, getDirChildren, isPathCompletionToken, completePath, searchFiles } from './file-search';
import { resolveFileMention, readFileForViewer } from './file-mention';
import { readSessionMessages } from './session-files';
import { createDiffView } from './git-diff';

type FileRequest = Request<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
type FileResponse = Response<unknown, Record<string, unknown>>;
type FileHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;

export interface FileHandlerPorts {
  resolveSessionCwd(sessionId: string): unknown;
  findSessionSource(sessionId: string): SessionSource | null;
}

export interface FileHandlers {
  searchDirectories: FileHandler;
  directoryChildren: FileHandler;
  searchSessionFiles: FileHandler;
  fileContent: FileHandler;
  filePreview: FileHandler;
  diffPatch: FileHandler;
  diffSummary: FileHandler;
  retireSession(sessionId: string): void;
}

export function createFileHandlers(ports: FileHandlerPorts): FileHandlers {
  const diffView = createDiffView();

  const searchDirectories: FileHandler = (req, res) => {
    try {
      res.json(searchHomeDirs(String(req.query.q || ''), 15));
    } catch {
      res.status(500).json([]);
    }
  };

  const directoryChildren: FileHandler = (req, res) => {
    try {
      res.json(getDirChildren(String(req.query.path || '')));
    } catch (error) {
      const fields = record(error) ? error : {};
      if (fields.badRequest) return res.status(400).json({ error: fields.message });
      res.status(500).json({ error: fields.message });
    }
  };

  const searchSessionFiles: FileHandler = async (req, res) => {
    try {
      const q = String(req.query.q || '');
      const cwd = ports.resolveSessionCwd(req.params.id);
      if (isPathCompletionToken(q)) {
        return res.json({ cwd, files: completePath(q, { cwd: cwd as string | null | undefined, limit: 20 }) });
      }
      if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
      const files = await searchFiles(cwd as string, q, 20);
      res.json({ cwd, files });
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  async function prepareViewerFile(req: FileRequest) {
    const mention = String(req.query.path || '');
    if (!mention || mention.length > 1024) {
      return { status: 400, body: { error: 'path required' } } as const;
    }
    const sessionId = req.params.id;
    const cwd = ports.resolveSessionCwd(sessionId);
    const session = ports.findSessionSource(sessionId);
    if (!cwd && !session) return { status: 404, body: { error: 'Unknown session' } } as const;
    let messages: readonly unknown[] = [];
    if (session) { try { messages = readSessionMessages(session); } catch {} }
    const resolved = await resolveFileMention(mention, { cwd: cwd as string | null | undefined, messages });
    if (!resolved) {
      return { status: 404, body: { error: `Couldn't find "${mention}" among this session's files` } } as const;
    }
    const file = readFileForViewer(resolved.absPath, { imageData: false });
    if ('error' in file) {
      return { status: file.status || 415, body: { error: file.error, path: resolved.absPath } } as const;
    }
    return { cwd, resolved, mention, file };
  }

  // Both preview and raw bytes use the same session-aware reach rules.
  const fileContent: FileHandler = async (req, res) => {
    try {
      const prepared = await prepareViewerFile(req);
      if (prepared.status !== undefined) return res.status(prepared.status).json(prepared.body);
      const { resolved, file } = prepared;
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const safeImageMime = file.image && file.image.mimeType !== 'image/svg+xml'
        ? file.image.mimeType : 'text/plain; charset=utf-8';
      res.type(safeImageMime).sendFile(resolved.absPath);
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  const filePreview: FileHandler = async (req, res) => {
    try {
      const prepared = await prepareViewerFile(req);
      if (prepared.status !== undefined) return res.status(prepared.status).json(prepared.body);
      const { cwd, resolved, mention, file } = prepared;
      if (file.image) {
        file.image.url = `/api/sessions/${encodeURIComponent(req.params.id)}/file/content?path=${encodeURIComponent(mention)}&v=${file.mtime}-${file.size}`;
      }
      res.json({
        path: resolved.absPath,
        relPath: cwd && resolved.absPath.startsWith((cwd as string) + '/')
          ? resolved.absPath.slice((cwd as string).length + 1) : null,
        line: resolved.line ?? null,
        ...file,
      });
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  function staleDiffResponse(res: FileResponse) {
    return res.status(409).json({
      stale: true,
      error: 'The working tree changed since this diff was loaded; refresh the diff pane.',
    });
  }

  const diffPatch: FileHandler = async (req: FileRequest, res: FileResponse) => {
    try {
      const repoPath = String(req.query.repo || '');
      const filePath = String(req.query.path || '');
      const snapshotId = String(req.query.snapshot || '');
      if (!repoPath || !filePath || !/^[a-f0-9]{24}$/.test(snapshotId) ||
          repoPath.length > 2048 || filePath.length > 4096) {
        return res.status(400).json({ error: 'repo, path, and snapshot required' });
      }
      const cwd = ports.resolveSessionCwd(req.params.id);
      if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
      const patch = await diffView.patch(req.params.id, cwd, snapshotId, repoPath, filePath);
      if (patch === 'stale') return staleDiffResponse(res);
      if (!patch) return res.status(404).json({ error: 'Patch not found' });
      res.json(patch);
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  const diffSummary: FileHandler = async (req, res) => {
    try {
      const cwd = ports.resolveSessionCwd(req.params.id);
      if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
      res.json(await diffView.summary(req.params.id, cwd));
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  return {
    searchDirectories, directoryChildren, searchSessionFiles, fileContent,
    filePreview, diffPatch, diffSummary,
    retireSession: diffView.retireSession,
  };
}
