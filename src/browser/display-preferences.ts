import type { ApiRequest, HostEndpoint } from './api-client';
import { record, finite } from './helper-values';
import { escapeHtml } from './helper-format';
import { hostSettingsHtml } from './host-settings';
export interface SavedFilter { readonly name: string; readonly query: string }
export function decodeSavedFilters(value: unknown): SavedFilter[] {
  return Array.isArray(value) ? value.flatMap((row: unknown) => record(row) && typeof row.name === 'string' && typeof row.query === 'string' ? [{ name: row.name, query: row.query }] : []) : [];
}
export type ResponseMode = 'hidden' | 'compact' | 'performance' | 'performance-cost';
export function responseMode(value: unknown): ResponseMode {
  return value === 'hidden' || value === 'performance' || value === 'performance-cost' ? value : 'compact';
}
const RESPONSE_MODE_KEY = 'pi-dish-response-metadata', CONTEXT_METRIC_KEY = 'pi-dish-sidebar-context-metric';
export function createDisplayPreferences(options: {
  document: Document; storage: Pick<Storage, 'getItem' | 'setItem'>; request: ApiRequest; host: () => HostEndpoint;
  beforeOpen: () => void; mountSections: (body: HTMLElement) => void; unmountSections: () => void;
  themes: { render: (select: HTMLSelectElement) => void; apply: (id: string) => void };
  filters: () => readonly SavedFilter[]; setFilters: (filters: readonly SavedFilter[]) => void;
  persistFilters: (filters: readonly SavedFilter[], host: Readonly<HostEndpoint>) => Promise<unknown>;
  metadataChanged: () => void; contextChanged: () => void; alert: (message: string) => void;
}) {
  const { document, storage } = options;
  const modal = document.getElementById('settingsModal')!, body = document.getElementById('settingsBody')!;
  let disposed = false, sequence = 0;
  let events = new AbortController(), filterEvents = new AbortController();
  let mode = responseMode(storage.getItem(RESPONSE_MODE_KEY));
  let context: 'tokens' | 'percent' = storage.getItem(CONTEXT_METRIC_KEY) === 'tokens' ? 'tokens' : 'percent';
  function isOpen() { return !disposed && modal.style.display === 'flex'; }
  function retire() { sequence++; events.abort(); filterEvents.abort(); options.unmountSections(); }
  function close() { if (disposed) return; retire(); modal.style.display = 'none'; }
  function open() {
    if (disposed) return; options.beforeOpen(); modal.style.display = 'flex'; void render();
    const scroll = modal.querySelector('.settings-body'); if (scroll) scroll.scrollTop = 0;
  }
  async function render(): Promise<void> {
    if (!isOpen()) return;
    retire(); events = new AbortController();
    const seq = sequence, endpoint = Object.freeze({ ...options.host() });
    const owns = () => seq === sequence && isOpen() && endpoint.base === options.host().base && (endpoint.token || '') === (options.host().token || '');
    const listener = { signal: events.signal };
  body.innerHTML = `<div class="preference-row"><label for="settingsTheme"><strong>Theme</strong><small>Stored on this device. Built-ins plus any token files in <code>~/.pi/dish/themes/</code>.</small></label>
    <select id="settingsTheme"></select></div>
    <div class="preference-row"><label for="sidebarContextMetric"><strong>Session list context readout</strong><small>Stored on this device. Which number each sidebar row shows for context use.</small></label>
    <select id="sidebarContextMetric"><option value="percent">Percent of context</option><option value="tokens">Token count</option></select></div>
    <div class="preference-row"><label for="responseMetadataMode"><strong>Response metadata</strong><small>Stored on this device. “Effective speed” includes time to first token and JSONL append.</small></label>
    <select id="responseMetadataMode"><option value="hidden">Hidden</option><option value="compact">Compact</option><option value="performance">Performance</option><option value="performance-cost">Performance + estimated cost</option></select></div>
    <div class="preference-row"><label for="monthlyBudget"><strong>Monthly budget warning (USD)</strong><small>Server-global: applies to every device. Estimates use each session harness's catalog pricing; blank clears.</small></label><div class="budget-save"><input id="monthlyBudget" type="number" min="0.01" step="0.01" placeholder="No warning"><button class="btn-small" id="saveBudget">Save</button></div><small id="budgetStatus"></small></div>
    <div id="recoveryPreferences" class="preference-row recovery-preferences" hidden></div>
    ${hostSettingsHtml}
    <div class="preference-row"><label><strong>Saved sidebar filters</strong><small>Server-global. Chips under the sidebar filter toggle these per device; type a query there and hit “+ save filter” to add one.</small></label><div id="savedFiltersList" class="saved-filters-list"></div></div>`;

    const modeSelect = body.querySelector<HTMLSelectElement>('#responseMetadataMode')!; modeSelect.value = mode;
    modeSelect.addEventListener('change', () => {
      if (!owns()) return; mode = responseMode(modeSelect.value); storage.setItem(RESPONSE_MODE_KEY, mode); options.metadataChanged();
    }, listener);
    const theme = body.querySelector<HTMLSelectElement>('#settingsTheme')!; options.themes.render(theme);
    theme.addEventListener('change', () => { if (owns()) options.themes.apply(theme.value); }, listener);
    const metric = body.querySelector<HTMLSelectElement>('#sidebarContextMetric')!; metric.value = context;
    metric.addEventListener('change', () => {
      if (!owns()) return; context = metric.value === 'tokens' ? 'tokens' : 'percent'; storage.setItem(CONTEXT_METRIC_KEY, context); options.contextChanged();
    }, listener);
    function renderFilters(): void {
      if (!owns()) return; filterEvents.abort(); filterEvents = new AbortController();
      const list = body.querySelector<HTMLElement>('#savedFiltersList')!;
      const filters = options.filters();
      list.innerHTML = filters.length ? filters.map(filter => `<div class="saved-filter-row"><span class="saved-filter-name">${escapeHtml(filter.name)}</span><code class="saved-filter-query">${escapeHtml(filter.query)}</code><button class="btn-icon saved-filter-del" data-name="${escapeHtml(filter.name)}" title="Delete filter">✕</button></div>`).join('') : '<small class="saved-filters-empty">No saved filters yet.</small>';
      for (const button of list.querySelectorAll<HTMLButtonElement>('.saved-filter-del')) {
        const name = button.dataset.name;
        button.addEventListener('click', async () => {
          if (!owns() || button.disabled) return; button.disabled = true;
          try { await options.persistFilters(options.filters().filter(filter => filter.name !== name), endpoint); if (owns()) renderFilters(); }
          catch (error) { if (owns()) { button.disabled = false; options.alert('Could not delete filter: ' + message(error)); } }
        }, { signal: filterEvents.signal });
      }
    }
    renderFilters(); options.mountSections(body);
    const input = body.querySelector<HTMLInputElement>('#monthlyBudget')!, status = body.querySelector<HTMLElement>('#budgetStatus')!, save = body.querySelector<HTMLButtonElement>('#saveBudget')!;
    save.disabled = true;
    try {
      const response = await options.request(endpoint, '/api/settings'); const data: unknown = await response.json();
      if (!owns()) return;
      if (!response.ok || !record(data)) throw new Error('Could not load server setting.');
      input.value = finite(data.monthlyBudgetUsd) ? String(data.monthlyBudgetUsd) : '';
      if (Array.isArray(data.savedFilters)) { options.setFilters(decodeSavedFilters(data.savedFilters)); renderFilters(); }
    } catch { if (owns()) status.textContent = 'Could not load server setting.'; }
    if (!owns()) return; save.disabled = false;
    save.addEventListener('click', async () => {
      if (!owns() || save.disabled) return;
      save.disabled = true;
      const value = input.value.trim() === '' ? null : Number(input.value);
      try {
        const response = await options.request(endpoint, '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monthlyBudgetUsd: value }) });
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' ? data.error : 'Save failed');
        if (owns()) status.textContent = 'Saved for all devices.';
      } catch (error) { if (owns()) status.textContent = 'Save failed: ' + message(error); }
      finally { if (owns()) save.disabled = false; }
    }, listener);
  }
  return { open, close, render, get responseMode() { return mode; }, get contextMetric() { return context; }, dispose() { close(); disposed = true; } };
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
