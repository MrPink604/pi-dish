const path = require('path');
const { Marked } = require('marked');
const hljs = require('highlight.js');
const katex = require('katex');
const { createMathExtensions } = require('../public/helpers');

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function sanitizeMarkdownUrl(url) {
  const raw = String(url == null ? '' : url).trim();
  const scheme = raw.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  return /^(javascript|vbscript|data):/.test(scheme) ? '#' : raw;
}

function highlightCode(code, language) {
  if (code.length > 80000) return { html: escapeHtml(code), highlighted: false };
  try {
    if (language && hljs.getLanguage(language)) {
      return { html: hljs.highlight(code, { language }).value, highlighted: true };
    }
    if (!language) return { html: hljs.highlightAuto(code).value, highlighted: true };
  } catch {}
  return { html: escapeHtml(code), highlighted: false };
}

const markdown = new Marked({
  breaks: true,
  gfm: true,
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
    html(html) {
      return escapeHtml(typeof html === 'string' ? html : (html && html.text) || '');
    },
    code(code, info) {
      const language = String(info || '').match(/^\S*/)?.[0] || '';
      const rendered = highlightCode(code, language);
      const classes = [rendered.highlighted && 'hljs', language && `language-${escapeHtml(language)}`]
        .filter(Boolean).join(' ');
      return `<pre><code${classes ? ` class="${classes}"` : ''}>${rendered.html}</code></pre>\n`;
    },
  },
  walkTokens(token) {
    if (token.type === 'link' || token.type === 'image') token.href = sanitizeMarkdownUrl(token.href);
  },
  extensions: createMathExtensions(katex),
});

function renderFilePage({ token, root, title, file }) {
  const pageTitle = title || path.basename(root);
  let content;
  if (file.image) {
    const src = `/page/${encodeURIComponent(token)}?content=1&v=${file.mtime}-${file.size}`;
    content = `<img class="file-view-img" src="${escapeHtml(src)}" decoding="async" alt="">`;
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

module.exports = { renderFilePage };
