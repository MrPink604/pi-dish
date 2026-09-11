import type { ApiRequest, HostEndpoint } from './api-client';
import type { SessionState } from './session-state';
import { escapeHtml } from './helper-format';
import { hostDisplayLabel, sessionKey } from './helper-identity';
import { record } from './helper-values';
import { bounceMode, decodeBouncePreview, decodeBounceOperation, decodeBounceOperations } from './bounce-data';
import type { BounceMode, BounceTarget, BounceOperation, BounceResult } from './bounce-data';
export interface BounceHost extends HostEndpoint {
  readonly hostId: string | null; readonly name?: string | null; readonly label?: string | null;
  readonly capabilities?: Readonly<Record<string, boolean | undefined>>;
}
interface BounceHostState {
  readonly host: BounceHost; readonly mode: BounceMode; readonly generation: number; readonly supported: boolean;
  targets: readonly BounceTarget[]; selected: Set<string>; operations: readonly BounceOperation[];
  previewError: string; operationError: string; actionNotice: string; cancelling: Set<string>;
  loading: boolean; timer: ReturnType<typeof setTimeout> | undefined; polling: boolean; readSeq: number;
  previewEvents: AbortController; operationEvents: AbortController;
}
export function createBounce(options: {
  document: Document; request: ApiRequest; hosts: () => readonly BounceHost[]; fleetReady: () => Promise<unknown>;
  sessionState: SessionState; refreshSessions: () => Promise<unknown>; loadPrevious: () => Promise<unknown>;
  selectSession: (id: string, options: { host: string | null; keepBounceView: true }) => Promise<unknown>;
}) {
  const document = options.document, apiFetch = options.request, sessionState = options.sessionState;
  const effectiveHosts = options.hosts, refreshSessions = options.refreshSessions, selectSession = options.selectSession;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => {
    const value = document.getElementById(id); if (!value) throw new Error('Missing bounce element: ' + id); return value as T;
  };
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  let disposed = false;
  function retire(state: BounceHostState): void { clearTimeout(state.timer); state.previewEvents.abort(); state.operationEvents.abort(); }
  function sameHost(host: BounceHost): boolean {
    return effectiveHosts().some(current => current.hostId === host.hostId && current.base === host.base && (current.token || '') === (host.token || ''));
  }
  // --- Bounce agents: the browser selects a snapshot; each host owns its wait. ---
  let bounceHosts: BounceHostState[] = [];
  let bounceGeneration = 0;
  let bounceSubmitting = false;
  const bouncePendingRestarts = new Set<string>();

  function isBounceViewOpen() {
    return !disposed && element<HTMLDetailsElement>('bounceView').open;
  }


  function closeBounceView() {
    if (disposed) return;
    element<HTMLDetailsElement>('bounceView').open = false;
    ++bounceGeneration;
    for (const state of bounceHosts) retire(state);
  }

  async function refreshBounceView() {
    if (bounceSubmitting || !isBounceViewOpen()) return;
    const generation = ++bounceGeneration;
    for (const state of bounceHosts) retire(state);
    bounceHosts = [];
    updateBounceSelection();
    element('bounceHosts').textContent = 'Loading hosts…';
    element('bounceNotice').textContent = '';
    await options.fleetReady();
    if (generation !== bounceGeneration || !isBounceViewOpen()) return;
    const mode = bounceMode(element<HTMLSelectElement>('bounceMode').value);
    bounceHosts = effectiveHosts().map(host => ({
      host: Object.freeze({ ...host }), mode, generation, supported: host.capabilities?.sessionBounces === true,
      targets: [], selected: new Set(), operations: [], previewError: '',
      operationError: '', actionNotice: '', cancelling: new Set(), loading: true,
      timer: undefined, polling: false, readSeq: 0,
      previewEvents: new AbortController(), operationEvents: new AbortController(),
    }));
    element('bounceHosts').innerHTML = bounceHosts.map((state, index) =>
      `<section class="bounce-host" data-bounce-host="${index}">
        <h3>${escapeHtml(hostDisplayLabel(state.host))}</h3>
        ${state.supported
          ? `<div class="bounce-preview"></div><div class="bounce-operations"></div>`
          : '<p class="bounce-help">Update this host to enable bouncing.</p>'}
      </section>`).join('');
    for (const state of bounceHosts) {
      if (!state.supported) continue;
      renderBouncePreview(state);
      renderBounceOperations(state);
      loadBouncePreview(state);
      pollBounceOperations(state);
    }
  }

  function bounceHostElement(state: BounceHostState) {
    if (state.generation !== bounceGeneration || !isBounceViewOpen() || !sameHost(state.host)) return null;
    const index = bounceHosts.indexOf(state);
    return index < 0 ? null : document.querySelector<HTMLElement>(`[data-bounce-host="${index}"]`);
  }

  async function loadBouncePreview(state: BounceHostState) {
    try {
      const res = await apiFetch(state.host, `/api/session-bounces/preview?mode=${state.mode}`, { timeoutMs: 20000 });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(record(data) && typeof data.error === 'string' && data.error || `HTTP ${res.status}`);
      if (!bounceHostElement(state)) return;
      state.targets = decodeBouncePreview(data);
    } catch (error) {
      state.previewError = `Preview unavailable: ${message(error)}`;
    }
    state.loading = false;
    renderBouncePreview(state);
    updateBounceSelection();
  }

  function renderBouncePreview(state: BounceHostState) {
    const root = bounceHostElement(state)?.querySelector<HTMLElement>('.bounce-preview');
    if (!root) return;
    state.previewEvents.abort(); state.previewEvents = new AbortController();
    root.innerHTML = state.loading ? '<p class="bounce-help">Loading preview…</p>'
      : state.previewError ? `<p class="bounce-error" role="status">${escapeHtml(state.previewError)}</p>`
      : state.targets.length ? state.targets.map((target, index) => {
        const eligible = target.eligible === true;
        const blockers = Array.isArray(target.blockers) ? target.blockers : [];
        const reason = [target.reason, ...blockers].filter(Boolean).join(' · ');
        return `<label class="bounce-target${eligible ? '' : ' ineligible'}">
          <input type="checkbox" data-bounce-target="${index}" ${eligible && !bounceSubmitting ? '' : 'disabled'} ${state.selected.has(target.sessionId) ? 'checked' : ''}>
          <span><strong>${escapeHtml(target.name || target.sessionId)}</strong>
            <small>${escapeHtml(target.harnessId || 'Unknown harness')} · ${eligible ? blockers.length ? 'Eligible — waiting' : 'Eligible' : 'Ineligible'}</small>
            ${reason ? `<small>${escapeHtml(reason)}</small>` : ''}
          </span>
        </label>`;
      }).join('') : '<p class="bounce-help">No active sessions.</p>';
    root.querySelectorAll<HTMLInputElement>('[data-bounce-target]').forEach(input => input.addEventListener('change', () => {
      const target = state.targets[Number(input.dataset.bounceTarget)];
      if (!bounceHostElement(state) || bounceSubmitting || !target?.eligible) return;
      if (input.checked) state.selected.add(target.sessionId);
      else state.selected.delete(target.sessionId);
      updateBounceSelection();
    }, { signal: state.previewEvents.signal }));
  }

  function selectBounceTargets(selected: boolean) {
    if (bounceSubmitting || !isBounceViewOpen()) return;
    for (const state of bounceHosts) {
      if (!bounceHostElement(state)) continue;
      state.selected = new Set(selected ? state.targets.filter(target => target.eligible === true).map(target => target.sessionId) : []);
      renderBouncePreview(state);
    }
    updateBounceSelection();
  }

  function updateBounceSelection() {
    if (disposed) return;
    const count = bounceHosts.reduce((sum, state) => sum + (bounceHostElement(state) ? state.selected.size : 0), 0);
    const mode = element<HTMLSelectElement>('bounceMode').value === 'restart' ? 'Restart' : 'Reload';
    const submit = element<HTMLButtonElement>('bounceSubmit');
    submit.disabled = !count || bounceSubmitting;
    submit.textContent = bounceSubmitting ? 'Queueing…' : `Queue ${mode} (${count})`;
    for (const id of ['bounceMode', 'bounceRefresh', 'bounceSelectEligible', 'bounceClearSelection']) {
      element<HTMLButtonElement | HTMLSelectElement>(id).disabled = bounceSubmitting;
    }
  }

  async function submitBounceTargets() {
    if (bounceSubmitting || !isBounceViewOpen()) return;
    const snapshot = bounceHosts.filter(state => state.selected.size && bounceHostElement(state)).map(state => ({ state, sessionIds: [...state.selected] }));
    if (!snapshot.length) return;
    bounceSubmitting = true;
    updateBounceSelection();
    // Clear the submitted selection even on a lost response: acceptance may have
    // happened on the host. Never automatically retry a mutation.
    for (const { state } of snapshot) {
      state.selected.clear();
      state.actionNotice = '';
      renderBouncePreview(state);
    }
    await Promise.allSettled(snapshot.map(async ({ state, sessionIds }) => {
      try {
        const res = await apiFetch(state.host, '/api/session-bounces', {
          method: 'POST', timeoutMs: 20000, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: state.mode, sessionIds }),
        });
        const data: unknown = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(record(data) && typeof data.error === 'string' && data.error || `HTTP ${res.status}`);
        const operation = decodeBounceOperation(record(data) ? data.operation : null);
        ++state.readSeq;
        state.operations = [operation, ...state.operations.filter(op => op.id !== operation.id)];
        state.actionNotice = 'Snapshot queued on this host.';
        await reconcileBounceRestarts(state, [operation], true);
      } catch (error) {
        state.actionNotice = `Queue request failed: ${message(error)}. Acceptance may be unknown; check recent operations before selecting again.`;
      }
      renderBounceOperations(state);
    }));
    bounceSubmitting = false;
    updateBounceSelection();
    for (const state of bounceHosts) renderBouncePreview(state);
    if (isBounceViewOpen() && bounceHosts.some(state => state.generation !== bounceGeneration)) refreshBounceView();
  }

  async function pollBounceOperations(state: BounceHostState) {
    if (!bounceHostElement(state) || state.polling) return;
    clearTimeout(state.timer);
    state.polling = true;
    const seq = ++state.readSeq;
    try {
      const res = await apiFetch(state.host, '/api/session-bounces', { timeoutMs: 20000 });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(record(data) && typeof data.error === 'string' && data.error || `HTTP ${res.status}`);
      const operations = decodeBounceOperations(data);
      if (seq === state.readSeq && bounceHostElement(state)) {
        state.operations = operations;
        state.operationError = '';
        await reconcileBounceRestarts(state, operations);
      }
    } catch (error) {
      if (seq === state.readSeq) state.operationError = `Status unavailable: ${message(error)}. Displayed operations may be stale.`;
    }
    state.polling = false;
    renderBounceOperations(state);
    if (bounceHostElement(state)) state.timer = setTimeout(() => pollBounceOperations(state), 2500);
  }

  function renderBounceOperations(state: BounceHostState) {
    const root = bounceHostElement(state)?.querySelector<HTMLElement>('.bounce-operations');
    if (!root) return;
    const html = `${state.actionNotice ? `<p class="usage-notice" role="status">${escapeHtml(state.actionNotice)}</p>` : ''}
      ${state.operationError ? `<p class="bounce-error" role="status">${escapeHtml(state.operationError)}</p>` : ''}
      ${state.operations.length ? state.operations.map((operation, index) => {
        const waiting = operation.targets.some(target => target.status === 'waiting');
        return `<article class="bounce-operation" data-operation-id="${escapeHtml(operation.id)}">
          <div class="bounce-operation-header"><strong>${operation.mode === 'restart' ? 'Restart' : 'Reload'}</strong>
            <time>${escapeHtml(new Date(operation.createdAt).toLocaleString())}</time>
            ${waiting ? `<button class="btn-small" data-bounce-cancel="${index}" ${state.cancelling.has(operation.id) ? 'disabled' : ''}>${state.cancelling.has(operation.id) ? 'Cancelling…' : 'Cancel waiting'}</button>` : ''}
          </div>
          <ul>${operation.targets.map(target => `<li><span class="bounce-result" data-status="${escapeHtml(target.status)}">${escapeHtml(target.status)}</span>
            <span><strong>${escapeHtml(target.name || target.sessionId)}</strong><small>${escapeHtml(target.harnessId || '')}${target.reason ? ` · ${escapeHtml(target.reason)}` : ''}</small></span></li>`).join('')}</ul>
        </article>`;
      }).join('') : ''}`;
    if (root.innerHTML === html) return;
    state.operationEvents.abort(); state.operationEvents = new AbortController();
    root.innerHTML = html;
    root.querySelectorAll<HTMLButtonElement>('[data-bounce-cancel]').forEach(button => {
      const operation = state.operations[Number(button.dataset.bounceCancel)];
      button.addEventListener('click', () => {
        if (operation && state.operations.some(current => current.id === operation.id)) void cancelBounceWaiting(state, operation);
      }, { signal: state.operationEvents.signal });
    });
  }

  async function cancelBounceWaiting(state: BounceHostState, operation: BounceOperation) {
    if (!bounceHostElement(state) || state.cancelling.has(operation.id)) return;
    state.cancelling.add(operation.id);
    renderBounceOperations(state);
    try {
      const res = await apiFetch(state.host, `/api/session-bounces/${encodeURIComponent(operation.id)}`, { method: 'DELETE', timeoutMs: 20000 });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(record(data) && typeof data.error === 'string' && data.error || `HTTP ${res.status}`);
      const updated = decodeBounceOperation(record(data) ? data.operation : null);
      ++state.readSeq;
      state.operations = state.operations.map(op => op.id === operation.id ? updated : op);
      state.actionNotice = 'Waiting targets cancelled. Executing targets continue.';
      await reconcileBounceRestarts(state, [updated]);
    } catch (error) {
      state.actionNotice = `Cancellation failed: ${message(error)}. Check status before trying again.`;
    }
    state.cancelling.delete(operation.id);
    renderBounceOperations(state);
  }

  async function reconcileBounceRestarts(state: BounceHostState, operations: readonly BounceOperation[], submitted = false) {
    if (disposed) return;
    const completed: { target: BounceResult; key: string }[] = [];
    for (const operation of operations) {
      if (operation.mode !== 'restart') continue;
      for (const target of operation.targets) {
        const key = sessionKey(state.host.hostId, `${operation.id}:${target.sessionId}`);
        if (target.status === 'waiting' || target.status === 'executing') bouncePendingRestarts.add(key);
        else if (target.status === 'completed') {
          if (submitted) bouncePendingRestarts.add(key);
          if (bouncePendingRestarts.has(key)) completed.push({ target, key });
        } else bouncePendingRestarts.delete(key);
      }
    }
    if (!completed.length || !bounceHostElement(state)) return;
    const owner = sessionState.captureSelection();
    const affected = completed.find(({ target }) => target.sessionId === owner?.id && owner?.host === (state.host.hostId || null))?.target;
    await refreshSessions();
    if (!bounceHostElement(state)) return; // Reconcile on reopen; never dismiss another takeover.
    const id = affected?.replacementId || affected?.sessionId;
    if (affected && owner && id && !sessionState.findSession(id, owner.host)) await options.loadPrevious();
    if (!bounceHostElement(state)) return;
    for (const { key } of completed) bouncePendingRestarts.delete(key);
    if (!affected || !id || !owner || !sessionState.ownsSelection(owner)) return;
    // Reconnect the selected transcript underneath the status surface, without
    // closing it; an ordinary user session switch still closes the takeover.
    await selectSession(id, { host: owner.host, keepBounceView: true });
  }

  return { close: closeBounceView, isOpen: isBounceViewOpen, refresh: refreshBounceView,
    select: selectBounceTargets, submit: submitBounceTargets,
    dispose() { closeBounceView(); disposed = true; bouncePendingRestarts.clear(); },
  };
}
