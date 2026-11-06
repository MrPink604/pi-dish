// Generated from src/core/http-boundary.ts; edit that source and run npm run build:core.
import type { Request, RequestHandler, Response } from 'express';
import type { ParsedQs } from 'qs';
export type ApplicationRequest = Request<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
export type ApplicationResponse = Response<unknown, Record<string, unknown>>;
export type RouteHandler = RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
/** Express leaves parsed JSON untyped; every route body is a boundary object. */
export declare function requestBody(req: ApplicationRequest): Record<string, unknown>;
/** Errors carry their HTTP status as ad-hoc fields; both spellings are in use. */
export interface HttpError extends Error {
    statusCode?: number;
    status?: number;
}
export declare function errorMessage(error: unknown): string;
export declare function errorStatus(error: unknown, fallback: number): number;
export declare function httpError(message: string, statusCode: number): HttpError;
