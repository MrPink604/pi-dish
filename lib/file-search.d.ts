// Generated from src/core/file-search.ts; edit that source and run npm run build:core.
import type { FileItem } from '@ff-labs/fff-node' with { 'resolution-mode': 'import' };
export interface FileSearchResult {
    path: string;
    gitStatus: FileItem['gitStatus'] | null;
}
export interface HomeDirSearchResult {
    path: string;
    short: string;
    score?: number;
}
export interface DirChild {
    name: string;
    path: string;
}
export interface DirChildrenResult {
    path: string;
    dirs: DirChild[];
    error?: string;
}
export interface PathCompletionResult {
    path: string;
    isDir: boolean;
    gitStatus: null;
}
export interface PathCompletionOptions {
    cwd?: string | null;
    limit?: number;
}
/** Paths relative to basePath. An empty query returns frecency order ("recent files"). */
export declare function searchFiles(basePath: string | null | undefined, query: string | null | undefined, limit?: number): Promise<FileSearchResult[]>;
/** Best-first; `short` is the ~-relative form the match was scored against. */
export declare function searchHomeDirs(query: string | null | undefined, limit?: number): HomeDirSearchResult[];
/**
 * Subdirectories for the new-session cwd tree. Non-absolute paths throw
 * badRequest (400); an unreadable dir degrades to `{ path, dirs: [], error }`
 * so the tree never blanks.
 */
export declare function getDirChildren(inputPath: unknown): DirChildrenResult;
/** A filesystem location rather than a cwd-relative fuzzy query: /abs, ~, ~/x, ./x, ../x. */
export declare function isPathCompletionToken(token: string): boolean;
/**
 * Shell-style completion of the partial basename after the last slash. The
 * typed directory part is kept verbatim (~/x stays ~-relative). Dotfiles are
 * hidden unless the partial starts with a dot.
 */
export declare function completePath(token: string, { cwd, limit }?: PathCompletionOptions): PathCompletionResult[];
