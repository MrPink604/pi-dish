import type { ApiRequest, HostEndpoint } from './api-client';
import type { HelperHost } from './shared-helper-types';
import type { SessionState } from './session-state';
import type { CatalogModel } from '../core/session-api';
import type { HarnessRow } from './harness-discovery';
import type { CwdAutocompleteOptions, createCwdAutocomplete } from './cwd-autocomplete';
import type { KnownDirectory } from './directory-catalog';
import type { Routine, RoutineForm, RoutineInvocation } from './routines-data';
import { decodeRoutine, decodeRoutineList, decodeRoutineInvocations } from './routines-data';
import { decodeModelCatalog } from '../core/session-api';
import { modelCatalogUrl } from './api-client';
import { modelSelectOptionsHtml as selectOptions, modelHiddenNote } from './model-catalog';
import { NS_THINKING_LABELS } from './new-session-options';
import { escapeHtml, formatRelativeTime, shortCwd, truncate, formatDuration } from './helper-format';
import { sessionKey, hostDisplayLabel, hostSupportsCapability } from './helper-identity';
import { createFanoutRenderQueue } from './helper-usage';
import { record } from './helper-values';
export type RoutineHost = Readonly<HostEndpoint & HelperHost & { hostId: string | null }>;
export function createRoutinesView(options: {
  root: HTMLElement; request: ApiRequest; storage: Pick<Storage, 'getItem'>; sessionState: SessionState;
  hosts: () => readonly RoutineHost[]; effectiveHosts: () => readonly RoutineHost[]; host: (id: string | null) => RoutineHost | null;
  fleetReady: () => Promise<unknown>; config: () => Record<string, unknown>; multiHost: () => boolean;
  hostChip: (id: string | null) => string; closeOtherViews: () => void;
  connection: (host: RoutineHost, event: 'success' | 'blocked' | 'failure', error?: unknown) => void;
  autocomplete: (options: Pick<CwdAutocompleteOptions, 'input' | 'dropdown' | 'known' | 'onPick' | 'onBlur'> & { hostId: () => string | null }) => ReturnType<typeof createCwdAutocomplete>;
  copy: (text: string) => Promise<unknown>; status: (message: string) => void; confirm: (message: string) => boolean;
  loadPrevious: () => Promise<unknown>; selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
}) {
  const document = options.root.ownerDocument, window = document.defaultView!, location = window.location;
  const localStorage = options.storage, sessionState = options.sessionState;
  // Endpoint snapshots keep the answering host/base, while credentials may rotate.
  const apiFetch: ApiRequest = (host, path, init) => {
    if (host && typeof host === 'object' && 'hostId' in host && (typeof host.hostId === 'string' || host.hostId === null)) {
      const current = options.host(host.hostId);
      if (!current || current.base !== host.base) return Promise.reject(new Error('Routine host changed; select the routine again.'));
      return options.request({ ...host, token: current.token }, path, init);
    }
    return options.request(host, path, init);
  };
  const isMultiHost = options.multiHost, hostChipHtml = options.hostChip;
  const copyTextToClipboard = options.copy, setStatus = options.status, confirm = options.confirm;
  const createCwdAutocomplete = options.autocomplete;
  const modelSelectOptionsHtml = (models: readonly CatalogModel[]) => selectOptions(models, escapeHtml);
  const field = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
  let disposed = false;
  let viewGeneration = 0, formGeneration = 0, harnessRequest = 0, modelRequest = 0;
  let listEvents = new AbortController(), formEvents = new AbortController(), versionEvents = new AbortController(), invocationEvents = new AbortController();
  let listQueue: ReturnType<typeof createFanoutRenderQueue> | null = null;
  let invocationToken: symbol | null = null, mutationToken: symbol | null = null;
  function sameHost(id: string | null, endpoint: Readonly<HostEndpoint>) {
    const current = options.host(id); return !!current && current.hostId === id && current.base === endpoint.base;
  }
  interface FormOwner { view: number; form: number; key: string | null; creating: boolean; id: string | null; endpoint: RoutineHost }
  function captureForm(): FormOwner | null {
    const current = options.host(routineFormHostId()); if (!current) return null;
    const id = current.hostId;
    return { view: viewGeneration, form: formGeneration, key: routineSelKey, creating: routineCreating, id, endpoint: Object.freeze({ ...current, ...(routineSelected?.host === id ? routineSelected.endpoint : {}) }) };
  }
  function ownsForm(owner: FormOwner | null): owner is FormOwner {
    return !!owner && isRoutinesViewOpen() && owner.view === viewGeneration && owner.form === formGeneration && owner.key === routineSelKey && owner.creating === routineCreating && owner.id === options.host(routineFormHostId())?.hostId && sameHost(owner.id, owner.endpoint);
  }
  function retireForm(): void {
    formGeneration++; harnessRequest++; modelRequest++;
    formEvents.abort(); versionEvents.abort(); invocationEvents.abort();
    disposeRoutineCwdAutocomplete(); invocationToken = null; mutationToken = null; routineBusy = false;
    clearTimeout(routineDeleteArmTimer); routineDeleteArmed = false;
  }
  async function httpError(response: Response): Promise<string> {
    const data: unknown = await response.json().catch(() => null);
    return record(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`;
  }
  function payloadError(data: unknown, status: number) { return record(data) && typeof data.error === 'string' ? data.error : `HTTP ${status}`; }


  // Routines takeover (main-pane, usage-view pattern)
  // =========================================================================
  // A routine is a session template; an invocation is a session. This surface
  // edits the template (name, harness/cwd/model/thinking, schedule, prompt) and
  // reads the ledger of runs it produced — the transcript, cost and duration of
  // each run stay where every other session's do. See TASKS/routines.md.
  //
  // Fleet: GET /api/routines fans out per capable host exactly like the usage
  // view (Promise.allSettled, 20s deadlines, progressive render). Every routine
  // carries the host it lives on and every subsequent call for it goes through
  // apiFetch(routine.host, …) — the client is the aggregator, there is no
  // hub-side merged endpoint. On a single host none of the host chrome renders.

  let routinesList: Routine[] = [];            // [{ ...RoutineSummary, host, hostLabel }]
  let routinesHostErrors: string[] = [];      // labels of hosts that didn't answer
  let routinesHostPending: string[] = [];     // labels still outstanding during a partial render
  let routinesSeq = 0;
  let routinesListError = '';
  // Selection is (host, id) — two hosts may legitimately hold the same name.
  let routineSelKey: string | null = null;
  let routineSelectedHostId: string | null = null;
  let routineSelected: Routine | null = null;       // GET /api/routines/:id (carries `versions`)
  let routineCreating = false;      // detail pane holds a blank create form
  let routineFormBaseline: string | null = null;   // JSON snapshot for the dirty guard
  let routineFormError = '';
  let routineDeleteArmed = false;
  let routineBusy = false;          // a save/invoke/delete is in flight
  let routineInvocations: RoutineInvocation[] = [];
  let routineInvocationsNextBefore: number | null = null;

  let routineInvocationsTimer: ReturnType<typeof setInterval> | null = null;
  let routineVersionFilter: number | null = null;  // clicking a version row filters the table
  let routineVersionShown: number | null = null;   // which version's prompt is expanded inline
  let routineNotice = '';           // transient success line under the actions
  // Per (host|harness|cwd) model catalogs. Deliberately *not* the global
  // modelCatalog.rows(): that one belongs to the session header and the new-session
  // takeover, and a routine's catalog is a different harness/cwd/host triple.
  const routineModelCatalogs = new Map<string, readonly CatalogModel[]>();
  const routineHarnessCatalogs = new Map<string, readonly HarnessRow[]>();
  let routineModelSeq = 0;
  let routineCwdAutocomplete: ReturnType<typeof createCwdAutocomplete> | null = null;
  function disposeRoutineCwdAutocomplete() {
    routineCwdAutocomplete?.dispose();
    routineCwdAutocomplete = null;
  }
  let routineCreateHostId: string | null = null;   // host picked in the create form

  const ROUTINE_CRON_PRESETS = [
    ['', 'No schedule (manual only)'],
    ['0 * * * *', 'Every hour'],
    ['0 9 * * *', 'Daily at 09:00'],
    ['0 9 * * 1-5', 'Weekdays at 09:00'],
    ['0 9 * * 1', 'Weekly, Monday 09:00'],
  ];
  const ROUTINE_ON_BUSY = [
    ['skip', 'Skip the run'],
    ['steer', 'Steer the running turn'],
    ['followUp', 'Queue as a follow-up'],
  ];
  const ROUTINE_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

  function routineKey(host: string | null, id: string) { return sessionKey(host || null, id); }

  /** Hosts that advertise `routines`. Absent capability = unsupported. */
  function routinesCapableHosts() {
    return options.hosts().filter(host => hostSupportsCapability(host, 'routines', options.config()));
  }

  function anyHostSupportsRoutines() {
    return options.effectiveHosts().some(host => hostSupportsCapability(host, 'routines', options.config()));
  }

  /** The sidebar icon exists only where the feature does. */
  function updateRoutinesButton() {
    if (disposed) return;
    const btn = document.getElementById('btnRoutines');
    if (!btn) return;
    const supported = anyHostSupportsRoutines();
    btn.style.display = supported ? '' : 'none';
    if (!supported && isRoutinesViewOpen()) closeRoutinesView();
  }

  function isRoutinesViewOpen() {
    return !disposed && options.root.classList.contains('routines-open');
  }

  function openRoutinesView() {
    if (disposed) return;
    options.closeOtherViews();
    if (isRoutinesViewOpen()) return;
    viewGeneration++;
    options.root.classList.add('routines-open');
    // Re-opening restores the last selection (and its poll); with none, the
    // detail pane is the placeholder and the phone starts on the list. The form
    // is only repainted when the pane doesn't already hold it, so closing and
    // reopening the takeover can't silently discard an unsaved edit.
    if (!routineSelected && !routineCreating) backToRoutinesList();
    const retained = readRoutineForm();
    if (retained) wireRoutineForm(retained, false); else renderRoutineDetail();
    loadRoutinesView();
    if (routineSelected) {
      renderRoutineInvocations();
      loadRoutineInvocations({ reset: true });
      startRoutineInvocationPoll();
    }
  }

  function closeRoutinesView() {
    if (disposed) return;
    viewGeneration++; routinesSeq++; listEvents.abort(); listQueue?.dispose(); listQueue = null; retireForm();
    options.root.classList.remove('routines-open');
    stopRoutineInvocationPoll();
  }

  function refreshRoutinesView() {
    if (!isRoutinesViewOpen()) return;
    loadRoutinesView();
    if (routineSelected) loadRoutineInvocations({ reset: true });
  }

  /** Mobile back-out: Escape leaves the detail before it leaves the takeover. */
  function routinesViewEscape() {
    const view = document.getElementById('routinesView');
    if (view && view.classList.contains('detail-open') && window.matchMedia('(max-width: 768px)').matches) {
      backToRoutinesList();
      return true;
    }
    closeRoutinesView();
    return true;
  }

  function backToRoutinesList() {
    if (!isRoutinesViewOpen()) return;
    routineCwdAutocomplete?.hide();
    document.getElementById('routinesView')?.classList.remove('detail-open');
  }

  // --- list (fleet fan-out) ------------------------------------------------

  async function loadRoutinesView() {
    if (!isRoutinesViewOpen()) return;
    listQueue?.dispose(); listQueue = null;
    const seq = ++routinesSeq;
    const stale = () => seq !== routinesSeq || !isRoutinesViewOpen();
    const listEl = document.getElementById('routinesList');
    if (listEl && !listEl.childElementCount) listEl.innerHTML = '<div class="usage-state">Loading routines…</div>';
    await options.fleetReady();
    if (stale()) return;

    const hosts = routinesCapableHosts().map(host => Object.freeze({ ...host }));
    if (!hosts.length) {
      routinesList = [];
      routinesListError = 'No reachable host offers routines.';
      renderRoutinesList();
      return;
    }
    const status = hosts.map(() => 'pending');
    const entries: Routine[][] = new Array(hosts.length);
    const reasons: unknown[] = new Array(hosts.length);
    const render = () => {
      if (stale()) return;
      if (!status.some((s, i) => s === 'ok' && entries[i])) return;
      routinesHostErrors = hosts.filter((_, i) => status[i] === 'error').map(hostDisplayLabel);
      routinesHostPending = hosts.filter((_, i) => status[i] === 'pending').map(hostDisplayLabel);
      routinesListError = '';
      routinesList = entries.flat().filter(Boolean);
      renderRoutinesList();
    };
    const queueRender = listQueue = createFanoutRenderQueue(status, render);
    await Promise.allSettled(hosts.map(async (host, i) => {
      try {
        const res = await apiFetch(host, '/api/routines', { timeoutMs: 20000 });
        if (res.status === 401) { if (sameHost(host.hostId, host)) options.connection(host, 'blocked'); throw new Error('needs a token'); }
        if (!res.ok) throw new Error(await httpError(res));
        const data: unknown = await res.json();
        if (!sameHost(host.hostId, host)) throw new Error('host connection changed');
        entries[i] = decodeRoutineList(data, { ...host, label: hostDisplayLabel(host) });
        status[i] = 'ok';
        options.connection(host, 'success');
      } catch (e) {
        status[i] = 'error';
        reasons[i] = e;
        if (!host.self && sameHost(host.hostId, host)) options.connection(host, 'failure', e);
      }
      queueRender();
    }));
    if (stale()) return;
    if (!status.some(s => s === 'ok')) {
      routinesList = [];
      routinesListError = errorMessage(reasons.find(Boolean) || new Error('no hosts answered'));
      renderRoutinesList();
    }
  }

  function routineStatusClass(status: string) {
    if (status === 'starting' || status === 'running') return 'working';
    if (status === 'completed') return 'ok';
    if (status === 'errored' || status === 'interrupted') return 'bad';
    return 'muted';
  }

  /** "in 3h" / "in 12m" — the schedule line's forward-looking twin. */
  function formatRoutineCountdown(ts: number | null | undefined) {
    if (!ts) return '';
    const diff = new Date(ts).getTime() - Date.now();
    if (!Number.isFinite(diff)) return '';
    if (diff <= 0) return 'due now';
    const m = Math.round(diff / 60000);
    if (m < 60) return `in ${Math.max(1, m)}m`;
    const h = Math.round(m / 60);
    if (h < 48) return `in ${h}h`;
    return `in ${Math.round(h / 24)}d`;
  }

  function routineScheduleLine(routine: Routine) {
    const cron = routine.schedule?.cron;
    if (!cron) return '<span class="rt-sched muted">manual only</span>';
    if (routine.enabled === false) {
      return `<span class="rt-sched paused"><code>${escapeHtml(cron)}</code> · paused</span>`;
    }
    const next = formatRoutineCountdown(routine.stats?.nextRunAt);
    return `<span class="rt-sched"><code>${escapeHtml(cron)}</code>${next ? ` · ${escapeHtml(next)}` : ''}</span>`;
  }

  function renderRoutinesList() {
    if (!isRoutinesViewOpen()) return;
    listEvents.abort(); listEvents = new AbortController();
    const view = viewGeneration;
    const el = document.getElementById('routinesList');
    if (!el) return;
    const notices = [
      routinesHostErrors.length ? `<div class="usage-notice">Not listed: ${escapeHtml(routinesHostErrors.join(', '))} did not answer.</div>` : '',
      routinesHostPending.length ? `<div class="usage-notice">Still loading ${escapeHtml(routinesHostPending.join(', '))}…</div>` : '',
    ].join('');

    const sorted = routinesList.slice().sort((a, b) =>
      (b.stats?.lastInvocation?.startedAt || 0) - (a.stats?.lastInvocation?.startedAt || 0) ||
      String(a.name || '').localeCompare(String(b.name || '')));

    const rows = sorted.map(r => {
      const key = routineKey(r.host, r.id);
      const last = r.stats?.lastInvocation || null;
      const dot = `<span class="rt-dot ${last ? routineStatusClass(last.status) : 'none'}" title="${escapeHtml(last ? last.status : 'never run')}"></span>`;
      const lastLine = last
        ? `${dot}${escapeHtml(last.status)} · ${escapeHtml(formatRelativeTime(last.startedAt))}`
        : `${dot}never run`;
      const count = r.stats?.invocations || 0;
      return `<div class="rt-row${routineSelKey === key ? ' selected' : ''}" data-routine="${escapeHtml(r.id)}" data-host="${escapeHtml(r.host || '')}">
        <div class="rt-row-top">
          <span class="rt-name">${escapeHtml(r.name || r.id)}</span>
          ${hostChipHtml(r.host)}
        </div>
        <div class="rt-row-sched">${routineScheduleLine(r)}</div>
        <div class="rt-row-meta">${escapeHtml(r.mode === 'continue' ? 'continue' : 'one-shot')} · on busy ${escapeHtml(r.onBusy || 'skip')}</div>
        <div class="rt-row-last">${lastLine}<span class="rt-count">${count} run${count === 1 ? '' : 's'}</span></div>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="rt-list-head">
        <button class="btn-small" id="rtNewBtn" data-rt-action="new">+ New routine</button>
      </div>
      ${notices}
      ${routinesListError ? `<div class="usage-state">${escapeHtml(routinesListError)}</div>` : ''}
      ${rows || (routinesListError ? '' : '<div class="usage-state">No routines yet.</div>')}`;

    el.querySelector('[data-rt-action="new"]')?.addEventListener('click', () => { if (isRoutinesViewOpen() && view === viewGeneration) startRoutineCreate(); }, { signal: listEvents.signal });
    el.querySelectorAll<HTMLElement>('.rt-row').forEach(row => {
      const id = row.dataset.routine || '', host = row.dataset.host || null;
      const resolved = options.host(host), endpoint = resolved ? Object.freeze({ ...resolved }) : null;
      row.addEventListener('click', () => { if (isRoutinesViewOpen() && view === viewGeneration && endpoint && !!options.host(host)) void selectRoutine(host, id); }, { signal: listEvents.signal });
    });
  }

  // --- selection + detail --------------------------------------------------

  function routineFormDirty() {
    if (!routineFormBaseline) return false;
    const now = readRoutineForm();
    return now && JSON.stringify(now) !== routineFormBaseline;
  }

  /** The unsaved-changes guard the spec asks for: a plain confirm, once. */
  function confirmLeaveRoutineForm() {
    if (!routineFormDirty()) return true;
    return confirm('This routine has unsaved changes. Discard them?');
  }

  async function selectRoutine(host: string | null, id: string) {
    if (!isRoutinesViewOpen()) return;
    const resolved = options.host(host); if (!resolved) return;
    host = resolved.hostId;
    const key = routineKey(host, id);
    if (routineSelKey === key && routineSelected && sameHost(host, routineSelected.endpoint)) {
      document.getElementById('routinesView')?.classList.add('detail-open');
      return;
    }
    if (!confirmLeaveRoutineForm()) return;
    retireForm();
    routineSelKey = key; routineSelectedHostId = host;
    routineCreating = false;
    routineSelected = null;
    routineFormBaseline = null;
    routineFormError = '';
    routineNotice = '';
    routineDeleteArmed = false;
    routineVersionFilter = null;
    routineVersionShown = null;
    routineInvocations = [];
    routineInvocationsNextBefore = null;
    stopRoutineInvocationPoll();
    renderRoutinesList();
    document.getElementById('routinesView')?.classList.add('detail-open');
    const owner = captureForm(); if (!ownsForm(owner)) return;
    const detail = document.getElementById('routinesDetail');
    if (detail) detail.innerHTML = '<div class="usage-state">Loading routine…</div>';
    try {
      const res = await apiFetch(owner.endpoint, `/api/routines/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(await httpError(res));
      const data: unknown = await res.json();
      if (!ownsForm(owner)) return;
      routineSelected = decodeRoutine(data, owner.endpoint);
      renderRoutineDetail();
      loadRoutineInvocations({ reset: true });
      startRoutineInvocationPoll();
    } catch (e) {
      if (!ownsForm(owner)) return;
      if (detail) detail.innerHTML = `<div class="usage-state">Could not load routine: ${escapeHtml(errorMessage(e))}</div>`;
    }
  }

  function startRoutineCreate() {
    if (!isRoutinesViewOpen()) return;
    if (!confirmLeaveRoutineForm()) return;
    const hosts = routinesCapableHosts();
    const host = hosts.find(h => h.self) || hosts[0];
    if (!host) return; retireForm();
    routineSelKey = null;
    routineSelected = null;
    routineCreating = true;
    routineFormError = '';
    routineNotice = '';
    routineDeleteArmed = false;
    routineVersionFilter = null;
    routineVersionShown = null;
    routineInvocations = [];
    routineInvocationsNextBefore = null;
    stopRoutineInvocationPoll();
    routineCreateHostId = host ? (host.hostId || null) : null;
    renderRoutinesList();
    document.getElementById('routinesView')?.classList.add('detail-open');
    renderRoutineDetail();
  }

  /** The host the detail pane's calls go to — the routine's, or the create pick. */
  function routineFormHostId() {
    return routineCreating ? routineCreateHostId : (routineSelected?.host ?? routineSelectedHostId);
  }

  /**
   * Known cwds for the form's host, taken from the client's own session lists.
   * The new-session takeover's /api/cwds cache belongs to *its* host; deriving
   * from `sessions` keeps a peer's routine from suggesting this machine's paths.
   */
  function routineKnownCwds() {
    const hostId = routineFormHostId();
    const seen = new Set<string>();
    const out = [];
    for (const s of [...sessionState.sessions.active, ...sessionState.sessions.previous]) {
      if (isMultiHost() && (s.host || null) !== hostId) continue;
      if (typeof s.cwd !== 'string' || !s.cwd || seen.has(s.cwd)) continue;
      seen.add(s.cwd);
      out.push({ path: s.cwd, short: shortCwd(s.cwd) });
    }
    return out;
  }

  async function loadRoutineHarnesses(hostId: string | null): Promise<readonly HarnessRow[]> {
    const resolved = options.host(hostId); if (!resolved) return [];
    const endpoint = Object.freeze({ ...resolved });
    const key = JSON.stringify([hostId, endpoint.base, endpoint.token || '']);
    if (routineHarnessCatalogs.has(key)) return routineHarnessCatalogs.get(key)!;
    let list: readonly HarnessRow[] = [{ id: 'pi', label: 'Pi', available: true }];
    try {
      const res = await apiFetch(endpoint, '/api/harnesses');
      if (res.ok) {
        const data: unknown = await res.json();
        if (record(data) && Array.isArray(data.harnesses) && data.harnesses.length) list = data.harnesses.flatMap((row: unknown) => record(row) && typeof row.id === 'string' ? [{ id: row.id, label: typeof row.label === 'string' ? row.label : row.id, available: row.available !== false }] : []);
      }
    } catch {}
    if (!disposed && sameHost(hostId, endpoint)) routineHarnessCatalogs.set(key, list);
    return list;
  }

  async function loadRoutineModels(hostId: string | null, harnessId: string, cwd: string): Promise<readonly CatalogModel[]> {
    const resolved = options.host(hostId); if (!resolved) return [];
    const endpoint = Object.freeze({ ...resolved });
    const key = JSON.stringify([hostId, endpoint.base, endpoint.token || '', harnessId, cwd]);
    if (routineModelCatalogs.has(key)) return routineModelCatalogs.get(key)!;
    const seq = ++routineModelSeq;
    let models: CatalogModel[] = [];
    try {
      const url = harnessId !== 'pi' ? modelCatalogUrl(harnessId, cwd) : '/api/models';
      const res = await apiFetch(endpoint, url);
      if (res.ok) {
        const data: unknown = await res.json();
        models = decodeModelCatalog(data);
      }
    } catch {}
    if (disposed || seq !== routineModelSeq || !sameHost(hostId, endpoint)) return models;
    routineModelCatalogs.set(key, models);
    return models;
  }

  /** Current form values, normalized to the wire shape the routes take. */
  function readRoutineForm(): RoutineForm | null {
    const detail = document.getElementById('routinesDetail');
    if (!detail || !detail.querySelector('#rtName')) return null;
    const val = (id: string) => (field<HTMLInputElement>(id)?.value ?? '').trim();
    const minInterval = parseInt(field<HTMLInputElement>('rtMinInterval')?.value || '', 10);
    return {
      name: val('rtName'),
      description: val('rtDescription'),
      harness: val('rtHarness') || 'pi',
      cwd: val('rtCwd'),
      model: val('rtModel'),
      thinking: val('rtThinking'),
      cron: val('rtCron'),
      enabled: !!field<HTMLInputElement>('rtEnabled')?.checked,
      mode: detail.querySelector<HTMLInputElement>('input[name="rtMode"]:checked')?.value === 'continue' ? 'continue' : 'oneShot',
      onBusy: val('rtOnBusy') === 'steer' ? 'steer' : val('rtOnBusy') === 'followUp' ? 'followUp' : 'skip',
      minIntervalSec: Number.isFinite(minInterval) && minInterval > 0 ? minInterval : 0,
      prompt: field<HTMLTextAreaElement>('rtPrompt')?.value ?? '',
    };
  }

  function routineFormDefaults(): RoutineForm {
    if (routineSelected) {
      return {
        name: routineSelected.name || '',
        description: routineSelected.description || '',
        harness: routineSelected.harness || 'pi',
        cwd: routineSelected.cwd || '',
        model: routineSelected.model || '',
        thinking: routineSelected.thinking || '',
        cron: routineSelected.schedule?.cron || '',
        enabled: routineSelected.enabled !== false,
        mode: routineSelected.mode === 'continue' ? 'continue' : 'oneShot',
        onBusy: routineSelected.onBusy || 'skip',
        minIntervalSec: routineSelected.minIntervalSec || 0,
        prompt: routineSelected.prompt || '',
      };
    }
    return {
      name: '', description: '', harness: 'pi',
      cwd: localStorage.getItem('pi-dish-cwd') || '',
      model: '', thinking: '', cron: '', enabled: true,
      mode: 'oneShot', onBusy: 'skip', minIntervalSec: 0, prompt: '',
    };
  }

  function renderRoutineDetail(values?: RoutineForm, baseline?: string) {
    if (!isRoutinesViewOpen()) return;
    retireForm();
    const el = document.getElementById('routinesDetail');
    if (!el) return;
    if (!routineSelected && !routineCreating) {
      el.innerHTML = '<div class="usage-state">Select a routine, or create one.</div>';
      return;
    }
    const v = values || routineFormDefaults();
    const hosts = routinesCapableHosts();
    const hostRow = (routineCreating && hosts.length > 1)
      ? `<label class="rt-field">
           <span class="ns-label">Host</span>
           <select class="ns-select" id="rtHost">${hosts.map(h =>
             `<option value="${escapeHtml(h.hostId || '')}"${(h.hostId || null) === routineCreateHostId ? ' selected' : ''}>${escapeHtml(hostDisplayLabel(h))}</option>`).join('')}</select>
         </label>`
      : '';

    const presets = ROUTINE_CRON_PRESETS.map(([value, label]) =>
      `<option value="${escapeHtml(value)}"${value === v.cron ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
    const onBusy = ROUTINE_ON_BUSY.map(([value, label]) =>
      `<option value="${escapeHtml(value)}"${value === v.onBusy ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
    const thinking = ['<option value="">(default)</option>'].concat(ROUTINE_THINKING_LEVELS.map(level =>
      `<option value="${level}"${level === v.thinking ? ' selected' : ''}>${escapeHtml(NS_THINKING_LABELS[level] || level)}</option>`)).join('');

    el.innerHTML = `
      <div class="rt-detail-head">
        <button class="rt-back" data-rt-action="back">‹ Routines</button>
        <h2 class="rt-detail-title">${escapeHtml(routineCreating ? 'New routine' : (routineSelected?.name || routineSelected?.id || ''))}</h2>
        ${routineCreating ? '' : hostChipHtml(routineSelected?.host || null)}
        ${routineCreating ? '' : `<span class="rt-version-badge">v${routineSelected?.promptVersion || 1}</span>`}
      </div>

      <div class="rt-form">
        ${hostRow}
        <div class="rt-field-row">
          <label class="rt-field">
            <span class="ns-label">Name</span>
            <input type="text" class="cwd-input" id="rtName" value="${escapeHtml(v.name)}"
              placeholder="nightly-review" spellcheck="false" autocomplete="off">
          </label>
          <label class="rt-field">
            <span class="ns-label">Agent</span>
            <select class="ns-select" id="rtHarness"><option value="${escapeHtml(v.harness)}">${escapeHtml(v.harness)}</option></select>
          </label>
        </div>

        <label class="rt-field">
          <span class="ns-label">Description <span class="ns-label-optional">(optional)</span></span>
          <input type="text" class="cwd-input" id="rtDescription" value="${escapeHtml(v.description)}"
            placeholder="What this routine is for" autocomplete="off">
        </label>

        <label class="rt-field">
          <span class="ns-label">Working directory</span>
          <div class="cwd-input-wrap">
            <input type="text" class="cwd-input" id="rtCwd" value="${escapeHtml(v.cwd)}" placeholder="~" spellcheck="false" autocomplete="off">
            <div class="cwd-dropdown" id="rtCwdDropdown"></div>
          </div>
        </label>

        <div class="rt-field-row">
          <label class="rt-field">
            <span class="ns-label">Model</span>
            <select class="ns-select" id="rtModel"><option value="">(default)</option>${v.model ? `<option value="${escapeHtml(v.model)}" selected>${escapeHtml(v.model)}</option>` : ''}</select>
            <span class="ns-hidden-note" id="rtModelNote"></span>
          </label>
          <label class="rt-field">
            <span class="ns-label">Thinking level</span>
            <select class="ns-select" id="rtThinking">${thinking}</select>
          </label>
        </div>

        <div class="rt-field-row">
          <label class="rt-field">
            <span class="ns-label">Schedule (cron, local time)</span>
            <input type="text" class="cwd-input" id="rtCron" value="${escapeHtml(v.cron)}"
              placeholder="0 9 * * 1-5" spellcheck="false" autocomplete="off">
          </label>
          <label class="rt-field">
            <span class="ns-label">Preset</span>
            <select class="ns-select" id="rtCronPreset">${presets}<option value="__custom" ${ROUTINE_CRON_PRESETS.some(([p]) => p === v.cron) ? '' : 'selected'}>Custom…</option></select>
          </label>
        </div>
        <label class="rt-check">
          <input type="checkbox" id="rtEnabled"${v.enabled ? ' checked' : ''}>
          <span>Schedule armed <small>— unchecking pauses the cadence; Run now and the invoke route keep working</small></span>
        </label>

        <div class="rt-field">
          <span class="ns-label">Mode</span>
          <label class="rt-radio"><input type="radio" name="rtMode" value="oneShot"${v.mode === 'oneShot' ? ' checked' : ''}>
            <span>One-shot <small>— every run spawns a fresh session and closes it when the turn ends</small></span></label>
          <label class="rt-radio"><input type="radio" name="rtMode" value="continue"${v.mode === 'continue' ? ' checked' : ''}>
            <span>Continue <small>— reuse this routine's last session (resuming it if needed); never auto-closed</small></span></label>
        </div>

        <div class="rt-field-row">
          <label class="rt-field">
            <span class="ns-label">When the routine is busy</span>
            <select class="ns-select" id="rtOnBusy">${onBusy}</select>
            <span class="ns-hidden-note">Scheduled ticks always skip; this applies to invokes.</span>
          </label>
          <label class="rt-field">
            <span class="ns-label">Minimum interval (seconds)</span>
            <input type="number" class="cwd-input" id="rtMinInterval" min="0" step="1" value="${escapeHtml(String(v.minIntervalSec))}">
            <span class="ns-hidden-note">Invokes closer together than this are rejected with 429.</span>
          </label>
        </div>

        <label class="rt-field">
          <span class="ns-label">Prompt</span>
          <textarea class="rt-prompt" id="rtPrompt" rows="12" spellcheck="false" placeholder="What this routine asks the agent to do">${escapeHtml(v.prompt)}</textarea>
          <span class="ns-hidden-note">Saving a changed prompt appends a new version. <code>#refs</code> resolve like they do in the composer; an invoke's <code>input</code> is appended as an <code>&lt;invocation-input&gt;</code> block.</span>
        </label>

        <div class="rt-actions">
          <span class="rt-error" id="rtError">${escapeHtml(routineFormError)}</span>
          <span class="rt-notice" id="rtNotice">${escapeHtml(routineNotice)}</span>
          ${routineCreating ? '' : `<button class="btn-small btn-danger" id="rtDeleteBtn" data-rt-action="delete">${routineDeleteArmed ? 'Delete?' : 'Delete'}</button>`}
          ${routineCreating ? '' : '<button class="btn" id="rtRunBtn" data-rt-action="run">Run now</button>'}
          <button class="btn btn-primary" id="rtSaveBtn" data-rt-action="save">${routineCreating ? 'Create routine' : 'Save'}</button>
        </div>
      </div>

      ${routineCreating ? '' : renderRoutineInvokeBox()}
      ${routineCreating ? '' : renderRoutineVersions()}
      ${routineCreating ? '' : '<div class="rt-invocations" id="rtInvocations"></div>'}`;

    if (baseline !== undefined) routineFormBaseline = baseline;
    wireRoutineForm(v, baseline === undefined);
    if (!routineCreating) renderRoutineInvocations();
  }

  function wireRoutineForm(values: RoutineForm, baseline = true) {
    if (!isRoutinesViewOpen()) return;
    formEvents.abort(); formEvents = new AbortController(); disposeRoutineCwdAutocomplete();
    const owner = captureForm(), listener = { signal: formEvents.signal };
    const el = document.getElementById('routinesDetail');
    if (!el) return;
    const view = viewGeneration, form = formGeneration;
    el.querySelector('[data-rt-action="back"]')?.addEventListener('click', () => {
      if (isRoutinesViewOpen() && view === viewGeneration && form === formGeneration) backToRoutinesList();
    }, listener);
    if (!ownsForm(owner)) {
      const error = field('rtError'); if (error) error.textContent = 'Routine host changed or was removed. Return to Routines and select it again.';
      for (const button of el.querySelectorAll<HTMLButtonElement>('[data-rt-action]:not([data-rt-action="back"])')) button.disabled = true;
      return;
    }

    const hostSel = el.querySelector<HTMLSelectElement>('#rtHost');
    if (hostSel) hostSel.addEventListener('change', () => {
      if (!ownsForm(owner)) return;
      routineCwdAutocomplete?.hide();
      routineCreateHostId = hostSel.value || null;
      // Everything under the picker is host-scoped — harnesses, catalogs, dirs.
      const harness = el.querySelector<HTMLSelectElement>('#rtHarness')?.value || values.harness;
      const current = readRoutineForm();
      retireForm(); if (current) wireRoutineForm({ ...current, harness }, false);
    }, listener);

    const harnessSel = el.querySelector<HTMLSelectElement>('#rtHarness');
    if (harnessSel) harnessSel.addEventListener('change', () => { if (ownsForm(owner)) { harnessRequest++; void refreshRoutineModelOptions(''); } }, listener);
    field<HTMLSelectElement>('rtModel')?.addEventListener('change', () => { if (ownsForm(owner)) modelRequest++; }, listener);

    const cwdInput = el.querySelector<HTMLInputElement>('#rtCwd');
    cwdInput?.addEventListener('input', () => { if (ownsForm(owner)) modelRequest++; }, listener);
    const cwdDropdown = el.querySelector<HTMLElement>('#rtCwdDropdown');
    if (cwdInput && cwdDropdown) {
      routineCwdAutocomplete = createCwdAutocomplete({
        input: cwdInput,
        dropdown: cwdDropdown,
        hostId: () => routineFormHostId(),
        known: () => routineKnownCwds(),
        onPick: () => { if (ownsForm(owner)) void refreshRoutineModelOptions(); },
        onBlur: () => { if (ownsForm(owner)) void refreshRoutineModelOptions(); },
      });
    }

    const preset = el.querySelector<HTMLSelectElement>('#rtCronPreset');
    const cron = el.querySelector<HTMLInputElement>('#rtCron');
    if (preset && cron) {
      preset.addEventListener('change', () => {
        if (!ownsForm(owner) || preset.value === '__custom') return;
        cron.value = preset.value;
      }, listener);
      // Typing a custom expression must not leave a stale preset label claiming it.
      cron.addEventListener('input', () => {
        if (!ownsForm(owner)) return;
        const match = ROUTINE_CRON_PRESETS.some(([p]) => p === cron.value.trim());
        preset.value = match ? cron.value.trim() : '__custom';
      }, listener);
    }

    // The catalogs are fetched, so the selects only reach their saved values
    // asynchronously. The dirty baseline therefore comes from the *defaults*
    // object rather than from the DOM — same keys, same order — so the guard
    // is correct from the first frame and a slow catalog can't rebaseline an
    // edit the user already made.
    if (baseline) routineFormBaseline = JSON.stringify(values);
    const actions: Record<string, () => unknown> = { back: backToRoutinesList, save: saveRoutine, run: runRoutineNow, delete: deleteRoutine, copy: copyRoutineCurl };
    for (const button of el.querySelectorAll<HTMLElement>('[data-rt-action]:not([data-rt-action="back"])')) {
      const action = actions[button.dataset.rtAction || ''];
      if (action) button.addEventListener('click', () => { if (ownsForm(owner)) action(); }, listener);
    }
    for (const [id, label] of [['rtSaveBtn', routineCreating ? 'Create routine' : 'Save'], ['rtRunBtn', 'Run now'], ['rtDeleteBtn', 'Delete']]) { const button = field<HTMLButtonElement>(id); if (button) { button.disabled = false; button.textContent = label; } }
    mountVersions();
    refreshRoutineHarnessOptions(values.harness).then(ready => { if (ready && ownsForm(owner)) return refreshRoutineModelOptions(values.model); });
  }

  async function refreshRoutineHarnessOptions(preferred?: string) {
    const sel = field<HTMLSelectElement>('rtHarness');
    if (!sel) return false;
    const owner = captureForm(), request = ++harnessRequest;
    const hostId = routineFormHostId();
    const list = await loadRoutineHarnesses(hostId);
    if (!ownsForm(owner) || request !== harnessRequest || field<HTMLSelectElement>('rtHarness') !== sel) return false;
    const available = list.filter(h => h && h.available !== false);
    const want = preferred || sel.value || 'pi';
    sel.innerHTML = available.map(h =>
      `<option value="${escapeHtml(h.id)}">${escapeHtml(h.label || h.id)}</option>`).join('')
      || `<option value="${escapeHtml(want)}">${escapeHtml(want)}</option>`;
    // A routine may name a harness this host no longer reports; keep it rather
    // than silently rewriting the record on the next save.
    if (!available.some(h => h.id === want)) {
      sel.insertAdjacentHTML('afterbegin', `<option value="${escapeHtml(want)}">${escapeHtml(want)}</option>`);
    }
    sel.value = want; return true;
  }

  async function refreshRoutineModelOptions(preferred?: string) {
    const sel = field<HTMLSelectElement>('rtModel');
    if (!sel) return;
    const owner = captureForm(), request = ++modelRequest;
    const want = preferred !== undefined ? preferred : sel.value;
    const hostId = routineFormHostId();
    const harnessId = field<HTMLSelectElement>('rtHarness')?.value || 'pi';
    const cwd = (field<HTMLInputElement>('rtCwd')?.value || '').trim();
    const models = await loadRoutineModels(hostId, harnessId, cwd);
    if (!ownsForm(owner) || request !== modelRequest || field<HTMLSelectElement>('rtModel') !== sel || (field<HTMLSelectElement>('rtHarness')?.value || 'pi') !== harnessId || (field<HTMLInputElement>('rtCwd')?.value || '').trim() !== cwd) return;
    const { html, enabled, hidden } = modelSelectOptionsHtml(models);
    sel.innerHTML = html;
    // A saved ref the catalog doesn't list stays selectable — the record is
    // authoritative, and a model can disappear from a catalog for credential
    // reasons that say nothing about what this routine should run.
    if (want && !enabled.some(m => (m.selector || `${m.provider}/${m.id}`) === want)) {
      sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(want)}">${escapeHtml(want)}</option>`);
    }
    sel.value = want || '';
    const note = document.getElementById('rtModelNote');
    if (note) note.textContent = modelHiddenNote(hidden);
  }

  // --- invoke box ----------------------------------------------------------

  /**
   * The invoke URL for the *owning* host, absolute so the curl works from
   * anywhere: a fleet peer reached through this hub keeps its /hosts/<name>
   * proxy prefix, because that is the address the reader can actually reach.
   */
  function routineInvokeUrl(routine: Routine) {
    const base = routine.endpoint.base || '';
    const path = `/api/routines/${encodeURIComponent(routine.id)}/invoke`;
    try { return new URL(base + path, location.origin).href; } catch { return base + path; }
  }

  function routineInvokeCurl(routine: Routine) {
    const authed = !!routine.endpoint.token;
    return [
      `curl -X POST '${routineInvokeUrl(routine)}' \\`,
      "  -H 'Content-Type: application/json' \\",
      ...(authed ? ['  -H "Authorization: Bearer $PI_DISH_TOKEN" \\'] : []),
      `  -d '{"source":"my-script","input":{"note":"anything JSON"}}'`,
    ].join('\n');
  }

  function renderRoutineInvokeBox() {
    if (!routineSelected) return '';
    const curl = routineInvokeCurl(routineSelected);
    return `<details class="rt-box" open>
      <summary>Invoke from a script</summary>
      <pre class="rt-curl" id="rtCurl">${escapeHtml(curl)}</pre>
      <div class="rt-box-actions">
        <button class="btn-small" data-rt-action="copy">Copy</button>
        <span class="ns-hidden-note">The optional <code>input</code> JSON is appended to the prompt as an <code>&lt;invocation-input&gt;</code> block. Add <code>?wait=1</code> to block until the run leaves <code>starting</code>.</span>
      </div>
    </details>`;
  }

  function copyRoutineCurl() {
    if (!isRoutinesViewOpen() || !routineSelected) return;
    copyTextToClipboard(routineInvokeCurl(routineSelected));
    setStatus('Invoke command copied');
  }

  // --- prompt versions -----------------------------------------------------

  function renderRoutineVersions() {
    const versions = Array.isArray(routineSelected?.versions) ? routineSelected.versions.slice().reverse() : [];
    if (!versions.length) return '';
    const rows = versions.map(entry => {
      const active = routineVersionFilter === entry.version;
      const shown = routineVersionShown === entry.version;
      return `<div class="rt-version${active ? ' filtered' : ''}">
        <div class="rt-version-row" data-version="${entry.version}">
          <span class="rt-version-num">v${entry.version}</span>
          <span class="rt-version-when" title="${escapeHtml(new Date(entry.savedAt).toLocaleString())}">${escapeHtml(formatRelativeTime(entry.savedAt))}</span>
          ${entry.version === (routineSelected?.promptVersion || 1) ? '<span class="rt-version-current">current</span>' : ''}
          <span class="rt-version-hint">${active ? 'filtering runs' : 'click to filter runs'}</span>
          <button class="btn-small rt-version-view" data-view="${entry.version}">${shown ? 'hide' : 'view'}</button>
          <button class="btn-small rt-version-restore" data-restore="${entry.version}">restore</button>
        </div>
        ${shown ? `<pre class="rt-version-text">${escapeHtml(entry.prompt || '')}</pre>` : ''}
      </div>`;
    }).join('');
    return `<details class="rt-box" id="rtVersions"${routineVersionFilter || routineVersionShown ? ' open' : ''}>
      <summary>Prompt versions (${versions.length})</summary>
      ${rows}
      <div class="ns-hidden-note">Restoring only writes the text back into the editor — saving it then creates a <em>new</em> version.</div>
    </details>`;
  }

  // Delegated so the versions block can be re-rendered freely.
  function mountVersions() {
    versionEvents.abort(); versionEvents = new AbortController();
    const root = document.getElementById('rtVersions'), owner = captureForm();
    if (!root) return;
    root.addEventListener('click', e => {
      if (!ownsForm(owner) || document.getElementById('rtVersions') !== root || !(e.target instanceof Element)) return;
    const view = e.target.closest<HTMLElement>('.rt-version-view');
    if (view) {
      const version = Number(view.dataset.view);
      routineVersionShown = routineVersionShown === version ? null : version;
      rerenderRoutineVersions();
      return;
    }
    const restore = e.target.closest<HTMLElement>('.rt-version-restore');
    if (restore) {
      const version = Number(restore.dataset.restore);
      const entry = (routineSelected?.versions || []).find(v => v.version === version);
      const textarea = field<HTMLTextAreaElement>('rtPrompt');
      if (entry && textarea) {
        textarea.value = entry.prompt || '';
        routineNotice = `Restored v${version} into the editor — save to make it the new version.`;
        const notice = document.getElementById('rtNotice');
        if (notice) notice.textContent = routineNotice;
      }
      return;
    }
    const row = e.target.closest<HTMLElement>('.rt-version-row');
    if (row && document.getElementById('rtVersions')?.contains(row)) {
      const version = Number(row.dataset.version);
      routineVersionFilter = routineVersionFilter === version ? null : version;
      rerenderRoutineVersions();
      renderRoutineInvocations();
    }
  }, { signal: versionEvents.signal });
  }

  function rerenderRoutineVersions() {
    const existing = document.getElementById('rtVersions');
    if (!existing) return;
    existing.outerHTML = renderRoutineVersions(); mountVersions();
  }

  // --- invocations ---------------------------------------------------------

  function stopRoutineInvocationPoll() {
    if (routineInvocationsTimer !== null) clearInterval(routineInvocationsTimer);
    routineInvocationsTimer = null;
  }

  function startRoutineInvocationPoll() {
    if (!isRoutinesViewOpen()) return;
    stopRoutineInvocationPoll();
    routineInvocationsTimer = setInterval(() => {
      if (!isRoutinesViewOpen() || !routineSelected || !options.host(routineSelected.host)) { stopRoutineInvocationPoll(); return; }
      loadRoutineInvocations({ reset: true, quiet: true });
    }, 10000);
  }

  async function loadRoutineInvocations({ reset = false, quiet = false } = {}) {
    if (!isRoutinesViewOpen() || !routineSelected || invocationToken) return;
    const owner = captureForm(); if (!ownsForm(owner)) return;
    const token = invocationToken = Symbol();
    const selected = routineSelected;
    const key = routineSelKey;
    const before = reset ? null : routineInvocationsNextBefore;
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (before) params.set('before', String(before));
      const res = await apiFetch(owner.endpoint,
        `/api/routines/${encodeURIComponent(selected.id)}/invocations?${params}`, { timeoutMs: 20000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      if (!ownsForm(owner) || invocationToken !== token) return;
      const decoded = decodeRoutineInvocations(data), list = decoded.invocations;
      routineInvocations = reset ? list : routineInvocations.concat(list);
      routineInvocationsNextBefore = decoded.nextBefore;
      renderRoutineInvocations();
      // The poll only asks for this routine's runs, so patch its list row's
      // last-run line from the page rather than re-fanning out over the fleet
      // every 10s. The run *count* still comes from the next full list load.
      if (reset) {
        const row = routinesList.find(r => routineKey(r.host, r.id) === key);
        if (row && row.stats) {
          row.stats.lastInvocation = list[0] || null;
          renderRoutinesList();
        }
      }
    } catch (e) {
      if (!quiet && ownsForm(owner) && invocationToken === token) {
        const el = document.getElementById('rtInvocations');
        if (el) el.innerHTML = `<div class="usage-state">Could not load runs: ${escapeHtml(errorMessage(e))}</div>`;
      }
    } finally {
      if (invocationToken === token) invocationToken = null;
    }
  }

  function routineInvocationDetail(inv: RoutineInvocation) {
    const parts = [];
    if (inv.skipReason) parts.push(`skipped: ${inv.skipReason}`);
    if (inv.error) parts.push(inv.error);
    if (inv.closeError) parts.push(`close: ${inv.closeError}`);
    if (!parts.length && inv.summary) parts.push(inv.summary);
    return parts.join(' · ');
  }

  /**
   * Label for a run's session cell. Every run of a routine spawns on the same
   * day, so the app's usual 8-character ref is all date and distinguishes
   * nothing here — prefer the session's own name when this client has it.
   */
  function routineSessionLabel(sessionId: string) {
    const known = sessionState.findSession(sessionId, routineSelected?.host || null);
    if (known && known.name) return truncate(typeof known.name === 'string' ? known.name : '', 28, '…');
    // Pi's ids lead with a timestamp, so the app's usual first-8 ref would read
    // "2026-09-" on every row; the distinguishing part is the tail. Uuid-shaped
    // ids (OMP) keep the familiar leading form.
    return /^\d{4}-\d\d-\d\d/.test(sessionId) ? sessionId.slice(-8) : sessionId.slice(0, 8);
  }

  function renderRoutineInvocations() {
    if (!isRoutinesViewOpen()) return;
    invocationEvents.abort(); invocationEvents = new AbortController();
    const owner = captureForm();
    const el = document.getElementById('rtInvocations');
    if (!el) return;
    const filtered = routineVersionFilter
      ? routineInvocations.filter(inv => inv.version === routineVersionFilter)
      : routineInvocations;

    const rows = filtered.map(inv => {
      const trigger = inv.trigger + (inv.source ? ` (${inv.source})` : '');
      const started = inv.startedAt
        ? `<span title="${escapeHtml(new Date(inv.startedAt).toLocaleString())}">${escapeHtml(formatRelativeTime(inv.startedAt))}</span>`
        : '—';
      const duration = Number.isFinite(inv.durationMs) ? formatDuration(inv.durationMs || 0) : '—';
      const session = inv.sessionId
        ? `<a class="rt-session-link" data-session="${escapeHtml(inv.sessionId)}" data-host="${escapeHtml(routineSelected?.host || '')}" title="${escapeHtml(inv.sessionId)}">${escapeHtml(routineSessionLabel(inv.sessionId))}</a>`
        : '—';
      const detail = routineInvocationDetail(inv);
      return `<tr data-invocation="${escapeHtml(inv.id)}">
        <td class="rt-num">v${escapeHtml(String(inv.version ?? ''))}</td>
        <td>${escapeHtml(trigger)}</td>
        <td>${escapeHtml(inv.delivery || '')}</td>
        <td><span class="rt-dot ${routineStatusClass(inv.status)}"></span>${escapeHtml(inv.status || '')}</td>
        <td>${started}</td>
        <td class="rt-num">${escapeHtml(duration)}</td>
        <td>${session}</td>
        <td class="rt-detail-cell" title="${escapeHtml(detail)}">${escapeHtml(detail)}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="rt-invocations-head">
        <h3>Runs${routineVersionFilter ? ` <span class="rt-filter-chip">v${routineVersionFilter} only <button class="rt-filter-clear" data-rt-action="clear">✕</button></span>` : ''}</h3>
      </div>
      ${filtered.length ? `<div class="rt-table-wrap"><table class="rt-table">
        <thead><tr><th>Ver</th><th>Trigger</th><th>Delivery</th><th>Status</th><th>Started</th><th>Duration</th><th>Session</th><th>Detail</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : '<div class="usage-state">No runs yet.</div>'}
      ${routineInvocationsNextBefore ? '<button class="btn-small rt-load-more" data-rt-action="more">Load more</button>' : ''}`;

    const listener = { signal: invocationEvents.signal };
    el.querySelector('[data-rt-action="clear"]')?.addEventListener('click', () => { if (ownsForm(owner)) clearRoutineVersionFilter(); }, listener);
    el.querySelector('[data-rt-action="more"]')?.addEventListener('click', () => { if (ownsForm(owner)) loadMoreRoutineInvocations(); }, listener);
    el.querySelectorAll<HTMLElement>('.rt-session-link').forEach(link => {
      const id = link.dataset.session || '', host = link.dataset.host || null;
      link.addEventListener('click', () => { if (ownsForm(owner)) void openRoutineSession(id, host); }, listener);
    });
  }

  function clearRoutineVersionFilter() {
    routineVersionFilter = null;
    rerenderRoutineVersions();
    renderRoutineInvocations();
  }

  function loadMoreRoutineInvocations() {
    loadRoutineInvocations({ reset: false });
  }

  /**
   * Click-through to the run's session — the advanced-search pattern: the
   * sidebar lists may be Active-only or narrowed by a filter right now, and
   * selectSession validates against them.
   */
  async function openRoutineSession(sessionId: string, host: string | null) {
    if (!isRoutinesViewOpen() || !sessionId) return;
    const resolved = options.host(host); if (!resolved) return;
    const selection = sessionState.captureSelection(), endpoint = Object.freeze({ ...resolved });
    closeRoutinesView(); const view = viewGeneration;
    if (!sessionState.findSession(sessionId, host)) await options.loadPrevious();
    if (disposed || view !== viewGeneration || isRoutinesViewOpen() || !sameHost(host, endpoint) || (selection ? !sessionState.ownsSelection(selection) : sessionState.currentSession !== null)) return;
    await options.selectSession(sessionId, { host });
  }

  // --- mutations -----------------------------------------------------------

  function routineFormBody(values: RoutineForm) {
    return {
      name: values.name,
      description: values.description,
      harness: values.harness,
      cwd: values.cwd,
      // Explicit null, not undefined: JSON.stringify drops undefined keys, and
      // a PUT is a partial update — a dropped key would leave the old model in
      // place instead of clearing it back to the harness default.
      model: values.model || null,
      thinking: values.thinking || null,
      prompt: values.prompt,
      schedule: values.cron ? { cron: values.cron } : null,
      enabled: values.enabled,
      mode: values.mode,
      onBusy: values.onBusy,
      minIntervalSec: values.minIntervalSec,
    };
  }

  function setRoutineFormError(message: string) {
    if (!isRoutinesViewOpen()) return;
    routineFormError = message || '';
    const el = document.getElementById('rtError');
    if (el) el.textContent = routineFormError;
  }

  function setRoutineNotice(message: string) {
    if (!isRoutinesViewOpen()) return;
    routineNotice = message || '';
    const el = document.getElementById('rtNotice');
    if (el) el.textContent = routineNotice;
  }

  async function saveRoutine() {
    if (!isRoutinesViewOpen() || routineBusy) return;
    const values = readRoutineForm();
    if (!values) return;
    const btn = field<HTMLButtonElement>('rtSaveBtn');
    const creating = routineCreating;
    const hostId = routineFormHostId(), owner = captureForm(), selected = routineSelected;
    if (!routineCreating && !selected) return;
    if (!ownsForm(owner)) return;
    const token = mutationToken = Symbol();
    setRoutineFormError('');
    setRoutineNotice('');
    routineBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const path = creating ? '/api/routines' : `/api/routines/${encodeURIComponent(selected!.id)}`;
      const res = await apiFetch(owner.endpoint, path, {
        method: creating ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(routineFormBody(values)),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payloadError(data, res.status));
      if (!ownsForm(owner) || mutationToken !== token) return;
      const saved = decodeRoutine(data, owner.endpoint);
      const edited = readRoutineForm();
      routineCreating = false;
      routineSelected = saved;
      routineSelKey = routineKey(hostId, saved.id);
      routineVersionShown = null;
      renderRoutineDetail(edited && JSON.stringify(edited) !== JSON.stringify(values) ? edited : undefined, JSON.stringify(values));
      setRoutineNotice(creating ? 'Routine created.' : `Saved (v${saved.promptVersion || 1}).`);
      void loadRoutinesView();
      if (creating) {
        routineInvocations = [];
        routineInvocationsNextBefore = null;
        startRoutineInvocationPoll();
      }
      loadRoutineInvocations({ reset: true });
    } catch (e) {
      if (ownsForm(owner) && mutationToken === token) setRoutineFormError(errorMessage(e));
    } finally {
      if (ownsForm(owner) && mutationToken === token) { mutationToken = null; routineBusy = false; if (btn) { btn.disabled = false; btn.textContent = creating ? 'Create routine' : 'Save'; } }
    }
  }

  async function runRoutineNow() {
    if (!isRoutinesViewOpen() || routineBusy || !routineSelected) return;
    const btn = field<HTMLButtonElement>('rtRunBtn'), owner = captureForm(), selected = routineSelected;
    if (!ownsForm(owner)) return;
    const token = mutationToken = Symbol();
    setRoutineFormError('');
    setRoutineNotice('');
    routineBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
    try {
      const res = await apiFetch(owner.endpoint,
        `/api/routines/${encodeURIComponent(selected.id)}/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'pi-dish-ui' }),
        });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 busy / 429 rate-limited carry their own useful shapes.
        const extra = res.status === 429 && record(data) && typeof data.retryAfterSec === 'number' ? ` (retry in ${data.retryAfterSec}s)` : '';
        throw new Error(payloadError(data, res.status) + extra);
      }
      if (!ownsForm(owner) || mutationToken !== token) return;
      setRoutineNotice('Run started.');
      await loadRoutineInvocations({ reset: true });
      if (ownsForm(owner)) void loadRoutinesView(); // the row's run count and last-run line just changed
    } catch (e) {
      if (ownsForm(owner) && mutationToken === token) setRoutineFormError(errorMessage(e));
    } finally {
      if (ownsForm(owner) && mutationToken === token) { mutationToken = null; routineBusy = false; if (btn) { btn.disabled = false; btn.textContent = 'Run now'; } }
    }
  }

  let routineDeleteArmTimer: ReturnType<typeof setTimeout> | undefined;

  async function deleteRoutine() {
    if (!isRoutinesViewOpen() || routineBusy || !routineSelected) return;
    const btn = field<HTMLButtonElement>('rtDeleteBtn'), owner = captureForm(), selected = routineSelected;
    if (!ownsForm(owner)) return;
    if (!routineDeleteArmed) {
      // Two-tap arm, like the sidebar's row-level close.
      routineDeleteArmed = true;
      if (btn) btn.textContent = 'Delete?';
      clearTimeout(routineDeleteArmTimer);
      routineDeleteArmTimer = setTimeout(() => {
        if (!ownsForm(owner)) return;
        routineDeleteArmed = false;
        const live = field<HTMLButtonElement>('rtDeleteBtn');
        if (live) live.textContent = 'Delete';
      }, 3000);
      return;
    }
    clearTimeout(routineDeleteArmTimer);
    const token = mutationToken = Symbol();
    routineDeleteArmed = false;
    routineBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
    try {
      const res = await apiFetch(owner.endpoint,
        `/api/routines/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payloadError(data, res.status));
      if (!ownsForm(owner) || mutationToken !== token) return;
      stopRoutineInvocationPoll();
      routineSelected = null;
      routineSelKey = null;
      routineFormBaseline = null;
      routineInvocations = [];
      backToRoutinesList();
      renderRoutineDetail();
      await loadRoutinesView();
    } catch (e) {
      if (!ownsForm(owner) || mutationToken !== token) return;
      mutationToken = null; routineBusy = false;
      setRoutineFormError(errorMessage(e));
      if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
      return;
    }
    if (mutationToken === token) { mutationToken = null; routineBusy = false; }
  }

  return { open: openRoutinesView, close: closeRoutinesView, isOpen: isRoutinesViewOpen, refresh: refreshRoutinesView, escape: routinesViewEscape,
    back: backToRoutinesList, select: selectRoutine, create: startRoutineCreate, updateButton: updateRoutinesButton,
    save: saveRoutine, run: runRoutineNow, delete: deleteRoutine, get invocations() { return routineInvocations as readonly RoutineInvocation[]; },
    dispose() { closeRoutinesView(); disposed = true; routineModelCatalogs.clear(); routineHarnessCatalogs.clear(); },
  };
}
