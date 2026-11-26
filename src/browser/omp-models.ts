import { errorMessage, readJson, type ApiRequest } from './api-client';
import { escapeHtml } from '../core/helper-format';
import { record } from '../core/helper-values';

const SHA_RE = /^[0-9a-f]{40}$/;
const PREVIEW_DEBOUNCE_MS = 400;
const PREVIEW_LIMIT = 50;
const DRY_RUN_FETCH_TIMEOUT_MS = 430_000;
const APPLY_SUBMIT_FETCH_TIMEOUT_MS = 30_000;
const APPLY_POLL_MS = 1_000;
const APPLY_STATUS_FETCH_TIMEOUT_MS = 10_000;
const PREVIEW_FETCH_TIMEOUT_MS = 25_000;
const UNKNOWN_OUTCOME_MESSAGE = 'Unknown outcome: reload the list and check the fleet-config log.';
const OFFLINE_WARNING_HOSTS = new Set(['jacobs-macbook-air']);
// Only transport-level SSH/network errors count as "offline"; bare "timed out" stays a failure.
const TRANSPORT_OFFLINE_ERROR_RE = /\b(?:ssh:\s*connect\s+to\s+host|connection\s+timed\s+out\s+during\s+(?:banner|connect)|no\s+route\s+to\s+host|could\s+not\s+resolve\s+hostname|connection\s+refused|network\s+is\s+unreachable)\b/i;

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

export type OmpModelsApplyStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'running'; readonly opId: string; readonly startedAt: number | null; readonly base: string }
  | {
      readonly state: 'done';
      readonly opId: string;
      readonly startedAt: number | null;
      readonly finishedAt: number | null;
      readonly base: string;
      readonly result: { readonly status: number; readonly body: unknown };
    };

export type OmpHostStatusKind = 'ok' | 'warn' | 'error';

export function classifyOmpHostResult(host: string, status: string, allHostsFailed: boolean): OmpHostStatusKind {
  if (status === 'ok') return 'ok';
  if (!allHostsFailed && OFFLINE_WARNING_HOSTS.has(host) && TRANSPORT_OFFLINE_ERROR_RE.test(status)) return 'warn';
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

function decodeStrictHostsMap(value: unknown): Record<string, string> | null {
  if (!record(value)) return null;
  const result: Record<string, string> = Object.create(null);
  for (const [host, status] of Object.entries(value)) {
    if (typeof status !== 'string') return null;
    result[host] = status;
  }
  return result;
}

export function decodeOmpModelsState(value: unknown): OmpModelsState {
  if (!record(value)) throw new Error('Invalid OMP allow-list response');
  const sha = typeof value.sha === 'string' ? value.sha : '';
  const enabledModels = stringList(value.enabledModels);
  const disabledProviders = stringList(value.disabledProviders);
  if (!SHA_RE.test(sha) || !enabledModels || !disabledProviders) throw new Error('Invalid OMP allow-list payload');
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
  const sha = typeof value.sha === 'string' ? value.sha : '';
  if (!SHA_RE.test(sha) || typeof value.changed !== 'boolean') {
    throw new Error('Invalid dry-run response: missing sha or changed flag');
  }
  const diff = value.diff;
  if (value.changed) {
    if (typeof diff !== 'string' || !diff.length) throw new Error('Invalid dry-run response: missing diff');
  } else if (diff !== undefined && typeof diff !== 'string') {
    throw new Error('Invalid dry-run response: diff must be a string');
  }
  return {
    dryRun: true,
    sha,
    changed: value.changed,
    diff: typeof diff === 'string' ? diff : '',
  };
}

export function decodeOmpModelsApply(value: unknown): OmpModelsApplyResult {
  if (!record(value)) throw new Error('Invalid apply response');
  const sha = typeof value.sha === 'string' ? value.sha : '';
  if (!SHA_RE.test(sha)) throw new Error('Invalid apply response: missing sha');
  const allHostsFailed = value.allHostsFailed === true;
  if (value.unchanged === true) {
    const hosts = value.hosts === undefined ? Object.create(null) as Record<string, string> : decodeStrictHostsMap(value.hosts);
    if (hosts === null) throw new Error('Invalid apply response: invalid hosts');
    return {
      sha,
      unchanged: true,
      hosts,
      allHostsFailed: false,
      committed: true,
      restartRequired: false,
      message: typeof value.message === 'string' ? value.message : '',
    };
  }
  if (value.unchanged !== undefined && value.unchanged !== false) {
    throw new Error('Invalid apply response: invalid unchanged flag');
  }
  const hosts = decodeStrictHostsMap(value.hosts);
  if (hosts === null) throw new Error('Invalid apply response: missing hosts');
  return {
    sha,
    unchanged: false,
    hosts,
    allHostsFailed,
    committed: value.committed === true || !allHostsFailed,
    restartRequired: value.restartRequired === true || !allHostsFailed,
    message: typeof value.message === 'string' ? value.message : '',
  };
}

export function decodeOmpModelsApplyStatus(value: unknown): OmpModelsApplyStatus {
  if (!record(value)) throw new Error('Invalid apply-status response');
  if (value.state === 'idle') return { state: 'idle' };
  const opId = typeof value.opId === 'string' && value.opId.trim() ? value.opId.trim() : '';
  if (!opId) throw new Error('Invalid apply-status payload: missing opId');
  const startedAt = typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) ? value.startedAt : null;
  const base = typeof value.base === 'string' ? value.base : '';
  if (value.state === 'running') {
    return { state: 'running', opId, startedAt, base };
  }
  if (value.state === 'done' && record(value.result) && typeof value.result.status === 'number') {
    const finishedAt = typeof value.finishedAt === 'number' && Number.isFinite(value.finishedAt) ? value.finishedAt : null;
    return {
      state: 'done',
      opId,
      startedAt,
      finishedAt,
      base,
      result: { status: value.result.status, body: value.result.body },
    };
  }
  throw new Error('Invalid apply-status payload');
}

/** Composes a caller cancellation signal with a timeout without dropping either signal. */
function composeSignalWithTimeout(cancelSignal: AbortSignal, timeoutMs: number): {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly cleanup: () => void;
} {
  let didTimeout = false;
  const composed = new AbortController();
  const onCancel = () => {
    if (!composed.signal.aborted) composed.abort(cancelSignal.reason);
  };
  if (cancelSignal.aborted) {
    composed.abort(cancelSignal.reason);
    return { signal: composed.signal, timedOut: () => false, cleanup: () => {} };
  }
  cancelSignal.addEventListener('abort', onCancel, { once: true });
  const timer = setTimeout(() => {
    didTimeout = true;
    if (!composed.signal.aborted) composed.abort(new Error('Request timed out'));
  }, timeoutMs);
  return {
    signal: composed.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      clearTimeout(timer);
      cancelSignal.removeEventListener('abort', onCancel);
    },
  };
}

interface BannerState {
  readonly kind: 'policy' | 'conflict' | 'locked' | 'error' | 'info';
  readonly message: string;
  readonly reasons?: readonly string[];
  readonly retryAction?: 'load' | 'reload-keep-draft' | 'review' | 'apply' | 'reconcile';
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
  applyPollMs?: number;
}): OmpModelsController {
  const { document } = options;
  const previewDebounceMs = options.previewDebounceMs ?? PREVIEW_DEBOUNCE_MS;
  const applyPollMs = options.applyPollMs ?? APPLY_POLL_MS;
  const lifetime = new AbortController();

  let disposed = false;
  let modal: HTMLElement | null = null;
  let openSequence = 0;
  let previewSequence = 0;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let previewAbort: AbortController | null = null;
  const rowPreviewAborts = new Map<number, AbortController>();
  let applyPollTimer: ReturnType<typeof setTimeout> | null = null;

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
  let applyResultOwn = false;
  let banner: BannerState | null = null;
  let busyAction: 'review' | 'apply' | 'reload' | 'reconcile' | null = null;
  let applyNeedsReload = false;
  let reconcileLocked = false;
  let pendingApplyOpId: string | null = null;
  let pendingApplySnapshot: readonly string[] | null = null;
  let lastApplyOpId: string | null = null;
  let dismissedApplyOpId: string | null = null;

  function isOpen(): boolean {
    return !disposed && !!modal && modal.style.display === 'flex';
  }

  function clearPreviewTimer(): void {
    if (previewTimer !== null) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function clearApplyPollTimer(): void {
    if (applyPollTimer !== null) {
      clearTimeout(applyPollTimer);
      applyPollTimer = null;
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

  function dismissPreviousApply(): void {
    if (lastApplyOpId !== null) dismissedApplyOpId = lastApplyOpId;
    if (applyResult) {
      applyResult = null;
      applyResultOwn = false;
    }
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
    // Inline structural fallbacks guarantee the modal scrolls and keeps Review reachable at 390x844 even with old cached CSS.
    overlay.innerHTML = `<div class="modal omp-models-modal" role="dialog" aria-modal="true" aria-labelledby="ompModelsTitle" style="display:flex;flex-direction:column;max-height:90dvh;max-width:100vw">
      <div class="modal-header" style="flex-shrink:0">
        <div class="omp-models-title-wrap">
          <h3 id="ompModelsTitle">OMP model allow-list</h3>
          <span class="omp-models-sha" id="ompModelsSha"></span>
        </div>
        <div class="omp-models-header-actions">
          <button type="button" class="btn-icon" id="ompModelsReload" title="Reload from fleet.yml" aria-label="Reload allow-list">↻</button>
          <button type="button" class="btn-icon" id="ompModelsClose" title="Close (Esc)" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="omp-models-body" id="ompModelsBody" style="flex:1 1 auto;min-height:0;max-height:calc(90dvh - 140px);overflow-y:auto;overflow-x:hidden"></div>
      <div class="modal-footer omp-models-footer" id="ompModelsFooter" style="flex-shrink:0">
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
      if (event.target === overlay) close();
    }, { signal: lifetime.signal });
    overlay.querySelector('#ompModelsClose')?.addEventListener('click', () => close(), { signal: lifetime.signal });
    overlay.querySelector('#ompModelsReload')?.addEventListener('click', () => {
      dismissPreviousApply();
      void reloadFresh(false);
    }, { signal: lifetime.signal });
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
    return !applyNeedsReload && !reconcileLocked && !!review && review.result.changed && review.baseSha === baseSha && sameList(review.snapshot, draft);
  }

  function isDirty(): boolean {
    return !sameList(draft, savedModels);
  }

  function invalidateReview(): void {
    if (review) review = null;
    dismissPreviousApply();
  }

  function renderBannerHtml(): string {
    if (!banner) return '';
    const actionLabel = banner.retryAction === 'reconcile' ? 'Reload' : 'Retry';
    const retryBtn = banner.retryAction
      ? ` <button type="button" class="btn-small omp-banner-retry" data-omp-action="retry" data-omp-retry="${banner.retryAction}">${actionLabel}</button>`
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
      heading = applyResultOwn
        ? `Committed ${shortSha(applyResult.sha)} to fleet-config, but deployment failed on every host.`
        : `Last apply on this host (${shortSha(applyResult.sha)}): committed to fleet-config, but deployment failed on every host.`;
      panelClass = 'omp-apply-error';
    } else if (applyResult.unchanged) {
      heading = applyResultOwn
        ? `No changes needed (fleet.yml is already at ${shortSha(applyResult.sha)}).`
        : `Last apply on this host (${shortSha(applyResult.sha)}): no changes needed.`;
      panelClass = 'omp-apply-ok';
    } else {
      heading = applyResultOwn
        ? `Applied ${shortSha(applyResult.sha)} to fleet-config.`
        : `Last apply on this host (${shortSha(applyResult.sha)}): completed.`;
      panelClass = 'omp-apply-ok';
    }
    const restartNote = applyResult.restartRequired
      ? '<p class="omp-restart-note" id="ompModelsRestartNote">Running OMP sessions need a restart to pick up the updated allow-list.</p>'
      : '';
    return `<section class="omp-models-apply-result ${panelClass}" id="ompModelsApplyResult" data-apply-source="${applyResultOwn ? 'own' : 'status'}" role="status">
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

    const locked = busyAction !== null || reconcileLocked;
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
    resetBtn.disabled = busyAction !== null || reconcileLocked || !dirty;
    reviewBtn.disabled = busyAction !== null || reconcileLocked || applyNeedsReload;
    reviewBtn.textContent = busyAction === 'review' ? 'Reviewing…' : 'Review';
    applyBtn.disabled = busyAction !== null || reconcileLocked || applyNeedsReload || !readyToApply;
    applyBtn.textContent = busyAction === 'apply' ? 'Applying…' : 'Apply';

    if (busyAction === 'apply') {
      statusEl.textContent = 'Applying and deploying to fleet hosts (closing will not cancel or lose the result)…';
    } else if (busyAction === 'reconcile') {
      statusEl.textContent = 'Apply finished — reloading updated allow-list before editing…';
    } else if (reconcileLocked) {
      statusEl.textContent = 'Reload the updated allow-list before editing.';
    } else if (applyNeedsReload) {
      statusEl.textContent = 'Outcome unknown — reload the allow-list before reviewing or applying again.';
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

  /** Bumps the preview generation and cancels any in-flight preview so older responses cannot land on a newer draft. */
  function schedulePreview(immediate = false): void {
    clearPreviewTimer();
    previewSequence++;
    if (previewAbort) {
      previewAbort.abort();
      previewAbort = null;
    }
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
    const requestSignal = composeSignalWithTimeout(controller.signal, PREVIEW_FETCH_TIMEOUT_MS);
    try {
      const response = await options.request(null, '/api/omp-models/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledModels: snapshot, query: '', limit: PREVIEW_LIMIT }),
        signal: requestSignal.signal,
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
      preview = { loading: false, result: null, error: requestSignal.timedOut() ? 'Preview timed out' : errorMessage(error) };
      updatePreviewDomOnly();
    } finally {
      requestSignal.cleanup();
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
    const requestSignal = composeSignalWithTimeout(controller.signal, PREVIEW_FETCH_TIMEOUT_MS);
    try {
      const response = await options.request(null, '/api/omp-models/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledModels: [pattern], query: '', limit: 1 }),
        signal: requestSignal.signal,
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
      rowPreviews.set(index, { error: requestSignal.timedOut() ? 'Timed out' : errorMessage(error) });
      updateRowPreviewDomOnly(index);
    } finally {
      requestSignal.cleanup();
      if (rowPreviewAborts.get(index) === controller) rowPreviewAborts.delete(index);
    }
  }

  function markUnknownApplyOutcome(message?: string, requireReload = true): void {
    review = null;
    applyResult = null;
    applyResultOwn = false;
    if (requireReload) applyNeedsReload = true;
    banner = {
      kind: 'error',
      message: message || UNKNOWN_OUTCOME_MESSAGE,
    };
  }

  function applyOutcomeToUi(
    status: number,
    data: unknown,
    opts: {
      readonly ownMatch: boolean;
      readonly snapshot: readonly string[] | null;
      readonly opId: string | null;
      readonly alreadyReloaded?: boolean;
    },
  ): boolean {
    const { ownMatch, snapshot, opId, alreadyReloaded = false } = opts;
    if (opId !== null) lastApplyOpId = opId;
    if (status >= 200 && status < 300) {
      try {
        const decoded = decodeOmpModelsApply(data);
        if (ownMatch) {
          if (decoded.sha) baseSha = decoded.sha;
          if (snapshot) savedModels = [...snapshot];
          review = null;
          banner = null;
          applyResult = decoded;
          applyResultOwn = true;
          return false;
        }
        // Informational only: never mutate draft, savedModels, or baseSha from another operation's result.
        banner = null;
        applyResult = decoded;
        applyResultOwn = false;
        return false;
      } catch {
        markUnknownApplyOutcome(undefined, !alreadyReloaded);
        return false;
      }
    }
    if (!record(data)) {
      markUnknownApplyOutcome(undefined, !alreadyReloaded);
      return false;
    }
    if (status === 501 || data.error === 'unavailable') {
      loadState = 'unavailable';
      unavailableMessage = typeof data.message === 'string' && data.message
        ? data.message
        : 'OMP model allow-list management is unavailable on this host.';
      return false;
    }
    if (status === 422 || data.error === 'policy') {
      const reasons = stringList(data.reasons) || [];
      banner = {
        kind: 'policy',
        message: typeof data.message === 'string' && data.message ? data.message : 'Policy rejected changes.',
        reasons,
      };
      return false;
    }
    if (status === 409 && data.error === 'conflict') {
      if (!ownMatch) {
        banner = {
          kind: 'conflict',
          message: 'Previous apply hit a conflict because the allow-list changed elsewhere.',
        };
        return false;
      }
      const latestSha = typeof data.sha === 'string' && data.sha ? data.sha : null;
      void handleConflict(latestSha);
      return true;
    }
    if (status === 423 || data.error === 'locked') {
      banner = {
        kind: 'locked',
        message: typeof data.message === 'string' && data.message ? data.message : 'Another omp-models update holds the lock.',
        retryAction: ownMatch && hasPendingReview() ? 'apply' : undefined,
      };
      return false;
    }
    if (data.allHostsFailed === true) {
      try {
        const decoded = decodeOmpModelsApply(data);
        if (ownMatch) {
          if (decoded.sha) baseSha = decoded.sha;
          if (snapshot) savedModels = [...snapshot];
          review = null;
        }
        banner = null;
        applyResult = decoded;
        applyResultOwn = ownMatch;
        return false;
      } catch {
        markUnknownApplyOutcome(undefined, !alreadyReloaded);
        return false;
      }
    }
    if (data.unknownOutcome === true || data.error === 'unknown_outcome' || data.error === 'invalid_output') {
      markUnknownApplyOutcome(
        typeof data.message === 'string' && data.message ? data.message : undefined,
        !alreadyReloaded,
      );
      return false;
    }
    // Once apply has been started on the helper, never present generic errors as retryable.
    const msg = typeof data.message === 'string' && data.message
      ? data.message
      : typeof data.error === 'string' && data.error
        ? data.error
        : UNKNOWN_OUTCOME_MESSAGE;
    markUnknownApplyOutcome(msg, !alreadyReloaded);
    return false;
  }

  function scheduleApplyStatusPoll(openSeq: number): void {
    clearApplyPollTimer();
    if (openSeq !== openSequence || !isOpen() || busyAction !== 'apply') return;
    applyPollTimer = setTimeout(() => {
      applyPollTimer = null;
      void pollApplyStatusOnce(openSeq);
    }, applyPollMs);
  }

  async function pollApplyStatusOnce(openSeq: number): Promise<void> {
    if (openSeq !== openSequence || !isOpen()) return;
    try {
      const response = await options.request(null, '/api/omp-models/apply-status', { timeoutMs: APPLY_STATUS_FETCH_TIMEOUT_MS });
      const data = await readJson(response);
      if (openSeq !== openSequence || !isOpen()) return;
      if (response.status === 501 || (record(data) && data.error === 'unavailable')) {
        busyAction = null;
        pendingApplyOpId = null;
        pendingApplySnapshot = null;
        loadState = 'unavailable';
        unavailableMessage = record(data) && typeof data.message === 'string' && data.message
          ? data.message
          : 'OMP model allow-list management is unavailable on this host.';
        renderBody();
        return;
      }
      if (!response.ok) {
        busyAction = null;
        pendingApplyOpId = null;
        pendingApplySnapshot = null;
        markUnknownApplyOutcome();
        renderBody();
        return;
      }
      const status = decodeOmpModelsApplyStatus(data);
      if (status.state === 'running') {
        if (pendingApplyOpId !== null && status.opId !== pendingApplyOpId) {
          busyAction = null;
          pendingApplyOpId = null;
          pendingApplySnapshot = null;
          markUnknownApplyOutcome();
          renderBody();
          return;
        }
        scheduleApplyStatusPoll(openSeq);
        return;
      }
      const expectedOpId = pendingApplyOpId;
      const snapshot = pendingApplySnapshot;
      pendingApplyOpId = null;
      pendingApplySnapshot = null;
      if (status.state === 'done') {
        if (expectedOpId !== null && status.opId !== expectedOpId) {
          busyAction = null;
          markUnknownApplyOutcome();
          renderBody();
          return;
        }
        const ownMatch = expectedOpId !== null && status.opId === expectedOpId && snapshot !== null;
        if (ownMatch) {
          busyAction = null;
          const delegated = applyOutcomeToUi(status.result.status, status.result.body, {
            ownMatch: true,
            snapshot,
            opId: status.opId,
          });
          if (!delegated) renderBody();
          return;
        }
        // Reopened while another/prior apply was running: show status as info only and keep editing locked through reconciliation GET.
        const delegated = applyOutcomeToUi(status.result.status, status.result.body, {
          ownMatch: false,
          snapshot: null,
          opId: status.opId,
        });
        if (!delegated) {
          if (applyResult !== null) {
            void reconcileAfterApply(openSeq);
          } else {
            busyAction = null;
            renderBody();
          }
        }
        return;
      }
      busyAction = null;
      markUnknownApplyOutcome();
      renderBody();
    } catch {
      if (openSeq !== openSequence || !isOpen()) return;
      busyAction = null;
      pendingApplyOpId = null;
      pendingApplySnapshot = null;
      markUnknownApplyOutcome();
      renderBody();
    }
  }

  /** Reconciles the modal list after an observed apply completes while keeping editing locked until GET succeeds. */
  async function reconcileAfterApply(openSeq: number): Promise<void> {
    if (openSeq !== openSequence || !isOpen()) return;
    busyAction = 'reconcile';
    reconcileLocked = true;
    banner = {
      kind: 'info',
      message: 'Apply finished — reloading updated allow-list before editing…',
    };
    renderBody();
    try {
      const response = await options.request(null, '/api/omp-models', { timeoutMs: 65_000 });
      const data = await readJson(response);
      if (openSeq !== openSequence || !isOpen()) return;
      if (response.status === 501 || (record(data) && data.error === 'unavailable')) {
        busyAction = null;
        reconcileLocked = false;
        loadState = 'unavailable';
        unavailableMessage = record(data) && typeof data.message === 'string' && data.message
          ? data.message
          : 'OMP model allow-list management is unavailable on this host.';
        renderBody();
        return;
      }
      if (!response.ok) {
        const msg = record(data) && typeof data.message === 'string' && data.message
          ? data.message
          : record(data) && typeof data.error === 'string' && data.error
            ? data.error
            : `HTTP ${response.status}`;
        busyAction = null;
        reconcileLocked = true;
        banner = {
          kind: 'error',
          message: `Apply finished, but reloading the updated allow-list failed (${msg}). Reload before editing.`,
          retryAction: 'reconcile',
        };
        renderBody();
        return;
      }
      const state = decodeOmpModelsState(data);
      baseSha = state.sha;
      savedModels = [...state.enabledModels];
      disabledProviders = [...state.disabledProviders];
      draft = [...state.enabledModels];
      review = null;
      applyNeedsReload = false;
      reconcileLocked = false;
      busyAction = null;
      banner = null;
      renderBody();
      schedulePreview(true);
    } catch (error) {
      if (openSeq !== openSequence || !isOpen()) return;
      busyAction = null;
      reconcileLocked = true;
      banner = {
        kind: 'error',
        message: `Apply finished, but reloading the updated allow-list failed (${errorMessage(error)}). Reload before editing.`,
        retryAction: 'reconcile',
      };
      renderBody();
    }
  }

  async function fetchApplyStatusForOpen(): Promise<OmpModelsApplyStatus | null> {
    try {
      const response = await options.request(null, '/api/omp-models/apply-status', { timeoutMs: APPLY_STATUS_FETCH_TIMEOUT_MS });
      if (!response.ok) return null;
      return decodeOmpModelsApplyStatus(await readJson(response));
    } catch {
      return null;
    }
  }

  async function reloadFresh(keepDraft: boolean, checkApplyStatus = false): Promise<boolean> {
    const openSeq = openSequence;
    busyAction = 'reload';
    if (!keepDraft) {
      loadState = 'loading';
      banner = null;
      review = null;
      applyResult = null;
      applyResultOwn = false;
      rowPreviews.clear();
      preview = { loading: false, result: null, error: null };
    }
    // Disable editing and reload controls immediately while GET is in flight.
    renderBody();
    try {
      // Read apply-status before GET /api/omp-models so a completed apply is always reflected in GET.
      const applyStatus = checkApplyStatus ? await fetchApplyStatusForOpen() : null;
      if (openSeq !== openSequence || !isOpen()) return false;
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
        banner = { kind: 'error', message: msg, retryAction: keepDraft ? 'reload-keep-draft' : 'load' };
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
      applyNeedsReload = false;
      reconcileLocked = false;
      if (keepDraft && banner?.retryAction === 'reload-keep-draft') {
        banner = {
          kind: 'conflict',
          message: `Allow-list changed elsewhere. Reloaded base ${shortSha(baseSha)} and kept your edits — review and apply again.`,
        };
      }

      if (applyStatus?.state === 'running') {
        busyAction = 'apply';
        pendingApplyOpId = null;
        pendingApplySnapshot = null;
        banner = {
          kind: 'info',
          message: 'Another apply is running on this host. Waiting for deployment results…',
        };
        renderBody();
        scheduleApplyStatusPoll(openSeq);
        return true;
      }
      if (applyStatus?.state === 'done' && applyStatus.opId !== dismissedApplyOpId) {
        const delegated = applyOutcomeToUi(applyStatus.result.status, applyStatus.result.body, {
          ownMatch: false,
          snapshot: null,
          opId: applyStatus.opId,
          alreadyReloaded: true,
        });
        if (!delegated) {
          renderBody();
          schedulePreview(true);
        }
        return true;
      }
      renderBody();
      schedulePreview(true);
      return true;
    } catch (error) {
      if (openSeq !== openSequence || !isOpen()) return false;
      if (!keepDraft) loadState = 'error';
      banner = { kind: 'error', message: errorMessage(error), retryAction: keepDraft ? 'reload-keep-draft' : 'load' };
      busyAction = null;
      renderBody();
      return false;
    }
  }

  async function handleConflict(latestSha: string | null): Promise<void> {
    const openSeq = openSequence;
    invalidateReview();
    if (latestSha && SHA_RE.test(latestSha)) baseSha = latestSha;
    banner = {
      kind: 'conflict',
      message: 'Allow-list changed elsewhere. Reloading the latest base while keeping your edits so you can review and reapply…',
    };
    const ok = await reloadFresh(true);
    if (!ok || openSeq !== openSequence || !isOpen()) return;
    banner = {
      kind: 'conflict',
      message: `Allow-list changed elsewhere. Reloaded base ${shortSha(baseSha)} and kept your edits — review and apply again.`,
    };
    renderBody();
  }

  function handleDryRunError(response: Response, data: unknown): boolean {
    if (!record(data)) {
      banner = { kind: 'error', message: `Request failed (HTTP ${response.status}).`, retryAction: 'review' };
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
        retryAction: 'review',
      };
      return false;
    }
    const retryable = data.retryable === true || response.status === 504 || response.status === 429;
    banner = {
      kind: 'error',
      message: typeof data.message === 'string' && data.message
        ? data.message
        : typeof data.error === 'string' && data.error
          ? data.error
          : `Request failed (HTTP ${response.status}).`,
      retryAction: retryable ? 'review' : undefined,
    };
    return false;
  }

  async function runDryRun(): Promise<void> {
    if (loadState !== 'ready' || busyAction !== null || reconcileLocked || applyNeedsReload) return;
    const openSeq = openSequence;
    const snapshot = [...draft];
    const targetSha = baseSha;
    dismissPreviousApply();
    busyAction = 'review';
    banner = null;
    renderBody();
    try {
      const response = await options.request(null, '/api/omp-models/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: targetSha, enabledModels: snapshot }),
        timeoutMs: DRY_RUN_FETCH_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (openSeq !== openSequence || !isOpen()) return;
      busyAction = null;
      if (!response.ok) {
        review = null;
        if (!handleDryRunError(response, data)) renderBody();
        return;
      }
      const decoded = decodeOmpModelsDryRun(data);
      review = { baseSha: decoded.sha, snapshot, result: decoded };
      baseSha = decoded.sha;
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
    if (loadState !== 'ready' || busyAction !== null || reconcileLocked || applyNeedsReload || !hasPendingReview()) return;
    const openSeq = openSequence;
    const snapshot = [...draft];
    const targetSha = baseSha;
    dismissPreviousApply();
    busyAction = 'apply';
    pendingApplyOpId = null;
    pendingApplySnapshot = snapshot;
    banner = null;
    renderBody();
    try {
      const response = await options.request(null, '/api/omp-models/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: targetSha, enabledModels: snapshot }),
        timeoutMs: APPLY_SUBMIT_FETCH_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (openSeq !== openSequence || !isOpen()) return;
      // 409 apply_in_progress: our draft was rejected — keep draft dirty, invalidate review, never show Applied.
      if (response.status === 409 && record(data) && data.error === 'apply_in_progress') {
        busyAction = null;
        pendingApplyOpId = null;
        pendingApplySnapshot = null;
        review = null;
        applyResult = null;
        applyResultOwn = false;
        banner = {
          kind: 'info',
          message: 'Another apply is running. Your draft was not applied; reload and review again once it finishes.',
        };
        renderBody();
        return;
      }
      if (response.status === 202) {
        const opId = record(data) && typeof data.opId === 'string' && data.opId.trim() ? data.opId.trim() : null;
        if (!opId) {
          busyAction = null;
          pendingApplyOpId = null;
          pendingApplySnapshot = null;
          markUnknownApplyOutcome();
          renderBody();
          return;
        }
        pendingApplyOpId = opId;
        banner = {
          kind: 'info',
          message: 'Applying and deploying to fleet hosts…',
        };
        renderBody();
        scheduleApplyStatusPoll(openSeq);
        return;
      }
      busyAction = null;
      pendingApplyOpId = null;
      pendingApplySnapshot = null;
      const responseOpId = record(data) && typeof data.opId === 'string' && data.opId.trim() ? data.opId.trim() : null;
      if (response.status >= 200 && response.status < 300 && !responseOpId) {
        markUnknownApplyOutcome();
        renderBody();
        return;
      }
      const delegated = applyOutcomeToUi(response.status, data, {
        ownMatch: true,
        snapshot,
        opId: responseOpId,
      });
      if (!delegated) renderBody();
    } catch {
      if (openSeq !== openSequence || !isOpen()) return;
      // Without a confirmed opId from POST /apply, fail closed: invalidate review and require reload.
      busyAction = null;
      pendingApplyOpId = null;
      pendingApplySnapshot = null;
      markUnknownApplyOutcome();
      renderBody();
    }
  }

  function resetDraft(): void {
    if (loadState !== 'ready' || busyAction !== null || reconcileLocked) return;
    draft = [...savedModels];
    rowPreviews.clear();
    banner = null;
    invalidateReview();
    renderBody();
    schedulePreview(false);
  }

  function addPattern(): void {
    if (loadState !== 'ready' || busyAction !== null || reconcileLocked) return;
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
    if (action === 'retry') {
      const kind = target.dataset.ompRetry;
      if (kind === 'reconcile') {
        void reconcileAfterApply(openSequence);
        return;
      }
      if (reconcileLocked) return;
      if (kind === 'load') void reloadFresh(false);
      else if (kind === 'reload-keep-draft') void reloadFresh(true);
      else if (kind === 'review') void runDryRun();
      else if (kind === 'apply') void runApply();
      return;
    }
    if (reconcileLocked) return;
    if (action === 'add') {
      addPattern();
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
    if (busyAction !== null || reconcileLocked) return;
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
    clearApplyPollTimer();
    busyAction = null;
    reconcileLocked = false;
    pendingApplyOpId = null;
    pendingApplySnapshot = null;
    matchesOpen = false;
    overlay.style.display = 'flex';
    await reloadFresh(false, true);
  }

  function close(): void {
    if (disposed) return;
    openSequence++;
    abortPreviews();
    clearApplyPollTimer();
    busyAction = null;
    reconcileLocked = false;
    pendingApplyOpId = null;
    pendingApplySnapshot = null;
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
