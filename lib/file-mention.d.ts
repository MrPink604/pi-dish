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
/** Strips quotes/brackets, trailing punctuation, a leading @, and a trailing :line[:col] (returned separately); expands ~. */
export declare function normalizeMention(raw: unknown, home: string): NormalizedMention;
/** Includes each file arg's dirname so siblings resolve. Values are last message index, for recency. */
export declare function extractSessionPaths(messages: readonly unknown[], cwd: string | null | undefined, home?: string): Map<string, number>;
export declare function resolveFileMention(rawMention: unknown, { cwd, messages, home }: FileMentionContext): Promise<ResolvedFileMention | null>;
/** Base64 is the default for library callers; HTTP routes opt into no bytes or a Buffer. */
export declare function readFileForViewer(absPath: string, { imageData }?: FileViewerOptions): FileViewerResult;
