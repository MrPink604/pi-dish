// Pure helpers for inline composer attachment tokens (`[Image #N]` and
// `[File #N: name]`). The attachment strip remains the source of truth:
// editing or deleting a token in the textarea never drops its attachment,
// while send-time resolution compacts numbering consistently with strip order.

export type AttachmentRefKind = 'image' | 'file';

export interface AttachmentRefDescriptor {
  readonly kind: AttachmentRefKind;
  readonly refId: number;
  readonly name?: string;
}

export interface TokenRange {
  readonly token: string;
  readonly start: number;
  readonly end: number;
}

export interface ResolvedAttachments<T> {
  readonly message: string;
  readonly images: readonly T[];
  readonly files: readonly T[];
  readonly hasFileTokens: boolean;
  readonly imageTokens: readonly string[];
  readonly fileTokens: readonly string[];
}

export const FILE_REF_NAME_MAX = 24;
const EXTENSION_MAX_CHARS = 8;

/** Short, single-line basename safe inside `[File #N: …]`. */
export function sanitizeAttachmentRefName(name: string): string {
  const base = (name || '').split(/[\\/]/).pop() || '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'file';
  const points = Array.from(cleaned);
  if (points.length <= FILE_REF_NAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  if (dot > 0) {
    const ext = cleaned.slice(dot);
    const extPoints = Array.from(ext);
    const stemPoints = Array.from(cleaned.slice(0, dot));
    if (extPoints.length <= EXTENSION_MAX_CHARS && stemPoints.length > 0 && extPoints.length + 2 <= FILE_REF_NAME_MAX) {
      const keep = FILE_REF_NAME_MAX - extPoints.length - 1;
      return `${stemPoints.slice(0, keep).join('').trimEnd()}…${ext}`;
    }
  }
  return `${points.slice(0, FILE_REF_NAME_MAX - 1).join('').trimEnd()}…`;
}

export function formatAttachmentToken(ref: AttachmentRefDescriptor): string {
  return ref.kind === 'image'
    ? `[Image #${ref.refId}]`
    : `[File #${ref.refId}: ${sanitizeAttachmentRefName(ref.name || 'file')}]`;
}

export function formatAttachmentBadge(refId: number): string {
  return `#${refId}`;
}

function clampOffset(offset: number | null | undefined, max: number, fallback: number): number {
  return typeof offset === 'number' && Number.isFinite(offset) ? Math.max(0, Math.min(max, Math.floor(offset))) : fallback;
}

/** Inserts one or more tokens at the textarea selection with clean spacing. */
export function insertTokensAtSelection(
  value: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
  tokens: readonly string[],
): { value: string; caret: number; inserted: string; start: number; end: number } {
  const max = value.length;
  let start = clampOffset(selectionStart, max, max);
  let end = clampOffset(selectionEnd, max, start);
  if (end < start) [start, end] = [end, start];
  const nonEmpty = tokens.filter(token => token.length > 0);
  if (!nonEmpty.length) return { value, caret: end, inserted: '', start, end };
  const before = value.slice(0, start);
  const after = value.slice(end);
  const body = nonEmpty.join(' ');
  const prefix = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const suffix = after.length === 0 || !/^\s/.test(after) ? ' ' : '';
  const inserted = prefix + body + suffix;
  return {
    value: before + inserted + after,
    caret: start + inserted.length,
    inserted,
    start,
    end,
  };
}

/** Finds all non-overlapping occurrences of currently staged tokens in `value`. */
export function findTokenRanges(value: string, activeTokens: readonly string[]): TokenRange[] {
  if (!value) return [];
  const unique = [...new Set(activeTokens.filter(token => token.length > 0))];
  if (!unique.length) return [];
  const ranges: TokenRange[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    let bestStart = -1;
    let bestToken = '';
    for (const token of unique) {
      const found = value.indexOf(token, cursor);
      if (found === -1) continue;
      if (bestStart === -1 || found < bestStart || (found === bestStart && token.length > bestToken.length)) {
        bestStart = found;
        bestToken = token;
      }
    }
    if (bestStart === -1) break;
    const end = bestStart + bestToken.length;
    ranges.push({ token: bestToken, start: bestStart, end });
    cursor = end;
  }
  return ranges;
}

/**
 * Deletion range for Backspace/Delete on a collapsed caret touching or inside a
 * currently staged token. Non-collapsed selections and prose tokens return null.
 */
export function atomicDeleteRange(
  value: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
  direction: 'backward' | 'forward',
  activeTokens: readonly string[],
): { start: number; end: number } | null {
  if (typeof selectionStart !== 'number' || typeof selectionEnd !== 'number' || selectionStart !== selectionEnd) {
    return null;
  }
  const pos = selectionStart;
  const ranges = findTokenRanges(value, activeTokens);
  const hit = direction === 'backward'
    ? ranges.find(range => range.start < pos && pos <= range.end)
    : ranges.find(range => range.start <= pos && pos < range.end);
  if (!hit) return null;
  let { start, end } = hit;
  const beforeChar = start > 0 ? value[start - 1] : '';
  const afterChar = end < value.length ? value[end] : '';
  if (beforeChar === ' ' && afterChar === ' ') end += 1;
  else if ((start === 0 || beforeChar === '\n') && afterChar === ' ') end += 1;
  return { start, end };
}

/** Removes every occurrence of `tokens` from `value`, collapsing horizontal space gaps cleanly. */
export function removeTokensFromText(
  value: string,
  tokens: readonly string[],
  caret = value.length,
): { value: string; caret: number; removed: number } {
  const ranges = findTokenRanges(value, tokens);
  if (!ranges.length) return { value, caret, removed: 0 };
  let out = value;
  let nextCaret = clampOffset(caret, value.length, value.length);
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i]!;
    let delStart = range.start;
    let delEnd = range.end;
    const beforeChar = delStart > 0 ? out[delStart - 1] : '';
    const afterChar = delEnd < out.length ? out[delEnd] : '';
    if (beforeChar === ' ' && afterChar === ' ') delEnd += 1;
    else if ((delStart === 0 || beforeChar === '\n') && afterChar === ' ') delEnd += 1;
    else if (beforeChar === ' ' && (delEnd === out.length || afterChar === '\n')) delStart -= 1;
    out = out.slice(0, delStart) + out.slice(delEnd);
    const delta = delEnd - delStart;
    if (nextCaret > delEnd) nextCaret -= delta;
    else if (nextCaret > delStart) nextCaret = delStart;
  }
  return { value: out, caret: nextCaret, removed: ranges.length };
}

/** Single-pass replacement of staged tokens so renumbering `#2 -> #1` never cascades. */
export function rewriteTokensInText(
  value: string,
  replacements: ReadonlyMap<string, string>,
): { value: string; matched: Set<string> } {
  const matched = new Set<string>();
  if (!value || !replacements.size) return { value, matched };
  const ranges = findTokenRanges(value, [...replacements.keys()]);
  if (!ranges.length) return { value, matched };
  let out = '';
  let cursor = 0;
  for (const range of ranges) {
    matched.add(range.token);
    out += value.slice(cursor, range.start) + (replacements.get(range.token) ?? range.token);
    cursor = range.end;
  }
  out += value.slice(cursor);
  return { value: out, matched };
}

/**
 * Compacts staged attachment numbering densely (`1..K` per kind) in strip order
 * and rewrites matching inline labels in one pass. Every staged attachment is
 * kept regardless of whether its label still appears in `message`.
 */
export function resolveAttachmentsForSend<T>(
  message: string,
  descriptors: readonly (AttachmentRefDescriptor & { readonly item: T })[],
): ResolvedAttachments<T> {
  const imageItems: (AttachmentRefDescriptor & { readonly item: T })[] = [];
  const fileItems: (AttachmentRefDescriptor & { readonly item: T })[] = [];
  for (const entry of descriptors) {
    if (entry.kind === 'file') fileItems.push(entry);
    else imageItems.push(entry);
  }
  const replacements = new Map<string, string>();
  const fileOldTokens = new Set<string>();
  const imageTokens: string[] = [];
  const fileTokens: string[] = [];
  imageItems.forEach((entry, index) => {
    const oldToken = formatAttachmentToken({ kind: 'image', refId: entry.refId });
    const newToken = formatAttachmentToken({ kind: 'image', refId: index + 1 });
    replacements.set(oldToken, newToken);
    imageTokens.push(newToken);
  });
  fileItems.forEach((entry, index) => {
    const oldToken = formatAttachmentToken({ kind: 'file', refId: entry.refId, name: entry.name });
    const newToken = formatAttachmentToken({ kind: 'file', refId: index + 1, name: entry.name });
    replacements.set(oldToken, newToken);
    fileOldTokens.add(oldToken);
    fileTokens.push(newToken);
  });
  const { value, matched } = rewriteTokensInText(message, replacements);
  let hasFileTokens = false;
  for (const token of matched) {
    if (fileOldTokens.has(token)) { hasFileTokens = true; break; }
  }
  return {
    message: value,
    images: imageItems.map(entry => entry.item),
    files: fileItems.map(entry => entry.item),
    hasFileTokens,
    imageTokens,
    fileTokens,
  };
}

/** Appends uploaded file references, labeling `[File #k]` when inline file tokens are present. */
export function appendFileManifest(message: string, references: readonly string[], labelFiles: boolean): string {
  if (!references.length) return message;
  const lines = labelFiles
    ? references.map((reference, index) => `[File #${index + 1}] ${reference}`)
    : [...references];
  return message ? `${message}\n\n${lines.join('\n')}` : lines.join('\n');
}

/** Strips unbacked staged image tokens before saving a sent prompt to `↑` history. */
export function formatPromptForHistory(sentMessage: string, stagedImageTokens: readonly string[]): string {
  if (!stagedImageTokens.length) return sentMessage.trim();
  return removeTokensFromText(sentMessage, stagedImageTokens).value.trim();
}

const IMAGE_TOKEN_RE = /^\[Image #[1-9]\d*\]$/;
// eslint-disable-next-line no-control-regex
const FILE_TOKEN_RE = /^\[File #[1-9]\d*: ([^\u0000-\u001f\u007f[\]]+)\]$/;

/** True only for canonical `[Image #N]` or `[File #N: name]` tokens we emit. */
export function isCanonicalAttachmentToken(value: string): boolean {
  if (IMAGE_TOKEN_RE.test(value)) return true;
  const match = FILE_TOKEN_RE.exec(value);
  if (!match) return false;
  const name = match[1]!;
  return name === sanitizeAttachmentRefName(name);
}

/** Decodes `pi-dish-draft-refs-<owner>` from localStorage, rejecting non-canonical entries. */
export function decodeDraftRefs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item: unknown): item is string => typeof item === 'string' && isCanonicalAttachmentToken(item)))];
  } catch {
    return [];
  }
}
