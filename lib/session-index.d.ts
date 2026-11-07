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
 * Files missing from `infos` are queued for background indexing, so `indexing`
 * means "a backlog remains". Entries for files gone from disk are tombstoned.
 */
export declare function scanSessions(files: readonly SessionSource[]): {
    infos: ReadonlyMap<string, Readonly<IndexedSessionInfo>>;
    indexing: boolean;
};
/** '' when the file is unreadable. */
export declare function getSearchText(input: SessionSource): string;
/** Throws when the file is unreadable. */
export declare function getSessionInfo(input: SessionSource): SessionInfo;
/**
 * Filtered skill-activation records from the in-memory index only; files
 * still in the backlog are absent.
 */
export declare function getSkillActivations(filter?: {
    skill?: string;
    sinceMs?: number;
    cwd?: string;
    kind?: string;
}): SkillActivation[];
/** Test hook: flush pending appends and forget in-memory state. */
export declare function resetForTests(): void;
