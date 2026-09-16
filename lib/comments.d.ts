// Generated from src/core/comments.ts; edit that source and run npm run build:core.
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
    state?: unknown;
}
export declare function createComment({ sessionId, body, target }: CreateCommentOptions): CommentRecord;
export declare function getComment(id: string): CommentDto | null;
export declare function listComments({ sessionId, pageToken, state }?: ListCommentsOptions): CommentDto[];
export declare function updateComment(id: string, body: string): CommentDto | null;
export declare function deleteComment(id: string): boolean;
export declare function acknowledgeComment(id: string): CommentDto | null;
