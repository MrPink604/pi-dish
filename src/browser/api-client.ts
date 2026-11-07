import { decodeSessionList, decodeModelCatalog, decodeMutationResult, decodeThinkingResult, decodeFastModeResult,
  decodeEnabledModelsResult } from '../core/session-api';
import type { ModelChangeRequest, ThinkingChangeRequest, EnabledModelsRequest } from '../core/session-api';
import { record } from '../core/helper-values';

export interface HostEndpoint { base: string; token?: string | null }
export type HostTarget = string | HostEndpoint | null;
export interface RequestOptions extends RequestInit { timeoutMs?: number }
export type ApiRequest = (host: HostTarget, path: string, options?: RequestOptions) => Promise<Response>;

type CapturedHost = Readonly<HostEndpoint & { hostId: string | null }>;
/** Absent credentials compare equal. */
export function sameEndpoint(left: HostEndpoint | null | undefined, right: HostEndpoint | null | undefined): boolean {
  return !!left && !!right && left.base === right.base && (left.token || '') === (right.token || '');
}

/** Search/usage retire on host or credential changes. */
export function sameCapturedHost(current: CapturedHost | null, captured: CapturedHost): boolean {
  return !!current && current.hostId === captured.hostId && sameEndpoint(current, captured);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Unparseable bodies read as `null`, so no decoder mistakes them for an empty object. */
export function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** The server's `error` text, else `fallback`. */
export function responseError(response: Response, data: unknown, fallback = `HTTP ${response.status}`): string {
  return record(data) && typeof data.error === 'string' && data.error ? data.error : fallback;
}

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

/** Parsed body of a successful response (`null` when unparseable); failures throw the server's error text. */
export async function jsonResponse(response: Response, fallback?: string): Promise<unknown> {
  const data = await readJson(response);
  if (!response.ok) throw new ApiHttpError(responseError(response, data, fallback), response.status);
  return data;
}

/** Generic mutations accept successful empty or non-JSON replies as `{}`. */
export async function sendJson(request: ApiRequest, host: HostTarget, path: string, body: unknown, method = 'POST'): Promise<unknown> {
  const response = await request(host, path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return await jsonResponse(response, `request failed (${response.status})`) ?? {};
}

export function modelCatalogUrl(harnessId: string, cwd?: string | null): string {
  const params = new URLSearchParams({ harness: harnessId });
  if (cwd) params.set('cwd', cwd);
  return '/api/models?' + params.toString();
}

export async function setSessionModel(request: ApiRequest, endpoint: HostEndpoint, sessionId: string, modelId: string) {
  const body: ModelChangeRequest = { modelId };
  return decodeMutationResult(await sendJson(request, endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/model`, body));
}

export async function setSessionThinking(request: ApiRequest, endpoint: HostEndpoint, sessionId: string, level: string) {
  const body: ThinkingChangeRequest = { level };
  return decodeThinkingResult(await sendJson(request, endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/thinking`, body));
}

export async function setSessionFast(request: ApiRequest, endpoint: HostEndpoint, sessionId: string, enabled: boolean) {
  return decodeFastModeResult(await sendJson(request, endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/fast`, { enabled }));
}

export async function renameSession(request: ApiRequest, endpoint: HostEndpoint, sessionId: string, name: string) {
  return decodeMutationResult(await sendJson(request, endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/rename`, { name }));
}

export function createSessionApi(request: ApiRequest) {
  return {
    async list(host: HostTarget, path: string, options?: RequestOptions) {
      const response = await request(host, path, options);
      return decodeSessionList(await jsonResponse(response, `HTTP request failed (${response.status})`));
    },
    async models(host: HostTarget, options: { sessionId?: string | null; harnessId?: string; cwd?: string | null } = {}) {
      const { sessionId, harnessId = 'pi', cwd } = options;
      const path = sessionId ? '/api/models?sessionId=' + encodeURIComponent(sessionId)
        : harnessId !== 'pi' ? modelCatalogUrl(harnessId, cwd) : '/api/models';
      const response = await request(host, path);
      return decodeModelCatalog(await jsonResponse(response, `Model catalog request failed (${response.status})`));
    },
    async setEnabledModels(enabledIds: string[] | null) {
      // This setting belongs to the serving Pi instance, independently of selection.
      const body: EnabledModelsRequest = { enabledIds: enabledIds && [...enabledIds] };
      return decodeEnabledModelsResult(await sendJson(request, null, '/api/models/enabled', body, 'PUT'));
    },
  };
}
