/**
 * Resolve a file mentioned in chat ("findings.md", `lib/tmux.js:42`) to a
 * real path using the session as context, and read it for the file viewer.
 *
 * Agents write intermediate outputs (findings.md, plan.md) deep inside the
 * project or in a scratchpad and then refer to them by bare filename. The
 * session's own tool calls know the full paths, so resolution mines them:
 * read/write/edit `path` args, `cwd` args, and absolute/`~` path tokens
 * inside bash command strings — most recent reference wins. A qualified
 * mention (contains '/') prefers the exact cwd-relative file; a bare
 * basename prefers the tool-call trail (the agent's "findings.md" means the
 * one it just wrote, not a stale one at the repo root). Last resort is the
 * fuzzy file search under the session cwd (files created via bash heredocs
 * never appear in structured tool args).
 *
 * Reads are gated to the session's reach: the cwd subtree plus paths/dirs
 * its tool calls touched. Containment is lexical (path.resolve normalizes
 * ".." before the check) — the threat model is a LAN client typing an
 * arbitrary ?path=, not a hostile agent planting symlinks; the agent
 * already has a shell.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { searchFiles } = require('./file-search');

// Structured tool args that carry a path (pi's read/write/edit use `path`,
// process-style tools use `cwd`; the *_path variants cover other agents'
// logs viewed through pi-dish).
const PATH_ARG_KEYS = ['path', 'file_path', 'filePath', 'cwd'];

// Absolute or ~-rooted tokens inside bash command strings.
const COMMAND_PATH_RE = /(?:^|[\s'"`=(<>])((?:\/|~\/)[\w.@%+-]+(?:\/[\w.@%+-]+)*)/g;

// Only the most recent tool-call paths are used as join bases (dir + '/' +
// mention) — joining against a whole multi-thousand-call session would stat
// thousands of nonexistent candidates per click.
const MAX_JOIN_BASES = 200;

const MAX_TEXT_BYTES = 500 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

/**
 * Clean a chat-mentioned path: surrounding quotes/brackets, trailing
 * sentence punctuation, a trailing :line[:col] (returned separately), a
 * leading @ (the composer's mention form), ~ expansion.
 */
function normalizeMention(raw, home) {
  let s = String(raw || '').trim();
  s = s.replace(/^[('"`[<]+/, '').replace(/[)'"`\]>.,;:!?]+$/, '');
  let line = null;
  const lineMatch = s.match(/^(.+?):(\d+)(?::\d+)?$/);
  if (lineMatch) { s = lineMatch[1]; line = Number(lineMatch[2]); }
  if (s.startsWith('@') && s.length > 1) s = s.slice(1);
  if (s === '~') s = home;
  else if (s.startsWith('~/')) s = path.join(home, s.slice(2));
  return { mention: s, line };
}

/**
 * Every absolute path a session's tool calls referenced (plus the dirname of
 * each structured file arg, so siblings of a written file resolve too).
 * Returns Map<absPath, lastMessageIndex> — recency for ranking.
 */
function extractSessionPaths(messages, cwd, home = os.homedir()) {
  const paths = new Map();
  const resolveArg = (p) => {
    if (p.startsWith('~/')) p = path.join(home, p.slice(2));
    if (!path.isAbsolute(p)) {
      if (!cwd) return null;
      p = path.resolve(cwd, p);
    }
    return path.normalize(p);
  };
  messages.forEach((msg, idx) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return;
    for (const block of msg.content) {
      if (!block || block.type !== 'toolCall') continue;
      const args = block.arguments || {};
      for (const key of PATH_ARG_KEYS) {
        const v = args[key];
        if (typeof v !== 'string' || !v || v.length > 1024) continue;
        const abs = resolveArg(v);
        if (!abs) continue;
        paths.set(abs, idx);
        if (key !== 'cwd') paths.set(path.dirname(abs), idx);
      }
      if (typeof args.command === 'string') {
        for (const m of args.command.matchAll(COMMAND_PATH_RE)) {
          const abs = resolveArg(m[1]);
          if (abs) paths.set(abs, idx);
        }
      }
    }
  });
  return paths;
}

/**
 * Resolve a mention to an existing, allowed file. Returns
 * { absPath, line } or null. See the module doc for the strategy.
 */
async function resolveFileMention(rawMention, { cwd, messages, home = os.homedir() }) {
  const { mention, line } = normalizeMention(rawMention, home);
  if (!mention || /[\n\0]/.test(mention)) return null;

  const paths = extractSessionPaths(messages || [], cwd, home);
  const byRecency = [...paths.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  const normCwd = cwd ? path.normalize(cwd) : null;

  const underCwd = (p) => normCwd && (p === normCwd || p.startsWith(normCwd + path.sep));
  const allowed = (p) =>
    underCwd(p) || paths.has(p) || byRecency.some(b => p.startsWith(b + path.sep));
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

  const candidates = [];
  if (path.isAbsolute(mention)) {
    candidates.push(path.normalize(mention));
  } else {
    const qualified = mention.includes('/');
    const suffixMatches = byRecency.filter(p => p.endsWith('/' + mention));
    const cwdJoin = normCwd ? [path.resolve(normCwd, mention)] : [];
    // Qualified mentions name a location — trust it before the tool trail;
    // bare basenames mean "the one the agent last touched".
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

/**
 * Read a resolved file for the viewer: text (capped, with a truncated flag),
 * or base64 + mimeType for images. Binary non-images get { error, status }.
 */
function readFileForViewer(absPath) {
  const stats = fs.statSync(absPath);
  const mime = IMAGE_MIME[path.extname(absPath).toLowerCase()];
  if (mime) {
    if (stats.size > MAX_IMAGE_BYTES) return { error: 'Image too large to preview', status: 413 };
    return {
      image: { data: fs.readFileSync(absPath).toString('base64'), mimeType: mime },
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

module.exports = { normalizeMention, extractSessionPaths, resolveFileMention, readFileForViewer };
