// Generated from src/core/file-page.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_PAGE_VIDEO_SCRIPT_HASH = void 0;
exports.renderFilePage = renderFilePage;
const path = __importStar(require("path"));
const node_crypto_1 = require("node:crypto");
const marked_1 = require("marked");
const highlight_js_1 = __importDefault(require("highlight.js"));
const katex = __importStar(require("katex"));
const helper_markdown_js_1 = require("./helper-markdown.js");
const helper_format_1 = require("./helper-format");
const helper_media_1 = require("./helper-media");
function sanitizeMarkdownUrl(url) {
    const raw = String(url == null ? '' : url).trim();
    const scheme = raw.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
    return /^(javascript|vbscript|data):/.test(scheme) ? '#' : raw;
}
function highlightCode(code, language) {
    if (code.length > 80000)
        return { html: (0, helper_format_1.escapeHtml)(code), highlighted: false };
    try {
        if (language && highlight_js_1.default.getLanguage(language)) {
            return { html: highlight_js_1.default.highlight(code, { language }).value, highlighted: true };
        }
        if (!language)
            return { html: highlight_js_1.default.highlightAuto(code).value, highlighted: true };
    }
    catch { }
    return { html: (0, helper_format_1.escapeHtml)(code), highlighted: false };
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
exports.FILE_PAGE_VIDEO_SCRIPT_HASH = (0, node_crypto_1.createHash)('sha256').update(FILE_PAGE_VIDEO_SCRIPT).digest('base64');
const markdown = new marked_1.Marked({
    breaks: true,
    gfm: true,
    tokenizer: {
        del(src) {
            const cap = /^(~~)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]|$)/.exec(src);
            if (!cap)
                return;
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
        html(html, block) {
            const text = typeof html === 'string' ? html : String((html && html.text) || '');
            return !block && /^<br\s*\/?>$/i.test(text) ? '<br>' : (0, helper_format_1.escapeHtml)(text);
        },
        code(code, info) {
            const language = String(info || '').match(/^\S*/)?.[0] || '';
            const rendered = highlightCode(code, language);
            const classes = [rendered.highlighted && 'hljs', language && `language-${(0, helper_format_1.escapeHtml)(language)}`]
                .filter(Boolean).join(' ');
            return `<pre><code${classes ? ` class="${classes}"` : ''}>${rendered.html}</code></pre>\n`;
        },
        image(href, title, text) {
            const safeHref = sanitizeMarkdownUrl(href);
            if (safeHref !== '#' && (0, helper_media_1.videoMimeForPath)(safeHref)) {
                const fileName = (0, helper_media_1.mediaFileName)(safeHref);
                const label = text || fileName;
                const titleAttr = title ? ` title="${(0, helper_format_1.escapeHtml)(title)}"` : '';
                return `<figure class="video-player msg-video-player"><details class="video-disclosure" open>`
                    + (0, helper_media_1.renderVideoSummary)(fileName)
                    + `<div class="video-stage"><video class="video-el msg-video" controls playsinline preload="metadata" src="${(0, helper_format_1.escapeHtml)(safeHref)}"${titleAttr}><a href="${(0, helper_format_1.escapeHtml)(safeHref)}" target="_blank" rel="noopener">Open ${(0, helper_format_1.escapeHtml)(label)}</a></video></div>`
                    + `<div class="video-toolbar"><div class="video-controls"><a class="video-btn video-download" href="${(0, helper_format_1.escapeHtml)(safeHref)}" target="_blank" rel="noopener">Open</a><a class="video-btn video-download" href="${(0, helper_format_1.escapeHtml)(safeHref)}" download="${(0, helper_format_1.escapeHtml)(fileName)}">Download</a></div></div></details></figure>`;
            }
            const titleAttr = title ? ` title="${(0, helper_format_1.escapeHtml)(title)}"` : '';
            return `<img src="${(0, helper_format_1.escapeHtml)(safeHref)}" alt="${(0, helper_format_1.escapeHtml)(text || '')}"${titleAttr}>`;
        },
    },
    walkTokens(token) {
        if (token.type === 'link' || token.type === 'image')
            token.href = sanitizeMarkdownUrl(token.href);
    },
    extensions: (0, helper_markdown_js_1.createMathExtensions)(() => katex),
});
function renderFilePage({ token, root, title, file }) {
    const pageTitle = title || path.basename(root);
    let content;
    if (file.image) {
        const src = `/page/${encodeURIComponent(token)}?content=1&v=${file.mtime}-${file.size}`;
        content = `<img class="file-view-img" src="${(0, helper_format_1.escapeHtml)(src)}" decoding="async" alt="">`;
    }
    else if (file.video) {
        const src = `/page/${encodeURIComponent(token)}?content=1&v=${file.mtime}-${file.size}`;
        const fileName = path.basename(root);
        content = `<figure class="video-player file-view-video-player"><details class="video-disclosure" open>`
            + (0, helper_media_1.renderVideoSummary)(fileName, (0, helper_media_1.formatMediaSize)(file.size))
            + `<div class="video-stage"><video class="video-el file-view-video" controls playsinline preload="metadata" src="${(0, helper_format_1.escapeHtml)(src)}">`
            + `<a href="${(0, helper_format_1.escapeHtml)(src)}" target="_blank" rel="noopener">Open ${(0, helper_format_1.escapeHtml)(fileName)}</a>`
            + `</video></div>`
            + `<div class="video-toolbar">`
            + `<div class="video-controls">`
            + `<a class="video-btn video-download" href="${(0, helper_format_1.escapeHtml)(src)}" target="_blank" rel="noopener">Open</a>`
            + `<a class="video-btn video-download" href="${(0, helper_format_1.escapeHtml)(src)}" download="${(0, helper_format_1.escapeHtml)(fileName)}">Download</a>`
            + `</div></div></details></figure>`;
    }
    else {
        const ext = path.extname(root).slice(1).toLowerCase();
        if (ext === 'md' || ext === 'markdown') {
            content = `<div class="markdown-body">${markdown.parse(file.content)}</div>`;
        }
        else {
            const rendered = highlightCode(file.content, ext);
            const classes = [rendered.highlighted && 'hljs', ext && `language-${(0, helper_format_1.escapeHtml)(ext)}`]
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
  <title>${(0, helper_format_1.escapeHtml)(pageTitle)}</title>
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/vendor/hljs-theme.min.css">
  <link rel="stylesheet" href="/vendor/katex.min.css">
  ${content.includes('<details class="video-disclosure"') ? `<script>${FILE_PAGE_VIDEO_SCRIPT}</script>` : ''}
</head>
<body class="standalone-file-page">
  <main class="file-view">
    <header class="file-view-header">
      <span class="file-view-title">${(0, helper_format_1.escapeHtml)(pageTitle)}</span>
      ${file.truncated ? '<span class="file-view-path">Truncated preview</span>' : ''}
    </header>
    <div class="file-view-body">${content}</div>
  </main>
</body>
</html>`;
}
