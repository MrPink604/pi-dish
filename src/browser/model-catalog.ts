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

/** Session-owned model inventory exposed to composer suggestions. */
export interface ModelCatalogView {
  readonly scope: ModelCatalogScope | null;
  rows(): readonly Readonly<CatalogModel>[];
}
/** How long a recently read catalog may serve a menu without re-reading it. */
const CATALOG_REUSE_MS = 60_000;

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
  let loadedAt: number | null = null;
  const current = () => !currentOwner || currentOwner();
  function rows(): readonly Readonly<CatalogModel>[] { return current() ? models : []; }
  function retire(): void { sequence++; loadedAt = null; }
  function clear(): void { retire(); models = []; scope = null; currentOwner = null; }
  function snapshot(target: ModelCatalogScope): ModelCatalogScope {
    return Object.freeze({ ...target, host: Object.freeze({ ...target.host }) });
  }
  // A menu that already shows these rows may reopen from them instead of
  // paying another round trip, for as long as a re-read would have been
  // reused server-side. Seeded (cache-restored) rows are not a server read and
  // never qualify.
  function reusable(target: { sessionId?: string; harnessId: string; base: string }): boolean {
    const active = current() ? scope : null;
    return !!active && loadedAt !== null && Date.now() - loadedAt < CATALOG_REUSE_MS
      && active.sessionId === target.sessionId && active.harnessId === target.harnessId
      && active.host.base === target.base;
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
      loadedAt = Date.now();
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
  return { rows, get scope() { return current() ? scope : null; }, reusable, load, seed, retire, clear, filter, toggle, setAll, toggleProvider, enabledIds };
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

export function catalogModelSelector(model: Readonly<CatalogModel>): string {
  return model.selector || `${model.provider}/${model.id}`;
}
function catalogModelLabel(model: Readonly<CatalogModel>): string {
  return model.name || model.id;
}

export interface ModelPicker {
  sync(): void;
  hide(): void;
  dispose(): void;
}

/** Type-to-filter model combobox; mirrors the spawn-target picker. */
export function createModelPicker(options: {
  input: HTMLInputElement;
  dropdown: HTMLElement;
  rows: () => readonly Readonly<CatalogModel>[];
  selected: () => string;
  onPick: (selector: string) => void;
  match: (query: string, text: string) => readonly number[] | null;
  score: (indices: readonly number[], text: string) => number;
  highlight: (text: string, indices: readonly number[]) => string;
  escapeHtml: (text: string) => string;
}) {
  const { input, dropdown } = options;
  const listeners = new AbortController();
  let rowListeners = new AbortController();
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  let activeIndex = -1;
  let open = false;
  function currentLabel(): string {
    const selected = options.selected();
    const row = options.rows().find(model => model.enabled !== false && catalogModelSelector(model) === selected);
    return row ? catalogModelLabel(row) : '';
  }
  function clearBlur(): void {
    if (blurTimer !== null) clearTimeout(blurTimer);
    blurTimer = null;
  }
  function hide(): void {
    rowListeners.abort();
    open = false;
    dropdown.style.display = 'none';
    activeIndex = -1;
    clearBlur();
  }
  function sync(): void {
    if (open) { render(input.value); return; }
    input.value = currentLabel();
  }
  function pick(selector: string): void {
    options.onPick(selector);
    hide();
    input.value = currentLabel();
  }
  function render(query: string): void {
    rowListeners.abort();
    open = true;
    activeIndex = -1;
    const q = query.trim();
    let named = options.rows().filter(model => model.enabled !== false).flatMap(model => {
      const label = catalogModelLabel(model), ref = catalogModelSelector(model);
      if (!q) return [{ model, label, ref, indices: [] as readonly number[], score: 0 }];
      const indices = options.match(q, label) || options.match(q, ref);
      return indices ? [{ model, label, ref, indices, score: options.score(indices, label) }] : [];
    });
    if (q) named = named.sort((a, b) => b.score - a.score);
    const rows = [{ key: '', html: '(default)' }].concat(named.map(({ label, ref, indices }) => {
      const matchedLabel = indices.length && options.match(q, label) ? options.highlight(label, indices) : options.escapeHtml(label);
      const suffix = ref === label ? '' : ` <span class="model-picker-ref">${options.escapeHtml(ref)}</span>`;
      return { key: ref, html: matchedLabel + suffix };
    }));
    dropdown.innerHTML = rows.map(row =>
      `<div class="cwd-option" data-key="${options.escapeHtml(row.key)}">${row.html}</div>`).join('');
    dropdown.style.display = 'block';
    rowListeners = new AbortController();
    for (const row of Array.from(dropdown.querySelectorAll<HTMLElement>('.cwd-option'))) {
      row.addEventListener('mousedown', event => {
        event.preventDefault();
        if (dropdown.contains(row)) pick(row.dataset.key || '');
      }, { signal: rowListeners.signal });
    }
  }
  const listener = { signal: listeners.signal };
  input.addEventListener('focus', () => { clearBlur(); input.select(); render(''); }, listener);
  input.addEventListener('click', () => { if (!open) { clearBlur(); render(''); } }, listener);
  input.addEventListener('input', () => render(input.value), listener);
  input.addEventListener('blur', () => {
    clearBlur();
    blurTimer = setTimeout(() => { hide(); input.value = currentLabel(); }, 150);
  }, listener);
  input.addEventListener('keydown', event => {
    if (!open) return;
    const rows = Array.from(dropdown.querySelectorAll<HTMLElement>('.cwd-option'));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      activeIndex = Math.max(0, Math.min(activeIndex + (event.key === 'ArrowDown' ? 1 : -1), rows.length - 1));
      rows.forEach((row, index) => row.classList.toggle('active', index === activeIndex));
      rows[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[activeIndex];
      if (row) pick(row.dataset.key || '');
      else { hide(); input.value = currentLabel(); }
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      hide();
      input.value = currentLabel();
    }
  }, listener);
  const picker: ModelPicker = { sync, hide, dispose() { hide(); listeners.abort(); } };
  return picker;
}
