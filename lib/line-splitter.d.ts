// Generated from src/core/line-splitter.ts; edit that source and run npm run build:core.
import { type ProtocolRecord } from './wire-protocol';
type Chunk = string | Buffer | Uint8Array;
declare function createLineSplitter(onLine: (line: string) => void): (chunk: Chunk) => void;
/** Line splitter for JSONL transports: non-JSON output is not a frame. */
declare function createJsonLineSplitter(onMessage: (message: ProtocolRecord) => void): (chunk: Chunk) => void;
declare const _default: {
    createLineSplitter: typeof createLineSplitter;
    createJsonLineSplitter: typeof createJsonLineSplitter;
};
export = _default;
