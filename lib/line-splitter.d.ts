// Generated from src/core/line-splitter.ts; edit that source and run npm run build:core.
/** Returns a feed(chunk) function that calls onLine per complete line. */
declare function createLineSplitter(onLine: (line: string) => void): (chunk: string | Buffer | Uint8Array) => void;
declare const _default: {
    createLineSplitter: typeof createLineSplitter;
};
export = _default;
