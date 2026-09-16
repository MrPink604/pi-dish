// Generated from src/core/file-page.ts; edit that source and run npm run build:core.
import type { FileViewerFile } from './file-mention';
export interface FilePageOptions {
    token: string;
    root: string;
    title?: unknown;
    file: FileViewerFile;
}
export declare function renderFilePage({ token, root, title, file }: FilePageOptions): string;
