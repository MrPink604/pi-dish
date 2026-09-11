import { record } from './helper-values';
export interface CommentAnchor { readonly type: 'text' | 'lines'; readonly quote: string; readonly prefix?: string; readonly suffix?: string; readonly startLine?: number; readonly endLine?: number; readonly oldStart?: number; readonly oldEnd?: number; readonly newStart?: number; readonly newEnd?: number }
export type CommentTarget = { readonly kind: 'file'; readonly path: string; readonly relPath: string | null; readonly anchor: CommentAnchor } | { readonly kind: 'diff'; readonly repo: string; readonly path: string; readonly oldPath: string | null; readonly anchor: CommentAnchor };
export interface AnchoredComment { readonly id: string; readonly sessionId: string; readonly body: string; readonly target: CommentTarget }
export interface CommentDraft { readonly sessionId: string; readonly quote: string; readonly target: CommentTarget }
const text = (v: unknown) => typeof v === 'string' ? v : '';
export function decodeCommentTarget(v: unknown): CommentTarget | null {
  if (!record(v) || (v.kind !== 'file' && v.kind !== 'diff') || typeof v.path !== 'string') return null;
  const a = record(v.anchor) ? v.anchor : {};
  const positions: Partial<Record<'startLine' | 'endLine' | 'oldStart' | 'oldEnd' | 'newStart' | 'newEnd', number>> = {};
  for (const key of ['startLine', 'endLine', 'oldStart', 'oldEnd', 'newStart', 'newEnd'] as const) if (typeof a[key] === 'number' && Number.isInteger(a[key]) && a[key] > 0) positions[key] = a[key];
  const anchor: CommentAnchor = { type: a.type === 'lines' ? 'lines' : 'text', quote: text(a.quote), prefix: text(a.prefix), suffix: text(a.suffix), ...positions };
  return v.kind === 'file' ? { kind: 'file', path: v.path, relPath: typeof v.relPath === 'string' ? v.relPath : null, anchor }
    : typeof v.repo === 'string' ? { kind: 'diff', repo: v.repo, path: v.path, oldPath: typeof v.oldPath === 'string' ? v.oldPath : null, anchor } : null;
}
export function decodeAnchoredComments(value: unknown): readonly AnchoredComment[] {
  return Array.isArray(value) ? value.flatMap((v: unknown) => {
    if (!record(v) || typeof v.id !== 'string' || typeof v.sessionId !== 'string' || typeof v.body !== 'string') return [];
    const target = decodeCommentTarget(v.target); return target ? [{ id: v.id, sessionId: v.sessionId, body: v.body, target }] : [];
  }) : [];
}
export function decodeCommentIndex(value: unknown) {
  return record(value) && Array.isArray(value.comments) ? value.comments.flatMap((v: unknown) => {
    if (!record(v) || typeof v.id !== 'string') return [];
    const target = decodeCommentTarget(v.target); return target ? [{ id: v.id, target }] : [];
  }) : [];
}
