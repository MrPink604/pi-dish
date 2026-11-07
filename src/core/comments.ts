/**
 * Anchored review comments from file, diff and published-page views.
 * Reads never acknowledge; acknowledged comments cannot be edited or deleted.
 * Storage re-reads HOME per operation and uses dish-store's atomic replacement.
 */
import crypto = require('crypto');
import { readStore, writeStore } from './dish-store';
import { asRecord } from './wire-protocol';
import { canonicalSessionId, tryCanonicalSessionId as canonical } from './session-key';
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

// Stored rows are external; members stay unknown until the route validates them.
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
  return comment ? { ...asRecord(comment), sessionId: canonical(asRecord(comment).sessionId) } : null;
}

export function listComments({ sessionId = null, pageToken = null, state = 'open' }: ListCommentsOptions = {}): CommentDto[] {
  if (sessionId) sessionId = canonical(sessionId);
  return Object.values(readComments())
    .filter((comment) => comment && asRecord(comment).id)
    .map((comment): CommentDto => ({ ...asRecord(comment), sessionId: canonical(asRecord(comment).sessionId) }))
    .filter((comment) => !sessionId || comment.sessionId === sessionId)
    .filter((comment) => !pageToken || asRecord(comment.target).pageToken === pageToken)
    .filter((comment) => state === 'all'
      || (state === 'acknowledged' ? !!comment.acknowledgedAt : !comment.acknowledgedAt))
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

// Open comments are still draft feedback. Acknowledged comments are the agent's
// record of what it was told: editing/deleting them would rewrite that history.
export function updateComment(id: string, body: string): CommentDto | null {
  const comments = readComments();
  const comment = asRecord(comments[id]);
  if (!comments[id] || comment.acknowledgedAt) return null;
  comment.body = body;
  comment.updatedAt = Date.now();
  comments[id] = comment;
  writeComments(comments);
  return { ...comment, sessionId: canonical(comment.sessionId) };
}

export function deleteComment(id: string): boolean {
  const comments = readComments();
  if (!comments[id] || asRecord(comments[id]).acknowledgedAt) return false;
  delete comments[id];
  writeComments(comments);
  return true;
}

export function acknowledgeComment(id: string): CommentDto | null {
  const comments = readComments();
  const comment = asRecord(comments[id]);
  if (!comments[id]) return null;
  if (!comment.acknowledgedAt) {
    comment.acknowledgedAt = Date.now();
    comments[id] = comment;
  }
  writeComments(comments);
  return { ...comment, sessionId: canonical(comment.sessionId) };
}
