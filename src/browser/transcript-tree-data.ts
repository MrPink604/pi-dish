import { record, finite } from './helper-values';
export interface TranscriptTreeTool { readonly id: string; readonly name: string; readonly args: string }
export interface TranscriptTreeNode {
  readonly id: string; readonly parentId: string | null; readonly type: string; readonly role: string; readonly depth: number; readonly childCount: number; readonly isLeaf: boolean;
  readonly text: string; readonly label: string; readonly toolName: string; readonly toolCallId: string; readonly modelId: string; readonly summary: string;
  readonly stopReason: string; readonly errorMessage: string; readonly isError: boolean; readonly tokensBefore: number; readonly toolCalls: readonly TranscriptTreeTool[];
}
export interface TranscriptTree { readonly nodes: readonly TranscriptTreeNode[]; readonly activePathIds: readonly string[]; readonly leafId: string | null }
const text = (value: unknown) => typeof value === 'string' ? value : '';
const count = (value: unknown) => finite(value) ? Math.max(0, Math.floor(value)) : 0;
export function decodeTranscriptTree(value: unknown): TranscriptTree {
  if (!record(value) || !Array.isArray(value.nodes)) throw new Error('Invalid session tree');
  const maxDepth = value.nodes.length;
  return { leafId: typeof value.leafId === 'string' ? value.leafId : null,
    activePathIds: Array.isArray(value.activePathIds) ? value.activePathIds.filter((id): id is string => typeof id === 'string') : [],
    nodes: value.nodes.flatMap((node: unknown) => {
      if (!record(node) || typeof node.id !== 'string' || !node.id) return [];
      return [{ id: node.id, parentId: typeof node.parentId === 'string' ? node.parentId : null, type: text(node.type), role: text(node.role), depth: Math.min(count(node.depth), maxDepth), childCount: count(node.childCount), isLeaf: node.isLeaf === true,
        text: text(node.text), label: text(node.label), toolName: text(node.toolName), toolCallId: text(node.toolCallId), modelId: text(node.modelId), summary: text(node.summary),
        stopReason: text(node.stopReason), errorMessage: text(node.errorMessage), isError: node.isError === true, tokensBefore: count(node.tokensBefore),
        toolCalls: Array.isArray(node.toolCalls) ? node.toolCalls.flatMap((tool: unknown) => record(tool) && typeof tool.id === 'string'
          ? [{ id: tool.id, name: text(tool.name), args: text(tool.args) }] : []) : [] }];
    }) };
}
