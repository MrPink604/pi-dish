import type { ApiRequest, HostEndpoint } from './api-client';
import { record } from './helper-values';
import { escapeHtml } from './helper-format';
export interface Theme { readonly id: string; readonly builtin: boolean; readonly tokens: Readonly<Record<string, string>> }
export function decodeThemeTokens(value: unknown): Record<string, string> {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => /^--[a-z][a-z0-9-]*$/.test(entry[0]) && typeof entry[1] === 'string'));
}
export function decodeThemes(value: unknown): Theme[] {
  if (!record(value) || !Array.isArray(value.themes)) return [];
  return value.themes.flatMap((row: unknown) => record(row) && typeof row.id === 'string' && row.id
    ? [{ id: row.id, builtin: row.builtin === true, tokens: decodeThemeTokens(row.tokens) }] : []);
}
export function applyCachedTheme(document: Document, storage: Pick<Storage, 'getItem'>): void {
  try {
    const id = storage.getItem('pi-dish-theme');
    if (id && id !== 'solarized') document.documentElement.dataset.theme = id;
    const tokens: unknown = JSON.parse(storage.getItem('pi-dish-theme-tokens') || 'null');
    for (const [key, value] of Object.entries(decodeThemeTokens(tokens))) document.documentElement.style.setProperty(key, value);
  } catch { /* Malformed or unavailable device storage keeps the default palette. */ }
}
export function terminalTheme(document: Document) {
  const css = document.defaultView!.getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { background: v('--bg-darker'), foreground: v('--text'), cursor: v('--text-bright'), cursorAccent: v('--bg-darker'), selectionBackground: v('--bg-card'),
    black: v('--bg-card'), red: v('--error'), green: v('--success'), yellow: v('--warning'), blue: v('--accent'), magenta: '#d33682', cyan: v('--cyan'), white: '#eee8d5',
    brightBlack: v('--text-muted'), brightRed: v('--orange'), brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' };
}
export function createThemes(options: {
  document: Document; storage: Pick<Storage, 'getItem' | 'setItem'>; request: ApiRequest;
  host: () => HostEndpoint; changed: () => void;
}) {
  const { document, storage } = options;
  let disposed = false, sequence = 0;
  let available: readonly Theme[] = [{ id: 'solarized', builtin: true, tokens: {} }, { id: 'graphite', builtin: true, tokens: {} }];
  function render(select = document.querySelector<HTMLSelectElement>('#settingsTheme')): void {
    if (disposed || !select) return;
    const current = storage.getItem('pi-dish-theme') || 'solarized';
    select.innerHTML = available.map(theme => `<option value="${escapeHtml(theme.id)}"${theme.id === current ? ' selected' : ''}>${escapeHtml(theme.id)}</option>`).join('');
  }
  function apply(id: string): void {
    if (disposed) return;
    const theme = available.find(theme => theme.id === id) || available[0];
    const root = document.documentElement;
    for (const prop of [...root.style]) if (prop.startsWith('--')) root.style.removeProperty(prop);
    if (theme.id === 'solarized') delete root.dataset.theme; else root.dataset.theme = theme.id;
    for (const [key, value] of Object.entries(theme.tokens)) root.style.setProperty(key, value);
    storage.setItem('pi-dish-theme', theme.id); storage.setItem('pi-dish-theme-tokens', JSON.stringify(Object.keys(theme.tokens).length ? theme.tokens : null));
    render(); options.changed();
  }
  async function load(): Promise<void> {
    if (disposed) return;
    const own = ++sequence, endpoint = Object.freeze({ ...options.host() });
    const current = () => !disposed && own === sequence && endpoint.base === options.host().base && (endpoint.token || '') === (options.host().token || '');
    try {
      const response = await options.request(endpoint, '/api/themes');
      if (response.ok) { const data: unknown = await response.json(); if (!current()) return; const decoded = decodeThemes(data); if (decoded.length) available = decoded; }
    } catch { /* Cached built-ins remain usable while the server is unavailable. */ }
    if (!current()) return;
    render(); const saved = storage.getItem('pi-dish-theme'); if (saved && saved !== 'solarized') apply(saved);
  }
  return { render, apply, load, dispose() { disposed = true; sequence++; } };
}
