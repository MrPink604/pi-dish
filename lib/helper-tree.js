// Generated from src/core/helper-tree.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectActivePath = collectActivePath;
exports.walkBranchTree = walkBranchTree;
/** Leaf-first ancestry, retaining each visited id once even for malformed cycles. */
function collectActivePath(leafId, parentOf) {
    const path = new Set();
    let current = leafId;
    while (current && !path.has(current)) {
        path.add(current);
        current = parentOf(current) || null;
    }
    return path;
}
/** Preorder display depth increases only below a branch, not every parent. */
function walkBranchTree(roots, visit) {
    function walk(nodes, depth) {
        for (const node of nodes) {
            // Projection and acquisition-specific guards remain with the caller.
            const children = visit(node, depth);
            if (children.length)
                walk(children, children.length > 1 ? depth + 1 : depth);
        }
    }
    walk(roots, 0);
}
