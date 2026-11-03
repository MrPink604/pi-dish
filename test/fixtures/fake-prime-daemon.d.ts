// Generated test/tool from test/fixtures/fake-prime-daemon.ts; edit that source and run npm run build:tests.
export interface FakePrimeCommand {
    type: string;
    id?: string;
    activeSessionId?: string;
    [key: string]: unknown;
}
export interface FakePrimeDaemon {
    readonly socketPath: string;
    /** Live roster rows returned by `list`; mutate to emulate agents appearing. */
    readonly rows: Record<string, unknown>[];
    /** Every command received, in order. */
    readonly commands: FakePrimeCommand[];
    /** Total accepted connections. */
    readonly connections: number;
    emit(activeSessionId: string, event: Record<string, unknown>): void;
    close(): Promise<void>;
}
export interface FakePrimeDaemonOptions {
    protocolVersion?: number;
    rows?: Record<string, unknown>[];
    attachSnapshot?: Record<string, unknown>;
    sessionTree?: unknown;
    /** Override or fail individual commands; return undefined for the defaults. */
    respond?: (command: FakePrimeCommand) => {
        data?: unknown;
        error?: string;
    } | undefined;
}
/** One root roster row with every field the daemon client reads. */
export declare function primeRow(overrides?: Record<string, unknown>): Record<string, unknown>;
export declare function startFakePrimeDaemon(socketPath: string, options?: FakePrimeDaemonOptions): Promise<FakePrimeDaemon>;
