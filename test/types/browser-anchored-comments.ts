import type { AnchoredComment, CommentTarget } from '../../src/browser/anchored-comment-data';
declare const comment: AnchoredComment;
// @ts-expect-error comment targets exclude arbitrary executable payloads
const target: CommentTarget = { kind: 'execute', path: 'a' };
// @ts-expect-error decoded comment body is immutable
comment.body = 'changed';
// @ts-expect-error diff targets require their repository
const diff: CommentTarget = { kind: 'diff', path: 'a', oldPath: null, anchor: { type: 'lines', quote: 'a' } };
