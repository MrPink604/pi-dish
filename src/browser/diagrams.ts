import type { MermaidRuntime, MermaidConfig } from './rich-text-vendors';
import type { createBrowserAssets } from './browser-assets';
import { resolveColorToHex } from './host-presentation';
import { isDarkColorHex } from './helper-markdown';
const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * The theme tokens agents are told to color SVG with (omp's rendering
 * contract), mapped to this app's own tokens.
 */
const SVG_THEME_TOKENS: Readonly<Record<string, string>> = {
  '--fg': '--text', '--muted': '--text-muted', '--border': '--border', '--surface': '--bg-card', '--bg': '--bg-darker',
  '--accent': '--accent', '--success': '--success', '--warning': '--warning', '--error': '--error',
  '--c1': '--chart-1', '--c2': '--chart-2', '--c3': '--chart-3', '--c4': '--chart-4', '--c5': '--chart-5', '--c6': '--success',
};
/** A fence that is not an SVG document: its message is shown as the render error. */
class SvgSourceError extends Error {}
export function createDiagrams(options: {
  document: Document; assets: ReturnType<typeof createBrowserAssets>; runtime: () => MermaidRuntime | null;
  retainedRoots: () => readonly ParentNode[]; isPinned: (feed: HTMLElement) => boolean; scrollBottom: (feed: HTMLElement) => void;
}) {
  const { document } = options, window = document.defaultView!;
  let disposed = false, themeGeneration = 0;
  interface RenderOwner { readonly generation: number; readonly source: string }
  let renders = new WeakMap<HTMLElement, RenderOwner>();
  const tasks = new Set<ReturnType<typeof setTimeout>>();
  let lightbox: { element: HTMLElement; events: AbortController } | null = null;
  function closeLightbox() { lightbox?.events.abort(); lightbox?.element.remove(); lightbox = null; }
  function owns(block: HTMLElement, owner: RenderOwner) { return !disposed && owner.generation === themeGeneration && renders.get(block) === owner && block.querySelector('pre code')?.textContent === owner.source; }

let mermaidPromise: Promise<MermaidRuntime> | null = null;
// Theme generation mermaid was last initialized for; a theme change makes the
// next render pass re-initialize before rendering.
let mermaidGeneration = -1;
let diagramSeq = 0;

function loadMermaid() {
  if (disposed) return Promise.reject(new Error('Diagrams disposed'));
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = options.assets.load('script', { src: 'vendor/mermaid.min.js' }).then(() => {
    const mermaid = options.runtime();
    if (!mermaid) throw new Error('mermaid did not load');
    if (disposed) throw new Error('Diagrams disposed');
    return mermaid;
  }).catch((err) => {
    mermaidPromise = null; // a dropped LAN connection must not be permanent
    throw err;
  });
  return mermaidPromise;
}

/**
 * mermaid config derived from the live theme tokens, the way terminalTheme()
 * derives xterm's palette. Tokens are resolved to concrete hex first: several
 * are color-mix() over another token, and mermaid does color math (lighten,
 * darken, contrast) on whatever it is handed.
 */
function mermaidConfig(): MermaidConfig {
  const css = window.getComputedStyle(document.documentElement);
  const hex = (name: string, fallback: string) => resolveColorToHex(css.getPropertyValue(name).trim(), document) || fallback;
  const bg = hex('--bg-darker', '#00212b');
  const card = hex('--bg-card', '#073642');
  const hover = hex('--bg-hover', '#0b4354');
  const text = hex('--text-bright', '#dbe5e6');
  const muted = hex('--text-muted', '#6f8b93');
  const border = hex('--accent-dim', '#1c6ba3');
  const line = hex('--border', '#11475a');
  return {
    startOnLoad: false,
    // The SVG is written into transcript DOM, so mermaid's own sanitizer is
    // what keeps diagram-authored HTML labels (<br>, <b>) inert.
    securityLevel: 'strict',
    // A failed render must leave the code block standing, not mermaid's own
    // error graphic.
    suppressErrorRendering: true,
    theme: 'base',
    fontFamily: window.getComputedStyle(document.body).fontFamily,
    flowchart: { htmlLabels: true, useMaxWidth: true },
    themeVariables: {
      darkMode: isDarkColorHex(bg),
      background: bg,
      primaryColor: card,
      primaryTextColor: text,
      primaryBorderColor: border,
      secondaryColor: hover,
      secondaryTextColor: text,
      tertiaryColor: bg,
      tertiaryTextColor: text,
      lineColor: muted,
      textColor: text,
      mainBkg: card,
      nodeBorder: border,
      clusterBkg: bg,
      clusterBorder: line,
      titleColor: text,
      edgeLabelBackground: bg,
      labelBoxBkgColor: card,
      labelBoxBorderColor: border,
      actorBkg: card,
      actorBorder: border,
      actorTextColor: text,
      signalColor: muted,
      signalTextColor: text,
      noteBkgColor: hover,
      noteBorderColor: border,
      noteTextColor: text,
      fontSize: '14px',
    },
  };
}

/**
 * Equip a wrapped code block for diagram rendering: the source/zoom controls
 * join the copy button in one actions row. Idempotent — `data-diagram` is the
 * marker, and CSS keeps the controls hidden until an SVG actually lands.
 */
function prepareDiagramBlock(block: HTMLElement | null, kind: string) {
  if (disposed || !block || block.dataset.diagram) return;
  block.dataset.diagram = kind;
  block.classList.add('diagram-block');
  const actions = document.createElement('div');
  actions.className = 'diagram-actions';
  const source = document.createElement('button');
  source.className = 'diagram-btn diagram-source-btn';
  source.title = 'Show diagram source';
  source.textContent = '</>';
  const zoom = document.createElement('button');
  zoom.className = 'diagram-btn diagram-zoom-btn';
  zoom.title = 'Zoom diagram';
  zoom.textContent = '⤢';
  actions.append(source, zoom);
  const copy = block.querySelector('.code-copy-btn');
  if (copy) actions.append(copy);
  block.prepend(actions);
}

/**
 * Render every diagram block under `root` that hasn't been rendered yet.
 * Fire-and-forget: the code block stays on screen until the SVG replaces it,
 * so a slow (or absent) renderer never blanks content.
 */
function renderDiagrams(root: ParentNode) {
  const blocks = [...root.querySelectorAll<HTMLElement>('.diagram-block:not([data-diagram-state])')];
  if (disposed || !blocks.length) return;
  const pending = blocks.map(block => {
    const owner: RenderOwner = { generation: themeGeneration, source: block.querySelector('pre code')?.textContent || '' };
    renders.set(block, owner); block.dataset.diagramState = 'loading'; return { block, owner };
  });
  // Deferred a task, never started inside the render pass that found the
  // blocks. mermaid.render() does its parsing and layout in heavy chunks
  // between awaits, so once mermaid is loaded a render started here would run
  // in the same microtask checkpoint as the transcript load's own
  // continuations (loadMessages → selectSession → whatever awaits them),
  // paying the diagram layout before the text paints. It also broke the
  // browser smoke: a CDP `awaitPromise` holds the awaited promise only weakly
  // once it settles, and a GC in that checkpoint reported it "collected"
  // (Playwright's "Execution context was destroyed") while the app's own
  // chain completed fine. A task boundary separates the two.
  const timer = setTimeout(() => {
    tasks.delete(timer); if (disposed) return;
    for (const { block, owner } of pending) if (block.dataset.diagram === 'svg' && owns(block, owner)) void renderSvgBlock(block, owner);
    // SVG fences need no renderer: only mermaid blocks pull the bundle in.
    const mermaidBlocks = pending.filter(({ block }) => block.dataset.diagram === 'mermaid');
    if (!mermaidBlocks.length) return;
    loadMermaid().then(
      m => {
        if (disposed) return;
        if (mermaidGeneration !== themeGeneration) { m.initialize(mermaidConfig()); mermaidGeneration = themeGeneration; }
        for (const { block, owner } of mermaidBlocks) if (owns(block, owner)) void renderDiagramBlock(m, block, owner);
      },
      () => { for (const { block, owner } of mermaidBlocks) if (owns(block, owner)) setDiagramError(block, 'diagram renderer unavailable'); },
    );
  }, 0); tasks.add(timer);
}

/** Whether `block` sits in the live feed while it is pinned to the bottom. */
function pinnedFeed(block: HTMLElement) {
  const feed = document.getElementById('messages');
  return feed && feed.contains(block) && options.isPinned(feed) ? feed : null;
}

/**
 * Put a finished render in front of the source. The render is taller than its
 * source, so a reader sitting at the bottom of a live feed (measured before
 * the render started and again now) must be carried down with it.
 */
function showRender(block: HTMLElement, pinned: HTMLElement | null, fill: (figure: Element) => void) {
  const stillPinned = pinned && pinned.contains(block) && options.isPinned(pinned);
  let figure = block.querySelector('.diagram-render');
  if (!figure) {
    figure = document.createElement('div');
    figure.className = 'diagram-render';
    block.insertBefore(figure, block.querySelector('pre'));
  }
  fill(figure);
  block.querySelector('.diagram-error')?.remove();
  block.classList.remove('diagram-failed');
  block.dataset.diagramState = 'rendered';
  if (stillPinned) options.scrollBottom(pinned);
}

async function renderDiagramBlock(m: MermaidRuntime, block: HTMLElement, owner: RenderOwner) {
  const code = block.querySelector('pre code');
  if (!code) { block.dataset.diagramState = 'error'; return; }
  const pinned = pinnedFeed(block);
  try {
    // mermaid measures text in a throwaway element it appends to <body>, so
    // this works for a block inside a closed tool group or a cached
    // (detached) transcript fragment.
    const { svg } = await m.render(`pi-dish-diagram-${++diagramSeq}`, owner.source);
    if (!owns(block, owner)) return;
    // mermaid sanitized this string (securityLevel strict). Diagram `click`
    // interactions are deliberately left unbound — bindFunctions() would wire
    // diagram-authored callbacks and link navigation into the app.
    showRender(block, pinned, figure => { figure.innerHTML = svg; });
  } catch (err) {
    // mermaid's message is a multi-line parser dump; its first line ("Parse
    // error on line 2:") is the only part worth a quiet note.
    if (!owns(block, owner)) return;
    setDiagramError(block, String(err instanceof Error ? err.message : err).split('\n')[0].replace(/:\s*$/, ''));
  }
}

/**
 * An agent-authored ```svg fence. It is shown through an <img>, never inlined:
 * an SVG image document runs no script, loads nothing external and cannot
 * reach the app's DOM, so the source needs no sanitizer. The price is that
 * the page's CSS doesn't reach inside, so the theme tokens agents draw with
 * (`var(--fg)`, `--muted`, `--accent`, `--c1`…) are written into the image as
 * concrete colors at render time — which is why a theme change re-renders it.
 */
async function renderSvgBlock(block: HTMLElement, owner: RenderOwner) {
  const pinned = pinnedFeed(block);
  const img = document.createElement('img');
  img.className = 'diagram-image';
  img.alt = 'SVG diagram';
  try {
    img.src = svgImageUrl(owner.source);
    await img.decode();
  } catch (err) {
    if (owns(block, owner)) setDiagramError(block, err instanceof SvgSourceError ? err.message : 'SVG did not render');
    return;
  }
  if (owns(block, owner)) showRender(block, pinned, figure => { figure.replaceChildren(img); });
}

/** The fence as a self-contained, theme-resolved `data:` image URL. */
function svgImageUrl(source: string) {
  // An image document needs the SVG namespace declared; agents often omit it.
  const open = /<svg(?=[\s>])[^>]*>/.exec(source);
  if (!open) throw new SvgSourceError('invalid SVG: no <svg> element');
  const declare = [
    /\sxmlns\s*=/.test(open[0]) ? '' : ` xmlns="${SVG_NS}"`,
    /xlink:/.test(source) && !/\sxmlns:xlink\s*=/.test(open[0]) ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : '',
  ].join('');
  const text = declare ? source.slice(0, open.index + 4) + declare + source.slice(open.index + 4) : source;
  const doc = new window.DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || root.namespaceURI !== SVG_NS || root.localName !== 'svg') throw new SvgSourceError('invalid SVG');
  const css = window.getComputedStyle(document.documentElement);
  const resolved = (token: string) => resolveColorToHex(css.getPropertyValue(token).trim(), document);
  const vars = Object.entries(SVG_THEME_TOKENS).flatMap(([name, token]) => { const hex = resolved(token); return hex ? [`${name}:${hex}`] : []; });
  const style = doc.createElementNS(SVG_NS, 'style');
  style.textContent = `:root{${vars.join(';')}}`;
  root.insertBefore(style, root.firstChild);
  // Unpainted shapes and text default to black, unreadable on a dark theme:
  // the theme's foreground stands in, unless the drawing sets its own.
  const fg = resolved(SVG_THEME_TOKENS['--fg']);
  if (fg && !root.hasAttribute('color')) root.setAttribute('color', fg);
  if (!root.hasAttribute('fill')) root.setAttribute('fill', 'currentColor');
  if (!root.hasAttribute('font-family')) root.setAttribute('font-family', window.getComputedStyle(document.body).fontFamily);
  // Without an absolute size an <img> falls back to 300×150; the viewBox is
  // the drawing's own scale.
  const box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const relative = (name: string) => !root.hasAttribute(name) || /%\s*$/.test(root.getAttribute(name) || '');
  if (box.length === 4 && box[2] > 0 && box[3] > 0 && relative('width') && relative('height')) {
    root.setAttribute('width', String(box[2]));
    root.setAttribute('height', String(box[3]));
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new window.XMLSerializer().serializeToString(doc))}`;
}

/** Keep the source visible and say why it stayed source. */
function setDiagramError(block: HTMLElement, message: string) {
  block.dataset.diagramState = 'error';
  block.classList.add('diagram-failed');
  let note = block.querySelector('.diagram-error');
  if (!note) {
    note = document.createElement('div');
    note.className = 'diagram-error';
    block.insertBefore(note, block.querySelector('pre'));
  }
  note.textContent = `⚠ ${message}`;
}

function toggleDiagramSource(block: HTMLElement) {
  if (disposed) return;
  const showing = block.classList.toggle('diagram-source');
  const btn = block.querySelector<HTMLButtonElement>('.diagram-source-btn');
  if (btn) {
    btn.textContent = showing ? '▦' : '</>';
    btn.title = showing ? 'Show diagram' : 'Show diagram source';
  }
}

/**
 * Zoom a rendered diagram. Inside the reading column a wide flowchart shrinks
 * to unreadable, so the overlay shows the SVG at its own size in a scrollable
 * stage with explicit zoom steps — a phone has no wheel, and pinch-zoom inside
 * a fixed overlay is not dependable.
 */
function openDiagramLightbox(block: HTMLElement) {
  const media = block.querySelector<SVGSVGElement | HTMLImageElement>('.diagram-render svg, .diagram-render img');
  if (disposed || !media) return;
  closeLightbox();
  let baseW: number, baseH: number;
  if ('naturalWidth' in media) {
    baseW = media.naturalWidth || 800;
    baseH = media.naturalHeight || 600;
  } else {
    const box = media.viewBox && media.viewBox.baseVal;
    const rect = media.getBoundingClientRect();
    baseW = (box && box.width) || rect.width || 800;
    baseH = (box && box.height) || rect.height || 600;
  }

  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay diagram-lightbox';
  const events = new AbortController(); lightbox = { element: overlay, events };
  const current = () => !disposed && lightbox?.element === overlay && overlay.isConnected;
  const bar = document.createElement('div');
  bar.className = 'diagram-zoom-bar';
  const stage = document.createElement('div');
  stage.className = 'diagram-stage';
  const clone = media.cloneNode(true) as SVGSVGElement | HTMLImageElement;
  clone.removeAttribute('style'); // mermaid's own max-width fights the zoom
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  stage.appendChild(clone);
  overlay.append(bar, stage);
  document.body.appendChild(overlay);

  const fitScale = () => Math.max(0.1, Math.min(1, (stage.clientWidth - 24) / baseW, (stage.clientHeight - 24) / baseH));
  let scale = fitScale();
  const label = document.createElement('span');
  label.className = 'diagram-zoom-label';
  const apply = () => {
    clone.style.width = `${Math.round(baseW * scale)}px`;
    clone.style.height = `${Math.round(baseH * scale)}px`;
    label.textContent = `${Math.round(scale * 100)}%`;
  };
  const step = (factor: number) => { scale = Math.min(8, Math.max(0.1, scale * factor)); apply(); };
  const button = (text: string, title: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.className = 'diagram-btn';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', () => { if (current()) onClick(); }, { signal: events.signal });
    return b;
  };
  bar.append(
    button('−', 'Zoom out', () => step(1 / 1.25)),
    label,
    button('+', 'Zoom in', () => step(1.25)),
    button('⤾', 'Fit to screen', () => { scale = fitScale(); apply(); }),
    button('✕', 'Close', closeLightbox),
  );
  apply();
  // Backdrop only — clicks on the diagram itself are for panning/selection.
  overlay.addEventListener('click', e => { if (current() && (e.target === overlay || e.target === stage)) closeLightbox(); }, { signal: events.signal });
}

/**
 * Theme change: diagram colors are baked into each render (mermaid's config,
 * an SVG fence's resolved tokens), so re-render what's on screen — plus the
 * retained transcripts, which are restored without another applyHighlight
 * pass. Mermaid re-initializes on its next render pass.
 */
function refreshDiagramTheme() {
  if (disposed) return;
  themeGeneration++;
  for (const root of [document, ...options.retainedRoots()]) {
    root.querySelectorAll<HTMLElement>('.diagram-block[data-diagram-state]').forEach((block) => {
      block.querySelector('.diagram-render')?.remove();
      delete block.dataset.diagramState;
    });
    renderDiagrams(root);
  }
}

  return { prepare: prepareDiagramBlock, render: renderDiagrams, toggleSource: toggleDiagramSource, openLightbox: openDiagramLightbox,
    refreshTheme: refreshDiagramTheme, dispose() { disposed = true; themeGeneration++; renders = new WeakMap(); for (const timer of tasks) clearTimeout(timer); tasks.clear(); closeLightbox(); },
  };
}
