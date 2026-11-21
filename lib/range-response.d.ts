// Generated from src/core/range-response.ts; edit that source and run npm run build:core.
import type { IncomingMessage } from 'http';
import type { Response } from 'express';
export interface ByteRange {
    readonly start: number;
    readonly end: number;
}
export type ParsedByteRange = ByteRange | 'unsatisfiable' | null;
/**
 * Parse a single `bytes=` Range header per RFC 9110 §14.1.2.
 * Returns `null` when absent, non-bytes, multi-range, or syntactically invalid
 * (callers serve 200 OK), `'unsatisfiable'` for valid out-of-bounds ranges
 * (callers serve 416), or `{ start, end }` inclusive bounds.
 */
export declare function parseByteRange(rangeHeader: string | readonly string[] | undefined, size: number): ParsedByteRange;
export interface RangedFileOptions {
    readonly mimeType: string;
    readonly size: number;
    readonly mtimeMs: number;
    readonly onError?: (err: Error) => void;
}
export declare function sendRangedFile(req: IncomingMessage, res: Response, absPath: string, options: RangedFileOptions): void;
export declare function sendRangedBuffer(req: IncomingMessage, res: Response, buffer: Buffer, options: {
    readonly mimeType: string;
}): void;
