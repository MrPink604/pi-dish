import type { Request, RequestHandler, Response } from 'express';
import type { ParsedQs } from 'qs';

export type ApplicationRequest = Request<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
export type ApplicationResponse = Response<unknown, Record<string, unknown>>;
export type RouteHandler = RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;

/** Express leaves parsed JSON untyped; every route body is a boundary object. */
export function requestBody(req: ApplicationRequest): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}
