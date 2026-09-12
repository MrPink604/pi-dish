import type { ApiRequest } from './api-client';
import type { DirectoryHost } from './directory-catalog';
import { createDirectoryCatalog, sameDirectoryHost } from './directory-catalog';
import { createDirectoryTree } from './directory-tree';
import { createCwdAutocomplete } from './cwd-autocomplete';
import { createSpawnTargets, createSpawnTargetPicker } from './spawn-targets';
import type { SpawnTarget } from './spawn-targets';
import { createHarnessDiscovery } from './harness-discovery';
import { createNewSessionPreferences, createNewSessionConfigPreview } from './new-session-options';
import type { createModelCatalog } from './model-catalog';
import { modelsCacheKey } from './model-catalog';
import type { createSessionSpawns, SessionSpawnInput } from './session-spawns';
import type { SessionState } from './session-state';
import { escapeHtml, shortCwd } from './helper-format';
import { hostDisplayLabel } from './helper-identity';
import { formatModelRoleSummary } from './helper-models';
import { fuzzyMatch, fuzzyScore, highlightFuzzy } from './helper-query';

export const NEW_SESSION_HARNESS_KEY = 'pi-dish-new-harness';
const HOST_KEY = 'pi-dish-new-host';
export interface NewSessionHost extends DirectoryHost {
  readonly self?: boolean;
  readonly label?: string | null;
  readonly name?: string | null;
  readonly capabilities?: Readonly<Record<string, boolean | undefined>>;
}
export interface NewSessionOpenOptions { readonly cwd?: string; readonly draft?: string | null }
export type NewSessionSubmitOptions = Omit<SessionSpawnInput, 'host' | 'ownsView' | 'onAccepted'> & {
  readonly host?: string | Readonly<DirectoryHost> | null;
  readonly ownsView?: () => boolean;
};
/** The takeover owns its preferences, discovery controls and submitted form view. */
export function createNewSession(options: {
  root: HTMLElement;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  request: ApiRequest;
  self: () => Readonly<NewSessionHost>;
  host: (id: string | null) => Readonly<NewSessionHost> | null;
  hosts: () => readonly Readonly<NewSessionHost>[];
  hostDown: (host: Readonly<NewSessionHost>) => boolean;
  multiHost: () => boolean;
  sessionState: SessionState;
  currentSpawn: () => string | null;
  spawns: ReturnType<typeof createSessionSpawns>;
  models: ReturnType<typeof createModelCatalog>;
  closeOtherViews: () => void;
  closeSettings: () => void;
  harnessCacheChanged: () => void;
  status: (message: string, kind?: 'working' | 'error') => void;
}) {
  const { root, storage, models, request } = options;
  function element(id: string): HTMLElement {
    const node = root.querySelector('#' + id);
    if (!(node instanceof HTMLElement)) throw new Error(`Missing new-session control: ${id}`);
    return node;
  }
  function input(id: string): HTMLInputElement {
    const node = element(id);
    if (!(node instanceof HTMLInputElement)) throw new Error(`Invalid new-session input: ${id}`);
    return node;
  }
  function select(id: string): HTMLSelectElement {
    const node = element(id);
    if (!(node instanceof HTMLSelectElement)) throw new Error(`Invalid new-session select: ${id}`);
    return node;
  }
  const cwdInput = input('newSessionCwd'), nameInput = input('newSessionName');
  const hostSelect = select('nsHostSelect'), harnessSelect = select('nsHarnessSelect');
  const modelSelect = select('nsModelSelect'), thinkingSelect = select('nsThinkingSelect');
  const spawnElement = element('nsSpawnBtn');
  if (!(spawnElement instanceof HTMLButtonElement)) throw new Error('Invalid spawn button');
  const spawnButton: HTMLButtonElement = spawnElement;
  const workspaceRoot = element('nsWorkspaces');
  let selectedHostId = storage.getItem(HOST_KEY) || null;
  let harnessId = 'pi';
  let generation = 0;
  let draft: string | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let directoryTree: ReturnType<typeof createDirectoryTree> | null = null;
  let workspaceEvents = new AbortController();
  let disposed = false;
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  const isOpen = () => !disposed && root.classList.contains('new-session-open');
  const host = () => (selectedHostId ? options.host(selectedHostId) : null) || options.self();
  const hostId = () => host().hostId || null;
  const cwd = () => cwdInput.value.trim();
  const selectedHarness = () => harnessSelect.value || harnessId || 'pi';
  const supports = (capability: string) => !host().capabilities || host().capabilities?.[capability] === true;
  const hostOptions = () => options.hosts().filter(row => row.self || !options.hostDown(row));
  const error = (value: string) => { if (!disposed) element('nsError').textContent = value; };
  const preferences = createNewSessionPreferences({
    model: modelSelect, thinking: thinkingSelect, hiddenNote: element('nsModelHidden'), thinkingNote: element('nsThinkingNote'),
    rows: () => models.rows(), read: key => storage.getItem(key), write: (key, value) => storage.setItem(key, value), escapeHtml,
  });
  const config = createNewSessionConfigPreview({
    wrap: element('nsHarnessConfig'), values: element('nsHarnessConfigValues'), roles: element('nsHarnessRoles'),
    buttons: [element('nsEditAgents'), element('nsEditRoles')],
    scope: () => isOpen() ? { host: host(), harnessId: selectedHarness(), cwd: cwd(), view: generation } : null,
    request, roleSummary: formatModelRoleSummary,
  });
  const directories = createDirectoryCatalog({ host, request });
  const targets = createSpawnTargets({ host, supportsTmux: () => supports('tmux'), request,
    readSaved: () => storage.getItem('pi-dish-spawn-target'), save: key => storage.setItem('pi-dish-spawn-target', key),
    changed: () => targetPicker.sync(),
  });
  const targetPicker = createSpawnTargetPicker({
    input: input('newSessionTarget'), nameInput: input('newSessionTmuxName'), wrap: element('newSessionTargetWrap'),
    dropdown: element('spawnTargetDropdown'), targets,
    match: fuzzyMatch, score: fuzzyScore, highlight: highlightFuzzy, escapeHtml,
  });
  const selectedTarget = () => targets.selected(input('newSessionTmuxName').value);
  async function readHarnesses(target: string | null): Promise<unknown> {
    const response = await request(target, '/api/harnesses');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  const harnesses = createHarnessDiscovery({
    selectedHostId: hostId, selfHostId: () => options.self().hostId,
    requestPicker: readHarnesses, requestBackground: readHarnesses,
    preferredHarness: () => storage.getItem(NEW_SESSION_HARNESS_KEY),
    onPreferredHarness: value => { if (!disposed) harnessId = value; },
    onPickerChange: () => { if (disposed) return; renderHarnesses(); if (isOpen()) changeHarness(selectedHarness()); },
    onCacheChange: () => { if (!disposed) options.harnessCacheChanged(); },
  });
  const harnessLabel = (id: string) => harnesses.rows().find(row => row.id === id)?.label || (id === 'pi' ? 'Pi' : id);
  const autocomplete = createCwdAutocomplete({
    input: cwdInput, dropdown: element('cwdDropdown'), host, request,
    known: () => directories.current(), match: fuzzyMatch, score: fuzzyScore, highlight: highlightFuzzy, escapeHtml,
    onPick: value => { storage.setItem('pi-dish-cwd', value); scheduleRefresh(); },
    onBlur: scheduleRefresh, onSubmit: () => { void spawn(); },
  });
  const savedCwd = storage.getItem('pi-dish-cwd');
  if (savedCwd) cwdInput.value = savedCwd;

  function renderHosts(): void {
    if (disposed) return;
    if (isOpen() && directoryTree && !directoryTree.isCurrent()) {
      autocomplete.hide(); initTree(); void directories.load(); renderWorkspaces();
    }
    const row = element('nsHostRow'), available = hostOptions();
    if (available.length < 2) { row.style.display = 'none'; return; }
    row.style.display = '';
    hostSelect.innerHTML = available.map(value => `<option value="${escapeHtml(value.hostId || '')}">${escapeHtml(hostDisplayLabel(value))}</option>`).join('');
    hostSelect.value = hostId() || '';
  }
  function setHostId(value: string | null): void {
    if (disposed) return;
    selectedHostId = value || null;
    if (selectedHostId) storage.setItem(HOST_KEY, selectedHostId); else storage.removeItem(HOST_KEY);
  }
  function changeHost(value: string): void {
    if (disposed) return;
    autocomplete.hide(); setHostId(value); models.clear();
    void directories.load(); void targets.load(); void harnesses.load();
    renderWorkspaces(); initTree(); changeHarness(selectedHarness());
  }
  function renderHarnesses(): void {
    if (disposed) return;
    const available = harnesses.rows().filter(row => row.available !== false);
    harnessSelect.innerHTML = available.map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label || row.id)}</option>`).join('');
    if (!available.some(row => row.id === harnessId)) harnessId = available[0]?.id || 'pi';
    harnessSelect.value = harnessId;
  }
  function changeHarness(value: string): void {
    if (disposed) return;
    harnessId = value || 'pi'; storage.setItem(NEW_SESSION_HARNESS_KEY, harnessId);
    preferences.restore(harnessId); models.clear(); preferences.render(); refresh();
  }
  function refresh(): void {
    if (!isOpen()) return;
    const endpoint = Object.freeze({ ...host() }), harness = selectedHarness(), directory = cwd(), view = generation;
    const ownsRows = () => view === generation && isOpen() && selectedHarness() === harness && sameDirectoryHost(endpoint, host());
    models.retire(); preferences.render();
    void models.load({ host: endpoint, harnessId: harness, cwd: directory }, () => ownsRows() && cwd() === directory, ownsRows)
      .then(() => { if (ownsRows()) preferences.render(); });
    void config.load(directory);
  }
  function scheduleRefresh(): void {
    if (disposed) return;
    models.retire(); config.retire(); clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 300);
  }
  function initTree(): void {
    if (disposed) return;
    directoryTree?.dispose();
    directoryTree = createDirectoryTree({ root: element('nsTree'), host, request, onPick: setCwd });
    directoryTree.reset();
  }
  function setCwd(value: string): void { if (disposed) return; cwdInput.value = value; storage.setItem('pi-dish-cwd', value); scheduleRefresh(); }
  function renderWorkspaces(): void {
    if (disposed) return;
    workspaceEvents.abort(); workspaceEvents = new AbortController();
    const endpoint = Object.freeze({ ...host() }), view = generation;
    const seen = new Set<string>(), values: string[] = [];
    for (const session of [...options.sessionState.sessions.active, ...options.sessionState.sessions.previous]) {
      if (options.multiHost() && (session.host || null) !== endpoint.hostId) continue;
      if (session.cwd && !seen.has(session.cwd)) { seen.add(session.cwd); values.push(session.cwd); }
    }
    if (!values.length) { workspaceRoot.innerHTML = ''; return; }
    workspaceRoot.innerHTML = '<span class="ns-workspaces-label">Workspaces</span>' + values.slice(0, 12).map(value =>
      `<button class="ns-workspace-chip" data-cwd="${escapeHtml(value)}" title="${escapeHtml(value)}">${escapeHtml(shortCwd(value))}</button>`).join('');
    for (const button of workspaceRoot.querySelectorAll<HTMLButtonElement>('.ns-workspace-chip')) {
      const path = button.dataset.cwd;
      button.addEventListener('click', () => {
        if (path && isOpen() && view === generation && sameDirectoryHost(endpoint, host())) setCwd(path);
      }, { signal: workspaceEvents.signal });
    }
  }
  function open(value: NewSessionOpenOptions = {}): void {
    if (disposed) return;
    generation++; spawnButton.disabled = false; spawnButton.textContent = '+ New session';
    options.closeOtherViews(); root.classList.add('new-session-open'); draft = value.draft || null;
    nameInput.value = ''; renderHosts();
    void directories.load().then(() => { if (isOpen()) renderWorkspaces(); });
    void targets.load(); void harnesses.load();
    cwdInput.value = value.cwd || storage.getItem('pi-dish-cwd') || ''; error('');
    harnessId = storage.getItem(NEW_SESSION_HARNESS_KEY) || 'pi';
    renderHarnesses(); preferences.restore(harnessId);
    if (models.scope?.harnessId !== harnessId || !sameDirectoryHost(models.scope?.host || null, host())) {
      models.clear();
      try {
        const endpoint = Object.freeze({ ...host() }), harness = harnessId, view = generation;
        const cached: unknown = JSON.parse(storage.getItem(modelsCacheKey(harness, endpoint.hostId, options.self().hostId)) || 'null');
        if (Array.isArray(cached)) models.seed({ host: endpoint, harnessId: harness }, cached,
          () => view === generation && isOpen() && sameDirectoryHost(endpoint, host()) && selectedHarness() === harness);
      } catch {}
    }
    preferences.render(); renderWorkspaces(); initTree();
  }
  function close(): void {
    if (isOpen()) { generation++; models.retire(); }
    targets.retire(); targetPicker.hide(); directories.retire(); directoryTree?.dispose(); directoryTree = null;
    workspaceEvents.abort(); root.classList.remove('new-session-open'); options.closeSettings();
    clearTimeout(refreshTimer); config.retire(); autocomplete.hide();
  }
  function captureView(): () => boolean {
    const view = generation, open = isOpen(), selection = options.sessionState.captureSelection(), pending = options.currentSpawn();
    const endpoint = Object.freeze({ ...host() }), harness = selectedHarness(), directory = cwd();
    return () => !disposed && (!open || (sameDirectoryHost(endpoint, host()) && harness === selectedHarness() && directory === cwd()))
      && view === generation && open === isOpen() && pending === options.currentSpawn()
      && (selection ? options.sessionState.ownsSelection(selection) : !options.sessionState.currentSession);
  }
  function submit(value: NewSessionSubmitOptions = {}): Promise<string> {
    if (disposed) return Promise.reject(new Error('New-session form is no longer available'));
    const target = value.host === undefined ? hostId() : value.host;
    const endpoint = typeof target === 'object' && target ? target : options.host(target);
    if (!endpoint) return Promise.reject(new Error('Host is no longer available'));
    const view = generation, submittedDraft = value.draft === undefined ? draft : value.draft;
    return options.spawns.submit({ ...value, host: endpoint, draft: submittedDraft, ownsView: value.ownsView || captureView(),
      onAccepted: () => { if (view === generation && draft === submittedDraft) draft = null; },
    });
  }
  async function create(cwdValue?: string, targetHost: string | null = hostId()): Promise<void> {
    if (disposed) return;
    const selected = options.host(targetHost);
    if (!selected) { options.status('Host is no longer available', 'error'); return; }
    const endpoint = Object.freeze({ ...selected }), ownsView = captureView();
    let harness = storage.getItem(NEW_SESSION_HARNESS_KEY) || 'pi';
    let target: SpawnTarget | null = null;
    try {
      if (cwdValue !== undefined && sameDirectoryHost(endpoint, host())) await Promise.all([targets.load(), harnesses.load()]);
      if (sameDirectoryHost(endpoint, host())) { target = selectedTarget(); harness = selectedHarness(); }
      if (ownsView()) options.status(target ? 'Spawning in tmux…' : 'Creating session...', 'working');
      const directory = cwdValue === undefined ? cwd() : cwdValue;
      if (directory) storage.setItem('pi-dish-cwd', directory);
      await submit({ cwd: directory, target, harness, host: endpoint, ownsView, draft: null });
    } catch (error) { if (ownsView()) options.status(`Error: ${message(error)}`, 'error'); }
  }
  async function spawn(): Promise<void> {
    if (disposed || spawnButton.disabled) return;
    const view = generation, ownsView = captureView();
    let target;
    try { target = selectedTarget(); } catch (caught) { error(message(caught)); return; }
    const name = nameInput.value.trim(), directory = cwd();
    error(''); spawnButton.disabled = true; spawnButton.textContent = 'Starting…';
    try {
      if (directory) storage.setItem('pi-dish-cwd', directory);
      await submit({ name, cwd: directory, model: modelSelect.value || undefined, thinking: thinkingSelect.value || undefined,
        target, harness: selectedHarness(), ownsView });
    } catch (caught) { if (ownsView()) error(message(caught)); }
    finally { if (view === generation) { spawnButton.disabled = false; spawnButton.textContent = '+ New session'; } }
  }
  return { open, close, isOpen, host, hostId, hostOptions, supports, setHostId, changeHost,
    cwd, setCwd, selectedHarness, changeHarness, harnessLabel, renderHosts, renderHarnesses, renderWorkspaces,
    refresh, scheduleRefresh, initTree, selectedTarget, captureView, submit, create, spawn,
    preferences, config, harnesses, directories, targets, targetPicker,
    hideCwd: () => autocomplete.hide(), error,
    get generation() { return generation; }, get pendingDraft() { return draft; },
    dispose() { close(); disposed = true; autocomplete.dispose(); targetPicker.dispose(); },
  };
}
