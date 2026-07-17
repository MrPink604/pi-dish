/**
 * Public read-only share tokens for sessions.
 *
 * Persists to ~/.pi/dish/shares.json (alongside the bridge registry). Shape:
 *   { "<token>": { "sessionId": "...", "createdAt": <ms> } }
 *
 * Persistence rules (re-read per call, temp-file + rename writes) live in
 * lib/dish-store.js, shared with pages.js and comments.js.
 */
const crypto = require('crypto');
const { readStore, writeStore } = require('./dish-store');

function readShares() {
  return readStore('shares.json');
}

function writeShares(shares) {
  writeStore('shares.json', shares);
}

// Idempotent: an existing share for the session reuses its token.
function createShare(sessionId) {
  const shares = readShares();
  for (const [token, entry] of Object.entries(shares)) {
    if (entry && entry.sessionId === sessionId) return token;
  }
  const token = crypto.randomBytes(16).toString('base64url');
  shares[token] = { sessionId, createdAt: Date.now() };
  writeShares(shares);
  return token;
}

// Returns whether a share existed (and was removed).
function revokeShare(sessionId) {
  const shares = readShares();
  let existed = false;
  for (const [token, entry] of Object.entries(shares)) {
    if (entry && entry.sessionId === sessionId) {
      delete shares[token];
      existed = true;
    }
  }
  if (existed) writeShares(shares);
  return existed;
}

function getShare(token) {
  const entry = readShares()[token];
  return entry && entry.sessionId ? { sessionId: entry.sessionId } : null;
}

function getShareForSession(sessionId) {
  const shares = readShares();
  for (const [token, entry] of Object.entries(shares)) {
    if (entry && entry.sessionId === sessionId) return { token };
  }
  return null;
}

module.exports = { createShare, revokeShare, getShare, getShareForSession };
