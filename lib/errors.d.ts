// Generated from src/core/errors.ts; edit that source and run npm run build:core.
/** Errors carry their HTTP status as ad-hoc fields; both spellings are in use. */
export interface HttpError extends Error {
    statusCode?: number;
    status?: number;
}
export declare function errorMessage(error: unknown): string;
export declare function errorStatus(error: unknown, fallback: number): number;
export declare function httpError(message: string, statusCode: number): HttpError;
