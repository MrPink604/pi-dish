import type { ApiRequest } from './api-client';
import type { HostDirectory } from './host-directory';
import type { createHostConnections } from './host-connections';
import type { createHostDiscovery } from './host-discovery';
import { decodeHostDescriptor } from './host-discovery';
import { normalizeHostBase } from './host-catalog';

export const hostSettingsHtml = `<div class="preference-row"><label><strong>Hosts</strong><small>Added hosts are stored on this device (with their token). Entries this server publishes — and this host itself — are read-only.</small></label>
      <div class="hosts-list" id="hostsList"></div>
      <div class="host-add">
        <input id="addHostBase" class="cwd-input" type="text" placeholder="http://tycho:3333" spellcheck="false" autocomplete="off">
        <input id="addHostLabel" class="cwd-input" type="text" placeholder="Label (optional)" autocomplete="off">
        <input id="addHostToken" class="cwd-input" type="password" placeholder="Token (optional)" autocomplete="off">
        <button class="btn-small" id="addHostBtn">Add host</button>
      </div>
      <small class="host-add-status" id="addHostStatus"></small>
    </div>`;

type HostId = string | null;
export interface HostSettingsOptions {
  directory: HostDirectory;
  connections: ReturnType<typeof createHostConnections>;
  discovery: Pick<ReturnType<typeof createHostDiscovery>, 'rememberDescriptor'>;
  request: ApiRequest;
  protocol: () => string;
  promptToken: (label: string) => string | null;
  displayLabel: (host: { base: string; label?: unknown; name?: unknown }) => string;
  escapeHtml: (value: unknown) => string;
  color: (hostId: HostId) => string;
  customColor: (hostId: HostId) => boolean;
  resolveColor: (color: string) => string | null;
  setColor: (hostId: HostId, color: string | null, options?: { rows: boolean }) => void;
  onCatalogSaved: () => void;
  refreshSessions: () => void;
  renderNewSessionHosts: () => void;
}
interface HostSettingsView {
  root: HTMLElement;
  list: HTMLElement;
  base: HTMLInputElement;
  label: HTMLInputElement;
  token: HTMLInputElement;
  status: HTMLElement;
  events: AbortController;
  rowEvents: AbortController;
}
const STATE_TITLES = {
  reachable: 'Reachable', connecting: 'Not contacted yet',
  backoff: 'Unreachable — retrying', blocked: 'Needs a token',
};

/** Settings owns its DOM and each validation attempt, including response bodies. */
export function createHostSettings(options: HostSettingsOptions) {
  let view: HostSettingsView | null = null;
  let sequence = 0;
  let checking = false;
  const { directory, connections, escapeHtml, displayLabel } = options;
  function status(owner: HostSettingsView, message: string, error = false): void {
    if (view !== owner) return;
    owner.status.textContent = message;
    owner.status.classList.toggle('error', error);
  }
  function unmount(): void {
    sequence++;
    checking = false;
    view?.events.abort();
    view?.rowEvents.abort();
    view = null;
  }
  function mount(root: HTMLElement): void {
    unmount();
    const list = root.querySelector<HTMLElement>('#hostsList');
    const base = root.querySelector<HTMLInputElement>('#addHostBase');
    const label = root.querySelector<HTMLInputElement>('#addHostLabel');
    const token = root.querySelector<HTMLInputElement>('#addHostToken');
    const statusElement = root.querySelector<HTMLElement>('#addHostStatus');
    const button = root.querySelector<HTMLButtonElement>('#addHostBtn');
    if (!list || !base || !label || !token || !statusElement || !button) return;
    const events = new AbortController();
    view = { root, list, base, label, token, status: statusElement, events, rowEvents: new AbortController() };
    const owner = view;
    const listener = { signal: events.signal };
    button.addEventListener('click', () => { void addFromForm(); }, listener);
    base.addEventListener('keydown', event => { if (event.key === 'Enter') void addFromForm(); }, listener);
    for (const input of [base, label, token]) input.addEventListener('input', () => {
      sequence++;
      if (checking) { checking = false; status(owner, ''); }
    }, listener);
    render();
  }
  function save(): void {
    directory.saveCatalog();
    options.onCatalogSaved();
  }
  function promptToken(key: string): void {
    const owner = view;
    if (!owner) return;
    const entry = directory.catalog.find(item => (item.hostId || item.base) === key);
    if (!entry) {
      status(owner, 'That host comes from this server’s config — set its token there.');
      return;
    }
    const token = options.promptToken(displayLabel(entry));
    if (token === null || view !== owner) return;
    directory.setToken(key, token.trim() || undefined);
    connections.reset(key);
    save();
    options.refreshSessions();
  }
  async function addFromForm(): Promise<void> {
    const owner = view;
    if (!owner) return;
    const requestSequence = ++sequence;
    checking = false;
    const raw = owner.base.value.trim();
    if (!raw) { status(owner, 'Enter the host URL.', true); return; }
    const base = normalizeHostBase(raw);
    if (!base) { status(owner, 'That is not a usable host URL.', true); return; }
    if (options.protocol() === 'https:' && base.startsWith('http://')) {
      status(owner, 'This page is https, so the browser will block plain-http hosts. Serve that host over https (tailscale serve) or open pi-dish over http.', true);
      return;
    }
    const token = owner.token.value.trim();
    const label = owner.label.value.trim();
    const owns = () => view === owner && owner.root.isConnected && sequence === requestSequence;
    status(owner, 'Checking…');
    checking = true;
    let descriptor;
    try {
      const response = await options.request(Object.freeze({ base, token: token || null }), '/api/host');
      if (!owns()) return;
      if (response.status === 401) throw new Error('that host needs a token');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (!owns()) return;
      descriptor = decodeHostDescriptor(data);
      if (!descriptor) throw new Error('no host descriptor');
    } catch (error) {
      if (owns()) status(owner, `Could not reach that host: ${error instanceof Error ? error.message : String(error)}. A host on another origin must allowlist this one (allowedOrigins in its settings).`, true);
      return;
    } finally {
      if (owns()) checking = false;
    }
    if (descriptor.hostId === directory.self.hostId) { status(owner, 'That is this host.', true); return; }
    options.discovery.rememberDescriptor(descriptor);
    directory.add({ base, hostId: descriptor.hostId, label: label || descriptor.label || null, token: token || null });
    connections.reset(descriptor.hostId);
    save();
    owner.base.value = '';
    owner.label.value = '';
    owner.token.value = '';
    status(owner, `Added ${displayLabel({ label, base })}.`);
    options.refreshSessions();
    options.renderNewSessionHosts();
  }

  function render(): void {
    const owner = view;
    if (!owner) return;
    const { list } = owner;
    owner.rowEvents.abort();
    owner.rowEvents = new AbortController();
    const listener = { signal: owner.rowEvents.signal };
    const hosts = directory.effectiveHosts();
    list.innerHTML = hosts.map(host => {
      const state = connections.stateOf(host);
      const version = host.version ? `v${host.version}` : '';
      const detail = [host.self ? 'this server' : host.base, version].filter(Boolean).join(' · ');
      const actions = [];
      if (state === 'blocked') actions.push(`<button class="btn-small host-token-btn" data-key="${escapeHtml(host.key)}">token?</button>`);
      if (host.source === 'user') actions.push(`<button class="btn-icon host-remove-btn" data-key="${escapeHtml(host.key)}" title="Remove host">✕</button>`);
      // Color picker: `<input type="color">` only speaks concrete hex, so an
      // auto (var(--chart-N)) color is resolved through a probe element first.
      const hostId = host.hostId || null;
      const custom = options.customColor(hostId);
      const hex = options.resolveColor(options.color(hostId)) || '#888888';
      const colorControls = hosts.length > 1 ? `
        <input type="color" class="host-color-input" data-host="${escapeHtml(hostId || '')}"
          value="${escapeHtml(hex)}" style="background:${escapeHtml(hex)}"
          title="${custom ? 'Custom color for this host' : 'Automatic color — pick one to override it'}">
        <button class="btn-icon host-color-reset${custom ? '' : ' hidden'}" data-host="${escapeHtml(hostId || '')}" title="Back to the automatic color">↺</button>` : '';
      return `<div class="host-row">
        <span class="host-dot ${escapeHtml(state)}" title="${escapeHtml(STATE_TITLES[state] || state)}"></span>
        <span class="host-row-name">${escapeHtml(displayLabel(host))}</span>
        <span class="host-row-detail" title="${escapeHtml(host.base || '')}">${escapeHtml(detail)}</span>
        <span class="host-row-actions">${colorControls}${actions.join('')}</span>
      </div>`;
    }).join('');
    for (const input of Array.from(list.querySelectorAll<HTMLInputElement>('.host-color-input'))) {
      // `input` fires continuously while the native picker is open — repaint the
      // sidebar live, but don't rebuild this row out from under the open dialog.
      input.addEventListener('input', () => {
        if (view !== owner || !list.contains(input)) return;
        input.style.background = input.value;
        options.setColor(input.dataset.host || null, input.value, { rows: false });
      }, listener);
      input.addEventListener('change', () => { if (view === owner && list.contains(input)) options.setColor(input.dataset.host || null, input.value); }, listener);
    }
    for (const btn of Array.from(list.querySelectorAll<HTMLButtonElement>('.host-color-reset'))) {
      btn.addEventListener('click', () => { if (view === owner && list.contains(btn)) options.setColor(btn.dataset.host || null, null); }, listener);
    }
    for (const btn of Array.from(list.querySelectorAll<HTMLButtonElement>('.host-remove-btn'))) {
      btn.addEventListener('click', () => {
        if (view !== owner || !list.contains(btn)) return;
        directory.remove(btn.dataset.key || '');
        save();
      }, listener);
    }
    for (const btn of Array.from(list.querySelectorAll<HTMLButtonElement>('.host-token-btn'))) {
      btn.addEventListener('click', () => { if (view === owner && list.contains(btn)) promptToken(btn.dataset.key || ''); }, listener);
    }
  }

  return { mount, unmount, render, save, addFromForm };
}
