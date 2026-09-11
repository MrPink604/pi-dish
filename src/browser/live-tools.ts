import type { SessionState, SelectionOwner } from './session-state';
import { record, finite } from './helper-values';
import { escapeHtml, truncate } from './helper-format';
import { parseIpythonResult, getToolSummary, getToolOutputText } from './helper-content';
interface ToolEvent { toolCallId: string; toolName?: string; args?: unknown; startedAt?: string | number; partialResult?: { content?: unknown }; result?: { content?: unknown }; isError: boolean }
function decode(value: unknown): ToolEvent | null {
  if (!record(value) || typeof value.toolCallId !== 'string' || !value.toolCallId) return null;
  return { toolCallId: value.toolCallId, toolName: typeof value.toolName === 'string' ? value.toolName : undefined, args: value.args,
    startedAt: typeof value.startedAt === 'string' || finite(value.startedAt) ? value.startedAt : undefined,
    partialResult: record(value.partialResult) ? { content: value.partialResult.content } : undefined,
    result: record(value.result) ? { content: value.result.content } : undefined, isError: value.isError === true };
}
interface ToolPanel { owner: SelectionOwner; el: HTMLDetailsElement; startTime: number | null; toolName: string; args: unknown }
export function createLiveTools(options: {
  document: Document; sessionState: SessionState; started: (id: string, name: string) => void; finished: (id: string) => void;
  pinned: (root: HTMLElement) => boolean; scroll: (root: HTMLElement) => void; jump: (root: HTMLElement) => void;
  images: (content: unknown, alt: string) => string; mood: (tool: string, args: unknown) => void;
}) {
  const { document, sessionState } = options; let disposed = false;
  const liveToolPanels = new Map<string, ToolPanel>(), retained = new WeakMap<HTMLDetailsElement, ToolPanel>();
  const owns = (owner: SelectionOwner) => !disposed && sessionState.ownsSelection(owner);
  function lookup(id: string): ToolPanel | null {
    const owner = sessionState.captureSelection(), container = document.getElementById('messages'); if (disposed || !owner || !container) return null;
    const matches = (entry: ToolPanel | undefined) => !!entry && entry.owner.id === owner.id && entry.owner.host === owner.host && container.contains(entry.el);
    let entry = liveToolPanels.get(id);
    if (!matches(entry)) entry = Array.from(container.querySelectorAll<HTMLDetailsElement>('details.live-tool-panel')).filter(el => el.dataset.toolCallId === id).map(el => retained.get(el)).find(matches);
    if (!entry || !matches(entry)) return null;
    entry.owner = owner; liveToolPanels.set(id, entry); return entry;
  }
function liveToolOutputHtml(output: string) {
  const parsed = parseIpythonResult(output);
  return escapeHtml(truncate(parsed ? parsed.output : output, 8000));
}

function buildLiveToolPanel(toolCallId: string, toolName: string, args: unknown, output: string, isError: boolean, isComplete: boolean, durationMs: number | null = null, imagesHtml = '') {
  const stateClass = isComplete ? (isError ? 'error' : 'complete') : 'running';
  const summary = getToolSummary(toolName, args);
  const openAttr = (output || imagesHtml) ? ' open' : '';

  let statusHtml = '';
  if (isComplete) {
    if (isError) {
      statusHtml = '<span class="live-tool-status error-label">✗ error</span>';
    } else {
      const dur = durationMs != null ? (durationMs / 1000).toFixed(1) + 's' : '';
      statusHtml = '<span class="live-tool-status success-label">✓</span>' +
        (dur ? '<span class="live-tool-status duration">' + dur + '</span>' : '');
    }
  } else {
    statusHtml = '<span class="live-tool-status running-label">running</span>';
  }

  const cursorHtml = isComplete ? '' : '<span class="live-tool-cursor"></span>';
  const outputHtml = output
    ? '<div class="live-tool-output">' + liveToolOutputHtml(output) + cursorHtml + '</div>'
    : (!isComplete ? '<div class="live-tool-output"><span class="live-tool-cursor"></span></div>' : '');

  return '<details class="live-tool-panel ' + stateClass + '" data-tool-call-id="' + escapeHtml(toolCallId) + '"' + openAttr + '>' +
    '<summary class="live-tool-header">' +
      '<span class="live-tool-icon">⚡</span>' +
      '<span class="live-tool-name">' + escapeHtml(toolName) + '</span>' +
      (summary ? '<span class="live-tool-summary">' + escapeHtml(summary) + '</span>' : '') +
      statusHtml +
      '<span class="live-tool-status-dot"></span>' +
    '</summary>' +
    outputHtml +
    imagesHtml +
  '</details>';
}

function appendLiveToolPanel(data: ToolEvent, { completionOnly = false } = {}): ToolPanel | null {
  const owner = sessionState.captureSelection(); if (disposed || !owner) return null;
  const { toolCallId, toolName, args } = data;
  if (!toolCallId) return null;
  const existing = lookup(toolCallId);
  const resolvedName = toolName || existing?.toolName || 'tool';
  const resolvedArgs = args ?? existing?.args ?? {};
  options.started(toolCallId, resolvedName);
  if (existing?.el?.isConnected && existing.el.classList.contains('running')) {
    return existing; // cumulative/repeated starts never duplicate a panel
  }

  const container = document.getElementById('messages');
  if (!container) return null;

  const wasPinned = options.pinned(container);
  const html = buildLiveToolPanel(toolCallId, resolvedName, resolvedArgs, '', false, false);
  let el: HTMLDetailsElement;
  if (existing?.el?.isConnected) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    el = tmp.firstElementChild as HTMLDetailsElement;
    existing.el.replaceWith(el);
  } else {
    container.insertAdjacentHTML('beforeend', html);
    el = container.lastElementChild as HTMLDetailsElement;
  }

  const parsedStartedAt = finite(data.startedAt)
    ? data.startedAt : (typeof data.startedAt === 'string' ? Date.parse(data.startedAt) : NaN);
  const entry: ToolPanel = {
    owner, el,
    startTime: finite(parsedStartedAt) ? parsedStartedAt : (completionOnly ? null : Date.now()),
    toolName: resolvedName,
    args: resolvedArgs,
  };
  liveToolPanels.set(toolCallId, entry); retained.set(el, entry);
  if (wasPinned) options.scroll(container); else options.jump(container);
  return entry;
}

function updateLiveToolPanel(data: ToolEvent) {
  if (disposed || !sessionState.captureSelection()) return;
  const { toolCallId, partialResult } = data;
  let entry = lookup(toolCallId);
  if (!entry?.el?.isConnected || !entry.el.classList.contains('running')) {
    // OMP may emit completion/background updates without a start, or after
    // turn-end JSONL cleanup removed the original panel. Re-open by id.
    entry = appendLiveToolPanel({
      ...data,
      toolName: data.toolName || entry?.toolName,
      args: data.args ?? entry?.args,
    });
  }
  if (!entry?.el) return;

  const output = getToolOutputText(partialResult);
  // Images derive idempotently from the latest partial result — the whole
  // `.msg-images` row is replaced each update so images never accumulate.
  const imagesHtml = options.images(partialResult && partialResult.content, 'tool result image');
  if (!output && !imagesHtml) return;

  const container = document.getElementById('messages');
  const wasPinned = container ? options.pinned(container) : false;

  let outputEl = entry.el.querySelector<HTMLElement>('.live-tool-output');
  if (output && !outputEl) {
    // Create output area if it doesn't exist
    const cursorHtml = '<span class="live-tool-cursor"></span>';
    outputEl = document.createElement('div');
    outputEl.className = 'live-tool-output';
    outputEl.innerHTML = liveToolOutputHtml(output) + cursorHtml;
    entry.el.appendChild(outputEl);
    // Open the details so output is visible
    entry.el.setAttribute('open', '');
  } else if (output && outputEl) {
    const cursorEl = outputEl.querySelector('.live-tool-cursor');
    outputEl.innerHTML = liveToolOutputHtml(output);
    // Re-add cursor
    if (cursorEl) outputEl.appendChild(cursorEl);
    else outputEl.insertAdjacentHTML('beforeend', '<span class="live-tool-cursor"></span>');
  }

  if (imagesHtml) {
    const existing = entry.el.querySelector('.msg-images');
    if (existing) existing.outerHTML = imagesHtml;
    else entry.el.insertAdjacentHTML('beforeend', imagesHtml);
    entry.el.setAttribute('open', '');
  }

  // Follow output only while the user hasn't scrolled away.
  if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
  if (container && wasPinned) options.scroll(container);
}

function finalizeLiveToolPanel(data: ToolEvent) {
  if (disposed || !sessionState.captureSelection()) return;
  const { toolCallId, toolName, args, result, isError } = data;
  let entry = lookup(toolCallId);
  if (!entry?.el?.isConnected) {
    // Provider-resolved tools can legitimately be completion-only. The same
    // path also recreates a background job panel after turn-end cleanup.
    entry = appendLiveToolPanel(data, { completionOnly: true });
  }
  options.finished(toolCallId);
  const resolvedName = toolName || entry?.toolName || 'tool';
  const resolvedArgs = args ?? entry?.args ?? {};
  options.mood(resolvedName, resolvedArgs);
  if (!entry?.el) return;

  const output = getToolOutputText(result);
  const imagesHtml = options.images(result && result.content, 'tool result image');
  const durationMs = entry.startTime ? (Date.now() - entry.startTime) : null;

  // Rebuild the panel in its final state
  const newHtml = buildLiveToolPanel(toolCallId, resolvedName, resolvedArgs, output, isError, true, durationMs, imagesHtml);
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  const newEl = tmp.firstElementChild as HTMLDetailsElement;

  entry.el.replaceWith(newEl);
  entry.el = newEl; retained.set(newEl, entry);
  entry.toolName = resolvedName;
  entry.args = resolvedArgs;

  // Keep in map for dedup — will be cleaned up on turn_end
}

  function clear(container?: HTMLElement | null) { container?.querySelectorAll('details.live-tool-panel').forEach(el => el.remove()); liveToolPanels.clear(); }
  function finishRunning() {
    for (const entry of liveToolPanels.values()) {
      if (!owns(entry.owner) || !entry.el.classList.contains('running')) continue;
      entry.el.classList.remove('running'); entry.el.classList.add('complete');
      const dot = entry.el.querySelector<HTMLElement>('.live-tool-status-dot'); if (dot) dot.style.display = 'none'; entry.el.querySelector('.live-tool-cursor')?.remove();
    }
  }
  return { append(value: unknown, options?: { completionOnly?: boolean }) { const data = decode(value); return data ? appendLiveToolPanel(data, options) : null; },
    update(value: unknown) { const data = decode(value); if (data) updateLiveToolPanel(data); }, finish(value: unknown) { const data = decode(value); if (data) finalizeLiveToolPanel(data); },
    clear, finishRunning, get count() { return liveToolPanels.size; }, dispose() { if (disposed) return; disposed = true; liveToolPanels.clear(); } };
}
