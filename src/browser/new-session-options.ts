import type { CatalogModel } from '../core/session-api';
import type { ApiRequest } from './api-client';
import { sameDirectoryHost } from './directory-catalog';
import type { DirectoryHost } from './directory-catalog';
import { modelHiddenNote, modelSelectOptionsHtml } from './model-catalog';

export const NS_THINKING_LABELS: Readonly<Record<string, string>> = Object.freeze({
  off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium',
  high: 'High', xhigh: 'Extra high', max: 'Maximum',
});
const thinkingLabel = (level: string) => Object.hasOwn(NS_THINKING_LABELS, level) ? NS_THINKING_LABELS[level] : level;

/** Per-harness launch preferences and their rendered model/thinking choices. */
export function createNewSessionPreferences(options: {
  model: HTMLSelectElement;
  thinking: HTMLSelectElement;
  hiddenNote: HTMLElement | null;
  thinkingNote: HTMLElement | null;
  rows: () => readonly Readonly<CatalogModel>[];
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  escapeHtml: (text: string) => string;
}) {
  let harness = 'pi', model = '', thinking = '';
  function preference(kind: string): string {
    return options.read(`pi-dish-new-${kind}:${harness}`)
      || (harness === 'pi' ? options.read(`pi-dish-new-${kind}`) : '') || '';
  }
  function persist(kind: string, value: string): void {
    options.write(`pi-dish-new-${kind}:${harness}`, value);
    if (harness === 'pi') options.write(`pi-dish-new-${kind}`, value);
  }
  function restore(harnessId: string): void {
    harness = harnessId;
    model = preference('model');
    thinking = preference('thinking');
  }
  function syncThinking(): void {
    const selected = options.rows().find(row => (row.selector || `${row.provider}/${row.id}`) === options.model.value);
    let levels: readonly string[] = Object.keys(NS_THINKING_LABELS);
    let disabled = selected?.reasoning === false;
    let note = disabled ? 'The selected model does not support configurable thinking' : '';
    if (harness === 'omp') {
      levels = selected?.thinking || [];
      disabled = !selected || levels.length === 0;
      if (!selected) note = 'Select a model to choose an explicit thinking level';
      else if (!levels.length) note = 'This model has no configurable thinking levels';
      else note = `Valid for this model: ${levels.map(thinkingLabel).join(', ')}`;
    }
    options.thinking.innerHTML = '<option value="">(default)</option>' + levels.map(level =>
      `<option value="${options.escapeHtml(level)}">${options.escapeHtml(thinkingLabel(level))}</option>`).join('');
    if (!levels.includes(thinking)) { thinking = ''; persist('thinking', ''); }
    options.thinking.disabled = disabled;
    options.thinking.value = disabled ? '' : thinking;
    if (options.thinkingNote) options.thinkingNote.textContent = note;
  }
  function render(): void {
    const { html, enabled, hidden } = modelSelectOptionsHtml(options.rows(), options.escapeHtml);
    options.model.innerHTML = html;
    // Preserve a saved model through interim catalogs. Submission reads the
    // select itself, so an unavailable model is never sent to the harness.
    options.model.value = model && enabled.some(row => (row.selector || `${row.provider}/${row.id}`) === model) ? model : '';
    if (options.hiddenNote) options.hiddenNote.textContent = modelHiddenNote(hidden);
    syncThinking();
  }
  return { restore, render, syncThinking,
    selectModel(value: string) { model = value || ''; persist('model', model); syncThinking(); },
    selectThinking(value: string) { thinking = value || ''; persist('thinking', thinking); },
  };
}

export interface HarnessConfigPreview {
  readonly cwd: string;
  readonly defaultModel: string;
  readonly defaultThinkingLevel: string;
  readonly modelRoles: Readonly<Record<string, string>>;
}
export interface NewSessionConfigScope {
  readonly host: Readonly<DirectoryHost>;
  readonly harnessId: string;
  readonly cwd: string;
  readonly view: number;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function decodeHarnessConfigPreview(value: unknown, cwd: string): HarnessConfigPreview {
  if (!record(value)) throw new Error('Invalid harness defaults');
  const roles = record(value.modelRoles) ? Object.fromEntries(Object.entries(value.modelRoles)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
  return { cwd, defaultModel: typeof value.defaultModel === 'string' ? value.defaultModel : '',
    defaultThinkingLevel: typeof value.defaultThinkingLevel === 'string' ? value.defaultThinkingLevel : '',
    modelRoles: roles };
}
/** Defaults and edit actions retain the takeover, endpoint, harness and cwd. */
export function createNewSessionConfigPreview(options: {
  wrap: HTMLElement;
  values: HTMLElement;
  roles: HTMLElement | null;
  buttons: readonly HTMLElement[];
  scope: () => NewSessionConfigScope | null;
  request: ApiRequest;
  roleSummary: (roles: Readonly<Record<string, string>>) => string;
}) {
  let sequence = 0;
  let config: HarnessConfigPreview | null = null;
  let owner: NewSessionConfigScope | null = null;
  function current(target: NewSessionConfigScope | null): boolean {
    const now = options.scope();
    return !!target && !!now && target.view === now.view && target.cwd === now.cwd
      && target.harnessId === now.harnessId && sameDirectoryHost(target.host, now.host);
  }
  function retire(): void {
    sequence++;
    config = null;
    owner = null;
    // Keep the readout geometry stable until the next actual load. A cwd
    // blur can happen between pointer-down and pointer-up on the spawn button.
  }
  async function load(cwd?: string): Promise<void> {
    retire();
    const now = options.scope();
    if (!now || now.harnessId !== 'omp') { options.wrap.style.display = 'none'; return; }
    const target = Object.freeze({ ...now, cwd: cwd ?? now.cwd, host: Object.freeze({ ...now.host }) });
    const version = sequence;
    const owns = () => version === sequence && current(target);
    options.wrap.style.display = '';
    options.values.textContent = 'Loading…';
    for (const button of options.buttons) button.style.display = 'none';
    if (options.roles) options.roles.textContent = '';
    try {
      const params = target.cwd ? `?cwd=${encodeURIComponent(target.cwd)}` : '';
      const response = await options.request(target.host, '/api/harnesses/omp/config' + params);
      if (!owns()) return;
      const data: unknown = await response.json();
      if (!owns()) return;
      if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' && data.error ? data.error : `HTTP ${response.status}`);
      config = decodeHarnessConfigPreview(data, target.cwd);
      owner = target;
      options.values.textContent = `Model: ${config.defaultModel || 'auto-select'} · Thinking: ${config.defaultThinkingLevel || 'host default'}`;
      if (options.roles) options.roles.textContent = 'Roles: ' + options.roleSummary(config.modelRoles);
      for (const button of options.buttons) button.style.display = '';
    } catch (error) {
      if (!owns()) return;
      config = null;
      owner = null;
      options.values.textContent = `Defaults unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return { load, retire, get config() { return current(owner) ? config : null; } };
}
