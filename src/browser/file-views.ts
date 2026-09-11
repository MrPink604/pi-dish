import type { ApiRequest, HostEndpoint, RequestOptions } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import type { PublishedPage } from './session-info-data';
import { decodePublishedPages } from './session-info-data';
import { decodeFilePreview, decodeDiffView, decodeDiffPatch } from './file-view-data';
import { renderDiffViewHtml } from './file-view-render';
import { renderDiffHtml } from './helper-markdown';
import { escapeHtml, shortCwd } from './helper-format';
import { record } from './helper-values';
export function createFileViews(options: {
  document: Document; sessionState: SessionState; request: ApiRequest; host: (id: string | null) => HostEndpoint | null;
  markdown: (text: string) => string; highlight: (root: HTMLElement) => void; copy: (text: string) => Promise<unknown>;
  status: (message: string, type?: string) => void; refreshArtifacts: (owner: SelectionOwner) => void;
  closeComments: () => void; clearComments: () => void; refreshComments: () => void; markComments: () => void;
}) {
  const { document, sessionState } = options;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => { const value = document.getElementById(id); if (!value) throw new Error('Missing file view element: ' + id); return value as T; };
  const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
  interface View { owner: SelectionOwner | null; endpoint: Readonly<HostEndpoint> | null; sessionId: string | null; generation: number }
  const file: View & { raw: string | null; path: string | null; relPath: string | null } = { owner: null, endpoint: null, sessionId: null, generation: 0, raw: null, path: null, relPath: null };
  const diff: View = { owner: null, endpoint: null, sessionId: null, generation: 0 };
  let disposed = false, pageSequence = 0, copySequence = 0;
  let displayedPage: PublishedPage | null = null;
  let fileEvents = new AbortController(), pageEvents = new AbortController(), diffEvents = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const patchOwners = new WeakMap<HTMLElement, { generation: number; owner: SelectionOwner; endpoint: Readonly<HostEndpoint>; request: symbol | null }>();
  function isOpen(kind: 'file' | 'diff') { return !disposed && element('sessionView').classList.contains(kind + '-open'); }
  function owns(view: View, kind: 'file' | 'diff', id: string | null, generation: number) {
    if (disposed || !view.owner || !view.endpoint || view.sessionId !== id || view.generation !== generation || !isOpen(kind) || !sessionState.ownsSelection(view.owner)) return false;
    const current = options.host(view.owner.host); return !!current && current.base === view.endpoint.base;
  }
  const ownsFile = (id: string | null, generation: number) => owns(file, 'file', id, generation);
  const ownsDiff = (id: string | null, generation: number) => owns(diff, 'diff', id, generation);
  function capture(view: View) {
    const owner = sessionState.captureSelection(); if (!owner) return null;
    const endpoint = options.host(owner.host); if (!endpoint) return null;
    view.owner = owner; view.sessionId = owner.id; view.endpoint = Object.freeze({ ...endpoint }); view.generation++;
    return { owner, endpoint: view.endpoint, id: owner.id, generation: view.generation };
  }
  // Resolve the current credential only while dispatching to the captured base.
  function request(owner: SelectionOwner, endpoint: Readonly<HostEndpoint>, path: string, init?: RequestOptions) {
    const current = options.host(owner.host);
    if (disposed || !current || current.base !== endpoint.base) return Promise.reject(new Error('Host connection changed; reopen this view'));
    return options.request({ ...endpoint, token: current.token }, path, init);
  }
  async function json(response: Response): Promise<unknown> {
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(record(value) && typeof value.error === 'string' ? value.error : `HTTP ${response.status}`);
    return value;
  }
  function closeFile() {
    file.generation++; file.owner = null; file.endpoint = null; file.sessionId = null; file.raw = null; file.path = null; file.relPath = null;
    fileEvents.abort(); pageEvents.abort(); pageSequence++; copySequence++;
    for (const timer of timers) clearTimeout(timer); timers.clear();
    element('sessionView').classList.remove('file-open'); element('fileViewBody').innerHTML = '';
    const raw = element<HTMLAnchorElement>('fileViewRaw'); raw.style.display = 'none'; raw.removeAttribute('href');
    const publish = element<HTMLButtonElement>('fileViewPublish'); publish.disabled = false; publish.style.display = 'none';
    element('fileViewCopy').textContent = '⧉';
    clearPage(); options.closeComments(); options.clearComments();
  }
  function closeDiff() {
    diff.generation++; diff.owner = null; diff.endpoint = null; diff.sessionId = null; diffEvents.abort();
    element('sessionView').classList.remove('diff-open'); element('btnDiff').classList.remove('active'); element('diffViewBody').innerHTML = '';
    options.closeComments(); options.clearComments();
  }
  function clearPage() { displayedPage = null; pageEvents.abort(); const row = element('fileViewPage'); row.style.display = 'none'; row.innerHTML = ''; }
  function renderPage(page: PublishedPage, id: string, generation: number) {
    if (!ownsFile(id, generation) || !file.owner || !file.endpoint) return;
    clearPage(); displayedPage = page; pageEvents = new AbortController();
    const events = pageEvents, owner = file.owner, endpoint = file.endpoint, sequence = ++pageSequence;
    const current = () => !events.signal.aborted && sequence === pageSequence && ownsFile(id, generation);
    const link = page.url || document.defaultView!.location.origin + page.path, row = element('fileViewPage');
    row.style.display = ''; row.innerHTML = 'Published: ' + `<button type="button" class="stats-copy stats-share-link" title="Click to copy">${escapeHtml(link)}</button><button type="button" class="btn-small btn-danger" id="filePageRevoke">Unpublish</button>`;
    row.querySelector('.stats-copy')!.addEventListener('click', () => {
      if (!current()) return;
      void options.copy(link).then(() => { if (current()) options.status('Page link copied'); }, () => { if (current()) options.status('Copy failed (clipboard blocked)', 'error'); });
    }, { signal: events.signal });
    const revoke = row.querySelector<HTMLButtonElement>('#filePageRevoke')!;
    revoke.addEventListener('click', () => {
      if (!current() || revoke.disabled) return;
      revoke.disabled = true;
      void request(owner, endpoint, `/api/pages/${encodeURIComponent(page.token)}`, { method: 'DELETE' }).then(json).then(() => {
        if (!current()) return;
        pageSequence++; clearPage(); options.refreshArtifacts(owner);
      }).catch(e => { if (current()) { revoke.disabled = false; options.status('Failed to unpublish: ' + errorText(e), 'error'); } });
    }, { signal: events.signal });
  }
  async function publish() {
    const { owner, endpoint, sessionId: id, generation, path } = file;
    const button = element<HTMLButtonElement>('fileViewPublish');
    if (!owner || !endpoint || !id || !path || !ownsFile(id, generation) || button.disabled) return;
    const previousPage = displayedPage;
    const sequence = ++pageSequence; pageEvents.abort(); button.disabled = true;
    const current = () => ownsFile(id, generation) && pageSequence === sequence;
    try {
      const value = await json(await request(owner, endpoint, '/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, sessionId: id, title: path.split('/').pop(), renderer: 'file' }) }));
      if (!current()) return;
      const page = decodePublishedPages([value])[0]; if (!page) throw new Error('Invalid published page');
      button.disabled = false; renderPage(page, id, generation); options.refreshArtifacts(owner);
    } catch (e) { if (current()) { button.disabled = false; if (previousPage) renderPage(previousPage, id, generation); options.status('Publish failed: ' + errorText(e), 'error'); } }
  }
  function copy(button: HTMLElement) {
    const { sessionId: id, generation, raw } = file;
    if (raw === null || !ownsFile(id, generation) || !button.isConnected || !element('fileView').contains(button)) return;
    const sequence = ++copySequence;
    const current = () => ownsFile(id, generation) && sequence === copySequence && button.isConnected;
    void options.copy(raw).then(() => {
      if (!current()) return; button.textContent = '✓';
      const timer = setTimeout(() => { timers.delete(timer); if (current()) button.textContent = '⧉'; }, 1200); timers.add(timer);
    }, () => { if (current()) options.status('Copy failed (clipboard blocked)', 'error'); });
  }
  async function openFile(mention: string) {
    if (disposed || !sessionState.currentSession) return;
    closeFile(); closeDiff(); const captured = capture(file); if (!captured) return;
    const { owner, endpoint, id, generation } = captured;
    element('sessionView').classList.add('file-open'); fileEvents = new AbortController();
    element('fileViewPublish').addEventListener('click', () => { if (ownsFile(id, generation)) void publish(); }, { signal: fileEvents.signal });
    const copyButton = element('fileViewCopy'); copyButton.addEventListener('click', () => { if (ownsFile(id, generation)) copy(copyButton); }, { signal: fileEvents.signal });
    const body = element('fileViewBody'), title = element('fileViewTitle'), path = element('fileViewPath'), rawLink = element<HTMLAnchorElement>('fileViewRaw');
    title.textContent = mention.replace(/:\d+(?::\d+)?$/, '').split('/').pop() || ''; path.textContent = ''; path.title = ''; body.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const data = decodeFilePreview(await json(await request(owner, endpoint, `/api/sessions/${encodeURIComponent(id)}/file?path=${encodeURIComponent(mention)}`)));
      if (!ownsFile(id, generation)) return;
      title.textContent = data.path.split('/').pop() || ''; file.path = data.path; file.relPath = data.relPath;
      rawLink.href = endpoint.base + `/api/sessions/${encodeURIComponent(id)}/file/content?path=${encodeURIComponent(data.path)}&v=${data.mtime}-${data.size}`;
      rawLink.style.display = ''; element('fileViewPublish').style.display = '';
      const sequence = pageSequence;
      void request(owner, endpoint, '/api/pages').then(json).then(value => {
        if (!ownsFile(id, generation) || file.path !== data.path || sequence !== pageSequence) return;
        const page = decodePublishedPages(value).find(page => page.root === data.path); if (page) renderPage(page, id, generation);
      }).catch(() => {});
      const size = data.size >= 10240 ? `${Math.round(data.size / 1024)} KB` : `${data.size} B`;
      path.textContent = `${shortCwd(data.path)} · ${size}${data.truncated ? ' · truncated preview' : ''}`; path.title = data.path;
      if (data.image) {
        const src = data.image.url ? endpoint.base + data.image.url : `data:${data.image.mimeType};base64,${data.image.data}`;
        body.innerHTML = `<img class="file-view-img" src="${escapeHtml(src)}" decoding="async" alt="">`; return;
      }
      file.raw = data.content;
      const ext = data.path.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
      if (ext === 'md' || ext === 'markdown') body.innerHTML = `<div class="markdown-body">${options.markdown(data.content)}</div>`;
      else body.innerHTML = `<div class="markdown-body"><pre><code${ext ? ` class="language-${escapeHtml(ext)}"` : ''}${data.content.length > 80000 ? ' data-highlighted="skip"' : ''}>${escapeHtml(data.content)}</code></pre></div>`;
      options.highlight(body); options.refreshComments();
    } catch (e) { if (ownsFile(id, generation)) body.innerHTML = `<div class="error">${escapeHtml(errorText(e))}</div>`; }
  }
  async function openDiff() { if (disposed || !sessionState.currentSession) return; closeFile(); element('sessionView').classList.add('diff-open'); element('btnDiff').classList.add('active'); await loadDiff(); }
  function toggleDiff() { if (isOpen('diff')) closeDiff(); else void openDiff(); }
  async function loadDiff() {
    if (disposed || !sessionState.currentSession || !isOpen('diff')) return;
    const captured = capture(diff); if (!captured) return;
    const { owner, endpoint, id, generation } = captured; diffEvents.abort(); diffEvents = new AbortController();
    const body = element('diffViewBody'); options.closeComments(); body.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const data = decodeDiffView(await json(await request(owner, endpoint, `/api/sessions/${encodeURIComponent(id)}/diff`)));
      if (!ownsDiff(id, generation)) return;
      element('diffViewRoot').textContent = shortCwd(data.root); body.innerHTML = renderDiffViewHtml(data);
      body.querySelectorAll<HTMLDetailsElement>('details.diff-file').forEach(details => {
        const patch = details.querySelector<HTMLElement>('.diff-patch'); if (patch) patchOwners.set(patch, { generation, owner, endpoint, request: null });
        details.addEventListener('toggle', () => { if (ownsDiff(id, generation) && body.contains(details) && details.open) void loadPatch(details); }, { signal: diffEvents.signal });
      });
      options.refreshComments();
    } catch (e) { if (ownsDiff(id, generation)) body.innerHTML = `<div class="error">${escapeHtml(errorText(e))}</div>`; }
  }
  async function loadPatch(details: HTMLDetailsElement) {
    const patch = details.querySelector<HTMLElement>('.diff-patch[data-deferred="1"]');
    if (!patch || !element('diffViewBody').contains(details)) return;
    const owned = patchOwners.get(patch);
    if (!owned || owned.request || !ownsDiff(owned.owner.id, owned.generation)) return;
    const token = Symbol('patch'); owned.request = token; patch.dataset.loading = '1';
    const { repo = '', path = '', snapshot = '' } = patch.dataset;
    const current = () => ownsDiff(owned.owner.id, owned.generation) && element('diffViewBody').contains(patch) && patchOwners.get(patch) === owned && owned.request === token && patch.dataset.repo === repo && patch.dataset.path === path && patch.dataset.snapshot === snapshot;
    try {
      const query = new URLSearchParams({ repo, path, snapshot });
      const response = await request(owned.owner, owned.endpoint, `/api/sessions/${encodeURIComponent(owned.owner.id)}/diff/patch?${query}`);
      const value: unknown = await response.json(); const data = decodeDiffPatch(value);
      if (!current()) return;
      if (response.status === 409 && data.stale) { patch.innerHTML = '<div class="diff-file-note">Working tree changed — refreshing the diff…</div>'; await loadDiff(); return; }
      if (!response.ok) throw new Error(record(value) && typeof value.error === 'string' ? value.error : `HTTP ${response.status}`);
      patch.innerHTML = renderDiffHtml(data.patch) + (data.truncated ? '<div class="diff-file-note">… patch truncated</div>' : '');
      delete patch.dataset.deferred; delete patch.dataset.loading; owned.request = null; options.markComments();
    } catch (e) {
      if (!current()) return;
      delete patch.dataset.loading; owned.request = null;
      patch.innerHTML = `<div class="diff-file-note diff-patch-missing">Could not load patch: ${escapeHtml(errorText(e))}. Collapse and reopen to retry.</div>`;
    }
  }
  return { openFile, closeFile, publish, copy, openDiff, closeDiff, toggleDiff, loadDiff, loadPatch, ownsFile, ownsDiff,
    isFileOpen: () => isOpen('file'), isDiffOpen: () => isOpen('diff'),
    get file(): Readonly<typeof file> { return file; }, get diff(): Readonly<typeof diff> { return diff; },
    dispose() { closeFile(); closeDiff(); disposed = true; },
  };
}
