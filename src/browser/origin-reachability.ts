import { ApiHttpError, type ApiRequest } from './api-client';

export type OriginFailure = 'auth' | 'network' | 'server';

function classifyStatus(status: number): OriginFailure | null {
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500 && status < 600) return 'server';
  return null;
}

export function classifyOriginResponse(response: Response, origin: string): OriginFailure | null {
  if (response.type === 'opaqueredirect' || response.type === 'opaque' || response.redirected
      || (response.url && new URL(response.url).origin !== origin)) return 'auth';
  if (response.type === 'error') return 'network';
  if (/^(?:text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get('content-type') ?? '')) return 'auth';
  return classifyStatus(response.status);
}

class OriginResponseError extends Error {
  constructor(readonly failure: OriginFailure, status: number) {
    super(status ? `Unexpected origin response (HTTP ${status})` : 'Opaque origin response');
  }
}

export function classifyOriginError(error: unknown): OriginFailure | null {
  if (error instanceof OriginResponseError) return error.failure;
  if (error instanceof ApiHttpError) return classifyStatus(error.status);
  // Fetch hides the cause of a rejected request, including an Access CORS
  // rejection. Treat the ambiguous TypeError as possible lost sign-in.
  if (error instanceof TypeError) return 'auth';
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'TimeoutError') return 'network';
  return null;
}

/** Only for same-origin API calls; peer requests keep their own routing and status. */
export function createOriginRequest(request: ApiRequest, origin: string): ApiRequest {
  return async (host, path, init) => {
    const response = await request(host, path, { ...init, redirect: 'manual' });
    const failure = classifyOriginResponse(response, origin);
    // Ordinary non-auth HTTP errors keep their status (for example, bots handle 501).
    if (failure === 'auth' || failure === 'network') throw new OriginResponseError(failure, response.status);
    return response;
  };
}
