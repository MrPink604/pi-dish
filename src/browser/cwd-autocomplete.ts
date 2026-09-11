import type { ApiRequest } from './api-client';
import { decodeKnownDirectories, sameDirectoryHost } from './directory-catalog';
import type { DirectoryHost, KnownDirectory } from './directory-catalog';

export interface CwdAutocompleteOptions {
  input: HTMLInputElement;
  dropdown: HTMLElement;
  host: () => Readonly<DirectoryHost> | null;
  request: ApiRequest;
  known: () => readonly KnownDirectory[];
  match: (query: string, text: string) => readonly number[] | null;
  score: (indices: readonly number[], text: string) => number;
  highlight: (text: string, indices: readonly number[]) => string;
  escapeHtml: (text: string) => string;
  onPick?: (path: string) => void;
  onSubmit?: (() => void) | null;
  onBlur?: (() => void) | null;
}
interface Result extends KnownDirectory { known: boolean; indices: readonly number[]; score: number }

/** A shared combobox owns its listeners, debounce, host/query and rendered choices. */
export function createCwdAutocomplete(options: CwdAutocompleteOptions) {
  const { input, dropdown } = options;
  const listeners = new AbortController();
  let rowsController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  let sequence = 0;
  let viewGeneration = 0;
  let disposed = false;
  let activeIndex = -1;
  let resultOwner: (() => boolean) | null = null;
  const mounted = () => !disposed && input.isConnected && dropdown.isConnected;
  function retireRequest(): void {
    sequence++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function hide(): void {
    retireRequest();
    viewGeneration++;
    rowsController.abort();
    dropdown.style.display = 'none';
    activeIndex = -1;
    resultOwner = null;
  }
  function pick(path: string): void {
    if (!resultOwner?.()) { hide(); return; }
    input.value = path;
    hide();
    options.onPick?.(path);
  }
  function render(query: string, dirs: readonly KnownDirectory[], owns: () => boolean, ownsRows: () => boolean): void {
    if (!owns()) return;
    const seen = new Set<string>();
    let results: Result[] = [];
    const candidates = [...options.known().map(row => ({ ...row, known: true })),
      ...dirs.map(row => ({ ...row, known: false }))];
    for (const row of candidates) {
      if (seen.has(row.short)) continue;
      seen.add(row.short);
      const indices = query ? options.match(query, row.short) : [];
      if (!indices) continue;
      results.push({ ...row, indices, score: query ? options.score(indices, row.short) + (row.known ? 5 : 0) : 0 });
    }
    if (query) results.sort((a, b) => b.score - a.score);
    results = results.slice(0, 15);
    rowsController.abort();
    rowsController = new AbortController();
    activeIndex = -1;
    resultOwner = ownsRows;
    if (!results.length) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = results.map(row =>
      `<div class="cwd-option" data-path="${options.escapeHtml(row.short)}">${row.known ? '<span class="cwd-known">★</span>' : ''}${options.highlight(row.short, row.indices)}</div>`).join('');
    dropdown.style.display = 'block';
    for (const row of Array.from(dropdown.querySelectorAll<HTMLElement>('.cwd-option'))) {
      row.addEventListener('mousedown', event => {
        event.preventDefault();
        if (dropdown.contains(row)) pick(row.dataset.path || '');
      }, { signal: rowsController.signal });
    }
  }
  function show(query: string): void {
    // Retire at the keystroke, not when the debounce eventually starts its read.
    retireRequest();
    if (resultOwner && !resultOwner()) hide();
    if (blurTimer !== null) clearTimeout(blurTimer);
    blurTimer = null;
    const selected = options.host();
    if (!mounted() || !selected) return;
    const host = Object.freeze({ ...selected });
    const requestSequence = sequence;
    const rowGeneration = viewGeneration;
    // Existing paths stay selectable while a new query is pending on this host.
    const ownsRows = () => mounted() && viewGeneration === rowGeneration && sameDirectoryHost(host, options.host());
    const owns = () => mounted() && sequence === requestSequence && sameDirectoryHost(host, options.host());
    timer = setTimeout(async () => {
      timer = null;
      if (!owns()) return;
      let rows: readonly KnownDirectory[] = [];
      try {
        const response = await options.request(host, '/api/dirs?q=' + encodeURIComponent(query));
        if (!owns()) return;
        if (response.ok) rows = decodeKnownDirectories(await response.json());
      } catch {} // Known paths remain useful when the directory service fails.
      render(query, rows, owns, ownsRows);
    }, 120);
  }
  const listener = { signal: listeners.signal };
  input.addEventListener('focus', () => show(input.value), listener);
  input.addEventListener('input', () => show(input.value), listener);
  input.addEventListener('blur', () => {
    if (blurTimer !== null) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { blurTimer = null; hide(); }, 150);
    options.onBlur?.();
  }, listener);
  input.addEventListener('keydown', event => {
    if (resultOwner && !resultOwner()) hide();
    if (dropdown.style.display === 'none') {
      if (event.key === 'Enter' && options.onSubmit) { event.preventDefault(); options.onSubmit(); }
      return;
    }
    const rows = Array.from(dropdown.querySelectorAll<HTMLElement>('.cwd-option'));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) { activeIndex = -1; return; }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = Math.max(0, Math.min(activeIndex + delta, rows.length - 1));
      rows.forEach((row, index) => row.classList.toggle('active', index === activeIndex));
      rows[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = rows[activeIndex];
      if (selected) pick(selected.dataset.path || '');
      else { hide(); options.onSubmit?.(); }
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      hide();
    }
  }, listener);
  function dispose(): void {
    disposed = true;
    hide();
    if (blurTimer !== null) clearTimeout(blurTimer);
    blurTimer = null;
    listeners.abort();
  }
  return { show, hide, dispose };
}
