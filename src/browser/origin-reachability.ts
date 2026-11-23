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
  const statusFailure = classifyStatus(response.status);
  // 5xx HTML responses (e.g. Cloudflare 502/503/52x during a server restart)
  // are server outages, not an expired sign-in redirect.
  if (statusFailure === 'server') return 'server';
  if (/^(?:text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get('content-type') ?? '')) return 'auth';
  return statusFailure;
}

class OriginResponseError extends Error {
  constructor(readonly failure: OriginFailure, status: number) {
    super(status ? `Unexpected origin response (HTTP ${status})` : 'Opaque origin response');
  }
}

export function classifyOriginError(error: unknown): OriginFailure | null {
  if (error instanceof OriginResponseError) return error.failure;
  if (error instanceof ApiHttpError) return classifyStatus(error.status);
  // Same-origin requests use redirect: 'manual', so an auth proxy's 302 resolves
  // as opaqueredirect above. A rejected fetch TypeError is a transport/network
  // failure (offline, sleep/wake, Wi-Fi handoff, reset), not proven sign-out.
  if (error instanceof TypeError) return 'network';
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'TimeoutError') return 'network';
  return null;
}

/** Probe the serving origin via redirect: 'manual' to distinguish lost auth from stream/socket/outage errors. */
export async function probeOriginFailure(requestOrigin: ApiRequest): Promise<OriginFailure | null> {
  try {
    const response = await requestOrigin(null, '/api/host', { timeoutMs: 8000 });
    if (response.ok) return null;
    return classifyStatus(response.status);
  } catch (error) {
    return classifyOriginError(error) ?? 'network';
  }
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
