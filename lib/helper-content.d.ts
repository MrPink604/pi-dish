// Generated from src/core/helper-content.ts; edit that source and run npm run build:core.
import type { ImageBlock } from './helper-types';
export declare function extractTextContent(content: unknown): string;
/** Text of the text blocks only — no phantom separators from image or other
 *  non-text blocks (extractTextContent joins those in as empty lines, so it
 *  can never equal the composer's trimmed text once an image is attached).
 *  Used when comparing a prompt to its echo. */
export declare function extractTextBlocks(content: unknown): string;
/**
 * Prime's single built-in tool: a stateful Python kernel whose shell access
 * is wrapped in bash('...') calls. Surface the wrapped command when present,
 * otherwise the first line of the code — mirroring the Bash/read summaries.
 */
export declare function ipythonCodeSummary(code: unknown): string;
export declare function getToolSummary(toolName: string, args: unknown): string;
/**
 * Prime's ipython tool results are the Python repr of a BashResult (or plain
 * kernel text): `BashResult(exit_code=0, output='...', duration=0.017)`.
 * Unwrap it so transcripts show the command output instead of the repr.
 * Returns null for anything else, including a partial streaming prefix.
 */
export declare function parseIpythonResult(text: unknown): {
    exitCode: number;
    output: string;
    durationMs: number | null;
} | null;
export declare function pythonReprUnescape(text: string): string;
/**
 * Whether a message renders any prose (a non-empty text block or an error).
 * Drives the `.message.no-text` class that focus mode and tool-activity
 * grouping key on. One definition for the static and streaming renderers —
 * they used to derive it independently and disagreed about errorMessage.
 */
export declare function messageHasVisibleText(msg: unknown): boolean;
export declare function getToolOutputText(partialResult: unknown): string;
/**
 * Image content blocks from a message or tool-result content array. Live
 * events carry `{ data, mimeType }`; historical pages project those bytes to
 * `{ url, mimeType }` so the browser can cache/lazy-load them. Non-array
 * content and blocks without either source yield nothing; mimeType defaults
 * to image/png. Rendering stays with the DOM-owning caller.
 */
export declare function extractImageBlocks(content: unknown): ImageBlock[];
