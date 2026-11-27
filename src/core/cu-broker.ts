/**
 * HTTP/1.1 JSON + SSE client for the guest-side cu-broker Unix domain socket
 * (PI_DISH_CU_BROKER_SOCKET). The browser never talks to the socket directly.
 */
import fs = require('node:fs');
import http = require('node:http');
import { httpError } from './http-boundary';

// Innermost deadline in the CU call chain:
// broker (8s) < guest spaces proxy (10s) < hub relay (15s) < browser (25s).
export const DEFAULT_BROKER_TIMEOUT_MS = 8_000;
export const TAKEOVER_BROKER_TIMEOUT_MS = 8_000;
// Slice 3 vault fill calls carry their own longer broker deadlines.
export const FILL_MAX_WAIT_MS = 25_000;
export const FILL_PENDING_TIMEOUT_HEADROOM_MS = 10_000;
export const FILL_EXECUTE_BROKER_TIMEOUT_MS = 45_000;
export const FILL_CANCEL_BROKER_TIMEOUT_MS = 15_000;
const MAX_BROKER_BODY_BYTES = 2 * 1024 * 1024;

export interface CuBrokerResponse {
  status: number;
  body: unknown;
}

export interface CuBrokerClientOptions {
  /** Override socket path lookup (defaults to PI_DISH_CU_BROKER_SOCKET). */
  socketPath?: () => string | null;
}

export interface CuBrokerEventsOptions {
  /** Exact Last-Event-ID header value (e.g. `<generation>:<cursor>`). */
  readonly lastEventId?: string | null;
  /** Optional explicit broker generation for ordered SSE resume. */
  readonly generation?: string | null;
  /** Optional explicit non-negative broker cursor for ordered SSE resume. */
  readonly cursor?: number | null;
}

export interface CuBrokerClient {
  socketPath(): string | null;
  /** True when PI_DISH_CU_BROKER_SOCKET (or test seam) is configured — even if the socket file is temporarily missing. */
  configured(): boolean;
  /** True when the configured socket path currently exists as a live Unix socket. */
  available(): boolean;
  requestJson(
    method: 'GET' | 'POST',
    endpointPath: string,
    body?: unknown,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<CuBrokerResponse>;
  openEvents(
    onResponse: (res: http.IncomingMessage) => void,
    onError: (error: Error) => void,
    options?: CuBrokerEventsOptions,
  ): http.ClientRequest | null;
}

export function resolveCuBrokerSocket(): string | null {
  const configured = (process.env.PI_DISH_CU_BROKER_SOCKET || '').trim();
  return configured || null;
}

export function isSocketPathLive(socketPath: string | null | undefined): socketPath is string {
  if (!socketPath) return false;
  try {
    return fs.statSync(socketPath).isSocket();
  } catch {
    return false;
  }
}

export function createCuBrokerClient(options: CuBrokerClientOptions = {}): CuBrokerClient {
  const resolveSocket = options.socketPath ?? resolveCuBrokerSocket;

  function configured(): boolean {
    return resolveSocket() !== null;
  }

  function liveSocket(): string | null {
    const candidate = resolveSocket();
    return isSocketPathLive(candidate) ? candidate : null;
  }

  function requestJson(
    method: 'GET' | 'POST',
    endpointPath: string,
    body?: unknown,
    reqOptions: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<CuBrokerResponse> {
    const candidate = resolveSocket();
    if (!candidate) {
      return Promise.reject(httpError('Computer-use broker is not available on this host', 404));
    }
    const socket = isSocketPathLive(candidate) ? candidate : null;
    if (!socket) {
      return Promise.reject(httpError('Computer-use broker is unavailable', 503));
    }
    const signal = reqOptions.signal;
    if (signal?.aborted) {
      return Promise.reject(httpError('cu-broker request aborted', 499));
    }
    const timeoutMs = reqOptions.timeoutMs ?? DEFAULT_BROKER_TIMEOUT_MS;
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers: http.OutgoingHttpHeaders = {
      host: 'localhost',
      accept: 'application/json',
    };
    if (payload !== null) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }

    return new Promise<CuBrokerResponse>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        try { req.destroy(); } catch {}
        finish({ ok: false, error: httpError('cu-broker request aborted', 499) });
      };
      const finish = (outcome: { ok: true; value: CuBrokerResponse } | { ok: false; error: Error }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (outcome.ok) resolve(outcome.value);
        else reject(outcome.error);
      };

      const req = http.request({ socketPath: socket, method, path: endpointPath, headers }, (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_BROKER_BODY_BYTES) {
            res.destroy();
            finish({ ok: false, error: httpError('cu-broker response exceeded size limit', 502) });
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', () => {
          finish({ ok: false, error: httpError('cu-broker stream failed', 502) });
        });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = null;
          if (raw.length > 0) {
            try { parsed = JSON.parse(raw); } catch { parsed = { error: raw.slice(0, 500) }; }
          }
          finish({ ok: true, value: { status: res.statusCode ?? 502, body: parsed } });
        });
      });

      const timer = setTimeout(() => {
        try { req.destroy(); } catch {}
        finish({ ok: false, error: httpError('cu-broker request timed out', 504) });
      }, timeoutMs);
      timer.unref();
      signal?.addEventListener('abort', onAbort, { once: true });

      req.on('error', () => {
        finish({ ok: false, error: httpError('cu-broker is unavailable', 503) });
      });

      if (payload !== null) req.write(payload);
      req.end();
    });
  }

  function openEvents(
    onResponse: (res: http.IncomingMessage) => void,
    onError: (error: Error) => void,
    eventsOptions?: CuBrokerEventsOptions,
  ): http.ClientRequest | null {
    const socket = liveSocket();
    if (!socket) return null;
    const headers: http.OutgoingHttpHeaders = {
      host: 'localhost',
      accept: 'text/event-stream',
      'cache-control': 'no-cache',
    };
    const params = new URLSearchParams();
    const generation = typeof eventsOptions?.generation === 'string' && eventsOptions.generation.trim()
      ? eventsOptions.generation.trim()
      : null;
    const cursor = typeof eventsOptions?.cursor === 'number'
      && Number.isInteger(eventsOptions.cursor)
      && eventsOptions.cursor >= 0
      ? eventsOptions.cursor
      : null;
    if (generation !== null) params.set('generation', generation);
    if (cursor !== null) params.set('cursor', String(cursor));
    const explicitLastEventId = typeof eventsOptions?.lastEventId === 'string'
      ? eventsOptions.lastEventId.replace(/[\r\n\0]+/g, '').trim().slice(0, 256)
      : '';
    if (generation !== null && cursor !== null) {
      headers['last-event-id'] = `${generation}:${cursor}`;
    } else if (explicitLastEventId) {
      headers['last-event-id'] = explicitLastEventId;
    }
    const qs = params.toString();
    const req = http.request({
      socketPath: socket,
      method: 'GET',
      path: `/v1/events${qs ? `?${qs}` : ''}`,
      headers,
    }, onResponse);
    req.on('error', onError);
    req.end();
    return req;
  }

  return {
    socketPath: resolveSocket,
    configured,
    available: () => liveSocket() !== null,
    requestJson,
    openEvents,
  };
}
