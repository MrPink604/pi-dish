// Generated test/tool from test/sse-reader.ts; edit that source and run npm run build:tests.
/** Minimal SSE client for tests; close() aborts the fetch. */
export interface TestSseEvent {
    event: string | null;
    data: unknown;
}
declare function sseReader(url: string): {
    events: TestSseEvent[];
    waitFor: (pred: (event: TestSseEvent) => boolean, timeout?: number) => Promise<TestSseEvent>;
    close: () => void;
};
export { sseReader };
