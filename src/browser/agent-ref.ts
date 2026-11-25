import { escapeHtml } from '../core/helper-format';
import {
  decodeRouteSessionId,
  parseSessionRefParts,
  SESSION_REF_TOKEN_RE,
  SESSION_REF_UUID_RE,
  SESSION_UUID_TAIL_RE,
} from '../core/helper-refs';
import { decodeSessionRow } from '../core/session-api';
import { record } from '../core/helper-values';
import { readJson, type ApiRequest } from './api-client';
import { harnessBadgeInfo, hostDisplayLabel } from './helper-identity';
import { shortModelName } from './helper-usage';
import type { EffectiveHost } from './host-catalog';
import { sessionEntryFromRow, type SessionEntry, type SessionState } from './session-state';

export type AgentRefState = 'working' | 'waiting' | 'idle' | 'finished' | 'closed' | 'ambiguous' | 'unavailable' | 'unknown';
export type AgentRefTone = 'working' | 'ok' | 'warn' | 'muted';

export interface AgentRefSession {
  readonly id?: string;
  readonly host?: string | null;
  readonly hostLabel?: string;
  readonly name?: string | null;
  readonly model?: string | null;
  readonly harnessId?: string;
  readonly harnessLabel?: string;
  readonly isActive?: boolean;
  readonly turnInProgress?: boolean;
  readonly askPending?: boolean;
  readonly subagentLive?: boolean;
  readonly hibernation?: unknown;
}

export interface ParsedAgentRef {
  readonly raw: string;
  readonly hostPart: string | null;
  readonly hostIdForm: boolean;
  readonly id: string;
  readonly decoded: { readonly harnessId: string; readonly nativeSessionId: string } | null;
  readonly isEncoded: boolean;
  readonly shortId: string;
  readonly shortRef: string;
}

export interface InlineAgentRefMatch {
  readonly start: number;
  readonly end: number;
  readonly token: string;
  readonly ref: string;
  readonly session: AgentRefSession | null;
  readonly preserveLabel: boolean;
  readonly parsed: ParsedAgentRef;
}

export interface CodeAgentRefMatch {
  readonly ref: string;
  readonly token: string;
  readonly session: AgentRefSession | null;
  readonly preserveLabel: boolean;
  readonly replaceCode: boolean;
  readonly parsed: ParsedAgentRef;
}

export interface SpawnWorkerParsed {
  readonly name: string;
  readonly harness: string;
  readonly host: string | null;
  readonly ref: string;
}

export interface AgentStateHint {
  readonly reportStatus?: string;
  readonly reportTone?: 'ok' | 'warn' | 'muted';
  readonly spawnHint?: boolean;
  readonly resolveStatus?: 'resolved' | 'missing' | 'ambiguous' | 'error';
}

export interface DerivedAgentState {
  readonly state: AgentRefState;
  readonly label: string;
  readonly tone: AgentRefTone;
}

export interface AgentRefChipOptions {
  readonly ref: string;
  readonly session?: AgentRefSession | null;
  readonly label?: string;
  readonly preserveLabel?: boolean;
  readonly extraClass?: string;
  readonly contextHost?: string | null;
  readonly hostLabel?: string | null;
  readonly hint?: AgentStateHint;
  readonly titlePrefix?: string;
}

export interface AgentRefCardOptions {
  readonly ref?: string;
  readonly session?: AgentRefSession | null;
  readonly fallbackName?: string;
  readonly fallbackHarness?: string;
  readonly fallbackModel?: string;
  readonly fallbackHost?: string | null;
  readonly hostLabel?: string | null;
  readonly contextHost?: string | null;
  readonly hint?: AgentStateHint;
  readonly time?: string;
  readonly actionsHtml?: string;
  readonly bodyHtml?: string;
  readonly bodyLabel?: string;
  readonly bodyPreview?: string;
  readonly bodyFooter?: string;
  readonly bodyDefaultOpen?: boolean;
}

const VALID_HOST_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const SHORT_HEX_ID_RE = /^[0-9a-f]{7,12}$/i;
const TIMESTAMP_SESSION_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[A-Za-z0-9._-]{4,}$/;
const CODE_TOKEN_RE = /^#?[A-Za-z0-9~][A-Za-z0-9._:/~-]{3,}$/;
const LEADING_BOUNDARY_RE = /[\s(\[{<"']/;
const TRAILING_TOKEN_CHAR_RE = /[A-Za-z0-9_/-]/;

// Combined scanner for prose outside <code>:
// 1. #ref token (matches SESSION_REF_TOKEN_RE, including ~sk1_ and host/~sk1_)
// 2. bare ~sk1_ / host/~sk1_ / hostUuid:~sk1_
// 3. bare host/<hex7-12 | uuid | timestamp-id>
const PROSE_AGENT_REF_RE = /(?:^|[\s(\[{<"'])(?:#([A-Za-z0-9~][A-Za-z0-9._:/~-]{3,})|((?:[A-Za-z0-9][A-Za-z0-9._-]{0,62}\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:)?~sk1_[A-Za-z0-9_-]{8,})|([A-Za-z0-9][A-Za-z0-9._-]{0,62}\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[A-Za-z0-9._-]{4,}|[0-9a-f]{7,12})))/gi;

// Cheap HTML prefilter for bare `knownHost/shortid` refs: closing tags (`</p>`)
// never match because `/` must follow an alphanumeric host name and precede a
// hex/timestamp session id prefix.
const BARE_HOST_REF_FAST_RE = /(?:^|[\s(\[{>"'])([A-Za-z0-9][A-Za-z0-9._-]{0,62})\/(?:[0-9a-f]{7}|\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/gi;

/** Cheap pre-scan so `linkSessionRefs` skips template parsing on plain markdown HTML. */
export function mayContainHostAgentRef(html: string, isKnownHost?: (hostPart: string) => boolean): boolean {
  if (!isKnownHost || !html) return false;
  BARE_HOST_REF_FAST_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_HOST_REF_FAST_RE.exec(html)) !== null) {
    if (isKnownHost(m[1])) return true;
  }
  return false;
}

const SPAWN_WORKER_TEXT_RE = /^Started worker "([^"]+)" \(([^)\s]+)(?: on ([^)]+))?\)\.\s+Ref:\s+(\S+?)\.(?:\s+[\s\S]*)?$/;

const CLOSED_CACHE_TTL_MS = 5 * 60_000;
const MISS_CACHE_TTL_MS = 60_000;
const BATCH_CAP = 50;
const FALLBACK_CONCURRENCY = 3;
const FALLBACK_CAP = 12;

/** Compact id segment for display: uuid tail → 8 hex chars, long opaque/native ids truncated. */
export function shortAgentDisplayId(id: string): string {
  const decoded = decodeRouteSessionId(id);
  const native = decoded ? decoded.nativeSessionId : id;
  const uuid = SESSION_UUID_TAIL_RE.exec(native);
  if (uuid) return uuid[1].slice(0, 8);
  if (native.length > 20) return `${native.slice(0, 12)}…`;
  return native;
}

/** Parse any agent/session ref string (`~sk1_…`, `host/~sk1_…`, `host/shortid`, `hostUuid:id`, or short id). */
export function parseAgentRef(raw: unknown): ParsedAgentRef | null {
  const trimmed = String(raw == null ? '' : raw).trim().replace(/^#/, '');
  if (!trimmed) return null;
  const parts = parseSessionRefParts(trimmed);
  if (!parts || !parts.id) return null;
  const decoded = decodeRouteSessionId(parts.id);
  const shortId = shortAgentDisplayId(parts.id);
  const shortRef = parts.hostPart && !parts.hostIdForm ? `${parts.hostPart}/${shortId}` : shortId;
  return {
    raw: trimmed,
    hostPart: parts.hostPart,
    hostIdForm: parts.hostIdForm,
    id: parts.id,
    decoded,
    isEncoded: decoded !== null,
    shortId,
    shortRef,
  };
}

/** True for host-qualified short hex ids (7–12 hex), full UUIDs, or timestamped Pi/OMP ids. */
export function isPlausibleShortSessionId(id: string): boolean {
  return SHORT_HEX_ID_RE.test(id) || SESSION_REF_UUID_RE.test(id) || TIMESTAMP_SESSION_ID_RE.test(id);
}

/** Match a single inline `<code>` span's text against valid agent/session ref patterns. */
export function matchCodeAgentRef(
  rawText: string,
  opts: {
    matchRef: (ref: string) => AgentRefSession | null | undefined;
    isKnownHost?: (hostPart: string) => boolean;
  },
): CodeAgentRefMatch | null {
  const trimmed = rawText.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const ref = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (ref.length < 4) return null;
  const parsed = parseAgentRef(ref);
  if (!parsed) return null;

  if (parsed.isEncoded) {
    if (parsed.hostPart && !parsed.hostIdForm && !VALID_HOST_NAME_RE.test(parsed.hostPart)) return null;
    const session = opts.matchRef(ref) || null;
    return { ref, token: trimmed, session, preserveLabel: false, replaceCode: true, parsed };
  }

  if (!CODE_TOKEN_RE.test(trimmed)) return null;
  const session = opts.matchRef(ref) || null;
  if (session) {
    return { ref, token: trimmed, session, preserveLabel: true, replaceCode: !!parsed.hostPart, parsed };
  }

  if (parsed.hostPart && opts.isKnownHost?.(parsed.hostPart) && isPlausibleShortSessionId(parsed.id)) {
    return { ref, token: trimmed, session: null, preserveLabel: true, replaceCode: true, parsed };
  }
  return null;
}

/**
 * Scan prose outside `<code>` for agent/session refs:
 * - `#ref` tokens (existing short refs + `#~sk1_…` + `#host/~sk1_…` + `#knownHost/shortid`)
 * - bare `~sk1_…` / `host/~sk1_…` / `hostUuid:~sk1_…` (only when base64url tuple decodes cleanly)
 * - bare `knownHost/shortid` (only when host matches a known fleet/self host and id matches a session-id pattern)
 * Never matches random hex strings without a host or known pattern.
 */
export function findInlineAgentRefs(
  text: string,
  opts: {
    matchRef: (ref: string) => AgentRefSession | null | undefined;
    isKnownHost?: (hostPart: string) => boolean;
  },
): InlineAgentRefMatch[] {
  if (!text) return [];
  const hasHash = text.includes('#');
  const hasEncoded = text.includes('~sk1_');
  const hasSlash = text.includes('/');
  if (!hasHash && !hasEncoded && !hasSlash) return [];

  const matches: InlineAgentRefMatch[] = [];
  PROSE_AGENT_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROSE_AGENT_REF_RE.exec(text)) !== null) {
    const full = m[0];
    const hasLeadingBoundary = m.index === 0 || LEADING_BOUNDARY_RE.test(full[0]);
    if (!hasLeadingBoundary) continue;
    const leadLen = LEADING_BOUNDARY_RE.test(full[0]) ? 1 : 0;
    const tokenStart = m.index + leadLen;

    if (m[1] !== undefined) {
      // #ref token
      const ref = m[1].replace(/[.:/]+$/, '');
      if (ref.length < 4) continue;
      const parsed = parseAgentRef(ref);
      if (!parsed) continue;
      const token = `#${ref}`;
      const tokenEnd = tokenStart + token.length;
      if (parsed.isEncoded) {
        if (parsed.hostPart && !parsed.hostIdForm && !VALID_HOST_NAME_RE.test(parsed.hostPart)) continue;
        matches.push({ start: tokenStart, end: tokenEnd, token, ref, session: opts.matchRef(ref) || null, preserveLabel: false, parsed });
        continue;
      }
      const session = opts.matchRef(ref) || null;
      if (session) {
        matches.push({ start: tokenStart, end: tokenEnd, token, ref, session, preserveLabel: true, parsed });
        continue;
      }
      if (parsed.hostPart && opts.isKnownHost?.(parsed.hostPart) && isPlausibleShortSessionId(parsed.id)) {
        matches.push({ start: tokenStart, end: tokenEnd, token, ref, session: null, preserveLabel: true, parsed });
      }
      continue;
    }

    if (m[2] !== undefined) {
      // Bare ~sk1_ or host/~sk1_ or hostUuid:~sk1_
      const ref = m[2];
      const tokenEnd = tokenStart + ref.length;
      const nextChar = text[tokenEnd];
      if (nextChar && TRAILING_TOKEN_CHAR_RE.test(nextChar)) continue;
      const parsed = parseAgentRef(ref);
      if (!parsed || !parsed.isEncoded) continue;
      if (parsed.hostPart && !parsed.hostIdForm && !VALID_HOST_NAME_RE.test(parsed.hostPart)) continue;
      matches.push({ start: tokenStart, end: tokenEnd, token: ref, ref, session: opts.matchRef(ref) || null, preserveLabel: false, parsed });
      continue;
    }

    if (m[3] !== undefined) {
      // Bare knownHost/shortid
      const ref = m[3];
      const tokenEnd = tokenStart + ref.length;
      const nextChar = text[tokenEnd];
      if (nextChar && TRAILING_TOKEN_CHAR_RE.test(nextChar)) continue;
      const parsed = parseAgentRef(ref);
      if (!parsed || !parsed.hostPart || parsed.hostIdForm) continue;
      if (!opts.isKnownHost?.(parsed.hostPart) || !isPlausibleShortSessionId(parsed.id)) continue;
      matches.push({ start: tokenStart, end: tokenEnd, token: ref, ref, session: opts.matchRef(ref) || null, preserveLabel: true, parsed });
    }
  }
  return matches;
}

/** Parse a `spawn_worker` tool result into structured worker card metadata (null for errors/other payloads). */
export function parseSpawnWorkerResult(text: string): SpawnWorkerParsed | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const textMatch = SPAWN_WORKER_TEXT_RE.exec(trimmed);
  if (textMatch) {
    return {
      name: textMatch[1].trim(),
      harness: textMatch[2].trim(),
      host: textMatch[3] ? textMatch[3].trim() : null,
      ref: textMatch[4].trim(),
    };
  }
  if (trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!record(parsed) || typeof parsed.ref !== 'string' || !parsed.ref.trim() || Array.isArray(parsed.workers)) return null;
      const ref = parsed.ref.trim();
      const refParts = parseAgentRef(ref);
      const name = typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim()
        : (refParts?.shortRef || ref);
      const host = typeof parsed.host === 'string' && parsed.host.trim()
        ? parsed.host.trim()
        : (refParts && !refParts.hostIdForm ? refParts.hostPart : null);
      const harness = typeof parsed.harness === 'string' && parsed.harness.trim()
        ? parsed.harness.trim()
        : (refParts?.decoded?.harnessId || '');
      return { name, harness, host, ref };
    } catch {
      return null;
    }
  }
  return null;
}

/** Derive compact agent state (`working` / `waiting` / `idle` / `finished` / `closed` / `unavailable` / `unknown`). */
export function deriveAgentState(session: AgentRefSession | null | undefined, hint: AgentStateHint = {}): DerivedAgentState {
  if (session) {
    if (session.isActive) {
      if (session.askPending) return { state: 'waiting', label: 'waiting', tone: 'warn' };
      if (session.turnInProgress || session.subagentLive) return { state: 'working', label: 'working', tone: 'working' };
      return { state: 'idle', label: 'idle', tone: 'ok' };
    }
    if (session.subagentLive) return { state: 'working', label: 'subagent', tone: 'working' };
    if (session.hibernation) return { state: 'idle', label: 'idle', tone: 'muted' };
    if (hint.reportStatus) {
      if (hint.reportTone === 'warn') return { state: 'closed', label: hint.reportStatus, tone: 'warn' };
      if (hint.reportStatus === 'finished' || hint.reportStatus === 'new turn') {
        return { state: 'finished', label: hint.reportStatus, tone: 'ok' };
      }
      return { state: 'closed', label: 'closed', tone: 'muted' };
    }
    return { state: 'closed', label: 'closed', tone: 'muted' };
  }

  if (hint.reportStatus) {
    const tone = hint.reportTone || 'muted';
    if (hint.reportStatus === 'waiting') return { state: 'waiting', label: 'waiting', tone: 'warn' };
    if (hint.reportStatus === 'still working') return { state: 'working', label: 'still working', tone: 'warn' };
    if (hint.reportStatus === 'finished' || hint.reportStatus === 'new turn') {
      return { state: 'finished', label: hint.reportStatus, tone: 'ok' };
    }
    if (tone === 'warn') return { state: 'closed', label: hint.reportStatus, tone: 'warn' };
    return { state: 'closed', label: 'closed', tone: 'muted' };
  }

  if (hint.resolveStatus === 'ambiguous') return { state: 'ambiguous', label: 'ambiguous ref', tone: 'warn' };
  if (hint.resolveStatus === 'missing') return { state: 'unavailable', label: 'unavailable', tone: 'muted' };
  if (hint.resolveStatus === 'error') return { state: 'unavailable', label: 'offline', tone: 'muted' };
  if (hint.spawnHint) return { state: 'working', label: 'working', tone: 'working' };
  return { state: 'unknown', label: '', tone: 'muted' };
}

function harnessDisplay(harnessId?: string | null, harnessLabel?: string | null): string {
  if (!harnessId && !harnessLabel) return '';
  if (harnessId === 'bot') return 'Bot';
  return harnessBadgeInfo(harnessId, harnessLabel).label;
}

function modelDisplay(model?: string | null): string {
  if (!model || model.trim().toLowerCase() === 'unknown') return '';
  return shortModelName(model);
}

function buildAgentTooltip(opts: {
  ref: string;
  name?: string | null;
  harness?: string;
  model?: string;
  host?: string | null;
  stateLabel?: string;
  titlePrefix?: string;
}): string {
  const parts = [
    opts.titlePrefix,
    opts.name,
    [opts.harness, opts.model].filter(Boolean).join(' · '),
    opts.host,
    opts.stateLabel,
    opts.ref,
  ].filter((value, index, list): value is string => !!value && list.indexOf(value) === index);
  return parts.join(' · ');
}

function renderCardMetaInnerHtml(opts: {
  harness: string;
  model: string;
  host: string;
  shortId: string;
  ref: string;
  time?: string;
}): string {
  const items: string[] = [];
  if (opts.harness) items.push(`<span class="agent-ref-meta-item agent-ref-harness">${escapeHtml(opts.harness)}</span>`);
  if (opts.model) items.push(`<span class="agent-ref-meta-item agent-ref-model">${escapeHtml(opts.model)}</span>`);
  if (opts.host) items.push(`<span class="agent-ref-meta-item agent-ref-host">${escapeHtml(opts.host)}</span>`);
  if (opts.shortId) items.push(`<code class="agent-ref-meta-item agent-ref-id" title="${escapeHtml(opts.ref)}">${escapeHtml(opts.shortId)}</code>`);
  if (opts.time) items.push(`<span class="agent-ref-meta-item agent-ref-time">${escapeHtml(opts.time)}</span>`);
  return items.join('<span class="agent-ref-sep" aria-hidden="true">·</span>');
}

/**
 * Shared inline chip variant of the agent-reference component.
 * Used for prose refs, `<session-refs>` chips, forwarded user-source headers, and tool-call `ref` fields.
 */
export function renderAgentRefChip(opts: AgentRefChipOptions): string {
  const clean = opts.ref.trim();
  if (!clean) return '';
  const parsed = parseAgentRef(clean);
  const session = opts.session || null;
  const derived = deriveAgentState(session, opts.hint);
  const harness = harnessDisplay(session?.harnessId || parsed?.decoded?.harnessId, session?.harnessLabel);
  const model = modelDisplay(session?.model);
  const host = opts.hostLabel || session?.hostLabel || (parsed && !parsed.hostIdForm ? parsed.hostPart : null) || '';
  const preserve = opts.preserveLabel === true;
  const label = opts.label || session?.name || parsed?.shortRef || clean;
  const live = session?.isActive ? ' live' : '';
  const extra = opts.extraClass ? ` ${opts.extraClass}` : '';
  const title = buildAgentTooltip({
    ref: clean,
    name: session?.name || (preserve ? undefined : opts.label),
    harness,
    model,
    host,
    stateLabel: derived.label,
    titlePrefix: opts.titlePrefix,
  });

  const attrs = [
    `type="button"`,
    `class="agent-ref agent-ref-chip${extra}${live}"`,
    `data-agent-ref="${escapeHtml(clean)}"`,
    `data-agent-state="${escapeHtml(derived.state)}"`,
    `data-session-ref="${escapeHtml(clean)}"`,
    opts.contextHost ? `data-agent-context-host="${escapeHtml(opts.contextHost)}"` : '',
    preserve ? `data-agent-preserve-label="1"` : '',
    session?.id ? `data-session-id="${escapeHtml(session.id)}"` : '',
    session?.host ? `data-session-host="${escapeHtml(session.host)}"` : '',
    `title="${escapeHtml(title)}"`,
  ].filter(Boolean).join(' ');

  if (preserve) {
    return `<button ${attrs}>${escapeHtml(label)}</button>`;
  }

  // Show a compact secondary hint on unnamed chips (harness for local encoded refs),
  // or host on named chips only when the target host differs from the transcript's host.
  const isRemoteToContext = !!(parsed?.hostPart && !parsed.hostIdForm && parsed.hostPart.toLowerCase() !== 'self')
    || (!!session?.host && !!opts.contextHost && session.host !== opts.contextHost);
  const secondary = session?.name
    ? (isRemoteToContext && host && !label.toLowerCase().includes(host.toLowerCase()) ? host : '')
    : (harness && !label.toLowerCase().startsWith(harness.toLowerCase()) ? harness : '');
  const metaHtml = secondary ? `<span class="agent-ref-chip-meta">${escapeHtml(secondary)}</span>` : '';
  return `<button ${attrs}><span class="agent-ref-chip-label">${escapeHtml(label)}</span>${metaHtml}</button>`;
}

/**
 * Shared compact card variant of the agent-reference component.
 * Used for `spawn_worker` results and `[worker report]` blocks (with report collapsed underneath).
 */
export function renderAgentRefCard(opts: AgentRefCardOptions): string {
  const clean = (opts.ref || '').trim();
  const parsed = clean ? parseAgentRef(clean) : null;
  const session = opts.session || null;
  const derived = deriveAgentState(session, opts.hint);
  const name = session?.name || opts.fallbackName || parsed?.shortRef || clean || 'Agent';
  const harness = harnessDisplay(
    session?.harnessId || opts.fallbackHarness || parsed?.decoded?.harnessId,
    session?.harnessLabel,
  );
  const model = modelDisplay(session?.model || opts.fallbackModel);
  const host = opts.hostLabel
    || session?.hostLabel
    || opts.fallbackHost
    || (parsed && !parsed.hostIdForm ? parsed.hostPart : null)
    || '';
  const shortId = parsed?.shortId || (clean ? shortAgentDisplayId(clean) : '');
  const title = buildAgentTooltip({ ref: clean, name, harness, model, host, stateLabel: derived.label });

  const stateHtml = derived.label
    ? `<span class="agent-ref-state tone-${escapeHtml(derived.tone)}">${escapeHtml(derived.label)}</span>`
    : '';
  const metaInner = renderCardMetaInnerHtml({ harness, model, host, shortId, ref: clean, time: opts.time });
  const openBtnHtml = clean
    ? `<button type="button" class="agent-ref-open" data-session-ref="${escapeHtml(clean)}"` +
      (session?.id ? ` data-session-id="${escapeHtml(session.id)}"` : '') +
      (session?.host ? ` data-session-host="${escapeHtml(session.host)}"` : '') +
      (opts.contextHost ? ` data-agent-context-host="${escapeHtml(opts.contextHost)}"` : '') +
      ` title="Open session: ${escapeHtml(title)}">Open <span aria-hidden="true">↗</span></button>`
    : '';

  const hasBody = !!(opts.bodyHtml || opts.bodyFooter);
  const detailsHtml = hasBody
    ? `<details class="agent-ref-details"${opts.bodyDefaultOpen ? ' open' : ''}>` +
      `<summary class="agent-ref-toggle">` +
      `<span class="agent-ref-toggle-label">${escapeHtml(opts.bodyLabel || 'Report')}</span>` +
      (opts.bodyPreview ? `<span class="agent-ref-preview">${escapeHtml(opts.bodyPreview)}</span>` : '') +
      `</summary>` +
      `<div class="agent-ref-body">${opts.bodyHtml || ''}` +
      (opts.bodyFooter ? `<div class="agent-ref-footer">${escapeHtml(opts.bodyFooter)}</div>` : '') +
      `</div></details>`
    : '';

  const cardAttrs = [
    `class="agent-ref agent-ref-card${session?.isActive ? ' live' : ''}"`,
    clean ? `data-agent-ref="${escapeHtml(clean)}"` : '',
    `data-agent-state="${escapeHtml(derived.state)}"`,
    opts.contextHost ? `data-agent-context-host="${escapeHtml(opts.contextHost)}"` : '',
    opts.fallbackName ? `data-agent-fallback-name="${escapeHtml(opts.fallbackName)}"` : '',
    opts.fallbackHarness ? `data-agent-fallback-harness="${escapeHtml(opts.fallbackHarness)}"` : '',
    opts.fallbackHost ? `data-agent-fallback-host="${escapeHtml(opts.fallbackHost)}"` : '',
    opts.time ? `data-agent-time="${escapeHtml(opts.time)}"` : '',
    opts.hint?.reportStatus ? `data-agent-report-status="${escapeHtml(opts.hint.reportStatus)}"` : '',
    opts.hint?.reportTone ? `data-agent-report-tone="${escapeHtml(opts.hint.reportTone)}"` : '',
    opts.hint?.spawnHint ? `data-agent-spawn="1"` : '',
  ].filter(Boolean).join(' ');

  return `<div ${cardAttrs}>` +
    `<div class="agent-ref-head">` +
    `<span class="agent-ref-dot" aria-hidden="true"></span>` +
    `<div class="agent-ref-main">` +
    `<div class="agent-ref-title-row">` +
    `<span class="agent-ref-name">${escapeHtml(name)}</span>` +
    stateHtml +
    (opts.actionsHtml || '') +
    `</div>` +
    `<div class="agent-ref-meta">${metaInner}</div>` +
    `</div>` +
    openBtnHtml +
    `</div>` +
    detailsHtml +
    `</div>`;
}

// ---------------------------------------------------------------------------
// Batched, cached metadata resolver + on-demand session opener

interface CachedResolution {
  readonly status: 'resolved' | 'missing' | 'ambiguous' | 'error';
  readonly session: SessionEntry | null;
  readonly hostId: string | null;
  readonly fetchedAt: number;
}

export interface AgentRefResolverOptions {
  document: Document;
  sessionState: SessionState;
  request: ApiRequest;
  hosts: () => readonly Readonly<EffectiveHost>[];
  selfId: () => string | null;
  hostLabel: (hostId: string | null) => string;
  matchRef: (ref: string, localHostId?: string | null) => SessionEntry | null | undefined;
  retainedRoots?: () => readonly ParentNode[];
  selectSession: (id: string, opts: { host: string | null }) => Promise<unknown>;
  loadHostPrevious: (hostId: string | null) => Promise<unknown>;
  status: (message: string, type?: string) => void;
  now?: () => number;
  batchDelayMs?: number;
}

/**
 * Shared agent-ref lifecycle controller:
 * - matches hosts by id, fleet name, or display label (covering self & catalog hosts)
 * - batches and caches metadata lookups via POST /api/sessions/resolve-batch with
 *   automatic version-skew fallback to GET /api/sessions/resolve
 * - hydrates `.agent-ref` cards and chips in-place across visible + retained transcripts
 * - opens any active, closed, or cross-host ref on click with selection-generation guards
 */
export function createAgentRefResolver(options: AgentRefResolverOptions) {
  const now = options.now ?? (() => Date.now());
  const batchDelayMs = options.batchDelayMs ?? 20;
  const cache = new Map<string, CachedResolution>();
  const inFlight = new Map<string, Promise<CachedResolution>>();
  const batchUnsupported = new Set<string>();
  const pendingByHost = new Map<string, { host: Readonly<EffectiveHost>; ids: Set<string> }>();
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function hostKey(host: Readonly<EffectiveHost>): string {
    return host.hostId || host.base || 'self';
  }

  function cacheKeyFor(host: Readonly<EffectiveHost>, id: string): string {
    return `${hostKey(host)}\0${id}`;
  }

  function findHost(hostPart: string | null, hostIdForm: boolean, contextHostId: string | null): Readonly<EffectiveHost> | null {
    const list = options.hosts();
    if (!hostPart || (!hostIdForm && hostPart.toLowerCase() === 'self')) {
      return (contextHostId ? list.find(h => h.hostId === contextHostId) : null)
        || list.find(h => h.self)
        || list[0]
        || null;
    }
    const lower = hostPart.toLowerCase();
    if (hostIdForm) {
      return list.find(h => h.hostId?.toLowerCase() === lower) || null;
    }
    return list.find(h => typeof h.name === 'string' && h.name.toLowerCase() === lower)
      || list.find(h => typeof h.label === 'string' && h.label.toLowerCase() === lower)
      || null;
  }

  function isKnownHost(hostPart: string): boolean {
    if (!hostPart) return false;
    if (hostPart.toLowerCase() === 'self') return true;
    const isUuid = SESSION_REF_UUID_RE.test(hostPart);
    return findHost(hostPart, isUuid, null) !== null;
  }

  function labelForHost(host: Readonly<EffectiveHost> | null, fallbackHostId: string | null): string {
    if (host) {
      return hostDisplayLabel({
        label: typeof host.label === 'string' ? host.label : null,
        name: host.name,
        base: host.base,
      });
    }
    return fallbackHostId ? options.hostLabel(fallbackHostId) : '';
  }

  function readFreshCache(key: string): CachedResolution | null {
    const entry = cache.get(key);
    if (!entry) return null;
    const ttl = entry.status === 'resolved' ? CLOSED_CACHE_TTL_MS : MISS_CACHE_TTL_MS;
    if (now() - entry.fetchedAt > ttl) {
      cache.delete(key);
      return null;
    }
    return entry;
  }

  function decodeResolvedSession(raw: unknown, host: Readonly<EffectiveHost>): SessionEntry | null {
    try {
      const row = decodeSessionRow(raw);
      const entry = sessionEntryFromRow(row);
      const label = labelForHost(host, host.hostId);
      return { ...entry, host: host.hostId || null, ...(label ? { hostLabel: label } : {}) };
    } catch {
      return null;
    }
  }

  function resolveFromMemoryOrCache(rawRef: string, contextHostId: string | null): {
    parsed: ParsedAgentRef | null;
    host: Readonly<EffectiveHost> | null;
    session: SessionEntry | null;
    status: 'resolved' | 'missing' | 'ambiguous' | 'error' | 'uncached';
  } {
    const parsed = parseAgentRef(rawRef);
    if (!parsed) return { parsed: null, host: null, session: null, status: 'missing' };
    const host = findHost(parsed.hostPart, parsed.hostIdForm, contextHostId);
    const live = options.matchRef(parsed.raw, contextHostId);
    if (live) {
      return { parsed, host: host || findHost(null, false, live.host || contextHostId), session: live, status: 'resolved' };
    }
    if (!host) return { parsed, host: null, session: null, status: 'missing' };
    const cached = readFreshCache(cacheKeyFor(host, parsed.id));
    if (cached) return { parsed, host, session: cached.session, status: cached.status };
    return { parsed, host, session: null, status: 'uncached' };
  }

  function applyToElement(el: HTMLElement): boolean {
    const rawRef = el.dataset.agentRef || el.dataset.sessionRef || '';
    if (!rawRef) return false;
    const contextHostId = el.dataset.agentContextHost || options.sessionState.currentSession?.host || options.selfId();
    const resolved = resolveFromMemoryOrCache(rawRef, contextHostId);
    const { parsed, host, session, status } = resolved;
    if (!parsed) return false;

    const hint: AgentStateHint = {
      reportStatus: el.dataset.agentReportStatus || undefined,
      reportTone: (el.dataset.agentReportTone as 'ok' | 'warn' | 'muted' | undefined) || undefined,
      spawnHint: el.dataset.agentSpawn === '1',
      resolveStatus: status === 'uncached' ? undefined : status,
    };
    const derived = deriveAgentState(session, hint);
    const resolvedHostLabel = session?.hostLabel
      || labelForHost(host, session?.host ?? null)
      || el.dataset.agentFallbackHost
      || (parsed.hostPart && !parsed.hostIdForm ? parsed.hostPart : '')
      || '';
    const harness = harnessDisplay(
      session?.harnessId || el.dataset.agentFallbackHarness || parsed.decoded?.harnessId,
      session?.harnessLabel,
    );
    const model = modelDisplay(session?.model);

    el.dataset.agentState = derived.state;
    el.classList.toggle('live', !!session?.isActive);

    if (el.classList.contains('agent-ref-card')) {
      const name = session?.name || el.dataset.agentFallbackName || parsed.shortRef;
      const nameEl = el.querySelector<HTMLElement>('.agent-ref-name');
      if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;

      const titleRow = el.querySelector<HTMLElement>('.agent-ref-title-row');
      let stateEl = el.querySelector<HTMLElement>('.agent-ref-state');
      if (derived.label) {
        if (!stateEl && titleRow) {
          stateEl = options.document.createElement('span');
          nameEl ? nameEl.after(stateEl) : titleRow.append(stateEl);
        }
        if (stateEl) {
          stateEl.className = `agent-ref-state tone-${derived.tone}`;
          if (stateEl.textContent !== derived.label) stateEl.textContent = derived.label;
        }
      } else if (stateEl) {
        stateEl.remove();
      }

      const metaEl = el.querySelector<HTMLElement>('.agent-ref-meta');
      if (metaEl) {
        const nextMeta = renderCardMetaInnerHtml({
          harness, model, host: resolvedHostLabel, shortId: parsed.shortId, ref: parsed.raw, time: el.dataset.agentTime || undefined,
        });
        if (metaEl.innerHTML !== nextMeta) metaEl.innerHTML = nextMeta;
      }

      const openBtn = el.querySelector<HTMLElement>('.agent-ref-open');
      if (openBtn) {
        if (session?.id) openBtn.dataset.sessionId = session.id;
        else delete openBtn.dataset.sessionId;
        if (session?.host) openBtn.dataset.sessionHost = session.host;
        else if (host?.hostId) openBtn.dataset.sessionHost = host.hostId;
        else delete openBtn.dataset.sessionHost;
        openBtn.title = `Open session: ${buildAgentTooltip({
          ref: parsed.raw, name, harness, model, host: resolvedHostLabel, stateLabel: derived.label,
        })}`;
      }
    } else {
      // Chip variant
      if (session?.id) el.dataset.sessionId = session.id;
      if (session?.host) el.dataset.sessionHost = session.host;
      else if (host?.hostId && !el.dataset.sessionHost) el.dataset.sessionHost = host.hostId;

      const preserve = el.dataset.agentPreserveLabel === '1';
      let secondary = '';
      if (status === 'ambiguous') {
        secondary = 'ambiguous ref';
      } else if (!preserve) {
        const label = session?.name || parsed.shortRef;
        const labelEl = el.querySelector<HTMLElement>('.agent-ref-chip-label');
        if (labelEl && labelEl.textContent !== label) labelEl.textContent = label;
        const isRemoteToContext = (!!parsed.hostPart && !parsed.hostIdForm && parsed.hostPart.toLowerCase() !== 'self')
          || (!!host?.hostId && !!contextHostId && host.hostId !== contextHostId);
        secondary = session?.name
          ? (isRemoteToContext && resolvedHostLabel && !label.toLowerCase().includes(resolvedHostLabel.toLowerCase()) ? resolvedHostLabel : '')
          : (harness && !label.toLowerCase().startsWith(harness.toLowerCase()) ? harness : '');
      }
      if (!preserve || status === 'ambiguous' || el.querySelector('.agent-ref-chip-meta')) {
        let metaEl = el.querySelector<HTMLElement>('.agent-ref-chip-meta');
        if (secondary) {
          if (!metaEl) {
            metaEl = options.document.createElement('span');
            metaEl.className = 'agent-ref-chip-meta';
            el.append(metaEl);
          }
          if (metaEl.textContent !== secondary) metaEl.textContent = secondary;
        } else if (metaEl) {
          metaEl.remove();
        }
      }
      el.title = buildAgentTooltip({
        ref: parsed.raw,
        name: session?.name || undefined,
        harness,
        model,
        host: resolvedHostLabel,
        stateLabel: derived.label,
      });
    }

    return status === 'uncached' && !!host && host.reachable !== false;
  }

  function syncRoots() {
    if (disposed) return;
    const roots: ParentNode[] = [];
    const messages = options.document.getElementById('messages');
    if (messages) roots.push(messages);
    for (const retained of options.retainedRoots?.() || []) roots.push(retained);
    for (const root of roots) {
      for (const el of root.querySelectorAll<HTMLElement>('[data-agent-ref]')) applyToElement(el);
    }
  }

  async function resolveSingleOnHost(host: Readonly<EffectiveHost>, id: string): Promise<CachedResolution> {
    const key = cacheKeyFor(host, id);
    const active = inFlight.get(key);
    if (active) return active;
    const endpoint = Object.freeze({ ...host });
    let promise!: Promise<CachedResolution>;
    promise = (async (): Promise<CachedResolution> => {
      try {
        const res = await options.request(endpoint, `/api/sessions/resolve?id=${encodeURIComponent(id)}`, { timeoutMs: 8000 });
        const data = await readJson(res);
        if (res.ok && record(data) && data.session) {
          const session = decodeResolvedSession(data.session, host);
          if (session) {
            const entry: CachedResolution = { status: 'resolved', session, hostId: host.hostId || null, fetchedAt: now() };
            cache.set(key, entry);
            return entry;
          }
        }
        const status = res.status === 409 ? 'ambiguous' : res.status === 404 ? 'missing' : 'error';
        const entry: CachedResolution = { status, session: null, hostId: host.hostId || null, fetchedAt: now() };
        cache.set(key, entry);
        return entry;
      } catch {
        const entry: CachedResolution = { status: 'error', session: null, hostId: host.hostId || null, fetchedAt: now() };
        cache.set(key, entry);
        return entry;
      } finally {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      }
    })();
    inFlight.set(key, promise);
    return promise;
  }

  async function resolveBatchOnHost(host: Readonly<EffectiveHost>, ids: readonly string[]): Promise<void> {
    if (disposed || !ids.length) return;
    const keyOfHost = hostKey(host);
    const capped = ids.slice(0, BATCH_CAP);
    if (!batchUnsupported.has(keyOfHost)) {
      const endpoint = Object.freeze({ ...host });
      let resolveAll!: (map: Map<string, CachedResolution>) => void;
      const batchPromise = new Promise<Map<string, CachedResolution>>(resolve => { resolveAll = resolve; });
      for (const id of capped) {
        const key = cacheKeyFor(host, id);
        if (!inFlight.has(key)) {
          inFlight.set(key, batchPromise.then(map => map.get(id) || { status: 'error', session: null, hostId: host.hostId || null, fetchedAt: now() }));
        }
      }
      let fallbackNeeded = false;
      const settled = new Map<string, CachedResolution>();
      try {
        const res = await options.request(endpoint, '/api/sessions/resolve-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: capped }),
          timeoutMs: 8000,
        });
        if (res.status === 404 || res.status === 405 || res.status === 501) {
          batchUnsupported.add(keyOfHost);
          fallbackNeeded = true;
        } else if (res.ok) {
          const data = await readJson(res);
          const results = record(data) && record(data.results) ? data.results : null;
          for (const id of capped) {
            const rawItem = results && Object.hasOwn(results, id) ? results[id] : null;
            let entry: CachedResolution;
            if (record(rawItem) && rawItem.status === 'ok' && rawItem.session) {
              const session = decodeResolvedSession(rawItem.session, host);
              entry = session
                ? { status: 'resolved', session, hostId: host.hostId || null, fetchedAt: now() }
                : { status: 'error', session: null, hostId: host.hostId || null, fetchedAt: now() };
            } else if (record(rawItem) && rawItem.status === 'ambiguous') {
              entry = { status: 'ambiguous', session: null, hostId: host.hostId || null, fetchedAt: now() };
            } else if (record(rawItem) && rawItem.status === 'not_found') {
              entry = { status: 'missing', session: null, hostId: host.hostId || null, fetchedAt: now() };
            } else {
              entry = { status: 'missing', session: null, hostId: host.hostId || null, fetchedAt: now() };
            }
            cache.set(cacheKeyFor(host, id), entry);
            settled.set(id, entry);
          }
        } else {
          for (const id of capped) {
            const entry: CachedResolution = { status: 'error', session: null, hostId: host.hostId || null, fetchedAt: now() };
            cache.set(cacheKeyFor(host, id), entry);
            settled.set(id, entry);
          }
        }
      } catch {
        for (const id of capped) {
          const entry: CachedResolution = { status: 'error', session: null, hostId: host.hostId || null, fetchedAt: now() };
          cache.set(cacheKeyFor(host, id), entry);
          settled.set(id, entry);
        }
      } finally {
        for (const id of capped) inFlight.delete(cacheKeyFor(host, id));
        resolveAll(settled);
      }

      if (!fallbackNeeded) {
        syncRoots();
        return;
      }
    }

    // Fallback for older hosts without POST /api/sessions/resolve-batch: bounded single-ref GETs.
    const queue = capped.slice(0, FALLBACK_CAP);
    let cursor = 0;
    const worker = async () => {
      while (!disposed && cursor < queue.length) {
        const id = queue[cursor++];
        if (!id) break;
        await resolveSingleOnHost(host, id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(FALLBACK_CONCURRENCY, queue.length) }, worker));
    syncRoots();
  }

  function flushPending() {
    batchTimer = null;
    if (disposed || !pendingByHost.size) return;
    const batches = [...pendingByHost.values()];
    pendingByHost.clear();
    for (const { host, ids } of batches) {
      void resolveBatchOnHost(host, [...ids]);
    }
  }

  function enqueue(host: Readonly<EffectiveHost>, id: string) {
    const key = cacheKeyFor(host, id);
    if (inFlight.has(key) || readFreshCache(key)) return;
    const hKey = hostKey(host);
    let bucket = pendingByHost.get(hKey);
    if (!bucket) {
      bucket = { host, ids: new Set() };
      pendingByHost.set(hKey, bucket);
    }
    bucket.ids.add(id);
    if (!batchTimer) {
      batchTimer = setTimeout(flushPending, batchDelayMs);
    }
  }

  /** Hydrate all `.agent-ref` elements in `root` from memory/cache and schedule one batched fetch for misses. */
  function hydrate(root?: ParentNode | null) {
    if (disposed) return;
    const scope = root || options.document.getElementById('messages');
    if (!scope) return;
    for (const el of scope.querySelectorAll<HTMLElement>('[data-agent-ref]')) {
      const needsFetch = applyToElement(el);
      if (!needsFetch) continue;
      const rawRef = el.dataset.agentRef || '';
      const contextHostId = el.dataset.agentContextHost || options.sessionState.currentSession?.host || options.selfId();
      const parsed = parseAgentRef(rawRef);
      if (!parsed) continue;
      const host = findHost(parsed.hostPart, parsed.hostIdForm, contextHostId);
      if (host && host.reachable !== false) enqueue(host, parsed.id);
    }
  }

  /** Open any agent/session ref (active, closed, or remote), fetching metadata on demand if needed. */
  async function open(
    rawRef: string,
    opts: { contextHostId?: string | null; sessionId?: string | null; sessionHostId?: string | null } = {},
  ): Promise<void> {
    if (disposed) return;
    const startGen = options.sessionState.selectionGeneration;
    const contextHostId = opts.contextHostId || options.sessionState.currentSession?.host || options.selfId();

    // 1. Direct id+host already loaded in sessionState (preserves retained-node host ownership).
    if (opts.sessionId) {
      const existing = options.sessionState.findSession(opts.sessionId, opts.sessionHostId ?? null);
      if (existing) {
        await options.selectSession(existing.id, { host: existing.host || null });
        return;
      }
    }

    // 2. Match in currently loaded sessionState lists.
    const matched = rawRef ? options.matchRef(rawRef, contextHostId) : null;
    if (matched) {
      await options.selectSession(matched.id, { host: matched.host || null });
      return;
    }

    const parsed = parseAgentRef(rawRef || opts.sessionId || '');
    if (!parsed) {
      options.status(`No session here matches ${rawRef}`, 'error');
      return;
    }

    const host = opts.sessionHostId
      ? findHost(opts.sessionHostId, true, contextHostId) || findHost(parsed.hostPart, parsed.hostIdForm, contextHostId)
      : findHost(parsed.hostPart, parsed.hostIdForm, contextHostId);
    if (!host) {
      options.status(`No host matches ${parsed.hostPart || rawRef}`, 'error');
      return;
    }

    // 3. Fresh cached resolution (e.g. already hydrated closed worker card).
    const key = cacheKeyFor(host, parsed.id);
    const cached = readFreshCache(key);
    if (cached?.status === 'resolved' && cached.session) {
      const ensured = options.sessionState.ensureSession(cached.session, host.hostId);
      await options.selectSession(ensured.id, { host: ensured.host || null });
      return;
    }

    // 4. On-demand resolve against the target host (local, peer proxy, tailnet, or tunnel).
    options.status(`Opening ${parsed.shortRef}…`, 'working');
    cache.delete(key); // Explicit user click always retries past a stale miss/error cache.
    const resolved = await resolveSingleOnHost(host, parsed.id);
    if (disposed || options.sessionState.selectionGeneration !== startGen) return;

    if (resolved.status === 'resolved' && resolved.session) {
      syncRoots();
      const ensured = options.sessionState.ensureSession(resolved.session, host.hostId);
      await options.selectSession(ensured.id, { host: ensured.host || null });
      return;
    }

    // 5. Fallback for older peers without /api/sessions/resolve: load previous sessions for that host.
    if (resolved.status === 'error' || (record(host.capabilities) && host.capabilities.resolve === false)) {
      try { await options.loadHostPrevious(host.hostId); } catch {}
      if (disposed || options.sessionState.selectionGeneration !== startGen) return;
      const retry = options.matchRef(parsed.raw, contextHostId)
        || (opts.sessionId ? options.sessionState.findSession(opts.sessionId, host.hostId) : null);
      if (retry) {
        await options.selectSession(retry.id, { host: retry.host || null });
        return;
      }
    }

    syncRoots();
    const hostText = labelForHost(host, host.hostId);
    options.status(
      resolved.status === 'ambiguous'
        ? `Ambiguous ref${hostText ? ` on ${hostText}` : ''}: ${parsed.shortRef}`
        : resolved.status === 'missing'
          ? `Session not found${hostText ? ` on ${hostText}` : ''}: ${parsed.shortRef}`
          : `Could not reach ${hostText || 'host'} for ${parsed.shortRef}`,
      'error',
    );
  }

  function dispose() {
    disposed = true;
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    pendingByHost.clear();
    inFlight.clear();
    cache.clear();
  }

  return {
    findHost,
    isKnownHost,
    hydrate,
    syncFromState: syncRoots,
    open,
    clearCache: () => { cache.clear(); batchUnsupported.clear(); },
    dispose,
  };
}

export { SESSION_REF_TOKEN_RE };
