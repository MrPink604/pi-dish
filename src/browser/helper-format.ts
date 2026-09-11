import type { Timestamp, RuntimeInfo, ResponseMetadata } from './shared-helper-types';
import { finite } from './helper-values';

/**
 * Pure helpers shared by the frontend (loaded as globals before app.js) and
 * the node test suite (require('../public/helpers.js')). No DOM, no state —
 * keep it that way so everything here stays unit-testable.
 */
export function escapeHtml(text: unknown) {
  if (text == null || text === '') return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Remove ANSI escape sequences (CSI colors, OSC titles, stray escapes).
 * Extension UI strings arrive styled for the terminal via pi's theme.fg();
 * a browser renders those codes as literal "[38;2;…m" garbage.
 */
export function stripAnsi(text: unknown) {
  if (text == null || text === '') return '';
  return String(text)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '') // OSC … BEL/ST
    .replace(/\x1b\[[0-9;:?]*[ -\/]*[@-~]/g, '')        // CSI (colors, cursor)
    .replace(/\x1b[ -\/]*./g, '');                      // leftover ESC + intermediates + final
}


export function formatTokens(tokens?: number | null) {
  if (!tokens || tokens === 0) return '0';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

// Stats-modal "Cache" cell. OpenAI-style completions APIs report cache reads
// but have no write metric, so pi logs cacheWrite:0 even when writes clearly
// happened (a later nonzero cacheRead proves it). Writes therefore only show
// when actually reported; the hit rate — reads over all prompt tokens — is
// computable from logged data on every provider and is the number that says
// whether caching is working.
export function formatCacheStat(cacheRead?: number | null, cacheWrite?: number | null, input?: number | null) {
  const read = cacheRead || 0;
  const write = cacheWrite || 0;
  const prompt = read + write + (input || 0);
  if (prompt === 0) return '—';
  let s = `${formatTokens(read)} read (${Math.round((read / prompt) * 100)}% hit)`;
  if (write > 0) s += ` · ${formatTokens(write)} written`;
  else if (read > 0) s += ' · writes not reported';
  return s;
}

// One line for the stats modal's "Running in" row, from the server's runtime
// object (GET /stats): rpc = headless child of the pi-dish server, tmux = a
// TUI pane (session/window fields are null when the live pane query failed —
// the server name alone still locates it), terminal = a TUI outside tmux.
export function formatRuntime(r?: RuntimeInfo | null) {
  if (!r || !r.kind) return '—';
  const pid = r.pid ? ` · pid ${r.pid}` : '';
  if (r.kind === 'rpc') return `pi-dish server (headless)${pid}`;
  if (r.kind === 'tmux') {
    // The hidden headless placement (dedicated pi-dish socket) reads as
    // "headless" to the user — the tmux part is plumbing worth a hint only.
    if (r.server === 'pi-dish') {
      const sess = r.tmuxSession && r.tmuxSession !== 'headless' ? ` · ${r.tmuxSession}` : '';
      return `headless (hidden tmux — survives restarts)${sess}${pid}`;
    }
    let where = `tmux ${r.server || '?'}`;
    if (r.tmuxSession) {
      where += ` · ${r.tmuxSession}`;
      if (r.windowIndex != null) where += `:${r.windowIndex}`;
      if (r.windowName) where += ` ${r.windowName}`;
    }
    return where + pid;
  }
  return `terminal${pid}`;
}

// Generation speed for one assistant message or a whole session. Null when
// the sample can't mean anything: no tokens, or under a second of generation
// (sub-second bursts read as absurd rates).
export function formatTokSpeed(outputTokens?: number | null, durationMs?: number | null) {
  if (!outputTokens || !durationMs || durationMs < 1000) return null;
  const rate = outputTokens / (durationMs / 1000);
  if (!finite(rate) || rate <= 0) return null;
  return (rate >= 10 ? Math.round(rate) : Math.round(rate * 10) / 10) + ' tok/s';
}

/** Harness-catalog estimate; deliberately never presented as a provider bill. */
export function formatEstimatedCost(value: unknown, digits = 4) {
  if (!finite(value)) return 'Unavailable';
  if (value === 0) return '~$0';
  const precision = value < 0.0001 ? Math.max(digits, 6) : value < 0.01 ? Math.max(digits, 4) : 2;
  return `~$${value.toFixed(precision)}`;
}

/** Known catalog-priced subtotal; `*` means one or more calls were omitted. */
export function formatUsageCost(value: unknown, unavailable = 0) {
  const formatted = formatEstimatedCost(value);
  return finite(value) && unavailable ? `${formatted}*` : formatted;
}

/** Compact metadata label for an authoritative, indexed assistant response. */
export function formatResponseMetadata(msg?: ResponseMetadata | null, mode = 'compact') {
  if (!msg || mode === 'hidden') return null;
  const usage = msg.usage || {};
  const speed = formatTokSpeed(msg.outputTokens || usage.output, msg.durationMs);
  const tokens = usage.output ? `${formatTokens(usage.output)} out` : null;
  const elapsed = finite(msg.durationMs) && msg.durationMs > 0
    ? `${msg.durationMs < 10000 ? (msg.durationMs / 1000).toFixed(1) : Math.round(msg.durationMs / 1000)}s`
    : null;
  if (mode === 'compact') return speed || tokens;
  const performance = [elapsed, speed].filter(Boolean).join(' · ');
  if (mode === 'performance-cost') {
    const cost = msg.pricingKnown !== false && finite(usage.cost?.total) ? formatEstimatedCost(usage.cost.total) : null;
    return [performance, cost].filter(Boolean).join(' · ') || tokens;
  }
  return performance || tokens;
}


export function formatRelativeTime(ts?: Timestamp | null) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const s = Math.floor(diff / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (s < 60) return 'just now';
  if (m < 60) return m + 'm ago';
  if (h < 24) return h + 'h ago';
  if (d === 1) return 'yesterday';
  if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}


export function formatTime(ts: Timestamp) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Compact elapsed time for the working indicator: 0:05, 4:32, 1:04:09. */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:${mm}` : mm) + ':' + String(s).padStart(2, '0');
}

/** Shorten cwd for display */
export function shortCwd(cwd?: string | null) {
  if (!cwd) return '';
  return cwd.replace(/^\/home\/[^/]+\//, '~/').replace(/^\/home\/[^/]+$/, '~');
}

// No newline — truncated text also lands in one-line summary spans.
export function truncate(text: string, maxLen: number, suffix = ' … (truncated)') {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + suffix;
}

/**
 * Severity class for a context-usage percentage. One scale everywhere the
 * number appears (sidebar rows, the composer readout): white to a third,
 * warning to two thirds, error beyond.
 */
export function contextClass(percent: number) {
  return percent > 66 ? 'critical' : percent > 33 ? 'high' : '';
}

/** Either half may be missing ({mood,label}-shaped tools send only one). */
export function normalizeMood(description: unknown, face: unknown) {
  description = String(description || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  face = String(face || '').trim().replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ');
  if (!description && !face) return null;
  return { description, face };
}

/**
 * Append a sent prompt to a history list: trims, skips empties, dedupes an
 * immediate repeat, and caps the list (oldest dropped). Returns a new array.
 */
export function pushPromptHistory(list: unknown, message: unknown, cap?: number) {
  const out: string[] = Array.isArray(list) ? list.filter((value: unknown): value is string => typeof value === 'string') : [];
  const msg = String(message || '').trim();
  if (!msg) return out;
  if (out[out.length - 1] === msg) return out;
  out.push(msg);
  const max = typeof cap === 'number' && cap > 0 ? cap : 50;
  return out.length > max ? out.slice(out.length - max) : out;
}

// --- Speech to text (composer mic) ---------------------------------------
/**
 * Why the mic can't run *here*, independent of whether a host offers the
 * feature. Browsers gate getUserMedia on a secure context, and a phone
 * reaching pi-dish over plain LAN http is not one — the same class of
 * failure as navigator.clipboard being absent there, and worth explaining
 * rather than silently disabling, because the workaround is a browser
 * setting the user can actually apply. Checked in escalating order: no point
 * reporting a missing API that the insecure origin is withholding.
 */
export function sttUnavailableReason({ isSecureContext, hasGetUserMedia, hasMediaRecorder, origin }: { isSecureContext?: boolean; hasGetUserMedia?: boolean; hasMediaRecorder?: boolean; origin?: string } = {}) {
  if (!isSecureContext) {
    const where = origin || 'this origin';
    return {
      code: 'insecure',
      message: `Microphone needs a secure origin. This page is on ${where}, so the browser withholds the mic. ` +
        `Open pi-dish over https or localhost, or in Chrome (desktop and Android) add ${where} at ` +
        'chrome://flags/#unsafely-treat-insecure-origin-as-secure and relaunch. ' +
        'iOS Safari has no override — use https (tailscale serve, cloudflared, or a self-signed cert).',
    };
  }
  if (!hasGetUserMedia) return { code: 'no-getusermedia', message: 'This browser exposes no microphone API.' };
  if (!hasMediaRecorder) return { code: 'no-recorder', message: "This browser can't record audio (no MediaRecorder)." };
  return null;
}

/**
 * Drop `text` into `value` at the caret (replacing any selection), padding
 * with single spaces only where the neighbours would otherwise run into it.
 * Pure so the spacing rule is testable; app.js applies the result and the
 * caret to the textarea.
 */
export function insertAtCaret(value: unknown, selectionStart: unknown, selectionEnd: unknown, text: unknown) {
  const source = typeof value === 'string' ? value : '';
  const insert = typeof text === 'string' ? text : '';
  const max = source.length;
  let start = finite(selectionStart) ? Math.max(0, Math.min(max, selectionStart)) : max;
  let end = finite(selectionEnd) ? Math.max(0, Math.min(max, selectionEnd)) : start;
  if (end < start) [start, end] = [end, start];
  const before = source.slice(0, start);
  const after = source.slice(end);
  if (!insert) return { value: before + after, caret: before.length };
  const prefix = before && !/\s$/.test(before) ? ' ' : '';
  const suffix = after && !/^\s/.test(after) ? ' ' : '';
  const middle = prefix + insert + suffix;
  return { value: before + middle + after, caret: before.length + prefix.length + insert.length };
}

/**
 * tmux prefix key notation ("C-b", "C-a", "M-x", "C-Space") → the raw byte
 * sequence a terminal sends for it. Null when unmappable — the on-screen
 * prefix button hides rather than sending the wrong bytes.
 */
export function tmuxPrefixSeq(prefix: unknown) {
  if (typeof prefix !== 'string') return null;
  if (/^C-Space$/i.test(prefix)) return '\x00';
  let m = /^C-([a-zA-Z@[\\\]^_?])$/.exec(prefix);
  if (m) {
    if (m[1] === '?') return '\x7f';
    const code = m[1].toUpperCase().charCodeAt(0);
    return String.fromCharCode(code & 31);
  }
  m = /^M-(.)$/.exec(prefix);
  if (m) return '\x1b' + m[1];
  return null;
}

/**
 * Filename for a downloaded attachment: the one the response names in its
 * Content-Disposition, else `fallback`. RFC 5987 `filename*` wins over the
 * plain `filename`, matching what browsers do for a real navigation.
 *
 * The value arrives over the wire, and on a fleet that wire ends at a *peer* —
 * a fleet mapping is reachability, never authority — so it is reduced to a
 * bare basename with no separators, traversal or control characters before
 * it can reach an <a download>.
 */
export function filenameFromContentDisposition(header: unknown, fallback: string) {
  const clean = (raw: unknown) => {
    if (typeof raw !== 'string') return '';
    const base = (raw.replace(/\\/g, '/').split('/').pop() || '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return base === '.' || base === '..' ? '' : base;
  };
  const value = typeof header === 'string' ? header : '';
  const extended = value.match(/;\s*filename\*\s*=\s*([^;]+)/i);
  if (extended) {
    // charset'language'percent-encoded-value
    const parts = extended[1].trim().match(/^[^']*'[^']*'(.*)$/);
    if (parts) {
      try {
        const decoded = clean(decodeURIComponent(parts[1]));
        if (decoded) return decoded;
      } catch { /* a malformed encoding just falls through to `filename` */ }
    }
  }
  const quoted = value.match(/;\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
  if (quoted) {
    const decoded = clean(quoted[1].replace(/\\(.)/g, '$1'));
    if (decoded) return decoded;
  }
  const bare = value.match(/;\s*filename\s*=\s*([^;"][^;]*)/i);
  if (bare) {
    const decoded = clean(bare[1]);
    if (decoded) return decoded;
  }
  return fallback;
}
