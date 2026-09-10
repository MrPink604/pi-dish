// Generated from src/core/line-splitter.ts; edit that source and run npm run build:core.
"use strict";
/**
 * Incremental LF-framed line splitting, shared by the JSONL socket/stdio
 * clients (rpc-session.js, bridge-session.js).
 *
 * Splits on LF only — Node's readline also splits on U+2028/U+2029, which
 * are valid inside JSON strings. CR before the LF is stripped, empty lines
 * are skipped, and a StringDecoder keeps multibyte characters that straddle
 * chunk boundaries intact.
 */
const string_decoder_1 = require("string_decoder");
/** Returns a feed(chunk) function that calls onLine per complete line. */
function createLineSplitter(onLine) {
    const decoder = new string_decoder_1.StringDecoder('utf8');
    let buffer = '';
    return (chunk) => {
        buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith('\r'))
                line = line.slice(0, -1);
            if (line)
                onLine(line);
        }
    };
}
module.exports = { createLineSplitter };
