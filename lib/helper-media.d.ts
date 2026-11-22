// Generated from src/core/helper-media.ts; edit that source and run npm run build:core.
export declare const IMAGE_MIME_BY_EXT: Readonly<Record<string, string>>;
export declare const VIDEO_MIME_BY_EXT: Readonly<Record<string, string>>;
/** Return the video MIME type for a path or URL with a supported video extension, else null. */
export declare function videoMimeForPath(rawPath: unknown): string | null;
export declare function isVideoPath(rawPath: unknown): boolean;
export declare function isVideoMimeType(mimeType: unknown): mimeType is string;
export declare function mediaFileName(rawPath: unknown, fallback?: string): string;
/** Shared native disclosure for app and standalone file previews. */
export declare function renderVideoSummary(fileName: string, detail?: string): string;
export declare function formatMediaSize(bytes: number): string;
