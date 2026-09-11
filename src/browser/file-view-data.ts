import { record, finite } from './helper-values';
const text = (v: unknown) => typeof v === 'string' ? v : '';
const number = (v: unknown) => finite(v) ? v : 0;
export interface FilePreview {
  readonly path: string; readonly relPath: string; readonly content: string; readonly size: number; readonly mtime: number; readonly truncated: boolean;
  readonly image: { readonly url: string; readonly mimeType: string; readonly data: string } | null;
}
export interface DiffFile { readonly path: string; readonly oldPath: string; readonly status: string; readonly additions: number; readonly deletions: number; readonly binary: boolean; readonly truncated: boolean; readonly patch: string; readonly patchDeferred: boolean }
export interface DiffRepo { readonly path: string; readonly branch: string; readonly ahead: number; readonly behind: number; readonly additions: number; readonly deletions: number; readonly error: string; readonly moreUntracked: number; readonly files: readonly DiffFile[] }
export interface DiffView { readonly root: string; readonly gitAvailable: boolean; readonly snapshotId: string; readonly repos: readonly DiffRepo[] }
export function decodeFilePreview(v: unknown): FilePreview {
  if (!record(v) || typeof v.path !== 'string' || !v.path) throw new Error('Invalid file preview');
  return { path: v.path, relPath: text(v.relPath), content: text(v.content), size: number(v.size), mtime: number(v.mtime), truncated: v.truncated === true,
    image: record(v.image) ? { url: text(v.image.url), mimeType: text(v.image.mimeType), data: text(v.image.data) } : null };
}
export function decodeDiffView(v: unknown): DiffView {
  if (!record(v) || !Array.isArray(v.repos)) throw new Error('Invalid diff response');
  return { root: text(v.root), gitAvailable: v.gitAvailable === true, snapshotId: text(v.snapshotId), repos: v.repos.flatMap((r: unknown) => record(r) && typeof r.path === 'string' ? [{
    path: r.path, branch: text(r.branch), ahead: number(r.ahead), behind: number(r.behind), additions: number(r.additions), deletions: number(r.deletions), error: text(r.error), moreUntracked: number(r.moreUntracked),
    files: Array.isArray(r.files) ? r.files.flatMap((f: unknown) => record(f) && typeof f.path === 'string' ? [{ path: f.path, oldPath: text(f.oldPath), status: text(f.status), additions: number(f.additions), deletions: number(f.deletions), binary: f.binary === true, truncated: f.truncated === true, patch: text(f.patch), patchDeferred: f.patchDeferred === true }] : []) : [],
  }] : []) };
}
export function decodeDiffPatch(v: unknown) { const p = record(v) ? v : {}; return { patch: text(p.patch), stale: p.stale === true, truncated: p.truncated === true }; }
