import type { ApiRequest, HostEndpoint } from './api-client';
import { sendJson } from './api-client';
import { escapeHtml } from './helper-format';
import { hostDisplayLabel } from './helper-identity';
import { record } from './helper-values';

export interface RecoveryHost extends HostEndpoint {
  readonly hostId: string | null;
  readonly name?: string | null;
  readonly label?: string | null;
  readonly capabilities?: Readonly<Record<string, boolean | undefined>>;
}
export type RecoveryMode = 'off' | 'restore' | 'continue';
export interface RecoveryRecord {
  readonly id: string; readonly name: string; readonly harnessId: string;
  readonly cwd: string; readonly reason: string; readonly status: string;
  readonly updatedAt: string | number | null; readonly excluded: boolean;
}
export interface RecoveryReport {
  readonly mode: string; readonly sessions: readonly RecoveryRecord[];
  readonly totalRecords: number; readonly truncated: boolean;
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
const message = (value: unknown) => value instanceof Error ? value.message : String(value);
export function decodeRecoveryMode(value: unknown): RecoveryMode {
  return value === 'restore' || value === 'continue' ? value : 'off';
}
export function decodeRecoveryReport(value: unknown): RecoveryReport {
  if (!record(value)) throw new Error('Invalid recovery report');
  const rows: unknown[] = Array.isArray(value.sessions) ? value.sessions : [];
  const sessions = rows.flatMap(row => record(row) && typeof row.id === 'string' && row.id
    ? [{ id: row.id, name: text(row.name), harnessId: text(row.harnessId), cwd: text(row.cwd),
      reason: text(row.reason), status: text(row.status), excluded: row.excluded === true,
      updatedAt: typeof row.updatedAt === 'string' || typeof row.updatedAt === 'number' ? row.updatedAt : null }] : []);
  return { mode: text(value.mode) || 'off', sessions, truncated: value.truncated === true,
    totalRecords: typeof value.totalRecords === 'number' && Number.isFinite(value.totalRecords) ? value.totalRecords : sessions.length };
}
export interface RecoveryOptions {
  root: HTMLElement; request: ApiRequest; hosts: () => readonly RecoveryHost[];
  supports: (host: RecoveryHost) => boolean; down: (host: RecoveryHost) => boolean;
  fleetReady: () => Promise<unknown>; refreshFleet: () => Promise<unknown>;
  selectedHost: () => string | null; settingsOpen: () => boolean;
  closeOtherViews: () => void; confirm: (message: string) => boolean;
}
export function createRecovery(options: RecoveryOptions) {
  const doc = options.root.ownerDocument;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => {
    const value = doc.getElementById(id); if (!value) throw new Error('Missing recovery element: ' + id); return value as T;
  };
  const apiFetch = options.request;
  const apiSend = (host: RecoveryHost, path: string, payload: unknown, method: string) => sendJson(apiFetch, host, path, payload, method);
  const effectiveHosts = options.hosts;
  const hostIsDown = options.down;
  const confirm = options.confirm;
  let disposed = false;
  let preferencesSeq = 0;
  let preferenceEvents: AbortController | null = null;
  let reportEvents: AbortController | null = null;
  let preferenceEndpoint: RecoveryHost | undefined;
  let reportEndpoint: RecoveryHost | undefined;
  const snapshot = (host: RecoveryHost): RecoveryHost => Object.freeze({ ...host });
  const sameHost = (left: RecoveryHost | undefined, right: RecoveryHost | undefined) =>
    !!left && !!right && left.hostId === right.hostId && left.base === right.base && (left.token || '') === (right.token || '');
  function unmountPreferences(): void {
    ++preferencesSeq; preferenceEvents?.abort(); preferenceEvents = null; preferenceEndpoint = undefined;
  }
  // Recovery is host-global; retain host entries, not ids that could fall back
  // to self if a remote disappears while a request is in flight.
  let recoveryHostId: string | null = null;
  let recoveryViewSeq = 0;

  function recoveryCapableHosts() {
    return effectiveHosts().filter(host => options.supports(host));
  }

  function selectRecoveryHost(hosts: readonly RecoveryHost[], preferredId?: string | null) {
    return hosts.find(host => host.hostId === preferredId) ||
      hosts.find(host => host.hostId === recoveryHostId) || hosts[0];
  }

  function recoveryHostOptions(hosts: readonly RecoveryHost[]) {
    return hosts.map(host => `<option value="${escapeHtml(host.hostId || '')}">${escapeHtml(hostDisplayLabel(host))}</option>`).join('');
  }

  // Refresh only the options, not the form: a fleet poll must not discard an
  // unsaved mode selection. Losing the selected host invalidates its requests.
  function refreshRecoveryHosts() {
    if (disposed) return;
    const hosts = recoveryCapableHosts();
    const optionHtml = recoveryHostOptions(hosts);
    for (const id of ['recoverySettingsHost', 'recoveryReportHost']) {
      const select = doc.getElementById(id) as HTMLSelectElement | null;
      if (!select || (id === 'recoveryReportHost' && !isRecoveryViewOpen())) continue;
      const previous = select.value;
      if (select.innerHTML !== optionHtml) {
        select.innerHTML = optionHtml;
        select.value = selectRecoveryHost(hosts, previous)?.hostId || '';
      }
      select.disabled = !hosts.length;
      const liveHost = hosts.find(host => (host.hostId || '') === select.value);
      const endpoint = id === 'recoverySettingsHost' ? preferenceEndpoint : reportEndpoint;
      if (select.value !== previous || (endpoint && !sameHost(endpoint, liveHost))) select.dispatchEvent(new Event('change'));
    }
    const unavailable = doc.getElementById('recoveryUnavailableHosts');
    if (unavailable) {
      const missing = effectiveHosts().filter(host => !options.supports(host));
      unavailable.textContent = missing.map(host => {
        const reason = hostIsDown(host) ? 'unreachable or needs a token' :
          host.capabilities ? 'update and restart pi-dish to enable recovery' : 'capabilities not yet available';
        return hostDisplayLabel(host) + ': ' + reason + '.';
      }).join(' ');
      unavailable.hidden = !missing.length;
    }
  }

  async function renderRecoveryPreferences() {
    unmountPreferences();
    const mountSeq = preferencesSeq;
    const section = doc.getElementById('recoveryPreferences');
    if (!section || disposed) return;
    await options.fleetReady();
    if (disposed || mountSeq !== preferencesSeq || !section.isConnected || !options.settingsOpen()) return;
    const events = preferenceEvents = new AbortController();
    const listener = { signal: events.signal };
    section.hidden = false;
    section.innerHTML = `<label for="recoveryMode"><strong>Session recovery</strong><small>Saved on the selected host for all devices. Runs whenever its server is launched; no boot-service setup is required. Restore opens sessions idle. Continue may incur model cost and perform external actions; tool execution is not exactly-once.</small></label>
      <div class="recovery-controls">
        <label for="recoverySettingsHost">Host</label><select id="recoverySettingsHost"></select>
        <select id="recoveryMode" disabled aria-label="Recovery mode"><option value="off">Off</option><option value="restore">Restore open sessions</option><option value="continue">Restore and continue interrupted work</option></select>
        <div class="recovery-actions"><button class="btn-small" id="saveRecoveryMode" disabled>Save</button><button class="btn-small" id="openRecoveryReport">Recovery report</button></div>
        <small id="recoverySettingsStatus" role="status"></small>
        <small id="recoveryUnavailableHosts" role="status" hidden></small>
      </div>`;
    const hostSelect = section.querySelector<HTMLSelectElement>('#recoverySettingsHost')!;
    const mode = section.querySelector<HTMLSelectElement>('#recoveryMode')!;
    const save = section.querySelector<HTMLButtonElement>('#saveRecoveryMode')!;
    const status = section.querySelector<HTMLElement>('#recoverySettingsStatus')!;
    const report = section.querySelector<HTMLButtonElement>('#openRecoveryReport')!;
    hostSelect.innerHTML = recoveryHostOptions(recoveryCapableHosts());
    hostSelect.value = selectRecoveryHost(recoveryCapableHosts(), options.selectedHost())?.hostId || '';
    let seq = 0;
    const selectedHost = () => recoveryCapableHosts().find(host => (host.hostId || '') === hostSelect.value);
    const ownsView = () => !disposed && mountSeq === preferencesSeq && section.isConnected && options.settingsOpen();
    const owns = (request: number, host: RecoveryHost) => ownsView() && seq === request && sameHost(host, selectedHost());
    const load = async () => {
      if (!ownsView()) return;
      const request = ++seq, selected = selectedHost();
      const host = preferenceEndpoint = selected ? snapshot(selected) : undefined;
      mode.disabled = save.disabled = report.disabled = true;
      if (!host) {
        status.textContent = 'No connected host currently advertises recovery support.';
        return;
      }
      recoveryHostId = host.hostId;
      report.disabled = false;
      status.textContent = 'Loading host setting…';
      try {
        const res = await apiFetch(host, '/api/settings', { timeoutMs: 20000 });
        const data: unknown = await res.json();
        if (!res.ok) throw new Error(record(data) && text(data.error) || `HTTP ${res.status}`);
        if (!owns(request, host)) return;
        mode.value = decodeRecoveryMode(record(data) ? data.recoveryMode : null);
        mode.disabled = save.disabled = false;
        status.textContent = '';
      } catch (error) {
        if (owns(request, host)) status.textContent = 'Could not load: ' + message(error);
      }
    };
    hostSelect.addEventListener('change', () => { void load(); }, listener);
    report.addEventListener('click', () => {
      const host = selectedHost();
      if (host && ownsView()) openRecoveryView(host.hostId);
    }, listener);
    save.addEventListener('click', async () => {
      const selected = selectedHost(), value = decodeRecoveryMode(mode.value);
      if (!selected || !ownsView() || save.disabled || !sameHost(preferenceEndpoint, selected)) return;
      const host = snapshot(selected);
      if (value === 'continue' && !confirm('On future server launches, continue interrupted work automatically? This may incur cost and repeat external actions. Tool execution is not exactly-once.')) return;
      const request = ++seq;
      mode.disabled = save.disabled = true;
      status.textContent = 'Saving…';
      try {
        await apiSend(host, '/api/settings', { recoveryMode: value }, 'PUT');
        if (owns(request, host)) status.textContent = 'Saved on ' + hostDisplayLabel(host) + ' for future server launches.';
      } catch (error) {
        if (owns(request, host)) status.textContent = 'Save failed: ' + message(error);
      } finally {
        if (owns(request, host)) mode.disabled = save.disabled = false;
      }
    }, listener);
    void load();
    refreshRecoveryHosts();
    // Opening settings re-reads the fleet, including upgrades since page load.
    void options.refreshFleet();
  }

  function isRecoveryViewOpen() {
    return !disposed && options.root.classList.contains('recovery-open');
  }

  function closeRecoveryView() {
    if (disposed) return;
    const select = doc.getElementById('recoveryReportHost') as HTMLSelectElement | null;
    if (select) select.onchange = null;
    recoveryViewSeq += 1;
    reportEvents?.abort(); reportEvents = null; reportEndpoint = undefined;
    options.root.classList.remove('recovery-open');
  }

  function openRecoveryView(hostId?: string | null) {
    const hosts = recoveryCapableHosts();
    if (disposed || !hosts.length) return;
    options.closeOtherViews();
    options.root.classList.add('recovery-open');
    const hostSelect = element<HTMLSelectElement>('recoveryReportHost');
    hostSelect.innerHTML = recoveryHostOptions(hosts);
    hostSelect.value = selectRecoveryHost(hosts, hostId)?.hostId || '';
    hostSelect.onchange = () => { void loadRecoveryView(); };
    loadRecoveryView();
  }

  async function loadRecoveryView() {
    if (!isRecoveryViewOpen()) return;
    const seq = ++recoveryViewSeq;
    reportEvents?.abort();
    const events = reportEvents = new AbortController();
    const listener = { signal: events.signal };
    const hostSelect = element<HTMLSelectElement>('recoveryReportHost');
    const selectedHost = () => recoveryCapableHosts().find(entry => (entry.hostId || '') === hostSelect.value);
    const selected = selectedHost();
    const host = reportEndpoint = selected ? snapshot(selected) : undefined;
    const body = element('recoveryViewBody');
    const owns = () => seq === recoveryViewSeq && isRecoveryViewOpen() && sameHost(host, selectedHost());
    if (!host) {
      body.textContent = 'This host no longer advertises recovery support.';
      return;
    }
    recoveryHostId = host.hostId;
    body.innerHTML = '<div class="usage-state" role="status">Loading recovery report…</div>';
    try {
      const res = await apiFetch(host, '/api/recovery', { timeoutMs: 20000 });
      const data: unknown = await res.json();
      if (!owns()) return;
      if (!res.ok) throw new Error(record(data) && text(data.error) || `HTTP ${res.status}`);
      const report = decodeRecoveryReport(data);
      const modes: Readonly<Record<string, string>> = { off: 'Off', restore: 'Restore open sessions', continue: 'Restore and continue interrupted work' };
      body.innerHTML = `<p class="recovery-note"><strong>${escapeHtml(Object.hasOwn(modes, report.mode) ? modes[report.mode] : report.mode)}</strong> on ${escapeHtml(hostDisplayLabel(host))}. Recovery runs when this host’s server starts, not when this report opens.</p>
        <p class="recovery-note">Needs review means recovery could not safely decide what happened. Inspect the transcript and any external actions before proceeding. Restore only reopens the session idle; it does not replay an uncertain prompt. Excluding a session prevents automatic recovery, without closing it.</p>
        <div id="recoveryActionStatus" role="status" class="recovery-note"></div>
        <div class="recovery-list"></div>`;
      const list = body.querySelector<HTMLElement>('.recovery-list')!;
      const records = report.sessions;
      let actionBusy = false;
      if (report.truncated) {
        const note = doc.createElement('p');
        note.className = 'recovery-note';
        note.textContent = `Showing the newest ${records.length} of ${report.totalRecords} recovery records. Older observations are not shown.`;
        list.before(note);
      }
      if (!records.length) list.innerHTML = '<div class="usage-state">No recorded sessions on this host yet.</div>';
      for (const record of records) {
        const row = doc.createElement('article');
        row.className = 'recovery-row';
        row.dataset.sessionId = record.id;
        const canRestore = ['needs-review', 'failed'].includes(record.status);
        row.innerHTML = `<div class="recovery-row-heading"><strong>${escapeHtml(record.name || record.id)}</strong><span class="recovery-status">${escapeHtml(record.status)}</span></div>
          <div class="recovery-meta">${escapeHtml(record.harnessId || '')} · ${escapeHtml(record.cwd || 'Working directory unavailable')}</div>
          <div class="recovery-reason">${escapeHtml(record.reason || '')}</div>
          <div class="recovery-meta">${escapeHtml(record.id)}${record.updatedAt ? ' · ' + escapeHtml(new Date(record.updatedAt).toLocaleString()) : ''}</div>
          <div class="recovery-actions"><label><input type="checkbox" class="recovery-excluded"${record.excluded ? ' checked' : ''}> Exclude from automatic recovery</label>${canRestore ? '<button class="btn-small recovery-restore">Restore idle</button>' : ''}</div>`;
        list.appendChild(row);
        const action = async (path: string, payload: unknown, method: string) => {
          if (!owns() || actionBusy) return;
          actionBusy = true;
          const controls = body.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button');
          controls.forEach(control => { control.disabled = true; });
          const status = body.querySelector<HTMLElement>('#recoveryActionStatus')!;
          status.textContent = 'Updating ' + (record.name || record.id) + '…';
          try {
            await apiSend(host, path, payload, method);
            if (owns()) await loadRecoveryView();
          } catch (error) {
            if (!owns()) return;
            status.textContent = 'Action failed: ' + message(error) + '. Refresh the report to check the host’s outcome before trying again.';
            row.querySelector<HTMLInputElement>('.recovery-excluded')!.checked = record.excluded;
            actionBusy = false;
            controls.forEach(control => { control.disabled = false; });
          }
        };
        const excluded = row.querySelector<HTMLInputElement>('.recovery-excluded')!;
        excluded.addEventListener('change', () => {
          void action(`/api/sessions/${encodeURIComponent(record.id)}/recovery`, { excluded: excluded.checked }, 'PUT');
        }, listener);
        row.querySelector('.recovery-restore')?.addEventListener('click', () => {
          if (owns() && !actionBusy && confirm('Restore ' + (record.name || record.id) + ' idle? This will not replay uncertain work. Review its transcript before sending another prompt.')) {
            void action('/api/recovery/retry', { id: record.id }, 'POST');
          }
        }, listener);
      }
    } catch (error) {
      if (owns()) body.textContent = 'Could not load recovery report: ' + message(error);
    }
  }

  function dispose(): void {
    unmountPreferences(); closeRecoveryView(); disposed = true;
    const select = doc.getElementById('recoveryReportHost') as HTMLSelectElement | null;
    if (select) select.onchange = null;
  }
  return { mountPreferences: renderRecoveryPreferences, unmountPreferences, refreshHosts: refreshRecoveryHosts,
    open: openRecoveryView, close: closeRecoveryView, isOpen: isRecoveryViewOpen, load: loadRecoveryView, dispose };
}
