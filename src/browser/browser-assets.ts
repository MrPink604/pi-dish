export type VendorAttributes = { src: string } | { rel: 'stylesheet'; href: string };

/** One local resource request per URL, with retry after load errors. */
export function createBrowserAssets(document: Document) {
  let disposed = false;
  const loaded = new Map<string, Promise<void>>();
  const pending = new Set<() => void>();
  function load(tag: 'script' | 'link', attributes: VendorAttributes): Promise<void> {
    if (disposed) return Promise.reject(new Error('Browser assets disposed'));
    const url = 'src' in attributes ? attributes.src : attributes.href;
    const key = tag + ':' + url;
    const existing = loaded.get(key); if (existing) return existing;
    const promise = new Promise<void>((resolve, reject) => {
      const element = document.createElement(tag);
      Object.assign(element, attributes);
      const cleanup = () => { pending.delete(cancel); element.onload = null; element.onerror = null; };
      const cancel = () => { cleanup(); element.remove(); reject(new Error('Browser assets disposed')); };
      pending.add(cancel);
      element.onload = () => { cleanup(); resolve(); };
      element.onerror = () => { cleanup(); element.remove(); reject(new Error('Failed to load ' + url)); };
      document.head.append(element);
    }).catch(error => { loaded.delete(key); throw error; });
    loaded.set(key, promise); return promise;
  }
  return { load, dispose() { disposed = true; for (const cancel of [...pending]) cancel(); loaded.clear(); } };
}
