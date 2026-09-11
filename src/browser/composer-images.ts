import { record } from './helper-values';
export interface ComposerImage { readonly data: string; readonly mimeType: string }
export function decodeComposerImages(value: unknown): ComposerImage[] {
  return Array.isArray(value) ? value.flatMap((image: unknown) => record(image) && typeof image.data === 'string' && typeof image.mimeType === 'string' && image.mimeType.startsWith('image/') ? [{ data: image.data, mimeType: image.mimeType }] : []) : [];
}
export function createComposerImages(options: { document: Document; owner: () => string | null; status: (text: string, type?: string) => void }) {
  const { document } = options;
  const stored = new Map<string, readonly ComposerImage[]>(), aliases = new Map<string, string>();
  const batches = new Set<{ key: string; retired: boolean }>(), readers = new Set<FileReader>();
  let disposed = false, renderEvents = new AbortController(), lightbox: { element: HTMLElement; events: AbortController } | null = null;
  function resolve(key: string) { const seen = new Set<string>(); while (aliases.has(key) && !seen.has(key)) { seen.add(key); key = aliases.get(key)!; } return key; }
  function currentKey() { const key = options.owner(); return key ? resolve(key) : null; }
  function current(): readonly ComposerImage[] { const key = currentKey(); return key ? stored.get(key) || [] : []; }
  function render() {
    renderEvents.abort(); const strip = document.getElementById('attachmentStrip'); if (!strip) return;
    strip.innerHTML = ''; const key = currentKey(), images = current();
    if (disposed || !key || !images.length) { strip.style.display = 'none'; return; }
    renderEvents = new AbortController(); const events = renderEvents;
    for (const image of images) {
      const thumb = document.createElement('span'); thumb.className = 'attachment-thumb'; const img = document.createElement('img'); img.src = `data:${image.mimeType};base64,${image.data}`; img.alt = '';
      const remove = document.createElement('button'); remove.className = 'attachment-remove'; remove.title = 'Remove'; remove.textContent = '✕';
      remove.addEventListener('click', () => {
        if (events.signal.aborted || currentKey() !== key || stored.get(key) !== images || !strip.contains(remove)) return;
        stored.set(key, images.filter(candidate => candidate !== image)); render();
      }, { signal: events.signal }); thumb.append(img, remove); strip.append(thumb);
    }
    strip.style.display = '';
  }
  function replace(key: string, value: unknown) { if (disposed) return; stored.set(resolve(key), decodeComposerImages(value)); if (currentKey() === resolve(key)) render(); }
  function append(key: string, value: unknown, prepend = true) {
    if (disposed) return; key = resolve(key); const images = decodeComposerImages(value), before = stored.get(key) || [];
    if (images.length) stored.set(key, prepend ? [...images, ...before] : [...before, ...images]); if (currentKey() === key) render();
  }
  function discard(key: string) { key = resolve(key); stored.delete(key); for (const batch of batches) if (batch.key === key) batch.retired = true; if (currentKey() === key) render(); }
  function migrate(from: string, to: string) {
    from = resolve(from); to = resolve(to); if (disposed || from === to) return;
    const source = stored.get(from) || []; if (source.length) stored.set(to, [...source, ...(stored.get(to) || [])]); stored.delete(from); aliases.set(from, to);
    for (const batch of batches) if (batch.key === from) batch.key = to; render();
  }
  function take(): readonly ComposerImage[] | null { const key = currentKey(), images = current(); if (!key || !images.length || disposed) return null; stored.delete(key); render(); return images; }
  function remove(index: number) { const key = currentKey(), images = current(); if (disposed || !key || !Number.isInteger(index) || index < 0 || index >= images.length) return; stored.set(key, images.filter((_, i) => i !== index)); render(); }
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
  async function prepare(file: File): Promise<ComposerImage> {
    if (disposed) throw new Error('Image attachments disposed');
    const bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(file).catch(() => null) : null;
    if (disposed) { bitmap?.close(); throw new Error('Image attachments disposed'); }
    if (!bitmap) return { data: await read(file), mimeType: file.type };
    try {
      const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size <= 512 * 1024) return { data: await read(file), mimeType: file.type };
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
        if (!file?.type?.startsWith('image/')) continue;
        try { const image = await prepare(file); if (!disposed && !batch.retired) append(batch.key, [image], false); }
        catch (error) { if (!disposed && !batch.retired && currentKey() === batch.key) options.status(`Could not attach ${file.name || 'image'}: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
      }
    } finally { batches.delete(batch); }
  }
  function closeLightbox() { if (lightbox) { lightbox.events.abort(); lightbox.element.remove(); lightbox = null; } }
  function openLightbox(src: string) {
    if (disposed) return; closeLightbox(); const overlay = document.createElement('div'); overlay.className = 'lightbox-overlay'; const image = document.createElement('img'); image.src = src; overlay.append(image);
    const entry = { element: overlay, events: new AbortController() }; lightbox = entry;
    overlay.addEventListener('click', () => { if (lightbox === entry) closeLightbox(); }, { signal: entry.events.signal }); document.body.append(overlay);
  }
  return { current, render, replace, append, discard, migrate, take, remove, prepare, read, add, openLightbox, closeLightbox,
    stored: (key: string): readonly ComposerImage[] => stored.get(resolve(key)) || [],
    dispose() { disposed = true; for (const batch of batches) batch.retired = true; for (const reader of [...readers]) reader.abort(); stored.clear(); aliases.clear(); renderEvents.abort(); render(); closeLightbox(); },
  };
}
