'use strict';

const { getHarness } = require('./harnesses');

// `~` is deliberately outside the legacy Pi session-id alphabet below, so an
// encoded cross-harness route can never steal a pre-existing raw Pi route.
const VERSION = '~sk1_';
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
const MAX_ID_LENGTH = 200;

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && SAFE_ID.test(id);
}

function encodeSessionKey(harnessId, nativeSessionId) {
  if (!getHarness(harnessId) || !validId(nativeSessionId)) throw new TypeError('Invalid session identity');
  return VERSION + Buffer.from(JSON.stringify([harnessId, nativeSessionId]), 'utf8').toString('base64url');
}

function decodeSessionKey(key) {
  if (typeof key !== 'string' || !key.startsWith(VERSION)) throw new TypeError('Malformed session key');
  const encoded = key.slice(VERSION.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new TypeError('Malformed session key');
  let tuple;
  try { tuple = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw new TypeError('Malformed session key'); }
  if (!Array.isArray(tuple) || tuple.length !== 2 || !getHarness(tuple[0]) || !validId(tuple[1]) ||
      encodeSessionKey(tuple[0], tuple[1]) !== key) throw new TypeError('Malformed session key');
  return { harnessId: tuple[0], nativeSessionId: tuple[1] };
}

// Unversioned routes are the historical Pi API. Encoded routes are always
// decoded strictly; a malformed value that looks versioned never falls back.
function resolveSessionRoute(value) {
  if (typeof value === 'string' && value.startsWith(VERSION)) return decodeSessionKey(value);
  if (!validId(value)) throw new TypeError('Invalid legacy Pi session id');
  return { harnessId: 'pi', nativeSessionId: value };
}

// One durable/public identity per logical session: preserve legacy raw Pi IDs
// while alternate harnesses use the encoded tuple. This also folds an encoded
// Pi alias back to the raw ID before anything persists it.
function canonicalSessionId(value) {
  const { harnessId, nativeSessionId } = resolveSessionRoute(value);
  return harnessId === 'pi' ? nativeSessionId : encodeSessionKey(harnessId, nativeSessionId);
}

module.exports = { encodeSessionKey, decodeSessionKey, resolveSessionRoute, canonicalSessionId, validSessionId: validId, VERSION, MAX_ID_LENGTH };
