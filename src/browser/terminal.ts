import type { Terminal, ITerminalOptions, ITheme } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { HostEndpoint } from './api-client';
import type { SessionState, SessionEntry, SelectionOwner } from './session-state';
import { shortCwd, tmuxPrefixSeq } from './helper-format';
import { sessionKey } from './helper-identity';
import { record, finite } from './helper-values';
export type TerminalMode = 'shell' | 'tmux';
export type TerminalInput = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number } | { type: 'restart' };
export type TerminalOutput = { type: 'attach'; replay: string; cwd: string; tmuxPrefix: string | null } | { type: 'output'; data: string } | { type: 'exit'; code: number | null } | { type: 'error'; error: string };
export function decodeTerminalOutput(value: unknown): TerminalOutput | null {
  if (!record(value)) return null;
  switch (value.type) {
    case 'attach': return { type: 'attach', replay: typeof value.replay === 'string' ? value.replay : '', cwd: typeof value.cwd === 'string' ? value.cwd : '', tmuxPrefix: typeof value.tmuxPrefix === 'string' ? value.tmuxPrefix : null };
    case 'output': return typeof value.data === 'string' ? { type: 'output', data: value.data } : null;
    case 'exit': return { type: 'exit', code: finite(value.code) ? value.code : null };
    case 'error': return typeof value.error === 'string' ? { type: 'error', error: value.error } : null;
    default: return null;
  }
}
interface TerminalState {
  readonly term: Terminal; readonly fitAddon: FitAddon | null; readonly sessionId: string; readonly owner: SelectionOwner; readonly endpoint: Readonly<HostEndpoint>;
  readonly mode: TerminalMode; readonly events: AbortController;
  ws: WebSocket | null; tmuxPrefix: string | null; reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  attempts: number; exited: boolean; connection: number;
}
export function createTerminalController(options: {
  document: Document; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; sessionState: SessionState;
  host: (id: string | null) => HostEndpoint | null; supportsTerminal: (session: SessionEntry | null) => boolean; supportsTmux: (session: SessionEntry | null) => boolean;
  asset: (tag: 'link' | 'script', attributes: Record<string, string>) => Promise<unknown>;
  createTerminal: (options: ITerminalOptions) => Terminal | null; createFitAddon: () => FitAddon | null;
  socket: (url: string) => WebSocket; socketUrl: (host: Readonly<HostEndpoint>, path: string) => string;
  ticket: (host: Readonly<HostEndpoint>, purpose: 'terminal') => Promise<string>;
  theme: () => ITheme; applySize: (panel: HTMLElement) => void; confirm: (message: string) => boolean;
}) {
  const { document, storage, sessionState } = options, window = document.defaultView!;
  const element = (id: string) => { const value = document.getElementById(id); if (!value) throw new Error('Missing terminal element: ' + id); return value; };
  let state: TerminalState | null = null, disposed = false, generation = 0, ctrlLatch = false;
  let assets: Promise<void> | null = null, cancelOpen: (() => void) | null = null;
  const events = new AbortController(); let keybarMounted = false;
  function sameHost(owner: SelectionOwner, endpoint: Readonly<HostEndpoint>) {
    const host = options.host(owner.host); return !!host && host.base === endpoint.base && (host.token || '') === (endpoint.token || '');
  }
  function owns(value: TerminalState): boolean { return !disposed && value === state && sessionState.ownsSelection(value.owner) && sameHost(value.owner, value.endpoint); }
  function modeKey(id: string, host = sessionState.sessionHostId(id)): string { return 'pi-dish-terminal-mode-' + sessionKey(host, id); }
  function loadAssets(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (!assets) assets = (async () => {
      await Promise.all([options.asset('link', { rel: 'stylesheet', href: 'vendor/xterm.css' }), options.asset('script', { src: 'vendor/xterm.js' })]);
      await options.asset('script', { src: 'vendor/xterm-addon-fit.js' });
    })();
    return assets;
  }
  function status(text = '', cls = '') {
    const value = document.getElementById('terminalStatus'); if (!value) return;
    value.textContent = text; value.className = 'terminal-status' + (cls ? ' ' + cls : '');
  }
  function setCtrl(on: boolean) { ctrlLatch = on; document.getElementById('termKeyCtrl')?.classList.toggle('latched', on); }
  function updateButtons() {
    if (disposed) return;
    const show = options.supportsTerminal(sessionState.currentSession) && sessionState.currentSession?.isActive === true;
    for (const id of ['btnTerminal', 'cpTerminalRow']) { const value = document.getElementById(id); if (value) value.style.display = show ? '' : 'none'; }
  }
  function updateMode() {
    if (disposed) return;
    const button = document.getElementById('termModeBtn');
    if (button) {
      button.style.display = state && options.supportsTmux(sessionState.currentSession) && sessionState.currentSession?.isActive === true ? '' : 'none';
      button.textContent = state?.mode === 'tmux' ? '⇆ shell' : '⇆ pi tmux';
      button.title = state?.mode === 'tmux' ? 'Switch to a plain shell at the session cwd' : "Attach to the tmux pane the session's pi runs in";
    }
    const prefix = document.getElementById('termKeyPrefix');
    if (prefix) { const sequence = state?.mode === 'tmux' ? tmuxPrefixSeq(state.tmuxPrefix) : null; prefix.style.display = sequence ? '' : 'none'; if (sequence) prefix.textContent = state?.tmuxPrefix || ''; }
  }
  function fit() { if (state && owns(state)) try { state.fitAddon?.fit(); } catch { /* Hidden panel geometry may be unavailable. */ } }
  function send(message: TerminalInput, owner = state) {
    if (!owner || !owns(owner)) return;
    const socket = owner.ws; if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  }
  async function open(mode?: TerminalMode): Promise<void> {
    if (disposed || state || !sessionState.currentSession || !options.supportsTerminal(sessionState.currentSession)) return;
    cancelOpen?.(); const own = ++generation;
    const session = sessionState.currentSession, owner = sessionState.captureSelection(); if (!owner) return;
    const resolved = options.host(owner.host); if (!resolved) return;
    const endpoint = Object.freeze({ ...resolved });
    let cancel!: () => void; const cancelled = new Promise<void>(resolve => { cancel = resolve; }); cancelOpen = cancel;
    const current = () => !disposed && own === generation && !state && sessionState.ownsSelection(owner) && sameHost(owner, endpoint);
    let fontTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      try { await Promise.race([loadAssets(), cancelled]); } catch { return; }
      if (!current()) return;
      mode ||= storage.getItem(modeKey(owner.id, owner.host)) === 'tmux' ? 'tmux' : 'shell';
      try { await Promise.race([document.fonts.load('12px "Symbols Nerd Font Mono"'), cancelled, new Promise<void>(resolve => { fontTimer = setTimeout(resolve, 2000); })]); }
      catch { /* Missing font keeps the terminal usable. */ }
      finally { clearTimeout(fontTimer); }
      if (!current()) return;
      const css = window.getComputedStyle(document.documentElement);
      const term = options.createTerminal({ fontFamily: css.getPropertyValue('--font-mono').trim() + ", 'Symbols Nerd Font Mono'", fontSize: window.innerWidth <= 768 ? 12 : 13, theme: options.theme(), scrollback: 5000, cursorBlink: true });
      if (!term) return;
      const fitAddon = options.createFitAddon(); if (fitAddon) term.loadAddon(fitAddon);
      const next: TerminalState = { term, fitAddon, sessionId: owner.id, owner, endpoint, mode, events: new AbortController(), ws: null, tmuxPrefix: null, reconnectTimer: undefined, attempts: 0, exited: false, connection: 0 };
      state = next;
      const panel = element('terminalPanel'); options.applySize(panel); panel.style.display = '';
      element('terminalCwd').textContent = shortCwd(typeof session.cwd === 'string' ? session.cwd : '~');
      updateMode(); term.open(element('terminalContainer')); fit();
      term.onData(data => {
        if (!owns(next)) return;
        if (ctrlLatch && data.length === 1) { const code = data.toUpperCase().charCodeAt(0); if (code >= 64 && code <= 95) data = String.fromCharCode(code & 31); setCtrl(false); }
        send({ type: 'input', data }, next);
      });
      term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }, next));
      window.addEventListener('resize', fit, { signal: next.events.signal });
      window.visualViewport?.addEventListener('resize', fit, { signal: next.events.signal });
      connect(); term.focus();
    } finally { clearTimeout(fontTimer); if (cancelOpen === cancel) cancelOpen = null; }
  }
  function connect(): void {
    const current = state; if (!current || !owns(current)) return;
    clearTimeout(current.reconnectTimer);
    const sequence = ++current.connection;
    const query = current.mode === 'tmux' ? '?mode=tmux' : '';
    const url = options.socketUrl(current.endpoint, `/api/sessions/${encodeURIComponent(current.sessionId)}/terminal${query}`);
    const ready = () => owns(current) && sequence === current.connection;
    if (!current.endpoint.token) { openSocket(current, url, sequence); return; }
    status(current.attempts ? 'reconnecting…' : 'connecting…', 'reconnecting');
    void options.ticket(current.endpoint, 'terminal').then(ticket => { if (ready()) openSocket(current, `${url}${query ? '&' : '?'}ticket=${encodeURIComponent(ticket)}`, sequence); })
      .catch(() => { if (ready()) status('connect failed', 'error'); });
  }
  function openSocket(current: TerminalState, url: string, sequence: number) {
    if (!owns(current) || sequence !== current.connection) return;
    const socket = options.socket(url), previous = current.ws; current.ws = socket;
    try { previous?.close(); } catch { /* Retired sockets cannot reconnect. */ }
    const active = () => owns(current) && current.ws === socket && current.connection === sequence;
    status(current.attempts ? 'reconnecting…' : 'connecting…', 'reconnecting');
    socket.onmessage = event => {
      if (!active() || typeof event.data !== 'string') return;
      let message: TerminalOutput | null;
      try { const value: unknown = JSON.parse(event.data); message = decodeTerminalOutput(value); } catch { return; }
      if (!message) return;
      if (message.type === 'attach') {
        current.attempts = 0; status(); current.tmuxPrefix = message.tmuxPrefix; updateMode(); current.term.reset();
        if (message.replay) current.term.write(message.replay);
        if (message.cwd) element('terminalCwd').textContent = shortCwd(message.cwd);
        fit(); send({ type: 'resize', cols: current.term.cols, rows: current.term.rows }, current);
      } else if (message.type === 'output') current.term.write(message.data);
      else if (message.type === 'exit') { current.exited = true; status(`shell exited (${message.code})`); }
      else { current.exited = true; status(message.error, 'error'); }
    };
    socket.onclose = () => {
      if (!active() || current.exited) return;
      const delay = Math.min(8000, 1000 * 2 ** current.attempts++); status('disconnected — reconnecting…', 'reconnecting');
      clearTimeout(current.reconnectTimer);
      current.reconnectTimer = setTimeout(() => { if (active()) connect(); }, delay);
    };
  }
  function close(): void {
    if (disposed) return;
    generation++; cancelOpen?.(); cancelOpen = null;
    const current = state; state = null;
    if (current) { clearTimeout(current.reconnectTimer); current.events.abort(); try { current.ws?.close(); } catch { /* Socket already gone. */ } current.term.dispose(); }
    setCtrl(false); status(); element('terminalPanel').style.display = 'none';
  }
  function switchMode() {
    const current = state; if (!current || !owns(current)) return;
    const mode = current.mode === 'tmux' ? 'shell' : 'tmux';
    if (mode === 'tmux' && !options.supportsTmux(sessionState.currentSession)) return;
    if (mode === 'tmux') storage.setItem(modeKey(current.sessionId, current.owner.host), mode); else storage.removeItem(modeKey(current.sessionId, current.owner.host));
    close(); void open(mode);
  }
  function restart() {
    const current = state; if (!current || !owns(current)) return;
    if (!options.confirm(current.mode === 'tmux' ? 'Reattach the tmux client? (The tmux session and everything in it keeps running.)' : 'Restart shell? Anything running in it will be killed.') || !owns(current)) return;
    current.exited = false;
    if (current.ws?.readyState === 1) send({ type: 'restart' }, current);
    else { clearTimeout(current.reconnectTimer); current.attempts = 0; connect(); }
    current.term.focus();
  }
  function key(key: string) {
    const current = state; if (!current || !owns(current)) return;
    if (key === 'ctrl') { setCtrl(!ctrlLatch); return; }
    let sequence: string | null | undefined;
    if (key === 'tmux-prefix') sequence = tmuxPrefixSeq(current.tmuxPrefix);
    else {
      const sequences: Readonly<Record<string, string>> = { esc: '\x1b', tab: '\t', 'ctrl-c': '\x03' };
      sequence = sequences[key];
      if (!sequence) { const direction: Readonly<Record<string, string>> = { up: 'A', down: 'B', right: 'C', left: 'D' }; if (!direction[key]) return; sequence = (current.term.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b[') + direction[key]; }
    }
    if (sequence) send({ type: 'input', data: sequence }, current); current.term.focus();
  }
  function mountKeybar() {
    if (disposed || keybarMounted) return;
    const bar = document.getElementById('terminalKeybar'); if (!bar) return; keybarMounted = true;
    bar.addEventListener('pointerdown', event => {
      if (!(event.target instanceof Element)) return; const button = event.target.closest<HTMLButtonElement>('button[data-termkey]'); if (!button) return;
      event.preventDefault(); key(button.dataset.termkey || '');
    }, { signal: events.signal });
  }
  return { open, close, loadAssets, fit, send, connect, switchMode, restart, key, mountKeybar, modeKey, updateButtons, updateMode,
    toggle() { if (state || cancelOpen) close(); else void open(); },
    refreshTheme() { if (state && owns(state)) state.term.options.theme = options.theme(); },
    get state(): Readonly<TerminalState> | null { return state; },
    dispose() { close(); events.abort(); disposed = true; } };
}
