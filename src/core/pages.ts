/**
 * Published static pages point to live files/directories, not copied snapshots.
 * Persistence re-reads HOME on every operation through dish-store.
 */
import path = require('path');
import crypto = require('crypto');
import { readStore, writeStore } from './dish-store';
import { asRecord } from './wire-protocol';
import { tryCanonicalSessionId } from './session-key';

export interface CreatePageOptions {
  root: string;
  // The registration route passes titles through; this is not a string gate.
  title?: unknown;
  sessionId?: unknown;
  renderer?: unknown;
  /** The session a form on this page answers to; once set it stays until the token rotates. */
  formRecipient?: unknown;
}

/** A newly constructed persistence record, before a later untrusted disk read. */
export interface PageRecord {
  root: string;
  title: unknown;
  sessionId: unknown;
  renderer?: unknown;
  formRecipient?: unknown;
  createdAt: number;
}

/** Reads preserve legacy fields, including absent or malformed metadata. */
export interface PageDto extends Record<string, unknown> {
  root?: unknown;
  title?: unknown;
  sessionId: unknown;
  renderer?: unknown;
  formRecipient?: unknown;
  createdAt?: unknown;
}

export interface ListedPageDto extends PageDto {
  // The existing spread order permits a stored token to override the map key.
  token: unknown;
}

// Stored rows are external; members stay unknown until the route validates them.
function canonical(value: unknown): unknown {
  return value ? tryCanonicalSessionId(value) : null;
}

function readPages(): Record<string, unknown> {
  return readStore('pages.json');
}

function writePages(pages: Record<string, unknown>): void {
  writeStore('pages.json', pages);
}

/** Re-publishing a resolved root reuses its token and refreshes its metadata. */
export function createPage({ root, title = null, sessionId = null, renderer = null, formRecipient = null }: CreatePageOptions): string {
  const abs = path.resolve(root);
  sessionId = canonical(sessionId);
  formRecipient = canonical(formRecipient);
  const pages = readPages();
  for (const [token, entry] of Object.entries(pages)) {
    if (entry && asRecord(entry).root === abs) {
      const existing = asRecord(entry);
      const updated: PageDto = { ...existing, title: title ?? existing.title, sessionId: sessionId ?? canonical(existing.sessionId) };
      if (renderer) updated.renderer = renderer;
      else delete updated.renderer;
      const recipient = formRecipient ?? canonical(existing.formRecipient);
      if (recipient) updated.formRecipient = recipient;
      pages[token] = updated;
      writePages(pages);
      return token;
    }
  }
  // Never a leading "-", which a command line would read as an option.
  let token: string;
  do token = crypto.randomBytes(16).toString('base64url'); while (token.startsWith('-'));
  const entry: PageRecord = {
    root: abs, title, sessionId, ...(renderer ? { renderer } : {}), ...(formRecipient ? { formRecipient } : {}), createdAt: Date.now(),
  };
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

/** Records a page's form recipient if none is set yet (a form added after publishing). */
export function bindFormRecipient(token: string, sessionId: string): void {
  const pages = readPages();
  const entry = pages[token];
  if (!entry || asRecord(entry).formRecipient) return;
  pages[token] = { ...asRecord(entry), formRecipient: canonical(sessionId) };
  writePages(pages);
}

export function getPage(token: string): PageDto | null {
  const entry = readPages()[token];
  return entry && asRecord(entry).root ? { ...asRecord(entry), sessionId: canonical(asRecord(entry).sessionId) } : null;
}

/** Newest first; do not drop malformed rows that the legacy list exposed. */
export function listPages(): ListedPageDto[] {
  return Object.entries(readPages())
    .map(([token, entry]): ListedPageDto => ({ token, ...asRecord(entry), sessionId: canonical(asRecord(entry).sessionId) }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}
