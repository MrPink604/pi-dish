import type { SessionState } from './session-state';
import type { Timestamp, RefContextEntry } from './shared-helper-types';
import type { RenderMessage, MessageBlock, AdvisorNote } from './message-data';
import { decodeRenderMessage } from './message-data';
import type { createResponseDetails } from './response-details';
import { escapeHtml, formatTime, formatDuration, truncate } from './helper-format';
import { extractImageBlocks, extractTextContent, messageHasVisibleText, getToolSummary, parseIpythonResult } from './helper-content';
import { splitSessionRefContext } from './helper-refs';
export function createMessageRenderer(options: {
  document: Document; sessionState: SessionState; details: ReturnType<typeof createResponseDetails>;
  markdown: (text: string) => string; assetUrl: (host: string | null | undefined, path: string) => string;
  matchRef: (ref: string) => { name?: string | null; isActive?: boolean } | null | undefined;
  pinned: (container: HTMLElement) => boolean; follow: () => boolean; scroll: (container: HTMLElement) => void; jump: (container: HTMLElement) => void;
}) {
  const { document } = options; let disposed = false;
function renderMessageHtml(msg: RenderMessage) {
  const time = msg.timestamp ? formatTime(msg.timestamp) : '';
  // The stream index rides on the root element — dedup, tool grouping, and
  // search jumps all key on data-msg-index. Passed into the renderers rather
  // than string-spliced into their output afterwards.
  const idxAttr = (msg.index != null) ? ` data-msg-index="${escapeHtml(msg.index)}"` : '';
  if (msg.role === 'user') return renderUserMessage(msg, time, idxAttr);
  if (msg.role === 'assistant') {
    // OMP persists an empty assistant shell when thinking is interrupted. The
    // following interrupted-thinking marker carries the useful UI; avoid a
    // stray π header while preserving the message/index in the API.
    if (Array.isArray(msg.content) && msg.content.length === 0 && !msg.errorMessage) return '';
    return renderAssistantMessage(msg, time, { attrs: idxAttr });
  }
  if (msg.role === 'toolResult') return renderToolResult(msg, time, idxAttr);
  if (msg.role === 'branchSummary') return renderBranchSummary(msg, time, idxAttr);
  if (msg.role === 'custom') return renderCustomMessage(msg, time, idxAttr);
  return '';
}

function imageBlocksHtml(content: unknown, alt = 'image') {
  const images = extractImageBlocks(content);
  if (!images.length) return '';
  const imgs = images.map(img => {
    const src = img.url
      ? options.assetUrl(options.sessionState.currentSession?.host, img.url)
      : `data:${img.mimeType};base64,${img.data}`;
    const loading = img.url ? ' loading="lazy" decoding="async"' : '';
    return `<img class="msg-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${loading}>`;
  }).join('');
  return `<div class="msg-images">${imgs}</div>`;
}

// Hover 🔗 on a turn header: copies the public share URL deep-linked to this
// message (pi's HTML export scrolls to ?targetId=<JSONL entry id>). Only
// JSONL-backed messages have an entry id — streaming placeholders don't.
function messageLinkBtnHtml(msg: RenderMessage) {
  if (!msg.id || options.sessionState.currentSession?.capabilities?.export === false) return '';
  return `<button type="button" class="msg-link-btn" data-entry-id="${escapeHtml(msg.id)}" title="Copy share link to this message">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg></button>`;
}

// The <session-refs> block the send routes append is context for the model,
// not for the reader: the transcript hides it and shows one chip per ref,
// which opens the session it names. Optimistic bubbles carry the same entries
// on `msg.sessionRefs` — the server's copy only arrives with the echo, and by
// then the echo has been suppressed.
function sessionRefChipsHtml(refs?: readonly RefContextEntry[]) {
  if (!refs || !refs.length) return '';
  const chips = refs.map((entry) => {
    const session = options.matchRef(entry.ref);
    const label = entry.name || session?.name || entry.ref;
    const live = (session ? session.isActive : entry.isActive) ? ' live' : '';
    const title = [entry.ref, entry.host, entry.cwd].filter(Boolean).join(' · ');
    return `<button type="button" class="session-ref-chip${live}" data-session-ref="${escapeHtml(entry.ref)}" title="${escapeHtml(title)}">
      <span class="session-ref-dot">●</span>${escapeHtml(label)}</button>`;
  }).join('');
  return `<div class="session-ref-chips">${chips}</div>`;
}

// OMP peer messages arrive in two wire shapes: a visible `irc:incoming`
// custom_message whose details carry the clean sender/body (its content keeps
// the full <irc> envelope as fallback), and — when delivery interrupted a
// wait — a plain user message with a fixed "Current interruptible wait
// interrupted" envelope. Both render as one IRC card so a peer note never
// poses as a prompt typed by the user.
interface IrcEnvelope { from?: string; body: string }

function parseIrcInterrupt(text: string): IrcEnvelope | null {
  const match = /^Current interruptible wait interrupted: IRC message from (?:parent )?agent `([^`]+)`\.\n\n(?:Parent )?IRC message:\n\n([\s\S]+)$/.exec(text);
  return match ? { from: match[1], body: match[2] } : null;
}

function parseIrcCustomContent(text: string): IrcEnvelope | null {
  const inner = text.replace(/^<irc>\n?/, '').replace(/\n?<\/irc>\s*$/, '');
  const match = /^Incoming IRC message from (?:parent )?agent `([^`]+)`:\n\n([\s\S]+)$/.exec(inner);
  if (!match) return inner.trim() ? { body: inner.trim() } : null;
  // The envelope appends delivery guidance for the model; it is noise for the
  // reader, and details.message (the preferred source) already excludes it.
  const body = match[2]
    .replace(/\n*Sent while waiting\/working\.[\s\S]*$/, '')
    .replace(/\n*If response expected, reply via `hub`[\s\S]*$/, '')
    .trim();
  return { from: match[1], body };
}

function renderIrcMessage(msg: RenderMessage, time: string, attrs: string, timestamp: Timestamp, envelope: IrcEnvelope | null) {
  const from = msg.details?.from || envelope?.from || '';
  const body = msg.details?.message || envelope?.body || '';
  return `<div${attrs} class="message custom-message irc" data-timestamp="${escapeHtml(String(timestamp))}">
    <div class="irc-card">
      <div class="irc-header">
        <span class="irc-icon">⇄</span>
        <span class="irc-label">IRC</span>
        ${from ? `<span class="irc-from">${escapeHtml(from)}</span>` : ''}
        ${time ? `<span class="message-time">${time}</span>` : ''}
        ${messageLinkBtnHtml(msg)}
      </div>
      ${body ? `<div class="irc-body"><div class="markdown-body">${options.markdown(body)}</div></div>` : ''}
    </div>
  </div>`;
}

function renderUserMessage(msg: RenderMessage, time: string, attrs = '') {
  const rawText = extractTextContent(msg.content);
  const irc = parseIrcInterrupt(rawText);
  if (irc) return renderIrcMessage(msg, time, attrs, msg.timestamp || Date.now(), irc);
  const { text, refs } = splitSessionRefContext(rawText);
  const imagesHtml = imageBlocksHtml(msg.content, 'attached image');
  const chipsHtml = sessionRefChipsHtml(msg.sessionRefs || refs);
  return `<div${attrs} class="message user">
    <div class="message-header"><span class="message-role user">❯</span>${time ? `<span class="message-time">${time}</span>` : ''}${messageLinkBtnHtml(msg)}</div>
    <div class="message-content user-content">${text ? `<div class="markdown-body">${options.markdown(text)}</div>` : ''}${imagesHtml}${chipsHtml}</div>
  </div>`;
}

function renderAssistantMessage(msg: RenderMessage, time: string, opts: { streaming?: boolean; attrs?: string } = {}) {
  let thinkingHtml = '', textHtml = '', toolCallsHtml = '';
  const timestamp = msg.timestamp || Date.now();
  const streamingClass = opts.streaming ? ' streaming' : '';
  const streamingAttr = opts.streaming ? ' data-streaming="true"' : '';
  
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (typeof block === 'string') continue;
      if (block.type === 'thinking' && block.thinking) thinkingHtml += renderThinkingBlock(block.thinking);
      else if (block.type === 'text' && block.text) textHtml += options.markdown(block.text);
      else if (block.type === 'toolCall') toolCallsHtml += renderToolCall(block);
    }
  } else if (typeof msg.content === 'string') {
    textHtml = options.markdown(msg.content);
  }
  
  // Show error messages from the API (e.g. 402, rate limits, etc.)
  let errorHtml = '';
  if (msg.errorMessage) {
    errorHtml = `<div class="message-content message-error"><div class="markdown-body"><strong>Error:</strong> ${escapeHtml(msg.errorMessage)}</div></div>`;
  }
  
  const showModel = msg.model && (!options.sessionState.currentSession || msg.model !== options.sessionState.currentSession.model);
  // Tool-only messages (no prose, no error) are fully hidden in focus mode —
  // without this their empty header row lingers as a stray marker.
  const noTextClass = messageHasVisibleText(msg) ? '' : ' no-text';
  // Effective response speed rides the header next to the time — JSONL-backed
  // renders only (streaming messages have no timing until finalized).
  let speedHtml = '';
  const hasMetadata = !opts.streaming && (msg.usage || msg.durationMs);
  if (hasMetadata) speedHtml = options.details.button(msg);

  return `<div${opts.attrs || ''} class="message assistant${streamingClass}${noTextClass}${msg.errorMessage ? ' error' : ''}" data-timestamp="${escapeHtml(String(timestamp))}"${streamingAttr}>
    <div class="message-header">
      <span class="message-role assistant">π</span>
      ${showModel ? `<span class="badge">${escapeHtml(msg.model)}</span>` : ''}
      ${opts.streaming ? '<span class="badge streaming">●</span>' : ''}
      ${speedHtml}
      ${time ? `<span class="message-time">${time}</span>` : ''}
      ${messageLinkBtnHtml(msg)}
    </div>
    ${thinkingHtml}${toolCallsHtml}
    ${textHtml ? `<div class="message-content"><div class="markdown-body">${textHtml}</div></div>` : ''}
    ${errorHtml}
  </div>`;
}

function renderThinkingBlock(thinking: string) {
  const preview = thinking.substring(0, 80).replace(/\n/g, ' ');
  return `<details class="thinking-block">
    <summary class="thinking-header"><span class="thinking-label">Thinking</span><span class="thinking-preview">${escapeHtml(preview)}…</span></summary>
    <div class="thinking-text">${escapeHtml(thinking)}</div>
  </details>`;
}

function renderToolCall(block: MessageBlock) {
  const args = block.arguments || {};
  const summary = getToolSummary(block.name || '', args);
  // Prime's ipython tool takes one `code` argument; the raw JSON wrapper
  // around it is noise. Other tools keep the JSON dump.
  const bodyHtml = block.name === 'ipython' && typeof args.code === 'string'
    ? `<pre><code>${escapeHtml(args.code)}</code></pre>`
    : `<pre><code>${escapeHtml(JSON.stringify(args, null, 2))}</code></pre>`;

  return `<details class="tool-call">
    <summary class="tool-call-header">
      <span class="tool-call-icon">⚡</span><span class="tool-call-name">${escapeHtml(block.name)}</span>
      ${summary ? `<span class="tool-call-summary">${escapeHtml(summary)}</span>` : ''}
    </summary>
    <div class="tool-call-content">${bodyHtml}</div>
  </details>`;
}

function renderToolResult(msg: RenderMessage, time: string, attrs = '') {
  let content = extractTextContent(msg.content);
  const isError = msg.isError;
  const timestamp = msg.timestamp || Date.now();
  // Prime's ipython results are a BashResult repr; show the wrapped command
  // output (and a nonzero-exit chip) instead of the Python repr.
  const parsed = parseIpythonResult(content);
  let exitBadge = '';
  if (parsed) {
    content = parsed.output;
    if (parsed.exitCode !== 0) exitBadge = `<span class="tool-result-meta error-badge">exit ${parsed.exitCode}</span>`;
  }
  const lines = content.split('\n');
  const lineCount = lines.length;
  const preview = truncate(lines[0], 80);
  // A tool result carrying an image (e.g. a `read` on a PNG) opens by default
  // regardless of line count — seeing the image is the point — and flags it in
  // the header meta so it's discoverable when collapsed.
  const images = extractImageBlocks(msg.content);
  const imageCount = images.length;
  const imagesHtml = imageBlocksHtml(msg.content, 'tool result image');

  return `<div${attrs} class="message tool-result ${isError ? 'error' : ''}" data-timestamp="${escapeHtml(String(timestamp))}">
    <details class="tool-result-details" ${(lineCount <= 5 || imageCount) ? 'open' : ''}>
      <summary class="tool-result-header">
        <span class="tool-result-icon">${isError ? '✗' : '✓'}</span>
        <span class="tool-result-name">${escapeHtml(msg.toolName || 'result')}</span>
        ${lineCount > 5 ? `<span class="tool-result-meta">${lineCount} lines</span>` : ''}
        ${imageCount ? `<span class="tool-result-meta">${imageCount === 1 ? 'image' : imageCount + ' images'}</span>` : ''}
        ${exitBadge}
        ${isError ? '<span class="tool-result-meta error-badge">error</span>' : ''}
        ${lineCount > 5 ? `<span class="tool-result-preview">${escapeHtml(preview)}</span>` : ''}
      </summary>
      <div class="tool-result-content"><pre>${escapeHtml(truncate(content, 2000))}</pre>${imagesHtml}</div>
    </details>
  </div>`;
}

// Tree-navigation marker: the summary of an abandoned branch, injected into
// the model's context at this point. Collapsed by default — summaries run
// long — but stays visible in focus mode (it's conversation context, not
// tool noise).
function renderBranchSummary(msg: RenderMessage, time: string, attrs = '') {
  const text = extractTextContent(msg.content);
  const timestamp = msg.timestamp || Date.now();
  const preview = truncate(text.split('\n')[0], 80);
  return `<div${attrs} class="message branch-summary" data-timestamp="${escapeHtml(String(timestamp))}">
    <details class="branch-summary-details">
      <summary class="branch-summary-header">
        <span class="branch-summary-icon">⎇</span>
        <span class="branch-summary-label">Branch summary</span>
        ${time ? `<span class="message-time">${time}</span>` : ''}
        <span class="branch-summary-preview">${escapeHtml(preview)}</span>
      </summary>
      <div class="message-content"><div class="markdown-body">${options.markdown(text)}</div></div>
    </details>
  </div>`;
}

// OMP advisor notes — a second model passively reviewing each turn. The JSONL
// entry carries structured notes in details.notes and an <advisory> XML
// rendering of the same thing in content; prefer the structure, fall back to
// unwrapping the XML so an older/odder producer still reads as prose.
const ADVISOR_SEVERITIES = ['nit', 'concern', 'blocker'];

function advisoryTagAttr(rawAttrs: string, name: string) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(rawAttrs || '');
  return m ? m[1].trim() : '';
}

function normalizeAdvisorSeverity(value: unknown) {
  const sev = String(value || '').trim().toLowerCase();
  return ADVISOR_SEVERITIES.includes(sev) ? sev : '';
}

// Split an <advisory ...>note</advisory> batch into notes. Anything that isn't
// wrapped (or is only half-wrapped) survives as a single unwrapped note rather
// than leaking raw tags into the card.
function parseAdvisoryContent(text: string): AdvisorNote[] {
  const notes = [];
  const re = /<advisory\b([^>]*)>([\s\S]*?)<\/advisory>/gi;
  let m;
  while ((m = re.exec(text))) {
    const note = m[2].trim();
    if (note) notes.push({ note, severity: advisoryTagAttr(m[1], 'severity'), advisor: advisoryTagAttr(m[1], 'advisor') });
  }
  if (notes.length) return notes;
  const bare = String(text || '').replace(/<\/?advisory\b[^>]*>/gi, '').trim();
  return bare ? [{ note: bare }] : [];
}

function advisorNotesFrom(msg: RenderMessage) {
  const structured = Array.isArray(msg.details?.notes) ? msg.details.notes : null;
  const notes = (structured && structured.length ? structured : parseAdvisoryContent(extractTextContent(msg.content)))
    .map(n => ({
      note: n.note,
      severity: normalizeAdvisorSeverity(n.severity),
      advisor: (n.advisor || '').trim(),
    }))
    .filter(n => n.note);
  return notes;
}

// A batch may name its advisor only on the XML wrapper (multi-advisor
// rosters), so fall back to that when the structured notes carry no name.
function advisoryBatchName(msg: RenderMessage) {
  const m = /<advisory\b([^>]*)>/i.exec(extractTextContent(msg.content));
  return m ? advisoryTagAttr(m[1], 'advisor') : '';
}

function advisorSeverityChip(severity: string) {
  if (!severity) return '';
  return `<span class="advisor-severity sev-${severity}">${escapeHtml(severity)}</span>`;
}

// A quiet card, not a boxed callout: hairline left accent tinted by the worst
// severity in the batch, notes rendered as markdown (they carry `code` spans).
// Conversation content, so it stays visible in focus mode.
function renderAdvisorMessage(msg: RenderMessage, time: string, attrs: string, timestamp: Timestamp) {
  const notes = advisorNotesFrom(msg);
  if (!notes.length) return '';
  const worst = ADVISOR_SEVERITIES.filter(s => notes.some(n => n.severity === s)).pop() || '';
  const names = [...new Set(notes.map(n => n.advisor).filter(Boolean))];
  const name = names.length === 1 ? names[0] : (names.length ? '' : advisoryBatchName(msg));
  const single = notes.length === 1;
  const rows = notes.map(n => `<div class="advisor-note">
        ${single ? '' : advisorSeverityChip(n.severity)}${!single && !name && n.advisor ? `<span class="advisor-note-name">${escapeHtml(n.advisor)}</span>` : ''}
        <div class="markdown-body">${options.markdown(n.note)}</div>
      </div>`).join('');
  return `<div${attrs} class="message custom-message advisor${worst ? ` sev-${worst}` : ''}" data-timestamp="${escapeHtml(String(timestamp))}">
    <div class="advisor-card">
      <div class="advisor-header">
        <span class="advisor-icon">◈</span>
        <span class="advisor-label">Advisor${name ? ` · ${escapeHtml(name)}` : ''}</span>
        ${single ? advisorSeverityChip(notes[0].severity) : `<span class="advisor-count">${notes.length} notes</span>`}
        ${time ? `<span class="message-time">${time}</span>` : ''}
      </div>
      <div class="advisor-notes">${rows}</div>
    </div>
  </div>`;
}

// OMP conversational custom messages. interrupted-thinking deliberately
// carries hidden reasoning in JSONL; session-files strips that content and we
// render only this divider. Visible unknown types get a subdued generic row so
// future host additions cannot vanish without explanation.
function renderCustomMessage(msg: RenderMessage, time: string, attrs = '') {
  const customType = msg.customType || 'custom-message';
  const timestamp = msg.timestamp || Date.now();
  if (customType === 'interrupted-thinking') {
    return `<div${attrs} class="message custom-message interrupted" data-timestamp="${escapeHtml(String(timestamp))}">
      <span class="custom-message-divider"></span><span class="custom-message-label">Interrupted</span>${time ? `<span class="message-time">${time}</span>` : ''}<span class="custom-message-divider"></span>
    </div>`;
  }

  // Unknown hidden custom messages are internal model/session continuity.
  // session-files applies the same explicit skip historically; enforce it
  // here too because live bridge events do not pass through that decoder.
  if (msg.display === false) return '';
  if (customType === 'irc:incoming') {
    return renderIrcMessage(msg, time, attrs, timestamp, parseIrcCustomContent(extractTextContent(msg.content)));
  }

  if (customType === 'async-result') {
    const jobs = Array.isArray(msg.details?.jobs) ? msg.details.jobs : [];
    const names = jobs.map(job => job.label || job.jobId).filter(Boolean);
    const duration = jobs.length === 1 && Number.isFinite(jobs[0].durationMs)
      ? formatDuration(jobs[0].durationMs!) : '';
    const meta = [names.join(', '), duration].filter(Boolean).join(' · ');
    return `<div${attrs} class="message custom-message async-result" data-timestamp="${escapeHtml(String(timestamp))}">
      <span class="custom-message-icon">✓</span><span class="custom-message-label">Background job${jobs.length > 1 ? 's' : ''} finished</span>${meta ? `<span class="custom-message-meta">${escapeHtml(meta)}</span>` : ''}${time ? `<span class="message-time">${time}</span>` : ''}
    </div>`;
  }

  if (customType === 'advisor') return renderAdvisorMessage(msg, time, attrs, timestamp);

  const text = extractTextContent(msg.content);
  const label = customType.replace(/[-_]+/g, ' ');
  return `<div${attrs} class="message custom-message generic" data-timestamp="${escapeHtml(String(timestamp))}">
    <span class="custom-message-icon">◇</span><span class="custom-message-label">${escapeHtml(label)}</span>${text ? `<span class="custom-message-meta">${escapeHtml(truncate(text.replace(/\s+/g, ' '), 240))}</span>` : ''}${time ? `<span class="message-time">${time}</span>` : ''}
  </div>`;
}

function liveCustomMessageKey(message: RenderMessage) {
  const jobs = Array.isArray(message?.details?.jobs)
    ? message.details.jobs.map(job => job.jobId).filter(Boolean).join(',') : '';
  return `${message?.customType || 'custom-message'}:${message?.timestamp || jobs}`;
}

function upsertLiveCustomMessage(value: unknown, { streaming = false } = {}) {
  if (disposed) return; const message = decodeRenderMessage(value);
  const container = document.getElementById('messages');
  if (!container) return;
  const wasPinned = options.pinned(container);
  const key = liveCustomMessageKey(message);
  const existing = [...container.querySelectorAll<HTMLElement>('.message.custom-message[data-live-custom-key]')]
    .find(el => el.dataset.liveCustomKey === key);
  const attrs = ` data-live-custom-key="${escapeHtml(key)}"${streaming ? ' data-streaming="true"' : ''}`;
  const tmp = document.createElement('template');
  tmp.innerHTML = renderCustomMessage(message, formatTime(message.timestamp || Date.now()), attrs);
  const el = tmp.content.firstElementChild;
  if (!el) return;
  if (existing) existing.replaceWith(el);
  else container.appendChild(el);
  if (wasPinned || options.follow()) options.scroll(container); else options.jump(container);
}

return { message: (value: unknown) => renderMessageHtml(decodeRenderMessage(value)),
  user: (value: unknown, time: string, attrs = '') => renderUserMessage(decodeRenderMessage(value), time, attrs),
  assistant: (value: unknown, time: string, opts?: { streaming?: boolean; attrs?: string }) => renderAssistantMessage(decodeRenderMessage(value), time, opts),
  custom: (value: unknown, time: string, attrs = '') => renderCustomMessage(decodeRenderMessage(value), time, attrs),
  images: imageBlocksHtml, thinking: renderThinkingBlock, tool: renderToolCall, upsertCustom: upsertLiveCustomMessage,
  dispose() { disposed = true; } };
}
