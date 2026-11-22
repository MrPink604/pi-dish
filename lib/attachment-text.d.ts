// Generated from src/core/attachment-text.ts; edit that source and run npm run build:core.
/** `912 B`, `4.2 KB`, `2.1 MB`, `730 MB`. */
export declare function formatByteSize(bytes: number): string;
/**
 * A single safe path component for an uploaded file: the basename of the
 * client-supplied name with separators, control and shell-hostile characters
 * replaced, no leading dots (never `.`, `..` or a hidden file), and at most
 * 150 UTF-8 bytes with the extension kept. Falls back to `file`.
 */
export declare function safeUploadName(name: unknown): string;
export interface StoredAttachment {
    /** Absolute path on the session's host. */
    readonly path: string;
    /** The stored basename (`safeUploadName` of the original). */
    readonly name: string;
    readonly originalName: string;
    readonly mimeType: string;
    readonly size: number;
}
/** The prompt line every harness receives for a non-image attachment. */
export declare function attachmentReference(file: StoredAttachment): string;
