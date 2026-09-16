// Generated from src/core/comments.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createComment = createComment;
exports.getComment = getComment;
exports.listComments = listComments;
exports.updateComment = updateComment;
exports.deleteComment = deleteComment;
exports.acknowledgeComment = acknowledgeComment;
/**
 * Anchored review comments from file, diff and published-page views.
 * Reads never acknowledge; acknowledged comments cannot be edited or deleted.
 * Storage re-reads HOME per operation and uses dish-store's atomic replacement.
 */
const crypto = require("crypto");
const dish_store_1 = require("./dish-store");
const session_key_1 = require("./session-key");
// Preserve JS access/spread for primitive legacy rows; all members stay unknown.
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
function readComments() {
    return (0, dish_store_1.readStore)('comments.json');
}
function writeComments(comments) {
    (0, dish_store_1.writeStore)('comments.json', comments);
}
function createComment({ sessionId, body, target }) {
    const canonicalId = (0, session_key_1.canonicalSessionId)(sessionId);
    const comments = readComments();
    const id = crypto.randomBytes(9).toString('base64url');
    const comment = {
        id,
        sessionId: canonicalId,
        body,
        target,
        createdAt: Date.now(),
        acknowledgedAt: null,
    };
    comments[id] = comment;
    writeComments(comments);
    return comment;
}
function getComment(id) {
    const comment = readComments()[id];
    return comment ? { ...fields(comment), sessionId: canonical(fields(comment).sessionId) } : null;
}
function listComments({ sessionId = null, pageToken = null, state = 'open' } = {}) {
    if (sessionId)
        sessionId = canonical(sessionId);
    return Object.values(readComments())
        .filter((comment) => comment && fields(comment).id)
        .map((comment) => ({ ...fields(comment), sessionId: canonical(fields(comment).sessionId) }))
        .filter((comment) => !sessionId || comment.sessionId === sessionId)
        .filter((comment) => !pageToken || fields(comment.target).pageToken === pageToken)
        .filter((comment) => state === 'all'
        || (state === 'acknowledged' ? !!comment.acknowledgedAt : !comment.acknowledgedAt))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}
// Open comments are still draft feedback. Acknowledged comments are the agent's
// record of what it was told: editing/deleting them would rewrite that history.
function updateComment(id, body) {
    const comments = readComments();
    const comment = comments[id];
    if (!comment || fields(comment).acknowledgedAt)
        return null;
    // The old non-strict JS silently ignored writes to primitive legacy rows.
    // Do not turn those writes into strict-mode TypeErrors or persisted objects.
    if (typeof comment === 'object' || typeof comment === 'function')
        fields(comment).body = body;
    const updatedAt = Date.now();
    if (typeof comment === 'object' || typeof comment === 'function')
        fields(comment).updatedAt = updatedAt;
    writeComments(comments);
    return { ...fields(comment), sessionId: canonical(fields(comment).sessionId) };
}
function deleteComment(id) {
    const comments = readComments();
    const comment = comments[id];
    if (!comment || fields(comment).acknowledgedAt)
        return false;
    delete comments[id];
    writeComments(comments);
    return true;
}
function acknowledgeComment(id) {
    const comments = readComments();
    const comment = comments[id];
    if (!comment)
        return null;
    if (!fields(comment).acknowledgedAt) {
        const acknowledgedAt = Date.now();
        if (typeof comment === 'object' || typeof comment === 'function')
            fields(comment).acknowledgedAt = acknowledgedAt;
    }
    writeComments(comments);
    return { ...fields(comment), sessionId: canonical(fields(comment).sessionId) };
}
