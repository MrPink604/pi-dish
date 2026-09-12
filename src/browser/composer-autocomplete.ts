import type { ApiRequest, HostEndpoint } from './api-client';
import type { SelectionOwner, SessionState } from './session-state';
import type { createSessionReferences } from './session-references';
import { decodeSlashCommands, decodeFileCompletions } from './composer-autocomplete-data';
import type { SlashCommand } from './composer-autocomplete-data';
import { escapeHtml, shortCwd } from './helper-format';
import { highlightFuzzy } from './helper-query';
import { record } from './helper-values';
export function createComposerAutocomplete(options: {
  document: Document; sessionState: SessionState; composerKey: () => string | null; provisional: () => boolean;
  request: ApiRequest; host: (id: string | null) => HostEndpoint | null; references: ReturnType<typeof createSessionReferences>;
  multiHost: () => boolean; hostLabel: (id: string | null) => string; failed: (error: unknown) => void;
}) {
  const { document, sessionState, references } = options;
  const input = () => document.getElementById('promptInput') as HTMLTextAreaElement;
  interface RequestOwner { selection: SelectionOwner; endpoint: Readonly<HostEndpoint> }
  interface ViewOwner extends RequestOwner { composer: string; text: string; caret: number }
  type Choice = { kind: 'file'; path: string; directory: boolean } | { kind: 'ref'; ref: string } | { kind: 'command'; name: string };
  let disposed = false, visible = false, index = 0, fileSequence = 0, commandSequence = 0;
  let fileTimer: ReturnType<typeof setTimeout> | null = null, events = new AbortController(), view: ViewOwner | null = null, commandOwner: RequestOwner | null = null;
  let commands: readonly SlashCommand[] = [];
  const lifetime = new AbortController(), blurTimers = new Set<ReturnType<typeof setTimeout>>();
  const choices = new WeakMap<HTMLElement, Choice>();
  function captureRequest(): RequestOwner | null { const selection = sessionState.captureSelection(); if (disposed || !selection) return null; const endpoint = options.host(selection.host); return endpoint ? { selection, endpoint: Object.freeze({ ...endpoint }) } : null; }
  function ownsRequest(owner: RequestOwner | null): owner is RequestOwner { return !!owner && !disposed && sessionState.ownsSelection(owner.selection) && options.host(owner.selection.host)?.base === owner.endpoint.base; }
  function capture(): ViewOwner | null { const owner = captureRequest(), composer = options.composerKey(); return owner && composer && !options.provisional() ? { ...owner, composer, text: input().value, caret: input().selectionStart } : null; }
  function owns(owner: ViewOwner | null): owner is ViewOwner { return ownsRequest(owner) && !!owner && !options.provisional() && owner.composer === options.composerKey() && owner.text === input().value && owner.caret === input().selectionStart; }
  function container() { let root = document.getElementById('autocomplete'); if (!root) { root = document.createElement('div'); root.id = 'autocomplete'; root.className = 'autocomplete-dropdown'; document.querySelector('.input-area')!.appendChild(root); } return root; }
  function hide() { for (const timer of blurTimers) clearTimeout(timer); blurTimers.clear(); visible = false; view = null; fileSequence++; if (fileTimer !== null) clearTimeout(fileTimer); fileTimer = null; events.abort(); const root = document.getElementById('autocomplete'); if (root) { root.style.display = 'none'; root.innerHTML = ''; } }
  function render(rows: readonly { choice: Choice; icon: string; nameHtml: string; description: string; live?: boolean }[], owner = capture()) {
    hide(); if (!owns(owner) || !rows.length) return;
    view = owner; visible = true; index = 0; events = new AbortController(); const ownedEvents = events, root = container();
    rows.forEach((row, i) => {
      const element = document.createElement('div'); element.className = 'autocomplete-item' + (i === 0 ? ' active' : '');
      const { choice } = row; choices.set(element, choice);
      if (choice.kind === 'file') { element.dataset.file = choice.path; if (choice.directory) element.dataset.dir = '1'; }
      else if (choice.kind === 'ref') element.dataset.sessionRef = choice.ref; else element.dataset.name = choice.name;
      element.innerHTML = `<span class="autocomplete-icon${choice.kind === 'ref' ? ' session-ref-dot' + (row.live ? ' live' : '') : ''}">${row.icon}</span><span class="autocomplete-name">${row.nameHtml}</span><span class="autocomplete-desc">${escapeHtml(row.description)}</span>`;
      element.addEventListener('click', () => { if (!ownedEvents.signal.aborted && view === owner && owns(owner)) accept(element); }, { signal: ownedEvents.signal }); root.append(element);
    }); root.style.display = 'block';
  }
  function showCommands(value: unknown) {
    const rows = decodeSlashCommands(value);
    render(rows.map(command => ({ choice: { kind: 'command', name: command.name }, icon: command.source === 'builtin' || command.source === 'host' ? '⚙️' : command.source === 'extension' ? '🧩' : command.source === 'skill' ? '📚' : '📝', nameHtml: '/' + escapeHtml(command.name) + (command.args ? ` <span class="autocomplete-args">${escapeHtml(command.args)}</span>` : ''), description: command.description })));
  }
  function showFiles(value: unknown, owner = capture()) {
    const labels: Record<string, string> = { modified: '± modified', untracked: '+ new', staged: '● staged' };
    render(decodeFileCompletions(value).map(file => ({ choice: { kind: 'file', path: file.path, directory: file.isDir }, icon: file.isDir ? '📁' : '📄', nameHtml: escapeHtml(file.path) + (file.isDir ? '/' : ''), description: Object.hasOwn(labels, file.gitStatus) ? labels[file.gitStatus]! : '' })), owner);
  }
  function showRefs(token: string) {
    const current = sessionState.currentSession; if (!current) { hide(); return; }
    render(references.search(token).map(({ session, indices }) => {
      const ref = references.ref(session, current), name = session.name || session.id.slice(0, 8);
      return { choice: { kind: 'ref', ref }, icon: '●', nameHtml: indices ? highlightFuzzy(name, indices) : escapeHtml(name), description: [options.multiHost() ? options.hostLabel(session.host || null) : '', ref, shortCwd(session.cwd)].filter(Boolean).join(' · '), live: session.isActive };
    }));
  }
  async function loadCommands(id?: string) {
    const owner = captureRequest(), sequence = ++commandSequence; commands = []; commandOwner = null;
    if (!owner || (id && owner.selection.id !== id)) return;
    try {
      const response = await options.request(owner.endpoint, '/api/commands' + (id ? '?sessionId=' + encodeURIComponent(id) : ''));
      const value: unknown = await response.json(); if (!response.ok || !ownsRequest(owner) || sequence !== commandSequence) return;
      commands = decodeSlashCommands(value); commandOwner = owner;
    } catch (error) { if (ownsRequest(owner) && sequence === commandSequence) options.failed(error); }
  }
  function queueFile(token: string) {
    hide(); const owner = capture(); if (!owner) return; const sequence = ++fileSequence;
    fileTimer = setTimeout(() => {
      fileTimer = null; if (!owns(owner) || sequence !== fileSequence) return;
      const endpoint = options.host(owner.selection.host); if (!endpoint || endpoint.base !== owner.endpoint.base) return;
      void options.request({ ...owner.endpoint, token: endpoint.token }, `/api/sessions/${encodeURIComponent(owner.selection.id)}/files?q=${encodeURIComponent(token)}`).then(async response => {
        const value: unknown = await response.json(); if (!owns(owner) || sequence !== fileSequence) return;
        if (document.activeElement !== input()) { hide(); return; }
        if (response.ok && record(value)) showFiles(value.files, owner); else hide();
      }).catch(() => { if (owns(owner) && sequence === fileSequence) hide(); });
    }, 120);
  }
  function handle(text: string) {
    if (disposed || options.provisional()) { hide(); return; }
    const caret = input().selectionStart, at = text.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
    if (at && sessionState.currentSession) { queueFile(at[1]!); return; }
    const hash = text.slice(0, caret).match(/(?:^|\s)#([^\s#]*)$/); if (hash && sessionState.currentSession) { showRefs(hash[1]!); return; }
    if (!text.startsWith('/') || text.includes(' ') || !ownsRequest(commandOwner)) { hide(); return; }
    const query = text.slice(1), matches = commands.filter(command => command.name.toLowerCase().startsWith(query.toLowerCase()));
    if (!matches.length || (matches.length === 1 && matches[0]!.name === query)) { hide(); return; } showCommands(matches);
  }
  function insert(choice: Choice) {
    const owner = view; if (!owns(owner)) return;
    const target = input(), caret = target.selectionStart;
    if (choice.kind === 'command') { hide(); target.value = '/' + choice.name + ' '; target.focus(); target.dispatchEvent(new Event('input')); return; }
    const token = choice.kind === 'file' ? '@' : '#', match = target.value.slice(0, caret).match(choice.kind === 'file' ? /(?:^|\s)@([^\s@]*)$/ : /(?:^|\s)#([^\s#]*)$/); hide(); if (!match) return;
    const start = caret - match[1]!.length - 1, value = choice.kind === 'file' ? choice.path + (choice.directory ? '/' : ' ') : choice.ref + ' ';
    target.value = target.value.slice(0, start) + token + value + target.value.slice(caret); const position = start + 1 + value.length; target.focus(); target.setSelectionRange(position, position);
    target.dispatchEvent(new Event('input')); // Every accepted mention also persists the draft.
  }
  function accept(element: HTMLElement) { if (!visible || !owns(view) || !container().contains(element)) return; const choice = choices.get(element); if (choice) insert(choice); }
  function move(delta: number) {
    if (!visible || !owns(view)) return; const rows = [...container().querySelectorAll<HTMLElement>('.autocomplete-item')]; if (!rows.length) return;
    index = (index + delta + rows.length) % rows.length; rows.forEach((row, i) => row.classList.toggle('active', i === index)); rows[index]!.scrollIntoView({ block: 'nearest' });
  }
  input().addEventListener('blur', () => {
    const owner = view, timer = setTimeout(() => { blurTimers.delete(timer); if (!disposed && view === owner && document.activeElement !== input()) hide(); }, 200); blurTimers.add(timer);
  }, { signal: lifetime.signal });
  const retireMovedCaret = () => { if (view && !owns(view)) hide(); };
  document.addEventListener('selectionchange', retireMovedCaret, { signal: lifetime.signal });
  input().addEventListener('select', retireMovedCaret, { signal: lifetime.signal });
  function retireCommands() { commandSequence++; commands = []; commandOwner = null; }
  return { retireCommands, loadCommands, handle, queueFile, showFiles, showRefs, showCommands, hide, move, accept,
    acceptFile: (path: string, directory: boolean) => insert({ kind: 'file', path, directory }), acceptRef: (ref: string) => insert({ kind: 'ref', ref }), acceptCommand: (name: string) => insert({ kind: 'command', name }),
    get visible() { return visible && owns(view); }, get index() { return index; },
    dispose() { hide(); lifetime.abort(); commandSequence++; commands = []; commandOwner = null; disposed = true; },
  };
}
