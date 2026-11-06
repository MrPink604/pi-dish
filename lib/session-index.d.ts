// Generated from src/core/session-index.ts; edit that source and run npm run build:core.
import type { SessionSource } from './session-source';
import type { SessionInfo } from './session-metadata';
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
 * The scan behind the historical session list. A file missing from `infos`
 * is queued for background indexing, so `indexing` is exactly "a backlog
 * remains". Entries for files gone from disk are tombstoned.
 */
export declare function scanSessions(files: readonly SessionSource[]): {
    infos: ReadonlyMap<string, Readonly<IndexedSessionInfo>>;
    indexing: boolean;
};
/**
 * Search text for one session file: fresh from the index, extended in
 * O(delta) when the file only grew, fully re-indexed otherwise. '' when the
 * file is unreadable.
 */
export declare function getSearchText(input: SessionSource): string;
/**
 * Index-backed single-file session info with session-files' shape. Serves
 * fresh entries, extends append-only growth in O(delta), fully re-indexes
 * anything else, and throws when the file is unreadable.
 */
export declare function getSessionInfo(input: SessionSource): SessionInfo;
/**
 * Mined skill-activation records across every indexed session, filtered by
 * absolute SKILL.md path, kind, cwd or time. Reads only the in-memory index;
 * files still in the backlog are simply absent.
 */
export declare function getSkillActivations(filter?: {
    skill?: string;
    sinceMs?: number;
    cwd?: string;
    kind?: string;
}): SkillActivation[];
/** Test hook: flush pending appends and forget in-memory state. */
export declare function resetForTests(): void;
