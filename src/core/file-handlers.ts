import crypto = require('crypto');
import path = require('path');
import type { Request, Response, RequestHandler } from 'express';
import type { SessionSource } from './session-source-contracts';
import { record } from './helper-values';
import { searchHomeDirs, getDirChildren, isPathCompletionToken, completePath, searchFiles } from './file-search';
import { resolveFileMention, readFileForViewer } from './file-mention';
import { readSessionMessages } from './session-files';
import { aggregateDiffs, getFilePatch, getDiffVersion } from './git-diff';
import type { GitDiffAggregate } from './git-diff';

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

interface DiffSnapshot {
  id: string;
  cwd: unknown;
  at: number;
  version: GitDiffAggregate['version'];
  data: Omit<GitDiffAggregate, 'version'>;
}

const DIFF_INLINE_FILE_LIMIT = 6;
const DIFF_SNAPSHOT_TTL_MS = 60 * 1000;

export function createFileHandlers(ports: FileHandlerPorts): FileHandlers {
  const diffSnapshots = new Map<string, DiffSnapshot>();

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

  async function resolveViewerMention(sessionId: string, mention: string) {
    const cwd = ports.resolveSessionCwd(sessionId);
    const session = ports.findSessionSource(sessionId);
    if (!cwd && !session) return { error: 'Unknown session', status: 404 } as const;
    let messages: readonly unknown[] = [];
    if (session) { try { messages = readSessionMessages(session); } catch {} }
    const resolved = await resolveFileMention(mention, { cwd: cwd as string | null | undefined, messages });
    if (!resolved) return { error: `Couldn't find "${mention}" among this session's files`, status: 404 } as const;
    return { cwd, resolved };
  }

  // Both preview and raw bytes use the same session-aware reach rules.
  const fileContent: FileHandler = async (req, res) => {
    try {
      const mention = String(req.query.path || '');
      if (!mention || mention.length > 1024) return res.status(400).json({ error: 'path required' });
      const found = await resolveViewerMention(req.params.id, mention);
      if (found.error) return res.status(found.status).json({ error: found.error });
      const file = readFileForViewer(found.resolved.absPath, { imageData: false });
      if ('error' in file) return res.status(file.status || 415).json({ error: file.error, path: found.resolved.absPath });
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const safeImageMime = file.image && file.image.mimeType !== 'image/svg+xml'
        ? file.image.mimeType : 'text/plain; charset=utf-8';
      res.type(safeImageMime).sendFile(found.resolved.absPath);
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  const filePreview: FileHandler = async (req, res) => {
    try {
      const mention = String(req.query.path || '');
      if (!mention || mention.length > 1024) return res.status(400).json({ error: 'path required' });
      const found = await resolveViewerMention(req.params.id, mention);
      if (found.error) return res.status(found.status).json({ error: found.error });
      const { cwd, resolved } = found;
      const file = readFileForViewer(resolved.absPath, { imageData: false });
      if ('error' in file) return res.status(file.status || 415).json({ error: file.error, path: resolved.absPath });
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

  function rememberDiffSnapshot(sessionId: string, cwd: unknown, data: GitDiffAggregate): DiffSnapshot {
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
      if (!oldest.done) diffSnapshots.delete(oldest.value);
    }
    return snapshot;
  }

  function staleDiffResponse(res: FileResponse) {
    return res.status(409).json({
      stale: true,
      error: 'The working tree changed since this diff was loaded; refresh the diff pane.',
    });
  }

  // Client paths only select entries in the captured aggregate. Preserve the
  // checks on both sides of patch generation, including already-inline patches.
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
      const snapshot = diffSnapshots.get(req.params.id);
      if (!snapshot || snapshot.id !== snapshotId || snapshot.cwd !== cwd ||
          Date.now() - snapshot.at > DIFF_SNAPSHOT_TTL_MS) return staleDiffResponse(res);
      const repo = snapshot.data.repos.find(item => item.path === repoPath);
      const file = repo?.files.find(item => item.path === filePath);
      if (!repo || !file) return res.status(404).json({ error: 'Patch not found' });
      if (await getDiffVersion(cwd as string) !== snapshot.version) return staleDiffResponse(res);
      const patch = file.patch ? file : await getFilePatch(path.resolve(cwd as string, repo.path), file);
      if (await getDiffVersion(cwd as string) !== snapshot.version) return staleDiffResponse(res);
      if (!patch?.patch) return res.status(404).json({ error: 'Patch not found' });
      snapshot.at = Date.now();
      diffSnapshots.delete(req.params.id);
      diffSnapshots.set(req.params.id, snapshot);
      res.json({ patch: patch.patch, truncated: !!patch.truncated, binary: !!patch.binary });
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  const diffSummary: FileHandler = async (req, res) => {
    try {
      const cwd = ports.resolveSessionCwd(req.params.id);
      if (!cwd) return res.status(404).json({ error: 'Session cwd unknown' });
      const data = await aggregateDiffs(cwd as string, { inlineLimit: DIFF_INLINE_FILE_LIMIT });
      const snapshot = rememberDiffSnapshot(req.params.id, cwd, data);
      res.json({ ...snapshot.data, snapshotId: snapshot.id });
    } catch (error) {
      res.status(500).json({ error: record(error) ? error.message : undefined });
    }
  };

  return {
    searchDirectories, directoryChildren, searchSessionFiles, fileContent,
    filePreview, diffPatch, diffSummary,
    retireSession(sessionId) { diffSnapshots.delete(sessionId); },
  };
}
