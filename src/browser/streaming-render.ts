import type { SessionState, SelectionOwner } from './session-state';
import { decodeRenderMessage } from './message-data';
import type { RenderMessage } from './message-data';
import { formatTime } from './helper-format';
import { getToolSummary, messageHasVisibleText } from './helper-content';
/** Coalesce cumulative frames while retaining block DOM and the frame's selection owner. */
export function createStreamingRenderer(options: {
  document: Document; sessionState: SessionState; markdown: (text: string) => string;
  pinned: (root: HTMLElement) => boolean; scroll: (root: HTMLElement) => void; jump: (root: HTMLElement) => void;
}) {
  const { document, sessionState } = options; const sources = new WeakMap<HTMLElement, string>();
  let disposed = false, timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { message: RenderMessage; owner: SelectionOwner } | null = null;
  function queue(value: unknown) {
    const owner = sessionState.captureSelection(); if (disposed || !owner) return;
    pending = { message: decodeRenderMessage(value), owner }; if (!timer) flush();
  }
  function flush() {
    if (timer) clearTimeout(timer); timer = null; const frame = pending; pending = null;
    if (disposed || !frame || !sessionState.ownsSelection(frame.owner)) return;
    try { renderStreamingMessage(frame.message, frame.owner); } catch (error) { console.error('streaming render failed:', error); }
    timer = setTimeout(flush, 80);
  }
  function cancel() { pending = null; if (timer) clearTimeout(timer); timer = null; }
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

function renderStreamingMessage(message: RenderMessage, owner = sessionState.captureSelection()) {
  if (disposed || !sessionState.ownsSelection(owner)) return;
  const container = document.getElementById('messages');
  if (!container) return;
  const wasPinned = options.pinned(container);
  const el = ensureStreamingElement(container)!;

  const blocks = Array.isArray(message.content)
    ? message.content
    : (typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : []);

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
        blockEl.querySelector('.thinking-preview')!.textContent = text.substring(0, 80).replace(/\n/g, ' ') + '…';
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
        blockEl.querySelector('.markdown-body')!.innerHTML = options.markdown(text);
      }
    } else if (block.type === 'toolCall') {
      const args = block.arguments || {};
      const argsJson = JSON.stringify(args, null, 2);
      // Match the static renderer: prime's ipython tool shows its `code`
      // argument directly instead of the JSON wrapper.
      const bodyText = block.name === 'ipython' && typeof args.code === 'string' ? args.code : argsJson;
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
        blockEl.querySelector('.tool-call-content code')!.textContent = bodyText;
      }
    }
  });

  // Same predicate as the static renderer (helpers.js) — the two maintaining
  // this independently is how they drifted on errorMessage handling.
  el.classList.toggle('no-text', !messageHasVisibleText(message));
  if (wasPinned) options.scroll(container); else options.jump(container);
}

  return { queue, flush, cancel, render(value: unknown) { renderStreamingMessage(decodeRenderMessage(value)); }, dispose() { cancel(); disposed = true; } };
}
