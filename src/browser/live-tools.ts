import type { SessionState, SelectionOwner } from './session-state';
import { record, finite } from '../core/helper-values';
import { escapeHtml, truncate } from '../core/helper-format';
import { parseIpythonResult, getToolSummary, getToolOutputText } from '../core/helper-content';
import { decodeToolDetails, toolSourceText, bashResultChipsHtml, bashJobAttrs, jobTimeoutMs, waitJobsHtml, formatSpan, WAIT_SAFETY_CAP_MS } from './tool-format';
import type { ToolDetails, WaitJob } from './tool-format';
interface ToolResultData { content?: unknown; details?: unknown }
interface ToolEvent { toolCallId: string; toolName?: string; args?: unknown; intent?: string; startedAt?: string | number; partialResult?: ToolResultData; result?: ToolResultData; isError: boolean }
function decode(value: unknown): ToolEvent | null {
  if (!record(value) || typeof value.toolCallId !== 'string' || !value.toolCallId) return null;
  return { toolCallId: value.toolCallId, toolName: typeof value.toolName === 'string' ? value.toolName : undefined, args: value.args,
    intent: typeof value.intent === 'string' && value.intent ? value.intent : undefined,
    startedAt: typeof value.startedAt === 'string' || finite(value.startedAt) ? value.startedAt : undefined,
    partialResult: record(value.partialResult) ? { content: value.partialResult.content, details: value.partialResult.details } : undefined,
    result: record(value.result) ? { content: value.result.content, details: value.result.details } : undefined, isError: value.isError === true };
}
/** Latest wait snapshot and when it arrived, so clocks advance between progress frames. */
interface WaitSnapshot { jobs: readonly WaitJob[]; receivedAt: number }
interface ToolPanel { owner: SelectionOwner; el: HTMLDetailsElement; startTime: number | null; toolName: string; args: unknown; intent?: string; wait?: WaitSnapshot }
export function createLiveTools(options: {
  document: Document; sessionState: SessionState; started: (id: string, name: string) => void; finished: (id: string) => void;
  pinned: (root: HTMLElement) => boolean; scroll: (root: HTMLElement) => void; jump: (root: HTMLElement) => void;
  images: (content: unknown, alt: string) => string; mood: (tool: string, args: unknown) => void;
}) {
  const { document, sessionState } = options; let disposed = false;
  const liveToolPanels = new Map<string, ToolPanel>(), retained = new WeakMap<HTMLDetailsElement, ToolPanel>();
  const owns = (owner: SelectionOwner) => !disposed && sessionState.ownsSelection(owner);
  let waitTicker: ReturnType<typeof setInterval> | undefined;
  function lookup(id: string): ToolPanel | null {
    const owner = sessionState.captureSelection(), container = document.getElementById('messages'); if (disposed || !owner || !container) return null;
    const matches = (entry: ToolPanel | undefined) => !!entry && entry.owner.id === owner.id && entry.owner.host === owner.host && container.contains(entry.el);
    let entry = liveToolPanels.get(id);
    if (!matches(entry)) entry = Array.from(container.querySelectorAll<HTMLDetailsElement>('details.live-tool-panel')).filter(el => el.dataset.toolCallId === id).map(el => retained.get(el)).find(matches);
    if (!entry || !matches(entry)) return null;
    entry.owner = owner; liveToolPanels.set(id, entry); return entry;
  }
function kernelSummary(toolName: string, args: unknown, intent?: string) {
  const summary = getToolSummary(toolName, args);
  if (summary) return summary;
  if ((toolName !== 'eval' && toolName !== 'ipython') || typeof intent !== 'string') return '';
  return intent.trim() ? truncate(intent.trim(), 60) : '';
}
function sourceBlockHtml(toolName: string, source: string) {
  const command = toolName === 'bash' || toolName === 'Bash';
  return '<div class="live-tool-code' + (command ? ' command' : '') + '"><pre>' + escapeHtml(truncate(source, 8000)) + '</pre></div>';
}
function syncKernelPreview(el: HTMLDetailsElement, toolName: string, args: unknown, intent?: string) {
  const summary = kernelSummary(toolName, args, intent);
  let summaryEl = el.querySelector('.live-tool-summary');
  if (summary) {
    if (!summaryEl) {
      el.querySelector('.live-tool-name')?.insertAdjacentHTML('afterend', '<span class="live-tool-summary"></span>');
      summaryEl = el.querySelector('.live-tool-summary');
    }
    if (summaryEl) summaryEl.textContent = summary;
  }
  const source = toolSourceText(toolName, args, intent);
  if (!source) return;
  const html = sourceBlockHtml(toolName, source);
  const codeEl = el.querySelector('.live-tool-code');
  if (codeEl) codeEl.outerHTML = html;
  else {
    const outputEl = el.querySelector('.live-tool-output');
    if (outputEl) outputEl.insertAdjacentHTML('beforebegin', html);
    else el.insertAdjacentHTML('beforeend', html);
  }
  el.setAttribute('open', '');
}
function liveToolOutputHtml(output: string) {
  const parsed = parseIpythonResult(output);
  return escapeHtml(truncate(parsed ? parsed.output : output, 8000));
}

/**
 * Clocks for a live wait: each running job's elapsed time and the time left
 * before its bash timeout kills it, plus the soonest moment the wait itself
 * must return (first job deadline or OMP's safety cap).
 */
function waitClock(entry: ToolPanel, now: number) {
  const container = document.getElementById('messages');
  const drift = entry.wait ? now - entry.wait.receivedAt : 0;
  let soonest = entry.startTime != null ? entry.startTime + WAIT_SAFETY_CAP_MS - now : null;
  const clocks = new Map<string, { elapsedMs: number; leftMs: number | null; noDeadline: boolean }>();
  for (const job of entry.wait?.jobs || []) {
    if (job.status !== 'running') continue;
    const elapsedMs = (job.durationMs ?? 0) + drift;
    const timeoutMs = jobTimeoutMs(container, job.id);
    const leftMs = timeoutMs ? Math.max(0, timeoutMs - elapsedMs) : null;
    if (leftMs != null && (soonest == null || leftMs < soonest)) soonest = leftMs;
    clocks.set(job.id, { elapsedMs, leftMs, noDeadline: timeoutMs === 0 });
  }
  return { clocks, soonest: soonest == null ? null : Math.max(0, soonest) };
}
function renderWait(entry: ToolPanel) {
  const el = entry.el, { clocks, soonest } = waitClock(entry, Date.now());
  let chip = el.querySelector<HTMLElement>('.live-tool-status.wait-left');
  if (soonest != null) {
    if (!chip) {
      el.querySelector('.live-tool-status.running-label')?.insertAdjacentHTML('afterend', '<span class="live-tool-status wait-left"></span>');
      chip = el.querySelector<HTMLElement>('.live-tool-status.wait-left');
    }
    if (chip) {
      chip.textContent = '⏱ ' + formatSpan(soonest) + ' left';
      chip.title = 'Latest return: the first watched job deadline or the 30-minute wait cap';
      chip.classList.toggle('soon', soonest < 60_000);
    }
  } else chip?.remove();
  if (!entry.wait?.jobs.length) return;
  const html = waitJobsHtml(entry.wait.jobs, job => clocks.get(job.id) ?? null);
  const jobsEl = el.querySelector('.live-wait-jobs');
  if (jobsEl) jobsEl.innerHTML = html;
  else { el.insertAdjacentHTML('beforeend', '<div class="live-wait-jobs">' + html + '</div>'); el.setAttribute('open', ''); }
}
function runningWaits() {
  return [...liveToolPanels.values()].filter(entry => entry.toolName === 'wait' && owns(entry.owner) && entry.el.isConnected && entry.el.classList.contains('running'));
}
function tickWaits() {
  const waits = runningWaits();
  if (!waits.length || disposed) { clearInterval(waitTicker); waitTicker = undefined; return; }
  for (const entry of waits) renderWait(entry);
}
function syncWait(entry: ToolPanel) {
  if (entry.toolName !== 'wait' || !entry.el.classList.contains('running')) return;
  renderWait(entry);
  waitTicker ??= setInterval(tickWaits, 1000);
}

function buildLiveToolPanel(toolCallId: string, toolName: string, args: unknown, output: string, isError: boolean, isComplete: boolean, durationMs: number | null = null, imagesHtml = '', intent?: string, details?: ToolDetails) {
  const stateClass = isComplete ? (isError ? 'error' : 'complete') : 'running';
  const summary = kernelSummary(toolName, args, intent);
  const source = toolSourceText(toolName, args, intent);
  const waitJobs = details?.kind === 'wait' && details.jobs.length ? details.jobs : null;
  const openAttr = (output || imagesHtml || source || waitJobs) ? ' open' : '';

  let statusHtml = '';
  if (isComplete) {
    const chip = (text: string, cls = '', title = '') =>
      '<span class="live-tool-status' + (cls ? ' ' + cls : '') + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + escapeHtml(text) + '</span>';
    statusHtml = isError ? chip('✗ error', 'error-label') : chip('✓', 'success-label');
    // OMP's measured wall time beats the client clock (which also counts
    // event delivery); without either, no duration is invented.
    if (details?.kind === 'bash' && (details.wallTimeMs != null || details.jobId)) statusHtml += bashResultChipsHtml(details, chip);
    else {
      if (durationMs != null) statusHtml += chip(formatSpan(durationMs), 'duration');
      if (details?.kind === 'bash') statusHtml += bashResultChipsHtml(details, chip);
    }
  } else {
    statusHtml = '<span class="live-tool-status running-label">running</span>';
  }

  const cursorHtml = isComplete ? '' : '<span class="live-tool-cursor"></span>';
  // A settled wait reads as job rows; its text content is the model-facing dump of them.
  const outputHtml = waitJobs
    ? '<div class="live-wait-jobs">' + waitJobsHtml(waitJobs) + '</div>'
    : output
      ? '<div class="live-tool-output">' + liveToolOutputHtml(output) + cursorHtml + '</div>'
      : (!isComplete ? '<div class="live-tool-output"><span class="live-tool-cursor"></span></div>' : '');

  return '<details class="live-tool-panel ' + stateClass + '" data-tool-call-id="' + escapeHtml(toolCallId) + '"' +
    (details?.kind === 'bash' ? bashJobAttrs(details) : '') + openAttr + '>' +
    '<summary class="live-tool-header">' +
      '<span class="live-tool-icon">⚡</span>' +
      '<span class="live-tool-name">' + escapeHtml(toolName) + '</span>' +
      (summary ? '<span class="live-tool-summary">' + escapeHtml(summary) + '</span>' : '') +
      statusHtml +
      '<span class="live-tool-status-dot"></span>' +
    '</summary>' +
    (source ? sourceBlockHtml(toolName, source) : '') +
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
  const intent = data.intent || existing?.intent;
  options.started(toolCallId, resolvedName);
  if (existing?.el?.isConnected && existing.el.classList.contains('running')) {
    syncKernelPreview(existing.el, resolvedName, resolvedArgs, intent);
    existing.toolName = resolvedName; existing.args = resolvedArgs; existing.intent = intent;
    return existing; // cumulative/repeated starts never duplicate a panel
  }

  const container = document.getElementById('messages');
  if (!container) return null;

  const wasPinned = options.pinned(container);
  const html = buildLiveToolPanel(toolCallId, resolvedName, resolvedArgs, '', false, false, null, '', intent);
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
    intent,
  };
  liveToolPanels.set(toolCallId, entry); retained.set(el, entry);
  if (!completionOnly) syncWait(entry);
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
  const intent = data.intent || entry.intent;
  const resolvedName = data.toolName || entry.toolName;
  const resolvedArgs = data.args ?? entry.args;
  syncKernelPreview(entry.el, resolvedName, resolvedArgs, intent);
  entry.toolName = resolvedName; entry.args = resolvedArgs; entry.intent = intent;

  const details = decodeToolDetails(resolvedName, partialResult?.details);
  if (details?.kind === 'wait') {
    entry.wait = { jobs: details.jobs, receivedAt: Date.now() };
    entry.el.querySelector('.live-tool-output')?.remove();
    syncWait(entry);
  }

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
  const intent = data.intent || entry?.intent;
  options.mood(resolvedName, resolvedArgs);
  if (!entry?.el) return;

  const output = getToolOutputText(result);
  const imagesHtml = options.images(result && result.content, 'tool result image');
  const durationMs = entry.startTime ? (Date.now() - entry.startTime) : null;
  const details = decodeToolDetails(resolvedName, result?.details);

  // Rebuild the panel in its final state
  const newHtml = buildLiveToolPanel(toolCallId, resolvedName, resolvedArgs, output, isError, true, durationMs, imagesHtml, intent, details);
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  const newEl = tmp.firstElementChild as HTMLDetailsElement;

  entry.el.replaceWith(newEl);
  entry.el = newEl; retained.set(newEl, entry);
  entry.toolName = resolvedName;
  entry.args = resolvedArgs;
  entry.intent = intent;
  entry.wait = undefined;

  // Keep in map for dedup — will be cleaned up on turn_end
}

  function clear(container?: HTMLElement | null) { container?.querySelectorAll('details.live-tool-panel').forEach(el => el.remove()); liveToolPanels.clear(); }
  function finishRunning() {
    for (const entry of liveToolPanels.values()) {
      if (!owns(entry.owner) || !entry.el.classList.contains('running')) continue;
      entry.el.classList.remove('running'); entry.el.classList.add('complete');
      const dot = entry.el.querySelector<HTMLElement>('.live-tool-status-dot'); if (dot) dot.style.display = 'none'; entry.el.querySelector('.live-tool-cursor')?.remove();
      entry.el.querySelector('.live-tool-status.wait-left')?.remove();
    }
  }
  return { append(value: unknown, options?: { completionOnly?: boolean }) { const data = decode(value); return data ? appendLiveToolPanel(data, options) : null; },
    update(value: unknown) { const data = decode(value); if (data) updateLiveToolPanel(data); }, finish(value: unknown) { const data = decode(value); if (data) finalizeLiveToolPanel(data); },
    clear, finishRunning, get count() { return liveToolPanels.size; },
    dispose() { if (disposed) return; disposed = true; liveToolPanels.clear(); clearInterval(waitTicker); waitTicker = undefined; } };
}
