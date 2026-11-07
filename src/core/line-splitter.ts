/**
 * Incremental LF-only line splitting for JSONL transports: Node's readline
 * also splits on U+2028/U+2029, which are valid inside JSON strings. CR before
 * LF is stripped, empty lines skipped; StringDecoder keeps split multibyte chars.
 */
import { StringDecoder } from 'string_decoder';
import { type ProtocolRecord } from './wire-protocol';
import { record as isRecord } from './helper-values';

type Chunk = string | Buffer | Uint8Array;

function createLineSplitter(onLine: (line: string) => void) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  return (chunk: Chunk) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line) onLine(line);
    }
  };
}

/** Line splitter for JSONL transports: non-JSON output is not a frame. */
function createJsonLineSplitter(onMessage: (message: ProtocolRecord) => void) {
  return createLineSplitter((line) => {
    let message: unknown;
    try { message = JSON.parse(line); } catch { return; }
    if (isRecord(message)) onMessage(message);
  });
}

export = { createLineSplitter, createJsonLineSplitter };
