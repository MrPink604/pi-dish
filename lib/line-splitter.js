// Generated from src/core/line-splitter.ts; edit that source and run npm run build:core.
"use strict";
/**
 * Incremental LF-only line splitting for JSONL transports: Node's readline
 * also splits on U+2028/U+2029, which are valid inside JSON strings. CR before
 * LF is stripped, empty lines skipped; StringDecoder keeps split multibyte chars.
 */
const string_decoder_1 = require("string_decoder");
const helper_values_1 = require("./helper-values");
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
/** Line splitter for JSONL transports: non-JSON output is not a frame. */
function createJsonLineSplitter(onMessage) {
    return createLineSplitter((line) => {
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            return;
        }
        if ((0, helper_values_1.record)(message))
            onMessage(message);
    });
}
module.exports = { createLineSplitter, createJsonLineSplitter };
