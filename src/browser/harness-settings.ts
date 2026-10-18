import type { ApiRequest } from './api-client';
import { modelCatalogUrl } from './api-client';
import { sameDirectoryHost } from './directory-catalog';
import type { DirectoryHost } from './directory-catalog';
import { decodeModelCatalog } from '../core/session-api';
import type { CatalogModel } from '../core/session-api';
import { fuzzyMatch, fuzzyScore, highlightFuzzy } from '../core/helper-query';
import { catalogModelSelector, createModelPicker } from './model-catalog';
import type { ModelPicker, ModelPickerChoice } from './model-catalog';
import { decodeHarnessConfig, decodeHarnessAgents, decodeHarnessSettings, stringRecord } from './harness-settings-data';
import type { HarnessConfig, HarnessAgents, HarnessAgentPatch, HarnessSettingsList, HarnessSettingsPatch } from './harness-settings-data';
import { collectHarnessSettingsValues, filterHarnessSettings, renderHarnessSettingsPane } from './harness-settings-tabs';
export interface HarnessSettingsScope {
  readonly hostId: string | null;
  readonly harnessId: string;
  readonly cwd: string;
  readonly label: string;
  readonly tab?: string;
}
interface RoleDefinition { readonly key: string; readonly name: string; readonly description: string }
interface SettingsView {
  agents: HarnessAgents['agents'];
  settings: HarnessAgents['settings'];
  globalSettings: HarnessAgents['globalSettings'];
  readonly scope: HarnessSettingsScope;
  readonly host: Readonly<DirectoryHost>;
  config: HarnessConfig | null;
  models: readonly Readonly<CatalogModel>[];
  /** The harness's own settings panel; null when it has none or the read failed. */
  settingsList: HarnessSettingsList | null;
  saving: boolean;
}
/** Owns one settings modal; each open and save captures its endpoint and view. */
export function createHarnessSettings(options: {
  root: HTMLElement;
  host: (id: string | null) => Readonly<DirectoryHost> | null;
  request: ApiRequest;
  fallbackModels: (host: Readonly<DirectoryHost>, harness: string) => readonly Readonly<CatalogModel>[];
  escapeHtml: (text: string) => string;
  shortCwd: (cwd: string) => string;
  roleDefinitions: readonly RoleDefinition[];
  parseModelRoleRef: (value: string, known: readonly string[]) => { model: string; level: string };
  composeModelRoleRef: (model: string, level: string) => string;
  modelRoleLevels: (model: Readonly<CatalogModel> | undefined) => readonly string[];
  onSaved: (scope: HarnessSettingsScope) => void;
}) {
const { root, escapeHtml, shortCwd, parseModelRoleRef, composeModelRoleRef, modelRoleLevels } = options;
const AGENT_MODEL_ROLE_REFS = options.roleDefinitions.map(role => `@${role.key}`);
let harnessSettings: SettingsView | null = null;
let sequence = 0;
let activeTab = 'agents';
let pickers: { readonly input: HTMLInputElement; readonly picker: ModelPicker }[] = [];
const listeners = new AbortController();
function $(id: string): HTMLElement {
  const el = root.querySelector(`#${id}`);
  if (!(el instanceof HTMLElement)) throw new Error(`Missing harness settings control: ${id}`);
  return el;
}
const saveButton = $('modelRolesSave');
if (!(saveButton instanceof HTMLButtonElement)) throw new Error('Missing harness settings save button');
const button: HTMLButtonElement = saveButton;
const searchElement = $('hsSettingsSearch');
if (!(searchElement instanceof HTMLInputElement)) throw new Error('Missing harness settings search');
const search: HTMLInputElement = searchElement;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
function isOpen(): boolean { return root.style.display === 'flex'; }
function owns(view: SettingsView): boolean { return harnessSettings === view && isOpen(); }
function ownsHost(view: SettingsView): boolean { return sameDirectoryHost(view.host, options.host(view.scope.hostId)); }
function harnessSettingsError(message: string): void { $('modelRolesError').textContent = message; }
/** `agents`, `models`, or `settings:<tab>` for one of the harness's own settings tabs. */
function showTab(tab?: string): void {
  const tabs = Array.from(root.querySelectorAll<HTMLElement>('.hs-tab[data-tab]'));
  activeTab = tabs.some(node => node.dataset.tab === tab) ? tab || 'agents' : tab === 'models' ? 'models' : 'agents';
  for (const node of tabs) {
    const active = node.dataset.tab === activeTab;
    node.classList.toggle('active', active);
    node.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  const settingsTab = activeTab.startsWith('settings:') ? activeTab.slice('settings:'.length) : '';
  $('hsPaneAgents').style.display = activeTab === 'agents' ? '' : 'none';
  $('hsPaneModels').style.display = activeTab === 'models' ? '' : 'none';
  $('hsPaneSettings').style.display = settingsTab ? '' : 'none';
  if (settingsTab) filterHarnessSettings($('hsSettingsBody'), settingsTab, search.value);
}
function disposePickers(scope?: HTMLElement): void {
  pickers = pickers.filter(entry => {
    if (scope && !scope.contains(entry.input)) return true;
    entry.picker.dispose();
    return false;
  });
}
/** A model combobox over the view's catalog; the input's `data-value` holds the choice. */
function mountModelPicker(input: HTMLInputElement, choices: readonly ModelPickerChoice[], picked: () => void): void {
  const dropdown = input.nextElementSibling;
  if (!(dropdown instanceof HTMLElement)) return;
  const picker = createModelPicker({
    input, dropdown, rows: () => harnessSettings?.models || [], choices: () => choices, includeDisabled: true,
    selected: () => input.dataset.value || '',
    onPick: value => { input.dataset.value = value; picked(); },
    match: fuzzyMatch, score: fuzzyScore, highlight: highlightFuzzy, escapeHtml,
  });
  picker.sync();
  pickers.push({ input, picker });
}
function buildRoleRows(config: HarnessConfig | null | undefined) {
  const global = stringRecord(config?.globalModelRoles), effective = stringRecord(config?.modelRoles);
  const canonical = new Set(options.roleDefinitions.map(role => role.key));
  return [...options.roleDefinitions, ...Object.keys(global).filter(key => !canonical.has(key)).sort()
    .map(key => ({ key, name: key, description: 'Custom role' }))].map(role => {
      const value = global[role.key] || '', effectiveValue = effective[role.key] || '';
      return { ...role, value, override: effectiveValue && effectiveValue !== value ? effectiveValue : null };
    });
}
class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request(host: Readonly<DirectoryHost>, url: string, body?: unknown): Promise<unknown> {
  const response = await options.request(host, url, body === undefined ? undefined : {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(data && typeof data === 'object' && 'error' in data
    && typeof data.error === 'string' && data.error ? data.error : `HTTP ${response.status}`, response.status);
  return data;
}
async function settle<T>(promise: Promise<T>): Promise<{ value: T; error?: undefined; status?: undefined } | { value?: undefined; error: string; status: number | null }> {
  try { return { value: await promise }; } catch (error) {
    return { error: errorMessage(error), status: error instanceof RequestError ? error.status : null };
  }
}
function hostChanged(): void {
  harnessSettingsError('Host changed. Reopen settings to edit its current configuration.');
  button.disabled = true;
}
async function open(scope: HarnessSettingsScope): Promise<void> {
  const version = ++sequence;
  const endpoint = options.host(scope.hostId);
  root.style.display = 'flex';
  $('harnessSettingsTitle').textContent = `${scope.label} settings`;
  $('harnessSettingsScope').textContent = scope.cwd ? shortCwd(scope.cwd) : 'host default';
  $('harnessSettingsScope').title = scope.cwd || 'No working directory: the harness reads its global config only';
  $('harnessAgentsBody').textContent = 'Loading…';
  $('harnessSettingsDefaults').textContent = 'Loading…';
  disposePickers();
  $('modelRolesBody').innerHTML = '';
  $('hsDynamicTabs').innerHTML = '';
  $('hsSettingsBody').innerHTML = '';
  search.value = '';
  harnessSettingsError('');
  button.disabled = false; button.textContent = 'Save';
  showTab(scope.tab);
  if (!endpoint) { harnessSettings = null; hostChanged(); return; }
  const view: SettingsView = { scope: Object.freeze({ ...scope }), host: Object.freeze({ ...endpoint }),
    config: null, agents: [], settings: null, globalSettings: null, models: [], settingsList: null, saving: false };
  harnessSettings = view;
  const params = scope.cwd ? `?cwd=${encodeURIComponent(scope.cwd)}` : '';
  const base = `/api/harnesses/${encodeURIComponent(scope.harnessId)}`;
  const [config, agents, models, settingsList] = await Promise.all([
    settle(request(view.host, `${base}/config${params}`).then(decodeHarnessConfig)),
    settle(request(view.host, `${base}/agents${params}`).then(decodeHarnessAgents)),
    settle(request(view.host, modelCatalogUrl(scope.harnessId, scope.cwd)).then(decodeModelCatalog)),
    settle(request(view.host, `${base}/settings${params}`).then(decodeHarnessSettings)),
  ]);
  if (version !== sequence || !owns(view)) return;
  if (!ownsHost(view)) { hostChanged(); return; }
  view.config = config.value || null;
  view.models = models.value || options.fallbackModels(view.host, scope.harnessId);
  if (agents.value) {
    view.agents = agents.value.agents; view.settings = agents.value.settings; view.globalSettings = agents.value.globalSettings;
  }
  view.settingsList = settingsList.value || null;
  renderHarnessAgents(agents.error);
  renderHarnessDefaults(config.error);
  renderModelRoles();
  // A harness without a settings panel (501) gets no tabs; a failed read gets one explaining it.
  renderSettingsTabs(settingsList.status === 501 ? null : settingsList.error);
}
function close(): void { sequence++; harnessSettings = null; disposePickers(); root.style.display = 'none'; }
function renderSettingsTabs(error: string | null | undefined): void {
  const list = harnessSettings?.settingsList;
  const tabs = list ? list.tabs : error ? [{ id: 'unavailable', label: 'Settings' }] : [];
  $('hsDynamicTabs').innerHTML = tabs.map(tab =>
    `<button class="hs-tab" role="tab" data-tab="settings:${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>`).join('');
  $('hsSettingsBody').innerHTML = list ? renderHarnessSettingsPane(list, escapeHtml)
    : error ? `<section class="hs-settings-tab hs-settings-error" data-tab="unavailable">Settings unavailable: ${escapeHtml(error)}</section>` : '';
  $('hsSettingsSearchWrap').hidden = !list;
  showTab(activeTab);
}
function renderHarnessDefaults(error?: string) {
  const el = $('harnessSettingsDefaults');
  if (!el) return;
  const config = harnessSettings?.config;
  if (!config) {
    el.textContent = `Defaults unavailable: ${error || 'no response'}`;
    return;
  }
  el.textContent = `Default model: ${config.defaultModel || 'auto-select'} · Thinking: ${config.defaultThinkingLevel || 'host default'}`;
}

function harnessSettingsModelSelectors() {
  return (harnessSettings?.models || []).map(catalogModelSelector);
}

/**
 * Options for a role's thinking-level select: (inherit), then off/auto and
 * the model's supported ladder in OMP's /models roles order. `keepUnknown`
 * retains an off-ladder stored level as a "(current)" option — used on the
 * initial render only; switching the model rebuilds the ladder without it.
 */
function modelRoleLevelOptions(level: string, modelSelector: string, keepUnknown: boolean) {
  const models = harnessSettings?.models || [];
  const entry = models.find(m => catalogModelSelector(m) === modelSelector);
  const levels = modelRoleLevels(entry);
  let html = `<option value=""${level ? '' : ' selected'}>(inherit)</option>`;
  if (level && keepUnknown && !levels.includes(level)) {
    html += `<option value="${escapeHtml(level)}" selected>(current) ${escapeHtml(level)}</option>`;
  }
  for (const name of levels) {
    html += `<option value="${escapeHtml(name)}"${name === level ? ' selected' : ''}>${escapeHtml(name)}</option>`;
  }
  return html;
}

/** Model changed: re-derive the level ladder from the new model's catalog. */
function modelRoleModelChanged(input: HTMLInputElement) {
  const levelSelect = input.closest('.model-role-row')?.querySelector<HTMLSelectElement>('.model-role-level');
  if (!levelSelect) return;
  levelSelect.innerHTML = modelRoleLevelOptions(levelSelect.value, input.dataset.value || '', false);
}

/** A combobox input holding its choice in `data-value`, with the dropdown it filters. */
function modelPickerHtml(className: string, attrs: string, value: string, placeholder: string) {
  return `<div class="cwd-input-wrap hs-model-pick"><input type="text" class="cwd-input ${className}" ${attrs}
    data-initial="${escapeHtml(value)}" data-value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"
    spellcheck="false" autocomplete="off"><div class="cwd-dropdown"></div></div>`;
}

function renderModelRoles() {
  const body = $('modelRolesBody');
  disposePickers(body);
  const rows = buildRoleRows(harnessSettings?.config);
  const known = harnessSettingsModelSelectors();
  body.innerHTML = rows.map(row => {
    const { model, level } = parseModelRoleRef(row.value, known);
    return `<div class="model-role-row" data-role="${escapeHtml(row.key)}">
      <div class="model-role-label">
        <strong>${escapeHtml(row.name)}</strong>
        <code class="model-role-key">${escapeHtml(row.key)}</code>
        <small>${escapeHtml(row.description)}</small>
        ${row.override ? `<small class="model-role-override">project override: ${escapeHtml(row.override)} (.omp/config.yml wins here)</small>` : ''}
      </div>
      ${modelPickerHtml('model-role-select', `data-role="${escapeHtml(row.key)}" aria-label="${escapeHtml(`${row.name} model`)}"`, model, '(unset)')}
      <select class="model-role-level" data-role="${escapeHtml(row.key)}" data-initial="${escapeHtml(level)}"
              title="Thinking level for this role">${modelRoleLevelOptions(level, model, true)}</select>
    </div>`;
  }).join('');
  for (const input of Array.from(body.querySelectorAll<HTMLInputElement>('.model-role-select'))) {
    // A global assignment the catalog doesn't list stays selectable: the harness
    // may resolve refs this catalog can't (aliases, a provider added out of band).
    const current = input.dataset.initial || '';
    mountModelPicker(input, [{ key: '', label: '(unset)' },
      ...(current && !known.includes(current) ? [{ key: current, label: `(current) ${current}` }] : [])],
    () => modelRoleModelChanged(input));
  }
}

/**
 * Agent-model choices: inherit (the definition's own `model:`), the harness's
 * role refs, then the concrete catalog. An assignment the catalog doesn't list
 * stays selectable for the same reason the role editor keeps one.
 */
function agentModelChoices(value: string, inherited: string): ModelPickerChoice[] {
  const known = harnessSettingsModelSelectors();
  return [{ key: '', label: inherited ? `(inherit ${inherited})` : '(inherit)' },
    ...(value && !known.includes(value) && !AGENT_MODEL_ROLE_REFS.includes(value) ? [{ key: value, label: `(current) ${value}` }] : []),
    ...AGENT_MODEL_ROLE_REFS.map(ref => ({ key: ref, label: ref }))];
}

function triStateOptions(value: boolean | undefined) {
  const state = value === true ? 'on' : value === false ? 'off' : '';
  return [['', 'Inherit'], ['on', 'On'], ['off', 'Off']].map(([option, label]) =>
    `<option value="${option}"${option === state ? ' selected' : ''}>${label}</option>`).join('');
}

function triStateValue(state: string) {
  return state === 'on' ? true : state === 'off' ? false : null;
}

function renderHarnessAgents(error?: string) {
  const body = $('harnessAgentsBody');
  disposePickers(body);
  const global = harnessSettings?.globalSettings;
  const effective = harnessSettings?.settings;
  const agents = harnessSettings?.agents || [];
  if (!global) {
    body.textContent = `Agents unavailable: ${error || 'no response'}`;
    return;
  }
  if (!agents.length) {
    body.textContent = 'No task agents discovered for this harness.';
    return;
  }
  const disabled = new Set(global.disabled || []);
  const effectiveDisabled = new Set(effective?.disabled || []);
  body.innerHTML = agents.map(agent => {
    const name = agent.name;
    const model = global.modelOverrides?.[name] || '';
    const prewalk = global.prewalk?.[name];
    const advisor = global.advisor?.[name];
    const isDisabled = disabled.has(name);
    const overrides = [];
    if (effectiveDisabled.has(name) !== isDisabled) {
      overrides.push(effectiveDisabled.has(name) ? 'disabled here' : 'enabled here');
    }
    const effectiveModel = effective?.modelOverrides?.[name] || '';
    if (effectiveModel !== model) overrides.push(`model ${effectiveModel || 'inherited'}`);
    const definition = [agent.model, agent.thinkingLevel && `thinking ${agent.thinkingLevel}`]
      .filter(Boolean).join(' · ');
    return `<div class="hs-agent-row${isDisabled ? ' disabled' : ''}" data-agent="${escapeHtml(name)}">
      <div class="hs-agent-label">
        <label class="hs-agent-enable">
          <input type="checkbox" class="hs-agent-enabled" data-agent="${escapeHtml(name)}"
                 data-initial="${isDisabled ? 'off' : 'on'}"${isDisabled ? '' : ' checked'}>
          <strong>${escapeHtml(name)}</strong>
        </label>
        <span class="hs-agent-source hs-agent-source-${escapeHtml(agent.source || 'bundled')}">${escapeHtml(agent.source || 'bundled')}</span>
        ${definition ? `<code class="hs-agent-definition">${escapeHtml(definition)}</code>` : ''}
        <small>${escapeHtml(agent.description || '')}</small>
        ${overrides.length ? `<small class="model-role-override">project override: ${escapeHtml(overrides.join(', '))} (.omp/config.yml wins here)</small>` : ''}
      </div>
      <div class="hs-agent-controls">
        <div class="hs-agent-field hs-agent-model-field"><span>Model</span>
          ${modelPickerHtml('hs-agent-model', `data-agent="${escapeHtml(name)}" aria-label="${escapeHtml(`${name} model`)}"`, model, agent.model ? `(inherit ${agent.model})` : '(inherit)')}
        </div>
        <label class="hs-agent-field">Prewalk
          <select class="hs-agent-prewalk" data-agent="${escapeHtml(name)}" data-initial="${prewalk === true ? 'on' : prewalk === false ? 'off' : ''}">${triStateOptions(prewalk)}</select>
        </label>
        <label class="hs-agent-field">Advisor
          <select class="hs-agent-advisor" data-agent="${escapeHtml(name)}" data-initial="${advisor === true ? 'on' : advisor === false ? 'off' : ''}">${triStateOptions(advisor)}</select>
        </label>
      </div>
    </div>`;
  }).join('');
  for (const input of Array.from(body.querySelectorAll<HTMLInputElement>('.hs-agent-model'))) {
    const agent = agents.find(entry => entry.name === input.dataset.agent);
    mountModelPicker(input, agentModelChoices(input.dataset.initial || '', agent?.model || ''), () => {});
  }
}

/** Only the rows the user moved, in the PUT shapes the three endpoints take. */
function collectHarnessSettingsPatch(): HarnessSettingsPatch | { error: string } {
  const roles: HarnessSettingsPatch['roles'] = Object.create(null);
  const levelSelects = new Map<string, HTMLSelectElement>();
  for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>('#modelRolesBody .model-role-level'))) {
    if (select.dataset.role) levelSelects.set(select.dataset.role, select);
  }
  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('#modelRolesBody .model-role-select'))) {
    if (!input.dataset.role) continue;
    const levelSelect = levelSelects.get(input.dataset.role);
    const level = levelSelect?.value || '', model = input.dataset.value || '';
    if (model === input.dataset.initial && level === (levelSelect?.dataset.initial || '')) continue;
    // Inherit stores as the bare model ref; an unset model drops the role.
    roles[input.dataset.role] = model ? composeModelRoleRef(model, level) : null;
  }
  const agents: HarnessSettingsPatch['agents'] = Object.create(null);
  const field = <K extends keyof HarnessAgentPatch>(name: string | undefined, key: K, value: HarnessAgentPatch[K]) => {
    if (!name) return;
    agents[name] = agents[name] || {};
    agents[name][key] = value;
  };
  for (const box of Array.from(root.querySelectorAll<HTMLInputElement>('#harnessAgentsBody .hs-agent-enabled'))) {
    const state = box.checked ? 'on' : 'off';
    if (state !== box.dataset.initial) field(box.dataset.agent, 'disabled', !box.checked);
  }
  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('#harnessAgentsBody .hs-agent-model'))) {
    const model = input.dataset.value || '';
    if (model !== input.dataset.initial) field(input.dataset.agent, 'model', model || null);
  }
  for (const [cls, key] of [['hs-agent-prewalk', 'prewalk'], ['hs-agent-advisor', 'advisor']] as const) {
    for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>(`#harnessAgentsBody .${cls}`))) {
      if (select.value === select.dataset.initial) continue;
      field(select.dataset.agent, key, triStateValue(select.value));
    }
  }
  const settings = collectHarnessSettingsValues($('hsSettingsBody'));
  if (settings.error !== undefined) return { error: settings.error };
  return { roles, agents, settings: settings.settings };
}
async function save(): Promise<void> {
  const view = harnessSettings;
  if (!view || !owns(view) || view.saving) return;
  if (!ownsHost(view)) { hostChanged(); return; }
  const patch = collectHarnessSettingsPatch();
  if ('error' in patch) { harnessSettingsError(patch.error); return; }
  const { roles, agents, settings } = patch;
  if (!Object.keys(roles).length && !Object.keys(agents).length && !Object.keys(settings).length) { close(); return; }
  const { cwd, harnessId } = view.scope;
  const base = `/api/harnesses/${encodeURIComponent(harnessId)}`;
  view.saving = true;
  harnessSettingsError(''); button.disabled = true; button.textContent = 'Saving…';
  try {
    // Every submitted patch retains this endpoint even if another view opens.
    // A failure stops the sequence; successful earlier writes stay committed.
    if (Object.keys(agents).length) await request(view.host, `${base}/agents`, { agents, cwd: cwd || undefined });
    if (Object.keys(roles).length) await request(view.host, `${base}/model-roles`, { roles, cwd: cwd || undefined });
    if (Object.keys(settings).length) await request(view.host, `${base}/settings`, { settings, cwd: cwd || undefined });
    if (owns(view)) close();
    // A submitted save also refreshes matching background consumers after the
    // modal closes; the callback retains the saved scope, never the new view.
    options.onSaved(view.scope);
  } catch (error) { if (owns(view)) harnessSettingsError(errorMessage(error)); }
  finally {
    view.saving = false;
    if (owns(view)) { button.disabled = false; button.textContent = 'Save'; }
  }
}
root.addEventListener('change', event => {
  const view = harnessSettings;
  if (!view || !owns(view) || !ownsHost(view)) return;
  const target = event.target;
  if (target instanceof HTMLInputElement && target.matches('.hs-agent-enabled')) target.closest('.hs-agent-row')?.classList.toggle('disabled', !target.checked);
}, { signal: listeners.signal });
root.addEventListener('click', event => {
  const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('.hs-tab[data-tab]') : null;
  if (tab && root.contains(tab)) showTab(tab.dataset.tab);
}, { signal: listeners.signal });
search.addEventListener('input', () => showTab(activeTab), { signal: listeners.signal });
return { open, close, save, showTab, isOpen, dispose() { close(); listeners.abort(); } };
}
