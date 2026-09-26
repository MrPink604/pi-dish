import type { ApiRequest, HostEndpoint } from './api-client';
import { escapeHtml } from '../core/helper-format';
import { hostDisplayLabel } from './helper-identity';
import { record, finite } from '../core/helper-values';

export interface FleetHost extends HostEndpoint {
  readonly hostId: string | null;
  readonly key?: string;
  readonly self?: boolean;
  readonly name?: string | null;
  readonly label?: string | null;
  readonly version?: unknown;
  readonly capabilities?: Readonly<Record<string, boolean | undefined>>;
}
export interface FleetBytes { readonly totalBytes: number; readonly availableBytes: number }
export interface FleetSessions {
  readonly live: number; readonly working: number; readonly waiting: number; readonly subagents: number;
}
export interface FleetHealth {
  readonly uptimeSec: number | null;
  readonly platform: string; readonly arch: string;
  readonly cpu: { readonly cores: number; readonly utilization: number | null; readonly load: readonly number[] | null };
  readonly memory: FleetBytes | null;
  readonly disk: FleetBytes | null;
  readonly sessions: FleetSessions | null;
}

const count = (value: unknown) => finite(value) && value >= 0 ? Math.round(value) : 0;
function bytes(value: unknown): FleetBytes | null {
  if (!record(value) || !finite(value.totalBytes) || !finite(value.availableBytes) || value.totalBytes <= 0) return null;
  return { totalBytes: value.totalBytes, availableBytes: Math.min(value.totalBytes, Math.max(0, value.availableBytes)) };
}
/** Narrow one host's `/api/host/health` body; malformed parts degrade to absent. */
export function decodeFleetHealth(value: unknown): FleetHealth {
  if (!record(value)) throw new Error('Invalid host health');
  const cpu = record(value.cpu) ? value.cpu : {};
  const load = Array.isArray(cpu.load) && cpu.load.length === 3 && cpu.load.every(finite) ? cpu.load as number[] : null;
  const sessions = record(value.sessions) ? value.sessions : null;
  return {
    uptimeSec: finite(value.uptimeSec) ? value.uptimeSec : null,
    platform: typeof value.platform === 'string' ? value.platform : '',
    arch: typeof value.arch === 'string' ? value.arch : '',
    cpu: {
      cores: count(cpu.cores),
      utilization: finite(cpu.utilization) ? Math.min(1, Math.max(0, cpu.utilization)) : null,
      load,
    },
    memory: bytes(value.memory),
    disk: bytes(value.disk),
    sessions: sessions ? { live: count(sessions.live), working: count(sessions.working), waiting: count(sessions.waiting), subagents: count(sessions.subagents) } : null,
  };
}

export function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let n = value, unit = 0;
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
  return (n >= 100 || unit === 0 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, '')) + ' ' + units[unit];
}
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600);
  if (days) return `${days}d ${hours}h`;
  const minutes = Math.floor(seconds % 3600 / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
export function meterLevel(fraction: number): 'ok' | 'warn' | 'crit' {
  return fraction >= 0.9 ? 'crit' : fraction >= 0.75 ? 'warn' : 'ok';
}

function meterHtml(label: string, fraction: number | null, value: string, title = ''): string {
  if (fraction === null) {
    return `<div class="fleet-meter unknown"><span class="fleet-meter-label">${label}</span><span class="fleet-meter-bar"></span><span class="fleet-meter-value">${escapeHtml(value)}</span></div>`;
  }
  const pct = Math.round(fraction * 100);
  return `<div class="fleet-meter" data-level="${meterLevel(fraction)}" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"${title ? ` title="${escapeHtml(title)}"` : ''}>` +
    `<span class="fleet-meter-label">${label}</span><span class="fleet-meter-bar"><i style="width:${pct}%"></i></span>` +
    `<span class="fleet-meter-value">${escapeHtml(value)}</span></div>`;
}
function usedMeter(label: string, value: FleetBytes | null): string {
  if (!value) return meterHtml(label, null, 'unavailable');
  const used = value.totalBytes - value.availableBytes;
  return meterHtml(label, used / value.totalBytes, `${formatBytes(used)} / ${formatBytes(value.totalBytes)}`,
    `${formatBytes(value.availableBytes)} available`);
}

export function fleetSessionsHtml(sessions: FleetSessions | null, fallback: { live: number; working: number } | null): string {
  const s = sessions || (fallback ? { ...fallback, waiting: 0, subagents: 0 } : null);
  if (!s) return '<div class="fleet-sessions muted">Sessions unknown</div>';
  const parts = [`<strong>${s.live}</strong> live`];
  if (s.working) parts.push(`<span class="fleet-working">${s.working} working</span>`);
  if (s.waiting) parts.push(`${s.waiting} waiting on you`);
  if (s.subagents) parts.push(`${s.subagents} subagent${s.subagents === 1 ? '' : 's'}`);
  return `<div class="fleet-sessions">${parts.join(' · ')}</div>`;
}

export function fleetHealthHtml(health: FleetHealth): string {
  const cpu = health.cpu;
  const load = cpu.load ? `load ${cpu.load[0].toFixed(2)}` : '';
  const cpuValue = cpu.utilization === null ? 'unavailable'
    : [`${Math.round(cpu.utilization * 100)}%`, load, cpu.cores ? `${cpu.cores} cores` : ''].filter(Boolean).join(' · ');
  const cpuTitle = cpu.load ? `Load average ${cpu.load.map(n => n.toFixed(2)).join(' / ')} (1/5/15 min)` : '';
  return `<div class="fleet-meters">${meterHtml('CPU', cpu.utilization, cpuValue, cpuTitle)}${usedMeter('Memory', health.memory)}${usedMeter('Disk ~', health.disk)}</div>`;
}

type Connection = 'reachable' | 'connecting' | 'backoff' | 'blocked';
interface HostState { key: string; health?: FleetHealth; error?: string; receivedAt?: number; pending?: boolean }
export interface FleetViewOptions {
  root: HTMLElement; request: ApiRequest; hosts: () => readonly FleetHost[];
  connection: (host: FleetHost) => Connection; supports: (host: FleetHost) => boolean;
  clientSessions: (hostId: string | null) => { live: number; working: number } | null;
  dot: (hostId: string | null) => string;
  noteConnection: (host: FleetHost, event: 'success' | 'blocked' | { type: 'failure'; error: unknown }) => void;
  closeOtherViews: () => void; mountSections: () => void; unmountSections: () => void; closeBounce: () => void;
  now?: () => number; pollMs?: number;
}
const STALE_MS = 30_000;
const STATE_NOTES: Record<Connection, string> = { reachable: '', connecting: 'connecting', backoff: 'unreachable', blocked: 'needs a token' };

/**
 * The fleet takeover: per-host capacity plus the fleet-wide controls that used
 * to live in Settings. Health is polled only while the view is open and the
 * page visible; each host answers for itself (client is the aggregator).
 */
export function createFleetView(options: FleetViewOptions) {
  const doc = options.root.ownerDocument;
  const now = options.now || (() => Date.now());
  const pollMs = options.pollMs ?? 10_000;
  const states = new Map<string, HostState>();
  let disposed = false, generation = 0, timer: ReturnType<typeof setTimeout> | null = null;
  const keyOf = (host: FleetHost) => `${host.hostId || ''}\0${host.base}\0${host.token || ''}`;
  const isOpen = () => !disposed && options.root.classList.contains('fleet-open');
  const list = () => doc.getElementById('fleetHosts');

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!isOpen()) return;
    timer = setTimeout(() => { timer = null; if (isOpen() && !doc.hidden) void load(); else schedule(); }, pollMs);
  }

  function hostHtml(host: FleetHost): string {
    const state = states.get(keyOf(host));
    const connection = options.connection(host);
    const offline = connection === 'backoff' || connection === 'blocked';
    const note = STATE_NOTES[connection];
    const health = state?.health;
    const stale = !!state?.receivedAt && now() - state.receivedAt > STALE_MS;
    const version = typeof host.version === 'string' && host.version ? 'v' + host.version : '';
    const meta = [version, health ? [health.platform, health.arch].filter(Boolean).join(' ') : '',
      health?.uptimeSec ? 'up ' + formatUptime(health.uptimeSec) : ''].filter(Boolean).join(' · ');
    let body: string;
    if (health) body = fleetHealthHtml(health);
    else if (offline) body = '';
    else if (!options.supports(host)) body = `<div class="fleet-host-note">Update pi-dish on this host to report capacity.</div>`;
    else if (state?.error) body = `<div class="fleet-host-note error">${escapeHtml(state.error)}</div>`;
    else body = '<div class="fleet-host-note">Loading…</div>';
    const flags = [note && `<span class="fleet-host-state ${connection}">${escapeHtml(note)}</span>`,
      stale && '<span class="fleet-host-state stale" title="No fresh reading in the last 30s">stale</span>',
      state?.error && health ? `<span class="fleet-host-state error" title="${escapeHtml(state.error)}">last refresh failed</span>` : ''].filter(Boolean).join('');
    return `<section class="fleet-host${offline ? ' offline' : ''}">` +
      `<header class="fleet-host-head">${options.dot(host.hostId)}<strong class="fleet-host-name">${escapeHtml(hostDisplayLabel(host))}</strong>` +
      `${host.self ? '<span class="fleet-host-self">this server</span>' : ''}${flags}` +
      `${meta ? `<span class="fleet-host-meta">${escapeHtml(meta)}</span>` : ''}</header>` +
      (offline && !health ? '' : fleetSessionsHtml(health?.sessions || null, options.clientSessions(host.hostId))) + body + '</section>';
  }

  function render(): void {
    const element = list();
    if (!element || !isOpen()) return;
    const hosts = options.hosts();
    const keys = new Set(hosts.map(keyOf));
    for (const key of states.keys()) if (!keys.has(key)) states.delete(key);
    // A host discovered while the view is open loads now, not at the next poll.
    for (const host of hosts) if (!states.has(keyOf(host))) void loadHost(host, generation);
    const html = hosts.map(hostHtml).join('');
    if (element.innerHTML !== html) element.innerHTML = html;
  }

  async function loadHost(host: FleetHost, owner: number): Promise<void> {
    const key = keyOf(host), endpoint = Object.freeze({ ...host });
    const state = states.get(key) || { key };
    states.set(key, state);
    const connection = options.connection(host);
    if (!options.supports(host) || connection === 'blocked') return;
    state.pending = true;
    const owns = () => owner === generation && isOpen() && states.get(key) === state;
    try {
      const response = await options.request(endpoint, '/api/host/health', { timeoutMs: 8000 });
      if (response.status === 401) { options.noteConnection(host, 'blocked'); throw new Error('Needs a token'); }
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
      const health = decodeFleetHealth(data);
      options.noteConnection(host, 'success');
      if (!owns()) return;
      state.health = health; state.error = undefined; state.receivedAt = now();
    } catch (error) {
      if (!(error instanceof Error && error.message === 'Needs a token')) options.noteConnection(host, { type: 'failure', error });
      if (!owns()) return;
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (owns()) { state.pending = false; render(); }
    }
  }

  async function load(): Promise<void> {
    if (!isOpen()) return;
    const owner = ++generation;
    // Each load registers its host's state synchronously, so this render
    // shows the loading cards without starting a second request for them.
    const pending = options.hosts().map(host => loadHost(host, owner));
    render();
    await Promise.allSettled(pending);
    if (owner === generation) { render(); schedule(); }
  }

  function open(): void {
    if (disposed) return;
    options.closeOtherViews();
    if (isOpen()) { void load(); return; }
    options.root.classList.add('fleet-open');
    options.mountSections();
    const body = doc.getElementById('fleetViewBody'); if (body) body.scrollTop = 0;
    void load();
  }
  function close(): void {
    if (disposed || !isOpen()) return;
    ++generation;
    if (timer) clearTimeout(timer);
    timer = null;
    options.closeBounce();
    options.unmountSections();
    options.root.classList.remove('fleet-open');
  }
  return {
    open, close, isOpen, render, refresh: () => { void load(); },
    dispose() { close(); disposed = true; states.clear(); },
  };
}
