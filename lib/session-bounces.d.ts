// Generated from src/core/session-bounces.ts; edit that source and run npm run build:core.
import type { LiveSession, SessionOwnership } from './session-ownership';
import type { SessionOperations } from './session-operations';
export type SessionBounceMode = 'reload' | 'restart';
export type SessionBounceStatus = 'waiting' | 'executing' | 'completed' | 'skipped' | 'failed' | 'cancelled';
/** Catalog observations carry presentation and conflict data, never permission to act. */
export interface SessionBounceCatalogRow {
    id: string;
    name?: unknown;
    harnessId?: unknown;
    conflicted?: unknown;
}
export interface SessionBouncePreviewTarget {
    sessionId: string;
    name: unknown;
    harnessId: unknown;
    eligible: boolean;
    reason: string | null;
    blockers: string[];
}
export interface SessionBounceTarget {
    sessionId: string;
    name: unknown;
    harnessId: unknown;
    status: SessionBounceStatus;
    reason: string | null;
    replacementId?: string;
}
export interface SessionBounceReport {
    id: string;
    mode: SessionBounceMode;
    createdAt: string;
    targets: SessionBounceTarget[];
}
/** Transient inspection context goes only to execute, never to preview or report DTOs. */
export interface SessionBounceInspection<Runtime = unknown> {
    eligible: boolean;
    reason?: string;
    blockers?: string[];
    live?: Runtime;
}
export type SessionBounceExecutionResult = {
    waiting: true;
    reason?: string;
} | {
    skipped: true;
    reason?: string;
} | {
    replacementId?: string;
} | void;
export interface SessionBounceBounds {
    intervalMs?: number;
    maxOperations?: number;
    maxTargets?: number;
}
/** Isolated queue seam; production policy is implemented by createSessionBounceRuntime. */
export interface SessionBounceQueueOptions<Authority extends object, Runtime = unknown> extends SessionBounceBounds {
    catalog(): readonly SessionBounceCatalogRow[];
    capture(row: SessionBounceCatalogRow): Authority | null;
    inspect(authority: Authority, mode: SessionBounceMode): SessionBounceInspection<Runtime> | Promise<SessionBounceInspection<Runtime>>;
    execute(authority: Authority, mode: SessionBounceMode, inspected: SessionBounceInspection<Runtime>): SessionBounceExecutionResult | Promise<SessionBounceExecutionResult>;
}
export interface SessionBounces {
    preview(mode: SessionBounceMode): Promise<SessionBouncePreviewTarget[]>;
    enqueue(mode: unknown, sessionIds: unknown): SessionBounceReport;
    list(): Promise<SessionBounceReport[]>;
    cancel(id: string): SessionBounceReport | null;
    start(): void;
    stop(): void;
    tick(): Promise<void>;
}
export interface SessionBounceRuntimeOptions extends SessionBounceBounds {
    operations: SessionOperations;
    ownership: SessionOwnership;
    /** Raw catalog data only; capture, inspection, and execution belong to this module. */
    catalog(): unknown;
}
export declare function createSessionBounces<Authority extends object, Runtime = unknown>({ catalog, capture, inspect, execute, intervalMs, maxOperations, maxTargets, }: SessionBounceQueueOptions<Authority, Runtime>): SessionBounces;
export declare function lifecycleBlockers(state: unknown, live: LiveSession | null | undefined): string[];
/** Checked production policy composes the same process-local queue used in isolation. */
export declare function createSessionBounceRuntime({ operations, ownership, catalog, ...bounds }: SessionBounceRuntimeOptions): SessionBounces;
