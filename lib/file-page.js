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
exports.renderFilePage = renderFilePage;
const path = __importStar(require("path"));
const marked_1 = require("marked");
const highlight_js_1 = __importDefault(require("highlight.js"));
const katex = __importStar(require("katex"));
const helper_markdown_js_1 = require("./helper-markdown.js");
const helper_format_1 = require("./helper-format");
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
        html(html) {
            return (0, helper_format_1.escapeHtml)(typeof html === 'string' ? html : (html && html.text) || '');
        },
        code(code, info) {
            const language = String(info || '').match(/^\S*/)?.[0] || '';
            const rendered = highlightCode(code, language);
            const classes = [rendered.highlighted && 'hljs', language && `language-${(0, helper_format_1.escapeHtml)(language)}`]
                .filter(Boolean).join(' ');
            return `<pre><code${classes ? ` class="${classes}"` : ''}>${rendered.html}</code></pre>\n`;
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
