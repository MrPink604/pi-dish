import { record, finite } from '../core/helper-values';

export type CuSeatState = 'idle' | 'agent' | 'waiting_for_human' | 'human';

export interface CuLeaseInfo {
  readonly leaseId: string | null;
  readonly sessionId: string | null;
  readonly ownerId?: string | null;
  readonly holderKind: string | null;
  readonly holderId: string | null;
  readonly label: string | null;
  readonly reason: string | null;
  readonly acquiredAt: string | null;
  readonly expiresAt: string | null;
  readonly hardExpiresAt: string | null;
  readonly reservedUntil: string | null;
}

export interface CuPreemptedInfo {
  readonly sessionId: string | null;
  readonly ownerId?: string | null;
  readonly label: string | null;
}

export interface CuHealthInfo {
  readonly broker: boolean;
  readonly spacesd: boolean;
  readonly driver: boolean;
  readonly xvfb: boolean;
  readonly desktop: boolean;
  readonly chrome: boolean;
  readonly driverWorkerRunning: boolean;
}

export interface CuStatus {
  readonly state: CuSeatState;
  readonly epoch: number;
  readonly generation?: string | null;
  readonly cursor?: number | null;
  readonly lease: CuLeaseInfo | null;
  readonly preempted: CuPreemptedInfo | null;
  readonly health: CuHealthInfo | null;
}

export interface CuTicketResult {
  readonly mode: 'view-only' | 'interactive';
  readonly epoch: number | null;
  readonly ticket: string;
  readonly path: string;
  readonly spacesPath: string;
  readonly ttlSec: number | null;
  readonly expiresAt: string | null;
}

export interface CuTakeoverResult {
  readonly state: CuSeatState;
  readonly epoch: number;
  readonly lease: CuLeaseInfo | null;
  readonly leaseId: string;
  readonly leaseToken: string;
  readonly preempted: CuPreemptedInfo | null;
  readonly heartbeatIntervalSec: number;
  readonly viewer: CuTicketResult | null;
}

export interface CuReleaseResult {
  readonly state: CuSeatState;
  readonly epoch: number;
  readonly lease: CuLeaseInfo | null;
  readonly handedBackTo: CuPreemptedInfo | null;
}

export interface CuBusyInfo {
  readonly code: string | null;
  readonly state: string | null;
  readonly epoch: number | null;
  readonly holder: CuLeaseInfo | null;
  readonly message: string;
}

export interface CuLocalHumanLease {
  readonly leaseId: string;
  readonly leaseToken: string;
  readonly epoch: number;
  readonly heartbeatIntervalSec: number;
  expiresAt: string | null;
}

export interface CuSeatSessionContext {
  readonly cuOwnerId?: string | null;
  readonly waitingForDesktop?: boolean;
  readonly sessionScoped?: boolean;
}

export interface CuSeatPresentation {
  readonly tone: 'idle' | 'agent' | 'waiting' | 'human' | 'self';
  readonly badge: string;
  readonly detail: string;
  readonly ownControl: boolean;
  readonly owner?: 'this' | 'other';
}

export interface CuSessionListCue {
  readonly state: Exclude<CuSeatState, 'idle'>;
  readonly holderKind: 'agent' | 'human';
  readonly tone: 'agent' | 'waiting' | 'human' | 'self';
  readonly label: string;
  readonly title: string;
  readonly owner?: 'this' | 'other';
}

export const CU_PANEL_STORAGE_PREFIX = 'pi-dish-cu-panel:';

const VALID_STATES = new Set<CuSeatState>(['idle', 'agent', 'waiting_for_human', 'human']);
const CANONICAL_RELAY_BASE_RE = /^\/hosts\/[a-z0-9][a-z0-9-]{0,31}$/;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseSeatState(value: unknown): CuSeatState {
  return typeof value === 'string' && VALID_STATES.has(value as CuSeatState) ? (value as CuSeatState) : 'idle';
}

/**
 * Viewer iframes navigate with the page's own same-origin transport (Cloudflare
 * Access cookie or trusted LAN) and cannot attach a dish bearer header or
 * satisfy `frame-ancestors 'self'` across origins. Offer Desktop only for self
 * (`""`) or a canonical hub relay (`/hosts/<name>`) without a client-held
 * bearer token. Rejects cross-origin and network-path URLs like `//evil`.
 */
export function supportsComputerUseTransport(
  host: { readonly base?: string | null; readonly token?: string | null } | null | undefined,
): boolean {
  if (!host || typeof host.base !== 'string') return false;
  if (host.token) return false;
  return host.base === '' || CANONICAL_RELAY_BASE_RE.test(host.base);
}

export function decodeCuLease(value: unknown): CuLeaseInfo | null {
  if (!record(value)) return null;
  const leaseId = str(value.leaseId) ?? str(value.id);
  const sessionId = str(value.sessionId);
  const ownerId = str(value.ownerId);
  const holderKind = str(value.holderKind) ?? str(value.kind);
  const holderId = str(value.holderId);
  const label = str(value.label);
  const reason = str(value.reason);
  const acquiredAt = str(value.acquiredAt);
  const expiresAt = str(value.expiresAt);
  const hardExpiresAt = str(value.hardExpiresAt);
  const reservedUntil = str(value.reservedUntil);
  if (!leaseId && !sessionId && !ownerId && !holderKind && !holderId && !label && !expiresAt) return null;
  return { leaseId, sessionId, ownerId, holderKind, holderId, label, reason, acquiredAt, expiresAt, hardExpiresAt, reservedUntil };
}

function decodePreempted(value: unknown): CuPreemptedInfo | null {
  if (!record(value)) return null;
  const sessionId = str(value.sessionId);
  const ownerId = str(value.ownerId);
  const label = str(value.label);
  if (!sessionId && !ownerId && !label) return null;
  return { sessionId, ownerId, label };
}

function decodeHealth(value: unknown): CuHealthInfo | null {
  if (!record(value)) return null;
  return {
    broker: value.broker === true,
    spacesd: value.spacesd === true,
    driver: value.driver === true,
    xvfb: value.xvfb === true,
    desktop: value.desktop === true,
    chrome: value.chrome === true,
    driverWorkerRunning: value.driverWorkerRunning === true,
  };
}

export function decodeCuStatus(value: unknown): CuStatus | null {
  if (!record(value)) return null;
  const state = parseSeatState(value.state);
  const epoch = finite(value.epoch) ? Math.trunc(value.epoch) : 0;
  const generation = str(value.generation);
  const cursor = finite(value.cursor) ? Math.trunc(value.cursor) : null;
  return {
    state,
    epoch,
    ...(generation !== null ? { generation } : {}),
    ...(cursor !== null ? { cursor } : {}),
    lease: decodeCuLease(value.lease),
    preempted: decodePreempted(value.preempted),
    health: decodeHealth(value.health),
  };
}

export function decodeCuTicket(value: unknown): CuTicketResult | null {
  if (!record(value)) return null;
  const ticket = str(value.ticket);
  if (!ticket) return null;
  const mode = value.mode === 'interactive' ? 'interactive' : 'view-only';
  const encodedTicket = encodeURIComponent(ticket);
  return {
    mode,
    epoch: finite(value.epoch) ? Math.trunc(value.epoch) : null,
    ticket,
    path: `/viewer/#ticket=${encodedTicket}`,
    spacesPath: `/api/cu/spaces/viewer/#ticket=${encodedTicket}`,
    ttlSec: finite(value.ttlSec) ? Math.max(0, Math.round(value.ttlSec)) : null,
    expiresAt: str(value.expiresAt),
  };
}

export function decodeCuTakeover(value: unknown): CuTakeoverResult | null {
  if (!record(value)) return null;
  const lease = decodeCuLease(value.lease);
  const leaseId = str(value.leaseId) ?? lease?.leaseId;
  const leaseToken = str(value.leaseToken) ?? str(value.token);
  if (!leaseId || !leaseToken) return null;
  const epoch = finite(value.epoch) ? Math.trunc(value.epoch) : 0;
  const heartbeatIntervalSec = finite(value.heartbeatIntervalSec) && value.heartbeatIntervalSec >= 5
    ? Math.round(value.heartbeatIntervalSec)
    : 60;
  return {
    state: parseSeatState(value.state || 'human'),
    epoch,
    lease,
    leaseId,
    leaseToken,
    preempted: decodePreempted(value.preempted),
    heartbeatIntervalSec,
    viewer: decodeCuTicket(value.viewer),
  };
}

export function decodeCuRelease(value: unknown): CuReleaseResult | null {
  if (!record(value)) return null;
  return {
    state: parseSeatState(value.state || 'idle'),
    epoch: finite(value.epoch) ? Math.trunc(value.epoch) : 0,
    lease: decodeCuLease(value.lease),
    handedBackTo: decodePreempted(value.handedBackTo),
  };
}

export function decodeCuBusyError(value: unknown, fallback = 'Computer-use seat is busy'): CuBusyInfo {
  if (!record(value)) {
    return { code: null, state: null, epoch: null, holder: null, message: fallback };
  }
  const holder = decodeCuLease(value.holder) ?? decodeCuLease(value.lease);
  const message = str(value.error) ?? str(value.message) ?? fallback;
  return {
    code: str(value.code),
    state: str(value.state),
    epoch: finite(value.epoch) ? Math.trunc(value.epoch) : null,
    holder,
    message,
  };
}

export function formatRemainingMs(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'expiring…';
  const totalSec = Math.ceil(remainingMs / 1000);
  if (totalSec < 60) return `${totalSec}s left`;
  const totalMin = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  if (totalMin < 60) return remSec > 0 ? `${totalMin}m ${remSec}s left` : `${totalMin}m left`;
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  return remMin > 0 ? `${hours}h ${remMin}m left` : `${hours}h left`;
}

export function formatLeaseHolder(lease: CuLeaseInfo | null, stateHint?: string | null): string {
  if (!lease) {
    if (stateHint === 'human') return 'another human';
    if (stateHint === 'agent' || stateHint === 'waiting_for_human') return 'agent';
    return 'another holder';
  }
  const kind = lease.holderKind || (stateHint === 'human' ? 'human' : stateHint === 'agent' || stateHint === 'waiting_for_human' ? 'agent' : null);
  const name = lease.label || lease.holderId || lease.sessionId;
  if (kind === 'human') return name ? `Human: ${name}` : 'Human';
  if (kind === 'agent') return name ? `Agent: ${name}` : 'Agent';
  return name || 'active holder';
}

export function formatExpiryRemaining(expiresAt: string | null | undefined, nowMs: number): string | null {
  if (!expiresAt) return null;
  const target = Date.parse(expiresAt);
  if (!Number.isFinite(target)) return null;
  return formatRemainingMs(target - nowMs);
}

export function isOwnHumanLease(
  status: CuStatus | null,
  localLease: Pick<CuLocalHumanLease, 'leaseId' | 'epoch'> | null,
): boolean {
  if (!status || !localLease) return false;
  if (status.state !== 'human' || status.epoch !== localLease.epoch) return false;
  if (status.lease?.leaseId && status.lease.leaseId !== localLease.leaseId) return false;
  return true;
}

/** Exact full-string comparison of opaque broker ownerIds (never truncated). */
export function matchesSessionOwner(
  leaseOwnerId: string | null | undefined,
  sessionOwnerId: string | null | undefined,
): boolean {
  return typeof leaseOwnerId === 'string'
    && leaseOwnerId.length > 0
    && typeof sessionOwnerId === 'string'
    && sessionOwnerId.length > 0
    && leaseOwnerId === sessionOwnerId;
}

export function cuSeatPresentation(
  status: CuStatus | null,
  localLease: Pick<CuLocalHumanLease, 'leaseId' | 'epoch' | 'expiresAt'> | null,
  nowMs: number,
  context?: CuSeatSessionContext,
): CuSeatPresentation {
  if (!status) {
    if (context?.waitingForDesktop) {
      return { tone: 'waiting', badge: 'Waiting for desktop', detail: 'Desktop held by human', ownControl: false };
    }
    return { tone: 'idle', badge: 'Connecting…', detail: 'Checking seat status', ownControl: false };
  }
  const ownControl = isOwnHumanLease(status, localLease);
  const expiresAt = status.lease?.expiresAt ?? (ownControl ? localLease?.expiresAt ?? null : null);
  const remaining = formatExpiryRemaining(expiresAt, nowMs);

  if (status.state === 'idle') {
    return { tone: 'idle', badge: 'Idle', detail: 'Desktop available (view-only)', ownControl: false };
  }
  if (status.state === 'human') {
    if (ownControl) {
      const parts = [remaining ?? 'active'];
      if (status.preempted) {
        parts.push(`paused ${status.preempted.label || 'agent'}`);
      }
      return { tone: 'self', badge: 'You have control', detail: parts.join(' · '), ownControl: true };
    }
    const holder = formatLeaseHolder(status.lease, 'human');
    if (context?.waitingForDesktop) {
      return {
        tone: 'waiting',
        badge: 'Waiting for desktop',
        detail: [holder, remaining].filter(Boolean).join(' · ') || 'Desktop held by human',
        ownControl: false,
      };
    }
    return {
      tone: 'human',
      badge: 'Human',
      detail: [holder, remaining].filter(Boolean).join(' · '),
      ownControl: false,
    };
  }
  const hasOwnerSignal = context?.sessionScoped === true && !!(status.lease?.ownerId || context.cuOwnerId);
  if (status.state === 'waiting_for_human') {
    const holder = formatLeaseHolder(status.lease, 'agent');
    const parts = [holder, status.lease?.reason, remaining].filter(Boolean);
    if (hasOwnerSignal) {
      const isThis = matchesSessionOwner(status.lease?.ownerId, context?.cuOwnerId);
      return {
        tone: isThis ? 'waiting' : 'agent',
        badge: isThis ? 'Waiting for you' : 'Agent: other session',
        detail: parts.join(' · '),
        ownControl: false,
        owner: isThis ? 'this' : 'other',
      };
    }
    return { tone: 'waiting', badge: 'Waiting for you', detail: parts.join(' · '), ownControl: false };
  }
  const holder = formatLeaseHolder(status.lease, 'agent');
  if (hasOwnerSignal) {
    const isThis = matchesSessionOwner(status.lease?.ownerId, context?.cuOwnerId);
    return {
      tone: 'agent',
      badge: isThis ? 'Agent: this session' : 'Agent: other session',
      detail: [holder, remaining].filter(Boolean).join(' · '),
      ownControl: false,
      owner: isThis ? 'this' : 'other',
    };
  }
  return {
    tone: 'agent',
    badge: 'Agent',
    detail: [holder, remaining].filter(Boolean).join(' · '),
    ownControl: false,
  };
}

export function formatBusyMessage(busy: CuBusyInfo, nowMs: number): string {
  const holder = busy.holder ? formatLeaseHolder(busy.holder, busy.state) : null;
  const remaining = formatExpiryRemaining(busy.holder?.expiresAt, nowMs);
  if (holder) {
    const suffix = remaining ? ` (${remaining})` : '';
    return `Busy — held by ${holder}${suffix}`;
  }
  if (/busy/i.test(busy.message)) return busy.message;
  return `Busy — ${busy.message}`;
}

export function cuSpacesViewerUrl(base: string, ticket: Pick<CuTicketResult, 'ticket'>): string {
  const cleanBase = base.replace(/\/+$/, '');
  return `${cleanBase}/api/cu/spaces/viewer/#ticket=${encodeURIComponent(ticket.ticket)}`;
}

/**
 * Session-scoped or host-level sidebar seat cue while a computer-use host's
 * seat is held (agent, waiting_for_human, or human) or while a session is
 * waiting for a human-held desktop. Returns null when unknown or idle.
 */
export function cuSessionListCue(
  status: CuStatus | null,
  localLease: Pick<CuLocalHumanLease, 'leaseId' | 'epoch'> | null = null,
  context?: CuSeatSessionContext,
): CuSessionListCue | null {
  if (context?.waitingForDesktop && (!status || status.state === 'human')) {
    return {
      state: 'human',
      holderKind: 'human',
      tone: 'waiting',
      label: 'waiting for desktop',
      title: 'Session waiting for desktop while human holds control',
    };
  }
  if (!status || status.state === 'idle') return null;
  if (status.state === 'human') {
    if (isOwnHumanLease(status, localLease)) {
      return {
        state: 'human',
        holderKind: 'human',
        tone: 'self',
        label: 'desktop: you',
        title: 'Desktop seat held by you (host-level)',
      };
    }
    const holder = formatLeaseHolder(status.lease, 'human');
    return {
      state: 'human',
      holderKind: 'human',
      tone: 'human',
      label: 'desktop: human',
      title: `Desktop seat held by ${holder} (host-level)`,
    };
  }
  const hasOwnerSignal = context?.sessionScoped === true && !!(status.lease?.ownerId || context.cuOwnerId);
  if (status.state === 'waiting_for_human') {
    const holder = formatLeaseHolder(status.lease, 'agent');
    if (hasOwnerSignal) {
      const isThis = matchesSessionOwner(status.lease?.ownerId, context?.cuOwnerId);
      return {
        state: 'waiting_for_human',
        holderKind: 'agent',
        tone: isThis ? 'waiting' : 'agent',
        owner: isThis ? 'this' : 'other',
        label: isThis ? 'desktop: waiting' : 'agent: other session',
        title: isThis ? 'This session is waiting for human input on the desktop' : 'Desktop seat held by another session',
      };
    }
    return {
      state: 'waiting_for_human',
      holderKind: 'agent',
      tone: 'waiting',
      label: 'desktop: waiting',
      title: `Desktop waiting for you (${holder}, host-level)`,
    };
  }
  if (hasOwnerSignal) {
    const isThis = matchesSessionOwner(status.lease?.ownerId, context?.cuOwnerId);
    return {
      state: 'agent',
      holderKind: 'agent',
      tone: 'agent',
      owner: isThis ? 'this' : 'other',
      label: isThis ? 'agent: this session' : 'agent: other session',
      title: isThis ? 'Desktop seat held by this session' : 'Desktop seat held by another session',
    };
  }
  const holder = formatLeaseHolder(status.lease, 'agent');
  return {
    state: 'agent',
    holderKind: 'agent',
    tone: 'agent',
    label: 'desktop: agent',
    title: `Desktop seat held by ${holder} (host-level)`,
  };
}

export function cuPanelStorageKey(sessionIdentityKey: string): string {
  return `${CU_PANEL_STORAGE_PREFIX}${sessionIdentityKey}`;
}
