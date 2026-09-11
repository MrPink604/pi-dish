import type { KatexRenderer, MathExtension } from './shared-helper-types';
import { escapeHtml } from './helper-format';
declare const katex: KatexRenderer | undefined;

/**
 * Neutralize URL schemes that execute script when a markdown link/image is
 * rendered into the DOM (the parsed markdown is written to innerHTML). Browsers
 * ignore whitespace and control characters spliced into a scheme, so strip
 * those before testing. Returns '#' for a blocked URL, otherwise the trimmed
 * original. Safe schemes (http/https/mailto), relative paths, and anchors pass.
 */
export function sanitizeMarkdownUrl(url: unknown) {
  const raw = String(url == null ? '' : url).trim();
  const scheme = raw.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (/^(javascript|vbscript|data):/.test(scheme)) return '#';
  return raw;
}

/**
 * Diagram fences. Agents emit mermaid regularly (```mermaid) and just as often
 * forget the language tag, leaving the reader a wall of `flowchart LR` source.
 * `diagramKindForFence` decides whether a fenced block is diagram source the
 * viewer should render: the language tag when it names one, else a sniff of
 * the source's own declaration line — but only for a fence whose tag claims
 * nothing about code (untagged, plaintext-ish, or `uml`).
 *
 * The sniff is anchored on mermaid's diagram declarations rather than "does it
 * parse", because the renderer is a lazily loaded ~1MB vendor script: a prose
 * fence must not pull it in. A false positive still degrades safely — the
 * render fails and the code block stays on screen.
 */
export const MERMAID_FENCE_LANGS = new Set(['mermaid', 'mmd']);


export const DIAGRAM_SNIFF_LANGS = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'diagram', 'uml']);

// mermaid v11 diagram declarations. The single-word families (`graph`,
// `flowchart`, `pie`) are pinned tighter than a bare keyword so prose opening
// "graph shows…" or "pie chart of…" doesn't read as a diagram.
export const MERMAID_DECLARATIONS = [
  /^(?:graph|flowchart(?:-elk)?)\s+(?:TB|TD|BT|RL|LR)\b/,
  /^(?:sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|mindmap|timeline|kanban|zenuml|quadrantChart|requirementDiagram|gitGraph|architecture-beta|block-beta|packet(?:-beta)?|radar-beta|sankey-beta|treemap(?:-beta)?|xychart-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/,
  /^pie(?:\s+(?:title|showData)\b|\s*$)/,
];

/**
 * The line that declares a mermaid diagram's type: the first meaningful line
 * after optional YAML front matter (`--- title: … ---`), `%%{init}%%`
 * directives and `%%` comments. '' when there is none.
 */
export function mermaidDeclarationLine(text: unknown) {
  const lines = String(text == null ? '' : text).split('\n');
  let i = 0;
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%%')) continue;
    return line;
  }
  return '';
}


export function looksLikeMermaid(text: unknown) {
  const decl = mermaidDeclarationLine(text);
  return !!decl && MERMAID_DECLARATIONS.some((re) => re.test(decl));
}

/** 'mermaid' when this fence should render as a diagram, else null. */
export function diagramKindForFence(lang: unknown, source: unknown) {
  const tag = String(lang == null ? '' : lang).trim().toLowerCase().split(/[\s,:;]/)[0];
  if (MERMAID_FENCE_LANGS.has(tag)) return 'mermaid';
  if (!DIAGRAM_SNIFF_LANGS.has(tag)) return null;
  return looksLikeMermaid(source) ? 'mermaid' : null;
}

/**
 * Relative-luminance test on a `#rgb`/`#rrggbb` string. The diagram renderer
 * derives its own shades from the theme's colors and needs to be told which
 * direction to go; every built-in theme is dark, but a user theme file
 * (~/.pi/dish/themes/*.json) may not be. Unparseable input reads as dark,
 * matching the default palette.
 */
export function isDarkColorHex(hex: unknown) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex == null ? '' : hex).trim());
  if (!m) return true;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.5;
}

/**
 * Marked extensions for LaTeX math rendering via KaTeX.
 * Supports:
 * - Block math: $$...$$ and \[...\] (multiline or single-line)
 * - Inline math: $...$, \(...\), and $$...$$ (within paragraphs)
 *
 * Avoids false positives on currency ($10 to $20) and escaped dollars (\$100).
 */
export function createMathExtensions(katexLib?: KatexRenderer | null) {
  const getKatex = () => katexLib || (typeof katex !== 'undefined' ? katex : null);

  const blockMath: MathExtension = {
    name: 'blockMath',
    level: 'block',
    start(src) {
      const match = src.match(/\$\$|\\\[/);
      return match ? match.index : -1;
    },
    tokenizer(src) {
      const match = /^(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])/.exec(src);
      if (match) {
        const text = match[1] !== undefined ? match[1] : match[2];
        return {
          type: 'blockMath',
          raw: match[0],
          text: text.trim(),
        };
      }
    },
    renderer(token) {
      const k = getKatex();
      if (!k) return `<pre class="math-block"><code>${escapeHtml(token.raw)}</code></pre>\n`;
      try {
        return `<div class="math-block">${k.renderToString(token.text, { displayMode: true, throwOnError: false })}</div>\n`;
      } catch (e) {
        return `<pre class="math-error"><code>${escapeHtml(token.raw)}</code></pre>\n`;
      }
    },
  };

  const inlineMath: MathExtension = {
    name: 'inlineMath',
    level: 'inline',
    start(src) {
      const match = src.match(/\$|\\\(|\\\[/);
      return match ? match.index : -1;
    },
    tokenizer(src) {
      const bracketMatch = /^\\\[([\s\S]*?)\\\]/.exec(src);
      if (bracketMatch) {
        return {
          type: 'inlineMath',
          raw: bracketMatch[0],
          text: bracketMatch[1].trim(),
          display: true,
        };
      }
      const parenMatch = /^\\\(([\s\S]*?)\\\)/.exec(src);
      if (parenMatch) {
        return {
          type: 'inlineMath',
          raw: parenMatch[0],
          text: parenMatch[1].trim(),
          display: false,
        };
      }
      const doubleDollarMatch = /^\$\$([\s\S]*?)\$\$/.exec(src);
      if (doubleDollarMatch) {
        return {
          type: 'inlineMath',
          raw: doubleDollarMatch[0],
          text: doubleDollarMatch[1].trim(),
          display: true,
        };
      }
      const dollarMatch = /^\$((?:\\\$|[^\$\s\n])(?:(?:\\\$|[^\$\n])*?(?:\\\$|[^\$\s\n]))?)\$/.exec(src);
      if (dollarMatch) {
        return {
          type: 'inlineMath',
          raw: dollarMatch[0],
          text: dollarMatch[1],
          display: false,
        };
      }
    },
    renderer(token) {
      const k = getKatex();
      if (!k) return escapeHtml(token.raw);
      try {
        return k.renderToString(token.text, { displayMode: Boolean(token.display), throwOnError: false });
      } catch (e) {
        return escapeHtml(token.raw);
      }
    },
  };

  return [blockMath, inlineMath];
}

/**
 * Whether a chat-mentioned token plausibly names a file the viewer could
 * open: one path-safe token (optionally ~/, ./, ../ or / rooted, optional
 * trailing :line[:col]) that carries a '/' or a letter-led extension. The
 * extension rule keeps versions ("1.2.3") and prose out while accepting
 * "findings.md"; false positives are cheap (the server 404s), false
 * negatives are a dead filename the user can't tap.
 */
export var FILE_MENTION_RE = /^(?:~\/|\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*(?::\d+(?::\d+)?)?$/;


export var FILE_EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;


export function looksLikeFilePath(text: unknown) {
  const s = String(text == null ? '' : text).trim();
  if (!s || s.length > 260) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false; // URLs
  if (!FILE_MENTION_RE.test(s)) return false;
  const stripped = s.replace(/:\d+(?::\d+)?$/, '');
  return stripped.includes('/') || FILE_EXT_RE.test(stripped);
}

/**
 * Path-looking tokens in plain prose (inline code is handled separately and
 * more permissively). Stricter than looksLikeFilePath: a bare word only
 * counts with a rooted prefix or a real extension — "and/or" and
 * "input/output" must not linkify — and domain-ish extensions are dropped
 * ("example.com" is prose, not a file). Returns [{ start, end, token }].
 */
export var PATH_TOKEN_RE = /(?:~\/|\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*(?::\d+(?::\d+)?)?/g;


export var BARE_EXT_STOPLIST = new Set(['com', 'org', 'net', 'io', 'ai', 'dev', 'co', 'app']);


export function findPathTokens(text: unknown) {
  const s = String(text == null ? '' : text);
  const out = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = PATH_TOKEN_RE.exec(s))) {
    // '.' is a path char, so a sentence period rides along — trim it.
    const token = m[0].replace(/[.,;:!?]+$/, '');
    if (!token) continue;
    const prev = s[m.index - 1];
    if (prev && /[\w.@:/+-]/.test(prev)) continue; // mid-URL / mid-word
    if (!looksLikeFilePath(token)) continue;
    const stripped = token.replace(/:\d+(?::\d+)?$/, '');
    const rooted = /^(?:~\/|\.{1,2}\/|\/)/.test(stripped);
    const ext = (stripped.match(FILE_EXT_RE) || [''])[0].slice(1);
    if (!rooted && !ext) continue;
    if (!rooted && !stripped.includes('/') && BARE_EXT_STOPLIST.has(ext.toLowerCase())) continue;
    out.push({ start: m.index, end: m.index + token.length, token });
  }
  return out;
}

/**
 * Render a unified diff's hunks as HTML lines for the diff modal. File-level
 * header lines (diff --git, index, ---/+++, mode/rename noise) are dropped —
 * the modal's file row already shows path and status; only content from the
 * first @@ onward renders. Returns '' for empty/missing patches.
 */
export function renderDiffHtml(patch: unknown) {
  if (!patch) return '';
  const out = [];
  let inHunk = false;
  let oldLine: number | null = null, newLine: number | null = null;
  const lines = String(patch).split('\n');
  // A patch's terminating newline is a separator, not an additional blank
  // source line. Real blank context lines still carry the unified-diff ' '.
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? Number(match[1]) : null;
      newLine = match ? Number(match[2]) : null;
      out.push(`<div class="diff-line diff-hunk" data-diff-line="1">${escapeHtml(line)}</div>`);
      continue;
    }
    if (!inHunk) continue;
    // Git's marker describes the preceding line; it is not itself a source
    // line and must not advance or expose old/new line coordinates.
    if (line[0] === '\\') {
      out.push(`<div class="diff-line diff-note">${escapeHtml(line)}</div>`);
      continue;
    }
    const cls = line[0] === '+' ? ' diff-add' : line[0] === '-' ? ' diff-del' : '';
    const oldAt = line[0] === '+' ? null : oldLine;
    const newAt = line[0] === '-' ? null : newLine;
    const attrs = ` data-diff-line="1" data-old-line="${oldAt ?? ''}" data-new-line="${newAt ?? ''}"`;
    out.push(`<div class="diff-line${cls}"${attrs}>${escapeHtml(line) || ' '}</div>`);
    if (line[0] !== '+' && oldLine != null) oldLine++;
    if (line[0] !== '-' && newLine != null) newLine++;
  }
  return out.join('');
}

/** CSS-safe class suffix for a git status letter (M/A/D/R/C/U/?/T). */
export function diffStatusClass(letter?: string) {
  switch (letter) {
    case 'A': case '?': return 'add';
    case 'D': return 'del';
    case 'R': case 'C': return 'ren';
    case 'U': return 'conflict';
    default: return 'mod';
  }
}
