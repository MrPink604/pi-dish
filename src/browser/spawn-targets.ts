import type { ApiRequest } from './api-client';
import { sameDirectoryHost } from './directory-catalog';
import type { DirectoryHost } from './directory-catalog';

export type SpawnTarget = Readonly<{ type: 'tmux'; socket: string; tmuxSession: string }>
  | Readonly<{ type: 'tmux'; socket: string; newTmuxSession: string }>;
export interface SpawnChoice {
  readonly label: string;
  readonly target: Readonly<{ type: 'tmux'; socket: string; tmuxSession?: string }> | null;
  readonly needsName?: boolean;
  readonly pinned?: boolean;
}
const HEADLESS: SpawnChoice = { label: 'pi-dish (headless)', target: null, pinned: true };
export function spawnTargetKey(choice: SpawnChoice): string {
  if (!choice.target) return 'headless';
  return `${choice.target.socket}::${choice.needsName ? 'new' : choice.target.tmuxSession}`;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function decodeSpawnChoices(value: unknown): readonly SpawnChoice[] {
  if (!record(value) || !value.available || !Array.isArray(value.servers)) return [HEADLESS];
  const values: unknown[] = value.servers;
  const servers = values.flatMap(server => record(server) && typeof server.name === 'string'
    && typeof server.socket === 'string' && server.socket
    ? [{ name: server.name, socket: server.socket, sessions: server.sessions }] : []);
  const choices: SpawnChoice[] = [HEADLESS];
  for (const server of servers) choices.push({ label: `tmux:${server.name} — new session…`,
    target: { type: 'tmux', socket: server.socket }, needsName: true, pinned: true });
  for (const server of servers) {
    const sessions: unknown[] = Array.isArray(server.sessions) ? server.sessions : [];
    for (const session of sessions) if (record(session) && typeof session.name === 'string' && session.name) {
      choices.push({ label: `tmux:${server.name} — ${session.name}`,
        target: { type: 'tmux', socket: server.socket, tmuxSession: session.name } });
    }
  }
  return choices;
}

/** Target choices and requests belong to the host that listed them. */
export function createSpawnTargets(options: {
  host: () => Readonly<DirectoryHost> | null;
  supportsTmux: () => boolean;
  request: ApiRequest;
  readSaved: () => string | null;
  save: (key: string) => void;
  changed: () => void;
}) {
  let sequence = 0;
  let owner: Readonly<DirectoryHost> | null = null;
  let choices: readonly SpawnChoice[] = [HEADLESS];
  let choiceKey = 'headless';
  function currentChoices(): readonly SpawnChoice[] {
    return sameDirectoryHost(owner, options.host()) ? choices : [HEADLESS];
  }
  function current(): SpawnChoice {
    return currentChoices().find(choice => spawnTargetKey(choice) === choiceKey) || HEADLESS;
  }
  function retire(): void { sequence++; }
  async function load(): Promise<void> {
    const requestSequence = ++sequence;
    owner = null;
    choices = [HEADLESS];
    choiceKey = 'headless';
    options.changed();
    const selected = options.host();
    if (!selected || !options.supportsTmux()) return;
    const host = Object.freeze({ ...selected });
    const owns = () => sequence === requestSequence && sameDirectoryHost(host, options.host());
    let next: readonly SpawnChoice[];
    try {
      const response = await options.request(host, '/api/tmux/targets');
      if (!response.ok || !owns()) return;
      const data: unknown = await response.json();
      if (!owns()) return;
      next = decodeSpawnChoices(data);
    } catch { return; }
    owner = host;
    choices = next;
    const saved = options.readSaved();
    choiceKey = choices.some(choice => spawnTargetKey(choice) === saved) ? saved || 'headless' : 'headless';
    options.changed();
  }
  function choose(key: string): boolean {
    if (!currentChoices().some(choice => spawnTargetKey(choice) === key)) return false;
    choiceKey = key;
    options.save(key);
    options.changed();
    return true;
  }
  function selected(name: string): SpawnTarget | null {
    const choice = current();
    if (!choice.target) return null;
    if (choice.needsName) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Enter a name for the new tmux session');
      return { type: 'tmux', socket: choice.target.socket, newTmuxSession: trimmed };
    }
    return choice.target.tmuxSession ? { type: 'tmux', socket: choice.target.socket, tmuxSession: choice.target.tmuxSession } : null;
  }
  function resume(host: Readonly<DirectoryHost> | null): SpawnTarget | null {
    if (!sameDirectoryHost(owner, host)) return null;
    const saved = options.readSaved();
    const choice = choices.find(item => spawnTargetKey(item) === saved);
    if (!choice?.target?.tmuxSession || choice.needsName) return null;
    return { type: 'tmux', socket: choice.target.socket, tmuxSession: choice.target.tmuxSession };
  }
  return { load, retire, choices: currentChoices, current, choose, selected, resume };
}

/** A permanent run-in combobox with disposable row listeners and blur timer. */
export function createSpawnTargetPicker(options: {
  input: HTMLInputElement;
  nameInput: HTMLInputElement;
  wrap: HTMLElement;
  dropdown: HTMLElement;
  targets: ReturnType<typeof createSpawnTargets>;
  match: (query: string, text: string) => readonly number[] | null;
  score: (indices: readonly number[], text: string) => number;
  highlight: (text: string, indices: readonly number[]) => string;
  escapeHtml: (text: string) => string;
}) {
  const { input, nameInput, wrap, dropdown, targets } = options;
  const listeners = new AbortController();
  let rowListeners = new AbortController();
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  let activeIndex = -1;
  let rendered: readonly SpawnChoice[] | null = null;
  function hide(): void {
    rowListeners.abort();
    rendered = null;
    dropdown.style.display = 'none';
    activeIndex = -1;
    if (blurTimer !== null) clearTimeout(blurTimer);
    blurTimer = null;
  }
  function sync(): void {
    hide();
    input.value = targets.current().label;
    nameInput.style.display = targets.current().needsName ? '' : 'none';
    wrap.style.display = targets.choices().length > 1 ? '' : 'none';
  }
  function choose(key: string): void {
    if (!rendered || rendered !== targets.choices()) { sync(); return; }
    if (!targets.choose(key)) return;
    sync();
    if (targets.current().needsName) nameInput.focus();
  }
  function render(query: string): void {
    hide();
    const choices = targets.choices();
    if (choices.length < 2) { sync(); return; }
    rendered = choices;
    const q = query.trim();
    let named = choices.filter(choice => !choice.pinned).flatMap(choice => {
      const indices = q ? options.match(q, choice.label) : [];
      return indices ? [{ choice, indices, score: q ? options.score(indices, choice.label) : 0 }] : [];
    });
    if (q) named = named.sort((a, b) => b.score - a.score);
    const rows = [...choices.filter(choice => choice.pinned).map(choice => ({ choice, indices: [] })), ...named];
    dropdown.innerHTML = rows.map(({ choice, indices }) =>
      `<div class="cwd-option" data-key="${options.escapeHtml(spawnTargetKey(choice))}">${indices.length ? options.highlight(choice.label, indices) : options.escapeHtml(choice.label)}</div>`).join('');
    dropdown.style.display = 'block';
    rowListeners = new AbortController();
    for (const row of Array.from(dropdown.querySelectorAll<HTMLElement>('.cwd-option'))) {
      row.addEventListener('mousedown', event => {
        event.preventDefault();
        if (dropdown.contains(row)) choose(row.dataset.key || '');
      }, { signal: rowListeners.signal });
    }
  }
  const listener = { signal: listeners.signal };
  input.addEventListener('focus', () => { input.select(); render(''); }, listener);
  input.addEventListener('input', () => render(input.value), listener);
  input.addEventListener('blur', () => {
    if (blurTimer !== null) clearTimeout(blurTimer);
    blurTimer = setTimeout(sync, 150);
  }, listener);
  input.addEventListener('keydown', event => {
    if (dropdown.style.display === 'none') return;
    if (rendered !== targets.choices()) { sync(); return; }
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
      if (row) choose(row.dataset.key || '');
      else sync();
    } else if (event.key === 'Escape') { event.stopPropagation(); sync(); }
  }, listener);
  return { sync, render, hide, dispose() { hide(); listeners.abort(); } };
}
