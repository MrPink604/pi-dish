/** Server-side bring-your-own OpenAI-shaped transcription endpoint. */
export const DEFAULT_MODEL = 'whisper-1';
const DEFAULT_TIMEOUT_MS = 60000;
const LANGUAGE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const ERROR_MESSAGE_MAX = 300;

export interface SttConfig {
  url: string;
  apiKey: string | null;
  model: string;
  language: string | null;
}

export interface TranscriptionOptions {
  bytes?: BlobPart | NodeJS.ArrayBufferView;
  contentType?: unknown;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface TranscriptionResult { text: string }

const MIME_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

function trimmed(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** `audio/webm;codecs=opus` -> `audio/webm`. */
export function baseMimeType(contentType: unknown): string {
  return trimmed(contentType).split(';')[0].trim().toLowerCase();
}

/** Credentials are file/env-only; callers advertise only a configured boolean. */
export function resolveSttConfig(settings: unknown, env: NodeJS.ProcessEnv = process.env): SttConfig | null {
  const setting = settings && typeof settings === 'object' && 'stt' in settings ? settings.stt : undefined;
  const block = setting && typeof setting === 'object' ? setting as Record<string, unknown> : {};
  const pick = (envKey: string, key: string) => trimmed(env[envKey]) || trimmed(block[key]);
  const url = pick('PI_DISH_STT_URL', 'url');
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch { return null; }
  const language = pick('PI_DISH_STT_LANGUAGE', 'language');
  return {
    url,
    apiKey: pick('PI_DISH_STT_API_KEY', 'apiKey') || null,
    model: pick('PI_DISH_STT_MODEL', 'model') || DEFAULT_MODEL,
    language: LANGUAGE_RE.test(language) ? language : null,
  };
}

export function sttFilename(contentType: unknown): string | null {
  const ext = MIME_EXTENSIONS[baseMimeType(contentType)];
  return ext ? `audio.${ext}` : null;
}

/** Common upstream envelopes, bounded and scrubbed for browser display. */
export function upstreamErrorMessage(_status: number, bodyText: unknown): string {
  const text = typeof bodyText === 'string' ? bodyText : '';
  let message = '';
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const body = parsed as Record<string, unknown>;
      if (body.error && typeof body.error === 'object' && 'message' in body.error && typeof body.error.message === 'string') message = body.error.message;
      else if (typeof body.error === 'string') message = body.error;
      else if (typeof body.message === 'string') message = body.message;
    }
  } catch { /* not JSON — fall through to the raw body */ }
  if (!message) message = text;
  // eslint-disable-next-line no-control-regex
  message = message.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return message.length > ERROR_MESSAGE_MAX ? message.slice(0, ERROR_MESSAGE_MAX) : message;
}

/** Never expose transport errors, which can contain endpoint URLs/headers. */
function classifyTransportError(error: unknown): string {
  const err = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const name = String(err.name || '');
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  const cause = err.cause && typeof err.cause === 'object' ? err.cause as Record<string, unknown> : {};
  const parts = [err.message, cause.message, cause.code, err.code]
    .filter(v => typeof v === 'string').join(' ').toLowerCase();
  if (parts.includes('timeout') || parts.includes('etimedout')) return 'timeout';
  if (parts.includes('econnrefused') || parts.includes('refused')) return 'refused';
  if (parts.includes('enotfound') || parts.includes('eai_again') || parts.includes('dns')) return 'dns';
  if (parts.includes('cert') || parts.includes('tls') || parts.includes('ssl')) return 'tls';
  return 'network';
}

function sttError(message: string, status = 502): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** Multipart transport; thrown status/message are safe for the HTTP consumer. */
export async function transcribe(
  config: SttConfig,
  { bytes, contentType, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  const filename = sttFilename(contentType);
  if (!filename) throw sttError(`unsupported audio type ${baseMimeType(contentType) || 'unknown'}`, 415);

  const form = new FormData();
  // Node Buffer's backing-store type is wider than DOM BlobPart. Blob retains
  // its native validation/copy; no extra byte copy is needed at this boundary.
  form.append('file', new Blob([bytes === undefined ? 'undefined' : bytes as BlobPart], { type: baseMimeType(contentType) }), filename);
  form.append('model', config.model);
  form.append('response_format', 'json');
  if (config.language) form.append('language', config.language);
  const headers: Record<string, string> = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  let res: Response;
  try {
    res = await fetchImpl(config.url, {
      method: 'POST', headers, body: form, signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw sttError(`Transcription endpoint unreachable: ${classifyTransportError(e)}`);
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    const detail = upstreamErrorMessage(res.status, body);
    throw sttError(`Transcription endpoint answered ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const type = String(res.headers?.get?.('content-type') || '');
  let text: string;
  if (type.includes('text/plain')) {
    text = await res.text();
  } else {
    let payload: unknown;
    try { payload = await res.json(); } catch { throw sttError('Transcription endpoint returned no text in response'); }
    if (!payload || typeof payload !== 'object' || !('text' in payload) || typeof payload.text !== 'string') throw sttError('Transcription endpoint returned no text in response');
    text = payload.text;
  }
  return { text: String(text).trim() };
}
