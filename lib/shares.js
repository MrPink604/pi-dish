/**
 * Public read-only share tokens for sessions and immutable native HTML snapshots.
 *
 * Persists to ~/.pi/dish/shares.json (alongside the bridge registry). Shape:
 *   { "<token>": { "sessionId": "...", "createdAt": <ms> } }
 *   { "<token>": { "kind": "html", "createdAt": <ms> } }
 *
 * Persistence rules (re-read per call, temp-file + rename writes) live in
 * lib/dish-store.js, shared with pages.js and comments.js.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dishDir, readStore, writeStore } = require('./dish-store');
const { canonicalSessionId } = require('./session-key');

function canonical(value) {
  try { return canonicalSessionId(value); } catch { return value; }
}

function readShares() {
  return readStore('shares.json');
}

function writeShares(shares) {
  writeStore('shares.json', shares);
}

function htmlDir() {
  return path.join(dishDir(), 'share-html');
}

function htmlPath(token) {
  return path.join(htmlDir(), `${token}.html`);
}

function removeShareHtml(token) {
  try { fs.unlinkSync(htmlPath(token)); } catch {}
}

// Idempotent: an existing share for the session reuses its token.
function createShare(sessionId) {
  sessionId = canonicalSessionId(sessionId);
  const shares = readShares();
  for (const [token, entry] of Object.entries(shares)) {
    if (entry && canonical(entry.sessionId) === sessionId) {
      if (entry.sessionId !== sessionId) {
        shares[token] = { ...entry, sessionId };
        writeShares(shares);
      }
      return token;
    }
  }
  const token = crypto.randomBytes(16).toString('base64url');
  shares[token] = { sessionId, createdAt: Date.now() };
  writeShares(shares);
  return token;
}

function createHtmlShare(html) {
  const shares = readShares();
  const token = crypto.randomBytes(16).toString('base64url');
  shares[token] = { kind: 'html', createdAt: Date.now() };
  writeShares(shares);
  try {
    saveShareHtml(token, html);
  } catch (error) {
    const current = readShares();
    delete current[token];
    writeShares(current);
    removeShareHtml(token);
    throw error;
  }
  return token;
}

// Returns whether a share existed (and was removed).
function revokeShare(sessionId) {
  sessionId = canonical(sessionId);
  const shares = readShares();
  let existed = false;
  for (const [token, entry] of Object.entries(shares)) {
    if (entry && canonical(entry.sessionId) === sessionId) {
      delete shares[token];
      removeShareHtml(token);
      existed = true;
    }
  }
  if (existed) writeShares(shares);
  return existed;
}

function getShare(token) {
  const entry = readShares()[token];
  if (entry?.kind === 'html') return { kind: 'html' };
  return entry?.sessionId ? { kind: 'session', sessionId: canonical(entry.sessionId) } : null;
}

function getShareForSession(sessionId) {
  sessionId = canonical(sessionId);
  const shares = readShares();
  for (const [token, entry] of Object.entries(shares)) {
    if (entry && canonical(entry.sessionId) === sessionId) return { token };
  }
  return null;
}

// Store the exact standalone HTML produced by a harness's live exporter.
// Token-derived filenames stay private implementation details; callers must
// create/validate the share token before writing. Temp + rename keeps public
// readers from seeing a partial replacement when /share is run again.
function saveShareHtml(token, html) {
  if (!readShares()[token]) throw new Error('Unknown share token');
  const dir = htmlDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = htmlPath(token);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, html, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

function getShareHtmlPath(token) {
  if (!readShares()[token]) return null;
  const file = htmlPath(token);
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}

module.exports = {
  createShare,
  createHtmlShare,
  revokeShare,
  getShare,
  getShareForSession,
  getShareHtmlPath,
};
