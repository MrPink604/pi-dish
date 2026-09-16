// Generated from src/core/omp-export.ts; edit that source and run npm run build:core.
export interface OmpShareTool {
    name: string;
    description: string;
}
export interface OmpShareSnapshot {
    systemPrompt?: string;
    tools?: OmpShareTool[];
}
/** Native export fields remain opaque except for the validated entries array. */
export interface OmpExportData {
    [key: string]: unknown;
    entries: unknown[];
}
export interface OmpExportOptions {
    snapshot?: unknown;
}
export declare function readOmpExportData(html: string): OmpExportData;
export declare function normalizeSnapshot(snapshot: unknown): OmpShareSnapshot | null;
export declare function injectOmpExportSnapshot(html: string, snapshot: unknown): string;
export declare function exportOmpSessionHtml(sessionPath: string, outputPath: string, { snapshot }?: OmpExportOptions): Promise<string>;
