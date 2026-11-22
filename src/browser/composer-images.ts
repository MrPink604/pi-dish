import { record } from '../core/helper-values';
import { formatByteSize } from '../core/attachment-text';
import { errorMessage } from './api-client';
// Composer attachments per owner key. Images the model can see become content
// blocks (`ComposerImage`); every other file stays a `File` until send, when
// composer-submit streams it to the session's host and the prompt names its path.
export interface ComposerImage { readonly data: string; readonly mimeType: string }
export interface ComposerFile { readonly file: File; readonly name: string; readonly mimeType: string; readonly size: number }
export type ComposerAttachment = ComposerImage | ComposerFile;
export function isComposerFile(attachment: ComposerAttachment): attachment is ComposerFile { return 'file' in attachment; }
// Image types providers accept as-is; other decodable images are re-encoded as JPEG, undecodable ones travel as files.
const MODEL_IMAGE_TYPES: Record<string, true> = { 'image/png': true, 'image/jpeg': true, 'image/gif': true, 'image/webp': true };
const ICON_PATHS: readonly [RegExp, string][] = [
  [/^audio\//, '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'],
  [/^video\//, '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3v10l-6-3"/>'],
  [/^image\//, '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>'],
  [/zip|tar|gzip|bzip|xz|7z|rar|compressed/, '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M11 6h1M11 9h1M11 12h1M10 15h3v3h-3z"/>'],
  [/^text\/|json|xml|yaml|javascript|typescript|pdf|markdown|csv/, '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'],
];
const FILE_ICON_PATH = '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>';
export function decodeComposerImages(value: unknown): ComposerImage[] {
  return Array.isArray(value) ? value.flatMap((image: unknown) => record(image) && typeof image.data === 'string' && typeof image.mimeType === 'string' && image.mimeType.startsWith('image/') ? [{ data: image.data, mimeType: image.mimeType }] : []) : [];
}
function decodeComposerAttachments(value: unknown): ComposerAttachment[] {
  return Array.isArray(value) ? value.flatMap((item: unknown): ComposerAttachment[] => record(item) && item.file instanceof File && typeof item.name === 'string' && typeof item.mimeType === 'string' && typeof item.size === 'number'
    ? [{ file: item.file, name: item.name, mimeType: item.mimeType, size: item.size }] : decodeComposerImages([item])) : [];
}
export function createComposerImages(options: { document: Document; owner: () => string | null; status: (text: string, type?: string) => void }) {
  const { document } = options;
  const stored = new Map<string, readonly ComposerAttachment[]>(), aliases = new Map<string, string>();
  const uploads = new Map<string, { readonly files: readonly ComposerFile[]; readonly loaded: number[] }>();
  const batches = new Set<{ key: string; retired: boolean }>(), readers = new Set<FileReader>();
  let disposed = false, renderEvents = new AbortController(), lightbox: { element: HTMLElement; events: AbortController } | null = null;
  let bars = new Map<ComposerFile, HTMLProgressElement>();
  function resolve(key: string) { const seen = new Set<string>(); while (aliases.has(key) && !seen.has(key)) { seen.add(key); key = aliases.get(key)!; } return key; }
  function currentKey() { const key = options.owner(); return key ? resolve(key) : null; }
  function current(): readonly ComposerAttachment[] { const key = currentKey(); return key ? stored.get(key) || [] : []; }
  function chip(file: ComposerFile) {
    const element = document.createElement('span'); element.className = 'attachment-chip'; element.title = `${file.name} (${file.mimeType}, ${formatByteSize(file.size)})`;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('class', 'attachment-chip-icon'); icon.setAttribute('viewBox', '0 0 24 24');
    icon.innerHTML = ICON_PATHS.find(([pattern]) => pattern.test(file.mimeType))?.[1] ?? FILE_ICON_PATH;
    const name = document.createElement('span'); name.className = 'attachment-chip-name'; name.textContent = file.name;
    const size = document.createElement('span'); size.className = 'attachment-chip-size'; size.textContent = formatByteSize(file.size);
    element.append(icon, name, size); return element;
  }
  function render() {
    renderEvents.abort(); bars = new Map(); const strip = document.getElementById('attachmentStrip'); if (!strip) return;
    strip.innerHTML = ''; const key = currentKey(), items = current(), sending = key ? uploads.get(key) : undefined;
    if (disposed || !key || (!items.length && !sending)) { strip.style.display = 'none'; return; }
    renderEvents = new AbortController(); const events = renderEvents;
    for (const item of items) {
      let element: HTMLElement;
      if (isComposerFile(item)) element = chip(item);
      else { element = document.createElement('span'); element.className = 'attachment-thumb'; const img = document.createElement('img'); img.src = `data:${item.mimeType};base64,${item.data}`; img.alt = ''; element.append(img); }
      const remove = document.createElement('button'); remove.className = 'attachment-remove'; remove.title = 'Remove'; remove.textContent = '✕';
      remove.addEventListener('click', () => {
        if (events.signal.aborted || currentKey() !== key || stored.get(key) !== items || !strip.contains(remove)) return;
        stored.set(key, items.filter(candidate => candidate !== item)); render();
      }, { signal: events.signal }); element.append(remove); strip.append(element);
    }
    sending?.files.forEach((file, index) => {
      const element = chip(file); element.classList.add('uploading');
      const bar = document.createElement('progress'); bar.className = 'attachment-progress'; bar.max = Math.max(1, file.size); bar.value = sending.loaded[index] || 0;
      bars.set(file, bar); element.append(bar); strip.append(element);
    });
    strip.style.display = '';
  }
  function replace(key: string, value: unknown) { if (disposed) return; stored.set(resolve(key), decodeComposerAttachments(value)); if (currentKey() === resolve(key)) render(); }
  function append(key: string, value: unknown, prepend = true) {
    if (disposed) return; key = resolve(key); const attachments = decodeComposerAttachments(value), before = stored.get(key) || [];
    if (attachments.length) stored.set(key, prepend ? [...attachments, ...before] : [...before, ...attachments]); if (currentKey() === key) render();
  }
  function discard(key: string) { key = resolve(key); stored.delete(key); for (const batch of batches) if (batch.key === key) batch.retired = true; if (currentKey() === key) render(); }
  function migrate(from: string, to: string) {
    from = resolve(from); to = resolve(to); if (disposed || from === to) return;
    const source = stored.get(from) || []; if (source.length) stored.set(to, [...source, ...(stored.get(to) || [])]); stored.delete(from); aliases.set(from, to);
    for (const batch of batches) if (batch.key === from) batch.key = to; render();
  }
  function take(): readonly ComposerAttachment[] | null { const key = currentKey(), attachments = current(); if (!key || !attachments.length || disposed) return null; stored.delete(key); render(); return attachments; }
  function remove(index: number) { const key = currentKey(), attachments = current(); if (disposed || !key || !Number.isInteger(index) || index < 0 || index >= attachments.length) return; stored.set(key, attachments.filter((_, i) => i !== index)); render(); }
  /** Shows `files` as uploading chips of `key` until `done`; `progress` moves one file's bar. */
  function uploading(key: string, files: readonly ComposerFile[]) {
    key = resolve(key); const entry = { files, loaded: files.map(() => 0) };
    if (!disposed) { uploads.set(key, entry); if (currentKey() === key) render(); }
    return {
      progress(index: number, loaded: number) { if (uploads.get(key) !== entry) return; entry.loaded[index] = loaded; const bar = bars.get(files[index]!); if (bar) bar.value = loaded; },
      done() { if (uploads.get(key) !== entry) return; uploads.delete(key); if (currentKey() === key) render(); },
    };
  }
  function read(file: Blob): Promise<string> {
    if (disposed) return Promise.reject(new Error('Image attachments disposed'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); readers.add(reader);
      const cleanup = () => { readers.delete(reader); reader.onload = null; reader.onerror = null; reader.onabort = null; };
      reader.onload = () => { const value = String(reader.result); cleanup(); resolve(value.slice(value.indexOf(',') + 1)); };
      reader.onerror = reader.onabort = () => { cleanup(); reject(new Error('read failed')); };
      try { reader.readAsDataURL(file); } catch (error) { cleanup(); reject(error); }
    });
  }
  /** The model-ready image for `file`, or null when it can only travel as a file. */
  async function prepare(file: File): Promise<ComposerImage | null> {
    if (disposed) throw new Error('Image attachments disposed');
    const bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(file).catch(() => null) : null;
    if (disposed) { bitmap?.close(); throw new Error('Image attachments disposed'); }
    if (!bitmap) return MODEL_IMAGE_TYPES[file.type] === true ? { data: await read(file), mimeType: file.type } : null;
    try {
      const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size <= 512 * 1024 && MODEL_IMAGE_TYPES[file.type] === true) return { data: await read(file), mimeType: file.type };
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Image canvas unavailable'); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.85); return { data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg' };
    } finally { bitmap.close(); }
  }
  async function add(files: ArrayLike<File> | null | undefined) {
    const key = currentKey(); if (disposed || !key) return; const batch = { key, retired: false }; batches.add(batch);
    try {
      for (const file of Array.from(files || [])) {
        if (disposed || batch.retired) break;
        try {
          const image = file.type.startsWith('image/') ? await prepare(file) : null;
          const attachment: ComposerAttachment = image || { file, name: file.name || 'file', mimeType: file.type || 'application/octet-stream', size: file.size };
          if (!disposed && !batch.retired) append(batch.key, [attachment], false);
        }
        catch (error) { if (!disposed && !batch.retired && currentKey() === batch.key) options.status(`Could not attach ${file.name || 'file'}: ${errorMessage(error)}`, 'error'); }
      }
    } finally { batches.delete(batch); }
  }
  function closeLightbox() { if (lightbox) { lightbox.events.abort(); lightbox.element.remove(); lightbox = null; } }
  function openLightbox(src: string) {
    if (disposed) return; closeLightbox(); const overlay = document.createElement('div'); overlay.className = 'lightbox-overlay'; const image = document.createElement('img'); image.src = src; overlay.append(image);
    const entry = { element: overlay, events: new AbortController() }; lightbox = entry;
    overlay.addEventListener('click', () => { if (lightbox === entry) closeLightbox(); }, { signal: entry.events.signal }); document.body.append(overlay);
  }
  return { current, render, replace, append, discard, migrate, take, remove, uploading, prepare, read, add, openLightbox, closeLightbox,
    stored: (key: string): readonly ComposerAttachment[] => stored.get(resolve(key)) || [],
    isUploading: (key: string) => uploads.has(resolve(key)),
    dispose() { disposed = true; for (const batch of batches) batch.retired = true; for (const reader of [...readers]) reader.abort(); stored.clear(); uploads.clear(); aliases.clear(); renderEvents.abort(); render(); closeLightbox(); },
  };
}
