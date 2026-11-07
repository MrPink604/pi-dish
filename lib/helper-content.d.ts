// Generated from src/core/helper-content.ts; edit that source and run npm run build:core.
import type { ImageBlock } from './helper-types';
export declare function extractTextContent(content: unknown): string;
/** Text blocks only: extractTextContent joins non-text blocks as empty lines, so it can't equal a prompt's echo once an image is attached. */
export declare function extractTextBlocks(content: unknown): string;
/** Prime's Python kernel tool wraps shell access in bash('...'): surface that command, else the first code line. */
export declare function ipythonCodeSummary(code: unknown): string;
export declare function getToolSummary(toolName: string, args: unknown): string;
/**
 * Unwrap Prime's `BashResult(exit_code=0, output='...', duration=0.017)` repr to
 * its output. Null for anything else, including a partial streaming prefix.
 */
export declare function parseIpythonResult(text: unknown): {
    exitCode: number;
    output: string;
    durationMs: number | null;
} | null;
export declare function pythonReprUnescape(text: string): string;
/** Drives `.message.no-text` (focus mode, tool grouping); shared by static and streaming renderers. */
export declare function messageHasVisibleText(msg: unknown): boolean;
export declare function getToolOutputText(partialResult: unknown): string;
/** Live events carry `{ data, mimeType }`; history pages project bytes to `{ url, mimeType }`. mimeType defaults to image/png. */
export declare function extractImageBlocks(content: unknown): ImageBlock[];
