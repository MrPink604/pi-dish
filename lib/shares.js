/**
 * Public read-only share tokens for sessions.
 *
 * Persists to ~/.pi/dish/shares.json (alongside the bridge registry). Shape:
 *   { "<token>": { "sessionId": "...", "createdAt": <ms> } }
 *
 * The file is tiny, so we re-read it on every call rather than caching — this
 * keeps the module stateless and, more importantly, correct when HOME changes
 * between calls (the tests point HOME at a temp dir; os.homedir() honours it).
 * Writes go through a temp file + rename so a concurrent read never sees a
 * half-written JSON.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function sharesDir() {
  return path.join(os.homedir(), '.pi', 'dish');
}

function sharesFile() {
  return path.join(sharesDir(), 'shares.json');
}

function readShares() {
  try {
    const data = JSON.parse(fs.readFileSync(sharesFile(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeShares(shares) {
  const dir = sharesDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = sharesFile();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(shares, null, 2));
  fs.renameSync(tmp, file);
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
