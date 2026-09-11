import type { ApiRequest, HostEndpoint } from './api-client';
import { createSessionApi, sendJson } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import type { createModelCatalog } from './model-catalog';
import { mountModelSelector } from './model-selector';
import { mountThinkingSelector } from './thinking-selector';
import { thinkingLevelsFor } from './helper-models';
import { formatTokens, filenameFromContentDisposition } from './helper-format';
import { sessionKey } from './helper-identity';
import { record } from './helper-values';
export function createSessionControls(options: {
  document: Document; sessionState: SessionState; catalog: ReturnType<typeof createModelCatalog>; request: ApiRequest;
  host: (id: string | null) => HostEndpoint | null; loadModels: (id: string, harnessId?: string) => Promise<unknown>;
  status: (message: string, type?: string) => void;
}) {
  const { document, sessionState, catalog } = options, window = document.defaultView!;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => { const value = document.getElementById(id); if (!value) throw new Error('Missing session control: ' + id); return value as T; };
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
  function header() {
    const row = sessionState.currentSession; if (!row) return null;
    return { id: row.id, isActive: row.isActive === true, name: typeof row.name === 'string' ? row.name : '', model: typeof row.model === 'string' ? row.model : '',
      harnessId: typeof row.harnessId === 'string' ? row.harnessId : undefined, thinkingLevel: typeof row.thinkingLevel === 'string' ? row.thinkingLevel : '',
      capabilities: record(row.capabilities) ? row.capabilities : {} };
  }
  function sessionSupports(row: NonNullable<ReturnType<typeof header>>, capability: string) { return row.capabilities[capability] !== false; }
  interface Owner { selection: SelectionOwner; endpoint: Readonly<HostEndpoint> }
  let disposed = false, modelOwner: Owner | null = null, thinkingOwner: Owner | null = null, renameOwner: Owner | null = null;
  let modelOpen = false, thinkingOpen = false, editMode = false, query = '';
  let modelSelector: ReturnType<typeof mountModelSelector> | null = null, thinkingSelector: ReturnType<typeof mountThinkingSelector> | null = null;
  let modelEvents = new AbortController(), thinkingEvents = new AbortController(), renameEvents = new AbortController();
  const lifetime = new AbortController(), mutations = new Map<string, symbol>(), timers = new Set<ReturnType<typeof setTimeout>>(), urls = new Map<string, ReturnType<typeof setTimeout>>();
  let enabledTimer: ReturnType<typeof setTimeout> | null = null, enabledSequence = 0, exportSequence = 0;
  function later(callback: () => void, ms = 0) { const timer = setTimeout(() => { timers.delete(timer); if (!disposed) callback(); }, ms); timers.add(timer); return timer; }
  function capture(): Owner | null { const selection = sessionState.captureSelection(); if (disposed || !selection) return null; const endpoint = options.host(selection.host); return endpoint ? { selection, endpoint: Object.freeze({ ...endpoint }) } : null; }
  function endpointCurrent(owner: Owner) { const endpoint = options.host(owner.selection.host); return !disposed && endpoint && endpoint.base === owner.endpoint.base ? { ...owner.endpoint, token: endpoint.token } : null; }
  function owns(owner: Owner | null): owner is Owner { return !!owner && !!endpointCurrent(owner) && sessionState.ownsSelection(owner.selection); }
  function api(owner: Owner) { const endpoint = endpointCurrent(owner); if (!endpoint) throw new Error('Host connection changed'); return createSessionApi((_host, path, init) => options.request(endpoint, path, init)); }
  function mutation(owner: Owner, kind: string) {
    const key = sessionKey(owner.selection.host, owner.selection.id) + ':' + kind, token = Symbol(kind); mutations.set(key, token);
    return () => endpointCurrent(owner) && mutations.get(key) === token;
  }
  function place(dropdown: HTMLElement, trigger: HTMLElement) {
    dropdown.style.top = ''; dropdown.style.left = ''; dropdown.style.bottom = ''; dropdown.style.right = '';
    if (window.innerWidth > 768) { const rect = trigger.getBoundingClientRect(); dropdown.style.left = rect.left + 'px'; dropdown.style.top = rect.bottom + 4 + 'px'; }
  }
  function outside(ids: string[], events: AbortController, current: () => boolean, close: () => void) {
    later(() => {
      if (events.signal.aborted || !current()) return;
      document.addEventListener('click', event => {
        if (!current() || !(event.target instanceof Node)) return;
        if (!document.body.contains(event.target) || ids.some(id => element(id).contains(event.target as Node))) return;
        close();
      }, { signal: events.signal });
    });
  }
  function closeModels() { modelOwner = null; modelOpen = false; modelEvents.abort(); modelSelector?.dispose(); modelSelector = null; element('modelDropdown').style.display = 'none'; }
  function closeThinking() { thinkingOwner = null; thinkingOpen = false; thinkingEvents.abort(); thinkingSelector?.dispose(); thinkingSelector = null; element('thinkingDropdown').style.display = 'none'; }
  const ownsModels = (owner: Owner | null = modelOwner): owner is Owner => !!owner && owner === modelOwner && owns(owner) && modelOpen;
  const ownsThinking = (owner: Owner | null = thinkingOwner): owner is Owner => !!owner && owner === thinkingOwner && owns(owner) && thinkingOpen;
  async function toggleModels() {
    if (modelOwner) { closeModels(); return; }
    const session = header(), owner = capture();
    if (!owner || !session?.isActive || !sessionSupports(session, 'setModel')) return;
    modelOwner = owner;
    try { await options.loadModels(owner.selection.id, session.harnessId); } catch { if (modelOwner === owner) closeModels(); return; }
    if (!owns(owner) || modelOwner !== owner) return;
    modelOpen = true; editMode = false; query = ''; modelEvents = new AbortController();
    const dropdown = element('modelDropdown'); place(dropdown, element('sessionModel'));
    renderModels(''); dropdown.style.display = 'flex'; modelSelector?.focusSearch();
    outside(['modelSelector', 'modelDropdown'], modelEvents, () => ownsModels(owner), closeModels);
  }
  function renderModels(nextQuery: string) {
    const owner = modelOwner, session = header(); if (!ownsModels(owner) || !session) return; query = nextQuery;
    const owned = (target: SelectionOwner) => ownsModels(owner) && owner.selection === target;
    if (!modelSelector) modelSelector = mountModelSelector(element('modelDropdown'), {
      requestClose: target => { if (owned(target)) closeModels(); }, queryChanged: (target, value) => { if (owned(target)) renderModels(value); },
      editModeChanged: (target, value) => { if (owned(target)) setEditMode(value); }, selectModel: (target, value) => { if (owned(target)) void selectModel(value); },
      toggleModel: (target, value) => { if (owned(target)) toggleModel(value); }, toggleProvider: (target, value) => { if (owned(target)) toggleProvider(value); }, setAllEnabled: (target, value) => { if (owned(target)) setAll(value); },
    }, formatTokens);
    modelSelector.update({ owner: owner.selection, models: catalog.rows(), currentModel: session.model || null, harnessId: session.harnessId || null, query, editMode });
  }
  function setEditMode(value: boolean) { if (!ownsModels() || (value && header()?.harnessId !== 'pi')) return; editMode = value; renderModels(query); }
  function toggleModel(selector: string) { if (!ownsModels() || !editMode) return; catalog.toggle(selector); renderModels(query); saveEnabled(); }
  function toggleProvider(provider: string) { if (!ownsModels() || !editMode) return; catalog.toggleProvider(provider, query); renderModels(query); saveEnabled(); }
  function setAll(enabled: boolean) { if (!ownsModels() || !editMode) return; catalog.setAll(enabled); renderModels(query); saveEnabled(); }
  function saveEnabled() {
    const enabled = catalog.enabledIds(), self = options.host(null);
    if (disposed || enabled === undefined || !self) return;
    const endpoint = Object.freeze({ ...self }), ids = enabled && [...enabled], sequence = ++enabledSequence;
    if (enabledTimer !== null) { clearTimeout(enabledTimer); timers.delete(enabledTimer); }
    // This preference belongs to the serving Pi instance, independently of selection.
    enabledTimer = later(() => {
      enabledTimer = null; const current = options.host(null); if (!current || current.base !== endpoint.base) return;
      void sendJson(options.request, { ...endpoint, token: current.token }, '/api/models/enabled', { enabledIds: ids }, 'PUT').catch(error => {
        if (!disposed && sequence === enabledSequence && options.host(null)?.base === endpoint.base) options.status('Failed to save model list: ' + errorText(error), 'error');
      });
    }, 400);
  }
  async function selectModel(selector: string) {
    const session = header(), owner = capture(); closeModels();
    if (!owner || !session || !sessionSupports(session, 'setModel') || selector === session.model) return;
    const current = mutation(owner, 'model'); options.status('Switching model...', 'working');
    try {
      await api(owner).setModel(owner.selection, selector); if (!current()) return;
      sessionState.patchSession(owner.selection.id, { model: selector }, owner.selection.host);
      if (owns(owner)) options.status('Model switched to ' + selector);
    } catch (error) { if (current() && owns(owner)) options.status('Model switch failed: ' + errorText(error), 'error'); }
  }
  function updateThinking() {
    const session = header(), badge = element('sessionThinking');
    badge.style.display = session?.isActive && sessionSupports(session, 'setThinking') ? '' : 'none'; badge.textContent = (session?.thinkingLevel || '?') + ' ▾';
  }
  async function toggleThinking() {
    if (thinkingOwner) { closeThinking(); return; }
    const session = header(), owner = capture(); if (!owner || !session?.isActive || !sessionSupports(session, 'setThinking')) return;
    thinkingOwner = owner;
    try { await options.loadModels(owner.selection.id, session.harnessId); } catch { if (thinkingOwner === owner) closeThinking(); return; }
    if (!owns(owner) || thinkingOwner !== owner) return;
    thinkingOpen = true; thinkingEvents = new AbortController(); const dropdown = element('thinkingDropdown');
    const current = header()!, ref = current.model || '';
    const model = catalog.rows().find(row => row.selector === ref || row.id === ref || `${row.provider}/${row.id}` === ref);
    thinkingSelector = mountThinkingSelector(dropdown, {
      selectLevel: (target, value) => { if (ownsThinking(owner) && target === owner.selection) void selectThinking(value); },
      requestClose: target => { if (ownsThinking(owner) && target === owner.selection) closeThinking(); },
    });
    thinkingSelector.update({ owner: owner.selection, levels: thinkingLevelsFor(current.harnessId, model), currentLevel: current.thinkingLevel || null });
    place(dropdown, element('sessionThinking')); dropdown.style.display = 'block'; outside(['sessionThinking', 'thinkingDropdown'], thinkingEvents, () => ownsThinking(owner), closeThinking);
  }
  async function selectThinking(level: string) {
    const session = header(), owner = capture(); closeThinking();
    if (!owner || !session || !sessionSupports(session, 'setThinking')) return; const current = mutation(owner, 'thinking');
    try {
      const result = await api(owner).setThinking(owner.selection, level); if (!current()) return;
      const reported = result.level || level; sessionState.patchSession(owner.selection.id, { thinkingLevel: reported }, owner.selection.host);
      if (owns(owner)) options.status(reported !== level ? `Thinking level: ${reported} (model doesn't support ${level})` : `Thinking level: ${reported}`);
    } catch (error) { if (current() && owns(owner)) options.status('Thinking level failed: ' + errorText(error), 'error'); }
  }
  function cancelRename() { renameOwner = null; renameEvents.abort(); element('sessionNameInput').style.display = 'none'; element('sessionName').style.display = ''; }
  function startRename() {
    const session = header(), owner = capture(); if (!owner || !session?.isActive || !sessionSupports(session, 'rename')) return;
    cancelRename(); renameOwner = owner; renameEvents = new AbortController();
    const input = element<HTMLInputElement>('sessionNameInput'); element('sessionName').style.display = 'none'; input.style.display = ''; input.value = session.name || ''; input.focus(); input.select();
    const signal = renameEvents.signal;
    input.addEventListener('blur', () => { if (renameOwner === owner) void commitRename(); }, { signal });
    input.addEventListener('keydown', event => { if (renameOwner === owner) renameKey(event); }, { signal });
  }
  function renameKey(event: KeyboardEvent) { if (event.key === 'Enter') { event.preventDefault(); void commitRename(); } else if (event.key === 'Escape') cancelRename(); }
  async function commitRename() {
    const owner = renameOwner, value = element<HTMLInputElement>('sessionNameInput').value.trim(); cancelRename();
    const session = header(); if (!owns(owner) || !session?.isActive || !sessionSupports(session, 'rename') || !value || value === session.name) return;
    const current = mutation(owner, 'rename');
    try { await api(owner).rename(owner.selection, value); if (current()) sessionState.patchSession(owner.selection.id, { name: value }, owner.selection.host); }
    catch (error) { if (current() && owns(owner)) options.status('Rename failed: ' + errorText(error), 'error'); }
  }
  function download(blob: Blob, name: string) {
    if (disposed) return; const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove();
    const timer = later(() => { URL.revokeObjectURL(url); urls.delete(url); }, 60_000); urls.set(url, timer);
  }
  async function exportSession() {
    const session = header(), owner = capture(); if (!owner || !session) return;
    const endpoint = endpointCurrent(owner); if (!endpoint) return;
    const path = `/api/sessions/${encodeURIComponent(owner.selection.id)}/export`, sequence = ++exportSequence;
    if (!endpoint.token) { window.open(endpoint.base + path, '_blank'); return; }
    options.status('Exporting session…', 'working');
    try {
      const response = await options.request(endpoint, path);
      if (!response.ok) { const data: unknown = await response.json().catch(() => null); throw new Error(record(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`); }
      const blob = await response.blob(); if (!endpointCurrent(owner)) return;
      const fallback = `${(session.name || session.id).replace(/[^\w.-]+/g, '-')}.html`;
      download(blob, filenameFromContentDisposition(response.headers.get('Content-Disposition'), fallback));
      if (sequence === exportSequence && owns(owner)) options.status('Session exported');
    } catch (error) { if (sequence === exportSequence && owns(owner)) options.status('Export failed: ' + errorText(error), 'error'); }
  }
  element('sessionName').addEventListener('click', startRename, { signal: lifetime.signal });
  element('sessionModel').addEventListener('click', () => { void toggleModels(); }, { signal: lifetime.signal });
  element('sessionThinking').addEventListener('click', () => { void toggleThinking(); }, { signal: lifetime.signal });
  return { toggleModels, closeModels, renderModels, setEditMode, toggleModel, toggleProvider, setAll, saveEnabled, selectModel,
    toggleThinking, closeThinking, selectThinking, updateThinking, startRename, cancelRename, commitRename, renameKey, export: exportSession, download,
    get modelOpen() { return modelOpen; }, get thinkingOpen() { return thinkingOpen; }, get query() { return query; },
    get modelSelector() { return modelSelector; }, get thinkingSelector() { return thinkingSelector; },
    dispose() { closeModels(); closeThinking(); cancelRename(); disposed = true; lifetime.abort(); mutations.clear(); for (const timer of timers) clearTimeout(timer); timers.clear(); for (const url of urls.keys()) URL.revokeObjectURL(url); urls.clear(); },
  };
}
