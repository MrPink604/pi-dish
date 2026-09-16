/**
 * Public read-only share tokens for sessions and immutable native HTML snapshots.
 * Persistence re-reads HOME on every operation through dish-store.
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import { dishDir, readStore, writeStore } from './dish-store';
import { canonicalSessionId } from './session-key';
import type { SessionId } from './contracts';

export interface SessionShareRecord {
  sessionId: SessionId;
  createdAt: number;
  kind?: never;
}

export interface HtmlShareRecord {
  kind: 'html';
  createdAt: number;
  sessionId?: never;
}

export type ShareRecord = SessionShareRecord | HtmlShareRecord;

export interface SessionShareDto {
  kind: 'session';
  // Invalid legacy identities are returned unchanged, not silently discarded.
  sessionId: unknown;
}

export interface HtmlShareDto {
  kind: 'html';
}

export type ShareDto = SessionShareDto | HtmlShareDto;

export interface SessionShareToken {
  token: string;
}

// Box primitive legacy rows without asserting anything about their members.
function fields(value: unknown): Record<string, unknown> {
  return Object(value) as Record<string, unknown>;
}

function canonical(value: unknown): unknown {
  try { return canonicalSessionId(value); } catch { return value; }
}

function readShares(): Record<string, unknown> {
  return readStore('shares.json');
}

function writeShares(shares: Record<string, unknown>): void {
  writeStore('shares.json', shares);
}

function htmlDir(): string {
  return path.join(dishDir(), 'share-html');
}

function htmlPath(token: string): string {
  return path.join(htmlDir(), `${token}.html`);
}

function removeShareHtml(token: string): void {
  try { fs.unlinkSync(htmlPath(token)); } catch {}
}

// Idempotent: an existing share for the session reuses its token.
export function createShare(sessionId: unknown): string {
  const canonicalId = canonicalSessionId(sessionId);
  const shares = readShares();
  for (const [token, entry] of Object.entries(shares)) {
    if (entry && canonical(fields(entry).sessionId) === canonicalId) {
      if (fields(entry).sessionId !== canonicalId) {
        shares[token] = { ...fields(entry), sessionId: canonicalId };
        writeShares(shares);
      }
      return token;
    }
  }
  const token = crypto.randomBytes(16).toString('base64url');
  const entry: SessionShareRecord = { sessionId: canonicalId, createdAt: Date.now() };
  shares[token] = entry;
  writeShares(shares);
  return token;
}

export function createHtmlShare(html: string | NodeJS.ArrayBufferView): string {
  const shares = readShares();
  const token = crypto.randomBytes(16).toString('base64url');
  const entry: HtmlShareRecord = { kind: 'html', createdAt: Date.now() };
  shares[token] = entry;
  writeShares(shares);
  try {
    saveShareHtml(token, html);
  } catch (error) {
    const current = readShares();
    delete current[token];
    writeShares(current);
    removeShareHtml(token);
    throw error;
  }
  return token;
}

// Returns whether a share existed (and was removed).
export function revokeShare(sessionId: unknown): boolean {
  sessionId = canonical(sessionId);
  const shares = readShares();
  let existed = false;
  for (const [token, entry] of Object.entries(shares)) {
    if (entry && canonical(fields(entry).sessionId) === sessionId) {
      delete shares[token];
      removeShareHtml(token);
      existed = true;
    }
  }
  if (existed) writeShares(shares);
  return existed;
}

export function getShare(token: string): ShareDto | null {
  const entry = fields(readShares()[token]);
  if (entry.kind === 'html') return { kind: 'html' };
  return entry.sessionId ? { kind: 'session', sessionId: canonical(entry.sessionId) } : null;
}

export function getShareForSession(sessionId: unknown): SessionShareToken | null {
  sessionId = canonical(sessionId);
  const shares = readShares();
  for (const [token, entry] of Object.entries(shares)) {
    if (entry && canonical(fields(entry).sessionId) === sessionId) return { token };
  }
  return null;
}

// Token-derived filenames are private. Callers create/validate the token first;
// temp + rename keeps readers from seeing a partially replaced HTML snapshot.
function saveShareHtml(token: string, html: string | NodeJS.ArrayBufferView): string {
  if (!readShares()[token]) throw new Error('Unknown share token');
  const dir = htmlDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = htmlPath(token);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, html, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

export function getShareHtmlPath(token: string): string | null {
  if (!readShares()[token]) return null;
  const file = htmlPath(token);
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}
