// Generated from src/core/session-provenance.ts; edit that source and run npm run build:core.
import type { SessionId } from './contracts';
export interface LaunchProvenance {
    sourceSessionId: SessionId;
    operationId: string | null;
    createdAt: number;
}
export declare function validId(value: unknown): value is string;
export declare function readLaunches(): Record<string, LaunchProvenance>;
/** Record advisory launch provenance. It never grants authority. */
export declare function recordLaunch(sessionId: unknown, sourceSessionId: unknown, operationId?: unknown): LaunchProvenance;
export declare function getLaunch(sessionId: unknown): LaunchProvenance | null;
export declare function getLaunchesFrom(sourceSessionId: unknown): Array<LaunchProvenance & {
    sessionId: string;
}>;
export declare function resetForTests(): void;
