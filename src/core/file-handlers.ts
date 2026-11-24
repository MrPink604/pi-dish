import type { Request, Response, RequestHandler } from 'express';
import type { SessionSource } from './session-source';
import { record } from './helper-values';
import { searchHomeDirs, getDirChildren, isPathCompletionToken, completePath, searchFiles } from './file-search';
import { resolveFileMention, readFileForViewer, readFileForContent } from './file-mention';
import { sendRangedFile } from './range-response';
import { agyBrainDir, readAgyBrainArtifactMeta } from './agy-brain';
import { readSessionMessages } from './session-files';
import { createDiffView } from './git-diff';
import { sessionUploadDir } from './upload-handlers';

type FileRequest = Request<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
type FileResponse = Response<unknown, Record<string, unknown>>;
type FileHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;

export interface FileHandlerPorts {
  resolveSessionCwd(sessionId: string): unknown;
  findSessionSource(sessionId: string): SessionSource | null;
  uploadRoot(): string;
}

export interface FileHandlers {
  searchDirectories: FileHandler;
  directoryChildren: FileHandler;
  searchSessionFiles: FileHandler;
  fileContent: FileHandler;
  filePreview: FileHandler;
  diffPatch: FileHandler;
  diffSummary: FileHandler;
  /**
   * A path as the session's file viewer reaches it (cwd, files its tools
   * touched, agy brain, uploads); null when the session is unknown or the
   * path is outside its reach.
   */
  resolveSessionFile(sessionId: string, mention: string): Promise<string | null>;
  retireSession(sessionId: string): void;
}

export function createFileHandlers(ports: FileHandlerPorts): FileHandlers {
  const diffView = createDiffView();
  const sessionCwd = (sessionId: string): string | null => {
    const cwd = ports.resolveSessionCwd(sessionId);
    return typeof cwd === 'string' && cwd ? cwd : null;
  };

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
      const cwd = sessionCwd(req.params.id);
      if (isPathCompletionToken(q)) {
        return res.json({ cwd, files: completePath(q, { cwd, limit: 20 }) });
      }
      if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
      const files = await searchFiles(cwd, q, 20);
      res.json({ cwd, files });
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  /** null: the session is unknown. */
  async function resolveMention(sessionId: string, mention: string) {
    const cwd = sessionCwd(sessionId);
    const session = ports.findSessionSource(sessionId);
    if (!cwd && !session) return null;
    let messages: readonly unknown[] = [];
    if (session) { try { messages = readSessionMessages(session); } catch {} }
    const extraRoots: Array<{ root: string; denySubdirs?: readonly string[] }> = [];
    const brainRoot = session?.harnessId === 'agy' ? agyBrainDir(session.nativeSessionId) : null;
    if (brainRoot) extraRoots.push({ root: brainRoot, denySubdirs: ['.system_generated'] });
    const uploadDir = sessionUploadDir(ports.uploadRoot(), sessionId);
    if (uploadDir) extraRoots.push({ root: uploadDir });
    const resolved = await resolveFileMention(mention, { cwd, messages, extraRoots: extraRoots.length ? extraRoots : undefined });
    return { cwd, session, resolved };
  }

  async function resolveRequestFile(req: FileRequest) {
    const mention = String(req.query.path || '');
    if (!mention || mention.length > 1024) {
      return { status: 400, body: { error: 'path required' } } as const;
    }
    const reach = await resolveMention(req.params.id, mention);
    if (!reach) return { status: 404, body: { error: 'Unknown session' } } as const;
    const { cwd, session, resolved } = reach;
    if (!resolved) {
      return { status: 404, body: { error: `Couldn't find "${mention}" among this session's files` } } as const;
    }
    return { cwd, session, resolved, mention };
  }

  // Both preview and raw bytes use the same session-aware reach rules.
  const fileContent: FileHandler = async (req, res) => {
    try {
      const target = await resolveRequestFile(req);
      if (target.status !== undefined) return res.status(target.status).json(target.body);
      const { resolved } = target;
      const content = readFileForContent(resolved.absPath);
      if ('error' in content) {
        return res.status(content.status || 415).json({ error: content.error, path: resolved.absPath });
      }
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      sendRangedFile(req, res, resolved.absPath, { mimeType: content.mimeType, size: content.size, mtimeMs: content.mtime });
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  const filePreview: FileHandler = async (req, res) => {
    try {
      const target = await resolveRequestFile(req);
      if (target.status !== undefined) return res.status(target.status).json(target.body);
      const { cwd, session, resolved, mention } = target;
      const file = readFileForViewer(resolved.absPath, { imageData: false });
      if ('error' in file) {
        return res.status(file.status || 415).json({ error: file.error, path: resolved.absPath });
      }
      const artifact = session?.harnessId === 'agy'
        ? readAgyBrainArtifactMeta(session.nativeSessionId, resolved.absPath)
        : null;
      if (file.image) {
        file.image.url = `/api/sessions/${encodeURIComponent(req.params.id)}/file/content?path=${encodeURIComponent(mention)}&v=${file.mtime}-${file.size}`;
      } else if (file.video) {
        file.video.url = `/api/sessions/${encodeURIComponent(req.params.id)}/file/content?path=${encodeURIComponent(mention)}&v=${file.mtime}-${file.size}`;
      } else if (file.model) {
        file.model.url = `/api/sessions/${encodeURIComponent(req.params.id)}/file/content?path=${encodeURIComponent(mention)}&v=${file.mtime}-${file.size}`;
      }
      res.json({
        path: resolved.absPath,
        relPath: cwd && resolved.absPath.startsWith(cwd + '/')
          ? resolved.absPath.slice(cwd.length + 1) : null,
        line: resolved.line ?? null,
        ...(artifact ? { artifact: { requestFeedback: artifact.requestFeedback, summary: artifact.summary, artifactType: artifact.artifactType } } : {}),
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
      const cwd = sessionCwd(req.params.id);
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
      const cwd = sessionCwd(req.params.id);
      if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
      res.json(await diffView.summary(req.params.id, cwd));
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  return {
    searchDirectories, directoryChildren, searchSessionFiles, fileContent,
    filePreview, diffPatch, diffSummary,
    resolveSessionFile: async (sessionId, mention) => (await resolveMention(sessionId, mention))?.resolved?.absPath ?? null,
    retireSession: diffView.retireSession,
  };
}
