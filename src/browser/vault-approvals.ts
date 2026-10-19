import { ApiHttpError, sendJson } from './api-client';
import type { ApiRequest } from './api-client';
import { decodeVaultOverview, vaultSurfaceHtml } from './vault-approvals-data';
import type { VaultOverviewView } from './vault-approvals-data';

const POLL_MS = 3000;
/** A host without the feature (404) or without a listener; check back rarely. */
const ABSENT_POLL_MS = 30000;

/**
 * Vault approvals live on the front-door host (the page's own origin), where
 * the listener runs. The surface floats above every view so a request is
 * answerable whatever session is selected; it disappears when the host has
 * no listener, nothing is pending and no window is open.
 */
export interface VaultApprovalsController {
  mount(): void;
  /** A vault notification was opened: show the surface with fresh state. */
  open(): void;
}

export function createVaultApprovals(options: { document: Document; window: Window; request: ApiRequest }): VaultApprovalsController {
  const { document, window } = options;
  let root: HTMLElement | null = null;
  let view: VaultOverviewView | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  let expanded = false;
  let notice = '';
  const busy = new Set<string>();

  function render(): void {
    if (!root) return;
    const visible = !!view && (view.pending.length > 0 || view.grants.length > 0 || expanded);
    root.hidden = !visible;
    if (!visible || !view) { root.innerHTML = ''; return; }
    root.classList.toggle('expanded', expanded || view.pending.length > 0);
    root.innerHTML = vaultSurfaceHtml(view, { now: Date.now(), busy, expanded: expanded || view.pending.length > 0, notice });
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
    } else if (target.dataset.vaultAction) {
      expanded = target.dataset.vaultAction === 'expand';
      notice = '';
      render();
    }
  }

  return {
    mount(): void {
      root = document.createElement('aside');
      root.className = 'vault-approvals';
      root.setAttribute('aria-live', 'polite');
      root.hidden = true;
      root.addEventListener('click', onClick);
      document.body.appendChild(root);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void poll(); else clearTimeout(timer); });
      window.addEventListener('focus', () => { void poll(); });
      void poll();
    },
    open(): void {
      expanded = true;
      notice = '';
      void poll();
    },
  };
}
