// Generated from src/core/vault-approvals.ts; edit that source and run npm run build:core.
import type { NextFunction, Request, Response } from 'express';
import type { PushPayload } from './push-notifications';
export declare const VAULT_FIELDS: readonly ['username', 'password', 'totp', 'uri', 'notes'];
/** A built-in field, or `field:<name>` for a custom (text or hidden) field of the item. */
export type VaultField = typeof VAULT_FIELDS[number] | `field:${string}`;
export declare const BRIDGE_HEADER = "x-pi-dish-vault-bridge";
export declare const GRANT_WINDOW_MS: number;
export declare const LISTENER_STALE_MS: number;
export declare const MAX_REQUEST_LIFETIME_MS: number;
export declare const RECENT_LIMIT = 20;
export declare const VAULT_POLICY_FILE = "policies.json";
export declare const VAULT_ENROLLED_FILE = "enrolled.json";
export declare const VAULT_AUDIT_FILE = "vault-audit.ndjson";
export declare const VAULT_AUDIT_MAX_BYTES: number;
export declare const VAULT_AUDIT_READ_MAX_BYTES: number;
export interface VaultDevice {
    readonly name: string;
    readonly fingerprint: string;
}
export interface VaultSessionClaim {
    readonly ref: string;
    readonly name: string | null;
    readonly host: string | null;
}
export type VaultRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type VaultDecision = 'approve' | 'approve-window' | 'deny';
/** `release` hands existing fields to one command; `create` adds one login with a listener-generated password. */
export type VaultAction = 'release' | 'create';
export type VaultOriginMatch = 'match' | 'mismatch' | 'no-origin';
export type VaultAuditEvent = 'request' | 'decision';
export type VaultAuditActor = 'listener' | 'policy' | 'grant' | 'operator' | 'timeout';
export interface VaultDevicePolicy {
    readonly name?: string;
    readonly allowFolder?: string;
    readonly allowFolderId?: string;
    readonly allowedFields?: readonly VaultField[];
    readonly allowWindow?: boolean;
    readonly allowCreate?: boolean;
    readonly requireOriginMatch?: boolean;
}
export interface VaultAuditEntry {
    readonly ts: string;
    readonly event: VaultAuditEvent;
    readonly requestId: string;
    readonly action: VaultAction;
    readonly deviceFingerprint: string;
    readonly deviceName: string;
    readonly itemId: string | null;
    readonly itemName: string;
    readonly fields: readonly VaultField[];
    readonly folderId: string | null;
    readonly folder: string | null;
    readonly origin: string | null;
    readonly originMatch: VaultOriginMatch;
    readonly decision: string;
    readonly by: VaultAuditActor;
    readonly policyResult: string;
    readonly policyName: string | null;
}
export interface VaultAuditQuery {
    readonly limit?: number;
    readonly device?: string;
    readonly decision?: string;
    readonly maxBytes?: number;
}
export interface VaultRequest {
    readonly id: string;
    readonly device: VaultDevice;
    readonly action: VaultAction;
    /** The existing item's Bitwarden id when reported by the listener; null for old listeners or `create`. */
    readonly itemId: string | null;
    /** The existing item's name, or the new login's name. */
    readonly item: string;
    /** The requested fields, or for `create` the fields the new login will have. */
    readonly fields: readonly VaultField[];
    /** The item's Bitwarden folder id when reported by the listener; enforced by id when present in policy. */
    readonly folderId: string | null;
    /** The item's folder name (display when folderId is enforced; exact untrimmed match otherwise) or destination folder (for `create`). */
    readonly folder: string | null;
    /** Optional target origin (`scheme://host[:port]`) for origin-checked requests. */
    readonly origin: string | null;
    /** Whether `origin` matched an `https:` stored URI of the item. */
    readonly originMatch: VaultOriginMatch;
    /** False for `create` or when device policy disables 15-minute windows. */
    readonly allowWindow: boolean;
    /** Device policy name when a policy entry governs this device; null when unrestricted. */
    readonly policyName: string | null;
    /** Policy verdict recorded when the request was admitted (`default` or `allowed`). */
    readonly policyResult: string;
    /** Requester-claimed; shown as such. */
    readonly reason: string | null;
    /** Requester-claimed; shown as such. */
    readonly session: VaultSessionClaim | null;
    readonly createdAt: number;
    readonly expiresAt: number;
    status: VaultRequestStatus;
    decidedAt: number | null;
    /** Approved by a grant rather than a decision. */
    auto: boolean;
    grantId: string | null;
}
export interface VaultGrant {
    readonly id: string;
    readonly device: VaultDevice;
    readonly itemId: string | null;
    readonly item: string;
    readonly fields: readonly VaultField[];
    readonly sessionRef: string | null;
    readonly origin: string | null;
    readonly createdAt: number;
    readonly expiresAt: number;
}
export interface VaultListenerStatus {
    readonly state: 'locked' | 'ready';
    readonly account: string | null;
    readonly devices: readonly VaultDevice[];
    readonly updatedAt: number;
}
export interface VaultOverview {
    readonly listener: (VaultListenerStatus & {
        readonly stale: boolean;
    }) | null;
    readonly pending: readonly VaultRequest[];
    readonly recent: readonly VaultRequest[];
    readonly grants: readonly VaultGrant[];
}
type Failure = {
    readonly ok: false;
    readonly status: 400 | 403 | 404 | 409 | 500;
    readonly error: string;
};
type Result<T> = {
    readonly ok: true;
    readonly value: T;
} | Failure;
export interface VaultApprovalPorts {
    /** Called once when a request becomes pending (never for grant auto-approvals or policy refusals). */
    notify(request: VaultRequest): void;
    now?(): number;
    policyFile?(): string;
    enrolledFile?(): string;
    auditFile?(): string;
    auditMaxBytes?: number;
}
export interface VaultApprovals {
    overview(): VaultOverview;
    reportStatus(body: unknown): Result<VaultListenerStatus>;
    createRequest(body: unknown): Result<VaultRequest>;
    requestStatus(id: string): Result<VaultRequest>;
    abandon(id: string): Result<VaultRequest>;
    decide(id: string, decision: unknown): Result<VaultRequest>;
    revokeGrant(id: string): Result<VaultGrant>;
    audit(query?: VaultAuditQuery): readonly VaultAuditEntry[];
}
/** Unique field names: built-ins in canonical order, then custom fields as requested; null when empty or invalid. */
export declare function decodeFields(value: unknown): VaultField[] | null;
/** Parses a bare `http(s)://host[:port]` origin (no path, query, hash, userinfo, or wildcard authority). */
export declare function parseOrigin(raw: string): {
    readonly origin: string;
    readonly https: boolean;
} | null;
/** Extracts the exact `https:` origin of a stored Bitwarden URI; non-https, any userinfo (including empty `@`), wildcard authorities, or unparseable URIs yield null. */
export declare function httpsOriginOfUri(raw: string): string | null;
/** Exact scheme+host+port (`https` only) match between a parsed request origin and an item's stored URIs. */
export declare function evaluateOriginMatch(origin: {
    readonly origin: string;
    readonly https: boolean;
} | null, itemUris: readonly string[]): VaultOriginMatch;
export type VaultPolicyLoadResult = {
    readonly ok: true;
    readonly missing: boolean;
    readonly policies: ReadonlyMap<string, VaultDevicePolicy>;
} | {
    readonly ok: false;
    readonly error: string;
};
export type VaultEnrolledLoadResult = {
    readonly state: 'ok';
    readonly fingerprints: ReadonlySet<string>;
} | {
    readonly state: 'missing';
} | {
    readonly state: 'error';
    readonly error: string;
};
export type VaultPolicyResolution = {
    readonly state: 'policy';
    readonly policy: VaultDevicePolicy;
} | {
    readonly state: 'legacy';
} | {
    readonly state: 'refused';
    readonly policyResult: 'policy_config_error' | 'policy_missing_enrolled';
    readonly error: string;
};
export declare function loadEnrolledFingerprints(file: string): VaultEnrolledLoadResult;
/**
 * Loads per-device policies from `policies.json`. Policy keys must be 64-char
 * hex fingerprints (32-byte ids), normalized lowercase. On every successful
 * load of an existing policy file, persists the enrolled fingerprint set to
 * `enrolled.json` (0600, atomic).
 */
export declare function loadVaultPolicies(file?: string, enrolledPath?: string | null): VaultPolicyLoadResult;
/**
 * Resolves effective policy authority for one device fingerprint:
 * - Valid `policies.json`: enforces the device's entry (or legacy if unlisted).
 * - Missing or malformed `policies.json`: refuses any fingerprint present in
 *   `enrolled.json` (or already admitted under a policy), while never-enrolled
 *   devices keep the legacy path.
 * - Missing `policies.json` + unreadable `enrolled.json`: logs and falls back to legacy.
 */
export declare function resolveDevicePolicy(fingerprint: string, policyPath?: string, enrolledPath?: string, knownRestricted?: boolean): VaultPolicyResolution;
/** Tail-reads newest-first audit entries within a bounded byte budget (~2 MiB default), stopping once `limit` is reached. */
export declare function readVaultAudit(file?: string, query?: VaultAuditQuery): readonly VaultAuditEntry[];
/** Notification for a pending request; the reason is the agent's claim, so it follows the facts. */
export declare function vaultPushPayload(request: VaultRequest): Omit<PushPayload, 'hostId'>;
export declare function createVaultApprovals(ports: VaultApprovalPorts): VaultApprovals;
type VaultHandler = (req: Request<{
    id: string;
}>, res: Response) => void;
export interface VaultHandlers {
    /** Loopback peer and bridge token, ahead of every bridge route. */
    bridgeGate(req: Request, res: Response, next: NextFunction): void;
    bridgeStatus: VaultHandler;
    bridgeCreate: VaultHandler;
    bridgeGet: VaultHandler;
    bridgeAbandon: VaultHandler;
    overview: VaultHandler;
    audit: VaultHandler;
    decide: VaultHandler;
    revokeGrant: VaultHandler;
}
export declare function createVaultHandlers(vault: VaultApprovals, token?: () => string): VaultHandlers;
export {};
