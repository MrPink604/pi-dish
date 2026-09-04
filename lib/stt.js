/**
 * Speech to text — "bring your own endpoint".
 *
 * pi-dish never runs a model. The user points this at any endpoint that
 * speaks OpenAI's transcription shape (multipart/form-data `file` + `model`,
 * optional `language`/`response_format`, bearer auth, `{ "text": "..." }`
 * back): OpenAI, Groq, Mistral, Azure OpenAI, speaches, LocalAI, vLLM,
 * whisper.cpp's server, or LiteLLM fronting something else entirely.
 *
 * Everything here is pure except `transcribe`, which takes its `fetchImpl`
 * so the unit tests can assert the exact multipart parts and headers without
 * a network. The endpoint URL and API key never leave the server (see
 * settingsForClient in server.js) — the browser only ever POSTs audio bytes
 * to /api/stt.
 */

const DEFAULT_MODEL = 'whisper-1';
const DEFAULT_TIMEOUT_MS = 60000;
// BCP-47-ish: the ISO 639 code every one of these APIs actually wants, with
// an optional region/script subtag tolerated.
const LANGUAGE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const ERROR_MESSAGE_MAX = 300;

// Container/codec → the extension the upstream sniffs the format from. Some
// endpoints (OpenAI included) reject a file whose name has no known
// extension, so an unmapped type is refused here rather than upstream.
const MIME_EXTENSIONS = {
  'audio/webm': 'webm',
  'video/webm': 'webm',        // Chrome labels its opus recordings this way
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

function trimmed(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** `audio/webm;codecs=opus` → `audio/webm`. */
function baseMimeType(contentType) {
  return trimmed(contentType).split(';')[0].trim().toLowerCase();
}

/**
 * Config is file-level, not UI-editable: it carries a credential, and the
 * settings API is reachable by anything that can reach the app. Env overrides
 * win per field so a fleet host can be configured without editing JSON.
 * Returns null — "unconfigured" — whenever there is no usable http(s) URL.
 */
function resolveSttConfig(settings, env = process.env) {
  const block = settings && typeof settings.stt === 'object' && settings.stt ? settings.stt : {};
  const pick = (envKey, key) => trimmed(env[envKey]) || trimmed(block[key]);

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

/** The upload filename the upstream reads the container from, or null. */
function sttFilename(contentType) {
  const ext = MIME_EXTENSIONS[baseMimeType(contentType)];
  return ext ? `audio.${ext}` : null;
}

/**
 * Best-effort human summary of an upstream failure body. Providers disagree
 * on the envelope, so try the three common shapes before falling back to the
 * raw text; the result is shown to the user, so it is capped and stripped of
 * control characters.
 */
function upstreamErrorMessage(status, bodyText) {
  const text = typeof bodyText === 'string' ? bodyText : '';
  let message = '';
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      if (parsed.error && typeof parsed.error === 'object' && typeof parsed.error.message === 'string') message = parsed.error.message;
      else if (typeof parsed.error === 'string') message = parsed.error;
      else if (typeof parsed.message === 'string') message = parsed.message;
    }
  } catch { /* not JSON — fall through to the raw body */ }
  if (!message) message = text;
  // eslint-disable-next-line no-control-regex
  message = message.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return message.length > ERROR_MESSAGE_MAX ? message.slice(0, ERROR_MESSAGE_MAX) : message;
}

/**
 * Transport failures are classified to a word and the original discarded: a
 * fetch error message can carry the endpoint URL (and, on some runtimes, the
 * request headers), and this string is rendered in the browser.
 */
function classifyTransportError(err) {
  const name = String(err?.name || '');
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  const parts = [err?.message, err?.cause?.message, err?.cause?.code, err?.code]
    .filter(v => typeof v === 'string').join(' ').toLowerCase();
  if (parts.includes('timeout') || parts.includes('etimedout')) return 'timeout';
  if (parts.includes('econnrefused') || parts.includes('refused')) return 'refused';
  if (parts.includes('enotfound') || parts.includes('eai_again') || parts.includes('dns')) return 'dns';
  if (parts.includes('cert') || parts.includes('tls') || parts.includes('ssl')) return 'tls';
  return 'network';
}

function sttError(message, status = 502) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * POST the audio to the configured endpoint and return `{ text }`.
 * Throws an Error carrying `.status` and a message safe to show the user.
 */
async function transcribe(config, { bytes, contentType, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const filename = sttFilename(contentType);
  if (!filename) throw sttError(`unsupported audio type ${baseMimeType(contentType) || 'unknown'}`, 415);

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: baseMimeType(contentType) }), filename);
  form.append('model', config.model);
  form.append('response_format', 'json');
  if (config.language) form.append('language', config.language);

  const headers = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  let res;
  try {
    res = await fetchImpl(config.url, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
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
  let text;
  if (type.includes('text/plain')) {
    // response_format=text (some servers ignore the json request)
    text = await res.text();
  } else {
    let payload;
    try { payload = await res.json(); } catch { throw sttError('Transcription endpoint returned no text in response'); }
    if (!payload || typeof payload.text !== 'string') throw sttError('Transcription endpoint returned no text in response');
    text = payload.text;
  }
  return { text: String(text).trim() };
}

module.exports = { resolveSttConfig, sttFilename, baseMimeType, upstreamErrorMessage, transcribe, DEFAULT_MODEL };
