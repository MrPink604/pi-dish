import { errorMessage, jsonResponse, sendJson, type ApiRequest, type HostEndpoint } from './api-client';
import { requiredElement } from './dom';
import { record } from '../core/helper-values';

/** EventSource/WebSocket cannot set the `X-Pi-Dish-Private-Unlock` header; matches src/core/private-access.ts. */
const PRIVATE_UNLOCK_QUERY = 'privateUnlock';
const PIN_PATTERN = /^\d{4,12}$/;

interface PrivateHost extends HostEndpoint { readonly key: string; readonly hostId: string | null }

export interface PrivateSessions {
  /** This host's unlock token; memory only, so a reload locks every host again. */
  token(base: string): string | null;
  /** `url` plus the unlock query parameter, for EventSource/WebSocket URLs that cannot carry headers. */
  withUnlock(url: string, base: string): string;
  /** Unlocked: revoke and reload. Locked: prompt for the PIN. */
  toggle(): void;
  close(): void;
  isOpen(): boolean;
  renderSettings(container: HTMLElement, signal: AbortSignal): void;
}

/**
 * Private sessions are hidden by every host until a PIN unlocks them. The
 * PIN is tried on each host that advertises `privateUnlock`; each host keeps
 * its own PIN hash and mints its own token.
 */
export function createPrivateSessions(options: {
  document: Document; request: ApiRequest;
  hosts: () => readonly Readonly<PrivateHost>[]; label: (host: Readonly<PrivateHost>) => string;
  /** Reload the session lists once rows may have appeared. */
  refresh: () => unknown; reload: () => void;
}): PrivateSessions {
  const element = requiredElement(options.document, 'private sessions');
  const tokens = new Map<string, string>();
  const modal = element('privateUnlockModal'), form = element('privateUnlockForm');
  const input = element('privateUnlockPin') as HTMLInputElement, status = element('privateUnlockStatus');
  const button = element('btnPrivateSessions');
  let busy = false;

  function isOpen() { return modal.style.display !== 'none'; }
  function close() { modal.style.display = 'none'; input.value = ''; status.textContent = ''; }
  function renderButton() {
    const unlocked = tokens.size > 0;
    button.classList.toggle('unlocked', unlocked);
    button.title = unlocked ? 'Private sessions shown: click to hide them' : 'Show private sessions (PIN)';
    button.setAttribute('aria-pressed', String(unlocked));
  }
  function failuresOf(hosts: readonly Readonly<PrivateHost>[], results: readonly PromiseSettledResult<unknown>[]): string[] {
    return results.flatMap((result, index) => result.status !== 'rejected' ? []
      : [hosts.length > 1 ? `${options.label(hosts[index])}: ${errorMessage(result.reason)}` : errorMessage(result.reason)]);
  }

  async function unlock(pin: string): Promise<void> {
    const hosts = options.hosts();
    const results = await Promise.allSettled(hosts.map(async host => {
      const data = await sendJson(options.request, host, '/api/private-sessions/unlock', { pin });
      if (!record(data) || typeof data.token !== 'string' || !data.token) throw new Error('Invalid unlock response');
      tokens.set(host.base, data.token);
    }));
    renderButton();
    if (tokens.size) { close(); void options.refresh(); return; }
    status.textContent = failuresOf(hosts, results).join(' · ') || 'No host accepts a private-session PIN.';
  }

  // Locking reloads: retained private views, streams and drafts must not outlive the gate.
  async function lock(): Promise<void> {
    // The transport still attaches each host's own token to its lock request.
    const unlocked = options.hosts().filter(host => tokens.has(host.base));
    await Promise.allSettled(unlocked.map(host => options.request(host, '/api/private-sessions/lock', { method: 'POST' })));
    tokens.clear();
    options.reload();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    const pin = input.value.trim();
    if (!PIN_PATTERN.test(pin)) { status.textContent = 'The PIN is 4–12 digits.'; return; }
    busy = true; status.textContent = 'Unlocking…';
    void unlock(pin).finally(() => { busy = false; });
  });
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.querySelector('[data-private-close]')?.addEventListener('click', close);
  renderButton();

  function renderSettings(container: HTMLElement, signal: AbortSignal): void {
    const hosts = options.hosts();
    if (!hosts.length) { container.innerHTML = ''; return; }
    container.innerHTML = `<div class="preference-row private-pin-row"><label><strong>Private sessions PIN</strong><small>Enforced by each host: private sessions stay out of lists, search and the API until the PIN is entered from the sidebar. Saving applies to ${hosts.length > 1 ? 'every host' : 'this host'}; changing a PIN needs the current one.</small></label>
      <div class="private-pin-fields"><input type="password" id="privatePinCurrent" inputmode="numeric" autocomplete="off" placeholder="Current PIN" aria-label="Current PIN" style="display:none">
      <input type="password" id="privatePinNew" inputmode="numeric" autocomplete="new-password" placeholder="New PIN (4–12 digits)" aria-label="New PIN">
      <button class="btn-small" id="privatePinSave">Save PIN</button></div><small id="privatePinStatus"></small></div>`;
    const current = container.querySelector<HTMLInputElement>('#privatePinCurrent')!, next = container.querySelector<HTMLInputElement>('#privatePinNew')!;
    const save = container.querySelector<HTMLButtonElement>('#privatePinSave')!, pinStatus = container.querySelector<HTMLElement>('#privatePinStatus')!;
    void Promise.allSettled(hosts.map(async host => {
      const data = await jsonResponse(await options.request(host, '/api/private-sessions'));
      return record(data) && data.pinSet === true;
    })).then(results => {
      if (signal.aborted) return;
      const set = results.filter(result => result.status === 'fulfilled' && result.value).length;
      current.style.display = set ? '' : 'none';
      pinStatus.textContent = set === 0 ? 'No PIN set yet.' : set === hosts.length ? 'PIN set.' : `PIN set on ${set} of ${hosts.length} hosts.`;
    });
    save.addEventListener('click', async () => {
      const pin = next.value.trim();
      if (!PIN_PATTERN.test(pin)) { pinStatus.textContent = 'The PIN is 4–12 digits.'; return; }
      save.disabled = true; pinStatus.textContent = 'Saving…';
      const currentPin = current.value.trim() || undefined;
      const results = await Promise.allSettled(hosts.map(host =>
        sendJson(options.request, host, '/api/private-sessions/pin', { pin, currentPin }, 'PUT')));
      if (signal.aborted) return;
      save.disabled = false;
      const failures = failuresOf(hosts, results);
      if (failures.length < hosts.length) {
        current.value = ''; next.value = ''; current.style.display = '';
        // Saving a PIN revokes every unlock token on that host.
        if (tokens.size) { tokens.clear(); renderButton(); void options.refresh(); }
      }
      pinStatus.textContent = failures.length ? failures.join(' · ') : 'PIN saved. Enter it from the sidebar to show private sessions.';
    }, { signal });
  }

  return {
    token: base => tokens.get(base) ?? null,
    withUnlock(url, base) {
      const token = tokens.get(base);
      return token ? `${url}${url.includes('?') ? '&' : '?'}${PRIVATE_UNLOCK_QUERY}=${encodeURIComponent(token)}` : url;
    },
    toggle() { if (tokens.size) void lock(); else { input.value = ''; status.textContent = ''; modal.style.display = 'flex'; input.focus(); } },
    close, isOpen, renderSettings,
  };
}
