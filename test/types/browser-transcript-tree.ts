import type { TranscriptTree } from '../../src/browser/transcript-tree-data';
import type { createTranscriptTree } from '../../src/browser/transcript-tree';
declare const tree: TranscriptTree;
declare const controller: ReturnType<typeof createTranscriptTree>;
// @ts-expect-error tree nodes are immutable answering snapshots
tree.nodes.push({});
// @ts-expect-error tree leaf may be absent
const leaf: string = tree.leafId;
// @ts-expect-error the controller owns loaded tree state
controller.data = null;
