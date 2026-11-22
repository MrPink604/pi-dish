// Generated from src/core/upload-handlers.ts; edit that source and run npm run build:core.
import { type RouteHandler } from './http-boundary';
export declare const DEFAULT_UPLOAD_MAX_MB = 512;
/** `PI_DISH_UPLOAD_MAX_MB` (default 512), in bytes. */
export declare function uploadMaxBytes(env?: NodeJS.ProcessEnv): number;
/**
 * One directory per session route: `<harness>-<native id>` reduced to
 * `[A-Za-z0-9_-]`, so no route can name `.`/`..` or a separator. Null for an
 * invalid route.
 */
export declare function sessionUploadDir(root: string, sessionId: string): string | null;
export interface UploadPorts {
    /** Parent of every session's upload directory (`~/.pi/dish/uploads`). */
    root(): string;
    maxBytes(): number;
}
/**
 * Non-image composer attachments. The body streams straight to disk on the
 * session's host and the reply carries the prompt line naming the stored file;
 * images keep riding `/prompt` as content blocks.
 */
export declare function createUploadHandlers(ports: UploadPorts): {
    limits: RouteHandler;
    upload: RouteHandler;
    removeSession(sessionId: string): void;
};
