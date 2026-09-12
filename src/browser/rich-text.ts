import type { MarkedRuntime, HighlightRuntime } from './rich-text-vendors';
import type { createBrowserAssets } from './browser-assets';
import type { createDiagrams } from './diagrams';
import { escapeHtml } from './helper-format';
import { sanitizeMarkdownUrl, createMathExtensions, diagramKindForFence, looksLikeFilePath, findPathTokens } from './helper-markdown';
import type { SessionState } from './session-state';
import { record } from './helper-values';
export function createRichText(options: { document: Document; marked: MarkedRuntime | null; highlight: () => HighlightRuntime | null;
  assets: ReturnType<typeof createBrowserAssets>; diagrams: ReturnType<typeof createDiagrams>; sessionState: SessionState;
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
  let disposed = false, mathAssetsPromise: Promise<void[]> | null = null, highlightAssetsPromise: Promise<HighlightRuntime> | null = null;
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
    extensions: createMathExtensions(),
  });
function formatMarkdown(text: string) {
  if (!text) return '';
  if (options.marked) { try { return options.marked.parse(text); } catch(e) {} }
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => `<pre><code class="language-${lang}">${code.trim()}</code></pre>`);
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

  root.querySelectorAll<HTMLElement>('.markdown-body:not([data-linkified])').forEach(body => {
    body.dataset.linkified = '1';
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        // .diagram-render holds an SVG: a <span> spliced into an SVG <text>
        // renders nothing, so a linkified label would silently vanish.
        return n.parentElement && !n.parentElement.closest('code, a, pre, .file-link, .katex, .math-block, .diagram-render')
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


  function loadMathAssets() {
    if (disposed) return Promise.reject(new Error('Rich text disposed'));
    return mathAssetsPromise ||= Promise.all([
      options.assets.load('link', { rel: 'stylesheet', href: 'vendor/katex.min.css' }),
      options.assets.load('script', { src: 'vendor/katex.min.js' }),
    ]).catch(error => { mathAssetsPromise = null; throw error; });
  }
  function loadHighlightAssets() {
    if (disposed) return Promise.reject(new Error('Rich text disposed'));
    return highlightAssetsPromise ||= Promise.all([
      options.assets.load('link', { rel: 'stylesheet', href: 'vendor/hljs-theme.min.css' }),
      options.assets.load('script', { src: 'vendor/highlight.js' }),
    ]).then(() => { const runtime = options.highlight(); if (!runtime) throw new Error('Syntax highlighter did not load'); return runtime; })
      .catch(error => { highlightAssetsPromise = null; throw error; });
  }
  return { format: formatMarkdown, highlight: applyHighlight, loadMath: loadMathAssets, dispose() { disposed = true; events.abort(); copies = new WeakMap(); for (const timer of copyTimers) clearTimeout(timer); copyTimers.clear(); } };
}
