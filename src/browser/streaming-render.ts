import type { SessionState, SelectionOwner } from './session-state';
import type { RenderMessage, MessageBlock } from './message-data';
import { formatTime, formatThinkingPreview, formatToolArguments } from './helper-format';
import { getToolSummary, messageHasVisibleText } from '../core/helper-content';

/** How far a streamed markdown block's source has been finalized. */
export interface StreamingBlockState { readonly text: string; readonly stableEnd: number }
/** One incremental frame: `'replace'` carries the whole stable prefix, `'grow'`
 *  only the newly-final delta to insert ahead of the still-changing tail. */
export interface StreamingFrame { readonly mode: 'replace' | 'grow'; readonly stableEnd: number; readonly stableHtml: string; readonly tailHtml: string }

// Streaming markdown keeps finished blocks as live DOM and rebuilds only the
// tail, so it needs the boundary between the two inside one `.markdown-body`.
const TAIL_MARKER = 'md-tail';

function htmlNodes(document: Document, html: string) {
  const template = document.createElement('template'); template.innerHTML = html; return template.content;
}
function tailMarker(body: HTMLElement) {
  for (const node of body.childNodes) if (node.nodeType === 8 && node.nodeValue === TAIL_MARKER) return node as Comment;
  return null;
}

/** Coalesce cumulative frames while retaining block DOM and the frame's selection owner. */
export function createStreamingRenderer(options: {
  document: Document; sessionState: SessionState; markdown: (text: string) => string;
  stream?: (previous: StreamingBlockState | null, text: string) => StreamingFrame | null;
  pinned: (root: HTMLElement) => boolean; scroll: (root: HTMLElement) => void; jump: (root: HTMLElement) => void;
}) {
  const { document, sessionState } = options; const sources = new WeakMap<HTMLElement, string>();
  const textStates = new WeakMap<HTMLElement, StreamingBlockState>();
  let disposed = false, timer: ReturnType<typeof setTimeout> | null = null;
  let scrollFrame: number | null = null, scrollRequest: { container: HTMLElement; owner: SelectionOwner | null; pinned: boolean; scrollTop: number } | null = null;
  let pending: { message: RenderMessage; owner: SelectionOwner } | null = null;
  function queue(message: RenderMessage) {
    const owner = sessionState.captureSelection(); if (disposed || !owner) return;
    pending = { message, owner }; if (!timer) flush();
  }
  function flush() {
    if (timer) clearTimeout(timer); timer = null; const frame = pending; pending = null;
    if (disposed || !frame || !sessionState.ownsSelection(frame.owner)) return;
    try { renderStreamingMessage(frame.message, frame.owner); } catch (error) { console.error('streaming render failed:', error); }
    timer = setTimeout(flush, 80);
  }
  function cancel() { pending = null; if (timer) clearTimeout(timer); timer = null; cancelScroll(); }
  // One scroll/layout pass per animation frame: a burst of streamed frames must
  // not each force a reflow, and a retired frame must not move the feed.
  function scheduleScroll(container: HTMLElement, owner: SelectionOwner | null, wasPinned: boolean, scrollTop: number) {
    scrollRequest = { container, owner, pinned: wasPinned, scrollTop };
    if (scrollFrame != null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null; const request = scrollRequest; scrollRequest = null;
      if (disposed || !request || !sessionState.ownsSelection(request.owner) || !request.container.isConnected) return;
      // A viewport that moved up since the frame was measured is a manual
      // scroll: leave it (and just offer the jump button) rather than yanking it
      // back to the tail.
      if (request.pinned && request.container.scrollTop >= request.scrollTop) options.scroll(request.container);
      else options.jump(request.container);
    });
  }
  function cancelScroll() { scrollRequest = null; cancelAnimationFrame(scrollFrame ?? 0); scrollFrame = null; }
function ensureStreamingElement(container: HTMLElement) {
  let el = container.querySelector<HTMLElement>('.message.assistant[data-streaming="true"]');
  if (el) return el;
  const ts = Date.now();
  container.insertAdjacentHTML('beforeend',
    `<div class="message assistant streaming no-text" data-streaming="true" data-timestamp="${ts}">
      <div class="message-header">
        <span class="message-role assistant">π</span>
        <span class="badge streaming">●</span>
        <span class="message-time">${formatTime(ts)}</span>
      </div>
    </div>`);
  return container.querySelector<HTMLElement>('.message.assistant[data-streaming="true"]');
}

/**
 * Render one streamed text block. `stream` gives the incremental frame; without
 * it (or without marked) the whole block is reparsed, which stays correct for
 * rewritten frames and for constructs whose meaning later text can change.
 */
function renderTextBlock(blockEl: HTMLElement, previous: StreamingBlockState | null, text: string) {
  const body = blockEl.querySelector<HTMLElement>('.markdown-body');
  if (!body) return;
  const frame = text ? options.stream?.(previous, text) || null : null;
  if (!frame) {
    if (text) body.innerHTML = options.markdown(text); else body.replaceChildren();
    textStates.delete(blockEl);
    return;
  }
  const marker = frame.mode === 'grow' ? tailMarker(body) : null;
  if (marker) {
    if (frame.stableHtml) marker.before(htmlNodes(document, frame.stableHtml));
    for (let node = marker.nextSibling; node; ) { const next = node.nextSibling; node.remove(); node = next; }
    if (frame.tailHtml) marker.after(htmlNodes(document, frame.tailHtml));
  } else {
    body.replaceChildren(htmlNodes(document, frame.stableHtml), document.createComment(TAIL_MARKER), htmlNodes(document, frame.tailHtml));
  }
  textStates.set(blockEl, { text, stableEnd: frame.stableEnd });
}

function renderStreamingMessage(message: RenderMessage, owner = sessionState.captureSelection()) {
  if (disposed || !sessionState.ownsSelection(owner)) return;
  const container = document.getElementById('messages');
  if (!container) return;
  // One layout read up front: `pinned()` already forces it, so the scroll
  // snapshot is free here and the deferred pass never touches layout again.
  const wasPinned = options.pinned(container), scrollTop = container.scrollTop;
  const el = ensureStreamingElement(container)!;

  const blocks: readonly (MessageBlock | string)[] = typeof message.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : message.content || [];

  blocks.forEach((block, i) => {
    if (typeof block === 'string') return;
    let blockEl = el.querySelector<HTMLElement>(`[data-block-index="${i}"]`);
    if (blockEl && blockEl.dataset.blockType !== block.type) { blockEl.remove(); blockEl = null; }

    if (block.type === 'thinking') {
      const text = block.thinking || '';
      if (!blockEl) {
        el.insertAdjacentHTML('beforeend',
          `<details class="thinking-block" data-block-index="${i}" data-block-type="thinking">
            <summary class="thinking-header"><span class="thinking-label">Thinking</span><span class="thinking-preview"></span></summary>
            <div class="thinking-text"></div>
          </details>`);
        blockEl = el.querySelector<HTMLElement>(`[data-block-index="${i}"]`);
      }
      if (!blockEl) return;
      if (sources.get(blockEl) !== text) {
        sources.set(blockEl, text);
        blockEl.querySelector('.thinking-preview')!.textContent = formatThinkingPreview(text);
        blockEl.querySelector('.thinking-text')!.textContent = text;
      }
    } else if (block.type === 'text') {
      const text = block.text || '';
      if (!blockEl) {
        el.insertAdjacentHTML('beforeend',
          `<div class="message-content" data-block-index="${i}" data-block-type="text"><div class="markdown-body"></div></div>`);
        blockEl = el.querySelector<HTMLElement>(`[data-block-index="${i}"]`);
      }
      if (!blockEl) return;
      if (sources.get(blockEl) !== text) {
        sources.set(blockEl, text);
        renderTextBlock(blockEl, textStates.get(blockEl) || null, text);
      }
    } else if (block.type === 'toolCall') {
      const args = block.arguments || {};
      if (!blockEl) {
        el.insertAdjacentHTML('beforeend',
          `<details class="tool-call" data-block-index="${i}" data-block-type="toolCall">
            <summary class="tool-call-header">
              <span class="tool-call-icon">⚡</span><span class="tool-call-name"></span>
              <span class="tool-call-summary"></span>
            </summary>
            <div class="tool-call-content"><pre><code></code></pre></div>
          </details>`);
        blockEl = el.querySelector<HTMLElement>(`[data-block-index="${i}"]`);
      }
      if (!blockEl) return;
      const signature = JSON.stringify([block.name, args]);
      if (sources.get(blockEl) !== signature) {
        sources.set(blockEl, signature);
        blockEl.querySelector('.tool-call-name')!.textContent = block.name || 'tool';
        blockEl.querySelector('.tool-call-summary')!.textContent = getToolSummary(block.name || '', args);
        blockEl.querySelector('.tool-call-content code')!.textContent = formatToolArguments(block.name, args);
      }
    }
  });

  // Same predicate as the static renderer (helper-content.ts) — the two maintaining
  // this independently is how they drifted on errorMessage handling.
  el.classList.toggle('no-text', !messageHasVisibleText(message));
  scheduleScroll(container, owner, wasPinned, scrollTop);
}

  return { queue, flush, cancel, render(message: RenderMessage) { renderStreamingMessage(message); }, dispose() { cancel(); disposed = true; } };
}
