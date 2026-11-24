import type { SessionState } from './session-state';
import type { Timestamp, RefContextEntry } from '../core/helper-types';
import type { RenderMessage, MessageBlock, AdvisorNote } from './message-data';
import type { createResponseDetails } from './response-details';
import { escapeHtml, truncate } from '../core/helper-format';
import { assistantRoleHtml, formatTime, formatThinkingPreview, isGeminiAssistant } from './helper-format';
import { sessionSupports } from './helper-identity';
import { toolCallBodyHtml, bashResultChipsHtml, bashJobAttrs, waitJobsHtml, waitStatusSummary, evalResultChipsHtml, codemodeResultChipsHtml, evalTitle, evalBodyHtml, evalActivityHtml, jobDeliveryOutputs, formatSpan } from './tool-format';
import type { WaitJob } from './tool-format';
import {
  parseUserSourceEntries, renderUserSourceHeaderHtml, parseInjectedBotMessage, renderBotNoticeHtml,
  formatBotChangeLineHtml, parseCodemodeResult, formatCodemodeOutput, formatJsonToolOutput,
} from './bot-display';
import {
  parseSpawnWorkerResult, renderAgentRefCard, renderAgentRefChip, type AgentRefSession,
} from './agent-ref';
import { parseReviewResponseMessage } from './review-deck-data';
import { extractImageBlocks, extractVideoBlocks, extractTextContent, messageHasVisibleText, getToolSummary, parseIpythonResult } from '../core/helper-content';
import { mediaFileName } from '../core/helper-media';
import { splitSessionRefContext } from '../core/helper-refs';
import type { RenderVideoPreview } from './video-player';
export function createMessageRenderer(options: {
  document: Document; sessionState: SessionState; details: ReturnType<typeof createResponseDetails>;
  // Peek renders another session's trace: main-session share/details buttons
  // stay out; media host and model context come from the peeked session.
  peek?: () => { id: string; host: string | null; model: string | null } | null;
  markdown: (text: string) => string; assetUrl: (host: string | null | undefined, path: string) => string;
  video: RenderVideoPreview;
  matchRef: (ref: string) => AgentRefSession | null | undefined;
  hydrateRefs?: (root: ParentNode) => void;
  pinned: (container: HTMLElement) => boolean; follow: () => boolean; scroll: (container: HTMLElement) => void; jump: (container: HTMLElement) => void;
}) {
  const { document } = options; let disposed = false;
  const inPeek = !!options.peek;
  const renderHost = (): string | null | undefined =>
    options.peek ? (options.peek()?.host ?? null) : options.sessionState.currentSession?.host;
  const renderModel = (): string | null | undefined =>
    options.peek ? (options.peek()?.model ?? null) : options.sessionState.currentSession?.model;
function renderMessageHtml(msg: RenderMessage) {
  const time = msg.timestamp ? formatTime(msg.timestamp) : '';
  // Dedup, tool grouping and search jumps all key on data-msg-index.
  const idxAttr = (msg.index != null) ? ` data-msg-index="${escapeHtml(msg.index)}"` : '';
  if (msg.role === 'user') return renderUserMessage(msg, time, idxAttr);
  if (msg.role === 'assistant') {
    // OMP persists an empty assistant shell when thinking is interrupted; the
    // following interrupted-thinking marker carries the UI.
    if (typeof msg.content !== 'string' && msg.content?.length === 0 && !msg.errorMessage) return '';
    return renderAssistantMessage(msg, time, { attrs: idxAttr });
  }
  if (msg.role === 'toolResult') return renderToolResult(msg, idxAttr);
  if (msg.role === 'branchSummary') return renderBranchSummary(msg, time, idxAttr);
  if (msg.role === 'custom') return renderCustomMessage(msg, time, idxAttr);
  return '';
}

function imageBlocksHtml(content: unknown, alt = 'image') {
  const images = extractImageBlocks(content);
  if (!images.length) return '';
  const imgs = images.map(img => {
    const src = img.url
      ? options.assetUrl(renderHost(), img.url)
      : `data:${img.mimeType};base64,${img.data}`;
    const loading = img.url ? ' loading="lazy" decoding="async"' : '';
    return `<img class="msg-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${loading}>`;
  }).join('');
  return `<div class="msg-images">${imgs}</div>`;
}

function videoBlocksHtml(content: unknown) {
  const videos = extractVideoBlocks(content);
  if (!videos.length) return '';
  const peek = options.peek?.();
  const sessionId = peek?.id ?? options.sessionState.currentSession?.id;
  const players = videos.flatMap(video => {
    let src = '';
    if (video.url) {
      src = /^(?:https?:|blob:|\/\/)/i.test(video.url) ? video.url : options.assetUrl(renderHost(), video.url);
    } else if (video.path && sessionId) {
      src = options.assetUrl(renderHost(), `/api/sessions/${encodeURIComponent(sessionId)}/file/content?path=${encodeURIComponent(video.path)}`);
    } else if (video.data) {
      src = `data:${video.mimeType};base64,${video.data}`;
    }
    if (!src) return [];
    return [options.video({
      src,
      name: video.name || mediaFileName(video.path || video.url || '', 'video'),
      mimeType: video.mimeType,
      variant: 'inline',
      filePath: video.path ?? null,
    }, { host: renderHost(), sessionId })];
  }).join('');
  return players ? `<div class="msg-videos">${players}</div>` : '';
}

// Share URL deep-linked via ?targetId=<JSONL entry id>; only JSONL-backed
// messages have one.
function messageLinkBtnHtml(msg: RenderMessage) {
  if (!msg.id || inPeek || options.sessionState.currentSession?.capabilities?.export === false) return '';
  return `<button type="button" class="msg-link-btn" data-entry-id="${escapeHtml(msg.id)}" title="Copy share link to this message">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg></button>`;
}

// Branch from a message: ⑂ sits beside 🔗 on hover layouts; touch layouts
// fold both into one ⋯ menu instead of two 17px targets side by side.
function messageActionsHtml(msg: RenderMessage, role: 'user' | 'assistant' | null) {
  const link = messageLinkBtnHtml(msg);
  const branch = role && msg.id && !inPeek && sessionSupports(options.sessionState.currentSession, 'tree')
    ? `<button type="button" class="msg-branch-btn" data-entry-id="${escapeHtml(msg.id)}" data-role="${role}" title="${role === 'user' ? 'Edit &amp; resend from here' : 'Continue from here'}">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
    </svg></button>` : '';
  if (!link && !branch) return '';
  return branch + link + '<button type="button" class="msg-more-btn" title="Message actions" aria-label="Message actions">⋯</button>';
}

// The <session-refs> block is model context: show one chip per ref instead.
// Optimistic bubbles carry the entries on `msg.sessionRefs` (the echo is suppressed).
function sessionRefChipsHtml(refs?: readonly RefContextEntry[]) {
  if (!refs || !refs.length) return '';
  const contextHost = renderHost() ?? null;
  const chips = refs.map((entry) => {
    const session = options.matchRef(entry.ref);
    const label = entry.name || session?.name || entry.ref;
    return renderAgentRefChip({
      ref: entry.ref,
      session: session || (entry.isActive != null ? { isActive: entry.isActive, name: entry.name || undefined, hostLabel: entry.host || undefined } : null),
      label,
      preserveLabel: !!entry.name,
      extraClass: 'session-ref-chip',
      contextHost,
      hostLabel: entry.host || undefined,
    });
  }).join('');
  return `<div class="session-ref-chips">${chips}</div>`;
}

// Peer messages arrive as an `irc:incoming` custom message or an interrupted-wait
// user message; both render as an IRC card so they never pose as user prompts.
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
        ${messageActionsHtml(msg, null)}
      </div>
      ${body ? `<div class="irc-body"><div class="markdown-body">${options.markdown(body)}</div></div>` : ''}
    </div>
  </div>`;
}

// OMP persists expanded ^model mentions as agent annotations in the user's
// text. Keep the human-readable model name in prose, but leave examples in
// code spans/fences untouched. Work on text nodes after markdown has escaped
// raw HTML; inserting into nodeValue cannot turn a model name into markup.
function displayModelMentions(html: string) {
  if (!html.includes('&lt;model agent=')) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('code, pre')) continue;
    const text = node.nodeValue;
    if (text?.includes('<model agent=')) {
      node.nodeValue = text.replace(/<model agent="[a-zA-Z0-9_-]+" name="([^"<>\r\n]+)"\s*\/>/g, (_tag, name: string) => `^${name}`);
    }
  }
  return template.innerHTML;
}

// Antigravity prompts users to "Run /swarm board" when a swarm launches. Turn
// those prose/inline-code mentions into an interactive button that opens pi-dish's
// live Swarm takeover without disturbing fenced code blocks or raw HTML escaping.
function linkifySwarmBoard(html: string) {
  if (!html.includes('/swarm board')) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const parent = node.parentElement;
    if (parent?.closest('pre, a, button')) continue;
    if (node.nodeValue && /\/swarm board\b/i.test(node.nodeValue)) targets.push(node as Text);
  }
  for (const textNode of targets) {
    const parent = textNode.parentElement;
    const raw = textNode.nodeValue || '';
    if (parent?.tagName === 'CODE' && raw.trim().toLowerCase() === '/swarm board' && parent.childNodes.length === 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swarm-board-link';
      btn.dataset.openSwarmBoard = '1';
      btn.title = 'Open live Swarm board';
      btn.textContent = raw.trim();
      parent.replaceWith(btn);
      continue;
    }
    const frag = document.createDocumentFragment();
    const re = /\/swarm board\b/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      if (m.index > last) frag.appendChild(document.createTextNode(raw.slice(last, m.index)));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swarm-board-link';
      btn.dataset.openSwarmBoard = '1';
      btn.title = 'Open live Swarm board';
      btn.textContent = m[0];
      frag.appendChild(btn);
      last = m.index + m[0].length;
    }
    if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)));
    textNode.replaceWith(frag);
  }
  return template.innerHTML;
}

function renderUserMessage(msg: RenderMessage, time: string, attrs = '') {
  const rawText = extractTextContent(msg.content);
  const irc = parseIrcInterrupt(rawText);
  if (irc) return renderIrcMessage(msg, time, attrs, msg.timestamp || Date.now(), irc);
  const botNotice = parseInjectedBotMessage(undefined, rawText);
  if (botNotice) {
    return renderBotNoticeHtml(botNotice, {
      attrs, timestamp: String(msg.timestamp || Date.now()), time, actionsHtml: messageActionsHtml(msg, null),
      markdown: options.markdown, matchRef: options.matchRef, contextHost: renderHost() ?? null,
    });
  }
  const reviewResponse = parseReviewResponseMessage(rawText);
  if (reviewResponse) {
    return `<div${attrs} class="message custom-message review-response-notice" data-timestamp="${escapeHtml(String(msg.timestamp || Date.now()))}" data-review-response-id="${escapeHtml(reviewResponse.reviewId)}">
      <details class="review-response-details">
        <summary class="review-response-summary">
          <span class="review-icon done" aria-hidden="true">✓</span>
          <span class="review-response-title">Review response · ${escapeHtml(reviewResponse.title)}</span>
          ${time ? `<span class="message-time">${time}</span>` : ''}
        </summary>
        ${reviewResponse.body ? `<pre class="review-response-body">${escapeHtml(reviewResponse.body)}</pre>` : ''}
      </details>
    </div>`;
  }
  const { text, refs } = splitSessionRefContext(rawText);
  const imagesHtml = imageBlocksHtml(msg.content, 'attached image');
  const videosHtml = videoBlocksHtml(msg.content);
  const chipsHtml = sessionRefChipsHtml(msg.sessionRefs || refs);
  const sourceEntries = parseUserSourceEntries(text);
  const bodyHtml = sourceEntries
    ? sourceEntries.map(entry =>
      `<div class="user-source-entry">${renderUserSourceHeaderHtml(entry, options.matchRef, renderHost() ?? null)}${entry.body ? `<div class="markdown-body">${displayModelMentions(options.markdown(entry.body))}</div>` : ''}</div>`).join('')
    : (text ? `<div class="markdown-body">${displayModelMentions(options.markdown(text))}</div>` : '');
  return `<div${attrs} class="message user">
    <div class="message-header"><span class="message-role user">❯</span>${time ? `<span class="message-time">${time}</span>` : ''}${messageActionsHtml(msg, 'user')}</div>
    <div class="message-content user-content">${bodyHtml}${imagesHtml}${videosHtml}${chipsHtml}</div>
  </div>`;
}

function renderAssistantMessage(msg: RenderMessage, time: string, opts: { streaming?: boolean; attrs?: string } = {}) {
  let thinkingHtml = '', textHtml = '', toolCallsHtml = '';
  const timestamp = msg.timestamp || Date.now();
  const streamingClass = opts.streaming ? ' streaming' : '';
  const streamingAttr = opts.streaming ? ' data-streaming="true"' : '';
  
  if (msg.content && typeof msg.content !== 'string') {
    for (const block of msg.content) {
      if (typeof block === 'string') continue;
      if (block.type === 'thinking' && block.thinking) thinkingHtml += renderThinkingBlock(block.thinking);
      else if (block.type === 'text' && block.text) textHtml += options.markdown(block.text);
      else if (block.type === 'toolCall') toolCallsHtml += renderToolCall(block);
    }
  } else if (typeof msg.content === 'string') {
    textHtml = options.markdown(msg.content);
  }
  
  const imagesHtml = imageBlocksHtml(msg.content, 'assistant image');
  const videosHtml = videoBlocksHtml(msg.content);
  let errorHtml = '';
  if (msg.errorMessage) {
    errorHtml = `<div class="message-content message-error"><div class="markdown-body"><strong>Error:</strong> ${escapeHtml(msg.errorMessage)}</div></div>`;
  }
  
  const showModel = msg.model && (!renderModel() || msg.model !== renderModel());
  // Tool-only messages (no prose, no error) are fully hidden in focus mode —
  // without this their empty header row lingers as a stray marker.
  const noTextClass = messageHasVisibleText(msg) ? '' : ' no-text';
  // JSONL-backed renders only: streaming messages have no timing until finalized.
  let speedHtml = '';
  const hasMetadata = !inPeek && !opts.streaming && (msg.usage || msg.durationMs);
  if (hasMetadata) speedHtml = options.details.button(msg);
  const gemini = isGeminiAssistant(msg, options.peek ? { model: renderModel() ?? null } : options.sessionState.currentSession);
  return `<div${opts.attrs || ''} class="message assistant${streamingClass}${noTextClass}${msg.errorMessage ? ' error' : ''}" data-timestamp="${escapeHtml(String(timestamp))}"${streamingAttr}>
    <div class="message-header">
      ${assistantRoleHtml(gemini)}
      ${showModel ? `<span class="badge">${escapeHtml(msg.model)}</span>` : ''}
      ${opts.streaming ? '<span class="badge streaming">●</span>' : ''}
      ${speedHtml}
      ${time ? `<span class="message-time">${time}</span>` : ''}
      ${messageActionsHtml(msg, 'assistant')}
    </div>
    ${thinkingHtml}${toolCallsHtml}
    ${textHtml || imagesHtml || videosHtml ? `<div class="message-content">${textHtml ? `<div class="markdown-body">${linkifySwarmBoard(textHtml)}</div>` : ''}${imagesHtml}${videosHtml}</div>` : ''}
    ${errorHtml}
  </div>`;
}

function renderThinkingBlock(thinking: string) {
  return `<details class="thinking-block">
    <summary class="thinking-header"><span class="thinking-label">Thinking</span><span class="thinking-preview">${escapeHtml(formatThinkingPreview(thinking))}</span></summary>
    <div class="thinking-text">${escapeHtml(thinking)}</div>
  </details>`;
}

function renderToolCall(block: MessageBlock) {
  const args = block.arguments || {};
  const summary = getToolSummary(block.name || '', args);
  const bodyHtml = toolCallBodyHtml(block.name, args, { matchRef: options.matchRef, markdown: options.markdown, contextHost: renderHost() ?? null });
  const codeLines = block.name === 'codemode' && typeof args.code === 'string' ? args.code.split('\n').length : 0;

  return `<details class="tool-call">
    <summary class="tool-call-header">
      <span class="tool-call-icon">⚡</span><span class="tool-call-name">${escapeHtml(block.name)}</span>
      ${codeLines > 1 ? `<span class="tool-call-meta">${codeLines} lines</span>` : ''}
      ${summary ? `<span class="tool-call-summary">${escapeHtml(summary)}</span>` : ''}
    </summary>
    ${bodyHtml ? `<div class="tool-call-content">${bodyHtml}</div>` : ''}
  </details>`;
}

function renderToolResult(msg: RenderMessage, attrs = '') {
  let content = extractTextContent(msg.content);
  const isError = msg.isError;
  const timestamp = msg.timestamp || Date.now();
  // Successful spawn_worker results render as an explicit agent-reference card
  // between turns (outside tool-group folding and visible in focus mode).
  if (msg.toolName === 'spawn_worker' && !isError) {
    const spawned = parseSpawnWorkerResult(content);
    if (spawned) {
      const time = msg.timestamp ? formatTime(msg.timestamp) : '';
      return `<div${attrs} class="message agent-ref-message agent-ref-spawn" data-timestamp="${escapeHtml(String(timestamp))}">` +
        renderAgentRefCard({
          ref: spawned.ref,
          session: options.matchRef(spawned.ref),
          fallbackName: spawned.name,
          fallbackHarness: spawned.harness,
          fallbackHost: spawned.host,
          contextHost: renderHost() ?? null,
          hint: { spawnHint: true },
          time,
        }) +
        `</div>`;
    }
  }
  // Prime's ipython results are a BashResult repr; show the wrapped command
  // output (and a nonzero-exit chip) instead of the Python repr.
  const parsed = parseIpythonResult(content);
  let exitBadge = '';
  if (parsed) {
    content = parsed.output;
    if (parsed.exitCode !== 0) exitBadge = `<span class="tool-result-meta error-badge">exit ${parsed.exitCode}</span>`;
  }
  const chip = (text: string, cls = '', title = '') =>
    `<span class="tool-result-meta${cls ? ' ' + cls : ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</span>`;
  const details = msg.toolDetails;
  const isCodemode = msg.toolName === 'codemode' || details?.kind === 'codemode';
  const parsedCodemode = isCodemode ? parseCodemodeResult(content) : null;
  const codemodeFailed = isError || (parsedCodemode !== null && !parsedCodemode.ok);
  const resultChips = details?.kind === 'bash' ? bashResultChipsHtml(details, chip)
    : details?.kind === 'eval' ? evalResultChipsHtml(details, chip)
    : isCodemode ? codemodeResultChipsHtml(details?.kind === 'codemode' ? details : undefined, parsedCodemode, chip) : '';
  const statusShown = !!exitBadge || (details?.kind === 'bash' && ((details.exitCode ?? 0) !== 0 || details.timedOut)) ||
    (details?.kind === 'eval' && details.cells.some(cell => (cell.exitCode ?? 0) !== 0)) ||
    (parsedCodemode !== null && !parsedCodemode.ok);
  const waitJobs = details?.kind === 'wait' && details.jobs.length ? details.jobs : null;
  // An eval call often renders inside a prose message, away from its result;
  // the result carries its title and cell code so it reads on its own.
  const evalDetails = details?.kind === 'eval' && details.cells.length ? details : null;
  const title = evalDetails ? evalTitle(evalDetails) : '';

  const formattedCodemode = isCodemode ? formatCodemodeOutput(parsedCodemode ? parsedCodemode.output : content, options.markdown) : null;
  const formattedJson = !isCodemode && !waitJobs && !evalDetails ? formatJsonToolOutput(content) : null;
  const formatted = formattedCodemode || formattedJson;
  const rawLines = content.split('\n');
  const lineCount = formatted ? formatted.lines : rawLines.length;
  const charCount = formatted ? formatted.chars : content.length;
  const codemodeCallCount = details?.kind === 'codemode' ? details.calls.length : 0;
  const isLong = lineCount > 5 || charCount > 400 || codemodeCallCount > 3;
  const preview = waitJobs ? waitStatusSummary(waitJobs) : (formatted ? formatted.preview : truncate(rawLines[0], 80));
  const showLines = lineCount > 5 && !waitJobs;
  // A tool result carrying an image or video opens by default regardless of line count
  // and flags it in the header meta.
  const images = extractImageBlocks(msg.content);
  const imageCount = images.length;
  const imagesHtml = imageBlocksHtml(msg.content, 'tool result image');
  const videos = extractVideoBlocks(msg.content);
  const videoCount = videos.length;
  const videosHtml = videoBlocksHtml(msg.content);
  // A wait snapshot reads as job rows (status, run time, output) instead of
  // the model-facing markdown dump of the same data.
  const outputHtml = formatted ? formatted.html : `<pre>${escapeHtml(truncate(content, 2000))}</pre>`;
  const bodyHtml = waitJobs ? waitJobsHtml(waitJobs)
    : evalDetails ? evalBodyHtml(evalDetails, outputHtml, true)
    : details?.kind === 'codemode' ? evalActivityHtml(details.calls) + outputHtml
    : outputHtml;

  return `<div${attrs} class="message tool-result ${codemodeFailed ? 'error' : ''}" data-timestamp="${escapeHtml(String(timestamp))}"${details?.kind === 'bash' ? bashJobAttrs(details) : ''}>
    <details class="tool-result-details" ${((!isLong && !waitJobs) || imageCount || videoCount) ? 'open' : ''}>
      <summary class="tool-result-header">
        <span class="tool-result-icon">${codemodeFailed ? '✗' : '✓'}</span>
        <span class="tool-result-name">${escapeHtml(msg.toolName || 'result')}</span>
        ${title ? `<span class="tool-result-title">${escapeHtml(title)}</span>` : ''}
        ${showLines ? `<span class="tool-result-meta">${lineCount} lines</span>` : ''}
        ${imageCount ? `<span class="tool-result-meta">${imageCount === 1 ? 'image' : imageCount + ' images'}</span>` : ''}
        ${videoCount ? `<span class="tool-result-meta">${videoCount === 1 ? 'video' : videoCount + ' videos'}</span>` : ''}
        ${exitBadge}${resultChips}
        ${codemodeFailed && !statusShown ? '<span class="tool-result-meta error-badge">error</span>' : ''}
        ${(isLong && !title) || waitJobs ? `<span class="tool-result-preview">${escapeHtml(preview)}</span>` : ''}
      </summary>
      <div class="tool-result-content">${bodyHtml}${imagesHtml}${videosHtml}</div>
    </details>
  </div>`;
}

// Summary of an abandoned branch injected into model context. Collapsed (long),
// but visible in focus mode since it's conversation context.
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

// Advisor notes: prefer structured details.notes, fall back to unwrapping the
// <advisory> XML in content.
const ADVISOR_SEVERITIES = ['nit', 'concern', 'blocker'];

function advisoryTagAttr(rawAttrs: string, name: string) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(rawAttrs || '');
  return m ? m[1].trim() : '';
}

function normalizeAdvisorSeverity(value: string | undefined) {
  const sev = (value || '').trim().toLowerCase();
  return ADVISOR_SEVERITIES.includes(sev) ? sev : '';
}

// Unwrapped or half-wrapped text survives as a single note rather than leaking
// raw tags into the card.
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
  const structured = msg.details?.notes;
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

// interrupted-thinking's hidden reasoning is stripped; render only a divider.
// Visible unknown types get a generic row so new host types never vanish.
function renderCustomMessage(msg: RenderMessage, time: string, attrs = '') {
  const customType = msg.customType || 'custom-message';
  const timestamp = msg.timestamp || Date.now();
  if (customType === 'interrupted-thinking') {
    return `<div${attrs} class="message custom-message interrupted" data-timestamp="${escapeHtml(String(timestamp))}">
      <span class="custom-message-divider"></span><span class="custom-message-label">Interrupted</span>${time ? `<span class="message-time">${time}</span>` : ''}<span class="custom-message-divider"></span>
    </div>`;
  }

  // Hidden custom messages are internal continuity; enforced here too because
  // live bridge events bypass session-files' decoder.
  if (msg.display === false) return '';
  if (customType === 'irc:incoming') {
    return renderIrcMessage(msg, time, attrs, timestamp, parseIrcCustomContent(extractTextContent(msg.content)));
  }

  if (customType === 'async-result') {
    const jobs = msg.details?.jobs || [];
    // Each job becomes a wait-style row (status, run time, command, output)
    // carved out of the delivery notice the model received.
    const ids = jobs.map((job, i) => job.jobId || job.label || `job ${i + 1}`);
    const outputs = jobDeliveryOutputs(extractTextContent(msg.content), ids);
    const rows: WaitJob[] = jobs.map((job, i) => ({ id: ids[i], type: job.type, status: job.status || 'completed', label: job.label,
      durationMs: job.durationMs, resultText: outputs.get(ids[i]) || undefined, agentId: job.agentId || (job.type === 'task' ? job.jobId : undefined) }));
    const failed = rows.some(row => row.status === 'failed');
    const names = jobs.map(job => job.label || job.jobId).filter(Boolean);
    const duration = jobs.length === 1 && jobs[0].durationMs !== undefined ? formatSpan(jobs[0].durationMs) : '';
    const meta = [names.join(', '), duration].filter(Boolean).join(' · ');
    const outputLines = rows.reduce((n, row) => n + (row.resultText ? row.resultText.split('\n').length : 0), 0);
    return `<div${attrs} class="message custom-message async-result${failed ? ' failed' : ''}" data-timestamp="${escapeHtml(String(timestamp))}">
      <details class="async-result-details"${rows.length && outputLines <= 5 ? ' open' : ''}>
        <summary class="async-result-header"><span class="custom-message-icon">${failed ? '✗' : '✓'}</span><span class="custom-message-label">Background job${jobs.length > 1 ? 's' : ''} ${failed ? 'failed' : 'finished'}</span>${meta ? `<span class="custom-message-meta">${escapeHtml(meta)}</span>` : ''}${time ? `<span class="message-time">${time}</span>` : ''}</summary>
        ${rows.length ? `<div class="async-result-body">${waitJobsHtml(rows)}</div>` : ''}
      </details>
    </div>`;
  }

  if (customType === 'advisor') return renderAdvisorMessage(msg, time, attrs, timestamp);

  // A bot changed its own or a descendant's entry: what changed, and an undo that restores the revision before.
  const change = customType === 'bot-change' ? msg.details?.botChange : undefined;
  if (change) {
    return `<div${attrs} class="message custom-message bot-change" data-timestamp="${escapeHtml(String(timestamp))}">
      <div class="bot-change-header"><span class="custom-message-icon">✎</span><span class="custom-message-label">Changed ${escapeHtml(change.botName)}</span>
        <button class="bot-change-undo" data-bot-id="${escapeHtml(change.botId)}" data-revision="${change.revision}" data-fields="${escapeHtml(change.fields.join(','))}" title="Restore ${escapeHtml(change.fields.join(', '))} from before this change">Undo</button>${time ? `<span class="message-time">${time}</span>` : ''}</div>
      <ul class="bot-change-lines">${change.lines.map(line => `<li>${formatBotChangeLineHtml(line)}</li>`).join('')}</ul>
    </div>`;
  }

  const text = extractTextContent(msg.content);
  const botNotice = parseInjectedBotMessage(customType, text, msg.details);
  if (botNotice) {
    return renderBotNoticeHtml(botNotice, {
      attrs, timestamp: String(timestamp), time, actionsHtml: messageActionsHtml(msg, null),
      markdown: options.markdown, matchRef: options.matchRef, contextHost: renderHost() ?? null,
    });
  }
  const label = customType.replace(/[-_]+/g, ' ');
  return `<div${attrs} class="message custom-message generic" data-timestamp="${escapeHtml(String(timestamp))}">
    <span class="custom-message-icon">◇</span><span class="custom-message-label">${escapeHtml(label)}</span>${text ? `<span class="custom-message-meta">${escapeHtml(truncate(text.replace(/\s+/g, ' '), 240))}</span>` : ''}${time ? `<span class="message-time">${time}</span>` : ''}
  </div>`;
}

function liveCustomMessageKey(message: RenderMessage) {
  const jobs = message.details?.jobs?.map(job => job.jobId).filter(Boolean).join(',') || '';
  return `${message.customType || 'custom-message'}:${message.timestamp || jobs}`;
}

function upsertLiveCustomMessage(message: RenderMessage, { streaming = false } = {}) {
  if (disposed) return;
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
  options.hydrateRefs?.(el);
  if (wasPinned || options.follow()) options.scroll(container); else options.jump(container);
}

return { message: renderMessageHtml, user: renderUserMessage, assistant: renderAssistantMessage, custom: renderCustomMessage,
  images: imageBlocksHtml, videos: videoBlocksHtml, thinking: renderThinkingBlock, tool: renderToolCall, upsertCustom: upsertLiveCustomMessage,
  dispose() { disposed = true; } };
}
