import { record as isRecord } from './helper-values';
import type { Request, RequestHandler, Response } from 'express';
import type { ParsedQs } from 'qs';

export type ApplicationRequest = Request<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
export type ApplicationResponse = Response<unknown, Record<string, unknown>>;
export type RouteHandler = RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;

/** Express leaves parsed JSON untyped; every route body is a boundary object. */
export function requestBody(req: { body?: unknown }): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

/** Errors carry their HTTP status as ad-hoc fields; both spellings are in use. */
export interface HttpError extends Error {
  statusCode?: number;
  status?: number;
}

export function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}

export function errorStatus(error: unknown, fallback: number): number {
  if (isRecord(error)) {
    if (typeof error.statusCode === 'number') return error.statusCode;
    if (typeof error.status === 'number') return error.status;
  }
  return fallback;
}

export function httpError(message: string, statusCode: number): HttpError {
  return Object.assign(new Error(message), { statusCode });
}
