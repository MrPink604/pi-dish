/**
 * Published static pages: agent-written HTML artifacts (plan explainers,
 * reports) hosted by pi-dish under share-style tokens.
 *
 * The agent creates the file(s) on disk wherever it likes (usually the
 * project tree), then points the server at the path via POST /api/pages;
 * pi-dish serves the content live from disk at /page/<token> — an edited
 * plan.html shows its new content on refresh, no re-publish. A root may be a
 * single file or a directory (directory pages serve index.html and their
 * relative assets).
 *
 * Persists to ~/.pi/dish/pages.json (persistence rules in lib/dish-store.js,
 * shared with shares.js and comments.js):
 *   { "<token>": { "root": "/abs/path", "title": "...", "sessionId": "...",
 *                  "renderer": "file", "createdAt": <ms> } }
 * `renderer` is present only for files published from pi-dish's file viewer;
 * ordinary agent-authored HTML artifacts continue to be served unchanged.
 */
const path = require('path');
const crypto = require('crypto');
const { readStore, writeStore } = require('./dish-store');
const { canonicalSessionId } = require('./session-key');

function canonical(value) {
  if (!value) return null;
  try { return canonicalSessionId(value); } catch { return value; }
}

function readPages() {
  return readStore('pages.json');
}

function writePages(pages) {
  writeStore('pages.json', pages);
}

/**
 * Register (or re-point) a page. Idempotent per resolved root: publishing
 * the same path again reuses the token — the agent iterating on plan.html
 * doesn't mint a new URL each time — and refreshes its metadata.
 */
function createPage({ root, title = null, sessionId = null, renderer = null }) {
  const abs = path.resolve(root);
  sessionId = canonical(sessionId);
  const pages = readPages();
  for (const [token, entry] of Object.entries(pages)) {
    if (entry && entry.root === abs) {
      const updated = { ...entry, title: title ?? entry.title, sessionId: sessionId ?? canonical(entry.sessionId) };
      if (renderer) updated.renderer = renderer;
      else delete updated.renderer;
      pages[token] = updated;
      writePages(pages);
      return token;
    }
  }
  const token = crypto.randomBytes(16).toString('base64url');
  pages[token] = { root: abs, title, sessionId, ...(renderer ? { renderer } : {}), createdAt: Date.now() };
  writePages(pages);
  return token;
}

// Returns whether the token existed (and was removed).
function revokePage(token) {
  const pages = readPages();
  if (!pages[token]) return false;
  delete pages[token];
  writePages(pages);
  return true;
}

function getPage(token) {
  const entry = readPages()[token];
  return entry && entry.root ? { ...entry, sessionId: canonical(entry.sessionId) } : null;
}

/** [{ token, root, title, sessionId, createdAt }] — newest first. */
function listPages() {
  return Object.entries(readPages())
    .map(([token, entry]) => ({ token, ...entry, sessionId: canonical(entry?.sessionId) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

module.exports = { createPage, revokePage, getPage, listPages };
