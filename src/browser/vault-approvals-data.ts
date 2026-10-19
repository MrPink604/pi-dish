import { escapeHtml } from '../core/helper-format';
import { finite, record } from '../core/helper-values';

export type VaultDecision = 'approve' | 'approve-window' | 'deny';
export interface VaultRequestView {
  readonly id: string; readonly device: string; readonly item: string; readonly fields: readonly string[];
  readonly reason: string; readonly sessionName: string; readonly sessionRef: string; readonly expiresAt: number;
}
export interface VaultGrantView { readonly id: string; readonly device: string; readonly item: string; readonly fields: readonly string[]; readonly expiresAt: number }
export interface VaultListenerView { readonly state: 'locked' | 'ready'; readonly account: string; readonly stale: boolean }
export interface VaultOverviewView {
  readonly listener: VaultListenerView | null;
  readonly pending: readonly VaultRequestView[];
  readonly grants: readonly VaultGrantView[];
}

const text = (value: unknown) => typeof value === 'string' ? value : '';
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
      id: entry.id, device: record(entry.device) ? text(entry.device.name) : '', item: text(entry.item), fields: strings(entry.fields),
      reason: text(entry.reason), sessionName: text(session.name), sessionRef: text(session.ref), expiresAt: entry.expiresAt,
    }];
  });
  const grants = value.grants.flatMap((entry: unknown) => record(entry) && typeof entry.id === 'string' && entry.id && finite(entry.expiresAt) ? [{
    id: entry.id, device: record(entry.device) ? text(entry.device.name) : '', item: text(entry.item), fields: strings(entry.fields), expiresAt: entry.expiresAt,
  }] : []);
  return { listener, pending, grants };
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

/**
 * The approval surface. Every agent-supplied string is escaped; the session
 * and reason are the agent's own claims, so they are labelled as such.
 */
export function vaultSurfaceHtml(view: VaultOverviewView, options: { readonly now: number; readonly busy: ReadonlySet<string>; readonly expanded: boolean; readonly notice: string }): string {
  const { now, busy } = options;
  if (!options.expanded) {
    const label = view.grants.length === 1 ? '1 vault window open' : `${view.grants.length} vault windows open`;
    return `<button class="vault-pill" data-vault-action="expand">🔐 ${escapeHtml(label)}</button>`;
  }
  const cards = view.pending.map(request => {
    const disabled = busy.has(request.id) ? ' disabled' : '';
    const session = request.sessionName || request.sessionRef;
    return `<article class="vault-card" data-vault-request="${escapeHtml(request.id)}">
      <header><strong>${escapeHtml(request.item)}</strong><span class="vault-fields">${escapeHtml(request.fields.join(', '))}</span></header>
      <dl>
        <dt>Device</dt><dd>${escapeHtml(request.device)}</dd>
        ${session ? `<dt>Session <small>(reported)</small></dt><dd>${escapeHtml(session)}${request.sessionName && request.sessionRef ? ` <code>${escapeHtml(request.sessionRef)}</code>` : ''}</dd>` : ''}
        ${request.reason ? `<dt>Reason <small>(reported)</small></dt><dd>${escapeHtml(request.reason)}</dd>` : ''}
        <dt>Expires</dt><dd>in ${escapeHtml(remaining(request.expiresAt, now))}</dd>
      </dl>
      <div class="vault-actions">
        <button class="btn-small vault-approve" data-vault-decision="approve"${disabled}>Approve</button>
        <button class="btn-small" data-vault-decision="approve-window"${disabled}>Approve 15 min</button>
        <button class="btn-small vault-deny" data-vault-decision="deny"${disabled}>Deny</button>
      </div>
    </article>`;
  }).join('');
  const grants = view.grants.length ? `<ul class="vault-grants">${view.grants.map(grant =>
    `<li><span>${escapeHtml(grant.item)} <small>${escapeHtml(grant.fields.join(', '))} · ${escapeHtml(grant.device)} · ${escapeHtml(remaining(grant.expiresAt, now))} left</small></span>
      <button class="btn-small" data-vault-revoke="${escapeHtml(grant.id)}">Revoke</button></li>`).join('')}</ul>` : '';
  return `<div class="vault-head"><strong>Vault requests</strong>
      ${view.pending.length ? '' : '<button class="btn-small" data-vault-action="collapse" aria-label="Close vault panel">✕</button>'}</div>
    <p class="vault-status${view.listener?.state === 'ready' && !view.listener.stale ? '' : ' warn'}">${escapeHtml(vaultListenerText(view.listener))}</p>
    ${cards || '<p class="vault-empty">No pending requests.</p>'}
    ${grants}
    ${options.notice ? `<p class="vault-notice">${escapeHtml(options.notice)}</p>` : ''}`;
}
