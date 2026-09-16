// Generated from src/core/pages.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPage = createPage;
exports.revokePage = revokePage;
exports.getPage = getPage;
exports.listPages = listPages;
/**
 * Published static pages point to live files/directories, not copied snapshots.
 * Persistence re-reads HOME on every operation through dish-store.
 */
const path = require("path");
const crypto = require("crypto");
const dish_store_1 = require("./dish-store");
const session_key_1 = require("./session-key");
// Object boxing reproduces JS property access/spread for legacy primitive rows.
// It makes no claim about the types of the object's unchecked members.
function fields(value) {
    return Object(value);
}
function canonical(value) {
    if (!value)
        return null;
    try {
        return (0, session_key_1.canonicalSessionId)(value);
    }
    catch {
        return value;
    }
}
function readPages() {
    return (0, dish_store_1.readStore)('pages.json');
}
function writePages(pages) {
    (0, dish_store_1.writeStore)('pages.json', pages);
}
/** Re-publishing a resolved root reuses its token and refreshes its metadata. */
function createPage({ root, title = null, sessionId = null, renderer = null }) {
    const abs = path.resolve(root);
    sessionId = canonical(sessionId);
    const pages = readPages();
    for (const [token, entry] of Object.entries(pages)) {
        if (entry && fields(entry).root === abs) {
            const existing = fields(entry);
            const updated = { ...existing, title: title ?? existing.title, sessionId: sessionId ?? canonical(existing.sessionId) };
            if (renderer)
                updated.renderer = renderer;
            else
                delete updated.renderer;
            pages[token] = updated;
            writePages(pages);
            return token;
        }
    }
    const token = crypto.randomBytes(16).toString('base64url');
    const entry = { root: abs, title, sessionId, ...(renderer ? { renderer } : {}), createdAt: Date.now() };
    pages[token] = entry;
    writePages(pages);
    return token;
}
// Returns whether the token existed (and was removed).
function revokePage(token) {
    const pages = readPages();
    if (!pages[token])
        return false;
    delete pages[token];
    writePages(pages);
    return true;
}
function getPage(token) {
    const entry = readPages()[token];
    return entry && fields(entry).root ? { ...fields(entry), sessionId: canonical(fields(entry).sessionId) } : null;
}
/** Newest first; do not drop malformed rows that the legacy list exposed. */
function listPages() {
    return Object.entries(readPages())
        .map(([token, entry]) => ({ token, ...fields(entry), sessionId: canonical(fields(entry).sessionId) }))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}
