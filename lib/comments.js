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

function readComments() {
  return readStore('comments.json');
}

function writeComments(comments) {
  writeStore('comments.json', comments);
}

function createComment({ sessionId, body, target }) {
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
  return readComments()[id] || null;
}

function listComments({ sessionId = null, pageToken = null, state = 'open' } = {}) {
  return Object.values(readComments())
    .filter((comment) => comment && comment.id)
    .filter((comment) => !sessionId || comment.sessionId === sessionId)
    .filter((comment) => !pageToken || comment.target?.pageToken === pageToken)
    .filter((comment) => state === 'all'
      || (state === 'acknowledged' ? !!comment.acknowledgedAt : !comment.acknowledgedAt))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function acknowledgeComment(id) {
  const comments = readComments();
  if (!comments[id]) return null;
  if (!comments[id].acknowledgedAt) comments[id].acknowledgedAt = Date.now();
  writeComments(comments);
  return comments[id];
}

module.exports = {
  createComment,
  getComment,
  listComments,
  acknowledgeComment,
};
