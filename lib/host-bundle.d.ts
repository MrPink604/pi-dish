// Generated from src/core/host-bundle.ts; edit that source and run npm run build:core.
export interface HostBundle {
    dir: string;
    hash: string;
}
/** sha256 over sorted relative paths and contents: names the tree, not its mtimes. */
export declare function hashTree(dir: string): string;
/** The host tree for `root` (default: this checkout), built at most once per process and dish dir. */
export declare function hostBundle(root?: string): Promise<HostBundle>;
