// Generated from src/core/session-index.ts; edit that source and run npm run build:core.
import type { SessionSource } from './session-source-contracts';
import type { SessionInfo } from './session-metadata-contracts';
import type { IndexedUsage, SkillActivation } from './session-index-data';
export interface IndexedSessionInfo extends SessionInfo {
    sessionKey: SessionSource['sessionKey'];
    harnessId: SessionSource['harnessId'];
    nativeSessionId: SessionSource['nativeSessionId'];
    profileId: string;
    profileVersion: number;
    usage: IndexedUsage;
}
export declare function setSkillRoots(skillFilePaths: readonly string[] | null | undefined): void;
/**
 * The scan behind the historical session list. `files` is the full
 * enumeration of session JSONLs to serve; returns
 * `{ infos: Map(file -> info), indexing }` where a file missing from `infos`
 * is still queued for background indexing (indexing === true exactly when
 * that backlog is non-empty). Index entries for files no longer in `files`
 * and gone from disk are tombstoned.
 */
export declare function scanSessions(files: readonly SessionSource[]): {
    infos: ReadonlyMap<string, Readonly<IndexedSessionInfo>>;
    indexing: boolean;
};
/**
 * Search text for one session file. Fresh from the index when possible. A
 * file that only *grew* (a streaming session appends a line every delta) is
 * extended by extracting just the appended byte range — a search keystroke
 * against an active session must not re-read its whole multi-MB JSONL. The
 * extension stays in memory only (not logged): active files churn far too
 * fast to persist per delta, and a restart simply re-parses them once.
 * Anything else (shrunk, rewritten, never seen) is fully re-indexed.
 * '' when the file is unreadable.
 */
export declare function getSearchText(input: SessionSource): string;
/**
 * Index-backed single-file session info, returning exactly the shape
 * session-files' getSessionInfo returns. Serves fresh entries from memory,
 * extends append-only growth in O(delta), and fully (re-)indexes anything
 * else — so the per-poll metadata reads for an active session stop
 * re-parsing its whole streaming JSONL on every append. Throws when the
 * file is unreadable, like session-files.getSessionInfo.
 */
export declare function getSessionInfo(input: SessionSource): SessionInfo;
/**
 * All mined skill-activation records across every indexed session, flattened
 * and filtered. Reads only the in-memory index (loaded from skills.ndjson) —
 * never re-parses the JSONL corpus. `filter` accepts:
 *   { skill, sinceMs, cwd, kind } — skill is the absolute SKILL.md path.
 * Records for files not yet indexed (backlog) are simply absent; callers that
 * care report the index's `indexing` flag from scanSessions.
 */
export declare function getSkillActivations(filter?: {
    skill?: string;
    sinceMs?: number;
    cwd?: string;
    kind?: string;
}): SkillActivation[];
/** Test hook: flush pending appends and forget in-memory state. */
export declare function resetForTests(): void;
