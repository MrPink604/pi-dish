/**
 * Anchored review comments left from pi-dish's file, diff, and page views.
 *
 * This is deliberately not a review workflow: a comment is either open or
 * acknowledged. After the user asks them to read comments, agents enumerate
 * the open index, fetch related sets by id, then acknowledge the ids handled.
 *
 * Storage follows pages/shares: re-read per operation (so a test HOME works)
 * and replace atomically via temp-file + rename.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function dishDir() {
  return path.join(os.homedir(), '.pi', 'dish');
}

function commentsFile() {
  return path.join(dishDir(), 'comments.json');
}

function readComments() {
  try {
    const data = JSON.parse(fs.readFileSync(commentsFile(), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeComments(comments) {
  fs.mkdirSync(dishDir(), { recursive: true });
  const file = commentsFile();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(comments, null, 2));
  fs.renameSync(tmp, file);
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
