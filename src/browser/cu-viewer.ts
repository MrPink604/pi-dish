import { errorMessage, readJson, responseError, type ApiRequest, type HostEndpoint } from './api-client';
import {
  cuPanelStorageKey,
  cuSeatPresentation,
  cuSessionListCue,
  cuSpacesViewerUrl,
  decodeCuBusyError,
  decodeCuRelease,
  decodeCuStatus,
  decodeCuTakeover,
  decodeCuTicket,
  formatBusyMessage,
  isOwnHumanLease,
  type CuBusyInfo,
  type CuLocalHumanLease,
  type CuSessionListCue,
  type CuStatus,
} from './cu-viewer-data';
import { hostDisplayLabel, sessionKey } from './helper-identity';
import { escapeHtml } from '../core/helper-format';

export interface CuViewerHost extends HostEndpoint {
  readonly hostId: string | null;
  readonly self?: boolean;
  readonly name?: string | null;
  readonly label?: string | null;
  readonly capabilities?: Readonly<Record<string, boolean | undefined>>;
}

export interface CuViewerOptions {
  root: HTMLElement;
  request: ApiRequest;
  hosts: () => readonly CuViewerHost[];
  host: (id: string | null | undefined) => CuViewerHost | null;
  currentSession: () => { id?: string | null; host?: string | null } | null;
  selectionGeneration?: () => number;
  supports: (host: CuViewerHost | null | undefined) => boolean;
  dot: (hostId: string | null) => string;
  ticket: (host: HostEndpoint) => Promise<string>;
  source?: (url: string) => EventSource;
  closeOtherViews: () => void;
  toggleSidebar?: () => void;
  onSeatChange?: () => void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now?: () => number;
  streamRetryMs?: number;
}

type NoticeKind = 'info' | 'busy' | 'error';
type ViewerSurface = 'none' | 'pane' | 'panel';
type HostStatusSubscriber = 'list' | 'viewer';

interface ViewerNotice {
  kind: NoticeKind;
  text: string;
}

interface HeldHumanLease extends CuLocalHumanLease {
  readonly endpoint: Readonly<HostEndpoint>;
  connGen: number;
}

interface ViewerSurfaceRefs {
  readonly hostDot?: HTMLElement | null;
  readonly hostLabel?: HTMLElement | null;
  readonly modePill: HTMLElement | null;
  readonly seatBadge: HTMLElement | null;
  readonly seatDetail: HTMLElement | null;
  readonly takeoverBtn: HTMLButtonElement | null;
  readonly handBackBtn: HTMLButtonElement | null;
  readonly noticeEl: HTMLElement | null;
  readonly stage: HTMLElement | null;
  readonly placeholder: HTMLElement | null;
}

interface HostStatusEntry {
  readonly hostKey: string;
  readonly hostId: string | null;
  endpoint: Readonly<HostEndpoint>;
  readonly subscribers: Set<HostStatusSubscriber>;
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
const TAKEOVER_CLASSES = [
  'usage-open',
  'recovery-open',
  'fleet-open',
  'cu-viewer-open',
  'search-open',
  'subagents-open',
  'new-session-open',
  'skills-open',
  'routines-open',
] as const;
// Outermost deadline in the CU call chain:
// browser (25s) > hub relay (15s) > guest spaces proxy (10s) > broker (8s).
const CU_REQUEST_TIMEOUT_MS = 25_000;

function defaultSessionStorage(doc: Document): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return doc.defaultView?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function createCuViewer(options: CuViewerOptions) {
  const doc = options.root.ownerDocument;
  const now = options.now ?? (() => Date.now());
  const openSource = options.source ?? ((url: string) => new EventSource(url));
  const storage = options.storage !== undefined ? options.storage : defaultSessionStorage(doc);
  const localLeases = new Map<string, HeldHumanLease>();
  const releasingLeaseIds = new Set<string>();
  const hostStatuses = new Map<string, HostStatusEntry>();
  const visibleListHostKeys = new Set<string>();
  const lastCueFingerprints = new Map<string, string>();

  let disposed = false;
  let surface: ViewerSurface = 'none';
  let generation = 0;
  let ticketSequence = 0;
  let activeHost: CuViewerHost | null = null;
  let activeHostKey: string | null = null;
  let panelSessionKey: string | null = null;
  let restoredPanelSessionKey: string | null = null;
  let sessionViewOccluded = false;
  let suspendedPanelForOcclusion = false;
  let suspendedSelectionGen: number | null = null;
  let suspendedSessionKey: string | null = null;
  let status: CuStatus | null = null;
  let mode: 'view-only' | 'interactive' = 'view-only';
  let notice: ViewerNotice | null = null;
  let actionBusy = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let containerMounted = false;
  let panelMounted = false;
  let chipBound = false;
  let iframeUrl: string | null = null;
  let iframeError: string | null = null;

  const keyOf = (host: CuViewerHost) => `${host.hostId || ''}\0${host.base}\0${host.token || ''}`;
  const isOpen = () => !disposed && surface === 'pane' && options.root.classList.contains('cu-viewer-open');
  const isPanelOpen = () => !disposed && surface === 'panel';
  const isViewerActive = () => !disposed && surface !== 'none';
  const hostSupported = (host: CuViewerHost | null | undefined): host is CuViewerHost =>
    !!host && options.supports(host);
  const isAnyTakeoverOpen = () => TAKEOVER_CLASSES.some(cls => options.root.classList.contains(cls));

  function sessionIdentityKey(
    session: { id?: string | null; host?: string | null } | null,
    host: CuViewerHost | null,
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

  function notifySeatCueIfChanged(hostKey: string, nextStatus: CuStatus | null): void {
    const cue = cuSessionListCue(nextStatus, localLeases.get(hostKey) ?? null);
    const nextFp = cueFingerprint(cue);
    const prevFp = lastCueFingerprints.get(hostKey) ?? '';
    if (nextFp) lastCueFingerprints.set(hostKey, nextFp);
    else lastCueFingerprints.delete(hostKey);
    if (prevFp !== nextFp) options.onSeatChange?.();
  }

  function ensureContainer(): HTMLElement {
    let el = doc.getElementById('cuViewerView');
    if (!el) {
      // Old cached HTML without #cuViewerView: create the pane dynamically so
      // new JS survives HTML/JS version skew without breaking or losing the view.
      el = doc.createElement('div');
      el.id = 'cuViewerView';
      el.className = 'cu-viewer-view';
      el.hidden = true;
      options.root.appendChild(el);
    }
    if (!containerMounted) {
      containerMounted = true;
      el.innerHTML =
        '<div class="usage-view-header cu-viewer-header">' +
          '<button class="menu-btn" id="cuViewerMenuBtn" type="button" aria-label="Open session list">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>' +
          '</button>' +
          '<span class="cu-viewer-title-wrap">' +
            '<span class="cu-viewer-dot" id="cuViewerHostDot"></span>' +
            '<span class="usage-view-title">Desktop</span>' +
            '<span class="cu-viewer-host" id="cuViewerHostLabel"></span>' +
            '<span class="cu-viewer-mode" id="cuViewerModePill">View only</span>' +
          '</span>' +
          '<button class="btn-icon" id="cuViewerRefreshBtn" type="button" title="Refresh desktop" aria-label="Refresh desktop">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-2.636-6.364"/><path d="M21 3v6h-6"/></svg>' +
          '</button>' +
          '<button class="btn-icon" id="cuViewerCloseBtn" type="button" title="Close (Esc)" aria-label="Close desktop viewer">✕</button>' +
        '</div>' +
        '<div class="cu-viewer-bar">' +
          '<div class="cu-seat-status" id="cuSeatStatus" role="status" aria-live="polite">' +
            '<span class="cu-seat-badge" id="cuSeatBadge" data-tone="idle">Idle</span>' +
            '<span class="cu-seat-detail" id="cuSeatDetail"></span>' +
          '</div>' +
          '<div class="cu-viewer-actions" id="cuViewerActions">' +
            '<button type="button" class="btn btn-small btn-primary" id="cuTakeoverBtn">Take Over</button>' +
            '<button type="button" class="btn btn-small btn-primary" id="cuHandBackBtn" hidden>Hand Back</button>' +
          '</div>' +
        '</div>' +
        '<div class="cu-viewer-notice" id="cuViewerNotice" role="alert" hidden></div>' +
        '<div class="cu-viewer-stage" id="cuViewerStage">' +
          '<div class="cu-viewer-placeholder" id="cuViewerPlaceholder">Loading desktop viewer…</div>' +
        '</div>';

      el.addEventListener('click', (event) => {
        if (disposed) return;
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null;
        if (!target) return;
        if (target.id === 'cuViewerMenuBtn') { options.toggleSidebar?.(); return; }
        if (target.id === 'cuViewerCloseBtn') { close(); return; }
        if (target.id === 'cuViewerRefreshBtn') { void refresh(); return; }
        if (target.id === 'cuTakeoverBtn') { void performTakeover(); return; }
        if (target.id === 'cuHandBackBtn') { void performRelease(); }
      });
    }
    return el;
  }

  function ensurePanel(): HTMLElement | null {
    const sessionView = doc.getElementById('sessionView');
    if (!sessionView) return null;
    let el = doc.getElementById('cuSessionPanel');
    if (!el) {
      el = doc.createElement('section');
      el.id = 'cuSessionPanel';
      el.className = 'cu-session-panel';
      el.setAttribute('aria-label', 'Desktop viewer');
      el.hidden = true;
      const anchor = sessionView.querySelector('#resumeBar') ?? sessionView.querySelector('.input-area');
      if (anchor) sessionView.insertBefore(el, anchor);
      else sessionView.appendChild(el);
    }
    if (!panelMounted) {
      panelMounted = true;
      el.innerHTML =
        '<div class="cu-panel-header">' +
          '<button type="button" class="cu-panel-toggle" id="cuSessionPanelToggle" aria-expanded="false" aria-controls="cuSessionPanelBody">' +
            '<span class="cu-panel-chevron" id="cuPanelChevron" aria-hidden="true">▸</span>' +
            '<span class="cu-panel-title">Desktop</span>' +
            '<span class="cu-seat-badge cu-panel-summary" id="cuPanelSummary" data-tone="idle" hidden></span>' +
          '</button>' +
          '<span class="cu-viewer-mode cu-panel-open-only" id="cuPanelModePill" data-mode="view-only" hidden>View only</span>' +
          '<button type="button" class="btn-icon cu-panel-open-only" id="cuPanelRefreshBtn" title="Refresh desktop" aria-label="Refresh desktop" hidden>' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-2.636-6.364"/><path d="M21 3v6h-6"/></svg>' +
          '</button>' +
          '<button type="button" class="btn-icon cu-panel-open-only" id="cuPanelExpandBtn" title="Open full-pane desktop viewer" aria-label="Open full-pane desktop viewer" hidden>⤢</button>' +
        '</div>' +
        '<div class="cu-panel-body" id="cuSessionPanelBody" hidden>' +
          '<div class="cu-viewer-bar cu-panel-bar">' +
            '<div class="cu-seat-status" id="cuPanelSeatStatus" role="status" aria-live="polite">' +
              '<span class="cu-seat-badge" id="cuPanelSeatBadge" data-tone="idle">Idle</span>' +
              '<span class="cu-seat-detail" id="cuPanelSeatDetail"></span>' +
            '</div>' +
            '<div class="cu-viewer-actions" id="cuPanelActions">' +
              '<button type="button" class="btn btn-small btn-primary" id="cuPanelTakeoverBtn">Take Over</button>' +
              '<button type="button" class="btn btn-small btn-primary" id="cuPanelHandBackBtn" hidden>Hand Back</button>' +
            '</div>' +
          '</div>' +
          '<div class="cu-viewer-notice" id="cuPanelNotice" role="alert" hidden></div>' +
          '<div class="cu-viewer-stage cu-panel-stage" id="cuPanelStage">' +
            '<div class="cu-viewer-placeholder" id="cuPanelPlaceholder">Loading desktop viewer…</div>' +
          '</div>' +
        '</div>';

      el.addEventListener('click', (event) => {
        if (disposed) return;
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null;
        if (!target) return;
        if (target.id === 'cuSessionPanelToggle') { togglePanel(); return; }
        if (target.id === 'cuPanelRefreshBtn') { void refresh(); return; }
        if (target.id === 'cuPanelExpandBtn') {
          const session = options.currentSession();
          const host = activeHost ?? (session ? options.host(session.host ?? null) : null);
          if (hostSupported(host)) open(host);
          return;
        }
        if (target.id === 'cuPanelTakeoverBtn') { void performTakeover(); return; }
        if (target.id === 'cuPanelHandBackBtn') { void performRelease(); }
      });
    }
    return el;
  }

  function setPanelExpandedDom(expanded: boolean): void {
    const panel = doc.getElementById('cuSessionPanel');
    const sessionView = doc.getElementById('sessionView');
    if (sessionView) sessionView.classList.toggle('cu-panel-open', expanded);
    if (!panel) return;
    panel.classList.toggle('open', expanded);
    const toggle = doc.getElementById('cuSessionPanelToggle');
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const chevron = doc.getElementById('cuPanelChevron');
    if (chevron) chevron.textContent = expanded ? '▾' : '▸';
    const body = doc.getElementById('cuSessionPanelBody');
    if (body) body.hidden = !expanded;
    for (const id of ['cuPanelModePill', 'cuPanelRefreshBtn', 'cuPanelExpandBtn']) {
      const node = doc.getElementById(id);
      if (node) node.hidden = !expanded;
    }
    renderPanelSummary();
  }

  function renderPanelSummary(): void {
    const summary = doc.getElementById('cuPanelSummary');
    if (!summary) return;
    if (surface === 'panel') {
      summary.hidden = true;
      summary.textContent = '';
      return;
    }
    const session = options.currentSession();
    const host = session ? options.host(session.host ?? null) : null;
    if (!hostSupported(host)) {
      summary.hidden = true;
      summary.textContent = '';
      return;
    }
    const hostKey = keyOf(host);
    const entry = hostStatuses.get(hostKey);
    const cue = entry && !entry.disconnected
      ? cuSessionListCue(entry.status, localLeases.get(hostKey) ?? null)
      : null;
    if (!cue) {
      summary.hidden = true;
      summary.textContent = '';
      return;
    }
    summary.hidden = false;
    summary.dataset.tone = cue.tone;
    summary.textContent = cue.tone === 'self'
      ? 'You have control'
      : cue.tone === 'waiting'
        ? 'Waiting for you'
        : cue.holderKind === 'human'
          ? 'Human'
          : 'Agent';
  }

  function activeSurfaceRefs(): ViewerSurfaceRefs | null {
    if (surface === 'pane') {
      return {
        hostDot: doc.getElementById('cuViewerHostDot'),
        hostLabel: doc.getElementById('cuViewerHostLabel'),
        modePill: doc.getElementById('cuViewerModePill'),
        seatBadge: doc.getElementById('cuSeatBadge'),
        seatDetail: doc.getElementById('cuSeatDetail'),
        takeoverBtn: doc.getElementById('cuTakeoverBtn') as HTMLButtonElement | null,
        handBackBtn: doc.getElementById('cuHandBackBtn') as HTMLButtonElement | null,
        noticeEl: doc.getElementById('cuViewerNotice'),
        stage: doc.getElementById('cuViewerStage'),
        placeholder: doc.getElementById('cuViewerPlaceholder'),
      };
    }
    if (surface === 'panel') {
      return {
        modePill: doc.getElementById('cuPanelModePill'),
        seatBadge: doc.getElementById('cuPanelSeatBadge'),
        seatDetail: doc.getElementById('cuPanelSeatDetail'),
        takeoverBtn: doc.getElementById('cuPanelTakeoverBtn') as HTMLButtonElement | null,
        handBackBtn: doc.getElementById('cuPanelHandBackBtn') as HTMLButtonElement | null,
        noticeEl: doc.getElementById('cuPanelNotice'),
        stage: doc.getElementById('cuPanelStage'),
        placeholder: doc.getElementById('cuPanelPlaceholder'),
      };
    }
    return null;
  }

  function ensureSessionChip(): HTMLButtonElement | null {
    let chip = doc.getElementById('sessionDesktopChip') as HTMLButtonElement | null;
    if (!chip) {
      const chipsRow = doc.getElementById('sessionChips');
      if (!chipsRow) return null;
      chip = doc.createElement('button');
      chip.type = 'button';
      chip.id = 'sessionDesktopChip';
      chip.className = 'badge cu-desktop-chip';
      chip.textContent = 'Desktop';
      chip.style.display = 'none';
      chipsRow.appendChild(chip);
    }
    if (!chipBound) {
      chipBound = true;
      chip.addEventListener('click', () => {
        if (disposed) return;
        const session = options.currentSession();
        const host = options.host(session?.host ?? null);
        if (hostSupported(host)) open(host);
      });
    }
    return chip;
  }

  function syncSessionPanel(): void {
    if (disposed) return;
    const session = options.currentSession();
    const host = session ? options.host(session.host ?? null) : null;
    if (!session || !hostSupported(host)) {
      if (surface === 'panel') close();
      else setPanelExpandedDom(false);
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
    if (surface === 'panel' && (panelSessionKey !== sKey || activeHostKey !== nextHostKey)) {
      closeActiveSurface(true);
    }

    renderPanelSummary();

    if (sKey && restoredPanelSessionKey !== sKey) {
      restoredPanelSessionKey = sKey;
      if (surface === 'none' && !sessionViewOccluded && !isAnyTakeoverOpen() && readPanelOpenPref(sKey)) {
        openSurface('panel', host, sKey);
      } else if (surface !== 'panel') {
        setPanelExpandedDom(false);
      }
    }
  }

  function syncSessionChip(): void {
    if (disposed) return;
    if (surface === 'pane' && activeHost?.hostId) {
      const currentPaneHost = options.host(activeHost.hostId);
      if (currentPaneHost && (!hostSupported(currentPaneHost) || keyOf(currentPaneHost) !== activeHostKey)) {
        closeActiveSurface(true);
      }
    }
    const chip = ensureSessionChip();
    const session = options.currentSession();
    const host = session ? options.host(session.host ?? null) : null;
    const show = hostSupported(host);
    if (chip) {
      chip.style.display = show ? '' : 'none';
      if (show) {
        const label = hostDisplayLabel(host);
        chip.title = `Open ${label} desktop viewer`;
        chip.setAttribute('aria-label', `Open ${label} desktop`);
      }
    }
    syncSessionPanel();
  }

  function isInteractiveMounted(): boolean {
    return mode === 'interactive' && iframeUrl !== null;
  }

  function currentLocalLease(): HeldHumanLease | null {
    return activeHostKey ? (localLeases.get(activeHostKey) ?? null) : null;
  }

  function clearHeartbeat(): void {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function clearCountdown(): void {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function clearAllIframes(): void {
    iframeUrl = null;
    for (const id of ['cuViewerStage', 'cuPanelStage']) {
      const stage = doc.getElementById(id);
      const existing = stage?.querySelector('iframe.cu-viewer-frame');
      if (existing) existing.remove();
    }
  }

  function mountIframe(url: string): void {
    const refs = activeSurfaceRefs();
    if (!refs?.stage) return;
    clearAllIframes();
    iframeUrl = url;
    iframeError = null;
    if (refs.placeholder) refs.placeholder.hidden = true;
    // Replace the iframe element so switching #ticket=... always performs a
    // clean document reload (hash-only updates on the same URL do not reboot viewer.js).
    const frame = doc.createElement('iframe');
    frame.className = 'cu-viewer-frame';
    frame.title = activeHost ? `${hostDisplayLabel(activeHost)} desktop viewer` : 'Computer-use desktop viewer';
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    frame.src = url;
    refs.stage.appendChild(frame);
  }

  function showPlaceholder(text: string): void {
    clearAllIframes();
    const refs = activeSurfaceRefs();
    if (refs?.placeholder) {
      refs.placeholder.textContent = text;
      refs.placeholder.hidden = false;
    }
  }

  function renderHeaderAndControls(): void {
    const refs = activeSurfaceRefs();
    if (!refs || !activeHost) return;
    if (refs.hostDot) refs.hostDot.innerHTML = options.dot(activeHost.hostId);
    if (refs.hostLabel) refs.hostLabel.textContent = hostDisplayLabel(activeHost);

    const localLease = currentLocalLease();
    const presentation = cuSeatPresentation(status, localLease, now());

    if (refs.modePill) {
      refs.modePill.textContent = mode === 'interactive' && presentation.ownControl ? 'Interactive' : 'View only';
      refs.modePill.dataset.mode = mode === 'interactive' && presentation.ownControl ? 'interactive' : 'view-only';
    }

    if (refs.seatBadge) {
      refs.seatBadge.textContent = presentation.badge;
      refs.seatBadge.dataset.tone = presentation.tone;
    }
    if (refs.seatDetail) refs.seatDetail.textContent = presentation.detail;

    if (refs.takeoverBtn) {
      refs.takeoverBtn.hidden = presentation.ownControl;
      refs.takeoverBtn.disabled = actionBusy;
    }
    if (refs.handBackBtn) {
      refs.handBackBtn.hidden = !presentation.ownControl;
      refs.handBackBtn.disabled = actionBusy;
      refs.handBackBtn.title = status?.preempted
        ? 'Release control and hand back to the paused agent'
        : 'Release control and return to view-only';
    }

    if (refs.noticeEl) {
      if (!notice) {
        refs.noticeEl.hidden = true;
        refs.noticeEl.textContent = '';
      } else {
        refs.noticeEl.hidden = false;
        refs.noticeEl.dataset.kind = notice.kind;
        refs.noticeEl.innerHTML = `<span class="cu-viewer-notice-text">${escapeHtml(notice.text)}</span>`;
      }
    }

    if (iframeError && !iframeUrl) {
      showPlaceholder(iframeError);
    }
  }

  function renderCountdownOnly(): void {
    const refs = activeSurfaceRefs();
    if (!refs || !activeHost) return;
    const presentation = cuSeatPresentation(status, currentLocalLease(), now());
    if (refs.seatDetail) refs.seatDetail.textContent = presentation.detail;
  }

  function startCountdown(): void {
    clearCountdown();
    countdownTimer = setInterval(() => {
      if (!isViewerActive()) { clearCountdown(); return; }
      renderCountdownOnly();
    }, 1000);
  }

  function owns(ownerGen: number, ownerHostKey: string): boolean {
    return !disposed && isViewerActive() && ownerGen === generation && activeHostKey === ownerHostKey;
  }

  function clearHostRetry(entry: HostStatusEntry): void {
    if (entry.retryTimer !== null) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
  }

  function disconnectHostStream(entry: HostStatusEntry): void {
    clearHostRetry(entry);
    if (entry.eventSource) {
      try { entry.eventSource.close(); } catch {}
      entry.eventSource = null;
    }
  }

  function hostEntryAlive(entry: HostStatusEntry, entryGen: number): boolean {
    return !disposed && hostStatuses.get(entry.hostKey) === entry && entry.generation === entryGen;
  }

  function scheduleHostReconnect(entry: HostStatusEntry, entryGen: number): void {
    if (!hostEntryAlive(entry, entryGen) || entry.retryTimer !== null) return;
    const delayMs = options.streamRetryMs ?? Math.min(10_000, 1_000 * 2 ** Math.min(entry.retryAttempt, 4));
    entry.retryAttempt += 1;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      if (hostEntryAlive(entry, entryGen)) void connectHostStream(entry, entryGen);
    }, delayMs);
  }

  async function connectHostStream(entry: HostStatusEntry, entryGen: number): Promise<void> {
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
        // Authoritative reconnect / broker-restart hello starts a fresh
        // connection generation so a restarted broker's lower epoch (e.g. 0)
        // is accepted while stale responses from the prior generation stay
        // rejected. The very first initial hello of a fresh connection stays
        // in connGen 1 so it does not abort an in-flight ticket or takeover.
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
        acceptHostStatus(entry, decoded, { connGen: entry.connGen, authoritativeHello });
        return;
      }
      entry.disconnected = false;
      acceptHostStatus(entry, decoded, { connGen: entry.connGen });
    };
    for (const type of SSE_EVENTS) {
      source.addEventListener(type, handleEvent as EventListener);
    }
    source.onmessage = handleEvent;
    source.onopen = () => {
      if (hostEntryAlive(entry, entryGen) && entry.eventSource === source) entry.retryAttempt = 0;
    };
    // Close on error and reconnect through connectHostStream so a fresh stream
    // ticket is minted on every reconnect instead of looping on an expired one.
    // Clear display state to unknown/stale on disconnect while keeping any
    // release credentials in localLeases separate so Hand Back still works.
    source.onerror = () => {
      if (!hostEntryAlive(entry, entryGen) || entry.eventSource !== source) return;
      try { source.close(); } catch {}
      entry.eventSource = null;
      entry.disconnected = true;
      entry.awaitingReconnectHello = true;
      entry.connGen += 1;
      entry.latestEpoch = -1;
      entry.status = null;
      if (isViewerActive() && activeHostKey === entry.hostKey) {
        status = null;
        renderHeaderAndControls();
      }
      notifySeatCueIfChanged(entry.hostKey, null);
      renderPanelSummary();
      scheduleHostReconnect(entry, entryGen);
    };
  }

  function acceptHostStatus(
    entry: HostStatusEntry,
    next: CuStatus,
    acceptOpts: { connGen?: number; authoritativeHello?: boolean } = {},
  ): void {
    if (disposed || hostStatuses.get(entry.hostKey) !== entry) return;
    if (acceptOpts.connGen !== undefined && acceptOpts.connGen !== entry.connGen) return;
    // Ignore stale status/SSE snapshots from an older epoch within the same
    // broker connection generation unless this is an authoritative hello.
    if (!acceptOpts.authoritativeHello && next.epoch < entry.latestEpoch) return;
    entry.disconnected = false;
    if (acceptOpts.authoritativeHello) entry.awaitingReconnectHello = false;
    entry.latestEpoch = next.epoch;
    entry.status = next;

    if (isViewerActive() && activeHostKey === entry.hostKey) {
      applyStatusUpdate(next, generation, entry.hostKey, entry.endpoint, entry.connGen);
    } else {
      const localLease = localLeases.get(entry.hostKey) ?? null;
      if (localLease && !isOwnHumanLease(next, localLease)) {
        localLeases.delete(entry.hostKey);
      } else if (localLease) {
        localLease.connGen = entry.connGen;
        if (next.lease?.expiresAt) localLease.expiresAt = next.lease.expiresAt;
      }
    }
    notifySeatCueIfChanged(entry.hostKey, next);
    renderPanelSummary();
  }

  async function fetchHostStatus(entry: HostStatusEntry, force = false): Promise<CuStatus | null> {
    if (disposed || hostStatuses.get(entry.hostKey) !== entry) return null;
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
          if (isViewerActive() && activeHostKey === entry.hostKey) {
            notice = { kind: 'error', text: responseError(response, data, `Status failed (${response.status})`) };
            renderHeaderAndControls();
          }
          return null;
        }
        const decoded = decodeCuStatus(data);
        if (decoded) acceptHostStatus(entry, decoded, { connGen: reqConnGen });
        return entry.status;
      } catch (error) {
        if (!hostEntryAlive(entry, entryGen) || entry.connGen !== reqConnGen) return null;
        if (isViewerActive() && activeHostKey === entry.hostKey) {
          notice = { kind: 'error', text: `Could not reach computer-use broker: ${errorMessage(error)}` };
          renderHeaderAndControls();
        }
        return null;
      } finally {
        if (entry.statusFlight === flight) entry.statusFlight = null;
      }
    })();
    entry.statusFlight = flight;
    return flight;
  }

  function subscribeHost(host: CuViewerHost, sub: HostStatusSubscriber): HostStatusEntry {
    const hostKey = keyOf(host);
    const endpoint = Object.freeze({ ...host });
    let entry = hostStatuses.get(hostKey);
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
      hostStatuses.set(hostKey, entry);
      void connectHostStream(entry, entry.generation);
      void fetchHostStatus(entry, false);
      return entry;
    }
    entry.endpoint = endpoint;
    entry.subscribers.add(sub);
    if (!entry.eventSource && entry.retryTimer === null) {
      void connectHostStream(entry, entry.generation);
    }
    if (entry.status === null && !entry.statusFlight) {
      void fetchHostStatus(entry, false);
    }
    return entry;
  }

  function teardownHostEntry(entry: HostStatusEntry): void {
    entry.generation += 1;
    disconnectHostStream(entry);
    entry.statusFlight = null;
    hostStatuses.delete(entry.hostKey);
    notifySeatCueIfChanged(entry.hostKey, null);
    renderPanelSummary();
  }

  function unsubscribeHost(hostKey: string, sub: HostStatusSubscriber): void {
    const entry = hostStatuses.get(hostKey);
    if (!entry) return;
    entry.subscribers.delete(sub);
    if (entry.subscribers.size === 0) {
      teardownHostEntry(entry);
    }
  }

  function syncVisibleHosts(hostIds?: readonly (string | null)[]): void {
    if (disposed) return;
    const nextHosts = new Map<string, CuViewerHost>();
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

  function seatCue(hostId?: string | null): CuSessionListCue | null {
    if (disposed) return null;
    const host = options.host(hostId ?? null);
    if (!hostSupported(host)) return null;
    const hostKey = keyOf(host);
    const entry = hostStatuses.get(hostKey);
    if (!entry || entry.disconnected) return null;
    return cuSessionListCue(entry.status, localLeases.get(hostKey) ?? null);
  }

  async function releaseLeaseBestEffort(
    endpoint: Readonly<HostEndpoint>,
    hostKey: string,
    held: Pick<HeldHumanLease, 'leaseId' | 'leaseToken' | 'connGen'>,
  ): Promise<void> {
    if (releasingLeaseIds.has(held.leaseId)) return;
    releasingLeaseIds.add(held.leaseId);
    try {
      const response = await options.request(endpoint, '/api/cu/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId: held.leaseId, leaseToken: held.leaseToken, handBack: true }),
        timeoutMs: CU_REQUEST_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (disposed || !response.ok) return;
      const released = decodeCuRelease(data);
      const entry = hostStatuses.get(hostKey);
      if (released && entry && entry.connGen === held.connGen && released.epoch >= entry.latestEpoch) {
        acceptHostStatus(entry, {
          state: released.state,
          epoch: released.epoch,
          lease: released.lease,
          preempted: null,
          health: entry.status?.health ?? null,
        }, { connGen: held.connGen });
      }
    } catch {
      // Best-effort release on surface teardown; broker TTL remains the safety net.
    } finally {
      releasingLeaseIds.delete(held.leaseId);
    }
  }

  function releaseHeldLeaseForHost(hostKey: string): void {
    const held = localLeases.get(hostKey);
    if (!held) return;
    localLeases.delete(hostKey);
    const entry = hostStatuses.get(hostKey);
    notifySeatCueIfChanged(hostKey, entry && !entry.disconnected ? entry.status : null);
    renderPanelSummary();
    void releaseLeaseBestEffort(held.endpoint, hostKey, held);
  }

  function startHeartbeat(ownerGen: number, ownerHostKey: string, endpoint: Readonly<HostEndpoint>, intervalSec: number): void {
    clearHeartbeat();
    const intervalMs = Math.max(5_000, intervalSec * 1000);
    heartbeatTimer = setInterval(() => {
      if (!owns(ownerGen, ownerHostKey)) { clearHeartbeat(); return; }
      if (doc.hidden) return;
      void sendHeartbeat(ownerGen, ownerHostKey, endpoint);
    }, intervalMs);
  }

  async function sendHeartbeat(ownerGen: number, ownerHostKey: string, endpoint: Readonly<HostEndpoint>): Promise<void> {
    const lease = localLeases.get(ownerHostKey);
    if (!lease || !owns(ownerGen, ownerHostKey)) { clearHeartbeat(); return; }
    const reqConnGen = hostStatuses.get(ownerHostKey)?.connGen ?? lease.connGen;
    try {
      const response = await options.request(lease.endpoint, '/api/cu/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId: lease.leaseId, leaseToken: lease.leaseToken }),
        timeoutMs: CU_REQUEST_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (!owns(ownerGen, ownerHostKey)) return;
      const entry = hostStatuses.get(ownerHostKey);
      if (response.ok) {
        const updated = decodeCuStatus(data);
        if (updated && entry && entry.connGen === reqConnGen && updated.epoch >= entry.latestEpoch) {
          if (updated.lease?.expiresAt) lease.expiresAt = updated.lease.expiresAt;
          if (!entry.disconnected) {
            const merged: CuStatus = status
              ? { ...status, state: updated.state, epoch: updated.epoch, lease: updated.lease ?? status.lease }
              : updated;
            acceptHostStatus(entry, merged, { connGen: reqConnGen });
          } else {
            renderHeaderAndControls();
          }
        }
        return;
      }
      if (response.status === 409 || response.status === 403) {
        if (entry && entry.connGen !== reqConnGen) return;
        const busy = decodeCuBusyError(data, 'Human control ended');
        handleLocalLeaseLost(ownerGen, ownerHostKey, endpoint, busy);
      }
    } catch {
      // Transient network hiccup: keep retrying on the next heartbeat tick.
    }
  }

  function handleLocalLeaseLost(
    ownerGen: number,
    ownerHostKey: string,
    endpoint: Readonly<HostEndpoint>,
    busy?: CuBusyInfo,
  ): void {
    if (!owns(ownerGen, ownerHostKey)) return;
    localLeases.delete(ownerHostKey);
    clearHeartbeat();
    const wasInteractive = mode === 'interactive';
    mode = 'view-only';
    notice = {
      kind: busy?.holder ? 'busy' : 'info',
      text: busy ? formatBusyMessage(busy, now()) : 'Control ended — returned to view-only',
    };
    const entry = hostStatuses.get(ownerHostKey);
    notifySeatCueIfChanged(ownerHostKey, entry && !entry.disconnected ? entry.status : null);
    renderHeaderAndControls();
    if (wasInteractive) void loadViewerTicket(ownerGen, ownerHostKey, endpoint, 'view-only');
    if (entry) void fetchHostStatus(entry, true);
  }

  function applyStatusUpdate(
    next: CuStatus,
    ownerGen: number,
    ownerHostKey: string,
    endpoint: Readonly<HostEndpoint>,
    entryConnGen: number,
  ): void {
    if (!owns(ownerGen, ownerHostKey)) return;
    const localLease = localLeases.get(ownerHostKey) ?? null;
    const hadOwnControl = !!localLease && mode === 'interactive';
    status = next;
    if (localLease && !isOwnHumanLease(next, localLease)) {
      localLeases.delete(ownerHostKey);
      clearHeartbeat();
      mode = 'view-only';
      if (hadOwnControl) {
        notice = {
          kind: next.state === 'human' ? 'busy' : 'info',
          text: next.state === 'human'
            ? formatBusyMessage({ code: 'seat_busy', state: next.state, epoch: next.epoch, holder: next.lease, message: 'Control taken over' }, now())
            : 'Control ended — returned to view-only',
        };
        void loadViewerTicket(ownerGen, ownerHostKey, endpoint, 'view-only');
      }
    } else if (localLease) {
      localLease.connGen = entryConnGen;
      if (next.lease?.expiresAt) localLease.expiresAt = next.lease.expiresAt;
    }
    renderHeaderAndControls();
  }

  async function loadViewerTicket(
    ownerGen: number,
    ownerHostKey: string,
    endpoint: Readonly<HostEndpoint>,
    ticketMode: 'view-only' | 'interactive',
  ): Promise<void> {
    const seq = ++ticketSequence;
    const reqConnGen = hostStatuses.get(ownerHostKey)?.connGen ?? 0;
    const localLease = localLeases.get(ownerHostKey) ?? null;
    const body: Record<string, unknown> = { mode: ticketMode };
    if (ticketMode === 'interactive' && localLease) {
      body.leaseId = localLease.leaseId;
      body.leaseToken = localLease.leaseToken;
    }
    try {
      const response = await options.request(endpoint, '/api/cu/viewer/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: CU_REQUEST_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (!owns(ownerGen, ownerHostKey) || seq !== ticketSequence) return;
      const entry = hostStatuses.get(ownerHostKey);
      if (entry && entry.connGen !== reqConnGen) return;
      if (!response.ok) {
        if (ticketMode === 'interactive' && (response.status === 403 || response.status === 409)) {
          handleLocalLeaseLost(ownerGen, ownerHostKey, endpoint, decodeCuBusyError(data, 'Interactive lease unavailable'));
          return;
        }
        iframeError = responseError(response, data, `Viewer ticket failed (${response.status})`);
        showPlaceholder(iframeError);
        return;
      }
      const ticket = decodeCuTicket(data);
      if (!ticket) {
        iframeError = 'Invalid viewer ticket response';
        showPlaceholder(iframeError);
        return;
      }
      const latestEpoch = entry?.latestEpoch ?? -1;
      if (ticket.epoch !== null && ticket.epoch < latestEpoch) return;
      if (ticketMode === 'view-only' && isOwnHumanLease(status, localLeases.get(ownerHostKey) ?? null)) return;
      mode = ticket.mode;
      mountIframe(cuSpacesViewerUrl(endpoint.base, ticket));
      renderHeaderAndControls();
    } catch (error) {
      if (!owns(ownerGen, ownerHostKey) || seq !== ticketSequence) return;
      iframeError = `Viewer unavailable: ${errorMessage(error)}`;
      showPlaceholder(iframeError);
    }
  }

  async function performTakeover(): Promise<void> {
    if (!activeHost || !activeHostKey || actionBusy) return;
    const ownerGen = generation;
    const ownerHostKey = activeHostKey;
    const endpoint = Object.freeze({ ...activeHost });
    const reqConnGen = hostStatuses.get(ownerHostKey)?.connGen ?? 0;
    actionBusy = true;
    notice = null;
    renderHeaderAndControls();
    try {
      const payload = { label: 'pi-dish', ttlSec: 600 };
      const response = await options.request(endpoint, '/api/cu/takeover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeoutMs: CU_REQUEST_TIMEOUT_MS,
      });
      const data = await readJson(response);
      const stillOwned = owns(ownerGen, ownerHostKey);
      if (!stillOwned) {
        // The controlling surface retired while takeover was in flight: if the
        // broker granted a lease, release that exact grant against its original
        // endpoint immediately so the browser never strands control.
        if (response.ok) {
          const late = decodeCuTakeover(data);
          if (late) {
            void releaseLeaseBestEffort(endpoint, ownerHostKey, {
              leaseId: late.leaseId,
              leaseToken: late.leaseToken,
              connGen: reqConnGen,
            });
          }
        }
        return;
      }
      const entry = hostStatuses.get(ownerHostKey);
      const latestEpoch = entry?.latestEpoch ?? -1;
      if (response.status === 409) {
        const busy = decodeCuBusyError(data);
        notice = {
          kind: 'busy',
          text: formatBusyMessage(busy, now()),
        };
        if (busy.holder && (!entry || entry.connGen === reqConnGen) && (busy.epoch === null || busy.epoch >= latestEpoch)) {
          const nextStatus: CuStatus = {
            state: busy.state === 'human' ? 'human' : (status?.state ?? 'human'),
            epoch: busy.epoch ?? (status?.epoch ?? 0),
            lease: busy.holder,
            preempted: status?.preempted ?? null,
            health: status?.health ?? null,
          };
          if (entry) acceptHostStatus(entry, nextStatus, { connGen: reqConnGen });
          else { status = nextStatus; renderHeaderAndControls(); }
        } else {
          renderHeaderAndControls();
        }
        return;
      }
      if (!response.ok) {
        notice = { kind: 'error', text: responseError(response, data, `Take over failed (${response.status})`) };
        renderHeaderAndControls();
        return;
      }
      const result = decodeCuTakeover(data);
      if (!result) {
        notice = { kind: 'error', text: 'Invalid take-over response from broker' };
        renderHeaderAndControls();
        return;
      }
      if (entry && (entry.connGen !== reqConnGen || result.epoch < latestEpoch)) {
        // Stale or superseded connection generation: never adopt or strand the grant.
        void releaseLeaseBestEffort(endpoint, ownerHostKey, {
          leaseId: result.leaseId,
          leaseToken: result.leaseToken,
          connGen: reqConnGen,
        });
        return;
      }
      // Invalidate any earlier in-flight view-only ticket fetch before mounting
      // interactive control so a late view-only reply cannot replace the iframe.
      ++ticketSequence;
      localLeases.set(ownerHostKey, {
        leaseId: result.leaseId,
        leaseToken: result.leaseToken,
        epoch: result.epoch,
        heartbeatIntervalSec: result.heartbeatIntervalSec,
        expiresAt: result.lease?.expiresAt ?? null,
        endpoint,
        connGen: entry?.connGen ?? reqConnGen,
      });
      const nextStatus: CuStatus = {
        state: result.state,
        epoch: result.epoch,
        lease: result.lease,
        preempted: result.preempted,
        health: status?.health ?? null,
      };
      mode = 'interactive';
      notice = null;
      if (entry) acceptHostStatus(entry, nextStatus, { connGen: entry.connGen });
      else status = nextStatus;
      startHeartbeat(ownerGen, ownerHostKey, endpoint, result.heartbeatIntervalSec);
      if (result.viewer) {
        mountIframe(cuSpacesViewerUrl(endpoint.base, result.viewer));
      } else {
        void loadViewerTicket(ownerGen, ownerHostKey, endpoint, 'interactive');
      }
      renderHeaderAndControls();
    } catch (error) {
      if (!owns(ownerGen, ownerHostKey)) return;
      notice = { kind: 'error', text: `Take over failed: ${errorMessage(error)}` };
      renderHeaderAndControls();
    } finally {
      if (owns(ownerGen, ownerHostKey)) {
        actionBusy = false;
        renderHeaderAndControls();
      }
    }
  }

  async function performRelease(): Promise<void> {
    if (!activeHost || !activeHostKey || actionBusy) return;
    const lease = localLeases.get(activeHostKey);
    if (!lease) return;
    const ownerGen = generation;
    const ownerHostKey = activeHostKey;
    const endpoint = lease.endpoint;
    const reqConnGen = hostStatuses.get(ownerHostKey)?.connGen ?? lease.connGen;
    actionBusy = true;
    notice = null;
    releasingLeaseIds.add(lease.leaseId);
    renderHeaderAndControls();
    try {
      const response = await options.request(endpoint, '/api/cu/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId: lease.leaseId, leaseToken: lease.leaseToken, handBack: true }),
        timeoutMs: CU_REQUEST_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (!owns(ownerGen, ownerHostKey)) {
        if (response.ok) {
          const released = decodeCuRelease(data);
          const entry = hostStatuses.get(ownerHostKey);
          if (released && entry && entry.connGen === reqConnGen && released.epoch >= entry.latestEpoch) {
            acceptHostStatus(entry, {
              state: released.state,
              epoch: released.epoch,
              lease: released.lease,
              preempted: null,
              health: entry.status?.health ?? null,
            }, { connGen: reqConnGen });
          }
        }
        return;
      }
      if (response.status === 409 || response.status === 403) {
        handleLocalLeaseLost(ownerGen, ownerHostKey, endpoint, decodeCuBusyError(data, 'Lease already released'));
        return;
      }
      if (!response.ok) {
        notice = { kind: 'error', text: responseError(response, data, `Hand back failed (${response.status})`) };
        renderHeaderAndControls();
        return;
      }
      const released = decodeCuRelease(data);
      const entry = hostStatuses.get(ownerHostKey);
      const latestEpoch = entry?.latestEpoch ?? -1;
      localLeases.delete(ownerHostKey);
      clearHeartbeat();
      mode = 'view-only';
      if (released && (!entry || entry.connGen === reqConnGen) && released.epoch >= latestEpoch) {
        notice = released.handedBackTo
          ? { kind: 'info', text: `Handed back to ${released.handedBackTo.label || released.handedBackTo.sessionId || 'agent'}.` }
          : null;
        const nextStatus: CuStatus = {
          state: released.state,
          epoch: released.epoch,
          lease: released.lease,
          preempted: null,
          health: status?.health ?? null,
        };
        if (entry) acceptHostStatus(entry, nextStatus, { connGen: reqConnGen });
        else { status = nextStatus; renderHeaderAndControls(); }
      } else {
        notifySeatCueIfChanged(ownerHostKey, entry && !entry.disconnected ? entry.status : null);
        renderHeaderAndControls();
      }
      void loadViewerTicket(ownerGen, ownerHostKey, endpoint, 'view-only');
    } catch (error) {
      if (!owns(ownerGen, ownerHostKey)) return;
      notice = { kind: 'error', text: `Hand back failed: ${errorMessage(error)}` };
      renderHeaderAndControls();
    } finally {
      releasingLeaseIds.delete(lease.leaseId);
      if (owns(ownerGen, ownerHostKey)) {
        actionBusy = false;
        renderHeaderAndControls();
      }
    }
  }

  async function refresh(): Promise<void> {
    if (!isViewerActive() || !activeHost || !activeHostKey) return;
    const ownerGen = generation;
    const ownerHostKey = activeHostKey;
    const endpoint = Object.freeze({ ...activeHost });
    notice = null;
    renderHeaderAndControls();
    const entry = hostStatuses.get(ownerHostKey);
    if (entry) await fetchHostStatus(entry, true);
    if (!owns(ownerGen, ownerHostKey)) return;
    const localLease = localLeases.get(ownerHostKey) ?? null;
    const own = isOwnHumanLease(status, localLease);
    await loadViewerTicket(ownerGen, ownerHostKey, endpoint, own ? 'interactive' : 'view-only');
  }

  function hidePaneDom(): void {
    options.root.classList.remove('cu-viewer-open');
    const el = doc.getElementById('cuViewerView');
    if (el) el.hidden = true;
  }

  function openSurface(targetSurface: 'pane' | 'panel', host: CuViewerHost, sessionKeyForPanel: string | null): void {
    const hostKey = keyOf(host);

    // Same-host handoff between the inline session panel and the main-pane
    // viewer keeps the single active controller, lease, heartbeat, and stream.
    if (surface !== 'none' && surface !== targetSurface && activeHostKey === hostKey) {
      const prevUrl = iframeUrl;
      const prevError = iframeError;
      clearAllIframes();
      clearSuspendedPanel();
      if (targetSurface === 'pane') {
        const container = ensureContainer();
        options.closeOtherViews();
        panelSessionKey = null;
        surface = 'pane';
        setPanelExpandedDom(false);
        container.hidden = false;
        options.root.classList.add('cu-viewer-open');
      } else {
        const panel = ensurePanel();
        if (!panel) return;
        hidePaneDom();
        panel.hidden = false;
        panelSessionKey = sessionKeyForPanel;
        surface = 'panel';
        setPanelExpandedDom(true);
      }
      activeHost = host;
      if (prevUrl) {
        mountIframe(prevUrl);
      } else {
        showPlaceholder(prevError || 'Loading desktop viewer…');
      }
      renderHeaderAndControls();
      return;
    }

    if (targetSurface === 'panel' && surface === 'panel' && activeHostKey === hostKey) {
      panelSessionKey = sessionKeyForPanel;
      const panel = ensurePanel();
      if (panel) panel.hidden = false;
      setPanelExpandedDom(true);
      return;
    }

    // Tear down any prior active surface / host before mounting fresh.
    clearSuspendedPanel();
    const prevHostKey = activeHostKey;
    clearHeartbeat();
    clearCountdown();
    clearAllIframes();
    if (surface === 'pane' && targetSurface !== 'pane') hidePaneDom();
    if (surface === 'panel' && targetSurface !== 'panel') {
      panelSessionKey = null;
      setPanelExpandedDom(false);
    }
    if (prevHostKey && prevHostKey !== hostKey) {
      releaseHeldLeaseForHost(prevHostKey);
      unsubscribeHost(prevHostKey, 'viewer');
    }

    if (targetSurface === 'pane') {
      const container = ensureContainer();
      options.closeOtherViews();
      container.hidden = false;
      options.root.classList.add('cu-viewer-open');
      panelSessionKey = null;
    } else {
      const panel = ensurePanel();
      if (!panel) return;
      panel.hidden = false;
      panelSessionKey = sessionKeyForPanel;
    }

    surface = targetSurface;
    if (targetSurface === 'panel') setPanelExpandedDom(true);

    const ownerGen = ++generation;
    ++ticketSequence;
    const endpoint = Object.freeze({ ...host });

    activeHost = host;
    activeHostKey = hostKey;
    mode = 'view-only';
    notice = null;
    actionBusy = false;
    iframeError = null;

    const entry = subscribeHost(host, 'viewer');
    status = entry.status;
    const initialLease = localLeases.get(hostKey) ?? null;
    mode = initialLease && isOwnHumanLease(status, initialLease) ? 'interactive' : 'view-only';

    showPlaceholder('Loading desktop viewer…');
    renderHeaderAndControls();
    startCountdown();

    void (async () => {
      await fetchHostStatus(entry, false);
      if (!owns(ownerGen, hostKey)) return;
      // Decide from the controller's accepted status and current lease so a
      // delayed initial status reply can never discard a newer Take Over.
      const localLease = localLeases.get(hostKey) ?? null;
      if (localLease && isOwnHumanLease(status, localLease)) {
        mode = 'interactive';
        startHeartbeat(ownerGen, hostKey, endpoint, localLease.heartbeatIntervalSec);
        if (!isInteractiveMounted()) {
          await loadViewerTicket(ownerGen, hostKey, endpoint, 'interactive');
        }
      } else {
        if (localLease) localLeases.delete(hostKey);
        if (!isInteractiveMounted()) {
          await loadViewerTicket(ownerGen, hostKey, endpoint, 'view-only');
        }
      }
    })();
  }

  function open(target?: CuViewerHost | string | null): void {
    if (disposed) return;
    let host: CuViewerHost | null = null;
    if (target && typeof target === 'object') host = target;
    else if (typeof target === 'string') host = options.host(target);
    else host = options.hosts().find(candidate => hostSupported(candidate)) ?? null;
    if (!hostSupported(host)) return;
    openSurface('pane', host, null);
  }

  function openPanel(opts: { persist?: boolean } = {}): void {
    if (disposed || sessionViewOccluded) return;
    const session = options.currentSession();
    const host = session ? options.host(session.host ?? null) : null;
    if (!session || !hostSupported(host)) return;
    const sKey = sessionIdentityKey(session, host);
    if (opts.persist !== false) writePanelOpenPref(sKey, true);
    restoredPanelSessionKey = sKey;
    openSurface('panel', host, sKey);
  }

  function closePanel(persist = true): void {
    if (disposed) return;
    if (persist) {
      const session = options.currentSession();
      const host = session ? options.host(session.host ?? null) : null;
      writePanelOpenPref(panelSessionKey ?? sessionIdentityKey(session, host), false);
    }
    if (surface === 'panel') {
      close();
    } else {
      setPanelExpandedDom(false);
    }
  }

  function togglePanel(): void {
    if (disposed) return;
    if (surface === 'panel') closePanel(true);
    else openPanel({ persist: true });
  }

  function clearSuspendedPanel(): void {
    suspendedPanelForOcclusion = false;
    suspendedSelectionGen = null;
    suspendedSessionKey = null;
  }

  function closeActiveSurface(clearSuspended: boolean): void {
    if (clearSuspended) clearSuspendedPanel();
    if (disposed || surface === 'none') return;
    const prevHostKey = activeHostKey;
    surface = 'none';
    panelSessionKey = null;
    ++generation;
    ++ticketSequence;
    clearHeartbeat();
    clearCountdown();
    clearAllIframes();
    actionBusy = false;
    notice = null;
    iframeError = null;
    activeHost = null;
    activeHostKey = null;
    status = null;
    mode = 'view-only';
    hidePaneDom();
    setPanelExpandedDom(false);
    if (prevHostKey) {
      // Never retain a human lease without a visible Hand Back control.
      releaseHeldLeaseForHost(prevHostKey);
      unsubscribeHost(prevHostKey, 'viewer');
    }
  }

  function close(): void {
    closeActiveSurface(true);
  }

  function setOccluded(occluded: boolean): void {
    if (disposed || sessionViewOccluded === occluded) return;
    sessionViewOccluded = occluded;
    if (occluded) {
      if (surface === 'panel') {
        suspendedPanelForOcclusion = true;
        suspendedSelectionGen = options.selectionGeneration?.() ?? null;
        suspendedSessionKey = panelSessionKey;
        closeActiveSurface(false);
      }
      return;
    }
    const shouldRestore = suspendedPanelForOcclusion;
    const prevSelGen = suspendedSelectionGen;
    const prevSessionKey = suspendedSessionKey;
    clearSuspendedPanel();
    if (!shouldRestore || surface !== 'none' || isAnyTakeoverOpen()) return;
    const currentSelGen = options.selectionGeneration?.() ?? null;
    if (prevSelGen !== null && currentSelGen !== prevSelGen) return;
    const session = options.currentSession();
    const host = session ? options.host(session.host ?? null) : null;
    if (!session || !hostSupported(host)) return;
    const sKey = sessionIdentityKey(session, host);
    if (prevSessionKey !== null && sKey !== prevSessionKey) return;
    openSurface('panel', host, sKey);
  }

  function dispose(): void {
    close();
    for (const hostKey of [...localLeases.keys()]) {
      releaseHeldLeaseForHost(hostKey);
    }
    for (const entry of [...hostStatuses.values()]) {
      entry.generation += 1;
      disconnectHostStream(entry);
      entry.statusFlight = null;
    }
    hostStatuses.clear();
    visibleListHostKeys.clear();
    lastCueFingerprints.clear();
    disposed = true;
    localLeases.clear();
  }

  return {
    open,
    close,
    openPanel,
    closePanel,
    togglePanel,
    setOccluded,
    refresh,
    isOpen,
    isPanelOpen,
    syncSessionChip,
    syncSessionPanel,
    syncVisibleHosts,
    seatCue,
    takeover: () => performTakeover(),
    release: () => performRelease(),
    get activeHost() { return activeHost; },
    get status() { return status; },
    get mode() { return mode; },
    get surface() { return surface; },
    dispose,
  };
}
