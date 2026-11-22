/**
 * Line reads of JSONL files in bounded chunks: memory follows the longest line,
 * never the file, so a transcript holding large image rows, or one past Node's
 * largest string, still reads. A line is split at byte 0x0A, which never occurs
 * inside a UTF-8 sequence.
 */
import fs = require('fs');

const CHUNK_BYTES = 1024 * 1024;

/**
 * Each line of `file` from the first, as `content.split('\n')` gives them; `visit` returning false stops the read.
 * Only the first `limit` bytes are read: a caller that recorded the file's size never sees what was appended since.
 */
export function forEachLine(file: string, visit: (line: string, index: number) => boolean | void, limit = Infinity): void {
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(CHUNK_BYTES);
    let partial: Buffer[] = [];
    let index = 0;
    let position = 0;
    const next = () => position < limit ? fs.readSync(fd, chunk, 0, Math.min(CHUNK_BYTES, limit - position), position) : 0;
    for (let read = next(); read > 0; read = next()) {
      position += read;
      let start = 0;
      for (let newline = chunk.indexOf(10, start); newline >= 0 && newline < read; newline = chunk.indexOf(10, start)) {
        const line = Buffer.concat([...partial, chunk.subarray(start, newline)]).toString('utf8');
        partial = [];
        start = newline + 1;
        if (visit(line, index++) === false) return;
      }
      partial.push(Buffer.from(chunk.subarray(start, read)));
    }
    visit(Buffer.concat(partial).toString('utf8'), index);
  } finally {
    fs.closeSync(fd);
  }
}

/** The first line of `file`, read only as far as its end. */
export function firstLine(file: string): string {
  let first = '';
  forEachLine(file, (line) => { first = line; return false; });
  return first;
}

/** The lines of `file` from the last back to the first; a trailing newline gives an empty last line first. */
export function* linesFromEnd(file: string): Generator<string> {
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(CHUNK_BYTES);
    let position = fs.fstatSync(fd).size;
    // The pieces of the line being read, in file order.
    let partial: Buffer[] = [];
    while (position > 0) {
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      fs.readSync(fd, chunk, 0, length, position);
      let end = length;
      for (let newline = chunk.lastIndexOf(10, end - 1); newline >= 0; newline = end > 0 ? chunk.lastIndexOf(10, end - 1) : -1) {
        const line = Buffer.concat([chunk.subarray(newline + 1, end), ...partial]).toString('utf8');
        partial = [];
        end = newline;
        yield line;
      }
      partial.unshift(Buffer.from(chunk.subarray(0, end)));
    }
    yield Buffer.concat(partial).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}
