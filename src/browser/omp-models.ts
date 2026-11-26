import { errorMessage, readJson, type ApiRequest } from './api-client';
import { escapeHtml } from '../core/helper-format';
import { record } from '../core/helper-values';

const PREVIEW_DEBOUNCE_MS = 400;
const PREVIEW_LIMIT = 50;
const SET_FETCH_TIMEOUT_MS = 430_000;
const PREVIEW_FETCH_TIMEOUT_MS = 25_000;
const OFFLINE_WARNING_HOSTS = new Set(['jacobs-macbook-air']);

export interface OmpModelsState {
  readonly available: boolean;
  readonly sha: string;
  readonly enabledModels: readonly string[];
  readonly disabledProviders: readonly string[];
}

export interface OmpPreviewModel {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly selector: string;
  readonly current: boolean;
}

export interface OmpModelsPreview {
  readonly total: number;
  readonly truncated: boolean;
  readonly startupModel: OmpPreviewModel | null;
  readonly models: readonly OmpPreviewModel[];
}

export interface OmpModelsDryRun {
  readonly dryRun: true;
  readonly sha: string;
  readonly changed: boolean;
  readonly diff: string;
}

export interface OmpModelsApplyResult {
  readonly sha: string;
  readonly unchanged: boolean;
  readonly hosts: Readonly<Record<string, string>>;
  readonly allHostsFailed: boolean;
  readonly committed: boolean;
  readonly restartRequired: boolean;
  readonly message: string;
}

export type OmpHostStatusKind = 'ok' | 'warn' | 'error';

export function classifyOmpHostResult(host: string, status: string, allHostsFailed: boolean): OmpHostStatusKind {
  if (status === 'ok') return 'ok';
  if (!allHostsFailed && OFFLINE_WARNING_HOSTS.has(host)) return 'warn';
  return 'error';
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === 'string')) return null;
  return [...value];
}

function decodePreviewModel(value: unknown): OmpPreviewModel | null {
  if (!record(value)) return null;
  const provider = typeof value.provider === 'string' ? value.provider : '';
  const id = typeof value.id === 'string' ? value.id : '';
  if (!provider || !id) return null;
  const name = typeof value.name === 'string' && value.name ? value.name : id;
  const selector = typeof value.selector === 'string' && value.selector ? value.selector : `${provider}/${id}`;
  return { provider, id, name, selector, current: value.current === true };
}

function decodeHostsMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  if (!record(value)) return result;
  for (const [host, status] of Object.entries(value)) {
    if (typeof status === 'string') result[host] = status;
  }
  return result;
}

export function decodeOmpModelsState(value: unknown): OmpModelsState {
  if (!record(value)) throw new Error('Invalid OMP allow-list response');
  const sha = typeof value.sha === 'string' ? value.sha : '';
  const enabledModels = stringList(value.enabledModels);
  const disabledProviders = stringList(value.disabledProviders);
  if (!sha || !enabledModels || !disabledProviders) throw new Error('Invalid OMP allow-list payload');
  return { available: value.available !== false, sha, enabledModels, disabledProviders };
}

export function decodeOmpModelsPreview(value: unknown): OmpModelsPreview {
  if (!record(value)) throw new Error('Invalid preview response');
  const models = Array.isArray(value.models)
    ? value.models.map(decodePreviewModel).filter((row): row is OmpPreviewModel => row !== null)
    : [];
  const total = typeof value.total === 'number' && Number.isFinite(value.total) && value.total >= 0
    ? Math.round(value.total)
    : models.length;
  return {
    total,
    truncated: value.truncated === true || total > models.length,
    startupModel: decodePreviewModel(value.startupModel),
    models,
  };
}

export function decodeOmpModelsDryRun(value: unknown): OmpModelsDryRun {
  if (!record(value)) throw new Error('Invalid dry-run response');
  return {
    dryRun: true,
    sha: typeof value.sha === 'string' ? value.sha : '',
    changed: value.changed === true,
    diff: typeof value.diff === 'string' ? value.diff : '',
  };
}

export function decodeOmpModelsApply(value: unknown): OmpModelsApplyResult {
  if (!record(value)) throw new Error('Invalid apply response');
  const unchanged = value.unchanged === true;
  const allHostsFailed = value.allHostsFailed === true;
  return {
    sha: typeof value.sha === 'string' ? value.sha : '',
    unchanged,
    hosts: decodeHostsMap(value.hosts),
    allHostsFailed,
    committed: value.committed === true || !allHostsFailed,
    restartRequired: value.restartRequired === true || (!unchanged && !allHostsFailed),
    message: typeof value.message === 'string' ? value.message : '',
  };
}

interface BannerState {
  readonly kind: 'policy' | 'conflict' | 'locked' | 'error' | 'info';
  readonly message: string;
  readonly reasons?: readonly string[];
  readonly retryAction?: 'load' | 'review' | 'apply';
}

interface PreviewState {
  loading: boolean;
  result: OmpModelsPreview | null;
  error: string | null;
}

interface RowPreviewState {
  loading?: boolean;
  total?: number;
  error?: string;
}

export interface OmpModelsController {
  open(): Promise<void>;
  close(): void;
  isOpen(): boolean;
  renderSettings(container: HTMLElement, signal: AbortSignal): void;
  dispose(): void;
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, idx) => value === right[idx]);
}

function shortSha(sha: string): string {
  return sha ? sha.slice(0, 7) : '';
}

function renderDiffHtml(diff: string): string {
  if (!diff) return '';
  return diff.split('\n').map(line => {
    const cls = line.startsWith('+++') || line.startsWith('---')
      ? 'omp-diff-meta'
      : line.startsWith('@@')
        ? 'omp-diff-hunk'
        : line.startsWith('+')
          ? 'omp-diff-add'
          : line.startsWith('-')
            ? 'omp-diff-del'
            : 'omp-diff-ctx';
    return `<span class="${cls}">${escapeHtml(line)}</span>`;
  }).join('\n');
}

function countModelsLabel(total: number): string {
  return total === 1 ? 'Matches 1 model' : `Matches ${total} models`;
}

export function createOmpModels(options: {
  document: Document;
  request: ApiRequest;
  /** True when the local host descriptor is known to support `/api/omp-models`, false when known unsupported, null when unknown. */
  localAvailable?: () => boolean | null;
  beforeOpen?: () => void;
  previewDebounceMs?: number;
}): OmpModelsController {
  const { document } = options;
  const previewDebounceMs = options.previewDebounceMs ?? PREVIEW_DEBOUNCE_MS;
  const lifetime = new AbortController();

  let disposed = false;
  let modal: HTMLElement | null = null;
  let openSequence = 0;
  let previewSequence = 0;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let previewAbort: AbortController | null = null;
  const rowPreviewAborts = new Map<number, AbortController>();

  let loadState: 'idle' | 'loading' | 'unavailable' | 'error' | 'ready' = 'idle';
  let unavailableMessage = 'OMP model allow-list management is unavailable on this host.';
  let baseSha = '';
  let savedModels: string[] = [];
  let draft: string[] = [];
  let disabledProviders: string[] = [];
  let preview: PreviewState = { loading: false, result: null, error: null };
  let matchesOpen = false;
  const rowPreviews = new Map<number, RowPreviewState>();
  let review: { readonly baseSha: string; readonly snapshot: readonly string[]; readonly result: OmpModelsDryRun } | null = null;
  let applyResult: OmpModelsApplyResult | null = null;
  let banner: BannerState | null = null;
  let busyAction: 'review' | 'apply' | 'reload' | null = null;

  function isOpen(): boolean {
    return !disposed && !!modal && modal.style.display === 'flex';
  }

  function clearPreviewTimer(): void {
    if (previewTimer !== null) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function abortPreviews(): void {
    clearPreviewTimer();
    previewSequence++;
    if (previewAbort) {
      previewAbort.abort();
      previewAbort = null;
    }
    for (const controller of rowPreviewAborts.values()) controller.abort();
    rowPreviewAborts.clear();
  }

  function ensureModal(): HTMLElement {
    const existing = modal ?? document.getElementById('ompModelsModal');
    if (existing instanceof HTMLElement) {
      modal = existing;
      return existing;
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'ompModelsModal';
    overlay.style.display = 'none';
    overlay.innerHTML = `<div class="modal omp-models-modal" role="dialog" aria-modal="true" aria-labelledby="ompModelsTitle">
      <div class="modal-header">
        <div class="omp-models-title-wrap">
          <h3 id="ompModelsTitle">OMP model allow-list</h3>
          <span class="omp-models-sha" id="ompModelsSha"></span>
        </div>
        <div class="omp-models-header-actions">
          <button type="button" class="btn-icon" id="ompModelsReload" title="Reload from fleet.yml" aria-label="Reload allow-list">↻</button>
          <button type="button" class="btn-icon" id="ompModelsClose" title="Close (Esc)" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="omp-models-body" id="ompModelsBody"></div>
      <div class="modal-footer omp-models-footer" id="ompModelsFooter">
        <span class="omp-models-footer-status" id="ompModelsFooterStatus"></span>
        <div class="omp-models-footer-actions">
          <button type="button" class="btn-small" id="ompModelsReset">Reset</button>
          <button type="button" class="btn-small" id="ompModelsReview">Review</button>
          <button type="button" class="btn btn-primary" id="ompModelsApply" disabled>Apply</button>
        </div>
      </div>
    </div>`;
    document.body.append(overlay);
    overlay.addEventListener('click', event => {
      if (event.target === overlay && busyAction !== 'apply') close();
    }, { signal: lifetime.signal });
    overlay.querySelector('#ompModelsClose')?.addEventListener('click', () => close(), { signal: lifetime.signal });
    overlay.querySelector('#ompModelsReload')?.addEventListener('click', () => { void reloadFresh(false); }, { signal: lifetime.signal });
    overlay.querySelector('#ompModelsReset')?.addEventListener('click', () => { resetDraft(); }, { signal: lifetime.signal });
    overlay.querySelector('#ompModelsReview')?.addEventListener('click', () => { void runDryRun(); }, { signal: lifetime.signal });
    overlay.querySelector('#ompModelsApply')?.addEventListener('click', () => { void runApply(); }, { signal: lifetime.signal });
    const body = overlay.querySelector<HTMLElement>('#ompModelsBody')!;
    body.addEventListener('click', event => { handleBodyClick(event); }, { signal: lifetime.signal });
    body.addEventListener('input', event => { handleBodyInput(event); }, { signal: lifetime.signal });
    body.addEventListener('keydown', event => { handleBodyKeydown(event); }, { signal: lifetime.signal });
    body.addEventListener('toggle', event => {
      if (event.target instanceof HTMLDetailsElement && event.target.classList.contains('omp-models-matches')) {
        matchesOpen = event.target.open;
      }
    }, { signal: lifetime.signal, capture: true });
    modal = overlay;
    return overlay;
  }

  function hasPendingReview(): boolean {
    return !!review && review.result.changed && review.baseSha === baseSha && sameList(review.snapshot, draft);
  }

  function isDirty(): boolean {
    return !sameList(draft, savedModels);
  }

  function invalidateReview(): void {
    if (review) review = null;
    if (applyResult) applyResult = null;
  }

  function renderBannerHtml(): string {
    if (!banner) return '';
    const retryBtn = banner.retryAction
      ? ` <button type="button" class="btn-small omp-banner-retry" data-omp-action="retry" data-omp-retry="${banner.retryAction}">Retry</button>`
      : '';
    if (banner.kind === 'policy') {
      const items = (banner.reasons || []).map(reason => `<li>${escapeHtml(reason)}</li>`).join('');
      return `<div class="omp-models-banner omp-banner-error" role="alert">
        <div class="omp-banner-head"><strong>Policy rejected changes</strong></div>
        ${items ? `<ul class="omp-policy-reasons">${items}</ul>` : `<p>${escapeHtml(banner.message)}</p>`}
      </div>`;
    }
    const cls = banner.kind === 'conflict' || banner.kind === 'locked'
      ? 'omp-banner-warn'
      : banner.kind === 'info'
        ? 'omp-banner-info'
        : 'omp-banner-error';
    return `<div class="omp-models-banner ${cls}" role="${banner.kind === 'info' ? 'status' : 'alert'}">
      <div class="omp-banner-row"><span>${escapeHtml(banner.message)}</span>${retryBtn}</div>
    </div>`;
  }

  function renderPreviewSectionHtml(): string {
    const countText = preview.loading
      ? 'Checking matches…'
      : preview.error
        ? `Preview unavailable: ${preview.error}`
        : preview.result
          ? countModelsLabel(preview.result.total)
          : 'Matches not checked yet';
    const startup = preview.result?.startupModel
      ? `<span class="omp-preview-startup">Startup: <code>${escapeHtml(preview.result.startupModel.selector)}</code>${preview.result.startupModel.name !== preview.result.startupModel.id ? ` (${escapeHtml(preview.result.startupModel.name)})` : ''}</span>`
      : '';
    let matchesHtml = '';
    if (preview.result && preview.result.models.length > 0) {
      const capNote = preview.result.truncated
        ? `Showing first ${preview.result.models.length} of ${preview.result.total}`
        : `Showing all ${preview.result.models.length}`;
      const rows = preview.result.models.map(model => `<li class="omp-match-row${model.current ? ' current' : ''}">
        <code>${escapeHtml(model.selector)}</code>
        ${model.name && model.name !== model.id ? `<span class="omp-match-name">${escapeHtml(model.name)}</span>` : ''}
      </li>`).join('');
      matchesHtml = `<details class="omp-models-matches"${matchesOpen ? ' open' : ''}>
        <summary>${escapeHtml(capNote)}</summary>
        <ul class="omp-match-list">${rows}</ul>
      </details>`;
    }
    return `<div class="omp-models-preview" id="ompModelsPreview">
      <div class="omp-preview-summary">
        <strong class="omp-preview-count" id="ompModelsMatchCount">${escapeHtml(countText)}</strong>
        ${startup}
      </div>
      ${matchesHtml}
    </div>`;
  }

  function renderReviewSectionHtml(): string {
    if (!review) return '';
    const { result } = review;
    if (!result.changed) {
      return `<section class="omp-models-review" id="ompModelsReviewPanel">
        <div class="omp-review-head"><strong>Review</strong><span>No changes relative to <code>fleet.yml</code>.</span></div>
      </section>`;
    }
    return `<section class="omp-models-review" id="ompModelsReviewPanel">
      <div class="omp-review-head"><strong>Review dry-run diff</strong><span>base <code>${escapeHtml(shortSha(result.sha || baseSha))}</code></span></div>
      <pre class="omp-models-diff" id="ompModelsDiff">${renderDiffHtml(result.diff)}</pre>
    </section>`;
  }

  function renderApplySectionHtml(): string {
    if (!applyResult) return '';
    const entries = Object.entries(applyResult.hosts);
    const hostRows = entries.map(([host, status]) => {
      const kind = classifyOmpHostResult(host, status, applyResult!.allHostsFailed);
      const label = kind === 'ok'
        ? 'ok'
        : kind === 'warn'
          ? `warning (offline): ${status}`
          : status;
      return `<li class="omp-host-row omp-host-${kind}" data-host="${escapeHtml(host)}" data-status-kind="${kind}">
        <span class="omp-host-name">${escapeHtml(host)}</span>
        <span class="omp-host-status">${escapeHtml(label)}</span>
      </li>`;
    }).join('');
    let heading: string;
    let panelClass: string;
    if (applyResult.allHostsFailed) {
      heading = `Committed ${shortSha(applyResult.sha)} to fleet-config, but deployment failed on every host.`;
      panelClass = 'omp-apply-error';
    } else if (applyResult.unchanged) {
      heading = `No changes needed (fleet.yml is already at ${shortSha(applyResult.sha)}).`;
      panelClass = 'omp-apply-ok';
    } else {
      heading = `Applied ${shortSha(applyResult.sha)} to fleet-config.`;
      panelClass = 'omp-apply-ok';
    }
    const restartNote = applyResult.restartRequired
      ? '<p class="omp-restart-note" id="ompModelsRestartNote">Running OMP sessions need a restart to pick up the updated allow-list.</p>'
      : '';
    return `<section class="omp-models-apply-result ${panelClass}" id="ompModelsApplyResult" role="status">
      <strong>${escapeHtml(heading)}</strong>
      ${restartNote}
      ${entries.length ? `<ul class="omp-host-results">${hostRows}</ul>` : ''}
    </section>`;
  }

  function renderPatternRowPreviewHtml(index: number): string {
    const state = rowPreviews.get(index);
    if (!state) return '';
    if (state.loading) return '<span class="omp-row-match loading">…</span>';
    if (state.error) return `<span class="omp-row-match error" title="${escapeHtml(state.error)}">error</span>`;
    if (typeof state.total === 'number') {
      return `<span class="omp-row-match${state.total === 0 ? ' zero' : ''}">${state.total === 1 ? '1 match' : `${state.total} matches`}</span>`;
    }
    return '';
  }

  function renderBody(): void {
    const root = modal;
    if (!root) return;
    const body = root.querySelector<HTMLElement>('#ompModelsBody')!;
    const shaEl = root.querySelector<HTMLElement>('#ompModelsSha')!;
    const reloadBtn = root.querySelector<HTMLButtonElement>('#ompModelsReload')!;
    shaEl.textContent = baseSha ? `fleet.yml · ${shortSha(baseSha)}` : '';
    reloadBtn.disabled = busyAction !== null || loadState === 'loading';

    if (loadState === 'loading') {
      body.innerHTML = '<div class="omp-models-empty">Loading current fleet allow-list…</div>';
      syncFooter();
      return;
    }
    if (loadState === 'unavailable') {
      body.innerHTML = `<div class="omp-models-empty" id="ompModelsUnavailable">${escapeHtml(unavailableMessage)}</div>`;
      syncFooter();
      return;
    }
    if (loadState === 'error') {
      body.innerHTML = `${renderBannerHtml()}<div class="omp-models-empty">Could not load the fleet allow-list.</div>`;
      syncFooter();
      return;
    }

    const disabledHtml = disabledProviders.length
      ? disabledProviders.map(provider => `<code class="omp-disabled-chip">${escapeHtml(provider)}</code>`).join('')
      : '<span class="omp-disabled-none">none</span>';

    const locked = busyAction !== null;
    const rowsHtml = draft.map((pattern, index) => {
      if (index === 0) {
        return `<li class="omp-model-row pinned" data-index="0">
          <span class="omp-model-index">1</span>
          <div class="omp-model-pinned-main">
            <code class="omp-model-pinned-value" id="ompModelsStartupPattern">${escapeHtml(pattern)}</code>
            <span class="omp-model-pinned-badge">Startup model · pinned</span>
          </div>
          ${renderPatternRowPreviewHtml(0)}
          <div class="omp-model-row-actions">
            <button type="button" class="btn-small omp-row-btn" data-omp-action="test-row" data-index="0" title="Count models matching this pattern"${locked ? ' disabled' : ''}>Test</button>
          </div>
        </li>`;
      }
      return `<li class="omp-model-row" data-index="${index}">
        <span class="omp-model-index">${index + 1}</span>
        <input type="text" class="omp-model-input" data-index="${index}" value="${escapeHtml(pattern)}" aria-label="Pattern ${index + 1}" spellcheck="false" autocomplete="off"${locked ? ' disabled' : ''}>
        ${renderPatternRowPreviewHtml(index)}
        <div class="omp-model-row-actions">
          <button type="button" class="btn-small omp-row-btn" data-omp-action="test-row" data-index="${index}" title="Count models matching this pattern"${locked ? ' disabled' : ''}>Test</button>
          <button type="button" class="btn-icon omp-row-btn" data-omp-action="move-up" data-index="${index}" title="Move up" aria-label="Move pattern ${index + 1} up"${locked || index <= 1 ? ' disabled' : ''}>↑</button>
          <button type="button" class="btn-icon omp-row-btn" data-omp-action="move-down" data-index="${index}" title="Move down" aria-label="Move pattern ${index + 1} down"${locked || index >= draft.length - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" class="btn-icon omp-row-btn omp-row-remove" data-omp-action="remove" data-index="${index}" title="Remove pattern" aria-label="Remove pattern ${index + 1}"${locked ? ' disabled' : ''}>✕</button>
        </div>
      </li>`;
    }).join('');

    body.innerHTML = `<div class="omp-models-note">Managed in <code>fleet.yml</code> (overrides <code>~/.omp/agent/config.yml</code> across the fleet). Patterns are Bun globs tested against <code>provider/id</code> or bare <code>id</code>.</div>
      <div class="omp-models-disabled" id="ompModelsDisabledProviders">
        <span class="omp-disabled-label">Disabled providers (read-only):</span>
        <div class="omp-disabled-chips">${disabledHtml}</div>
      </div>
      ${renderPreviewSectionHtml()}
      ${renderBannerHtml()}
      ${renderReviewSectionHtml()}
      ${renderApplySectionHtml()}
      <ol class="omp-models-list" id="ompModelsList">${rowsHtml}</ol>
      <div class="omp-models-add">
        <input type="text" id="ompModelsAddInput" class="omp-model-input" placeholder="Add pattern (e.g. deepseek/* or anthropic/claude-*)" aria-label="Add model pattern" spellcheck="false" autocomplete="off"${locked ? ' disabled' : ''}>
        <button type="button" class="btn-small" id="ompModelsAddBtn" data-omp-action="add"${locked ? ' disabled' : ''}>Add</button>
      </div>`;
    syncFooter();
  }

  function updatePreviewDomOnly(): void {
    const existing = modal?.querySelector<HTMLElement>('#ompModelsPreview');
    if (!existing) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderPreviewSectionHtml();
    const next = wrapper.firstElementChild;
    if (next) existing.replaceWith(next);
  }

  function updateRowPreviewDomOnly(index: number): void {
    const row = modal?.querySelector<HTMLElement>(`.omp-model-row[data-index="${index}"]`);
    if (!row) return;
    row.querySelector('.omp-row-match')?.remove();
    const html = renderPatternRowPreviewHtml(index);
    if (!html) return;
    const actions = row.querySelector('.omp-model-row-actions');
    const holder = document.createElement('span');
    holder.innerHTML = html;
    if (holder.firstElementChild) {
      if (actions) row.insertBefore(holder.firstElementChild, actions);
      else row.append(holder.firstElementChild);
    }
  }

  function syncFooter(): void {
    const root = modal;
    if (!root) return;
    const footer = root.querySelector<HTMLElement>('#ompModelsFooter')!;
    const statusEl = root.querySelector<HTMLElement>('#ompModelsFooterStatus')!;
    const resetBtn = root.querySelector<HTMLButtonElement>('#ompModelsReset')!;
    const reviewBtn = root.querySelector<HTMLButtonElement>('#ompModelsReview')!;
    const applyBtn = root.querySelector<HTMLButtonElement>('#ompModelsApply')!;

    if (loadState !== 'ready') {
      footer.style.display = 'none';
      return;
    }
    footer.style.display = '';
    const dirty = isDirty();
    const readyToApply = hasPendingReview();
    resetBtn.disabled = busyAction !== null || !dirty;
    reviewBtn.disabled = busyAction !== null;
    reviewBtn.textContent = busyAction === 'review' ? 'Reviewing…' : 'Review';
    applyBtn.disabled = busyAction !== null || !readyToApply;
    applyBtn.textContent = busyAction === 'apply' ? 'Applying…' : 'Apply';

    if (busyAction === 'apply') {
      statusEl.textContent = 'Applying and deploying to fleet hosts (this may wait on the fleet lock)…';
    } else if (busyAction === 'review') {
      statusEl.textContent = 'Checking policy and building diff…';
    } else if (busyAction === 'reload') {
      statusEl.textContent = 'Reloading fleet.yml…';
    } else if (readyToApply) {
      statusEl.textContent = 'Diff reviewed — ready to apply.';
    } else if (dirty) {
      statusEl.textContent = 'Unreviewed edits — click Review first.';
    } else {
      statusEl.textContent = `${draft.length} patterns`;
    }
  }

  function schedulePreview(immediate = false): void {
    clearPreviewTimer();
    if (loadState !== 'ready' || !isOpen()) return;
    const run = () => { void runWholePreview(); };
    if (immediate) {
      run();
      return;
    }
    previewTimer = setTimeout(() => {
      previewTimer = null;
      run();
    }, previewDebounceMs);
  }

  async function runWholePreview(): Promise<void> {
    const seq = ++previewSequence;
    const openSeq = openSequence;
    if (previewAbort) previewAbort.abort();
    const controller = new AbortController();
    previewAbort = controller;
    const snapshot = [...draft];
    preview = { loading: true, result: preview.result, error: null };
    updatePreviewDomOnly();
    try {
      const response = await options.request(null, '/api/omp-models/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledModels: snapshot, query: '', limit: PREVIEW_LIMIT }),
        signal: controller.signal,
        timeoutMs: PREVIEW_FETCH_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (seq !== previewSequence || openSeq !== openSequence || !isOpen()) return;
      if (!response.ok) {
        const msg = record(data) && typeof data.message === 'string' && data.message
          ? data.message
          : record(data) && typeof data.error === 'string' && data.error
            ? data.error
            : `HTTP ${response.status}`;
        preview = { loading: false, result: null, error: msg };
      } else {
        preview = { loading: false, result: decodeOmpModelsPreview(data), error: null };
      }
      updatePreviewDomOnly();
    } catch (error) {
      if (controller.signal.aborted || seq !== previewSequence || openSeq !== openSequence || !isOpen()) return;
      preview = { loading: false, result: null, error: errorMessage(error) };
      updatePreviewDomOnly();
    } finally {
      if (previewAbort === controller) previewAbort = null;
    }
  }

  async function runSingleRowPreview(index: number): Promise<void> {
    const pattern = draft[index];
    if (pattern === undefined || !isOpen()) return;
    const openSeq = openSequence;
    const prev = rowPreviewAborts.get(index);
    if (prev) prev.abort();
    const controller = new AbortController();
    rowPreviewAborts.set(index, controller);
    rowPreviews.set(index, { loading: true });
    updateRowPreviewDomOnly(index);
    try {
      const response = await options.request(null, '/api/omp-models/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledModels: [pattern], query: '', limit: 1 }),
        signal: controller.signal,
        timeoutMs: PREVIEW_FETCH_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (controller.signal.aborted || openSeq !== openSequence || !isOpen() || draft[index] !== pattern) return;
      if (!response.ok) {
        const msg = record(data) && typeof data.message === 'string' && data.message ? data.message : `HTTP ${response.status}`;
        rowPreviews.set(index, { error: msg });
      } else {
        const decoded = decodeOmpModelsPreview(data);
        rowPreviews.set(index, { total: decoded.total });
      }
      updateRowPreviewDomOnly(index);
    } catch (error) {
      if (controller.signal.aborted || openSeq !== openSequence || !isOpen()) return;
      rowPreviews.set(index, { error: errorMessage(error) });
      updateRowPreviewDomOnly(index);
    } finally {
      if (rowPreviewAborts.get(index) === controller) rowPreviewAborts.delete(index);
    }
  }

  async function reloadFresh(keepDraft: boolean): Promise<boolean> {
    const openSeq = openSequence;
    if (!keepDraft) {
      loadState = 'loading';
      banner = null;
      review = null;
      applyResult = null;
      rowPreviews.clear();
      preview = { loading: false, result: null, error: null };
      renderBody();
    } else {
      busyAction = 'reload';
      syncFooter();
    }
    try {
      const response = await options.request(null, '/api/omp-models', { timeoutMs: 65_000 });
      const data = await readJson(response);
      if (openSeq !== openSequence || !isOpen()) return false;
      if (response.status === 501 || (record(data) && data.error === 'unavailable')) {
        loadState = 'unavailable';
        unavailableMessage = record(data) && typeof data.message === 'string' && data.message
          ? data.message
          : 'OMP model allow-list management is unavailable on this host.';
        busyAction = null;
        renderBody();
        return false;
      }
      if (!response.ok) {
        const msg = record(data) && typeof data.message === 'string' && data.message
          ? data.message
          : record(data) && typeof data.error === 'string' && data.error
            ? data.error
            : `HTTP ${response.status}`;
        if (!keepDraft) loadState = 'error';
        banner = { kind: 'error', message: msg, retryAction: 'load' };
        busyAction = null;
        renderBody();
        return false;
      }
      const state = decodeOmpModelsState(data);
      baseSha = state.sha;
      savedModels = [...state.enabledModels];
      disabledProviders = [...state.disabledProviders];
      if (!keepDraft) {
        draft = [...state.enabledModels];
      }
      loadState = 'ready';
      busyAction = null;
      renderBody();
      schedulePreview(true);
      return true;
    } catch (error) {
      if (openSeq !== openSequence || !isOpen()) return false;
      if (!keepDraft) loadState = 'error';
      banner = { kind: 'error', message: errorMessage(error), retryAction: 'load' };
      busyAction = null;
      renderBody();
      return false;
    }
  }

  async function handleConflict(latestSha: string | null): Promise<void> {
    const openSeq = openSequence;
    invalidateReview();
    if (latestSha) baseSha = latestSha;
    banner = {
      kind: 'conflict',
      message: 'Allow-list changed elsewhere. Reloading the latest base while keeping your edits so you can review and reapply…',
    };
    renderBody();
    const ok = await reloadFresh(true);
    if (!ok || openSeq !== openSequence || !isOpen()) return;
    banner = {
      kind: 'conflict',
      message: `Allow-list changed elsewhere. Reloaded base ${shortSha(baseSha)} and kept your edits — review and apply again.`,
    };
    renderBody();
  }

  function handleMutationError(action: 'review' | 'apply', response: Response, data: unknown): boolean {
    if (!record(data)) {
      banner = { kind: 'error', message: `Request failed (HTTP ${response.status}).`, retryAction: action };
      return false;
    }
    if (response.status === 501 || data.error === 'unavailable') {
      loadState = 'unavailable';
      unavailableMessage = typeof data.message === 'string' && data.message
        ? data.message
        : 'OMP model allow-list management is unavailable on this host.';
      return false;
    }
    if (response.status === 422 || data.error === 'policy') {
      const reasons = stringList(data.reasons) || [];
      banner = {
        kind: 'policy',
        message: typeof data.message === 'string' && data.message ? data.message : 'Policy rejected changes.',
        reasons,
      };
      return false;
    }
    if (response.status === 409 || data.error === 'conflict') {
      const latestSha = typeof data.sha === 'string' && data.sha ? data.sha : null;
      void handleConflict(latestSha);
      return true;
    }
    if (response.status === 423 || data.error === 'locked') {
      banner = {
        kind: 'locked',
        message: typeof data.message === 'string' && data.message ? data.message : 'Another omp-models update holds the lock.',
        retryAction: action,
      };
      return false;
    }
    if (action === 'apply' && data.allHostsFailed === true) {
      const decoded = decodeOmpModelsApply(data);
      if (decoded.sha) {
        baseSha = decoded.sha;
        savedModels = [...draft];
      }
      review = null;
      applyResult = decoded;
      banner = null;
      return false;
    }
    const retryable = data.retryable === true || response.status === 504;
    banner = {
      kind: 'error',
      message: typeof data.message === 'string' && data.message
        ? data.message
        : typeof data.error === 'string' && data.error
          ? data.error
          : `Request failed (HTTP ${response.status}).`,
      retryAction: retryable ? action : undefined,
    };
    return false;
  }

  async function runDryRun(): Promise<void> {
    if (loadState !== 'ready' || busyAction !== null) return;
    const openSeq = openSequence;
    const snapshot = [...draft];
    const targetSha = baseSha;
    busyAction = 'review';
    banner = null;
    applyResult = null;
    renderBody();
    try {
      const response = await options.request(null, '/api/omp-models/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: targetSha, enabledModels: snapshot }),
        timeoutMs: SET_FETCH_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (openSeq !== openSequence || !isOpen()) return;
      busyAction = null;
      if (!response.ok) {
        review = null;
        if (!handleMutationError('review', response, data)) renderBody();
        return;
      }
      const decoded = decodeOmpModelsDryRun(data);
      review = { baseSha: decoded.sha || targetSha, snapshot, result: decoded };
      if (decoded.sha) baseSha = decoded.sha;
      renderBody();
    } catch (error) {
      if (openSeq !== openSequence || !isOpen()) return;
      busyAction = null;
      review = null;
      banner = { kind: 'error', message: errorMessage(error), retryAction: 'review' };
      renderBody();
    }
  }

  async function runApply(): Promise<void> {
    if (loadState !== 'ready' || busyAction !== null || !hasPendingReview()) return;
    const openSeq = openSequence;
    const snapshot = [...draft];
    const targetSha = baseSha;
    busyAction = 'apply';
    banner = null;
    applyResult = null;
    renderBody();
    try {
      const response = await options.request(null, '/api/omp-models/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: targetSha, enabledModels: snapshot }),
        timeoutMs: SET_FETCH_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (openSeq !== openSequence || !isOpen()) return;
      busyAction = null;
      if (!response.ok) {
        if (!handleMutationError('apply', response, data)) renderBody();
        return;
      }
      const decoded = decodeOmpModelsApply(data);
      if (decoded.sha) baseSha = decoded.sha;
      savedModels = [...snapshot];
      review = null;
      applyResult = decoded;
      renderBody();
    } catch (error) {
      if (openSeq !== openSequence || !isOpen()) return;
      busyAction = null;
      banner = { kind: 'error', message: errorMessage(error), retryAction: 'apply' };
      renderBody();
    }
  }

  function resetDraft(): void {
    if (loadState !== 'ready' || busyAction !== null) return;
    draft = [...savedModels];
    rowPreviews.clear();
    banner = null;
    invalidateReview();
    renderBody();
    schedulePreview(false);
  }

  function addPattern(): void {
    if (loadState !== 'ready' || busyAction !== null) return;
    const input = modal?.querySelector<HTMLInputElement>('#ompModelsAddInput');
    const value = (input?.value || '').trim();
    if (!value) return;
    draft.push(value);
    banner = null;
    invalidateReview();
    renderBody();
    const freshInput = modal?.querySelector<HTMLInputElement>('#ompModelsAddInput');
    freshInput?.focus();
    schedulePreview(false);
  }

  function handleBodyClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-omp-action]') : null;
    if (!target || busyAction !== null) return;
    const action = target.dataset.ompAction;
    if (action === 'add') {
      addPattern();
      return;
    }
    if (action === 'retry') {
      const kind = target.dataset.ompRetry;
      if (kind === 'load') void reloadFresh(false);
      else if (kind === 'review') void runDryRun();
      else if (kind === 'apply') void runApply();
      return;
    }
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= draft.length) return;
    if (action === 'test-row') {
      void runSingleRowPreview(index);
      return;
    }
    if (index === 0) return; // Startup model is pinned.
    if (action === 'remove') {
      draft.splice(index, 1);
      rowPreviews.clear();
      banner = null;
      invalidateReview();
      renderBody();
      schedulePreview(false);
    } else if (action === 'move-up' && index > 1) {
      const moved = draft[index];
      draft[index] = draft[index - 1];
      draft[index - 1] = moved;
      rowPreviews.clear();
      banner = null;
      invalidateReview();
      renderBody();
      schedulePreview(false);
    } else if (action === 'move-down' && index < draft.length - 1) {
      const moved = draft[index];
      draft[index] = draft[index + 1];
      draft[index + 1] = moved;
      rowPreviews.clear();
      banner = null;
      invalidateReview();
      renderBody();
      schedulePreview(false);
    }
  }

  function handleBodyInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('omp-model-input') || target.id === 'ompModelsAddInput') return;
    if (busyAction !== null) return;
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index <= 0 || index >= draft.length) return;
    draft[index] = target.value;
    rowPreviews.delete(index);
    updateRowPreviewDomOnly(index);
    const hadReview = review !== null || applyResult !== null;
    invalidateReview();
    if (hadReview) {
      modal?.querySelector('#ompModelsReviewPanel')?.remove();
      modal?.querySelector('#ompModelsApplyResult')?.remove();
    }
    syncFooter();
    schedulePreview(false);
  }

  function handleBodyKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === 'ompModelsAddInput') {
      event.preventDefault();
      addPattern();
    }
  }

  async function open(): Promise<void> {
    if (disposed) return;
    options.beforeOpen?.();
    const overlay = ensureModal();
    openSequence++;
    abortPreviews();
    busyAction = null;
    matchesOpen = false;
    overlay.style.display = 'flex';
    await reloadFresh(false);
  }

  function close(): void {
    if (disposed) return;
    openSequence++;
    abortPreviews();
    busyAction = null;
    if (modal) modal.style.display = 'none';
  }

  function renderSettings(container: HTMLElement, signal: AbortSignal): void {
    const known = options.localAvailable?.() ?? null;
    const unavailable = known === false;
    container.innerHTML = `<div class="preference-row omp-models-settings-row">
      <label>
        <strong>OMP model allow-list</strong>
        <small>Fleet-wide <code>enabledModels</code> in <code>fleet.yml</code> (overrides <code>~/.omp/agent/config.yml</code> on every host).</small>
      </label>
      ${unavailable
        ? '<small class="omp-models-unavailable-hint">Unavailable on this host</small>'
        : '<button type="button" class="btn-small" id="settingsOpenOmpModels">Edit allow-list</button>'}
    </div>`;
    const btn = container.querySelector<HTMLButtonElement>('#settingsOpenOmpModels');
    btn?.addEventListener('click', () => { void open(); }, { signal });
  }

  function dispose(): void {
    close();
    disposed = true;
    lifetime.abort();
    modal?.remove();
    modal = null;
  }

  return { open, close, isOpen, renderSettings, dispose };
}
