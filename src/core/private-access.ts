/**
 * PIN gate for private sessions. Private rows and their per-session routes are
 * invisible unless a request carries an unlock token minted by a correct PIN.
 * Only a scrypt hash of the PIN is stored (`~/.pi/dish/private-pin.json`,
 * 0600). Unlock tokens live in memory: a server restart, a lock or a PIN
 * change revokes every one of them.
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import { dishDir, replaceFileDurably } from './dish-store';
import { httpError } from './http-boundary';
import { record } from './helper-values';
import type { IncomingMessage } from 'http';

const PIN_FILE = 'private-pin.json';
export const PRIVATE_UNLOCK_HEADER = 'x-pi-dish-private-unlock';
/** EventSource and WebSocket cannot set headers; they carry the token in the query. */
export const PRIVATE_UNLOCK_QUERY = 'privateUnlock';
const PIN_PATTERN = /^\d{4,12}$/;
const MAX_TOKENS = 32;
const FREE_FAILURES = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;
const SCRYPT_KEY_LENGTH = 32;

interface StoredPin { readonly salt: string; readonly hash: string; }

export interface PrivateAccess {
  pinConfigured(): boolean;
  /** Requires the current PIN once one exists; revokes every unlock token. */
  setPin(pin: unknown, currentPin: unknown): void;
  /** Mints an unlock token; throws 401 on a wrong PIN, 429 while locked out. */
  unlock(pin: unknown): string;
  lock(token: string | null): void;
  unlocked(req: IncomingMessage): boolean;
}

function pinFile(): string { return path.join(dishDir(), PIN_FILE); }

function readPin(): StoredPin | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(pinFile(), 'utf8'));
    return record(value) && typeof value.salt === 'string' && typeof value.hash === 'string'
      ? { salt: value.salt, hash: value.hash } : null;
  } catch { return null; }
}

function digest(pin: string, salt: string): Buffer {
  return crypto.scryptSync(pin, Buffer.from(salt, 'base64'), SCRYPT_KEY_LENGTH);
}

function matches(stored: StoredPin, pin: unknown): boolean {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return false;
  const expected = Buffer.from(stored.hash, 'base64');
  const actual = digest(pin, stored.salt);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function requestUnlockToken(req: IncomingMessage): string | null {
  const header = req.headers[PRIVATE_UNLOCK_HEADER];
  if (typeof header === 'string' && header) return header;
  try { return new URL(req.url || '', 'http://localhost').searchParams.get(PRIVATE_UNLOCK_QUERY) || null; } catch { return null; }
}

export function createPrivateAccess(now: () => number = Date.now): PrivateAccess {
  // Insertion order is age order, so the oldest token is evicted first.
  const tokens = new Set<string>();
  let failures = 0, lockedUntil = 0;

  function refuseWhileLocked(): void {
    const wait = lockedUntil - now();
    if (wait > 0) throw httpError(`Too many wrong PINs. Try again in ${Math.ceil(wait / 1000)}s.`, 429);
  }
  function verify(stored: StoredPin, pin: unknown): void {
    refuseWhileLocked();
    if (matches(stored, pin)) { failures = 0; return; }
    failures += 1;
    if (failures >= FREE_FAILURES) {
      lockedUntil = now() + Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * 2 ** (failures - FREE_FAILURES));
    }
    throw httpError('Wrong PIN', 401);
  }

  return {
    pinConfigured: () => readPin() !== null,
    setPin(pin, currentPin) {
      if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) throw httpError('PIN must be 4–12 digits', 400);
      const stored = readPin();
      if (stored) verify(stored, currentPin);
      const salt = crypto.randomBytes(16).toString('base64');
      fs.mkdirSync(dishDir(), { recursive: true });
      replaceFileDurably(pinFile(), JSON.stringify({ salt, hash: digest(pin, salt).toString('base64') }) + '\n');
      tokens.clear();
    },
    unlock(pin) {
      const stored = readPin();
      if (!stored) throw httpError('No private-session PIN is set', 409);
      verify(stored, pin);
      const token = crypto.randomBytes(24).toString('base64url');
      tokens.add(token);
      if (tokens.size > MAX_TOKENS) tokens.delete(tokens.values().next().value!);
      return token;
    },
    lock(token) { if (token) tokens.delete(token); },
    unlocked(req) {
      const token = requestUnlockToken(req);
      return token !== null && tokens.has(token);
    },
  };
}
