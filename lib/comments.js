/**
 * Anchored review comments left from pi-dish's file, diff, and page views.
 *
 * This is deliberately not a review workflow: a comment is either open or
 * acknowledged. After the user asks them to read comments, agents enumerate
 * the open index, fetch related sets by id, then acknowledge the ids handled.
 *
 * Storage follows pages/shares via lib/dish-store.js: re-read per operation
 * (so a test HOME works) and replace atomically via temp-file + rename.
 */
const crypto = require('crypto');
const { readStore, writeStore } = require('./dish-store');
const { canonicalSessionId } = require('./session-key');

function canonical(value) {
  try { return canonicalSessionId(value); } catch { return value; }
}

function readComments() {
  return readStore('comments.json');
}

function writeComments(comments) {
  writeStore('comments.json', comments);
}

function createComment({ sessionId, body, target }) {
  sessionId = canonicalSessionId(sessionId);
  const comments = readComments();
  const id = crypto.randomBytes(9).toString('base64url');
  comments[id] = {
    id,
    sessionId,
    body,
    target,
    createdAt: Date.now(),
    acknowledgedAt: null,
  };
  writeComments(comments);
  return comments[id];
}

function getComment(id) {
  const comment = readComments()[id];
  return comment ? { ...comment, sessionId: canonical(comment.sessionId) } : null;
}

function listComments({ sessionId = null, pageToken = null, state = 'open' } = {}) {
  if (sessionId) sessionId = canonical(sessionId);
  return Object.values(readComments())
    .filter((comment) => comment && comment.id)
    .map((comment) => ({ ...comment, sessionId: canonical(comment.sessionId) }))
    .filter((comment) => !sessionId || comment.sessionId === sessionId)
    .filter((comment) => !pageToken || comment.target?.pageToken === pageToken)
    .filter((comment) => state === 'all'
      || (state === 'acknowledged' ? !!comment.acknowledgedAt : !comment.acknowledgedAt))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

// Open comments are still the user's draft feedback, so they stay editable.
// Once acknowledged the comment is the agent's record of what it was told —
// mutating or deleting it would rewrite history, so both refuse.
function updateComment(id, body) {
  const comments = readComments();
  const comment = comments[id];
  if (!comment || comment.acknowledgedAt) return null;
  comment.body = body;
  comment.updatedAt = Date.now();
  writeComments(comments);
  return { ...comment, sessionId: canonical(comment.sessionId) };
}

function deleteComment(id) {
  const comments = readComments();
  const comment = comments[id];
  if (!comment || comment.acknowledgedAt) return false;
  delete comments[id];
  writeComments(comments);
  return true;
}

function acknowledgeComment(id) {
  const comments = readComments();
  if (!comments[id]) return null;
  if (!comments[id].acknowledgedAt) comments[id].acknowledgedAt = Date.now();
  writeComments(comments);
  return { ...comments[id], sessionId: canonical(comments[id].sessionId) };
}

module.exports = {
  createComment,
  getComment,
  listComments,
  updateComment,
  deleteComment,
  acknowledgeComment,
};
