import { errorMessage, readJson, responseError, type ApiRequest, type HostEndpoint } from './api-client';
import {
  cuSeatPresentation,
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
  type CuStatus,
} from './cu-viewer-data';
import { hostDisplayLabel } from './helper-identity';
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
  currentSession: () => { host?: string | null } | null;
  supports: (host: CuViewerHost | null | undefined) => boolean;
  dot: (hostId: string | null) => string;
  ticket: (host: HostEndpoint) => Promise<string>;
  source?: (url: string) => EventSource;
  closeOtherViews: () => void;
  toggleSidebar?: () => void;
  now?: () => number;
  streamRetryMs?: number;
}

type NoticeKind = 'info' | 'busy' | 'error';

interface ViewerNotice {
  kind: NoticeKind;
  text: string;
}

const SSE_EVENTS = ['hello', 'lease_changed', 'preempted', 'hand_back', 'seat_idle', 'attention_needed'] as const;
// Outermost deadline in the CU call chain:
// browser (25s) > hub relay (15s) > guest spaces proxy (10s) > broker (8s).
const CU_REQUEST_TIMEOUT_MS = 25_000;

export function createCuViewer(options: CuViewerOptions) {
  const doc = options.root.ownerDocument;
  const now = options.now ?? (() => Date.now());
  const openSource = options.source ?? ((url: string) => new EventSource(url));
  const localLeases = new Map<string, CuLocalHumanLease>();

  let disposed = false;
  let generation = 0;
  let ticketSequence = 0;
  let latestEpoch = -1;
  let activeHost: CuViewerHost | null = null;
  let activeHostKey: string | null = null;
  let status: CuStatus | null = null;
  let mode: 'view-only' | 'interactive' = 'view-only';
  let notice: ViewerNotice | null = null;
  let actionBusy = false;
  let eventSource: EventSource | null = null;
  let streamRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let streamRetryAttempt = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let containerMounted = false;
  let chipBound = false;
  let iframeUrl: string | null = null;
  let iframeError: string | null = null;

  const keyOf = (host: CuViewerHost) => `${host.hostId || ''}\0${host.base}\0${host.token || ''}`;
  const isOpen = () => !disposed && options.root.classList.contains('cu-viewer-open');
  const hostSupported = (host: CuViewerHost | null | undefined): host is CuViewerHost =>
    !!host && options.supports(host);

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

  function syncSessionChip(): void {
    if (disposed) return;
    const chip = ensureSessionChip();
    if (!chip) return;
    const session = options.currentSession();
    const host = session ? options.host(session.host ?? null) : null;
    const show = hostSupported(host);
    chip.style.display = show ? '' : 'none';
    if (show) {
      const label = hostDisplayLabel(host);
      chip.title = `Open ${label} desktop viewer`;
      chip.setAttribute('aria-label', `Open ${label} desktop`);
    }
  }

  function currentLocalLease(): CuLocalHumanLease | null {
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

  function clearStreamRetry(): void {
    if (streamRetryTimer !== null) {
      clearTimeout(streamRetryTimer);
      streamRetryTimer = null;
    }
  }

  function disconnectStream(): void {
    clearStreamRetry();
    if (eventSource) {
      try { eventSource.close(); } catch {}
      eventSource = null;
    }
  }

  function clearIframe(): void {
    iframeUrl = null;
    const stage = doc.getElementById('cuViewerStage');
    if (!stage) return;
    const existing = stage.querySelector('iframe.cu-viewer-frame');
    if (existing) existing.remove();
  }

  function mountIframe(url: string): void {
    iframeUrl = url;
    iframeError = null;
    const stage = doc.getElementById('cuViewerStage');
    if (!stage) return;
    const placeholder = doc.getElementById('cuViewerPlaceholder');
    if (placeholder) placeholder.hidden = true;
    // Replace the iframe element so switching #ticket=... always performs a
    // clean document reload (hash-only updates on the same URL do not reboot viewer.js).
    const existing = stage.querySelector('iframe.cu-viewer-frame');
    if (existing) existing.remove();
    const frame = doc.createElement('iframe');
    frame.className = 'cu-viewer-frame';
    frame.title = activeHost ? `${hostDisplayLabel(activeHost)} desktop viewer` : 'Computer-use desktop viewer';
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    frame.src = url;
    stage.appendChild(frame);
  }

  function showPlaceholder(text: string): void {
    clearIframe();
    const placeholder = doc.getElementById('cuViewerPlaceholder');
    if (placeholder) {
      placeholder.textContent = text;
      placeholder.hidden = false;
    }
  }

  function renderHeaderAndControls(): void {
    if (!isOpen() || !activeHost) return;
    const dotEl = doc.getElementById('cuViewerHostDot');
    if (dotEl) dotEl.innerHTML = options.dot(activeHost.hostId);
    const labelEl = doc.getElementById('cuViewerHostLabel');
    if (labelEl) labelEl.textContent = hostDisplayLabel(activeHost);

    const localLease = currentLocalLease();
    const presentation = cuSeatPresentation(status, localLease, now());

    const modePill = doc.getElementById('cuViewerModePill');
    if (modePill) {
      modePill.textContent = mode === 'interactive' && presentation.ownControl ? 'Interactive' : 'View only';
      modePill.dataset.mode = mode === 'interactive' && presentation.ownControl ? 'interactive' : 'view-only';
    }

    const badgeEl = doc.getElementById('cuSeatBadge');
    if (badgeEl) {
      badgeEl.textContent = presentation.badge;
      badgeEl.dataset.tone = presentation.tone;
    }
    const detailEl = doc.getElementById('cuSeatDetail');
    if (detailEl) detailEl.textContent = presentation.detail;

    const takeoverBtn = doc.getElementById('cuTakeoverBtn') as HTMLButtonElement | null;
    const handBackBtn = doc.getElementById('cuHandBackBtn') as HTMLButtonElement | null;

    if (takeoverBtn) {
      takeoverBtn.hidden = presentation.ownControl;
      takeoverBtn.disabled = actionBusy;
    }
    if (handBackBtn) {
      handBackBtn.hidden = !presentation.ownControl;
      handBackBtn.disabled = actionBusy;
      handBackBtn.title = status?.preempted
        ? 'Release control and hand back to the paused agent'
        : 'Release control and return to view-only';
    }

    const noticeEl = doc.getElementById('cuViewerNotice');
    if (noticeEl) {
      if (!notice) {
        noticeEl.hidden = true;
        noticeEl.textContent = '';
      } else {
        noticeEl.hidden = false;
        noticeEl.dataset.kind = notice.kind;
        noticeEl.innerHTML = `<span class="cu-viewer-notice-text">${escapeHtml(notice.text)}</span>`;
      }
    }

    if (iframeError && !iframeUrl) {
      showPlaceholder(iframeError);
    }
  }

  function renderCountdownOnly(): void {
    if (!isOpen() || !activeHost) return;
    const presentation = cuSeatPresentation(status, currentLocalLease(), now());
    const detailEl = doc.getElementById('cuSeatDetail');
    if (detailEl) detailEl.textContent = presentation.detail;
  }

  function startCountdown(): void {
    clearCountdown();
    countdownTimer = setInterval(() => {
      if (!isOpen()) { clearCountdown(); return; }
      renderCountdownOnly();
    }, 1000);
  }

  function owns(ownerGen: number, ownerHostKey: string): boolean {
    return !disposed && isOpen() && ownerGen === generation && activeHostKey === ownerHostKey;
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
    try {
      const response = await options.request(endpoint, '/api/cu/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId: lease.leaseId, leaseToken: lease.leaseToken }),
        timeoutMs: CU_REQUEST_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (!owns(ownerGen, ownerHostKey)) return;
      if (response.ok) {
        const updated = decodeCuStatus(data);
        if (updated && updated.epoch >= latestEpoch) {
          latestEpoch = updated.epoch;
          if (updated.lease?.expiresAt) lease.expiresAt = updated.lease.expiresAt;
          if (status) {
            status = { ...status, state: updated.state, epoch: updated.epoch, lease: updated.lease ?? status.lease };
          }
          renderHeaderAndControls();
        }
        return;
      }
      if (response.status === 409 || response.status === 403) {
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
    renderHeaderAndControls();
    if (wasInteractive) void loadViewerTicket(ownerGen, ownerHostKey, endpoint, 'view-only');
    void loadStatus(ownerGen, ownerHostKey, endpoint);
  }

  function applyStatusUpdate(
    next: CuStatus,
    ownerGen: number,
    ownerHostKey: string,
    endpoint: Readonly<HostEndpoint>,
  ): void {
    if (!owns(ownerGen, ownerHostKey)) return;
    // Ignore stale status/SSE snapshots from an older epoch so a delayed poll
    // response cannot discard a newly acquired takeover lease.
    if (next.epoch < latestEpoch) return;
    latestEpoch = next.epoch;
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
    } else if (localLease && next.lease?.expiresAt) {
      localLease.expiresAt = next.lease.expiresAt;
    }
    renderHeaderAndControls();
  }

  async function loadStatus(ownerGen: number, ownerHostKey: string, endpoint: Readonly<HostEndpoint>): Promise<CuStatus | null> {
    try {
      const response = await options.request(endpoint, '/api/cu/status', { timeoutMs: CU_REQUEST_TIMEOUT_MS });
      const data = await readJson(response);
      if (!owns(ownerGen, ownerHostKey)) return null;
      if (!response.ok) {
        notice = { kind: 'error', text: responseError(response, data, `Status failed (${response.status})`) };
        renderHeaderAndControls();
        return null;
      }
      const decoded = decodeCuStatus(data);
      if (decoded) applyStatusUpdate(decoded, ownerGen, ownerHostKey, endpoint);
      return decoded;
    } catch (error) {
      if (!owns(ownerGen, ownerHostKey)) return null;
      notice = { kind: 'error', text: `Could not reach computer-use broker: ${errorMessage(error)}` };
      renderHeaderAndControls();
      return null;
    }
  }

  async function loadViewerTicket(
    ownerGen: number,
    ownerHostKey: string,
    endpoint: Readonly<HostEndpoint>,
    ticketMode: 'view-only' | 'interactive',
  ): Promise<void> {
    const seq = ++ticketSequence;
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

  function scheduleStreamReconnect(ownerGen: number, ownerHostKey: string, endpoint: Readonly<HostEndpoint>): void {
    if (!owns(ownerGen, ownerHostKey) || streamRetryTimer !== null) return;
    const delayMs = options.streamRetryMs ?? Math.min(10_000, 1_000 * 2 ** Math.min(streamRetryAttempt, 4));
    streamRetryAttempt += 1;
    streamRetryTimer = setTimeout(() => {
      streamRetryTimer = null;
      if (owns(ownerGen, ownerHostKey)) void connectStream(ownerGen, ownerHostKey, endpoint);
    }, delayMs);
  }

  async function connectStream(ownerGen: number, ownerHostKey: string, endpoint: Readonly<HostEndpoint>): Promise<void> {
    disconnectStream();
    let streamUrl = `${endpoint.base}/api/cu/stream`;
    if (endpoint.token) {
      try {
        const ticket = await options.ticket(endpoint);
        if (!owns(ownerGen, ownerHostKey)) return;
        streamUrl += `?ticket=${encodeURIComponent(ticket)}`;
      } catch {
        scheduleStreamReconnect(ownerGen, ownerHostKey, endpoint);
        return;
      }
    }
    if (!owns(ownerGen, ownerHostKey)) return;
    let source: EventSource;
    try {
      source = openSource(streamUrl);
    } catch {
      scheduleStreamReconnect(ownerGen, ownerHostKey, endpoint);
      return;
    }
    eventSource = source;
    const handleEvent = (event: MessageEvent) => {
      if (!owns(ownerGen, ownerHostKey) || eventSource !== source) return;
      streamRetryAttempt = 0;
      let parsed: unknown;
      try { parsed = JSON.parse(String(event.data || '')); } catch { return; }
      const decoded = decodeCuStatus(parsed);
      if (decoded) applyStatusUpdate(decoded, ownerGen, ownerHostKey, endpoint);
    };
    for (const type of SSE_EVENTS) {
      source.addEventListener(type, handleEvent as EventListener);
    }
    source.onmessage = handleEvent;
    source.onopen = () => {
      if (owns(ownerGen, ownerHostKey) && eventSource === source) streamRetryAttempt = 0;
    };
    // Close on error and reconnect through connectStream so a fresh stream
    // ticket is minted on every reconnect instead of looping on an expired one.
    source.onerror = () => {
      if (!owns(ownerGen, ownerHostKey) || eventSource !== source) return;
      try { source.close(); } catch {}
      eventSource = null;
      scheduleStreamReconnect(ownerGen, ownerHostKey, endpoint);
    };
  }

  async function performTakeover(): Promise<void> {
    if (!activeHost || !activeHostKey || actionBusy) return;
    const ownerGen = generation;
    const ownerHostKey = activeHostKey;
    const endpoint = Object.freeze({ ...activeHost });
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
      if (!owns(ownerGen, ownerHostKey)) return;
      if (response.status === 409) {
        const busy = decodeCuBusyError(data);
        notice = {
          kind: 'busy',
          text: formatBusyMessage(busy, now()),
        };
        if (busy.holder && (busy.epoch === null || busy.epoch >= latestEpoch)) {
          if (busy.epoch !== null) latestEpoch = busy.epoch;
          status = {
            state: busy.state === 'human' ? 'human' : (status?.state ?? 'human'),
            epoch: busy.epoch ?? (status?.epoch ?? 0),
            lease: busy.holder,
            preempted: status?.preempted ?? null,
            health: status?.health ?? null,
          };
        }
        renderHeaderAndControls();
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
      if (result.epoch < latestEpoch) return;
      latestEpoch = result.epoch;
      // Invalidate any earlier in-flight view-only ticket fetch before mounting
      // interactive control so a late view-only reply cannot replace the iframe.
      ++ticketSequence;
      localLeases.set(ownerHostKey, {
        leaseId: result.leaseId,
        leaseToken: result.leaseToken,
        epoch: result.epoch,
        heartbeatIntervalSec: result.heartbeatIntervalSec,
        expiresAt: result.lease?.expiresAt ?? null,
      });
      status = {
        state: result.state,
        epoch: result.epoch,
        lease: result.lease,
        preempted: result.preempted,
        health: status?.health ?? null,
      };
      mode = 'interactive';
      notice = null;
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
    const endpoint = Object.freeze({ ...activeHost });
    actionBusy = true;
    notice = null;
    renderHeaderAndControls();
    try {
      const response = await options.request(endpoint, '/api/cu/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId: lease.leaseId, leaseToken: lease.leaseToken, handBack: true }),
        timeoutMs: CU_REQUEST_TIMEOUT_MS,
      });
      const data = await readJson(response);
      if (!owns(ownerGen, ownerHostKey)) return;
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
      localLeases.delete(ownerHostKey);
      clearHeartbeat();
      mode = 'view-only';
      if (released && released.epoch >= latestEpoch) {
        latestEpoch = released.epoch;
        status = {
          state: released.state,
          epoch: released.epoch,
          lease: released.lease,
          preempted: null,
          health: status?.health ?? null,
        };
        notice = released.handedBackTo
          ? { kind: 'info', text: `Handed back to ${released.handedBackTo.label || released.handedBackTo.sessionId || 'agent'}.` }
          : null;
      }
      renderHeaderAndControls();
      void loadViewerTicket(ownerGen, ownerHostKey, endpoint, 'view-only');
    } catch (error) {
      if (!owns(ownerGen, ownerHostKey)) return;
      notice = { kind: 'error', text: `Hand back failed: ${errorMessage(error)}` };
      renderHeaderAndControls();
    } finally {
      if (owns(ownerGen, ownerHostKey)) {
        actionBusy = false;
        renderHeaderAndControls();
      }
    }
  }

  async function refresh(): Promise<void> {
    if (!isOpen() || !activeHost || !activeHostKey) return;
    const ownerGen = generation;
    const ownerHostKey = activeHostKey;
    const endpoint = Object.freeze({ ...activeHost });
    notice = null;
    renderHeaderAndControls();
    const latest = await loadStatus(ownerGen, ownerHostKey, endpoint);
    if (!owns(ownerGen, ownerHostKey)) return;
    const localLease = localLeases.get(ownerHostKey) ?? null;
    const own = isOwnHumanLease(latest ?? status, localLease);
    await loadViewerTicket(ownerGen, ownerHostKey, endpoint, own ? 'interactive' : 'view-only');
  }

  function open(target?: CuViewerHost | string | null): void {
    if (disposed) return;
    let host: CuViewerHost | null = null;
    if (target && typeof target === 'object') host = target;
    else if (typeof target === 'string') host = options.host(target);
    else host = options.hosts().find(candidate => hostSupported(candidate)) ?? null;
    if (!hostSupported(host)) return;

    const container = ensureContainer();
    options.closeOtherViews();
    const ownerGen = ++generation;
    ++ticketSequence;
    latestEpoch = -1;
    streamRetryAttempt = 0;
    const hostKey = keyOf(host);
    const endpoint = Object.freeze({ ...host });

    disconnectStream();
    clearHeartbeat();
    clearCountdown();
    clearIframe();

    activeHost = host;
    activeHostKey = hostKey;
    status = null;
    mode = 'view-only';
    notice = null;
    actionBusy = false;
    iframeError = null;

    container.hidden = false;
    options.root.classList.add('cu-viewer-open');
    showPlaceholder('Loading desktop viewer…');
    renderHeaderAndControls();
    startCountdown();

    void connectStream(ownerGen, hostKey, endpoint);
    void (async () => {
      const latest = await loadStatus(ownerGen, hostKey, endpoint);
      if (!owns(ownerGen, hostKey)) return;
      const localLease = localLeases.get(hostKey) ?? null;
      if (localLease && isOwnHumanLease(latest, localLease)) {
        startHeartbeat(ownerGen, hostKey, endpoint, localLease.heartbeatIntervalSec);
        await loadViewerTicket(ownerGen, hostKey, endpoint, 'interactive');
      } else {
        if (localLease) localLeases.delete(hostKey);
        await loadViewerTicket(ownerGen, hostKey, endpoint, 'view-only');
      }
    })();
  }

  function close(): void {
    if (disposed || !isOpen()) return;
    ++generation;
    ++ticketSequence;
    latestEpoch = -1;
    disconnectStream();
    clearHeartbeat();
    clearCountdown();
    clearIframe();
    actionBusy = false;
    notice = null;
    options.root.classList.remove('cu-viewer-open');
    const el = doc.getElementById('cuViewerView');
    if (el) el.hidden = true;
  }

  function dispose(): void {
    close();
    disposed = true;
    localLeases.clear();
  }

  return {
    open,
    close,
    refresh,
    isOpen,
    syncSessionChip,
    takeover: () => performTakeover(),
    release: () => performRelease(),
    get activeHost() { return activeHost; },
    get status() { return status; },
    get mode() { return mode; },
    dispose,
  };
}
