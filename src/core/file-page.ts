import * as path from 'path';
import { createHash } from 'node:crypto';
import { Marked } from 'marked';
import type { TokenizerThis } from 'marked';
import hljs from 'highlight.js';
import * as katex from 'katex';
import { createMathExtensions } from './helper-markdown.js';
import { escapeHtml } from './helper-format';
import { formatMediaSize, mediaFileName, renderVideoSummary, videoMimeForPath } from './helper-media';
import type { FileViewerFile } from './file-mention';

export interface FilePageOptions {
  token: string;
  root: string;
  title?: unknown;
  file: FileViewerFile;
}

interface HighlightedCode {
  html: string;
  highlighted: boolean;
}

function sanitizeMarkdownUrl(url: unknown): string {
  const raw = String(url == null ? '' : url).trim();
  const scheme = raw.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  return /^(javascript|vbscript|data):/.test(scheme) ? '#' : raw;
}

function highlightCode(code: string, language: string): HighlightedCode {
  if (code.length > 80000) return { html: escapeHtml(code), highlighted: false };
  try {
    if (language && hljs.getLanguage(language)) {
      return { html: hljs.highlight(code, { language }).value, highlighted: true };
    }
    if (!language) return { html: hljs.highlightAuto(code).value, highlighted: true };
  } catch {}
  return { html: escapeHtml(code), highlighted: false };
}

// The file page is sandboxed and only this fixed, hashed script can run.
const FILE_PAGE_VIDEO_SCRIPT = `document.addEventListener('toggle', event => {
  const disclosure = event.target;
  if (disclosure.matches('details.video-disclosure:not([open])')) disclosure.querySelector('video').pause();
}, true);
document.addEventListener('loadedmetadata', event => {
  const video = event.target;
  const detail = video.closest('details.video-disclosure')?.querySelector('.video-detail');
  if (!detail || detail.textContent || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const total = Math.round(video.duration);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor(total / 60) % 60;
  const secs = String(total % 60).padStart(2, '0');
  detail.textContent = hours ? hours + ':' + String(mins).padStart(2, '0') + ':' + secs : mins + ':' + secs;
}, true);`;
export const FILE_PAGE_VIDEO_SCRIPT_HASH = createHash('sha256').update(FILE_PAGE_VIDEO_SCRIPT).digest('base64');

const markdown = new Marked({
  breaks: true,
  gfm: true,
  tokenizer: {
    del(this: TokenizerThis, src) {
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
    // Raw HTML stays inert, except a bare inline <br>: GFM table cells cannot
    // hold newlines, so authors break cell lines with it.
    html(html: string | { text?: unknown } | null, block?: boolean) {
      const text = typeof html === 'string' ? html : String((html && html.text) || '');
      return !block && /^<br\s*\/?>$/i.test(text) ? '<br>' : escapeHtml(text);
    },
    code(code, info) {
      const language = String(info || '').match(/^\S*/)?.[0] || '';
      const rendered = highlightCode(code, language);
      const classes = [rendered.highlighted && 'hljs', language && `language-${escapeHtml(language)}`]
        .filter(Boolean).join(' ');
      return `<pre><code${classes ? ` class="${classes}"` : ''}>${rendered.html}</code></pre>\n`;
    },
    image(href, title, text) {
      const safeHref = sanitizeMarkdownUrl(href);
      if (safeHref !== '#' && videoMimeForPath(safeHref)) {
        const fileName = mediaFileName(safeHref);
        const label = text || fileName;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<figure class="video-player msg-video-player"><details class="video-disclosure" open>`
          + renderVideoSummary(fileName)
          + `<div class="video-stage"><video class="video-el msg-video" controls playsinline preload="metadata" src="${escapeHtml(safeHref)}"${titleAttr}><a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener">Open ${escapeHtml(label)}</a></video></div>`
          + `<div class="video-toolbar"><div class="video-controls"><a class="video-btn video-download" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener">Open</a><a class="video-btn video-download" href="${escapeHtml(safeHref)}" download="${escapeHtml(fileName)}">Download</a></div></div></details></figure>`;
      }
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(safeHref)}" alt="${escapeHtml(text || '')}"${titleAttr}>`;
    },
  },
  walkTokens(token) {
    if (token.type === 'link' || token.type === 'image') token.href = sanitizeMarkdownUrl(token.href);
  },
  extensions: createMathExtensions(() => katex),
});

export function renderFilePage({ token, root, title, file }: FilePageOptions): string {
  const pageTitle = title || path.basename(root);
  let content: string;
  if (file.image) {
    const src = `/page/${encodeURIComponent(token)}?content=1&v=${file.mtime}-${file.size}`;
    content = `<img class="file-view-img" src="${escapeHtml(src)}" decoding="async" alt="">`;
  } else if (file.video) {
    const src = `/page/${encodeURIComponent(token)}?content=1&v=${file.mtime}-${file.size}`;
    const fileName = path.basename(root);
    content = `<figure class="video-player file-view-video-player"><details class="video-disclosure" open>`
      + renderVideoSummary(fileName, formatMediaSize(file.size))
      + `<div class="video-stage"><video class="video-el file-view-video" controls playsinline preload="metadata" src="${escapeHtml(src)}">`
      + `<a href="${escapeHtml(src)}" target="_blank" rel="noopener">Open ${escapeHtml(fileName)}</a>`
      + `</video></div>`
      + `<div class="video-toolbar">`
      + `<div class="video-controls">`
      + `<a class="video-btn video-download" href="${escapeHtml(src)}" target="_blank" rel="noopener">Open</a>`
      + `<a class="video-btn video-download" href="${escapeHtml(src)}" download="${escapeHtml(fileName)}">Download</a>`
      + `</div></div></details></figure>`;
  } else if (file.model) {
    const src = `/page/${encodeURIComponent(token)}?content=1&v=${file.mtime}-${file.size}`;
    const fileName = path.basename(root);
    content = `<div class="model-standalone-card">`
      + `<div class="model-standalone-name">${escapeHtml(fileName)}</div>`
      + `<div class="model-standalone-meta">${escapeHtml(file.model.mimeType)} · ${escapeHtml(formatMediaSize(file.size))}</div>`
      + `<a class="btn-small" href="${escapeHtml(src)}" download="${escapeHtml(fileName)}">Download model</a>`
      + `</div>`;
  } else {
    const ext = path.extname(root).slice(1).toLowerCase();
    if (ext === 'md' || ext === 'markdown') {
      content = `<div class="markdown-body">${markdown.parse(file.content)}</div>`;
    } else {
      const rendered = highlightCode(file.content, ext);
      const classes = [rendered.highlighted && 'hljs', ext && `language-${escapeHtml(ext)}`]
        .filter(Boolean).join(' ');
      content = `<div class="markdown-body"><pre><code${classes ? ` class="${classes}"` : ''}>${rendered.html}</code></pre></div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/vendor/hljs-theme.min.css">
  <link rel="stylesheet" href="/vendor/katex.min.css">
  ${content.includes('<details class="video-disclosure"') ? `<script>${FILE_PAGE_VIDEO_SCRIPT}</script>` : ''}
</head>
<body class="standalone-file-page">
  <main class="file-view">
    <header class="file-view-header">
      <span class="file-view-title">${escapeHtml(pageTitle)}</span>
      ${file.truncated ? '<span class="file-view-path">Truncated preview</span>' : ''}
    </header>
    <div class="file-view-body">${content}</div>
  </main>
</body>
</html>`;
}
