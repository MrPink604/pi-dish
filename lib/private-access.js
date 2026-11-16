// Generated from src/core/private-access.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRIVATE_UNLOCK_QUERY = exports.PRIVATE_UNLOCK_HEADER = void 0;
exports.requestUnlockToken = requestUnlockToken;
exports.createPrivateAccess = createPrivateAccess;
/**
 * PIN gate for private sessions. Private rows and their per-session routes are
 * invisible unless a request carries an unlock token minted by a correct PIN.
 * Only a scrypt hash of the PIN is stored (`~/.pi/dish/private-pin.json`,
 * 0600). Unlock tokens live in memory: a server restart, a lock or a PIN
 * change revokes every one of them.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dish_store_1 = require("./dish-store");
const http_boundary_1 = require("./http-boundary");
const helper_values_1 = require("./helper-values");
const PIN_FILE = 'private-pin.json';
exports.PRIVATE_UNLOCK_HEADER = 'x-pi-dish-private-unlock';
/** EventSource and WebSocket cannot set headers; they carry the token in the query. */
exports.PRIVATE_UNLOCK_QUERY = 'privateUnlock';
const PIN_PATTERN = /^\d{4,12}$/;
const MAX_TOKENS = 32;
const FREE_FAILURES = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;
const SCRYPT_KEY_LENGTH = 32;
function pinFile() { return path.join((0, dish_store_1.dishDir)(), PIN_FILE); }
function readPin() {
    try {
        const value = JSON.parse(fs.readFileSync(pinFile(), 'utf8'));
        return (0, helper_values_1.record)(value) && typeof value.salt === 'string' && typeof value.hash === 'string'
            ? { salt: value.salt, hash: value.hash } : null;
    }
    catch {
        return null;
    }
}
function digest(pin, salt) {
    return crypto.scryptSync(pin, Buffer.from(salt, 'base64'), SCRYPT_KEY_LENGTH);
}
function matches(stored, pin) {
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin))
        return false;
    const expected = Buffer.from(stored.hash, 'base64');
    const actual = digest(pin, stored.salt);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function requestUnlockToken(req) {
    const header = req.headers[exports.PRIVATE_UNLOCK_HEADER];
    if (typeof header === 'string' && header)
        return header;
    try {
        return new URL(req.url || '', 'http://localhost').searchParams.get(exports.PRIVATE_UNLOCK_QUERY) || null;
    }
    catch {
        return null;
    }
}
function createPrivateAccess(now = Date.now) {
    // Insertion order is age order, so the oldest token is evicted first.
    const tokens = new Set();
    let failures = 0, lockedUntil = 0;
    function refuseWhileLocked() {
        const wait = lockedUntil - now();
        if (wait > 0)
            throw (0, http_boundary_1.httpError)(`Too many wrong PINs. Try again in ${Math.ceil(wait / 1000)}s.`, 429);
    }
    function verify(stored, pin) {
        refuseWhileLocked();
        if (matches(stored, pin)) {
            failures = 0;
            return;
        }
        failures += 1;
        if (failures >= FREE_FAILURES) {
            lockedUntil = now() + Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * 2 ** (failures - FREE_FAILURES));
        }
        throw (0, http_boundary_1.httpError)('Wrong PIN', 401);
    }
    return {
        pinConfigured: () => readPin() !== null,
        setPin(pin, currentPin) {
            if (typeof pin !== 'string' || !PIN_PATTERN.test(pin))
                throw (0, http_boundary_1.httpError)('PIN must be 4–12 digits', 400);
            const stored = readPin();
            if (stored)
                verify(stored, currentPin);
            const salt = crypto.randomBytes(16).toString('base64');
            fs.mkdirSync((0, dish_store_1.dishDir)(), { recursive: true });
            (0, dish_store_1.replaceFileDurably)(pinFile(), JSON.stringify({ salt, hash: digest(pin, salt).toString('base64') }) + '\n');
            tokens.clear();
        },
        unlock(pin) {
            const stored = readPin();
            if (!stored)
                throw (0, http_boundary_1.httpError)('No private-session PIN is set', 409);
            verify(stored, pin);
            const token = crypto.randomBytes(24).toString('base64url');
            tokens.add(token);
            if (tokens.size > MAX_TOKENS)
                tokens.delete(tokens.values().next().value);
            return token;
        },
        lock(token) { if (token)
            tokens.delete(token); },
        unlocked(req) {
            const token = requestUnlockToken(req);
            return token !== null && tokens.has(token);
        },
    };
}
