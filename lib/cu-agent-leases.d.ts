// Generated from src/core/cu-agent-leases.ts; edit that source and run npm run build:core.
import type { CuBrokerClient } from './cu-broker';
export declare const CU_HAND_BACK_NUDGE = "The desktop has been returned to you after human take-over. Inspect the current screen and browser state before continuing.";
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
export interface CuBrokerEvent {
    readonly eventName: string;
    readonly authoritativeHello: boolean;
    readonly payload: Record<string, unknown>;
}
export interface CuAgentSpawnHandle {
    readonly brokerSessionId: string;
    readonly env: Readonly<Record<string, string>>;
    readonly waitingForDesktop: boolean;
    readonly reusedExisting: boolean;
    readonly acquiredEpoch: number | null;
}
export interface CuBindSpawnedSession {
    readonly sessionId: string;
    readonly pid: number | null;
    readonly pidStartTime: string | null;
}
export interface CuAgentLeasesPorts {
    readonly broker: CuBrokerClient;
    abortSession(sessionId: string): Promise<void>;
    resumeSession(sessionId: string, nudgeText: string): Promise<void>;
    /** Optional check for post-restart fallback matching on live managed OMP sessions. */
    isLiveManagedSession?(sessionId: string): boolean;
    /** Emits a normalized snapshot to connected `/api/cu/stream` clients after post-spawn label binding. */
    onLabelBound?(snapshot: Record<string, unknown>): void;
    /** Optional test seam overriding agent heartbeat interval in milliseconds. */
    heartbeatIntervalMs?: number;
    /** Optional test seam overriding dead-PID liveness check interval in milliseconds. */
    livenessCheckMs?: number;
    log?: (message: string) => void;
}
export interface CuAgentLeases {
    available(): boolean;
    prepareSpawn(options: {
        knownSessionId?: string | null;
        isRestart?: boolean;
    }): Promise<CuAgentSpawnHandle | null>;
    bindSpawnedSession(handle: CuAgentSpawnHandle, info: CuBindSpawnedSession): Promise<void>;
    abortSpawn(handle: CuAgentSpawnHandle): Promise<void>;
    releaseSession(sessionId: string): Promise<void>;
    handleSessionRetired(sessionId: string): void;
    adoptSessionSwitch(previousSessionId: string, nextSessionId: string): void;
    handleBrokerEvent(event: CuBrokerEvent): void;
    normalizePublicPayload<T>(payload: T): T;
    isWaitingForDesktop(sessionId: string): boolean;
    getSessionSeatState(sessionId: string): 'waiting_for_desktop' | null;
    stop(): void;
}
export declare function createCuAgentLeases(ports: CuAgentLeasesPorts): CuAgentLeases;
