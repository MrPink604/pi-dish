// Generated from src/core/file-lines.ts; edit that source and run npm run build:core.
/**
 * Each line of `file` from the first, as `content.split('\n')` gives them; `visit` returning false stops the read.
 * Only the first `limit` bytes are read: a caller that recorded the file's size never sees what was appended since.
 */
export declare function forEachLine(file: string, visit: (line: string, index: number) => boolean | void, limit?: number): void;
/** The first line of `file`, read only as far as its end. */
export declare function firstLine(file: string): string;
/** The lines of `file` from the last back to the first; a trailing newline gives an empty last line first. */
export declare function linesFromEnd(file: string): Generator<string>;
