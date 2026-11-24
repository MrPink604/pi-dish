import { record } from '../core/helper-values';
import { formatByteSize } from '../core/attachment-text';
import { errorMessage } from './api-client';
import { formatAttachmentBadge, formatAttachmentToken } from './composer-refs';
// Composer attachments per owner key. Images the model can see become content
// blocks (`ComposerImage`); every other file stays a `File` until send, when
// composer-submit streams it to the session's host and the prompt names its path.
export interface ComposerImage {
  readonly data: string;
  readonly mimeType: string;
  readonly refId?: number;
  readonly width?: number;
  readonly height?: number;
}
export interface ComposerFile {
  readonly file: File;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly refId?: number;
}
export type ComposerAttachment = ComposerImage | ComposerFile;
export function isComposerFile(attachment: ComposerAttachment): attachment is ComposerFile { return 'file' in attachment; }
function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
export function attachmentRefToken(attachment: ComposerAttachment): string | null {
  const refId = positiveInt(attachment.refId);
  if (!refId) return null;
  return isComposerFile(attachment)
    ? formatAttachmentToken({ kind: 'file', refId, name: attachment.name })
    : formatAttachmentToken({ kind: 'image', refId });
}
// Image types bots accept without re-encoding (bots accept PNG and JPEG only).
const BOT_PASSTHROUGH_IMAGE_TYPES: Record<string, true> = { 'image/png': true, 'image/jpeg': true };
// Image types standard model chats accept directly without losing animation or transparency.
const MODEL_IMAGE_TYPES: Record<string, true> = { 'image/png': true, 'image/jpeg': true, 'image/gif': true, 'image/webp': true };
function canvasHasAlpha(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const data = context.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
    return false;
  } catch {
    return true;
  }
}
const ICON_PATHS: readonly [RegExp, string][] = [
  [/^audio\//, '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'],
  [/^video\//, '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3v10l-6-3"/>'],
  [/^image\//, '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>'],
  [/zip|tar|gzip|bzip|xz|7z|rar|compressed/, '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M11 6h1M11 9h1M11 12h1M10 15h3v3h-3z"/>'],
  [/^text\/|json|xml|yaml|javascript|typescript|pdf|markdown|csv/, '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'],
];
const FILE_ICON_PATH = '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>';
export function decodeComposerImages(value: unknown): ComposerImage[] {
  return Array.isArray(value) ? value.flatMap((image: unknown): ComposerImage[] => {
    if (!record(image) || typeof image.data !== 'string' || typeof image.mimeType !== 'string' || !image.mimeType.startsWith('image/')) return [];
    const refId = positiveInt(image.refId), width = positiveInt(image.width), height = positiveInt(image.height);
    return [{
      data: image.data, mimeType: image.mimeType,
      ...(refId ? { refId } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    }];
  }) : [];
}
function decodeComposerAttachments(value: unknown): ComposerAttachment[] {
  return Array.isArray(value) ? value.flatMap((item: unknown): ComposerAttachment[] => {
    if (record(item) && item.file instanceof File && typeof item.name === 'string' && typeof item.mimeType === 'string' && typeof item.size === 'number') {
      const refId = positiveInt(item.refId);
      return [{ file: item.file, name: item.name, mimeType: item.mimeType, size: item.size, ...(refId ? { refId } : {}) }];
    }
    return decodeComposerImages([item]);
  }) : [];
}
export function createComposerImages(options: {
  document: Document; owner: () => string | null; status: (text: string, type?: string) => void;
  isBotTarget?: (key: string) => boolean;
  onAdded?: (key: string, added: readonly ComposerAttachment[]) => void;
  onRemoved?: (key: string, removed: ComposerAttachment) => void;
}) {
  const { document } = options;
  const stored = new Map<string, readonly ComposerAttachment[]>(), aliases = new Map<string, string>();
  const refCounters = new Map<string, { image: number; file: number }>();
  const uploads = new Map<string, { readonly files: readonly ComposerFile[]; readonly loaded: number[] }>();
  const batches = new Set<{ key: string; retired: boolean }>(), readers = new Set<FileReader>();
  let disposed = false, renderEvents = new AbortController(), lightbox: { element: HTMLElement; events: AbortController } | null = null;
  let bars = new Map<ComposerFile, HTMLProgressElement>();
  function resolve(key: string) { const seen = new Set<string>(); while (aliases.has(key) && !seen.has(key)) { seen.add(key); key = aliases.get(key)!; } return key; }
  function currentKey() { const key = options.owner(); return key ? resolve(key) : null; }
  function current(): readonly ComposerAttachment[] { const key = currentKey(); return key ? stored.get(key) || [] : []; }
  function counterFor(key: string) {
    let entry = refCounters.get(key);
    if (!entry) { entry = { image: 0, file: 0 }; refCounters.set(key, entry); }
    return entry;
  }
  function assignRefIds(key: string, incoming: readonly ComposerAttachment[], existing: readonly ComposerAttachment[]) {
    const counter = counterFor(key);
    const usedImages = new Set<number>(), usedFiles = new Set<number>();
    for (const item of existing) {
      const id = positiveInt(item.refId);
      if (!id) continue;
      if (isComposerFile(item)) usedFiles.add(id);
      else usedImages.add(id);
    }
    counter.image = usedImages.size ? Math.max(counter.image, ...usedImages) : 0;
    counter.file = usedFiles.size ? Math.max(counter.file, ...usedFiles) : 0;
    const assigned: ComposerAttachment[] = [];
    const remapped = new Map<string, string>();
    for (const item of incoming) {
      const file = isComposerFile(item);
      const used = file ? usedFiles : usedImages;
      const requested = positiveInt(item.refId);
      let refId: number;
      if (requested && !used.has(requested)) {
        refId = requested;
        if (file) counter.file = Math.max(counter.file, refId);
        else counter.image = Math.max(counter.image, refId);
      } else {
        refId = file ? ++counter.file : ++counter.image;
        if (requested) {
          const oldToken = formatAttachmentToken(file ? { kind: 'file', refId: requested, name: item.name } : { kind: 'image', refId: requested });
          const newToken = formatAttachmentToken(file ? { kind: 'file', refId, name: item.name } : { kind: 'image', refId });
          remapped.set(oldToken, newToken);
        }
      }
      used.add(refId);
      assigned.push({ ...item, refId });
    }
    return { assigned, remapped };
  }
  function syncCountersAfterRemoval(key: string, remaining: readonly ComposerAttachment[]) {
    if (!remaining.length) { refCounters.delete(key); return; }
    const counter = refCounters.get(key);
    if (!counter) return;
    if (!remaining.some(item => !isComposerFile(item))) counter.image = 0;
    if (!remaining.some(isComposerFile)) counter.file = 0;
  }
  function badge(refId: number | undefined) {
    const id = positiveInt(refId);
    if (!id) return null;
    const el = document.createElement('span');
    el.className = 'attachment-ref-badge';
    el.textContent = formatAttachmentBadge(id);
    return el;
  }
  function chip(file: ComposerFile) {
    const element = document.createElement('span'); element.className = 'attachment-chip';
    element.title = file.refId
      ? `File #${file.refId} · ${file.name} (${file.mimeType}, ${formatByteSize(file.size)})`
      : `${file.name} (${file.mimeType}, ${formatByteSize(file.size)})`;
    const refBadge = badge(file.refId);
    if (refBadge) element.append(refBadge);
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
      else {
        element = document.createElement('span'); element.className = 'attachment-thumb';
        if (item.refId) element.title = `Image #${item.refId}`;
        const img = document.createElement('img'); img.src = `data:${item.mimeType};base64,${item.data}`; img.alt = '';
        element.append(img);
        const refBadge = badge(item.refId);
        if (refBadge) element.append(refBadge);
      }
      const remove = document.createElement('button'); remove.className = 'attachment-remove'; remove.title = 'Remove'; remove.textContent = '✕';
      remove.addEventListener('click', () => {
        if (events.signal.aborted || currentKey() !== key || stored.get(key) !== items || !strip.contains(remove)) return;
        const next = items.filter(candidate => candidate !== item);
        if (next.length) stored.set(key, next); else stored.delete(key);
        syncCountersAfterRemoval(key, next);
        render();
        options.onRemoved?.(key, item);
      }, { signal: events.signal }); element.append(remove); strip.append(element);
    }
    sending?.files.forEach((file, index) => {
      const element = chip(file); element.classList.add('uploading');
      const bar = document.createElement('progress'); bar.className = 'attachment-progress'; bar.max = Math.max(1, file.size); bar.value = sending.loaded[index] || 0;
      bars.set(file, bar); element.append(bar); strip.append(element);
    });
    strip.style.display = '';
  }
  function replace(key: string, value: unknown) {
    if (disposed) return; key = resolve(key); refCounters.delete(key);
    const { assigned } = assignRefIds(key, decodeComposerAttachments(value), []);
    if (assigned.length) stored.set(key, assigned); else stored.delete(key);
    if (currentKey() === key) render();
  }
  function append(key: string, value: unknown, prepend = true): { added: readonly ComposerAttachment[]; remapped: ReadonlyMap<string, string> } {
    if (disposed) return { added: [], remapped: new Map() };
    key = resolve(key); const before = stored.get(key) || [];
    const { assigned, remapped } = assignRefIds(key, decodeComposerAttachments(value), before);
    if (assigned.length) stored.set(key, prepend ? [...assigned, ...before] : [...before, ...assigned]);
    if (currentKey() === key) render();
    return { added: assigned, remapped };
  }
  function discard(key: string) { key = resolve(key); stored.delete(key); refCounters.delete(key); for (const batch of batches) if (batch.key === key) batch.retired = true; if (currentKey() === key) render(); }
  function migrate(from: string, to: string): ReadonlyMap<string, string> {
    from = resolve(from); to = resolve(to); if (disposed || from === to) return new Map();
    const source = stored.get(from) || []; stored.delete(from);
    const fromCounter = refCounters.get(from); refCounters.delete(from);
    let remapped = new Map<string, string>();
    if (source.length) {
      const dest = stored.get(to) || [];
      const result = assignRefIds(to, source, dest);
      stored.set(to, [...result.assigned, ...dest]);
      remapped = result.remapped;
      if (fromCounter) {
        const destCounter = counterFor(to);
        if (result.assigned.some(item => !isComposerFile(item))) destCounter.image = Math.max(destCounter.image, fromCounter.image);
        if (result.assigned.some(isComposerFile)) destCounter.file = Math.max(destCounter.file, fromCounter.file);
      }
    }
    aliases.set(from, to);
    for (const batch of batches) if (batch.key === from) batch.key = to; render();
    return remapped;
  }
  function take(): readonly ComposerAttachment[] | null { const key = currentKey(), attachments = current(); if (!key || !attachments.length || disposed) return null; stored.delete(key); refCounters.delete(key); render(); return attachments; }
  function remove(index: number) {
    const key = currentKey(), attachments = current();
    if (disposed || !key || !Number.isInteger(index) || index < 0 || index >= attachments.length) return;
    const removed = attachments[index]!;
    const next = attachments.filter((_, i) => i !== index);
    if (next.length) stored.set(key, next); else stored.delete(key);
    syncCountersAfterRemoval(key, next);
    render();
    options.onRemoved?.(key, removed);
  }
  function tokens(targetKey?: string): string[] {
    const key = targetKey ? resolve(targetKey) : currentKey();
    if (!key) return [];
    return (stored.get(key) || []).map(attachmentRefToken).filter((token): token is string => token !== null);
  }
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
  async function prepare(file: File, forBot = false): Promise<ComposerImage | null> {
    if (disposed) throw new Error('Image attachments disposed');
    const passthrough = forBot ? BOT_PASSTHROUGH_IMAGE_TYPES : MODEL_IMAGE_TYPES;
    const bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(file).catch(() => null) : null;
    if (disposed) { bitmap?.close(); throw new Error('Image attachments disposed'); }
    if (!bitmap) {
      if (passthrough[file.type] === true) return { data: await read(file), mimeType: file.type };
      if (forBot && MODEL_IMAGE_TYPES[file.type] === true) {
        throw new Error(`Could not decode ${file.type} for bot attachment`);
      }
      return null;
    }
    try {
      const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size <= 512 * 1024 && passthrough[file.type] === true) {
        return { data: await read(file), mimeType: file.type, width: bitmap.width, height: bitmap.height };
      }
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Image canvas unavailable'); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const usePng = file.type !== 'image/jpeg' && canvasHasAlpha(context, canvas.width, canvas.height);
      const mimeType = usePng ? 'image/png' : 'image/jpeg';
      const url = usePng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
      return { data: url.slice(url.indexOf(',') + 1), mimeType, width: canvas.width, height: canvas.height };
    } finally { bitmap.close(); }
  }
  async function add(files: ArrayLike<File> | null | undefined) {
    const key = currentKey(); if (disposed || !key) return;
    const forBot = Boolean(options.isBotTarget?.(key));
    const batch = { key, retired: false }; batches.add(batch);
    try {
      for (const file of Array.from(files || [])) {
        if (disposed || batch.retired) break;
        try {
          const image = file.type.startsWith('image/') ? await prepare(file, forBot) : null;
          const attachment: ComposerAttachment = image || { file, name: file.name || 'file', mimeType: file.type || 'application/octet-stream', size: file.size };
          if (!disposed && !batch.retired) {
            const { added } = append(batch.key, [attachment], false);
            if (added.length) options.onAdded?.(batch.key, added);
          }
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
  return { current, render, replace, append, discard, migrate, take, remove, tokens, uploading, prepare, read, add, openLightbox, closeLightbox,
    stored: (key: string): readonly ComposerAttachment[] => stored.get(resolve(key)) || [],
    isUploading: (key: string) => uploads.has(resolve(key)),
    dispose() { disposed = true; for (const batch of batches) batch.retired = true; for (const reader of [...readers]) reader.abort(); stored.clear(); refCounters.clear(); uploads.clear(); aliases.clear(); renderEvents.abort(); render(); closeLightbox(); },
  };
}
