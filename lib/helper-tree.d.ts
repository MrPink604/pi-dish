// Generated from src/core/helper-tree.ts; edit that source and run npm run build:core.
/** Leaf-first ancestry, retaining each visited id once even for malformed cycles. */
export declare function collectActivePath(leafId: string | null, parentOf: (id: string) => string | null | undefined): Set<string>;
/** Preorder display depth increases only below a branch, not every parent. */
export declare function walkBranchTree<Node>(roots: readonly Node[], visit: (node: Node, depth: number) => readonly Node[]): void;
