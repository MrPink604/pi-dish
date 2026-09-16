/**
 * Anchored review comments from file, diff and published-page views.
 * Reads never acknowledge; acknowledged comments cannot be edited or deleted.
 * Storage re-reads HOME per operation and uses dish-store's atomic replacement.
 */
import crypto = require('crypto');
import { readStore, writeStore } from './dish-store';
import { canonicalSessionId } from './session-key';
import type { SessionId } from './contracts';

export interface CommentAnchor {
  type: 'lines' | 'text';
  quote?: string;
  prefix?: string;
  suffix?: string;
  startLine?: number;
  endLine?: number;
  oldStart?: number;
  oldEnd?: number;
  newStart?: number;
  newEnd?: number;
}

export interface FileCommentTarget {
  kind: 'file';
  path: string;
  relPath?: string | null;
  anchor: CommentAnchor;
}

export interface DiffCommentTarget {
  kind: 'diff';
  repo: string;
  path: string;
  oldPath?: string | null;
  anchor: CommentAnchor;
}

export interface PageCommentTarget {
  kind: 'page';
  pageToken: string;
  // These are copied from the page store, not newly validated by comments.
  root: unknown;
  title: unknown;
  anchor: CommentAnchor;
}

export type CommentTarget = FileCommentTarget | DiffCommentTarget | PageCommentTarget;

export interface CreateCommentOptions {
  sessionId: unknown;
  body: string;
  target: CommentTarget;
}

/** Newly constructed persistence record; disk ingress is not this type. */
export interface CommentRecord {
  id: string;
  sessionId: SessionId;
  body: string;
  target: CommentTarget;
  createdAt: number;
  acknowledgedAt: number | null;
  updatedAt?: number;
}

/** Legacy reads retain all fields without claiming their contents are valid. */
export interface CommentDto extends Record<string, unknown> {
  id?: unknown;
  sessionId: unknown;
  body?: unknown;
  target?: unknown;
  createdAt?: unknown;
  acknowledgedAt?: unknown;
  updatedAt?: unknown;
}

export interface ListCommentsOptions {
  sessionId?: unknown;
  pageToken?: unknown;
  // Historically any value other than 'all'/'acknowledged' selects open.
  state?: unknown;
}

// Preserve JS access/spread for primitive legacy rows; all members stay unknown.
function fields(value: unknown): Record<string, unknown> {
  return Object(value) as Record<string, unknown>;
}

function canonical(value: unknown): unknown {
  try { return canonicalSessionId(value); } catch { return value; }
}

function readComments(): Record<string, unknown> {
  return readStore('comments.json');
}

function writeComments(comments: Record<string, unknown>): void {
  writeStore('comments.json', comments);
}

export function createComment({ sessionId, body, target }: CreateCommentOptions): CommentRecord {
  const canonicalId = canonicalSessionId(sessionId);
  const comments = readComments();
  const id = crypto.randomBytes(9).toString('base64url');
  const comment: CommentRecord = {
    id,
    sessionId: canonicalId,
    body,
    target,
    createdAt: Date.now(),
    acknowledgedAt: null,
  };
  comments[id] = comment;
  writeComments(comments);
  return comment;
}

export function getComment(id: string): CommentDto | null {
  const comment = readComments()[id];
  return comment ? { ...fields(comment), sessionId: canonical(fields(comment).sessionId) } : null;
}

export function listComments({ sessionId = null, pageToken = null, state = 'open' }: ListCommentsOptions = {}): CommentDto[] {
  if (sessionId) sessionId = canonical(sessionId);
  return Object.values(readComments())
    .filter((comment) => comment && fields(comment).id)
    .map((comment): CommentDto => ({ ...fields(comment), sessionId: canonical(fields(comment).sessionId) }))
    .filter((comment) => !sessionId || comment.sessionId === sessionId)
    .filter((comment) => !pageToken || fields(comment.target).pageToken === pageToken)
    .filter((comment) => state === 'all'
      || (state === 'acknowledged' ? !!comment.acknowledgedAt : !comment.acknowledgedAt))
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

// Open comments are still draft feedback. Acknowledged comments are the agent's
// record of what it was told: editing/deleting them would rewrite that history.
export function updateComment(id: string, body: string): CommentDto | null {
  const comments = readComments();
  const comment = comments[id];
  if (!comment || fields(comment).acknowledgedAt) return null;
  // The old non-strict JS silently ignored writes to primitive legacy rows.
  // Do not turn those writes into strict-mode TypeErrors or persisted objects.
  if (typeof comment === 'object' || typeof comment === 'function') fields(comment).body = body;
  const updatedAt = Date.now();
  if (typeof comment === 'object' || typeof comment === 'function') fields(comment).updatedAt = updatedAt;
  writeComments(comments);
  return { ...fields(comment), sessionId: canonical(fields(comment).sessionId) };
}

export function deleteComment(id: string): boolean {
  const comments = readComments();
  const comment = comments[id];
  if (!comment || fields(comment).acknowledgedAt) return false;
  delete comments[id];
  writeComments(comments);
  return true;
}

export function acknowledgeComment(id: string): CommentDto | null {
  const comments = readComments();
  const comment = comments[id];
  if (!comment) return null;
  if (!fields(comment).acknowledgedAt) {
    const acknowledgedAt = Date.now();
    if (typeof comment === 'object' || typeof comment === 'function') fields(comment).acknowledgedAt = acknowledgedAt;
  }
  writeComments(comments);
  return { ...fields(comment), sessionId: canonical(fields(comment).sessionId) };
}
