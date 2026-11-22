// Portable attachment wording shared by the upload route and the composer chips,
// so the size a chip shows is the size the agent reads in its prompt.

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
const NAME_MAX_BYTES = 150;
const EXTENSION_MAX_CHARS = 16;

/** `912 B`, `4.2 KB`, `2.1 MB`, `730 MB`. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes) || 0)} B`;
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) { value /= 1024; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${SIZE_UNITS[unit]}`;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Shortens by whole code points until the UTF-8 encoding fits. */
function fitBytes(text: string, max: number): string {
  const points = Array.from(text);
  while (points.length && utf8Length(points.join('')) > max) points.pop();
  return points.join('');
}

/**
 * A single safe path component for an uploaded file: the basename of the
 * client-supplied name with separators, control and shell-hostile characters
 * replaced, no leading dots (never `.`, `..` or a hidden file), and at most
 * 150 UTF-8 bytes with the extension kept. Falls back to `file`.
 */
export function safeUploadName(name: unknown): string {
  const raw = typeof name === 'string' ? name.normalize('NFC') : '';
  const base = raw.split(/[\\/]/).pop() || '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '');
  if (!cleaned) return 'file';
  if (utf8Length(cleaned) <= NAME_MAX_BYTES) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= EXTENSION_MAX_CHARS ? cleaned.slice(dot) : '';
  const stem = fitBytes(cleaned.slice(0, cleaned.length - extension.length), NAME_MAX_BYTES - utf8Length(extension)).trimEnd();
  return (stem || 'file') + extension;
}

export interface StoredAttachment {
  /** Absolute path on the session's host. */
  readonly path: string;
  /** The stored basename (`safeUploadName` of the original). */
  readonly name: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly size: number;
}

/** The prompt line every harness receives for a non-image attachment. */
export function attachmentReference(file: StoredAttachment): string {
  // One line, bounded, and no brackets that would end the reference early.
  // eslint-disable-next-line no-control-regex
  const original = fitBytes(file.originalName.replace(/[\u0000-\u001f\u007f[\]]/g, ' ').replace(/\s+/g, ' ').trim(), 200);
  const renamed = original && original !== file.name ? `original name "${original}", ` : '';
  return `[Attached file: ${file.path} (${renamed}${file.mimeType}, ${formatByteSize(file.size)})]`;
}
