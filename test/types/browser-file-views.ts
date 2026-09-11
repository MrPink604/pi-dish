import type { FilePreview, DiffView } from '../../src/browser/file-view-data';
import type { createFileViews } from '../../src/browser/file-views';
declare const file: FilePreview;
declare const diff: DiffView;
declare const views: ReturnType<typeof createFileViews>;
// @ts-expect-error file paths are decoded strings
const badFile: FilePreview = { path: 1 };
// @ts-expect-error decoded diff arrays are immutable
diff.repos.push({});
// @ts-expect-error view ownership is read-only outside the controller
views.file.generation = 2;
// @ts-expect-error decoded file fields are immutable
file.content = 'changed';
