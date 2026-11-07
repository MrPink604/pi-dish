import type { ImageBlock } from './helper-types';
import { record } from './helper-values';
import { truncate } from './helper-format';

export function extractTextContent(content: unknown) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) { const blocks: unknown[] = content; return blocks.map(c => typeof c === 'string' ? c : record(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : '').join('\n'); }
  return '';
}

/** Text blocks only: extractTextContent joins non-text blocks as empty lines, so it can't equal a prompt's echo once an image is attached. */
export function extractTextBlocks(content: unknown) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const blocks: unknown[] = content;
  return blocks
    .filter(c => typeof c === 'string' || (record(c) && c.type === 'text'))
    .map(c => typeof c === 'string' ? c : record(c) && typeof c.text === 'string' ? c.text : '')
    .join('\n');
}

/** Prime's Python kernel tool wraps shell access in bash('...'): surface that command, else the first code line. */
export function ipythonCodeSummary(code: unknown) {
  if (typeof code !== 'string' || !code) return '';
  const m = /(?:^|[^A-Za-z0-9_])bash\(\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(code);
  const inner = m ? m[2].replace(/\\(['"\\])/g, '$1') : code.split('\n')[0];
  return truncate(inner, 60);
}

export function getToolSummary(toolName: string, args: unknown) {
  if (!record(args)) return '';
  if (toolName === 'Bash' || toolName === 'bash') return typeof args.command === 'string' && args.command ? truncate(args.command.split('\n')[0], 60) : '';
  if (toolName === 'ipython' || toolName === 'python_repl') return ipythonCodeSummary(args.code);
  // OMP eval args lead with language ("py"); prefer the cell title, then the ipython summary.
  if (toolName === 'eval') {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (title) return truncate(title, 60);
    return ipythonCodeSummary(args.code);
  }
  if (['Read', 'read', 'Edit', 'edit', 'Write', 'write'].includes(toolName)) return typeof args.path === 'string' ? args.path : '';
  const keys = Object.keys(args);
  if (keys.length) return truncate(String(args[keys[0]]), 40);
  return '';
}

/**
 * Unwrap Prime's `BashResult(exit_code=0, output='...', duration=0.017)` repr to
 * its output. Null for anything else, including a partial streaming prefix.
 */
export function parseIpythonResult(text: unknown) {
  if (typeof text !== 'string') return null;
  const m = /^BashResult\(exit_code=(-?\d+), output=(['"])((?:\\.|(?!\2).)*)\2(?:, duration=([0-9.eE+-]+))?\)\s*$/.exec(text);
  if (!m) return null;
  return { exitCode: Number(m[1]), output: pythonReprUnescape(m[3]), durationMs: m[4] != null ? Math.round(Number(m[4]) * 1000) : null };
}

export function pythonReprUnescape(text: string) {
  return text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_all, seq) => {
    if (seq[0] === 'x') return String.fromCharCode(parseInt(seq.slice(1), 16));
    if (seq[0] === 'u') return String.fromCharCode(parseInt(seq.slice(1), 16));
    const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0', '\n': '' };
    return Object.hasOwn(map, seq) ? map[seq] : seq;
  });
}

/** Drives `.message.no-text` (focus mode, tool grouping); shared by static and streaming renderers. */
export function messageHasVisibleText(msg: unknown) {
  if (!record(msg)) return false;
  if (msg.errorMessage) return true;
  if (typeof msg.content === 'string') return !!msg.content;
  return Array.isArray(msg.content) && msg.content.some((b: unknown) => record(b) && b.type === 'text' && typeof b.text === 'string' && !!b.text);
}

export function getToolOutputText(partialResult: unknown) {
  if (!record(partialResult) || !Array.isArray(partialResult.content)) return '';
  const blocks: unknown[] = partialResult.content;
  return blocks
    .filter((c): c is Record<string, unknown> => record(c) && c.type === 'text')
    .map(c => typeof c.text === 'string' ? c.text : '')
    .join('');
}

/** Live events carry `{ data, mimeType }`; history pages project bytes to `{ url, mimeType }`. mimeType defaults to image/png. */
export function extractImageBlocks(content: unknown) {
  if (!Array.isArray(content)) return [];
  const out: ImageBlock[] = [];
  const blocks: unknown[] = content;
  for (const block of blocks) {
    if (!record(block) || block.type !== 'image') continue;
    const mimeType = typeof block.mimeType === 'string' && block.mimeType ? block.mimeType : 'image/png';
    if (typeof block.url === 'string' && block.url) out.push({ url: block.url, mimeType });
    else if (typeof block.data === 'string' && block.data) out.push({ data: block.data, mimeType });
  }
  return out;
}
