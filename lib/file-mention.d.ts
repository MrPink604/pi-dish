// Generated from src/core/file-mention.ts; edit that source and run npm run build:core.
export interface FileMentionContext {
    cwd?: string | null;
    messages?: readonly unknown[] | null;
    home?: string;
}
export interface NormalizedMention {
    mention: string;
    line: number | null;
}
export interface ResolvedFileMention {
    absPath: string;
    line: number | null;
}
export interface FileViewerImageData {
    mimeType: string;
    data?: string;
    buffer?: Buffer;
    url?: string;
}
export interface FileViewerText {
    content: string;
    truncated: boolean;
    size: number;
    mtime: number;
    image?: never;
}
export interface FileViewerImage {
    image: FileViewerImageData;
    size: number;
    mtime: number;
    content?: never;
    truncated?: never;
}
export interface FileViewerError {
    error: string;
    status: 413 | 415;
}
export type FileViewerFile = FileViewerText | FileViewerImage;
export type FileViewerResult = FileViewerFile | FileViewerError;
export interface FileViewerOptions {
    imageData?: 'base64' | 'buffer' | false;
}
/**
 * Clean a chat-mentioned path: surrounding quotes/brackets, trailing
 * sentence punctuation, a trailing :line[:col] (returned separately), a
 * leading @ (the composer's mention form), ~ expansion.
 */
export declare function normalizeMention(raw: unknown, home: string): NormalizedMention;
/**
 * Every absolute path a session's tool calls referenced (plus the dirname of
 * each structured file arg, so siblings of a written file resolve too).
 * Returns Map<absPath, lastMessageIndex> — recency for ranking.
 */
export declare function extractSessionPaths(messages: readonly unknown[], cwd: string | null | undefined, home?: string): Map<string, number>;
/**
 * Resolve a mention to an existing, allowed file. Returns
 * { absPath, line } or null. See the module doc for the strategy.
 */
export declare function resolveFileMention(rawMention: unknown, { cwd, messages, home }: FileMentionContext): Promise<ResolvedFileMention | null>;
/**
 * Read a resolved file for the viewer: text (capped, with a truncated flag),
 * or image metadata plus optional base64/buffer bytes. Binary non-images get
 * { error, status }. Base64 stays the default for direct library callers;
 * HTTP metadata and resource routes opt into no bytes / Buffer respectively.
 */
export declare function readFileForViewer(absPath: string, { imageData }?: FileViewerOptions): FileViewerResult;
