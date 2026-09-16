/**
 * Published static pages point to live files/directories, not copied snapshots.
 * Persistence re-reads HOME on every operation through dish-store.
 */
import path = require('path');
import crypto = require('crypto');
import { readStore, writeStore } from './dish-store';
import { canonicalSessionId } from './session-key';

export interface CreatePageOptions {
  root: string;
  // The registration route passes titles through; this is not a string gate.
  title?: unknown;
  sessionId?: unknown;
  renderer?: unknown;
}

/** A newly constructed persistence record, before a later untrusted disk read. */
export interface PageRecord {
  root: string;
  title: unknown;
  sessionId: unknown;
  renderer?: unknown;
  createdAt: number;
}

/** Reads preserve legacy fields, including absent or malformed metadata. */
export interface PageDto extends Record<string, unknown> {
  root?: unknown;
  title?: unknown;
  sessionId: unknown;
  renderer?: unknown;
  createdAt?: unknown;
}

export interface ListedPageDto extends PageDto {
  // The existing spread order permits a stored token to override the map key.
  token: unknown;
}

// Object boxing reproduces JS property access/spread for legacy primitive rows.
// It makes no claim about the types of the object's unchecked members.
function fields(value: unknown): Record<string, unknown> {
  return Object(value) as Record<string, unknown>;
}

function canonical(value: unknown): unknown {
  if (!value) return null;
  try { return canonicalSessionId(value); } catch { return value; }
}

function readPages(): Record<string, unknown> {
  return readStore('pages.json');
}

function writePages(pages: Record<string, unknown>): void {
  writeStore('pages.json', pages);
}

/** Re-publishing a resolved root reuses its token and refreshes its metadata. */
export function createPage({ root, title = null, sessionId = null, renderer = null }: CreatePageOptions): string {
  const abs = path.resolve(root);
  sessionId = canonical(sessionId);
  const pages = readPages();
  for (const [token, entry] of Object.entries(pages)) {
    if (entry && fields(entry).root === abs) {
      const existing = fields(entry);
      const updated: PageDto = { ...existing, title: title ?? existing.title, sessionId: sessionId ?? canonical(existing.sessionId) };
      if (renderer) updated.renderer = renderer;
      else delete updated.renderer;
      pages[token] = updated;
      writePages(pages);
      return token;
    }
  }
  const token = crypto.randomBytes(16).toString('base64url');
  const entry: PageRecord = { root: abs, title, sessionId, ...(renderer ? { renderer } : {}), createdAt: Date.now() };
  pages[token] = entry;
  writePages(pages);
  return token;
}

// Returns whether the token existed (and was removed).
export function revokePage(token: string): boolean {
  const pages = readPages();
  if (!pages[token]) return false;
  delete pages[token];
  writePages(pages);
  return true;
}

export function getPage(token: string): PageDto | null {
  const entry = readPages()[token];
  return entry && fields(entry).root ? { ...fields(entry), sessionId: canonical(fields(entry).sessionId) } : null;
}

/** Newest first; do not drop malformed rows that the legacy list exposed. */
export function listPages(): ListedPageDto[] {
  return Object.entries(readPages())
    .map(([token, entry]): ListedPageDto => ({ token, ...fields(entry), sessionId: canonical(fields(entry).sessionId) }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}
