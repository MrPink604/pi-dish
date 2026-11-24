// Generated from src/core/session-delete.ts; edit that source and run npm run build:core.
import type { SessionSource } from './session-source';
export interface SessionDeletePorts {
    findSessionSource(sessionId: string, options: {
        exact: boolean;
    }): SessionSource | null;
    /** Live rows (bridge, RPC, Prime roster) with the transcript each one claims. */
    activeSessions(): readonly {
        readonly id: string;
        readonly sessionFile: string | null;
    }[];
}
/**
 * Permanently removes a closed session's JSONL and, for nested-subsession
 * harnesses (OMP), the sibling `<stem>/` subagent directory. The exact route
 * must resolve to a regular `.jsonl` inside one of the harness's own session
 * roots, and no live session may claim the file or anything in its subtree.
 */
export declare function createSessionDelete(ports: SessionDeletePorts): (sessionId: string) => {
    deleted: string[];
    sessionIds: string[];
};
