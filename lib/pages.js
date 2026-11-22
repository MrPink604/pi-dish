// Generated from src/core/pages.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPage = createPage;
exports.revokePage = revokePage;
exports.bindFormRecipient = bindFormRecipient;
exports.getPage = getPage;
exports.listPages = listPages;
/**
 * Published static pages point to live files/directories, not copied snapshots.
 * Persistence re-reads HOME on every operation through dish-store.
 */
const path = require("path");
const crypto = require("crypto");
const dish_store_1 = require("./dish-store");
const wire_protocol_1 = require("./wire-protocol");
const session_key_1 = require("./session-key");
// Stored rows are external; members stay unknown until the route validates them.
function canonical(value) {
    return value ? (0, session_key_1.tryCanonicalSessionId)(value) : null;
}
function readPages() {
    return (0, dish_store_1.readStore)('pages.json');
}
function writePages(pages) {
    (0, dish_store_1.writeStore)('pages.json', pages);
}
/** Re-publishing a resolved root reuses its token and refreshes its metadata. */
function createPage({ root, title = null, sessionId = null, renderer = null, formRecipient = null }) {
    const abs = path.resolve(root);
    sessionId = canonical(sessionId);
    formRecipient = canonical(formRecipient);
    const pages = readPages();
    for (const [token, entry] of Object.entries(pages)) {
        if (entry && (0, wire_protocol_1.asRecord)(entry).root === abs) {
            const existing = (0, wire_protocol_1.asRecord)(entry);
            const updated = { ...existing, title: title ?? existing.title, sessionId: sessionId ?? canonical(existing.sessionId) };
            if (renderer)
                updated.renderer = renderer;
            else
                delete updated.renderer;
            const recipient = formRecipient ?? canonical(existing.formRecipient);
            if (recipient)
                updated.formRecipient = recipient;
            pages[token] = updated;
            writePages(pages);
            return token;
        }
    }
    // Never a leading "-", which a command line would read as an option.
    let token;
    do
        token = crypto.randomBytes(16).toString('base64url');
    while (token.startsWith('-'));
    const entry = {
        root: abs, title, sessionId, ...(renderer ? { renderer } : {}), ...(formRecipient ? { formRecipient } : {}), createdAt: Date.now(),
    };
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
/** Records a page's form recipient if none is set yet (a form added after publishing). */
function bindFormRecipient(token, sessionId) {
    const pages = readPages();
    const entry = pages[token];
    if (!entry || (0, wire_protocol_1.asRecord)(entry).formRecipient)
        return;
    pages[token] = { ...(0, wire_protocol_1.asRecord)(entry), formRecipient: canonical(sessionId) };
    writePages(pages);
}
function getPage(token) {
    const entry = readPages()[token];
    return entry && (0, wire_protocol_1.asRecord)(entry).root ? { ...(0, wire_protocol_1.asRecord)(entry), sessionId: canonical((0, wire_protocol_1.asRecord)(entry).sessionId) } : null;
}
/** Newest first; do not drop malformed rows that the legacy list exposed. */
function listPages() {
    return Object.entries(readPages())
        .map(([token, entry]) => ({ token, ...(0, wire_protocol_1.asRecord)(entry), sessionId: canonical((0, wire_protocol_1.asRecord)(entry).sessionId) }))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}
