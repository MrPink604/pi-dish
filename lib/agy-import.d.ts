// Generated from src/core/agy-import.ts; edit that source and run npm run build:core.
/** Default automatic import cadence: every 15 minutes, shortly after start. */
export declare const AGY_IMPORT_DEFAULT_MS: number;
export declare const AGY_IMPORT_INTERVAL_ENV = "PI_DISH_AGY_IMPORT_INTERVAL_MS";
export declare const AGY_IMPORT_INTERVAL_SETTING = "agyImportIntervalMinutes";
/** Interval in ms; `0` disables the automatic runs. Env wins over the setting. */
export declare function agyImportIntervalMs(settings?: Record<string, unknown>): number;
export interface AgyImportEntry {
    sessionId: string;
    cwd: string | null;
    title: string | null;
    file: string;
    backup: string | null;
}
export interface AgyImportFailure {
    sessionId: string | null;
    error: string;
}
export interface AgyImportOutcome {
    reason: string;
    status: 'completed' | 'skipped' | 'failed';
    skipped?: 'not-installed' | 'already-running';
    imported: AgyImportEntry[];
    live: string[];
    upToDate: number;
    errors: AgyImportFailure[];
    startedAt: number;
    finishedAt: number | null;
}
export interface AgyImportPorts {
    readSettings?: () => Record<string, unknown>;
    isLive?: (sessionId: string) => boolean;
    isInstalled?: () => boolean;
    log?: (line: string) => void;
}
export interface AgyImportRuntime {
    start(): void;
    stop(): void;
    run(reason?: string): Promise<AgyImportOutcome>;
}
export declare function createAgyImportRuntime(ports?: AgyImportPorts): AgyImportRuntime;
