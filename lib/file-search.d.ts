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
/**
 * Fuzzy-search files under basePath. Returns [{ path, gitStatus }] with
 * paths relative to basePath. Empty query returns the index's
 * frecency/recency ordering — a useful "recent files" list.
 */
export declare function searchFiles(basePath: string | null | undefined, query: string | null | undefined, limit?: number): Promise<FileSearchResult[]>;
/**
 * Fuzzy-search directories under $HOME for the new-session cwd picker.
 * Returns [{ path, short }] best-first; `short` is the ~-relative form the
 * match was scored against.
 */
export declare function searchHomeDirs(query: string | null | undefined, limit?: number): HomeDirSearchResult[];
/**
 * List the immediate subdirectories of `inputPath` for the new-session cwd
 * tree. Expands a leading `~`, then requires an absolute path (throws a
 * badRequest error otherwise — the route turns it into a 400). Directories
 * only, dotdirs and SKIP_DIRS excluded, locale-sorted, capped at 500. An
 * unreadable/nonexistent dir degrades to `{ path, dirs: [], error }` (200) so
 * the tree never blanks.
 */
export declare function getDirChildren(inputPath: unknown): DirChildrenResult;
/** Does this @-mention token name a filesystem location rather than a
 *  cwd-relative fuzzy query? Matches /abs, ~ , ~/x, ./x, ../x. */
export declare function isPathCompletionToken(token: string): boolean;
/**
 * Complete one path segment, shell-style. The directory part of the token is
 * kept verbatim in the results (so accepting a suggestion preserves the form
 * the user typed — ~/x stays ~-relative, /x stays absolute); only the partial
 * basename after the last slash is matched. Directories come back with
 * isDir:true so the client can drill into them. Dotfiles are hidden unless
 * the partial itself starts with a dot.
 */
export declare function completePath(token: string, { cwd, limit }?: PathCompletionOptions): PathCompletionResult[];
/** Test hook: drop caches so temp-HOME fixtures are re-read. */
export declare function resetCaches(): void;
