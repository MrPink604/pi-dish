// Generated from src/core/prime-lifecycle.ts; edit that source and run npm run build:core.
/** Routing observation of one exact live worker, not reusable stop authority. */
export interface PrimeWorkerTarget {
    socket: string;
    activeSessionId: string;
}
export interface PrimeStopError extends Error {
    /** Dispatch started; a lost reply remains indeterminate and must not relaunch. */
    stopRequested: boolean;
}
export declare function primeWorkerTarget(entry: unknown): PrimeWorkerTarget | null;
export declare function stopPrimeWorker(entry: unknown, beforeStop: () => void | Promise<void>, { timeout }?: {
    timeout?: number | undefined;
}): Promise<void>;
