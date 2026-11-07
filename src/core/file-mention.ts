/**
 * Resolve a chat-mentioned path via the session's tool-call trail (most recent
 * wins), falling back to fuzzy search under the cwd. Reads are gated to the cwd
 * subtree plus touched paths; containment is lexical, which stops a LAN
 * client's arbitrary ?path=, not a hostile agent that already has a shell.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { searchFiles } from './file-search';
import { record } from './helper-values';
import { matchCommandPaths } from './command-paths';

export interface FileMentionContext {
  cwd?: string | null;
  messages?: readonly unknown[] | null;
  home?: string;
}

export interface NormalizedMention {
  mention: string;
  line: number | null;
}

export interface ResolvedFileMention {
  absPath: string;
  line: number | null;
}

export interface FileViewerImageData {
  mimeType: string;
  data?: string;
  buffer?: Buffer;
  url?: string;
}

export interface FileViewerText {
  content: string;
  truncated: boolean;
  size: number;
  mtime: number;
  image?: never;
}

export interface FileViewerImage {
  image: FileViewerImageData;
  size: number;
  mtime: number;
  content?: never;
  truncated?: never;
}

export interface FileViewerError {
  error: string;
  status: 413 | 415;
}

export type FileViewerFile = FileViewerText | FileViewerImage;
export type FileViewerResult = FileViewerFile | FileViewerError;

export interface FileViewerOptions {
  imageData?: 'base64' | 'buffer' | false;
}

// `*_path` variants cover other agents' logs viewed through pi-dish.
const PATH_ARG_KEYS = ['path', 'file_path', 'filePath', 'cwd'];

// Joining against every tool-call path would stat thousands of candidates per click.
const MAX_JOIN_BASES = 200;

const MAX_TEXT_BYTES = 500 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

/** Strips quotes/brackets, trailing punctuation, a leading @, and a trailing :line[:col] (returned separately); expands ~. */
export function normalizeMention(raw: unknown, home: string): NormalizedMention {
  let s = String(raw || '').trim();
  s = s.replace(/^[('"`[<]+/, '').replace(/[)'"`\]>.,;:!?]+$/, '');
  let line: number | null = null;
  const lineMatch = s.match(/^(.+?):(\d+)(?::\d+)?$/);
  if (lineMatch) { s = lineMatch[1]; line = Number(lineMatch[2]); }
  if (s.startsWith('@') && s.length > 1) s = s.slice(1);
  if (s === '~') s = home;
  else if (s.startsWith('~/')) s = path.join(home, s.slice(2));
  return { mention: s, line };
}

/** Includes each file arg's dirname so siblings resolve. Values are last message index, for recency. */
export function extractSessionPaths(messages: readonly unknown[], cwd: string | null | undefined, home = os.homedir()): Map<string, number> {
  const paths = new Map<string, number>();
  const resolveArg = (p: string): string | null => {
    if (p.startsWith('~/')) p = path.join(home, p.slice(2));
    if (!path.isAbsolute(p)) {
      if (!cwd) return null;
      p = path.resolve(cwd, p);
    }
    return path.normalize(p);
  };
  messages.forEach((msg, idx) => {
    if (!record(msg) || msg.role !== 'assistant' || !Array.isArray(msg.content)) return;
    for (const block of msg.content) {
      if (!record(block) || block.type !== 'toolCall') continue;
      const args = block.arguments || {};
      if (!record(args)) continue;
      for (const key of PATH_ARG_KEYS) {
        const v = args[key];
        if (typeof v !== 'string' || !v || v.length > 1024) continue;
        const abs = resolveArg(v);
        if (!abs) continue;
        paths.set(abs, idx);
        if (key !== 'cwd') paths.set(path.dirname(abs), idx);
      }
      if (typeof args.command === 'string') {
        for (const m of matchCommandPaths(args.command)) {
          const abs = resolveArg(m[1]);
          if (abs) paths.set(abs, idx);
        }
      }
    }
  });
  return paths;
}

export async function resolveFileMention(rawMention: unknown, { cwd, messages, home = os.homedir() }: FileMentionContext): Promise<ResolvedFileMention | null> {
  const { mention, line } = normalizeMention(rawMention, home);
  if (!mention || /[\n\0]/.test(mention)) return null;

  const paths = extractSessionPaths(messages || [], cwd, home);
  const byRecency = [...paths.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  const normCwd = cwd ? path.normalize(cwd) : null;

  const underCwd = (p: string) => normCwd && (p === normCwd || p.startsWith(normCwd + path.sep));
  const allowed = (p: string) =>
    underCwd(p) || paths.has(p) || byRecency.some(b => p.startsWith(b + path.sep));
  const isFile = (p: string): boolean => { try { return fs.statSync(p).isFile(); } catch { return false; } };

  const candidates: string[] = [];
  if (path.isAbsolute(mention)) {
    candidates.push(path.normalize(mention));
  } else {
    const qualified = mention.includes('/');
    const suffixMatches = byRecency.filter(p => p.endsWith('/' + mention));
    const cwdJoin = normCwd ? [path.resolve(normCwd, mention)] : [];
    // Qualified mentions name a location; bare basenames mean "the one the agent last touched".
    candidates.push(...(qualified ? [...cwdJoin, ...suffixMatches] : [...suffixMatches, ...cwdJoin]));
    for (const base of byRecency.slice(0, MAX_JOIN_BASES)) {
      candidates.push(path.resolve(base, mention), path.resolve(path.dirname(base), mention));
    }
  }
  for (const c of [...new Set(candidates)]) {
    if (isFile(c) && allowed(c)) return { absPath: c, line };
  }

  if (normCwd) {
    const results = await searchFiles(normCwd, mention, 20).catch(() => []);
    const base = path.basename(mention);
    const hit = results.find(r =>
      r.path === mention || r.path.endsWith('/' + mention) || path.basename(r.path) === base);
    if (hit) {
      const abs = path.resolve(normCwd, hit.path);
      if (isFile(abs) && allowed(abs)) return { absPath: abs, line };
    }
  }
  return null;
}

/** Base64 is the default for library callers; HTTP routes opt into no bytes or a Buffer. */
export function readFileForViewer(absPath: string, { imageData = 'base64' }: FileViewerOptions = {}): FileViewerResult {
  const stats = fs.statSync(absPath);
  const mime = IMAGE_MIME[path.extname(absPath).toLowerCase()];
  if (mime) {
    if (stats.size > MAX_IMAGE_BYTES) return { error: 'Image too large to preview', status: 413 };
    const image: FileViewerImageData = { mimeType: mime };
    if (imageData === 'base64') image.data = fs.readFileSync(absPath).toString('base64');
    else if (imageData === 'buffer') image.buffer = fs.readFileSync(absPath);
    return {
      image,
      size: stats.size, mtime: stats.mtimeMs,
    };
  }
  const fd = fs.openSync(absPath, 'r');
  try {
    const len = Math.min(stats.size, MAX_TEXT_BYTES);
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, 0);
    if (buf.subarray(0, Math.min(n, 8192)).includes(0)) {
      return { error: 'Binary file — no preview', status: 415 };
    }
    return {
      content: buf.subarray(0, n).toString('utf8'),
      truncated: stats.size > MAX_TEXT_BYTES,
      size: stats.size, mtime: stats.mtimeMs,
    };
  } finally {
    fs.closeSync(fd);
  }
}
