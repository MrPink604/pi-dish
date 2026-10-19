// Generated from src/core/vault-approvals.ts; edit that source and run npm run build:core.
import type { NextFunction, Request, Response } from 'express';
import type { PushPayload } from './push-notifications';
export declare const VAULT_FIELDS: readonly ['username', 'password', 'totp', 'uri', 'notes'];
export type VaultField = typeof VAULT_FIELDS[number];
export declare const BRIDGE_HEADER = "x-pi-dish-vault-bridge";
export declare const GRANT_WINDOW_MS: number;
export declare const LISTENER_STALE_MS: number;
export declare const MAX_REQUEST_LIFETIME_MS: number;
export declare const RECENT_LIMIT = 20;
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
export interface VaultRequest {
    readonly id: string;
    readonly device: VaultDevice;
    readonly item: string;
    readonly fields: readonly VaultField[];
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
    readonly item: string;
    readonly fields: readonly VaultField[];
    readonly sessionRef: string | null;
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
    readonly status: 400 | 404 | 409;
    readonly error: string;
};
type Result<T> = {
    readonly ok: true;
    readonly value: T;
} | Failure;
export interface VaultApprovalPorts {
    /** Called once when a request becomes pending (never for grant auto-approvals). */
    notify(request: VaultRequest): void;
    now?(): number;
}
export interface VaultApprovals {
    overview(): VaultOverview;
    reportStatus(body: unknown): Result<VaultListenerStatus>;
    createRequest(body: unknown): Result<VaultRequest>;
    requestStatus(id: string): Result<VaultRequest>;
    abandon(id: string): Result<VaultRequest>;
    decide(id: string, decision: unknown): Result<VaultRequest>;
    revokeGrant(id: string): Result<VaultGrant>;
}
/** Unique, known field names in canonical order; null when empty or invalid. */
export declare function decodeFields(value: unknown): VaultField[] | null;
/** Notification for a pending request; the reason is the agent's claim, so it follows the facts. */
export declare function vaultPushPayload(request: VaultRequest): Omit<PushPayload, 'hostId'>;
export declare function createVaultApprovals(ports: VaultApprovalPorts): VaultApprovals;
/** The listener's bridge credential, created 0600 on first use (exclusive, so racing first uses agree). */
export declare function readBridgeToken(): string;
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
    decide: VaultHandler;
    revokeGrant: VaultHandler;
}
export declare function createVaultHandlers(vault: VaultApprovals, token?: () => string): VaultHandlers;
export {};
