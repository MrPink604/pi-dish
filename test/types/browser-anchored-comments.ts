import type { AnchoredComment, CommentTarget } from '../../src/browser/anchored-comment-data';
import { findQuoteOffset, markCommentQuote } from '../../src/browser/comment-anchors';
declare const comment: AnchoredComment;
// @ts-expect-error comment targets exclude arbitrary executable payloads
const target: CommentTarget = { kind: 'execute', path: 'a' };
// @ts-expect-error decoded comment body is immutable
comment.body = 'changed';
// @ts-expect-error diff targets require their repository
const diff: CommentTarget = { kind: 'diff', path: 'a', oldPath: null, anchor: { type: 'lines', quote: 'a' } };

declare const root: HTMLElement;
const marked: boolean = markCommentQuote(root, { quote: 'selected', prefix: 'before ' }, 'comment');
const legacyMarked: boolean = markCommentQuote(root, { type: 'text', quote: 'selected' }, 'comment');
const offset: number = findQuoteOffset('before selected', { quote: 'selected' });
void [marked, legacyMarked, offset];
