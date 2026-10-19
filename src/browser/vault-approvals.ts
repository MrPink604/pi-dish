import { ApiHttpError, sendJson } from './api-client';
import type { ApiRequest } from './api-client';
import { decodeVaultOverview, vaultCardsHtml, vaultPanelHtml, vaultRequestSession } from './vault-approvals-data';
import type { VaultOverviewView, VaultRequestView, VaultSessionCandidate } from './vault-approvals-data';

const POLL_MS = 3000;
/** A host without the feature (404) or without a listener; check back rarely. */
const ABSENT_POLL_MS = 30000;

export interface VaultApprovalsController {
  mount(): void;
  /** Re-render after the selected session or the session lists change. */
  render(): void;
  /** Toggle the global vault panel (sidebar header button). */
  togglePanel(): void;
  /** A vault notification was opened: show its session, or the panel when it has none. */
  open(requestId?: string | null): void;
}

/**
 * Vault approvals live on the front-door host (the page's own origin), where
 * the listener runs. A request is answered in the view of the session that
 * made it, like an ask dialog: its card docks above that session's composer,
 * and any other view gets a toast that opens the session. The sidebar header's
 * vault button opens a panel with every pending request, the listener status
 * and the open 15-minute windows; it is hidden while the host has no listener.
 */
export function createVaultApprovals(options: {
  document: Document; window: Window; request: ApiRequest;
  sessions: () => readonly VaultSessionCandidate[];
  current: () => { readonly id: string; readonly host?: string | null } | null;
  reveal: (id: string, host: string | null) => void;
  toast: (message: string, open: () => void) => void;
}): VaultApprovalsController {
  const { document, window } = options;
  let panel: HTMLElement | null = null;
  let view: VaultOverviewView | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  let panelOpen = false;
  let notice = '';
  let seen = new Set<string>();
  let pendingOpen: string | null = null;
  const busy = new Set<string>();

  const sessionOf = (request: VaultRequestView) => vaultRequestSession(request, options.sessions());

  function isCurrent(request: VaultRequestView): boolean {
    const session = sessionOf(request), current = options.current();
    return !!session && !!current && session.id === current.id && (session.host || null) === (current.host || null);
  }

  function reveal(request: VaultRequestView): boolean {
    const session = sessionOf(request);
    if (!session) return false;
    options.reveal(session.id, session.host || null);
    return true;
  }

  function showPanel(open: boolean): void {
    panelOpen = open;
    notice = '';
    render();
  }

  /** New pending requests outside the selected session raise one toast each. */
  function announce(): void {
    if (!view) return;
    const next = new Set(view.pending.map(request => request.id));
    for (const request of view.pending) {
      if (seen.has(request.id) || isCurrent(request)) continue;
      const who = request.sessionName || request.sessionRef || request.device;
      options.toast(`${who} is waiting for vault approval (${request.item})`, () => { if (!reveal(request)) showPanel(true); });
    }
    seen = next;
  }

  function renderDock(): void {
    const mine = view?.pending.filter(isCurrent) ?? [];
    let dock = document.getElementById('vaultSessionDock');
    if (!mine.length) { dock?.remove(); return; }
    if (!dock) {
      const inputArea = document.querySelector('.input-area');
      if (!inputArea) return;
      dock = document.createElement('div');
      dock.id = 'vaultSessionDock';
      dock.className = 'vault-dock';
      dock.addEventListener('click', onClick);
      inputArea.insertBefore(dock, document.getElementById('attachmentStrip'));
    }
    dock.innerHTML = vaultCardsHtml(mine, { now: Date.now(), busy, inSession: true });
  }

  function render(): void {
    const button = document.getElementById('btnVault');
    const badge = document.getElementById('vaultBadge');
    const present = !!view && (!!view.listener || view.pending.length > 0 || view.grants.length > 0);
    if (button) {
      button.style.display = present ? '' : 'none';
      button.classList.toggle('vault-waiting', !!view?.pending.length);
    }
    if (badge) {
      const count = view?.pending.length || view?.grants.length || 0;
      badge.textContent = count ? String(count) : '';
      badge.style.display = count ? '' : 'none';
    }
    renderDock();
    if (!panel) return;
    panel.hidden = !panelOpen || !view;
    panel.innerHTML = panelOpen && view ? vaultPanelHtml(view, { now: Date.now(), busy, notice }) : '';
  }

  function schedule(delay: number): void {
    clearTimeout(timer);
    if (document.visibilityState === 'visible') timer = setTimeout(() => { void poll(); }, delay);
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    let delay = POLL_MS;
    try {
      const response = await options.request(null, '/api/vault', { timeoutMs: 10000 });
      if (response.status === 404) { view = null; delay = ABSENT_POLL_MS; }
      else if (response.ok) {
        view = decodeVaultOverview(await response.json());
        // No listener has ever reported here: nothing can arrive soon.
        if (!view.listener && !view.pending.length) delay = ABSENT_POLL_MS;
      }
    } catch {
      // Transient: keep the last view; the next poll retries.
    } finally {
      polling = false;
    }
    if (pendingOpen !== null && view) {
      const wanted = pendingOpen;
      pendingOpen = null;
      const request = view.pending.find(entry => entry.id === wanted);
      if (!request || !reveal(request)) panelOpen = true;
    }
    announce();
    render();
    schedule(delay);
  }

  async function act(path: string, body: unknown, method: string, id: string): Promise<void> {
    busy.add(id);
    notice = '';
    render();
    try {
      await sendJson(options.request, null, path, body, method);
    } catch (error) {
      notice = error instanceof ApiHttpError && error.status === 409 ? 'That request was already decided or expired.'
        : `Vault action failed: ${error instanceof Error ? error.message : String(error)}`;
      if (!panelOpen) options.toast(notice, () => showPanel(true));
    } finally {
      busy.delete(id);
    }
    await poll();
  }

  function onClick(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!target || target.disabled) return;
    const decision = target.dataset.vaultDecision;
    const card = target.closest<HTMLElement>('[data-vault-request]');
    if (decision && card?.dataset.vaultRequest) {
      const id = card.dataset.vaultRequest;
      void act(`/api/vault/requests/${encodeURIComponent(id)}/decision`, { decision }, 'POST', id);
    } else if (target.dataset.vaultRevoke) {
      const id = target.dataset.vaultRevoke;
      void act(`/api/vault/grants/${encodeURIComponent(id)}`, {}, 'DELETE', id);
    } else if (target.dataset.vaultOpen) {
      const request = view?.pending.find(entry => entry.id === target.dataset.vaultOpen);
      if (request && reveal(request)) showPanel(false);
      else notice = 'That session is not in the loaded session lists.';
      render();
    } else if (target.dataset.vaultAction === 'close') {
      showPanel(false);
    }
  }

  return {
    mount(): void {
      panel = document.createElement('aside');
      panel.className = 'vault-panel';
      panel.setAttribute('aria-live', 'polite');
      panel.hidden = true;
      panel.addEventListener('click', onClick);
      document.body.appendChild(panel);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void poll(); else clearTimeout(timer); });
      window.addEventListener('focus', () => { void poll(); });
      void poll();
    },
    render,
    togglePanel(): void {
      showPanel(!panelOpen);
      if (panelOpen) void poll();
    },
    open(requestId?: string | null): void {
      pendingOpen = requestId || '';
      void poll();
    },
  };
}
