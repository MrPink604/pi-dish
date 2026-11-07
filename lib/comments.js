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
const wire_protocol_1 = require("./wire-protocol");
const session_key_1 = require("./session-key");
// Stored rows are external; members stay unknown until the route validates them.
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
    return comment ? { ...(0, wire_protocol_1.asRecord)(comment), sessionId: (0, session_key_1.tryCanonicalSessionId)((0, wire_protocol_1.asRecord)(comment).sessionId) } : null;
}
function listComments({ sessionId = null, pageToken = null, state = 'open' } = {}) {
    if (sessionId)
        sessionId = (0, session_key_1.tryCanonicalSessionId)(sessionId);
    return Object.values(readComments())
        .filter((comment) => comment && (0, wire_protocol_1.asRecord)(comment).id)
        .map((comment) => ({ ...(0, wire_protocol_1.asRecord)(comment), sessionId: (0, session_key_1.tryCanonicalSessionId)((0, wire_protocol_1.asRecord)(comment).sessionId) }))
        .filter((comment) => !sessionId || comment.sessionId === sessionId)
        .filter((comment) => !pageToken || (0, wire_protocol_1.asRecord)(comment.target).pageToken === pageToken)
        .filter((comment) => state === 'all'
        || (state === 'acknowledged' ? !!comment.acknowledgedAt : !comment.acknowledgedAt))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}
// Open comments are still draft feedback. Acknowledged comments are the agent's
// record of what it was told: editing/deleting them would rewrite that history.
function updateComment(id, body) {
    const comments = readComments();
    const comment = (0, wire_protocol_1.asRecord)(comments[id]);
    if (!comments[id] || comment.acknowledgedAt)
        return null;
    comment.body = body;
    comment.updatedAt = Date.now();
    comments[id] = comment;
    writeComments(comments);
    return { ...comment, sessionId: (0, session_key_1.tryCanonicalSessionId)(comment.sessionId) };
}
function deleteComment(id) {
    const comments = readComments();
    if (!comments[id] || (0, wire_protocol_1.asRecord)(comments[id]).acknowledgedAt)
        return false;
    delete comments[id];
    writeComments(comments);
    return true;
}
function acknowledgeComment(id) {
    const comments = readComments();
    const comment = (0, wire_protocol_1.asRecord)(comments[id]);
    if (!comments[id])
        return null;
    if (!comment.acknowledgedAt) {
        comment.acknowledgedAt = Date.now();
        comments[id] = comment;
    }
    writeComments(comments);
    return { ...comment, sessionId: (0, session_key_1.tryCanonicalSessionId)(comment.sessionId) };
}
