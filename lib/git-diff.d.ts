// Generated from src/core/git-diff.ts; edit that source and run npm run build:core.
export interface GitRepoDiscoveryOptions {
    maxDepth?: number;
    maxRepos?: number;
}
export interface GitDiffOptions {
    inlineLimit?: number | null;
}
export interface GitStatusChange {
    status: string | undefined;
    oldPath: string | null | undefined;
}
export interface GitStatusV2 {
    branch: string | null;
    oid: string | null;
    ahead: number;
    behind: number;
    changed: Map<string, GitStatusChange>;
    untracked: string[];
}
interface GitFileCounts {
    path: string;
    oldPath: string | null | undefined;
    additions: number;
    deletions: number;
    binary: boolean;
}
export interface GitNumstatFile extends GitFileCounts {
    oldPath: string | null;
}
/** A materialized patch; tracked patches omit status, untracked patches carry '?'. */
export interface GitFilePatch extends GitNumstatFile {
    patch: string | null;
    truncated: boolean;
    status?: '?';
}
/** Deferred entries omit patch; binary/oversized materialized stubs carry null. */
export interface GitDiffFile extends GitFileCounts {
    status: string | undefined;
    truncated: boolean;
    patch?: string | null;
    patchDeferred?: boolean;
}
export interface GitRepoDiff {
    branch: string | null;
    ahead: number;
    behind: number;
    files: GitDiffFile[];
    additions: number;
    deletions: number;
    error?: string;
    moreUntracked?: number;
}
export interface GitDiffRepo extends GitRepoDiff {
    path: string;
}
export type GitDiffAggregate = {
    root: string;
    gitAvailable: false;
    repos: [];
    version: null;
} | {
    root: string;
    gitAvailable: true;
    repos: GitDiffRepo[];
    version: string;
};
export declare function isGitAvailable(): boolean;
/**
 * Find git repos under `root` (including root itself): any directory holding
 * a `.git` entry — dir or file, so worktrees count. Found repos are not
 * descended into (submodules show as pointer changes in the parent). BFS,
 * bounded depth and dir count; symlinked dirs are skipped (no cycles).
 */
export declare function findGitRepos(root: string, { maxDepth, maxRepos }?: GitRepoDiscoveryOptions): string[];
export declare function parseStatusV2(out: string): GitStatusV2;
/**
 * Split one `git diff` output into per-file entries with counts. Content
 * lines can't collide with the "diff --git " sentinel — they always start
 * with ' ', '+', '-', or '\'. Returns [{ path, oldPath, additions,
 * deletions, binary, patch }]; `path` is the post-change side (the pre-change
 * side for deletions).
 */
export declare function splitPatch(patchText: unknown): GitFilePatch[];
export declare function parseNumstat(out: unknown): GitNumstatFile[];
export declare function getRepoDiff(repoPath: string): Promise<GitRepoDiff>;
/**
 * The full aggregate for the diff modal: every repo under `root` with its
 * uncommitted changes. Repo paths are root-relative ('.' for root itself);
 * dirty repos sort before clean ones, then by path.
 */
export declare function aggregateDiffs(root: string, { inlineLimit }?: GitDiffOptions): Promise<GitDiffAggregate>;
export interface DiffViewSummary {
    root: unknown;
    gitAvailable: boolean;
    repos: GitDiffRepo[];
    snapshotId: string;
}
export interface DiffViewPatch {
    patch: string;
    truncated: boolean;
    binary: boolean;
}
export interface DiffView {
    summary(sessionId: string, cwd: unknown): Promise<DiffViewSummary>;
    patch(sessionId: string, cwd: unknown, snapshotId: string, repoPath: string, filePath: string): Promise<DiffViewPatch | 'stale' | null>;
    retireSession(sessionId: string): void;
}
/** Owns the captured diff pane and every operation allowed to use its members. */
export declare function createDiffView(): DiffView;
export {};
