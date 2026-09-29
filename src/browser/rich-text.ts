import type { MarkedRuntime, HighlightRuntime, MarkdownToken } from './rich-text-vendors';
import type { KatexRenderer } from '../core/helper-types';
import type { createBrowserAssets } from './browser-assets';
import type { createDiagrams } from './diagrams';
import { escapeHtml } from '../core/helper-format';
import { createMathExtensions } from '../core/helper-markdown';
import { sanitizeMarkdownUrl, diagramKindForFence, looksLikeFilePath, findPathTokens } from './helper-markdown';
import type { SessionState } from './session-state';
import type { StreamingBlockState, StreamingFrame } from './streaming-render';
import { record } from '../core/helper-values';

declare const katex: KatexRenderer | undefined;
const MATH_PENDING_CLASS = 'math-pending', MATH_SOURCE_ATTR = 'data-math-source';
// Set by the placeholder renderer, so "this document needed KaTeX" comes from
// the shared math tokenizer actually rendering a token — never from matching
// text that merely mentions the attribute.
let pendingMathRenders = 0;

/**
 * KaTeX stand-in used until the real bundle loads: it keeps the token's exact
 * TeX (escaped) and the display mode the shared renderer chose, so hydration
 * reproduces `katex.renderToString` exactly — and stays inert if it never loads.
 */
const pendingKatex: KatexRenderer = {
  renderToString(source, options) {
    pendingMathRenders++;
    const display = Boolean(options.displayMode);
    return `<span class="${MATH_PENDING_CLASS}" ${MATH_SOURCE_ATTR}="${escapeHtml(source)}" data-math-display="${display}">${escapeHtml(display ? `$$${source}$$` : `$${source}$`)}</span>`;
  },
};

function mathRuntime(): KatexRenderer | null { return typeof katex === 'undefined' ? null : katex; }

/**
 * Top-level block types that may be finalized at all; an unknown/extension
 * token type always stops the committed prefix.
 */
const STABLE_BLOCK_TYPES: Record<string, true> = {
  heading: true, paragraph: true, space: true, code: true, blockquote: true, table: true, hr: true, html: true, blockMath: true, list: true,
};
/**
 * Types that definitively end a list when they follow it across a blank line. A
 * paragraph or another list can still become one of its items (an unfinished
 * marker only needs a `.` to merge into the list above it), so those never let
 * the list be finalized.
 */
const LIST_TERMINATORS: Record<string, true> = { heading: true, code: true, html: true, hr: true, table: true };

/**
 * Length of `source`'s finalized block prefix: the source every later line is
 * powerless to change. Only a blank line closes a block — a paragraph, table,
 * fence or setext underline otherwise still absorbs what follows — the block
 * before that blank line must not be able to continue past it (a list takes
 * another item, a blockquote another `>` line), the boundary must land on a
 * line start (leading whitespace decides indented code versus paragraph), and
 * every preceding token must be a type that can be finalized at all.
 */
function stablePrefixEnd(source: string, tokens: readonly MarkdownToken[]) {
  const ends: number[] = [], nextContent: (string | null)[] = new Array(tokens.length).fill(null);
  let total = 0, seen: string | null = null;
  for (let i = tokens.length - 1; i >= 0; i--) { nextContent[i] = seen; if (tokens[i].type !== 'space') seen = tokens[i].type; }
  for (const token of tokens) { total += token.raw.length; ends.push(total); }
  let end = 0, previous: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'space') {
      if (STABLE_BLOCK_TYPES[token.type] !== true) break;
      previous = token.type;
      continue;
    }
    const terminator = nextContent[i];
    if (previous === 'list' && (terminator === null || LIST_TERMINATORS[terminator] !== true)) break;
    if (previous === 'blockquote' && terminator === 'blockquote') break;
    if (source[ends[i] - 1] === '\n') end = ends[i];
  }
  return end;
}
export function createRichText(options: { document: Document; marked: MarkedRuntime | null; highlight: () => HighlightRuntime | null;
  assets: ReturnType<typeof createBrowserAssets>; diagrams: ReturnType<typeof createDiagrams>; sessionState: SessionState;
  retainedRoots?: () => readonly ParentNode[];
  copy: (text: string) => Promise<unknown>; status: (message: string, type?: string) => void;
}) {
  const { document, sessionState } = options;
  const events = new AbortController(), copyTimers = new Set<ReturnType<typeof setTimeout>>();
  let copies = new WeakMap<HTMLElement, symbol>();
  document.addEventListener('click', event => {
    if (disposed || !(event.target instanceof Element)) return;
    const copy = event.target.closest<HTMLElement>('.code-copy-btn');
    if (copy) {
      const owner = sessionState.captureSelection(), token = Symbol(); copies.set(copy, token);
      const current = () => !disposed && copy.isConnected && copies.get(copy) === token && (owner ? sessionState.ownsSelection(owner) : !sessionState.currentSession);
      const source = copy.closest('.code-block')?.querySelector('pre code')?.textContent || '';
      void options.copy(source).then(() => {
        if (!current()) return; copy.textContent = '✓';
        const timer = setTimeout(() => { copyTimers.delete(timer); if (current()) copy.textContent = '⧉'; }, 1200); copyTimers.add(timer);
      }, () => { if (current()) options.status('Copy failed (clipboard blocked)', 'error'); });
      return;
    }
    const block = event.target.closest<HTMLElement>('.diagram-block'); if (!block) return;
    if (event.target.closest('.diagram-source-btn')) options.diagrams.toggleSource(block);
    else if (event.target.closest('.diagram-zoom-btn')) options.diagrams.openLightbox(block);
  }, { signal: events.signal });
  let disposed = false, mathAssetsPromise: Promise<void> | null = null, highlightAssetsPromise: Promise<HighlightRuntime> | null = null;
  options.marked?.use({
    breaks: true,
    gfm: true,
    // Marked's GFM tokenizer accepts both ~text~ and ~~text~~ as deletion.
    // Models commonly use a single tilde literally (paths, approximation,
    // shell syntax), so require the explicit double-tilde form instead.
    tokenizer: {
      del(src) {
        const cap = /^(~~)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]|$)/.exec(src);
        if (!cap) return;
        return {
          type: 'del',
          raw: cap[0],
          text: cap[2],
          tokens: this.lexer.inlineTokens(cap[2]),
        };
      },
    },
    renderer: {
      html(html) { return escapeHtml(typeof html === 'string' ? html : record(html) && typeof html.text === 'string' ? html.text : ''); },
    },
    walkTokens(token) {
      if (token.type === 'link' || token.type === 'image') token.href = sanitizeMarkdownUrl(token.href);
    },
    // Math renders through the shared KaTeX tokenizer. While the bundle is
    // absent its renderer emits an inert, source-carrying placeholder instead
    // of guessed markup, so a transcript paints immediately and hydration
    // swaps in the exact KaTeX output later (live DOM and cached fragments).
    extensions: createMathExtensions(() => mathRuntime() || pendingKatex),
  });
function formatMarkdown(text: string) {
  if (!text) return '';
  if (options.marked) {
    try {
      const renders = pendingMathRenders;
      const html = options.marked.parse(text);
      // The placeholder renderer is the only signal that a math token really
      // was parsed while KaTeX is absent — no matching of text that merely
      // mentions the attribute, so math-free markdown loads nothing.
      if (pendingMathRenders !== renders && !mathRuntime()) void loadMathAssets().catch(() => {});
      return html;
    } catch(e) {}
  }
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => `<pre><code class="language-${lang}">${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

// Post-render pass over final markdown: syntax-highlight fenced code blocks,
// give each one a copy button, and turn diagram fences into rendered
// diagrams. Runs after final renders only — streaming re-renders skip it to
// stay cheap (and half a diagram is not parseable anyway) — and must stay
// idempotent (it re-runs on every append/prepend). The wrapper div keeps the
// button pinned while the <pre> scrolls horizontally (an absolutely
// positioned child of the <pre> would scroll away with the overflowing
// content).
function applyHighlight(el?: ParentNode | null) {
  const root = el || document.getElementById('messages');
  if (disposed || !root) return;
  const pendingHighlight: { code: HTMLElement; source: string }[] = [];
  root.querySelectorAll<HTMLElement>('.markdown-body pre code').forEach(code => {
    const pre = code.closest('pre');
    if (pre && !pre.parentElement?.classList.contains('code-block')) {
      const wrap = document.createElement('div');
      wrap.className = 'code-block';
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.title = 'Copy code';
      btn.textContent = '⧉';
      pre.replaceWith(wrap);
      wrap.append(btn, pre);
    }
    const kind = diagramKindForFence(fenceLanguage(code), code.textContent);
    if (kind) {
      options.diagrams.prepare(pre?.parentElement || null, kind);
      // hljs has no mermaid grammar in the common bundle, so highlighting the
      // source view would only be auto-detection noise.
      code.dataset.highlighted = 'diagram';
    }
    if (code.dataset.highlighted) return;
    const hljs = options.highlight();
    if (!hljs) {
      pendingHighlight.push({ code, source: code.textContent || '' });
      return;
    }
    try { hljs.highlightElement(code); } catch (e) {}
  });
  if (pendingHighlight.length) {
    loadHighlightAssets().then(hljs => {
      if (disposed) return;
      for (const { code, source } of pendingHighlight) {
        if (code.dataset.highlighted || code.textContent !== source) continue;
        try { hljs.highlightElement(code); } catch (e) {}
      }
    }).catch(() => {});
  }
  // A root can hold math parsed while the bundle was still in flight (a
  // restored cached fragment, a final render racing the asset load).
  hydrateMath(root);
  options.diagrams.render(root);
  linkifyFilePaths(root);
}

/** The fence's declared language, from marked's `language-x` class. */
function fenceLanguage(code: HTMLElement) {
  const cls = [...code.classList].find((c) => c.startsWith('language-'));
  return cls ? cls.slice('language-'.length) : '';
}

// Mark file mentions clickable: inline code spans and tool-call summaries
// whose whole text looks like a path, plus path tokens inside plain prose
// (findPathTokens in helper-markdown.ts). Runs inside applyHighlight so every final
// render gets it; idempotent — linked elements are skipped and each
// .markdown-body's prose is walked once (data-linkified). Clicks are
// delegated on document → openFileViewer.
function linkifyFilePaths(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.markdown-body code, .tool-call-summary, .live-tool-summary').forEach(el => {
    if (el.closest('pre') || el.classList.contains('file-link') || el.children.length) return;
    if (looksLikeFilePath((el.textContent || '').trim())) {
      el.classList.add('file-link');
      el.title = 'Open file';
    }
  });

  // Markdown links whose href is a bare file path — agents cite evidence as
  // [label](../out/summary.json) — would navigate the hub tab to a 404.
  // Strip the dead href and let the delegated click open the file viewer on
  // the path instead (data-file-path, read by app.ts).
  root.querySelectorAll<HTMLAnchorElement>('.markdown-body a[href]').forEach(link => {
    if (link.classList.contains('file-link')) return;
    const href = (link.getAttribute('href') || '').trim();
    if (!looksLikeFilePath(href)) return;
    link.classList.add('file-link');
    link.title = 'Open file';
    link.dataset.filePath = href;
    link.removeAttribute('href');
  });

  root.querySelectorAll<HTMLElement>('.markdown-body:not([data-linkified])').forEach(body => {
    body.dataset.linkified = '1';
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        // .diagram-render holds an SVG: a <span> spliced into an SVG <text>
        // renders nothing, so a linkified label would silently vanish.
        return n.parentElement && !n.parentElement.closest('code, a, pre, .file-link, .katex, .math-block, .math-pending, .diagram-render')
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const tokens = findPathTokens(node.data);
      if (!tokens.length) continue;
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const t of tokens) {
        frag.append(node.data.slice(pos, t.start));
        const span = document.createElement('span');
        span.className = 'file-link';
        span.title = 'Open file';
        span.textContent = t.token;
        frag.append(span);
        pos = t.end;
      }
      frag.append(node.data.slice(pos));
      node.replaceWith(frag);
    }
  });
}


  /**
   * Reparse only what streaming has not finalized. Only the uncommitted tail is
   * lexed each frame (everything before the previous boundary is already
   * verified committed source), and `'grow'` hands back just the newly-final
   * source's HTML plus the still-changing tail. `'replace'` is the conservative
   * full re-render: the first frame, a rewritten/non-prefix frame, a retreat
   * (a boundary that stopped being final), or a scan whose token raws do not
   * cover it — CRLF/tab normalization, or a reference definition, which can also
   * retroactively resolve links in already-committed source.
   */
  function streamMarkdown(previous: StreamingBlockState | null, text: string): StreamingFrame | null {
    if (!options.marked) return null;
    const appendOnly = previous !== null && previous.stableEnd <= text.length && text.startsWith(previous.text);
    const commitFrom = appendOnly && previous ? previous.stableEnd : 0;
    const scan = text.slice(commitFrom);
    let tokens: readonly MarkdownToken[];
    try { tokens = options.marked.lexer(scan); } catch { return null; }
    let covered = 0; for (const token of tokens) covered += token.raw.length;
    const stableEnd = covered === scan.length ? commitFrom + stablePrefixEnd(scan, tokens) : 0;
    if (appendOnly && previous && previous.stableEnd <= stableEnd) {
      return { mode: 'grow', stableEnd, stableHtml: formatMarkdown(text.slice(previous.stableEnd, stableEnd)), tailHtml: formatMarkdown(text.slice(stableEnd)) };
    }
    return { mode: 'replace', stableEnd, stableHtml: formatMarkdown(text.slice(0, stableEnd)), tailHtml: formatMarkdown(text.slice(stableEnd)) };
  }

  /** Swap inert math placeholders for real KaTeX output; idempotent. */
  function hydrateMath(root: ParentNode) {
    const runtime = mathRuntime(); if (disposed || !runtime) return;
    for (const el of root.querySelectorAll<HTMLElement>('.' + MATH_PENDING_CLASS)) {
      const source = el.getAttribute(MATH_SOURCE_ATTR) || '';
      let html: string; try { html = runtime.renderToString(source, { displayMode: el.getAttribute('data-math-display') === 'true', throwOnError: false }); } catch { continue; }
      const template = document.createElement('template'); template.innerHTML = html;
      el.replaceWith(template.content);
    }
  }

  /** Retained transcript fragments are detached from the document, so the
   *  asset-completion pass reaches them through their cache roots too. */
  function hydrateMathRoots() {
    hydrateMath(document);
    for (const root of options.retainedRoots?.() || []) hydrateMath(root);
  }

  /** Load KaTeX on demand and hydrate every pending placeholder once it lands.
   *  A transcript with no math never asks for it. */
  function loadMathAssets() {
    if (disposed) return Promise.reject(new Error('Rich text disposed'));
    return mathAssetsPromise ||= Promise.all([
      options.assets.load('link', { rel: 'stylesheet', href: 'vendor/katex.min.css' }),
      options.assets.load('script', { src: 'vendor/katex.min.js' }),
    ]).then(() => { if (!disposed) hydrateMathRoots(); })
      .catch(error => { mathAssetsPromise = null; throw error; });
  }
  function loadHighlightAssets() {
    if (disposed) return Promise.reject(new Error('Rich text disposed'));
    return highlightAssetsPromise ||= Promise.all([
      options.assets.load('link', { rel: 'stylesheet', href: 'vendor/hljs-theme.min.css' }),
      options.assets.load('script', { src: 'vendor/highlight.js' }),
    ]).then(() => { const runtime = options.highlight(); if (!runtime) throw new Error('Syntax highlighter did not load'); return runtime; })
      .catch(error => { highlightAssetsPromise = null; throw error; });
  }
  return { format: formatMarkdown, stream: streamMarkdown, highlight: applyHighlight, dispose() { disposed = true; events.abort(); copies = new WeakMap(); for (const timer of copyTimers) clearTimeout(timer); copyTimers.clear(); } };
}
