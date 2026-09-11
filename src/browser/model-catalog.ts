import type { CatalogModel } from '../core/session-api';
import { decodeModelCatalog } from '../core/session-api';
import type { DirectoryHost } from './directory-catalog';

export interface ModelCatalogScope {
  readonly host: Readonly<DirectoryHost>;
  readonly harnessId: string;
  readonly sessionId?: string;
  readonly cwd?: string;
}
export function modelsCacheKey(harnessId: string, hostId: string | null, selfId: string | null): string {
  const base = harnessId === 'pi' ? 'pi-dish-models-cache' : `pi-dish-models-cache:${harnessId}`;
  return hostId && hostId !== selfId ? `${base}@${hostId}` : base;
}

/** One shared catalog, with explicit request/view owners and model-edit writers. */
export function createModelCatalog(options: {
  read: (scope: ModelCatalogScope) => Promise<unknown>;
  persist: (scope: ModelCatalogScope, models: readonly Readonly<CatalogModel>[]) => void;
  changed: () => void;
  failed: (error: unknown) => void;
}) {
  let sequence = 0;
  let models: CatalogModel[] = [];
  let scope: ModelCatalogScope | null = null;
  let currentOwner: (() => boolean) | null = null;
  const current = () => !currentOwner || currentOwner();
  function rows(): readonly Readonly<CatalogModel>[] { return current() ? models : []; }
  function retire(): void { sequence++; }
  function clear(): void { retire(); models = []; scope = null; currentOwner = null; }
  function snapshot(target: ModelCatalogScope): ModelCatalogScope {
    return Object.freeze({ ...target, host: Object.freeze({ ...target.host }) });
  }
  function seed(target: ModelCatalogScope, data: unknown, owns: () => boolean): void {
    clear();
    if (!owns()) return;
    const decoded = decodeModelCatalog(data);
    scope = snapshot(target);
    models = decoded;
    currentOwner = owns;
  }
  async function load(target: ModelCatalogScope, ownsRequest: () => boolean, ownsRows = ownsRequest): Promise<void> {
    const requestSequence = ++sequence;
    const owner = snapshot(target);
    const valid = () => requestSequence === sequence && ownsRequest();
    try {
      const data = await options.read(owner);
      if (!valid()) return;
      models = decodeModelCatalog(data);
      scope = owner;
      currentOwner = ownsRows;
      if (models.length) {
        try { options.persist(owner, models); } catch {} // Runtime catalog survives storage quota failures.
      }
      options.changed();
    } catch (error) {
      if (!valid()) return;
      models = [];
      scope = null;
      currentOwner = null;
      options.failed(error);
    }
  }
  function filter(query: string): readonly Readonly<CatalogModel>[] {
    const q = query.toLowerCase();
    return rows().filter(model => !q || [model.id, model.provider, model.name].some(value => value.toLowerCase().includes(q)));
  }
  function replaceEnabled(matches: (model: CatalogModel) => boolean, enabled: (model: CatalogModel) => boolean): void {
    if (!current()) return;
    // New rows also keep retained persistence snapshots stable after UI edits.
    models = models.map(model => matches(model) ? { ...model, enabled: enabled(model) } : model);
  }
  function toggle(selector: string): void { replaceEnabled(model => `${model.provider}/${model.id}` === selector, model => model.enabled === false); }
  function setAll(enabled: boolean): void { replaceEnabled(() => true, () => enabled); }
  function toggleProvider(provider: string, query: string): void {
    const listed = new Set(filter(query).filter(model => model.provider === provider));
    if (!listed.size) return;
    const enabled = ![...listed].every(model => model.enabled !== false);
    replaceEnabled(model => listed.has(model), () => enabled);
  }
  function enabledIds(): string[] | null | undefined {
    if (!current()) return undefined;
    const list = rows(), enabled = list.filter(model => model.enabled !== false);
    return enabled.length === list.length ? null : enabled.map(model => `${model.provider}/${model.id}`);
  }
  return { rows, get scope() { return current() ? scope : null; }, load, seed, retire, clear, filter, toggle, setAll, toggleProvider, enabledIds };
}

export function modelSelectOptionsHtml(models: readonly Readonly<CatalogModel>[], escapeHtml: (value: string) => string) {
  const enabled = models.filter(model => model.enabled !== false);
  const byProvider = new Map<string, Readonly<CatalogModel>[]>();
  for (const model of enabled) {
    const group = byProvider.get(model.provider) || [];
    group.push(model);
    byProvider.set(model.provider, group);
  }
  let html = '<option value="">(default)</option>';
  for (const provider of [...byProvider.keys()].sort()) {
    html += `<optgroup label="${escapeHtml(provider)}">`;
    for (const model of byProvider.get(provider) || []) {
      html += `<option value="${escapeHtml(model.selector || `${model.provider}/${model.id}`)}">${escapeHtml(model.name || model.id)}</option>`;
    }
    html += '</optgroup>';
  }
  return { html, enabled, hidden: models.length - enabled.length };
}
export function modelHiddenNote(hidden: number): string {
  return hidden > 0 ? `${hidden} model${hidden === 1 ? '' : 's'} hidden (not enabled)` : '';
}
