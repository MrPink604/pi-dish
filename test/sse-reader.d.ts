// Generated test/tool from test/sse-reader.ts; edit that source and run npm run build:tests.
/**
 * Minimal SSE client for tests: collects parsed events, lets tests await one
 * matching a predicate. close() aborts the fetch (the server sees the
 * connection drop). Not a test file — shared by the *.test.js suites.
 */
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
