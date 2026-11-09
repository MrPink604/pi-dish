import { escapeHtml } from '../core/helper-format';
import { resolveSessionRefAmong } from '../core/helper-refs';
import { finite, record, text } from '../core/helper-values';

export type VaultDecision = 'approve' | 'approve-window' | 'deny';
export interface VaultRequestView {
  readonly id: string; readonly device: string; readonly action: 'release' | 'create'; readonly item: string; readonly folder: string; readonly fields: readonly string[];
  readonly reason: string; readonly sessionName: string; readonly sessionRef: string; readonly sessionHost: string; readonly expiresAt: number;
}
export interface VaultGrantView {
  readonly id: string; readonly device: string; readonly item: string; readonly fields: readonly string[];
  readonly sessionRef: string; readonly expiresAt: number;
}
export interface VaultListenerView { readonly state: 'locked' | 'ready'; readonly account: string; readonly stale: boolean }
export interface VaultOverviewView {
  readonly listener: VaultListenerView | null;
  readonly pending: readonly VaultRequestView[];
  readonly grants: readonly VaultGrantView[];
}
export interface VaultSessionCandidate { readonly id: string; readonly host?: string | null; readonly hostLabel?: string }

const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export function decodeVaultOverview(value: unknown): VaultOverviewView {
  if (!record(value) || !Array.isArray(value.pending) || !Array.isArray(value.grants)) throw new Error('Invalid vault response');
  const state = record(value.listener) ? value.listener.state : null;
  const listener: VaultListenerView | null = record(value.listener) && (state === 'locked' || state === 'ready')
    ? { state, account: text(value.listener.account), stale: value.listener.stale === true } : null;
  const pending = value.pending.flatMap((entry: unknown) => {
    if (!record(entry) || typeof entry.id !== 'string' || !entry.id || !finite(entry.expiresAt)) return [];
    const session = record(entry.session) ? entry.session : {};
    return [{
      id: entry.id, device: record(entry.device) ? text(entry.device.name) : '', action: entry.action === 'create' ? 'create' : 'release',
      item: text(entry.item), folder: text(entry.folder), fields: strings(entry.fields),
      reason: text(entry.reason), sessionName: text(session.name), sessionRef: text(session.ref), sessionHost: text(session.host),
      expiresAt: entry.expiresAt,
    } satisfies VaultRequestView];
  });
  const grants = value.grants.flatMap((entry: unknown) => record(entry) && typeof entry.id === 'string' && entry.id && finite(entry.expiresAt) ? [{
    id: entry.id, device: record(entry.device) ? text(entry.device.name) : '', item: text(entry.item), fields: strings(entry.fields),
    sessionRef: text(entry.sessionRef), expiresAt: entry.expiresAt,
  }] : []);
  return { listener, pending, grants };
}

/** The `<host label>/<short ref>` claim resolves only to a unique session on a host with that label. */
export function vaultRequestSession<T extends VaultSessionCandidate>(request: Pick<VaultRequestView, 'sessionRef' | 'sessionHost'>, sessions: readonly T[]): T | null {
  if (!request.sessionRef) return null;
  const slash = request.sessionRef.indexOf('/');
  const label = (slash > 0 ? request.sessionRef.slice(0, slash) : request.sessionHost).toLowerCase();
  const short = slash > 0 ? request.sessionRef.slice(slash + 1) : request.sessionRef;
  const onHost = label ? sessions.filter(session => (session.hostLabel || '').toLowerCase() === label) : sessions;
  return resolveSessionRefAmong(onHost, short).session;
}

function remaining(until: number, now: number): string {
  const seconds = Math.max(0, Math.round((until - now) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

/** The listener line explains why an approval would not release anything. */
export function vaultListenerText(listener: VaultListenerView | null): string {
  if (!listener || listener.stale) return 'Vault listener offline: approvals cannot release anything until it runs.';
  if (listener.state === 'locked') return 'Vault locked: unlock it in the listener’s tmux window.';
  return listener.account ? `Vault ready (${listener.account})` : 'Vault ready';
}

/** Every agent-supplied string is escaped; session and reason are labelled as the agent's own claims. A create opens no window. */
export function vaultCardsHtml(requests: readonly VaultRequestView[], options: { readonly now: number; readonly busy: ReadonlySet<string>; readonly inSession: boolean }): string {
  return requests.map(request => {
    const disabled = options.busy.has(request.id) ? ' disabled' : '';
    const session = request.sessionName || request.sessionRef;
    const sessionLine = !options.inSession && session
      ? `<dt>Session <small>(reported)</small></dt><dd><button class="vault-link" data-vault-open="${escapeHtml(request.id)}">${escapeHtml(session)} ↗</button></dd>` : '';
    const create = request.action === 'create';
    return `<article class="vault-card" data-vault-request="${escapeHtml(request.id)}">
      <header><strong>${create ? '➕ Create' : '🔐'} ${escapeHtml(request.item)}</strong><span class="vault-fields">${escapeHtml(request.fields.join(', '))}</span></header>
      <dl>
        ${create ? `<dt>Folder</dt><dd>${escapeHtml(request.folder)}</dd><dt>Password</dt><dd>generated by the listener</dd>` : ''}
        <dt>Device</dt><dd>${escapeHtml(request.device)}</dd>
        ${sessionLine}
        ${request.reason ? `<dt>Reason <small>(reported)</small></dt><dd>${escapeHtml(request.reason)}</dd>` : ''}
        <dt>Expires</dt><dd>in ${escapeHtml(remaining(request.expiresAt, options.now))}</dd>
      </dl>
      <div class="vault-actions">
        <button class="btn-small vault-approve" data-vault-decision="approve"${disabled}>Approve</button>
        ${create ? '' : `<button class="btn-small" data-vault-decision="approve-window"${disabled}>Approve 15 min</button>`}
        <button class="btn-small vault-deny" data-vault-decision="deny"${disabled}>Deny</button>
      </div>
    </article>`;
  }).join('');
}

export function vaultPanelHtml(view: VaultOverviewView, options: { readonly now: number; readonly busy: ReadonlySet<string>; readonly notice: string }): string {
  const grants = view.grants.length ? `<h4>Open windows</h4><ul class="vault-grants">${view.grants.map(grant =>
    `<li><span>${escapeHtml(grant.item)} <small>${escapeHtml([grant.fields.join(', '), grant.device, grant.sessionRef, `${remaining(grant.expiresAt, options.now)} left`].filter(Boolean).join(' · '))}</small></span>
      <button class="btn-small" data-vault-revoke="${escapeHtml(grant.id)}">Revoke</button></li>`).join('')}</ul>` : '';
  return `<div class="vault-head"><strong>Vault</strong><button class="btn-icon" data-vault-action="close" aria-label="Close vault panel">✕</button></div>
    <p class="vault-status${view.listener?.state === 'ready' && !view.listener.stale ? '' : ' warn'}">${escapeHtml(vaultListenerText(view.listener))}</p>
    ${view.pending.length ? vaultCardsHtml(view.pending, { ...options, inSession: false }) : '<p class="vault-empty">No pending requests.</p>'}
    ${grants}
    ${options.notice ? `<p class="vault-notice">${escapeHtml(options.notice)}</p>` : ''}`;
}
