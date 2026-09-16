// Generated from src/core/shares.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createShare = createShare;
exports.createHtmlShare = createHtmlShare;
exports.revokeShare = revokeShare;
exports.getShare = getShare;
exports.getShareForSession = getShareForSession;
exports.getShareHtmlPath = getShareHtmlPath;
/**
 * Public read-only share tokens for sessions and immutable native HTML snapshots.
 * Persistence re-reads HOME on every operation through dish-store.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dish_store_1 = require("./dish-store");
const session_key_1 = require("./session-key");
// Box primitive legacy rows without asserting anything about their members.
function fields(value) {
    return Object(value);
}
function canonical(value) {
    try {
        return (0, session_key_1.canonicalSessionId)(value);
    }
    catch {
        return value;
    }
}
function readShares() {
    return (0, dish_store_1.readStore)('shares.json');
}
function writeShares(shares) {
    (0, dish_store_1.writeStore)('shares.json', shares);
}
function htmlDir() {
    return path.join((0, dish_store_1.dishDir)(), 'share-html');
}
function htmlPath(token) {
    return path.join(htmlDir(), `${token}.html`);
}
function removeShareHtml(token) {
    try {
        fs.unlinkSync(htmlPath(token));
    }
    catch { }
}
// Idempotent: an existing share for the session reuses its token.
function createShare(sessionId) {
    const canonicalId = (0, session_key_1.canonicalSessionId)(sessionId);
    const shares = readShares();
    for (const [token, entry] of Object.entries(shares)) {
        if (entry && canonical(fields(entry).sessionId) === canonicalId) {
            if (fields(entry).sessionId !== canonicalId) {
                shares[token] = { ...fields(entry), sessionId: canonicalId };
                writeShares(shares);
            }
            return token;
        }
    }
    const token = crypto.randomBytes(16).toString('base64url');
    const entry = { sessionId: canonicalId, createdAt: Date.now() };
    shares[token] = entry;
    writeShares(shares);
    return token;
}
function createHtmlShare(html) {
    const shares = readShares();
    const token = crypto.randomBytes(16).toString('base64url');
    const entry = { kind: 'html', createdAt: Date.now() };
    shares[token] = entry;
    writeShares(shares);
    try {
        saveShareHtml(token, html);
    }
    catch (error) {
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
        if (entry && canonical(fields(entry).sessionId) === sessionId) {
            delete shares[token];
            removeShareHtml(token);
            existed = true;
        }
    }
    if (existed)
        writeShares(shares);
    return existed;
}
function getShare(token) {
    const entry = fields(readShares()[token]);
    if (entry.kind === 'html')
        return { kind: 'html' };
    return entry.sessionId ? { kind: 'session', sessionId: canonical(entry.sessionId) } : null;
}
function getShareForSession(sessionId) {
    sessionId = canonical(sessionId);
    const shares = readShares();
    for (const [token, entry] of Object.entries(shares)) {
        if (entry && canonical(fields(entry).sessionId) === sessionId)
            return { token };
    }
    return null;
}
// Token-derived filenames are private. Callers create/validate the token first;
// temp + rename keeps readers from seeing a partially replaced HTML snapshot.
function saveShareHtml(token, html) {
    if (!readShares()[token])
        throw new Error('Unknown share token');
    const dir = htmlDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = htmlPath(token);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, html, { mode: 0o600 });
    fs.renameSync(tmp, file);
    return file;
}
function getShareHtmlPath(token) {
    if (!readShares()[token])
        return null;
    const file = htmlPath(token);
    try {
        return fs.statSync(file).isFile() ? file : null;
    }
    catch {
        return null;
    }
}
