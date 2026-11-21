import { escapeHtml, truncate } from '../core/helper-format';
import { decodeRouteSessionId, SESSION_UUID_TAIL_RE } from '../core/helper-refs';
import { record } from '../core/helper-values';
import { formatTime } from './helper-format';
import type { MessageDetails } from './message-data';

const OUTPUT_LIMIT = 8000;

export interface MatchRefResult {
  readonly name?: string | null;
  readonly isActive?: boolean;
}

export type MatchRefFn = (ref: string) => MatchRefResult | null | undefined;

/** Shorten a full host-qualified, timestamped, or ~sk1_ route ref for compact display. */
export function shortDisplayRef(raw: string): string {
  const ref = raw.trim();
  if (!ref) return '';
  const slash = ref.indexOf('/');
  const host = slash > 0 ? ref.slice(0, slash + 1) : '';
  const id = slash > 0 ? ref.slice(slash + 1) : ref;
  const decoded = decodeRouteSessionId(id);
  const native = decoded ? decoded.nativeSessionId : id;
  const uuid = SESSION_UUID_TAIL_RE.exec(native);
  if (uuid) return `${host}${uuid[1].slice(0, 8)}`;
  if (native.length > 20) return `${host}${native.slice(0, 12)}…`;
  return `${host}${native}`;
}

/** Render a clickable session-ref chip that delegates to app.ts's `.session-ref-chip` handler. */
export function renderBotRefChip(ref: string, matchRef: MatchRefFn, opts: { label?: string; extraClass?: string } = {}): string {
  const clean = ref.trim();
  if (!clean) return '';
  const session = matchRef(clean);
  const short = shortDisplayRef(clean);
  const label = opts.label || session?.name || short;
  const live = session?.isActive ? ' live' : '';
  const title = [session?.name || opts.label, clean].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' · ');
  const cls = `session-ref-chip${live}${opts.extraClass ? ` ${opts.extraClass}` : ''}`;
  return `<button type="button" class="${cls}" data-session-ref="${escapeHtml(clean)}" title="${escapeHtml(title)}">` +
    `<span class="session-ref-dot">●</span><span class="session-ref-label">${escapeHtml(label)}</span></button>`;
}

// ---------------------------------------------------------------------------
// User source headers: `[~sk1_... · <title> · <ISO time>]\n<body>`

export interface UserSourceEntry {
  readonly ref: string;
  readonly title: string;
  readonly sentAt: string;
  readonly body: string;
}

const SOURCE_HEADER_LINE_RE = /^\[([^\s\]]+)\s+·\s+([^\n]+?)\s+·\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\]$/;

/** Parse one or more `[ref · title · ISO]\nbody` entries (from held/forwarded session sends). */
export function parseUserSourceEntries(text: string): UserSourceEntry[] | null {
  if (!text.startsWith('[')) return null;
  const lines = text.split('\n');
  if (!SOURCE_HEADER_LINE_RE.test(lines[0])) return null;
  const entries: UserSourceEntry[] = [];
  let current: { ref: string; title: string; sentAt: string; bodyLines: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = (i === 0 || (i > 0 && lines[i - 1] === '')) ? SOURCE_HEADER_LINE_RE.exec(line) : null;
    if (match) {
      if (current) {
        entries.push({ ref: current.ref, title: current.title, sentAt: current.sentAt, body: current.bodyLines.join('\n').trim() });
      }
      current = { ref: match[1], title: match[2].trim(), sentAt: match[3], bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) {
    entries.push({ ref: current.ref, title: current.title, sentAt: current.sentAt, body: current.bodyLines.join('\n').trim() });
  }
  return entries.length ? entries : null;
}

export function renderUserSourceHeaderHtml(entry: UserSourceEntry, matchRef: MatchRefFn): string {
  const chip = renderBotRefChip(entry.ref, matchRef, { label: entry.title || shortDisplayRef(entry.ref), extraClass: 'user-source-chip' });
  const time = formatTime(entry.sentAt);
  return `<div class="user-source-bar"><span class="user-source-from">from</span>${chip}${time ? `<span class="user-source-time">${escapeHtml(time)}</span>` : ''}</div>`;
}

// ---------------------------------------------------------------------------
// Injected bot messages (custom_message bot-* AND legacy/user-role injections)

export type BotNoticeKind =
  | 'worker-report'
  | 'room'
  | 'answer'
  | 'question'
  | 'routine'
  | 'ci'
  | 'nudge'
  | 'context-window'
  | 'purpose'
  | 'forked'
  | 'restart';

export interface ParsedBotNotice {
  readonly kind: BotNoticeKind;
  readonly icon: string;
  readonly label: string;
  readonly sender?: string;
  readonly recipients?: string;
  readonly ref?: string;
  readonly status?: string;
  readonly statusTone?: 'ok' | 'warn' | 'muted';
  readonly meta?: string;
  readonly question?: string;
  readonly body: string;
  readonly footer?: string;
  readonly collapsible: boolean;
  readonly defaultOpen: boolean;
  readonly quiet?: boolean;
}

function normalizeWorkerStatus(heading: string, state?: string): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  const lower = heading.toLowerCase();
  if (state === 'waiting' || lower.includes('waiting')) return { label: 'waiting', tone: 'warn' };
  if (lower.includes('still working')) return { label: 'still working', tone: 'warn' };
  if (lower.includes('stopped without')) return { label: 'stopped · no answer', tone: 'warn' };
  if (lower.includes('stopped')) return { label: 'stopped', tone: 'muted' };
  if (lower.includes('another turn')) return { label: 'new turn', tone: 'ok' };
  return { label: 'finished', tone: 'ok' };
}

function bodyPreview(body: string): string {
  const line = body
    .split('\n')
    .map(l => l.trim().replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1'))
    .find(l => l && !l.startsWith('```'));
  return line ? truncate(line, 120) : '';
}

function isLongBody(body: string, maxLines: number, maxChars: number): boolean {
  if (!body) return false;
  return body.length > maxChars || body.split('\n').length > maxLines;
}

export function parseInjectedBotMessage(customType: string | undefined, rawText: string, details?: MessageDetails): ParsedBotNotice | null {
  const text = rawText.trim();
  const ev = details?.botEvent;

  // 1. Worker report
  if (customType === 'bot-worker-report' || text.startsWith('[worker report] ')) {
    const m = /^\[worker report\]\s+"([^"]+)"\s+\(([^)]+)\)\s+([^.\n]+)\.?(?:\n+([\s\S]*))?$/.exec(text);
    const name = ev?.name || m?.[1] || 'worker';
    const ref = ev?.ref || m?.[2] || undefined;
    const heading = m?.[3] || ev?.state || 'finished';
    let body = (m ? (m[4] ?? '') : text.replace(/^\[worker report\]\s*/, '')).trim();
    const footers: string[] = [];
    body = body.replace(/\n*(The session is closed; it is no longer watched\.|It has been watched for 24 hours and is no longer watched\.)\s*$/, (_, note: string) => {
      footers.push(note);
      return '';
    }).trim();
    const status = normalizeWorkerStatus(heading, ev?.state);
    const short = !isLongBody(body, 4, 280);
    return {
      kind: 'worker-report',
      icon: '⚙',
      label: 'Worker',
      sender: name,
      ref,
      status: status.label,
      statusTone: status.tone,
      body,
      footer: footers.join(' ') || undefined,
      collapsible: !!body,
      defaultOpen: !!body && short,
    };
  }

  // 2. Family room message
  if (customType === 'bot-room' || text.startsWith('[room] ')) {
    const m = /^\[room\]\s+([^:\n]+?)\s+to\s+([^:\n]+?):\s*([\s\S]*)$/.exec(text);
    let body = (m ? m[3] : text.replace(/^\[room\]\s*/, '')).trim();
    let metaParts: string[] = [];
    body = body.replace(/\n*\(Room message (\d+),\s*hop (\d+) of at most (\d+)\.[^)]*\)\s*$/, (_, msgId: string, hop: string, cap: string) => {
      metaParts = [`#${msgId}`, `hop ${hop}/${cap}`];
      return '';
    }).trim();
    if (!metaParts.length) {
      if (ev?.messageId != null) metaParts.push(`#${ev.messageId}`);
      if (ev?.hop != null) metaParts.push(`hop ${ev.hop}`);
    }
    const sender = ev?.fromName || m?.[1]?.trim() || 'Room';
    const recipients = m?.[2]?.trim();
    const long = isLongBody(body, 10, 700);
    return {
      kind: 'room',
      icon: '⇄',
      label: 'Room',
      sender,
      recipients,
      meta: metaParts.join(' · ') || undefined,
      body,
      collapsible: !!body,
      defaultOpen: !long,
    };
  }

  // 3. Answer from another bot
  if (customType === 'bot-answer' || text.startsWith('[answer from ')) {
    const m = /^\[answer from ([^\]]+)\](?:\s+to your question "([^"]*)")?:\s*([\s\S]*)$/.exec(text);
    const sender = ev?.fromName || m?.[1]?.trim() || 'Bot';
    const question = m?.[2]?.trim() || ev?.question;
    const body = (m ? m[3] : text.replace(/^\[answer from [^\]]+\]:?\s*/, '')).trim();
    const long = isLongBody(body, 10, 700);
    return {
      kind: 'answer',
      icon: '↩',
      label: 'Answer',
      sender,
      question,
      body,
      collapsible: !!body,
      defaultOpen: !long,
    };
  }

  // 4. Question from another bot
  if (customType === 'bot-question' || text.startsWith('[question from ')) {
    const m = /^\[question from ([^,\]]+)(?:,[^\]]*)?\]\s*([\s\S]*)$/.exec(text);
    const sender = ev?.fromName || m?.[1]?.trim() || 'Bot';
    let body = (m ? m[2] : text.replace(/^\[question from [^\]]+\]\s*/, '')).trim();
    body = body.replace(/\n*\(Answer it in this turn:[^)]*\)\s*$/, '').trim();
    const long = isLongBody(body, 10, 700);
    return {
      kind: 'question',
      icon: '?',
      label: 'Question',
      sender,
      body,
      collapsible: !!body,
      defaultOpen: !long,
    };
  }

  // 5. Routine / schedule wake-up
  if (customType === 'bot-routine' || /^\[routine\b/.test(text)) {
    const m = /^\[routine(?:\s+"([^"]+)")?(?:,\s*([^.\]]+))?\.?([^\]]*)\]\s*([\s\S]*)$/.exec(text);
    const name = ev?.routineName || m?.[1]?.trim() || undefined;
    const missed = /missed/i.test(m?.[3] || '');
    const body = (m ? m[4] : text.replace(/^\[routine[^\]]*\]\s*/, '')).trim();
    const long = isLongBody(body, 8, 500);
    return {
      kind: 'routine',
      icon: '⏱',
      label: 'Routine',
      sender: name,
      status: missed ? 'missed run' : undefined,
      statusTone: missed ? 'warn' : undefined,
      body,
      collapsible: !!body,
      defaultOpen: !long,
    };
  }

  if (customType === 'bot-ci') {
    const header = /^\[CI (failure(?: — likely known flake)?|recovered)\]\s*/.exec(text);
    if (header) {
      const recovered = header[1] === 'recovered';
      return {
        kind: 'ci', icon: recovered ? '✓' : '!', label: 'GitHub Actions',
        status: header[1], statusTone: recovered ? 'ok' : 'warn',
        body: text.slice(header[0].length), collapsible: true, defaultOpen: true,
      };
    }
  }

  // 6. System nudges (user-role injections)
  if (!customType && /^The user hasn['’]t heard from you in a while\b/i.test(text)) {
    return {
      kind: 'nudge',
      icon: '⏰',
      label: 'Nudge',
      body: text,
      collapsible: isLongBody(text, 8, 500),
      defaultOpen: !isLongBody(text, 8, 500),
    };
  }
  if (!customType && /^\[pi-dish:\s*([\s\S]+?)\]$/.test(text)) {
    const inner = text.replace(/^\[pi-dish:\s*/, '').replace(/\]$/, '').trim();
    return {
      kind: 'nudge',
      icon: '◇',
      label: 'System',
      body: inner,
      collapsible: isLongBody(inner, 8, 500),
      defaultOpen: !isLongBody(inner, 8, 500),
    };
  }

  // 7. Context window rollover
  if (customType === 'bot-context-window') {
    const m = /^\[Context window (\d+)\.[^\]]*\]\s*([\s\S]*)$/.exec(text);
    const label = m ? `Context window ${m[1]}` : 'New context window';
    const body = (m ? m[2] : text).trim();
    return {
      kind: 'context-window',
      icon: '↻',
      label,
      body,
      collapsible: !!body,
      defaultOpen: false,
    };
  }

  // 8. Sub-bot purpose
  if (customType === 'bot-purpose') {
    const body = text.replace(/^\[pi-dish:[^\]]*\]\s*/, '').trim() || text;
    return {
      kind: 'purpose',
      icon: '✦',
      label: 'Purpose',
      sender: ev?.fromName,
      body,
      collapsible: !!body,
      defaultOpen: !isLongBody(body, 8, 500),
    };
  }

  // 9. Forked notice (quiet single-line)
  if (customType === 'bot-forked') {
    return {
      kind: 'forked',
      icon: '⑂',
      label: ev?.parentName ? `Forked from ${ev.parentName}` : 'Forked',
      meta: ev?.parentName ? undefined : truncate(text, 120),
      body: '',
      collapsible: false,
      defaultOpen: false,
      quiet: true,
    };
  }

  // 10. Restart notice (quiet single-line)
  if (customType === 'bot-restart') {
    const from = details?.from;
    const to = ev?.to;
    const meta = to ? `build ${from ? `${from} → ` : ''}${to}` : truncate(text, 120);
    return {
      kind: 'restart',
      icon: '↻',
      label: 'Restarted',
      meta,
      body: '',
      collapsible: false,
      defaultOpen: false,
      quiet: true,
    };
  }

  return null;
}

export function renderBotNoticeHtml(notice: ParsedBotNotice, opts: {
  attrs: string;
  timestamp: string;
  time: string;
  actionsHtml: string;
  markdown: (text: string) => string;
  matchRef: MatchRefFn;
}): string {
  if (notice.quiet) {
    return `<div${opts.attrs} class="message custom-message bot-notice bot-${notice.kind}" data-timestamp="${escapeHtml(opts.timestamp)}">` +
      `<span class="custom-message-icon">${notice.icon}</span>` +
      `<span class="custom-message-label">${escapeHtml(notice.label)}</span>` +
      (notice.meta ? `<span class="custom-message-meta">${escapeHtml(notice.meta)}</span>` : '') +
      (opts.time ? `<span class="message-time">${opts.time}</span>` : '') +
      `</div>`;
  }

  const senderHtml = notice.sender
    ? `<span class="bot-card-sender">${escapeHtml(notice.sender)}${notice.recipients ? ` <span class="bot-card-arrow">→</span> ${escapeHtml(notice.recipients)}` : ''}</span>`
    : '';
  const refHtml = notice.ref ? renderBotRefChip(notice.ref, opts.matchRef, { label: shortDisplayRef(notice.ref), extraClass: 'bot-card-ref' }) : '';
  const statusHtml = notice.status
    ? `<span class="bot-card-status tone-${notice.statusTone || 'muted'}">${escapeHtml(notice.status)}</span>`
    : '';
  const metaHtml = notice.meta ? `<span class="bot-card-meta">${escapeHtml(notice.meta)}</span>` : '';
  const timeHtml = opts.time ? `<span class="message-time">${opts.time}</span>` : '';
  const preview = notice.collapsible ? bodyPreview(notice.body) : '';
  const previewHtml = preview ? `<span class="bot-card-preview">${escapeHtml(preview)}</span>` : '';

  const questionHtml = notice.question
    ? `<div class="bot-card-question"><span class="bot-card-question-label">Re:</span> ${escapeHtml(notice.question)}</div>`
    : '';
  const bodyHtml = notice.body
    ? `<div class="bot-card-body">${questionHtml}<div class="markdown-body">${opts.markdown(notice.body)}</div>` +
      (notice.footer ? `<div class="bot-card-footer">${escapeHtml(notice.footer)}</div>` : '') +
      `</div>`
    : (notice.footer ? `<div class="bot-card-body"><div class="bot-card-footer">${escapeHtml(notice.footer)}</div></div>` : '');

  const headerInner =
    `<span class="bot-card-icon">${notice.icon}</span>` +
    `<span class="bot-card-label">${escapeHtml(notice.label)}</span>` +
    senderHtml + refHtml + statusHtml + metaHtml + previewHtml + timeHtml + opts.actionsHtml;

  if (notice.collapsible) {
    return `<div${opts.attrs} class="message custom-message bot-card bot-${notice.kind}" data-timestamp="${escapeHtml(opts.timestamp)}">` +
      `<details class="bot-card-details"${notice.defaultOpen ? ' open' : ''}>` +
      `<summary class="bot-card-header">${headerInner}</summary>` +
      bodyHtml +
      `</details></div>`;
  }

  return `<div${opts.attrs} class="message custom-message bot-card bot-${notice.kind}" data-timestamp="${escapeHtml(opts.timestamp)}">` +
    `<div class="bot-card-static">` +
    `<div class="bot-card-header">${headerInner}</div>` +
    bodyHtml +
    `</div></div>`;
}

// ---------------------------------------------------------------------------
// Bot-change line formatting (avoid giant raw JSON places walls)

interface BotPlace { readonly host?: string | null; readonly cwd?: string; readonly label?: string }

function parsePlacesArray(raw: string): BotPlace[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is BotPlace => record(item));
  } catch { return null; }
}

function placeKey(p: BotPlace): string { return `${p.host ?? ''}:${p.cwd ?? ''}`; }
function placeLabel(p: BotPlace): string {
  const where = p.host ? `${p.host}:${p.cwd || ''}` : (p.cwd || '');
  return p.label ? `${p.label}${where ? ` (${where})` : ''}` : where || '(place)';
}

/** Short change lines stay verbatim; giant `places: [...] → [...]` JSON diffs become concise summaries. */
export function formatBotChangeLineHtml(line: string): string {
  if (line.length > 180 && line.startsWith('places: [')) {
    const arrow = line.indexOf('] → [');
    if (arrow > 0) {
      const before = parsePlacesArray(line.slice('places: '.length, arrow + 1));
      const after = parsePlacesArray(line.slice(arrow + 4));
      if (before && after) {
        const beforeMap = new Map(before.map(p => [placeKey(p), p]));
        const afterMap = new Map(after.map(p => [placeKey(p), p]));
        const added = after.filter(p => !beforeMap.has(placeKey(p)));
        const removed = before.filter(p => !afterMap.has(placeKey(p)));
        const renamed = after.filter(p => {
          const prev = beforeMap.get(placeKey(p));
          return prev && prev.label !== p.label;
        });
        const parts: string[] = [];
        for (const p of added) parts.push(`+ ${placeLabel(p)}`);
        for (const p of removed) parts.push(`− ${placeLabel(p)}`);
        for (const p of renamed) parts.push(`~ ${placeLabel(p)}`);
        if (!parts.length) parts.push(`${before.length} → ${after.length} places`);
        return `<span class="bot-change-places">places: ${escapeHtml(parts.join('; '))}</span>`;
      }
    }
  }
  return escapeHtml(line);
}

// ---------------------------------------------------------------------------
// Codemode & JSON tool result formatting

export interface ParsedCodemodeResult {
  readonly ok: boolean;
  readonly wallSeconds: number;
  readonly wallLabel: string;
  readonly output: string;
}

const CODEMODE_HEADER_RE = /^(Script completed|Script failed)\nWall time ([0-9.]+) seconds\nOutput:\n?([\s\S]*)$/;

export function parseCodemodeResult(text: string): ParsedCodemodeResult | null {
  const m = CODEMODE_HEADER_RE.exec(text);
  if (!m) return null;
  const wallSeconds = Number(m[2]);
  const wallLabel = Number.isFinite(wallSeconds) ? `${wallSeconds.toFixed(1)}s` : `${m[2]}s`;
  return { ok: m[1] === 'Script completed', wallSeconds: Number.isFinite(wallSeconds) ? wallSeconds : 0, wallLabel, output: m[3] };
}

export interface FormattedToolOutput {
  readonly html: string;
  readonly preview: string;
  readonly lines: number;
  readonly chars: number;
  readonly kind: 'json' | 'markdown' | 'text' | 'empty';
}

function looksLikeMarkdown(text: string): boolean {
  if (text.length < 16) return false;
  let score = 0;
  if (/^#{1,6}\s+\S/m.test(text)) score += 2;
  if (/```[\w-]*\n/.test(text)) score += 2;
  if (/\[[^\]]+\]\([^)]+\)/.test(text)) score += 1;
  if (/\*\*[^*\n]{2,}\*\*/.test(text)) score += 1;
  if (/^[-*]\s+\S/m.test(text)) score += 1;
  return score >= 2;
}

function compactJsonPreview(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  if (record(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }`;
  }
  return truncate(String(value), 80);
}

/** Try to pretty-print a JSON object or array tool output into a syntax-highlighted code block. */
export function formatJsonToolOutput(content: string): FormattedToolOutput | null {
  const trimmed = content.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const pretty = JSON.stringify(parsed, null, 2);
  const shown = truncate(pretty, OUTPUT_LIMIT);
  return {
    html: `<pre class="tool-code"><code class="language-json">${escapeHtml(shown)}</code></pre>`,
    preview: compactJsonPreview(parsed),
    lines: pretty.split('\n').length,
    chars: pretty.length,
    kind: 'json',
  };
}

/** Format a codemode script's Output body as pretty-printed JSON, Markdown, or plain text. */
export function formatCodemodeOutput(rawOutput: string, markdown: (text: string) => string): FormattedToolOutput {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return { html: '<div class="tool-result-empty">(no output)</div>', preview: '(no output)', lines: 1, chars: 0, kind: 'empty' };
  }
  const asJson = formatJsonToolOutput(trimmed);
  if (asJson) return asJson;
  // Unwrap a JSON-stringified string (e.g. "line1\nline2") so escaped newlines become readable.
  if (trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string') return formatCodemodeOutput(parsed, markdown);
    } catch {}
  }
  if (looksLikeMarkdown(trimmed)) {
    const shown = truncate(trimmed, OUTPUT_LIMIT);
    return {
      html: `<div class="tool-result-markdown markdown-body">${markdown(shown)}</div>`,
      preview: bodyPreview(trimmed) || truncate(trimmed.split('\n')[0], 80),
      lines: trimmed.split('\n').length,
      chars: trimmed.length,
      kind: 'markdown',
    };
  }
  const shown = truncate(trimmed, OUTPUT_LIMIT);
  return {
    html: `<pre>${escapeHtml(shown)}</pre>`,
    preview: truncate(trimmed.split('\n')[0], 80),
    lines: trimmed.split('\n').length,
    chars: trimmed.length,
    kind: 'text',
  };
}

// ---------------------------------------------------------------------------
// Bot tool-call expanded body (structured metadata + readable prose instead of escaped JSON)

const BOT_TOOLS: Readonly<Record<string, true>> = {
  spawn_worker: true, sessions: true, context_notes: true, new_context: true, history: true,
  kb_search: true, kb_read: true, kb_write: true, bots: true, bot_update: true, bot_create: true,
  room_post: true, room_read: true, ask_bot: true, schedule: true,
};

const TEXT_FIELDS: Readonly<Record<string, true>> = {
  brief: true, message: true, text: true, question: true, identity: true, prompt: true, purpose: true,
};

export function botToolCallBodyHtml(
  name: string | undefined,
  args: Readonly<Record<string, unknown>>,
  matchRef?: MatchRefFn,
  markdown?: (text: string) => string,
): string | null {
  if (!name || !BOT_TOOLS[name]) return null;
  const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '<div class="tool-call-intent">(no arguments)</div>';

  const kvRows: string[] = [];
  const textBlocks: string[] = [];
  for (const [key, value] of entries) {
    if (TEXT_FIELDS[key] && typeof value === 'string') {
      const trimmed = value.trim();
      const body = markdown && looksLikeMarkdown(trimmed)
        ? `<div class="tool-kv-markdown markdown-body">${markdown(truncate(trimmed, OUTPUT_LIMIT))}</div>`
        : `<pre class="tool-kv-pre">${escapeHtml(truncate(trimmed, OUTPUT_LIMIT))}</pre>`;
      textBlocks.push(`<div class="tool-kv-text"><div class="tool-kv-text-label">${escapeHtml(key)}</div>${body}</div>`);
      continue;
    }
    if (key === 'ref' && typeof value === 'string') {
      const chip = matchRef
        ? renderBotRefChip(value, matchRef, { label: shortDisplayRef(value) })
        : `<code>${escapeHtml(shortDisplayRef(value))}</code>`;
      kvRows.push(`<div class="tool-kv-row"><span class="tool-kv-key">ref</span><span class="tool-kv-val">${chip}</span></div>`);
      continue;
    }
    if (key === 'places' && Array.isArray(value)) {
      const items = value
        .filter((item): item is BotPlace => record(item))
        .map(p => `<li>${escapeHtml(placeLabel(p))}</li>`)
        .join('');
      if (items) {
        textBlocks.push(`<div class="tool-kv-text"><div class="tool-kv-text-label">places</div><ul class="tool-kv-list">${items}</ul></div>`);
        continue;
      }
    }
    const formatted = Array.isArray(value)
      ? value.map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : JSON.stringify(item)).join(', ')
      : typeof value === 'object' ? JSON.stringify(value) : String(value);
    kvRows.push(`<div class="tool-kv-row"><span class="tool-kv-key">${escapeHtml(key)}</span><span class="tool-kv-val"><code>${escapeHtml(truncate(formatted, 200))}</code></span></div>`);
  }

  return (kvRows.length ? `<div class="tool-kv">${kvRows.join('')}</div>` : '') + textBlocks.join('');
}
