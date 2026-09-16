// Generated from src/core/session-refs.ts; edit that source and run npm run build:core.
export interface SessionRefSummary {
    readonly name?: string | null;
    readonly cwd?: string | null;
    readonly isActive?: boolean;
}
export interface SessionRefDependencies {
    readonly selfHostId: string;
    resolveLocal(id: string, exactOnly: boolean): Readonly<SessionRefSummary> | null;
    fleetNames(): readonly string[];
}
export interface SessionRefHint {
    ref: string;
    name: string;
    host: string;
    cwd: string;
    isActive: boolean | null;
}
/** Hints are untrusted metadata, clamped to the fields the context block uses. */
export declare function sanitizeRefHint(hint: unknown): SessionRefHint | null;
export declare function expandSessionRefs(message: unknown, hints: unknown, deps: SessionRefDependencies): string;
