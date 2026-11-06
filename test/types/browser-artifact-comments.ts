import { decodePageComments } from '../../src/browser/artifact-comment-data';
import type { PageComment, TextAnchor } from '../../src/browser/artifact-comment-data';
const rows: readonly PageComment[] = decodePageComments({ comments: [] });
const anchor: TextAnchor | undefined = rows[0]?.anchor;
// @ts-expect-error published comments expose readonly content
rows[0].body = 'changed';
// @ts-expect-error anchors preserve the submitted text snapshot
rows[0].anchor.quote = 'changed';
void anchor;
