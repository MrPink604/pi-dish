import { record } from '../core/helper-values';
import { ApiHttpError, sendJson } from './api-client';
import type { ApiRequest, HostEndpoint } from './api-client';
import type { SelectionOwner, SessionState } from './session-state';

export type SideChatTurnStatus = 'running' | 'complete' | 'error' | 'cancelled';
export interface SideChatTurn {
  id: string;
  question: string;
  answer: string;
  status: SideChatTurnStatus;
  error?: string;
  startedAt: number;
  updatedAt: number;
}
export interface SideChat { id: string; createdAt: number; turns: SideChatTurn[] }
export type SideChatState = SideChat | null;
/** The stream identifies its own session so a stale/foreign snapshot is not rendered. */
export interface SideChatSession { id: string; host: string | null }

function decodeTurn(value: unknown): SideChatTurn | null {
  if (!record(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id) return null;
  const status = value.status;
  if (status !== 'running' && status !== 'complete' && status !== 'error' && status !== 'cancelled') return null;
  const error = typeof value.error === 'string' && value.error ? value.error : '';
  const startedAt = typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) ? value.startedAt : 0;
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : startedAt;
  return {
    id,
    question: typeof value.question === 'string' ? value.question : '',
    answer: typeof value.answer === 'string' ? value.answer : '',
    status,
    ...(error ? { error } : {}),
    startedAt,
    updatedAt,
  };
}
/** Defensive mirror of the server snapshot; malformed entries become null/absent. */
export function decodeSideChat(value: unknown): SideChatState {
  if (!record(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id) return null;
  const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : 0;
  const turns = Array.isArray(value.turns)
    ? value.turns.map(decodeTurn).filter((turn): turn is SideChatTurn => turn !== null)
    : [];
  return { id, createdAt, turns };
}

interface TurnView {
  element: HTMLElement;
  question: HTMLElement;
  body: HTMLElement;
  copy: HTMLButtonElement;
  copyText: string;
  rendered: string;
}
interface Shell { stop: HTMLButtonElement; close: HTMLButtonElement; turns: HTMLElement }

/** The panel's consumer contract: no caller supplies a question owner. */
export interface SideChatController {
  ask(question: string, askOptions?: { fresh?: boolean }): Promise<boolean>;
  apply(value: unknown, session: SideChatSession | null | undefined): void;
  cancel(): Promise<void>;
  close(): Promise<void>;
  active(): SideChatState;
  reset(): void;
  dispose(): void;
}

/** Ephemeral multi-turn side conversation: never part of the session transcript. */
export function createSideChat(options: {
  document: Document; sessionState: SessionState;
  markdown: (text: string) => string; copy: (text: string) => Promise<unknown>;
  request: ApiRequest; endpoint: (host: string | null) => HostEndpoint;
  status: (text: string, type?: string) => void;
  onChange?: (active: boolean) => void;
}): SideChatController {
  const panel = options.document.getElementById('sideChat')!;
  const events = new AbortController();
  const turns = new Map<string, TurnView>();
  let state: SideChatState = null, stateOwner: SelectionOwner | null = null;
  let shell: Shell | null = null, disposed = false, notified = false;
  // Snapshots arrive both as responses and as stream events; only the newest
  // observation may render, so a late response cannot replace fresher state.
  let sequence = 0, copyToken = 0;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  function active(): SideChatState {
    if (disposed || !state || !stateOwner) return null;
    return options.sessionState.ownsSelection(stateOwner) ? state : null;
  }
  function notify() {
    const next = !!active();
    if (next === notified) return;
    notified = next;
    options.onChange?.(next);
  }
  function capture(): { owner: SelectionOwner; endpoint: Readonly<HostEndpoint> } | null {
    const owner = options.sessionState.captureSelection();
    return owner ? { owner, endpoint: Object.freeze({ ...options.endpoint(owner.host) }) } : null;
  }
  function owns(captured: { owner: SelectionOwner; endpoint: Readonly<HostEndpoint> }) {
    return !disposed && options.sessionState.ownsSelection(captured.owner)
      && options.endpoint(captured.owner.host).base === captured.endpoint.base;
  }
  function sessionPath(owner: SelectionOwner) { return `/api/sessions/${encodeURIComponent(owner.id)}/side-chat`; }
  // A host still on a pre-side-chat pi-dish has no route at all.
  async function post(captured: { owner: SelectionOwner; endpoint: Readonly<HostEndpoint> }, suffix: string, body: unknown) {
    try {
      return await sendJson(options.request, captured.endpoint, sessionPath(captured.owner) + suffix, body);
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 404 && !/not active/i.test(error.message)) {
        throw new Error('This host runs an older pi-dish without side chats; update its pi-dish to use them.');
      }
      throw error;
    }
  }

  function cacheBody(view: TurnView, key: string, update: () => void) {
    if (view.rendered === key) return;
    view.rendered = key;
    update();
  }

  function renderTurn(turn: SideChatTurn) {
    let view = turns.get(turn.id);
    if (!view) {
      const element = options.document.createElement('div');
      element.className = 'side-chat-turn';
      element.dataset.turnId = turn.id;
      element.innerHTML = '<div class="side-chat-question"></div><div class="side-chat-answer"><div class="side-chat-answer-body"></div><button type="button" class="side-chat-btn side-chat-copy" title="Copy answer" hidden>Copy</button></div>';
      const created: TurnView = {
        element,
        question: element.querySelector<HTMLElement>('.side-chat-question')!,
        body: element.querySelector<HTMLElement>('.side-chat-answer-body')!,
        copy: element.querySelector<HTMLButtonElement>('.side-chat-copy')!,
        copyText: '',
        rendered: '',
      };
      created.copy.addEventListener('click', () => {
        const chat = state;
        if (chat && created.copyText) void copyAnswer(created.copy, chat.id, turn.id, created.copyText);
      }, { signal: events.signal });
      turns.set(turn.id, created);
      view = created;
    }
    view.question.textContent = turn.question;
    const copyText = turn.status === 'complete' ? turn.answer : '';
    if (view.copyText !== copyText) {
      view.copyText = copyText;
      view.copy.textContent = 'Copy';
    }
    view.copy.hidden = !copyText;
    if (turn.status === 'error') {
      cacheBody(view, 'error\0' + (turn.error || ''), () => {
        view!.body.className = 'side-chat-answer-body error';
        view!.body.textContent = turn.error || 'Side chat failed';
      });
    } else if (turn.status === 'cancelled') {
      cacheBody(view, 'cancelled', () => {
        view!.body.className = 'side-chat-answer-body stopped';
        view!.body.textContent = 'Stopped';
      });
    } else if (turn.status === 'running' && !turn.answer) {
      cacheBody(view, 'running', () => {
        view!.body.className = 'side-chat-answer-body pending';
        view!.body.textContent = 'Thinking…';
      });
    } else {
      cacheBody(view, 'answer\0' + turn.answer, () => {
        view!.body.className = 'side-chat-answer-body';
        view!.body.innerHTML = '<div class="markdown-body">' + options.markdown(turn.answer) + '</div>';
      });
    }
  }

  function ensureShell(): Shell {
    if (shell) return shell;
    panel.innerHTML = '<div class="side-chat-header"><span class="side-chat-tag">Side chat</span>'
      + '<span class="side-chat-hint">Answers stay out of the transcript</span>'
      + '<button type="button" class="side-chat-btn side-chat-stop" hidden>Stop</button>'
      + '<button type="button" class="side-chat-btn side-chat-close" title="Close side chat" aria-label="Close side chat">✕</button></div>'
      + '<div class="side-chat-turns"></div>';
    const stop = panel.querySelector<HTMLButtonElement>('.side-chat-stop')!;
    const close = panel.querySelector<HTMLButtonElement>('.side-chat-close')!;
    stop.addEventListener('click', () => { void cancel(); }, { signal: events.signal });
    close.addEventListener('click', () => { void closeSideChat(); }, { signal: events.signal });
    shell = { stop, close, turns: panel.querySelector<HTMLElement>('.side-chat-turns')! };
    return shell;
  }

  function render() {
    if (disposed) return;
    if (!state) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      shell = null;
      turns.clear();
      return;
    }
    const pinned = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4;
    const current = ensureShell();
    panel.style.display = '';
    current.stop.hidden = !state.turns.some(turn => turn.status === 'running');
    const present = new Set(state.turns.map(turn => turn.id));
    for (const [id, view] of turns) {
      if (present.has(id)) continue;
      view.element.remove();
      turns.delete(id);
    }
    for (const turn of state.turns) {
      const created = !turns.has(turn.id);
      renderTurn(turn);
      if (created) current.turns.append(turns.get(turn.id)!.element);
    }
    if (pinned) panel.scrollTop = panel.scrollHeight;
  }

  function setState(next: SideChatState, owner: SelectionOwner) {
    if (disposed) return;
    state = next;
    stateOwner = next ? owner : null;
    if (!next && copyTimer) { clearTimeout(copyTimer); copyTimer = null; }
    render();
    notify();
  }

  function ownsAnswer(chatId: string, turnId: string, text: string) {
    if (disposed || !state || state.id !== chatId) return false;
    const turn = state.turns.find(item => item.id === turnId);
    return !!turn && turn.status === 'complete' && turn.answer === text;
  }

  async function copyAnswer(button: HTMLButtonElement, chatId: string, turnId: string, text: string) {
    if (!ownsAnswer(chatId, turnId, text) || !panel.contains(button)) return;
    const token = ++copyToken;
    if (copyTimer) { clearTimeout(copyTimer); copyTimer = null; }
    button.disabled = true;
    try {
      await options.copy(text);
      if (token !== copyToken || !ownsAnswer(chatId, turnId, text) || !panel.contains(button)) return;
      button.textContent = 'Copied';
      copyTimer = setTimeout(() => {
        copyTimer = null;
        if (token === copyToken && ownsAnswer(chatId, turnId, text) && panel.contains(button)) button.textContent = 'Copy';
      }, 1500);
    } catch {
      if (token === copyToken && ownsAnswer(chatId, turnId, text) && panel.contains(button)) button.textContent = 'Failed';
    } finally {
      if (panel.contains(button)) button.disabled = false;
    }
  }

  /** Stream snapshots: render only when the emitting stream owns the selection. */
  function apply(value: unknown, session: SideChatSession | null | undefined) {
    if (disposed || !session) return;
    const selection = options.sessionState.captureSelection();
    if (!selection || session.id !== selection.id || (session.host || null) !== selection.host) return;
    sequence++;
    setState(decodeSideChat(value), selection);
  }

  async function ask(question: string, askOptions: { fresh?: boolean } = {}): Promise<boolean> {
    if (disposed) return false;
    const captured = capture();
    if (!captured) return false;
    const chatId = askOptions.fresh ? null : active()?.id || null;
    const token = ++sequence;
    const value = await post(captured, '', chatId ? { question, chatId } : { question });
    if (token !== sequence || !owns(captured)) return false;
    setState(decodeSideChat(record(value) ? value.sideChat : null), captured.owner);
    return true;
  }

  async function action(kind: 'cancel' | 'close') {
    const chat = active();
    if (disposed || !chat) return;
    const captured = capture();
    if (!captured) return;
    const token = ++sequence;
    try {
      const value = await post(captured, `/${kind}`, { chatId: chat.id });
      if (token !== sequence || !owns(captured)) return;
      setState(decodeSideChat(record(value) ? value.sideChat : null), captured.owner);
    } catch (error) {
      if (!owns(captured)) return;
      const message = error instanceof Error ? error.message : String(error);
      options.status(`Could not ${kind === 'cancel' ? 'stop' : 'close'} the side chat: ${message}`, 'error');
    }
  }

  function cancel() { return action('cancel'); }
  function closeSideChat() { return action('close'); }

  /** Selection change: the replacement stream replays its own side chat. */
  function reset() {
    if (disposed) return;
    sequence++;
    state = null;
    stateOwner = null;
    if (copyTimer) { clearTimeout(copyTimer); copyTimer = null; }
    copyToken++;
    render();
    notify();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    sequence++;
    state = null;
    stateOwner = null;
    if (copyTimer) { clearTimeout(copyTimer); copyTimer = null; }
    copyToken++;
    events.abort();
    shell = null;
    turns.clear();
    panel.className = 'side-chat';
    panel.style.display = 'none';
    panel.innerHTML = '';
    if (notified) { notified = false; options.onChange?.(false); }
  }

  return { ask, apply, cancel: cancel, close: closeSideChat, active, reset, dispose };
}
