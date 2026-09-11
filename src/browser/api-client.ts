import { decodeSessionList, decodeModelCatalog, decodeMutationResult, decodeThinkingResult,
  decodeEnabledModelsResult } from '../core/session-api';
import type { ModelChangeRequest, ThinkingChangeRequest, EnabledModelsRequest } from '../core/session-api';
import type { SelectionOwner } from '../../public/session-state';

export interface HostEndpoint { base: string; token?: string | null }
export type HostTarget = string | HostEndpoint | null;
export interface RequestOptions extends RequestInit { timeoutMs?: number }
export type ApiRequest = (host: HostTarget, path: string, options?: RequestOptions) => Promise<Response>;
export class ApiHttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiHttpError'; }
}

export function withFetchTimeout(options: RequestOptions): RequestInit {
  const { timeoutMs, ...init } = options;
  if (!init.signal && typeof timeoutMs === 'number' && timeoutMs > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(timeoutMs);
  }
  return init;
}

export function createHostTransport(options: {
  resolveHost: (target: HostTarget) => HostEndpoint;
  fetch: typeof fetch;
}) {
  const request: ApiRequest = (host, path, init = {}) => {
    // Resolve synchronously. Neither URL nor authorization is read after an await.
    const { base, token } = options.resolveHost(host);
    const requestInit = withFetchTimeout(init);
    if (token) {
      const headers = new Headers(requestInit.headers);
      headers.set('Authorization', `Bearer ${token}`);
      requestInit.headers = headers;
    }
    return options.fetch(base + path, requestInit);
  };
  return { request };
}

async function jsonResponse(response: Response, fallback: string): Promise<unknown> {
  // Keep generic mutations compatible with successful empty/non-JSON responses.
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
    throw new ApiHttpError(typeof error === 'string' && error ? error : `${fallback} (${response.status})`, response.status);
  }
  return data;
}

export async function sendJson(request: ApiRequest, host: HostTarget, path: string, body: unknown, method = 'POST'): Promise<unknown> {
  const response = await request(host, path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return jsonResponse(response, 'request failed');
}

export function modelCatalogUrl(harnessId: string, cwd?: string | null): string {
  const params = new URLSearchParams({ harness: harnessId });
  if (cwd) params.set('cwd', cwd);
  return '/api/models?' + params.toString();
}

export function createSessionApi(request: ApiRequest) {
  function mutate(owner: SelectionOwner, operation: string, body: unknown) {
    const { host, id } = owner;
    return sendJson(request, host, `/api/sessions/${encodeURIComponent(id)}/${operation}`, body);
  }
  return {
    async list(host: HostTarget, path: string, options?: RequestOptions) {
      return decodeSessionList(await jsonResponse(await request(host, path, options), 'HTTP request failed'));
    },
    async models(host: HostTarget, options: { sessionId?: string | null; harnessId?: string; cwd?: string | null } = {}) {
      const { sessionId, harnessId = 'pi', cwd } = options;
      const path = sessionId ? '/api/models?sessionId=' + encodeURIComponent(sessionId)
        : harnessId !== 'pi' ? modelCatalogUrl(harnessId, cwd) : '/api/models';
      return decodeModelCatalog(await jsonResponse(await request(host, path), 'Model catalog request failed'));
    },
    async setModel(owner: SelectionOwner, modelId: string) {
      const body: ModelChangeRequest = { modelId };
      return decodeMutationResult(await mutate(owner, 'model', body));
    },
    async setThinking(owner: SelectionOwner, level: string) {
      const body: ThinkingChangeRequest = { level };
      return decodeThinkingResult(await mutate(owner, 'thinking', body));
    },
    async rename(owner: SelectionOwner, name: string) {
      return decodeMutationResult(await mutate(owner, 'rename', { name }));
    },
    async setEnabledModels(enabledIds: string[] | null) {
      // This setting belongs to the serving Pi instance, independently of selection.
      const body: EnabledModelsRequest = { enabledIds: enabledIds && [...enabledIds] };
      return decodeEnabledModelsResult(await sendJson(request, null, '/api/models/enabled', body, 'PUT'));
    },
  };
}
