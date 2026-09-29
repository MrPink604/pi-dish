/** Leaf-first ancestry, retaining each visited id once even for malformed cycles. */
export function collectActivePath(
  leafId: string | null, parentOf: (id: string) => string | null | undefined,
): Set<string> {
  const path = new Set<string>();
  let current = leafId;
  while (current && !path.has(current)) {
    path.add(current);
    current = parentOf(current) || null;
  }
  return path;
}

/** Preorder display depth increases only below a branch, not every parent. */
export function walkBranchTree<Node>(
  roots: readonly Node[], visit: (node: Node, depth: number) => readonly Node[],
): void {
  function walk(nodes: readonly Node[], depth: number): void {
    for (const node of nodes) {
      // Projection and acquisition-specific guards remain with the caller.
      const children = visit(node, depth);
      if (children.length) walk(children, children.length > 1 ? depth + 1 : depth);
    }
  }
  walk(roots, 0);
}
