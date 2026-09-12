// Generated from src/core/session-metadata.ts; edit that source and run npm run build:core.
import type { SessionEntries, SessionInfo } from './session-metadata-contracts';
interface MetadataProfile {
    readonly profileId?: string;
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** Validate persisted accumulator output, reviving its serialized activity Date. */
export declare function decodeSessionInfo(value: unknown): SessionInfo | null;
export declare function sessionInfoFromEntries(entries: SessionEntries, mtime?: Date, candidate?: MetadataProfile): SessionInfo;
/**
 * Extend an info object with entries appended after the range it was built
 * from — the O(delta) path lib/session-index.js uses for a streaming active
 * session, so a sidebar poll never re-parses a whole multi-MB JSONL because
 * one turn was appended. Mutates and returns `info`; `mtime` is the file's
 * new mtime (a full parse floors lastActivity at the mtime, so the extension
 * must too).
 */
export declare function extendSessionInfoFromEntries(info: SessionInfo, entries: SessionEntries, mtime?: Date, candidate?: MetadataProfile): SessionInfo;
export {};
