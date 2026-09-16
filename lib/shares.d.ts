// Generated from src/core/shares.ts; edit that source and run npm run build:core.
import type { SessionId } from './contracts';
export interface SessionShareRecord {
    sessionId: SessionId;
    createdAt: number;
    kind?: never;
}
export interface HtmlShareRecord {
    kind: 'html';
    createdAt: number;
    sessionId?: never;
}
export type ShareRecord = SessionShareRecord | HtmlShareRecord;
export interface SessionShareDto {
    kind: 'session';
    sessionId: unknown;
}
export interface HtmlShareDto {
    kind: 'html';
}
export type ShareDto = SessionShareDto | HtmlShareDto;
export interface SessionShareToken {
    token: string;
}
export declare function createShare(sessionId: unknown): string;
export declare function createHtmlShare(html: string | NodeJS.ArrayBufferView): string;
export declare function revokeShare(sessionId: unknown): boolean;
export declare function getShare(token: string): ShareDto | null;
export declare function getShareForSession(sessionId: unknown): SessionShareToken | null;
export declare function getShareHtmlPath(token: string): string | null;
