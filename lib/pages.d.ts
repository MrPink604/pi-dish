// Generated from src/core/pages.ts; edit that source and run npm run build:core.
export interface CreatePageOptions {
    root: string;
    title?: unknown;
    sessionId?: unknown;
    renderer?: unknown;
}
/** A newly constructed persistence record, before a later untrusted disk read. */
export interface PageRecord {
    root: string;
    title: unknown;
    sessionId: unknown;
    renderer?: unknown;
    createdAt: number;
}
/** Reads preserve legacy fields, including absent or malformed metadata. */
export interface PageDto extends Record<string, unknown> {
    root?: unknown;
    title?: unknown;
    sessionId: unknown;
    renderer?: unknown;
    createdAt?: unknown;
}
export interface ListedPageDto extends PageDto {
    token: unknown;
}
/** Re-publishing a resolved root reuses its token and refreshes its metadata. */
export declare function createPage({ root, title, sessionId, renderer }: CreatePageOptions): string;
export declare function revokePage(token: string): boolean;
export declare function getPage(token: string): PageDto | null;
/** Newest first; do not drop malformed rows that the legacy list exposed. */
export declare function listPages(): ListedPageDto[];
