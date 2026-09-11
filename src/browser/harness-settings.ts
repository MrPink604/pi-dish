import type { ApiRequest } from './api-client';
import { modelCatalogUrl } from './api-client';
import { sameDirectoryHost } from './directory-catalog';
import type { DirectoryHost } from './directory-catalog';
import { decodeModelCatalog } from '../core/session-api';
import type { CatalogModel } from '../core/session-api';
import { decodeHarnessConfig, decodeHarnessAgents, stringRecord } from './harness-settings-data';
import type { HarnessConfig, HarnessAgents, HarnessAgentPatch, HarnessSettingsPatch } from './harness-settings-data';
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
const listeners = new AbortController();
function $(id: string): HTMLElement {
  const el = root.querySelector(`#${id}`);
  if (!(el instanceof HTMLElement)) throw new Error(`Missing harness settings control: ${id}`);
  return el;
}
const saveButton = $('modelRolesSave');
if (!(saveButton instanceof HTMLButtonElement)) throw new Error('Missing harness settings save button');
const button: HTMLButtonElement = saveButton;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
function isOpen(): boolean { return root.style.display === 'flex'; }
function owns(view: SettingsView): boolean { return harnessSettings === view && isOpen(); }
function ownsHost(view: SettingsView): boolean { return sameDirectoryHost(view.host, options.host(view.scope.hostId)); }
function harnessSettingsError(message: string): void { $('modelRolesError').textContent = message; }
function showTab(tab?: string): void {
  for (const [name, tabId, paneId] of [['agents', 'hsTabAgents', 'hsPaneAgents'], ['models', 'hsTabModels', 'hsPaneModels']]) {
    const active = name === (tab === 'models' ? 'models' : 'agents');
    $(tabId).classList.toggle('active', active);
    $(tabId).setAttribute('aria-selected', active ? 'true' : 'false');
    $(paneId).style.display = active ? '' : 'none';
  }
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
async function request(host: Readonly<DirectoryHost>, url: string, body?: unknown): Promise<unknown> {
  const response = await options.request(host, url, body === undefined ? undefined : {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data
    && typeof data.error === 'string' && data.error ? data.error : `HTTP ${response.status}`);
  return data;
}
async function settle<T>(promise: Promise<T>): Promise<{ value: T; error?: undefined } | { value?: undefined; error: string }> {
  try { return { value: await promise }; } catch (error) { return { error: errorMessage(error) }; }
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
  $('modelRolesBody').innerHTML = '';
  harnessSettingsError('');
  button.disabled = false; button.textContent = 'Save';
  showTab(scope.tab);
  if (!endpoint) { harnessSettings = null; hostChanged(); return; }
  const view: SettingsView = { scope: Object.freeze({ ...scope }), host: Object.freeze({ ...endpoint }),
    config: null, agents: [], settings: null, globalSettings: null, models: [], saving: false };
  harnessSettings = view;
  const params = scope.cwd ? `?cwd=${encodeURIComponent(scope.cwd)}` : '';
  const base = `/api/harnesses/${encodeURIComponent(scope.harnessId)}`;
  const [config, agents, models] = await Promise.all([
    settle(request(view.host, `${base}/config${params}`).then(decodeHarnessConfig)),
    settle(request(view.host, `${base}/agents${params}`).then(decodeHarnessAgents)),
    settle(request(view.host, modelCatalogUrl(scope.harnessId, scope.cwd)).then(decodeModelCatalog)),
  ]);
  if (version !== sequence || !owns(view)) return;
  if (!ownsHost(view)) { hostChanged(); return; }
  view.config = config.value || null;
  view.models = models.value || options.fallbackModels(view.host, scope.harnessId);
  if (agents.value) {
    view.agents = agents.value.agents; view.settings = agents.value.settings; view.globalSettings = agents.value.globalSettings;
  }
  renderHarnessAgents(agents.error);
  renderHarnessDefaults(config.error);
  renderModelRoles();
}
function close(): void { sequence++; harnessSettings = null; root.style.display = 'none'; }
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
  const models = harnessSettings?.models || [];
  return models.map(m => m.selector || `${m.provider}/${m.id}`);
}

function modelRoleOptions(value: string) {
  const known = harnessSettingsModelSelectors();
  let html = `<option value=""${value ? '' : ' selected'}>(unset)</option>`;
  // A global assignment the catalog doesn't list stays selectable: the harness
  // may resolve refs this catalog can't (aliases, a provider added out of band).
  if (value && !known.includes(value)) {
    html += `<option value="${escapeHtml(value)}" selected>(current) ${escapeHtml(value)}</option>`;
  }
  known.forEach(selector => {
    html += `<option value="${escapeHtml(selector)}"${selector === value ? ' selected' : ''}>${escapeHtml(selector)}</option>`;
  });
  return html;
}

/**
 * Options for a role's thinking-level select: (inherit), then off/auto and
 * the model's supported ladder in OMP's /models roles order. `keepUnknown`
 * retains an off-ladder stored level as a "(current)" option — used on the
 * initial render only; switching the model rebuilds the ladder without it.
 */
function modelRoleLevelOptions(level: string, modelSelector: string, keepUnknown: boolean) {
  const models = harnessSettings?.models || [];
  const entry = models.find(m => (m.selector || `${m.provider}/${m.id}`) === modelSelector);
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
function modelRoleModelChanged(select: HTMLSelectElement) {
  const levelSelect = select.closest('.model-role-row')?.querySelector<HTMLSelectElement>('.model-role-level');
  if (!levelSelect) return;
  levelSelect.innerHTML = modelRoleLevelOptions(levelSelect.value, select.value, false);
}

function renderModelRoles() {
  const body = $('modelRolesBody');
  if (!body) return;
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
      <select class="model-role-select" data-role="${escapeHtml(row.key)}" data-initial="${escapeHtml(model)}">${modelRoleOptions(model)}</select>
      <select class="model-role-level" data-role="${escapeHtml(row.key)}" data-initial="${escapeHtml(level)}"
              title="Thinking level for this role">${modelRoleLevelOptions(level, model, true)}</select>
    </div>`;
  }).join('');
}

/**
 * Agent-model options: inherit (the definition's own `model:`), the harness's
 * role refs, then the concrete catalog. An assignment the catalog doesn't list
 * stays selectable for the same reason the role editor keeps one.
 */
function agentModelOptions(value: string, inherited: string) {
  const known = harnessSettingsModelSelectors();
  const inheritLabel = inherited ? `(inherit ${inherited})` : '(inherit)';
  let html = `<option value=""${value ? '' : ' selected'}>${escapeHtml(inheritLabel)}</option>`;
  if (value && !known.includes(value) && !AGENT_MODEL_ROLE_REFS.includes(value)) {
    html += `<option value="${escapeHtml(value)}" selected>(current) ${escapeHtml(value)}</option>`;
  }
  const group = (label: string, values: readonly string[]) => {
    if (!values.length) return '';
    return `<optgroup label="${escapeHtml(label)}">` + values.map(entry =>
      `<option value="${escapeHtml(entry)}"${entry === value ? ' selected' : ''}>${escapeHtml(entry)}</option>`).join('') + '</optgroup>';
  };
  return html + group('Roles', AGENT_MODEL_ROLE_REFS) + group('Models', known);
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
  if (!body) return;
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
        <label class="hs-agent-field">Model
          <select class="hs-agent-model" data-agent="${escapeHtml(name)}" data-initial="${escapeHtml(model)}">${agentModelOptions(model, agent.model)}</select>
        </label>
        <label class="hs-agent-field">Prewalk
          <select class="hs-agent-prewalk" data-agent="${escapeHtml(name)}" data-initial="${prewalk === true ? 'on' : prewalk === false ? 'off' : ''}">${triStateOptions(prewalk)}</select>
        </label>
        <label class="hs-agent-field">Advisor
          <select class="hs-agent-advisor" data-agent="${escapeHtml(name)}" data-initial="${advisor === true ? 'on' : advisor === false ? 'off' : ''}">${triStateOptions(advisor)}</select>
        </label>
      </div>
    </div>`;
  }).join('');
}

/** Only the rows the user moved, in the PUT shapes the two endpoints take. */
function collectHarnessSettingsPatch() {
  const roles: HarnessSettingsPatch['roles'] = Object.create(null);
  const levelSelects = new Map<string, HTMLSelectElement>();
  for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>('#modelRolesBody .model-role-level'))) {
    if (select.dataset.role) levelSelects.set(select.dataset.role, select);
  }
  for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>('#modelRolesBody .model-role-select'))) {
    if (!select.dataset.role) continue;
    const levelSelect = levelSelects.get(select.dataset.role);
    const level = levelSelect?.value || '';
    if (select.value === select.dataset.initial && level === (levelSelect?.dataset.initial || '')) continue;
    // Inherit stores as the bare model ref; an unset model drops the role.
    roles[select.dataset.role] = select.value ? composeModelRoleRef(select.value, level) : null;
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
  for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>('#harnessAgentsBody .hs-agent-model'))) {
    if (select.value === select.dataset.initial) continue;
    field(select.dataset.agent, 'model', select.value || null);
  }
  for (const [cls, key] of [['hs-agent-prewalk', 'prewalk'], ['hs-agent-advisor', 'advisor']] as const) {
    for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>(`#harnessAgentsBody .${cls}`))) {
      if (select.value === select.dataset.initial) continue;
      field(select.dataset.agent, key, triStateValue(select.value));
    }
  }
  return { roles, agents };
}

async function save(): Promise<void> {
  const view = harnessSettings;
  if (!view || !owns(view) || view.saving) return;
  if (!ownsHost(view)) { hostChanged(); return; }
  const { roles, agents } = collectHarnessSettingsPatch();
  if (!Object.keys(roles).length && !Object.keys(agents).length) { close(); return; }
  const { cwd, harnessId } = view.scope;
  const base = `/api/harnesses/${encodeURIComponent(harnessId)}`;
  view.saving = true;
  harnessSettingsError(''); button.disabled = true; button.textContent = 'Saving…';
  try {
    // Both submitted patches retain this endpoint even if another view opens.
    // A failure stops the sequence; successful earlier writes stay committed.
    if (Object.keys(agents).length) await request(view.host, `${base}/agents`, { agents, cwd: cwd || undefined });
    if (Object.keys(roles).length) await request(view.host, `${base}/model-roles`, { roles, cwd: cwd || undefined });
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
  if (target instanceof HTMLSelectElement && target.matches('.model-role-select')) modelRoleModelChanged(target);
  if (target instanceof HTMLInputElement && target.matches('.hs-agent-enabled')) target.closest('.hs-agent-row')?.classList.toggle('disabled', !target.checked);
}, { signal: listeners.signal });
return { open, close, save, showTab, isOpen, dispose() { close(); listeners.abort(); } };
}
