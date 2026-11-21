/** Portable media extension and MIME helpers shared by server and browser. */

export const IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export const VIDEO_MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
};

/** Strip query/fragment and `:line[:col]` suffixes before inspecting the extension. */
function cleanMediaPath(rawPath: string): string {
  return String(rawPath || '').trim().split(/[?#]/)[0].replace(/:\d+(?::\d+)?$/, '');
}

/** Return the video MIME type for a path or URL with a supported video extension, else null. */
export function videoMimeForPath(rawPath: unknown): string | null {
  if (typeof rawPath !== 'string' || !rawPath) return null;
  const clean = cleanMediaPath(rawPath);
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return null;
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (dot <= slash + 1) return null;
  const ext = clean.slice(dot).toLowerCase();
  return Object.hasOwn(VIDEO_MIME_BY_EXT, ext) ? VIDEO_MIME_BY_EXT[ext] : null;
}

export function isVideoPath(rawPath: unknown): boolean {
  return videoMimeForPath(rawPath) !== null;
}

export function isVideoMimeType(mimeType: unknown): mimeType is string {
  return typeof mimeType === 'string' && /^video\/[A-Za-z0-9.+-]+$/i.test(mimeType.trim());
}

export function mediaFileName(rawPath: unknown, fallback = 'video'): string {
  if (typeof rawPath !== 'string' || !rawPath) return fallback;
  const clean = cleanMediaPath(rawPath).replace(/\/+$/, '');
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const base = slash >= 0 ? clean.slice(slash + 1) : clean;
  if (!base) return fallback;
  try { return decodeURIComponent(base); } catch { return base; }
}
