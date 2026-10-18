import type { HarnessSetting, HarnessSettingsList } from './harness-settings-data';

/**
 * The harness's own settings panel (OMP's /settings): one section per tab,
 * rows grouped by key prefix in the CLI's order. Every control carries its
 * serialized initial value, so a save sends only the rows the user moved.
 */
const SECRET_KEY = /(api.?key|token|password|secret)$/i;

function humanize(segment: string): string {
  const words = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
function groupOf(key: string): string {
  const dot = key.indexOf('.');
  return dot > 0 ? key.slice(0, dot) : '';
}
function labelOf(key: string): string {
  const rest = groupOf(key) ? key.slice(key.indexOf('.') + 1) : key;
  return rest.split('.').map(humanize).join(' › ');
}
function serialize(setting: HarnessSetting): string {
  const { type, value } = setting;
  if (value === undefined || value === null) return '';
  if (type === 'array' || type === 'record') return JSON.stringify(value, null, 2);
  return typeof value === 'string' ? value : JSON.stringify(value);
}
function shown(value: unknown): string {
  return value === undefined || value === null ? '(not set)' : typeof value === 'string' ? value : JSON.stringify(value);
}

function control(setting: HarnessSetting, escapeHtml: (text: string) => string): string {
  const key = escapeHtml(setting.key);
  const initial = escapeHtml(serialize(setting));
  const attrs = `class="hs-setting-input" data-key="${key}" data-type="${escapeHtml(setting.type)}" data-initial="${initial}" aria-label="${key}"`;
  switch (setting.type) {
    case 'boolean':
      return `<input type="checkbox" ${attrs}${setting.value === true ? ' checked' : ''}>`;
    case 'enum': {
      const current = serialize(setting);
      const values = setting.values || [];
      const extra = values.includes(current) ? '' : `<option value="${initial}" selected>${current ? `(current) ${initial}` : '(not set)'}</option>`;
      return `<select ${attrs}>${extra}${values.map(value =>
        `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select>`;
    }
    case 'number':
      return `<input type="number" step="any" ${attrs} value="${initial}" placeholder="(default)">`;
    case 'array':
    case 'record': {
      const lines = Math.min(8, Math.max(2, serialize(setting).split('\n').length));
      return `<textarea ${attrs} rows="${lines}" spellcheck="false" placeholder="(default) JSON ${setting.type === 'array' ? '[ … ]' : '{ … }'}">${initial}</textarea>`;
    }
    default: {
      if (setting.redacted) {
        return `<input type="password" ${attrs} value="" placeholder="Set — type to replace" autocomplete="new-password">
          <label class="hs-setting-clear"><input type="checkbox" class="hs-setting-clear-box" data-key="${key}"> Clear</label>`;
      }
      const secret = SECRET_KEY.test(setting.key);
      return `<input type="${secret ? 'password' : 'text'}" ${attrs} value="${initial}" placeholder="(default)" spellcheck="false"${secret ? ' autocomplete="new-password"' : ''}>`;
    }
  }
}

export function renderHarnessSettingsPane(list: HarnessSettingsList, escapeHtml: (text: string) => string): string {
  return list.tabs.map(tab => {
    let group: string | null = null;
    const rows = list.settings.filter(setting => setting.tab === tab.id).map(setting => {
      const next = groupOf(setting.key);
      const heading = next !== group ? `<div class="hs-setting-group">${escapeHtml(next ? humanize(next) : 'General')}</div>` : '';
      group = next;
      const label = labelOf(setting.key);
      const override = setting.override
        ? `<small class="model-role-override">project override: ${escapeHtml(shown(setting.override.value))} (.omp/config.yml wins here)</small>` : '';
      const search = `${setting.key} ${label} ${setting.description}`.toLowerCase();
      return `${heading}<div class="hs-setting-row hs-setting-${escapeHtml(setting.type)}" data-key="${escapeHtml(setting.key)}" data-search="${escapeHtml(search)}">
        <div class="hs-setting-label">
          <strong>${escapeHtml(label)}</strong>
          <code class="model-role-key">${escapeHtml(setting.key)}</code>
          ${setting.description ? `<small>${escapeHtml(setting.description)}</small>` : ''}
          ${override}
        </div>
        <div class="hs-setting-control">${control(setting, escapeHtml)}</div>
      </div>`;
    }).join('');
    return `<section class="hs-settings-tab" data-tab="${escapeHtml(tab.id)}"><h4 class="hs-settings-tab-title">${escapeHtml(tab.label)}</h4>${rows}</section>`;
  }).join('');
}

/** Show one tab, or every tab's rows matching a non-empty query. */
export function filterHarnessSettings(pane: HTMLElement, tab: string, query: string): void {
  const q = query.trim().toLowerCase();
  pane.classList.toggle('searching', !!q);
  for (const section of Array.from(pane.querySelectorAll<HTMLElement>('.hs-settings-tab'))) {
    let visible = 0;
    let heading: HTMLElement | null = null, headingRows = 0;
    const closeHeading = () => { if (heading) heading.hidden = headingRows === 0; };
    for (const node of Array.from(section.children)) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.classList.contains('hs-setting-group')) { closeHeading(); heading = node; headingRows = 0; continue; }
      if (!node.classList.contains('hs-setting-row')) continue;
      const match = !q || (node.dataset.search || '').includes(q);
      node.hidden = !match;
      if (match) { visible++; headingRows++; }
    }
    closeHeading();
    section.hidden = q ? visible === 0 : section.dataset.tab !== tab;
  }
}

/**
 * Moved rows as the PUT body's values: null resets a key to the harness
 * default (an emptied text, number or JSON field, or a cleared credential).
 */
export function collectHarnessSettingsValues(pane: HTMLElement): { settings: Record<string, unknown>; error?: undefined } | { error: string } {
  const settings: Record<string, unknown> = Object.create(null);
  for (const box of Array.from(pane.querySelectorAll<HTMLInputElement>('.hs-setting-clear-box'))) {
    if (box.checked && box.dataset.key) settings[box.dataset.key] = null;
  }
  for (const node of Array.from(pane.querySelectorAll<HTMLElement>('.hs-setting-input'))) {
    const key = node.dataset.key, type = node.dataset.type, initial = node.dataset.initial || '';
    if (!key || key in settings) continue;
    if (node instanceof HTMLInputElement && node.type === 'checkbox') {
      if (node.checked !== (initial === 'true')) settings[key] = node.checked;
      continue;
    }
    if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement)) continue;
    if (node instanceof HTMLInputElement && node.validity.badInput) return { error: `${key}: expected a number` };
    const raw = node.value;
    if (raw === initial) continue;
    if (type === 'array' || type === 'record') {
      if (!raw.trim()) { settings[key] = null; continue; }
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return { error: `${key}: not valid JSON` }; }
      if (type === 'array' ? !Array.isArray(parsed) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: `${key}: expected a JSON ${type === 'array' ? 'array' : 'object'}` };
      }
      settings[key] = parsed;
    } else if (type === 'number') {
      if (!raw.trim()) { settings[key] = null; continue; }
      const value = Number(raw);
      if (!Number.isFinite(value)) return { error: `${key}: expected a number` };
      settings[key] = value;
    } else if (type === 'enum') {
      settings[key] = raw;
    } else {
      settings[key] = raw ? raw : null;
    }
  }
  return { settings };
}
