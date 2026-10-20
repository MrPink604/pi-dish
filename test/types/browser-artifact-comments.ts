import { decodePageComments, responseError } from '../../src/browser/artifact-comment-data';
import type { PageComment, TextAnchor } from '../../src/browser/artifact-comment-data';
const rows: readonly PageComment[] = decodePageComments({ comments: [] });
const anchor: TextAnchor | undefined = rows[0]?.anchor;
const error: string = responseError(null, 500);
// @ts-expect-error published comments expose readonly content
rows[0].body = 'changed';
// @ts-expect-error anchors preserve the submitted text snapshot
rows[0].anchor.quote = 'changed';
void [anchor, error];
