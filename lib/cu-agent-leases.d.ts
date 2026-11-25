// Generated from src/core/cu-agent-leases.ts; edit that source and run npm run build:core.
import type { CuBrokerClient } from './cu-broker';
export declare const CU_HAND_BACK_NUDGE = "The desktop has been returned to you after human take-over. Inspect the current screen and browser state before continuing.";
export declare const BROKER_AGENT_LABEL = "omp";
export type ManagedLeaseStatus = 'holding' | 'waiting_for_desktop' | 'preempted' | 'idle';
export interface CuSeatBusyDetails {
    readonly state: string | null;
    readonly epoch: number | null;
    readonly holder: Record<string, unknown> | null;
}
/** Structured 409 error raised when another agent already holds the CU seat. */
export declare class CuSeatBusyError extends Error {
    readonly status = 409;
    readonly code: 'seat_busy';
    readonly state: string | null;
    readonly epoch: number | null;
    readonly holder: Record<string, unknown> | null;
    constructor(message: string, details: CuSeatBusyDetails);
}
/** Structured 503 error raised when a CU host's configured broker socket is unreachable. */
export declare class CuBrokerUnavailableError extends Error {
    readonly status = 503;
    readonly code: 'cu_broker_unavailable';
    constructor(message?: string);
}
export interface CuBrokerEvent {
    readonly eventName: string;
    readonly eventId?: string | null;
    readonly authoritativeHello: boolean;
    readonly isResync?: boolean;
    readonly resyncReason?: string | null;
    readonly generation?: string | null;
    readonly cursor?: number | null;
    readonly generationChanged?: boolean;
    readonly payload: Record<string, unknown>;
}
export interface CuAgentSpawnHandle {
    readonly brokerSessionId: string;
    readonly leaseOwnerId: string | null;
    readonly env: Readonly<Record<string, string>>;
    readonly waitingForDesktop: boolean;
    readonly reusedExisting: boolean;
    readonly acquiredEpoch: number | null;
}
export interface CuBindProcessInfo {
    readonly pid: number;
    readonly startTime: string;
}
export interface CuAttachSessionInfo {
    readonly sessionId: string;
    readonly pid: number | null;
    readonly pidStartTime: string | null;
}
export interface CuCommandTarget {
    readonly sessionId: string;
    readonly leaseOwnerId: string;
    readonly generation: string;
    readonly epoch: number;
    readonly pid: number | null;
    readonly pidStartTime: string | null;
    /** Synchronous recheck run immediately before dispatching abort/prompt on the bridge. */
    readonly isStillValid: () => boolean;
}
export interface PersistedCuLeaseRecord {
    readonly leaseOwnerId: string;
    readonly brokerSessionId: string;
    readonly leaseId: string | null;
    readonly epoch: number;
    readonly generation: string | null;
    readonly pid: number | null;
    readonly pidStartTime: string | null;
    readonly createdAt: number;
}
export interface CuAgentLeasesPorts {
    readonly broker: CuBrokerClient;
    /** Must return true ONLY when abort was verified and acknowledged by the target process. */
    abortSession(target: CuCommandTarget): Promise<boolean>;
    /** Must return true ONLY when hand-back nudge was verified and acknowledged by the target process. */
    resumeSession(target: CuCommandTarget, nudgeText: string): Promise<boolean>;
    /** Maps a surviving OS process birth back to its live canonical pi-dish route sessionId. */
    findSessionIdByProcess?(process: {
        readonly pid: number;
        readonly startTime: string;
    }): string | null;
    /** Optional test seam overriding the durable non-secret store path. */
    storeFile?: () => string;
    /** Optional test seam overriding agent heartbeat interval in milliseconds. */
    heartbeatIntervalMs?: number;
    /** Optional test seam overriding dead-PID liveness check interval in milliseconds. */
    livenessCheckMs?: number;
    /** Optional test seam overriding command retry delay in milliseconds. */
    commandRetryMs?: number;
    /** Optional test seam overriding OS process liveness verification. */
    processAlive?: (identity: {
        readonly pid: number;
        readonly startTime: string;
    }) => boolean;
    log?: (message: string) => void;
}
export interface CuAgentLeases {
    configured(): boolean;
    available(): boolean;
    reconcile(): Promise<void>;
    prepareSpawn(options: {
        knownSessionId?: string | null;
        isRestart?: boolean;
    }): Promise<CuAgentSpawnHandle | null>;
    bindSpawnedProcess(handle: CuAgentSpawnHandle, process: CuBindProcessInfo | null): Promise<void>;
    attachSpawnedSession(handle: CuAgentSpawnHandle, info: CuAttachSessionInfo): void;
    abortSpawn(handle: CuAgentSpawnHandle): Promise<void>;
    releaseSession(sessionId: string): Promise<void>;
    handleSessionRetired(sessionId: string): void;
    adoptSessionSwitch(previousSessionId: string, nextSessionId: string): void;
    handleBrokerEvent(event: CuBrokerEvent): void;
    ownerIdForSession(sessionId: string): string | null;
    isWaitingForDesktop(sessionId: string): boolean;
    getSessionSeatState(sessionId: string): 'waiting_for_desktop' | null;
    stop(): void;
}
export declare function createCuAgentLeases(ports: CuAgentLeasesPorts): CuAgentLeases;
