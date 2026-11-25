import { errorMessage, readJson, responseError, type ApiRequest, type HostEndpoint } from './api-client';
import {
  cuPanelStorageKey,
  cuSeatPresentation,
  cuSessionListCue,
  cuSpacesViewerUrl,
  decodeCuStatus,
  decodeCuTicket,
  type CuLocalHumanLease,
  type CuSessionListCue,
  type CuStatus,
} from './cu-viewer-data';
import { hostDisplayLabel, sessionKey } from './helper-identity';
import { escapeHtml } from '../core/helper-format';

export interface CuPanelHost extends HostEndpoint {
  readonly hostId: string | null;
  readonly self?: boolean;
  readonly name?: string | null;
  readonly label?: string | null;
  readonly capabilities?: Readonly<Record<string, boolean | undefined>>;
}

export type CuReadOnlyLeaseHint = Pick<CuLocalHumanLease, 'leaseId' | 'epoch' | 'expiresAt'>;

export interface CuSessionPanelOptions {
  root: HTMLElement;
  request: ApiRequest;
  host: (id: string | null | undefined) => CuPanelHost | null;
  currentSession: () => { id?: string | null; host?: string | null } | null;
  supports: (host: CuPanelHost | null | undefined) => boolean;
  dot: (hostId: string | null) => string;
  ticket: (host: HostEndpoint) => Promise<string>;
  source?: (url: string) => EventSource;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now?: () => number;
  streamRetryMs?: number;
  onSeatChange?: () => void;
  openPane: (host: CuPanelHost) => void;
  isPaneOpen: () => boolean;
  paneLocalLease: (host: CuPanelHost) => CuReadOnlyLeaseHint | null;
}

type DisplayHostSubscriber = 'list' | 'panel';

interface DisplayHostEntry {
  readonly hostKey: string;
  readonly hostId: string | null;
  endpoint: Readonly<CuPanelHost>;
  readonly subscribers: Set<DisplayHostSubscriber>;
  status: CuStatus | null;
  latestEpoch: number;
  connGen: number;
  disconnected: boolean;
  awaitingReconnectHello: boolean;
  streamConnectedOnce: boolean;
  statusFlight: Promise<CuStatus | null> | null;
  eventSource: EventSource | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  generation: number;
}

const SSE_EVENTS = ['hello', 'lease_changed', 'preempted', 'hand_back', 'seat_idle', 'attention_needed'] as const;
const CU_REQUEST_TIMEOUT_MS = 25_000;
const TAKEOVER_CLASSES = [
  'usage-open',
  'search-view-open',
  'subagents-open',
  'new-session-open',
  'skills-open',
  'routines-open',
  'recovery-open',
  'fleet-open',
  'cu-viewer-open',
] as const;

function defaultSessionStorage(doc: Document): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return doc.defaultView?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Display-only computer-use session panel and per-host sidebar seat-cue monitor.
 *
 * Step A invariant: this module is strictly view-only. It never acquires,
 * heartbeats, or releases a human lease; clicking Take Over opens the
 * standalone Desktop pane (slice-1 control flow) and does nothing else.
 */
export function createCuSessionPanel(options: CuSessionPanelOptions) {
  const doc = options.root.ownerDocument;
  const now = options.now ?? (() => Date.now());
  const openSource = options.source ?? ((url: string) => new EventSource(url));
  const storage = options.storage !== undefined ? options.storage : defaultSessionStorage(doc);
  const displayHosts = new Map<string, DisplayHostEntry>();
  const visibleListHostKeys = new Set<string>();
  const lastCueFingerprints = new Map<string, string>();

  let disposed = false;
  let panelMounted = false;
  let panelOpen = false;
  let panelGeneration = 0;
  let panelTicketSequence = 0;
  let panelTicketInFlight = 0;
  let panelHost: CuPanelHost | null = null;
  let panelHostKey: string | null = null;
  let panelSessionKey: string | null = null;
  let restoredPanelSessionKey: string | null = null;
  let panelNotice: string | null = null;
  let panelIframeUrl: string | null = null;
  let panelIframeError: string | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  const keyOf = (host: CuPanelHost) => `${host.hostId || ''}\0${host.base}\0${host.token || ''}`;
  const isPanelOpen = () => !disposed && panelOpen;
  const hostSupported = (host: CuPanelHost | null | undefined): host is CuPanelHost =>
    !!host && options.supports(host);
  const isAnyTakeoverOpen = () => TAKEOVER_CLASSES.some(cls => options.root.classList.contains(cls));

  function sessionIdentityKey(
    session: { id?: string | null; host?: string | null } | null,
    host: CuPanelHost | null,
  ): string | null {
    if (!session?.id) return null;
    return sessionKey(host?.hostId ?? session.host ?? null, session.id);
  }

  function readPanelOpenPref(sKey: string): boolean {
    if (!storage) return false;
    try {
      return storage.getItem(cuPanelStorageKey(sKey)) === '1';
    } catch {
      return false;
    }
  }

  function writePanelOpenPref(sKey: string | null, open: boolean): void {
    if (!storage || !sKey) return;
    try {
      const storageKey = cuPanelStorageKey(sKey);
      if (open) storage.setItem(storageKey, '1');
      else storage.removeItem(storageKey);
    } catch {}
  }

  function cueFingerprint(cue: CuSessionListCue | null): string {
    return cue ? `${cue.state}\0${cue.tone}\0${cue.label}\0${cue.title}` : '';
  }

  function notifySeatCueIfChanged(entry: DisplayHostEntry, nextStatus: CuStatus | null): void {
    const leaseHint = nextStatus ? options.paneLocalLease(entry.endpoint) : null;
    const cue = cuSessionListCue(nextStatus, leaseHint);
    const nextFp = cueFingerprint(cue);
    const prevFp = lastCueFingerprints.get(entry.hostKey) ?? '';
    if (nextFp) lastCueFingerprints.set(entry.hostKey, nextFp);
    else lastCueFingerprints.delete(entry.hostKey);
    if (prevFp !== nextFp) options.onSeatChange?.();
  }

  function clearCountdown(): void {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function startCountdown(): void {
    clearCountdown();
    countdownTimer = setInterval(() => {
      if (!isPanelOpen()) { clearCountdown(); return; }
      renderCountdownOnly();
    }, 1000);
  }

  function clearPanelIframe(): void {
    panelIframeUrl = null;
    const stage = doc.getElementById('cuPanelStage');
    const existing = stage?.querySelector('iframe.cu-viewer-frame');
    if (existing) existing.remove();
  }

  function mountPanelIframe(url: string): void {
    const stage = doc.getElementById('cuPanelStage');
    if (!stage) return;
    clearPanelIframe();
    panelIframeUrl = url;
    panelIframeError = null;
    const placeholder = doc.getElementById('cuPanelPlaceholder');
    if (placeholder) placeholder.hidden = true;
    const frame = doc.createElement('iframe');
    frame.className = 'cu-viewer-frame';
    frame.title = panelHost ? `${hostDisplayLabel(panelHost)} desktop viewer` : 'Computer-use desktop viewer';
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    frame.src = url;
    stage.appendChild(frame);
  }

  function showPanelPlaceholder(text: string): void {
    clearPanelIframe();
    const placeholder = doc.getElementById('cuPanelPlaceholder');
    if (placeholder) {
      placeholder.textContent = text;
      placeholder.hidden = false;
    }
  }

  function setPanelExpandedDom(expanded: boolean): void {
    const sessionView = doc.getElementById('sessionView');
    const panel = doc.getElementById('cuSessionPanel');
    const toggle = doc.getElementById('cuSessionPanelToggle');
    const body = doc.getElementById('cuSessionPanelBody');
    if (panel) panel.classList.toggle('open', expanded);
    if (sessionView) sessionView.classList.toggle('cu-panel-open', expanded);
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (body) body.hidden = !expanded;
  }

  function ensurePanel(): HTMLElement | null {
    const sessionView = doc.getElementById('sessionView');
    if (!sessionView) return null;
    let panel = doc.getElementById('cuSessionPanel');
    if (!panel) {
      panel = doc.createElement('section');
      panel.id = 'cuSessionPanel';
      panel.className = 'cu-session-panel';
      panel.setAttribute('aria-label', 'Desktop');
      panel.hidden = true;
      const inputArea = sessionView.querySelector('.input-area');
      if (inputArea && inputArea.parentElement === sessionView) {
        sessionView.insertBefore(panel, inputArea);
      } else {
        sessionView.appendChild(panel);
      }
    }
    if (!panelMounted) {
      panelMounted = true;
      panel.innerHTML =
        '<div class="cu-panel-header">' +
          '<button type="button" class="cu-panel-toggle" id="cuSessionPanelToggle" aria-expanded="false" aria-controls="cuSessionPanelBody">' +
            '<span class="cu-panel-chevron" aria-hidden="true">▸</span>' +
            '<span class="cu-panel-title">Desktop</span>' +
            '<span class="cu-panel-summary" id="cuPanelSummary" hidden></span>' +
          '</button>' +
        '</div>' +
        '<div class="cu-panel-body" id="cuSessionPanelBody" hidden>' +
          '<div class="cu-panel-bar">' +
            '<div class="cu-panel-meta">' +
              '<span class="cu-viewer-dot" id="cuPanelHostDot"></span>' +
              '<span class="cu-viewer-host" id="cuPanelHostLabel"></span>' +
              '<span class="cu-viewer-mode" id="cuPanelModePill" data-mode="view-only">View only</span>' +
            '</div>' +
            '<div class="cu-seat-status" id="cuPanelSeatStatus" role="status" aria-live="polite">' +
              '<span class="cu-seat-badge" id="cuPanelSeatBadge" data-tone="idle">Connecting…</span>' +
              '<span class="cu-seat-detail" id="cuPanelSeatDetail">Checking seat status</span>' +
            '</div>' +
            '<div class="cu-viewer-actions" id="cuPanelActions">' +
              '<button type="button" class="btn btn-small btn-primary" id="cuPanelTakeoverBtn">Take Over</button>' +
              '<button type="button" class="btn-icon" id="cuPanelRefreshBtn" title="Refresh desktop" aria-label="Refresh desktop">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-2.636-6.364"/><path d="M21 3v6h-6"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="cu-viewer-notice" id="cuPanelNotice" role="alert" hidden></div>' +
          '<div class="cu-viewer-stage cu-panel-stage" id="cuPanelStage">' +
            '<div class="cu-viewer-placeholder" id="cuPanelPlaceholder">Loading desktop viewer…</div>' +
          '</div>' +
        '</div>';

      panel.addEventListener('click', (event) => {
        if (disposed) return;
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null;
        if (!target) return;
        if (target.id === 'cuSessionPanelToggle') { togglePanel(); return; }
        if (target.id === 'cuPanelRefreshBtn') { void refreshPanel(); return; }
        if (target.id === 'cuPanelTakeoverBtn') {
          const session = options.currentSession();
          const host = panelHost ?? (session ? options.host(session.host ?? null) : null);
          if (hostSupported(host)) options.openPane(host);
        }
      });
    }
    return panel;
  }

  function renderPanelSummary(): void {
    const summaryEl = doc.getElementById('cuPanelSummary');
    if (!summaryEl) return;
    const session = options.currentSession();
    const host = session ? options.host(session.host ?? null) : null;
    if (!session || !hostSupported(host)) {
      summaryEl.hidden = true;
      summaryEl.textContent = '';
      return;
    }
    const entry = displayHosts.get(keyOf(host));
    if (!entry || entry.disconnected) {
      summaryEl.hidden = true;
      summaryEl.textContent = '';
      return;
    }
    const cue = cuSessionListCue(entry.status, options.paneLocalLease(host));
    if (!cue) {
      summaryEl.hidden = true;
      summaryEl.textContent = '';
      return;
    }
    summaryEl.hidden = false;
    summaryEl.dataset.tone = cue.tone;
    summaryEl.textContent = cue.label;
    summaryEl.title = cue.title;
  }

  function currentPanelDisplayStatus(): CuStatus | null {
    if (!panelHostKey) return null;
    const entry = displayHosts.get(panelHostKey);
    if (!entry || entry.disconnected) return null;
    return entry.status;
  }

  function renderPanelHeader(): void {
    if (!isPanelOpen() || !panelHost) return;
    const dotEl = doc.getElementById('cuPanelHostDot');
    if (dotEl) dotEl.innerHTML = options.dot(panelHost.hostId);
    const labelEl = doc.getElementById('cuPanelHostLabel');
    if (labelEl) labelEl.textContent = hostDisplayLabel(panelHost);

    const status = currentPanelDisplayStatus();
    const leaseHint = status ? options.paneLocalLease(panelHost) : null;
    const presentation = cuSeatPresentation(status, leaseHint, now());

    const modePill = doc.getElementById('cuPanelModePill');
    if (modePill) {
      modePill.textContent = 'View only';
      modePill.dataset.mode = 'view-only';
    }
    const badgeEl = doc.getElementById('cuPanelSeatBadge');
    if (badgeEl) {
      badgeEl.textContent = presentation.badge;
      badgeEl.dataset.tone = presentation.tone;
    }
    const detailEl = doc.getElementById('cuPanelSeatDetail');
    if (detailEl) detailEl.textContent = presentation.detail;

    const noticeEl = doc.getElementById('cuPanelNotice');
    if (noticeEl) {
      if (!panelNotice) {
        noticeEl.hidden = true;
        noticeEl.textContent = '';
      } else {
        noticeEl.hidden = false;
        noticeEl.dataset.kind = 'error';
        noticeEl.innerHTML = `<span class="cu-viewer-notice-text">${escapeHtml(panelNotice)}</span>`;
      }
    }

    if (panelIframeError && !panelIframeUrl) {
      showPanelPlaceholder(panelIframeError);
    }
    renderPanelSummary();
  }

  function renderCountdownOnly(): void {
    if (!isPanelOpen() || !panelHost) return;
    const status = currentPanelDisplayStatus();
    const leaseHint = status ? options.paneLocalLease(panelHost) : null;
    const presentation = cuSeatPresentation(status, leaseHint, now());
    const detailEl = doc.getElementById('cuPanelSeatDetail');
    if (detailEl) detailEl.textContent = presentation.detail;
  }

  function ownsPanel(panelGen: number, hostKey: string): boolean {
    return !disposed && panelOpen && panelGen === panelGeneration && panelHostKey === hostKey;
  }

  function clearHostRetry(entry: DisplayHostEntry): void {
    if (entry.retryTimer !== null) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
  }

  function disconnectHostStream(entry: DisplayHostEntry): void {
    clearHostRetry(entry);
    if (entry.eventSource) {
      try { entry.eventSource.close(); } catch {}
      entry.eventSource = null;
    }
  }

  function hostEntryAlive(entry: DisplayHostEntry, entryGen: number): boolean {
    return !disposed && displayHosts.get(entry.hostKey) === entry && entry.generation === entryGen;
  }

  function scheduleHostReconnect(entry: DisplayHostEntry, entryGen: number): void {
    if (!hostEntryAlive(entry, entryGen) || entry.retryTimer !== null) return;
    const delayMs = options.streamRetryMs ?? Math.min(10_000, 1_000 * 2 ** Math.min(entry.retryAttempt, 4));
    entry.retryAttempt += 1;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      if (hostEntryAlive(entry, entryGen)) void connectHostStream(entry, entryGen);
    }, delayMs);
  }

  function acceptDisplayStatus(
    entry: DisplayHostEntry,
    next: CuStatus,
    acceptOpts: { connGen?: number; authoritativeHello?: boolean } = {},
  ): void {
    if (disposed || displayHosts.get(entry.hostKey) !== entry) return;
    if (acceptOpts.connGen !== undefined && acceptOpts.connGen !== entry.connGen) return;
    if (!acceptOpts.authoritativeHello && next.epoch < entry.latestEpoch) return;
    entry.disconnected = false;
    if (acceptOpts.authoritativeHello) entry.awaitingReconnectHello = false;
    entry.latestEpoch = next.epoch;
    entry.status = next;
    notifySeatCueIfChanged(entry, next);
    if (panelOpen && panelHostKey === entry.hostKey) renderPanelHeader();
    else renderPanelSummary();
  }

  async function connectHostStream(entry: DisplayHostEntry, entryGen: number): Promise<void> {
    disconnectHostStream(entry);
    let streamUrl = `${entry.endpoint.base}/api/cu/stream`;
    if (entry.endpoint.token) {
      try {
        const ticket = await options.ticket(entry.endpoint);
        if (!hostEntryAlive(entry, entryGen)) return;
        streamUrl += `?ticket=${encodeURIComponent(ticket)}`;
      } catch {
        scheduleHostReconnect(entry, entryGen);
        return;
      }
    }
    if (!hostEntryAlive(entry, entryGen)) return;
    let source: EventSource;
    try {
      source = openSource(streamUrl);
    } catch {
      scheduleHostReconnect(entry, entryGen);
      return;
    }
    entry.eventSource = source;
    let seenHelloOnSource = false;
    const handleEvent = (event: MessageEvent) => {
      if (!hostEntryAlive(entry, entryGen) || entry.eventSource !== source) return;
      entry.retryAttempt = 0;
      let parsed: unknown;
      try { parsed = JSON.parse(String(event.data || '')); } catch { return; }
      const decoded = decodeCuStatus(parsed);
      if (!decoded) return;
      const isHello = event.type === 'hello';
      if (isHello) {
        // Display-only connection generation: an authoritative reconnect or
        // broker-restart hello accepts a lower epoch (e.g. 0) and discards
        // stale display polls from the previous generation.
        const authoritativeHello = entry.awaitingReconnectHello
          || seenHelloOnSource
          || entry.streamConnectedOnce;
        seenHelloOnSource = true;
        entry.streamConnectedOnce = true;
        if (authoritativeHello) {
          entry.connGen += 1;
          entry.latestEpoch = -1;
          entry.awaitingReconnectHello = false;
        }
        entry.disconnected = false;
        acceptDisplayStatus(entry, decoded, { connGen: entry.connGen, authoritativeHello });
        if (authoritativeHello && panelOpen && panelHostKey === entry.hostKey && !panelIframeUrl && panelTicketInFlight === 0) {
          void loadPanelTicket(panelGeneration, entry.hostKey, entry.endpoint, 0);
        }
        return;
      }
      entry.disconnected = false;
      acceptDisplayStatus(entry, decoded, { connGen: entry.connGen });
    };
    for (const type of SSE_EVENTS) {
      source.addEventListener(type, handleEvent as EventListener);
    }
    source.onmessage = handleEvent;
    source.onopen = () => {
      if (hostEntryAlive(entry, entryGen) && entry.eventSource === source) entry.retryAttempt = 0;
    };
    source.onerror = () => {
      if (!hostEntryAlive(entry, entryGen) || entry.eventSource !== source) return;
      try { source.close(); } catch {}
      entry.eventSource = null;
      entry.disconnected = true;
      entry.awaitingReconnectHello = true;
      entry.connGen += 1;
      entry.latestEpoch = -1;
      entry.status = null;
      notifySeatCueIfChanged(entry, null);
      if (panelOpen && panelHostKey === entry.hostKey) renderPanelHeader();
      else renderPanelSummary();
      scheduleHostReconnect(entry, entryGen);
    };
  }

  async function fetchDisplayStatus(entry: DisplayHostEntry, force = false): Promise<CuStatus | null> {
    if (disposed || displayHosts.get(entry.hostKey) !== entry) return null;
    if (!force) {
      if (entry.statusFlight) return entry.statusFlight;
      if (!entry.disconnected && entry.status !== null && entry.eventSource !== null && entry.eventSource.readyState !== 2) {
        return entry.status;
      }
    }
    const entryGen = entry.generation;
    const reqConnGen = entry.connGen;
    const endpoint = entry.endpoint;
    let flight: Promise<CuStatus | null> | null = null;
    flight = (async (): Promise<CuStatus | null> => {
      try {
        const response = await options.request(endpoint, '/api/cu/status', { timeoutMs: CU_REQUEST_TIMEOUT_MS });
        const data = await readJson(response);
        if (!hostEntryAlive(entry, entryGen) || entry.connGen !== reqConnGen) return null;
        if (!response.ok) {
          if (panelOpen && panelHostKey === entry.hostKey) {
            panelNotice = responseError(response, data, `Status failed (${response.status})`);
            renderPanelHeader();
          }
          return null;
        }
        const decoded = decodeCuStatus(data);
        if (decoded) acceptDisplayStatus(entry, decoded, { connGen: reqConnGen });
        return entry.status;
      } catch (error) {
        if (!hostEntryAlive(entry, entryGen) || entry.connGen !== reqConnGen) return null;
        if (panelOpen && panelHostKey === entry.hostKey) {
          panelNotice = `Could not reach computer-use broker: ${errorMessage(error)}`;
          renderPanelHeader();
        }
        return null;
      } finally {
        if (entry.statusFlight === flight) entry.statusFlight = null;
      }
    })();
    entry.statusFlight = flight;
    return flight;
  }

  function subscribeHost(host: CuPanelHost, sub: DisplayHostSubscriber): DisplayHostEntry {
    const hostKey = keyOf(host);
    const endpoint = Object.freeze({ ...host });
    let entry = displayHosts.get(hostKey);
    if (!entry) {
      entry = {
        hostKey,
        hostId: host.hostId,
        endpoint,
        subscribers: new Set([sub]),
        status: null,
        latestEpoch: -1,
        connGen: 1,
        disconnected: false,
        awaitingReconnectHello: false,
        streamConnectedOnce: false,
        statusFlight: null,
        eventSource: null,
        retryTimer: null,
        retryAttempt: 0,
        generation: 1,
      };
      displayHosts.set(hostKey, entry);
      void connectHostStream(entry, entry.generation);
      void fetchDisplayStatus(entry, false);
      return entry;
    }
    entry.endpoint = endpoint;
    entry.subscribers.add(sub);
    if (!entry.eventSource && entry.retryTimer === null) {
      void connectHostStream(entry, entry.generation);
    }
    if (entry.status === null && !entry.statusFlight) {
      void fetchDisplayStatus(entry, false);
    }
    return entry;
  }

  function teardownHostEntry(entry: DisplayHostEntry): void {
    entry.generation += 1;
    disconnectHostStream(entry);
    entry.statusFlight = null;
    displayHosts.delete(entry.hostKey);
    notifySeatCueIfChanged(entry, null);
    renderPanelSummary();
  }

  function unsubscribeHost(hostKey: string, sub: DisplayHostSubscriber): void {
    const entry = displayHosts.get(hostKey);
    if (!entry) return;
    entry.subscribers.delete(sub);
    if (entry.subscribers.size === 0) {
      teardownHostEntry(entry);
    }
  }

  async function loadPanelTicket(
    panelGen: number,
    hostKey: string,
    endpoint: Readonly<CuPanelHost>,
    retryCount = 0,
  ): Promise<void> {
    const seq = ++panelTicketSequence;
    const reqConnGen = displayHosts.get(hostKey)?.connGen ?? 0;
    panelTicketInFlight += 1;
    try {
      const response = await options.request(endpoint, '/api/cu/viewer/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'view-only' }),
        timeoutMs: CU_REQUEST_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (!ownsPanel(panelGen, hostKey) || seq !== panelTicketSequence) return;
      const entry = displayHosts.get(hostKey);
      if (entry && entry.connGen !== reqConnGen) {
        // Reissue if a reconnect discarded the in-flight ticket and the panel still needs it.
        if (!entry.disconnected && !panelIframeUrl && retryCount < 2) {
          void loadPanelTicket(panelGen, hostKey, endpoint, retryCount + 1);
        }
        return;
      }
      if (!response.ok) {
        panelIframeError = responseError(response, data, `Viewer ticket failed (${response.status})`);
        showPanelPlaceholder(panelIframeError);
        return;
      }
      const ticket = decodeCuTicket(data);
      if (!ticket) {
        panelIframeError = 'Invalid viewer ticket response';
        showPanelPlaceholder(panelIframeError);
        return;
      }
      const latestEpoch = entry?.latestEpoch ?? -1;
      if (ticket.epoch !== null && ticket.epoch < latestEpoch) return;
      mountPanelIframe(cuSpacesViewerUrl(endpoint.base, ticket));
      renderPanelHeader();
    } catch (error) {
      if (!ownsPanel(panelGen, hostKey) || seq !== panelTicketSequence) return;
      panelIframeError = `Viewer unavailable: ${errorMessage(error)}`;
      showPanelPlaceholder(panelIframeError);
    } finally {
      panelTicketInFlight = Math.max(0, panelTicketInFlight - 1);
    }
  }

  function teardownPanel(): void {
    if (!panelOpen) {
      setPanelExpandedDom(false);
      return;
    }
    const prevHostKey = panelHostKey;
    panelOpen = false;
    panelHost = null;
    panelHostKey = null;
    panelSessionKey = null;
    panelNotice = null;
    panelIframeError = null;
    ++panelGeneration;
    ++panelTicketSequence;
    clearCountdown();
    clearPanelIframe();
    setPanelExpandedDom(false);
    if (prevHostKey) unsubscribeHost(prevHostKey, 'panel');
  }

  function openPanelInternal(host: CuPanelHost, sKey: string | null): void {
    const panel = ensurePanel();
    if (!panel) return;
    const hostKey = keyOf(host);
    if (panelOpen && panelHostKey === hostKey) {
      panelSessionKey = sKey;
      panel.hidden = false;
      setPanelExpandedDom(true);
      renderPanelHeader();
      return;
    }
    teardownPanel();

    panel.hidden = false;
    panelOpen = true;
    panelHost = host;
    panelHostKey = hostKey;
    panelSessionKey = sKey;
    panelNotice = null;
    panelIframeError = null;
    const panelGen = ++panelGeneration;
    ++panelTicketSequence;
    const endpoint = Object.freeze({ ...host });

    setPanelExpandedDom(true);
    const entry = subscribeHost(host, 'panel');
    showPanelPlaceholder('Loading desktop viewer…');
    renderPanelHeader();
    startCountdown();

    void (async () => {
      await fetchDisplayStatus(entry, false);
      if (!ownsPanel(panelGen, hostKey)) return;
      await loadPanelTicket(panelGen, hostKey, endpoint, 0);
    })();
  }

  function openPanel(opts: { persist?: boolean } = {}): void {
    if (disposed) return;
    const session = options.currentSession();
    const host = session ? options.host(session.host ?? null) : null;
    if (!session || !hostSupported(host)) return;
    const sKey = sessionIdentityKey(session, host);
    if (opts.persist !== false) writePanelOpenPref(sKey, true);
    restoredPanelSessionKey = sKey;
    openPanelInternal(host, sKey);
  }

  function closePanel(persist = true): void {
    if (disposed) return;
    if (persist) {
      const session = options.currentSession();
      const host = session ? options.host(session.host ?? null) : null;
      writePanelOpenPref(panelSessionKey ?? sessionIdentityKey(session, host), false);
    }
    teardownPanel();
  }

  function togglePanel(): void {
    if (disposed) return;
    if (panelOpen) closePanel(true);
    else openPanel({ persist: true });
  }

  function hideForPane(): void {
    if (disposed) return;
    teardownPanel();
  }

  async function refreshPanel(): Promise<void> {
    if (!isPanelOpen() || !panelHost || !panelHostKey) return;
    const panelGen = panelGeneration;
    const hostKey = panelHostKey;
    const endpoint = Object.freeze({ ...panelHost });
    panelNotice = null;
    renderPanelHeader();
    const entry = displayHosts.get(hostKey);
    if (entry) await fetchDisplayStatus(entry, true);
    if (!ownsPanel(panelGen, hostKey)) return;
    await loadPanelTicket(panelGen, hostKey, endpoint, 0);
  }

  function syncSessionPanel(): void {
    if (disposed) return;
    const session = options.currentSession();
    const host = session ? options.host(session.host ?? null) : null;
    if (!session || !hostSupported(host)) {
      teardownPanel();
      const existing = doc.getElementById('cuSessionPanel');
      if (existing) existing.hidden = true;
      restoredPanelSessionKey = null;
      return;
    }

    const panel = ensurePanel();
    if (!panel) return;
    panel.hidden = false;

    const sKey = sessionIdentityKey(session, host);
    const nextHostKey = keyOf(host);
    if (panelOpen && (panelSessionKey !== sKey || panelHostKey !== nextHostKey)) {
      teardownPanel();
    }

    renderPanelSummary();

    if (sKey && restoredPanelSessionKey !== sKey) {
      restoredPanelSessionKey = sKey;
      if (!panelOpen && !options.isPaneOpen() && !isAnyTakeoverOpen() && readPanelOpenPref(sKey)) {
        openPanelInternal(host, sKey);
      } else if (!panelOpen) {
        setPanelExpandedDom(false);
      }
    }
  }

  function syncVisibleHosts(hostIds?: readonly (string | null)[]): void {
    if (disposed) return;
    const nextHosts = new Map<string, CuPanelHost>();
    for (const hostId of hostIds ?? []) {
      const host = options.host(hostId ?? null);
      if (hostSupported(host)) nextHosts.set(keyOf(host), host);
    }
    for (const oldKey of [...visibleListHostKeys]) {
      if (!nextHosts.has(oldKey)) {
        visibleListHostKeys.delete(oldKey);
        unsubscribeHost(oldKey, 'list');
      }
    }
    for (const [hostKey, host] of nextHosts) {
      if (!visibleListHostKeys.has(hostKey)) {
        visibleListHostKeys.add(hostKey);
        subscribeHost(host, 'list');
      }
    }
  }

  async function liveStatus(host: CuPanelHost): Promise<CuStatus | null> {
    if (disposed) return null;
    const entry = displayHosts.get(keyOf(host));
    if (!entry || entry.disconnected) return null;
    if (entry.status !== null && entry.eventSource !== null && entry.eventSource.readyState !== 2) {
      return entry.status;
    }
    if (entry.statusFlight) {
      const resolved = await entry.statusFlight;
      if (!disposed && displayHosts.get(entry.hostKey) === entry && !entry.disconnected && resolved) {
        return resolved;
      }
    }
    return null;
  }

  function syncDisplayStatus(host: CuPanelHost, nextStatus: CuStatus): void {
    if (disposed) return;
    const entry = displayHosts.get(keyOf(host));
    if (!entry || entry.disconnected) return;
    acceptDisplayStatus(entry, nextStatus, { connGen: entry.connGen });
  }

  function seatCue(hostId?: string | null): CuSessionListCue | null {
    if (disposed) return null;
    const host = options.host(hostId ?? null);
    if (!hostSupported(host)) return null;
    const entry = displayHosts.get(keyOf(host));
    if (!entry || entry.disconnected) return null;
    return cuSessionListCue(entry.status, options.paneLocalLease(host));
  }

  function dispose(): void {
    teardownPanel();
    for (const entry of [...displayHosts.values()]) {
      entry.generation += 1;
      disconnectHostStream(entry);
      entry.statusFlight = null;
    }
    displayHosts.clear();
    visibleListHostKeys.clear();
    lastCueFingerprints.clear();
    disposed = true;
  }

  return {
    openPanel,
    closePanel,
    togglePanel,
    hideForPane,
    isPanelOpen,
    refreshPanel,
    syncSessionPanel,
    syncVisibleHosts,
    liveStatus,
    syncDisplayStatus,
    seatCue,
    dispose,
  };
}
