import { record, finite } from '../core/helper-values';
export interface TranscriptTreeTool { readonly id: string; readonly name: string; readonly args: string }
export interface TranscriptTreeNode {
  readonly id: string; readonly parentId: string | null; readonly type: string; readonly role: string; readonly isLeaf: boolean; readonly time: number;
  readonly text: string; readonly label: string; readonly toolName: string; readonly toolCallId: string; readonly modelId: string; readonly summary: string;
  readonly stopReason: string; readonly errorMessage: string; readonly isError: boolean; readonly tokensBefore: number; readonly toolCalls: readonly TranscriptTreeTool[];
}
export interface TranscriptTree { readonly nodes: readonly TranscriptTreeNode[]; readonly activePathIds: readonly string[]; readonly leafId: string | null }
const text = (value: unknown) => typeof value === 'string' ? value : '';
const count = (value: unknown) => finite(value) ? Math.max(0, Math.floor(value)) : 0;
function millis(value: unknown): number {
  const ms = typeof value === 'string' ? Date.parse(value) : finite(value) ? value : NaN;
  return Number.isFinite(ms) ? ms : 0;
}
export function decodeTranscriptTree(value: unknown): TranscriptTree {
  if (!record(value) || !Array.isArray(value.nodes)) throw new Error('Invalid session tree');
  return { leafId: typeof value.leafId === 'string' ? value.leafId : null,
    activePathIds: Array.isArray(value.activePathIds) ? value.activePathIds.filter((id): id is string => typeof id === 'string') : [],
    nodes: value.nodes.flatMap((node: unknown) => {
      if (!record(node) || typeof node.id !== 'string' || !node.id) return [];
      return [{ id: node.id, parentId: typeof node.parentId === 'string' ? node.parentId : null, type: text(node.type), role: text(node.role), isLeaf: node.isLeaf === true, time: millis(node.timestamp),
        text: text(node.text), label: text(node.label), toolName: text(node.toolName), toolCallId: text(node.toolCallId), modelId: text(node.modelId), summary: text(node.summary),
        stopReason: text(node.stopReason), errorMessage: text(node.errorMessage), isError: node.isError === true, tokensBefore: count(node.tokensBefore),
        toolCalls: Array.isArray(node.toolCalls) ? node.toolCalls.flatMap((tool: unknown) => record(tool) && typeof tool.id === 'string'
          ? [{ id: tool.id, name: text(tool.name), args: text(tool.args) }] : []) : [] }];
    }) };
}

/** Tree detail level: the conversation, plus tool traffic, or every entry. */
export type TranscriptTreeFilter = 'conversation' | 'tools' | 'all';
export const TRANSCRIPT_TREE_FILTERS: readonly TranscriptTreeFilter[] = ['conversation', 'tools', 'all'];

/** An assistant entry that says something: text, an error, or an abort. */
function assistantSpeaks(node: TranscriptTreeNode) { return !!node.text || !!node.errorMessage || node.stopReason === 'aborted'; }

export function transcriptTreeNodeVisible(node: TranscriptTreeNode, filter: TranscriptTreeFilter): boolean {
  if (filter === 'all' || node.isLeaf) return true;
  if (filter === 'conversation') {
    if (node.type === 'branch_summary' || node.type === 'compaction') return true;
    return node.type === 'message' && (node.role === 'user' || (node.role === 'assistant' && assistantSpeaks(node)));
  }
  if (['model_change', 'thinking_level_change', 'label', 'custom'].includes(node.type)) return false;
  return !(node.type === 'message' && node.role === 'assistant' && !assistantSpeaks(node));
}

/**
 * A branch is a maximal fork-free run of visible entries: it starts at a root
 * or at a child of a fork and ends at a fork or a tip. Its children are the
 * alternatives at the fork it ends on (never exactly one).
 */
export interface TranscriptTreeBranch {
  readonly id: string; readonly nodeIds: readonly string[]; readonly parentId: string | null; readonly childIds: readonly string[];
  readonly title: string; readonly ending: string; readonly newest: number; readonly hasLeaf: boolean; readonly onActivePath: boolean;
}
export interface TranscriptTreeProjection {
  readonly filter: TranscriptTreeFilter;
  /** Visible entries, server preorder. */
  readonly order: readonly string[];
  /** Nearest visible ancestor of each visible entry. */
  readonly parentOf: ReadonlyMap<string, string | null>;
  /** Visible children keyed by visible parent (`null` = roots), server order. */
  readonly childrenOf: ReadonlyMap<string | null, readonly string[]>;
  readonly branchOf: ReadonlyMap<string, string>;
  readonly branches: ReadonlyMap<string, TranscriptTreeBranch>;
  readonly rootBranchIds: readonly string[];
  readonly forkCount: number;
}

export function nodePreview(node: TranscriptTreeNode): string {
  if (node.type === 'branch_summary') return node.summary || '(branch summary)';
  if (node.type === 'compaction') return '(compaction)';
  if (node.text) return node.text;
  if (node.errorMessage) return node.errorMessage;
  if (node.stopReason === 'aborted') return '(aborted)';
  if (node.toolCalls.length) return node.toolCalls.map(tool => tool.args ? tool.name + ': ' + tool.args : tool.name).join(' · ');
  if (node.role === 'toolResult') return '[' + (node.toolName || 'tool') + ']';
  return '[' + (node.role || node.type || 'entry') + ']';
}

/**
 * Re-parents every visible entry onto its nearest visible ancestor, so a fork
 * stays a fork when the entry it happened at (a tool result, a tool-only or
 * failed assistant turn) is filtered out, then groups the result into branches.
 */
export function projectTranscriptTree(tree: TranscriptTree, filter: TranscriptTreeFilter): TranscriptTreeProjection {
  const byId = new Map<string, TranscriptTreeNode>();
  for (const node of tree.nodes) if (!byId.has(node.id)) byId.set(node.id, node);
  const active = new Set(tree.activePathIds);
  const visible = new Set<string>();
  for (const node of byId.values()) if (transcriptTreeNodeVisible(node, filter)) visible.add(node.id);
  const anchor = new Map<string, string | null>();
  // Nearest visible ancestor, memoized along the walk; bounded for cyclic input.
  function visibleAncestor(id: string): string | null {
    const walked: string[] = [];
    let current = byId.get(id)?.parentId ?? null, result: string | null = null;
    for (let steps = 0; current && steps <= byId.size; steps++) {
      const known = anchor.get(current);
      if (known !== undefined) { result = known; break; }
      if (visible.has(current)) { result = current; break; }
      walked.push(current); current = byId.get(current)?.parentId ?? null;
    }
    for (const hidden of walked) anchor.set(hidden, result);
    return result === id ? null : result;
  }
  const order: string[] = [], parentOf = new Map<string, string | null>(), childrenOf = new Map<string | null, string[]>();
  for (const node of byId.values()) {
    if (!visible.has(node.id)) continue;
    const parent = visibleAncestor(node.id);
    order.push(node.id); parentOf.set(node.id, parent);
    const siblings = childrenOf.get(parent); if (siblings) siblings.push(node.id); else childrenOf.set(parent, [node.id]);
  }
  // Preorder over the projected children, independent of server order.
  const preorder: string[] = [], seen = new Set<string>();
  const stack = [...(childrenOf.get(null) || [])].reverse();
  while (stack.length) {
    const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); preorder.push(id);
    const kids = childrenOf.get(id); if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  const branchOf = new Map<string, string>();
  const draft = new Map<string, { nodeIds: string[]; parentId: string | null; childIds: string[] }>();
  const rootBranchIds: string[] = [];
  for (const id of preorder) {
    const parent = parentOf.get(id) ?? null;
    const startsBranch = parent === null || (childrenOf.get(parent)?.length ?? 0) !== 1;
    if (startsBranch) {
      const parentBranch = parent === null ? null : branchOf.get(parent) ?? null;
      draft.set(id, { nodeIds: [id], parentId: parentBranch, childIds: [] }); branchOf.set(id, id);
      if (parentBranch === null) rootBranchIds.push(id); else draft.get(parentBranch)?.childIds.push(id);
    } else {
      const branch = branchOf.get(parent)!; branchOf.set(id, branch); draft.get(branch)?.nodeIds.push(id);
    }
  }
  const branches = new Map<string, TranscriptTreeBranch>();
  let forkCount = 0;
  for (const [id, entry] of draft) {
    const nodes = entry.nodeIds.map(nodeId => byId.get(nodeId)!);
    const titleNode = nodes.find(node => node.type === 'message' && node.role === 'user') || nodes[0];
    const last = nodes[nodes.length - 1];
    if (entry.childIds.length > 1) forkCount++;
    branches.set(id, { id, nodeIds: entry.nodeIds, parentId: entry.parentId, childIds: entry.childIds,
      title: nodePreview(titleNode), ending: last === titleNode ? '' : nodePreview(last),
      newest: nodes.reduce((max, node) => Math.max(max, node.time), 0),
      hasLeaf: nodes.some(node => node.id === tree.leafId), onActivePath: nodes.some(node => active.has(node.id)) });
  }
  return { filter, order: preorder, parentOf, childrenOf, branchOf, branches, rootBranchIds, forkCount };
}

/** Visible path from the root to `tipId`, inclusive. */
export function transcriptTreePath(projection: TranscriptTreeProjection, tipId: string): string[] {
  const path: string[] = [], seen = new Set<string>();
  for (let current: string | null = tipId; current && projection.parentOf.has(current) && !seen.has(current); current = projection.parentOf.get(current) ?? null) {
    seen.add(current); path.push(current);
  }
  return path.reverse();
}

/**
 * Follows a branch down to where it ends: through the active path when it
 * continues there (stopping at the leaf), otherwise the newest alternative.
 */
export function transcriptTreeDescend(projection: TranscriptTreeProjection, tree: TranscriptTree, fromId: string): string {
  const active = new Set(tree.activePathIds), seen = new Set<string>();
  let current = fromId;
  while (current !== tree.leafId && !seen.has(current)) {
    seen.add(current);
    const kids = projection.childrenOf.get(current); if (!kids || !kids.length) break;
    current = kids.find(kid => active.has(kid)) ?? kids[kids.length - 1];
  }
  return current;
}

/** The entry itself when visible, else its nearest visible ancestor. */
export function transcriptTreeVisibleAnchor(projection: TranscriptTreeProjection, tree: TranscriptTree, entryId: string): string | null {
  const byId = new Map(tree.nodes.map(node => [node.id, node] as const)), seen = new Set<string>();
  for (let current: string | null = entryId; current && !seen.has(current); current = byId.get(current)?.parentId ?? null) {
    if (projection.parentOf.has(current)) return current;
    seen.add(current);
  }
  return null;
}
