import { escapeHtml } from '../core/helper-format';
import { sessionRefKey } from './helper-identity';
import type { SessionState, SessionEntry, SelectionOwner } from './session-state';
import type { HostEndpoint } from './api-client';
import type { PendingSessionSpawn } from './session-spawns';
/** Operations selection may consume; collaborators retain their other authority. */
export interface SessionViewDrafts {
  stash(): void;
  clear(): void;
  waiting(value: boolean): void;
  restore(id?: string | null): void;
}
export interface SessionViewActivity {
  setCompacting(active: boolean): void;
  setTurn(active: boolean): void;
}
export interface SessionViewTranscript {
  retire(): void;
  stash(): void;
  reset(): void;
  deleteCached(key: string): void;
  load(owner?: SelectionOwner | null): Promise<void>;
}
export interface SessionViewStream {
  stop(): void;
  start(owner?: SelectionOwner | null): Promise<void>;
}
export interface SessionViewResume {
  reset(): void;
  load(session: SessionEntry | null): Promise<void>;
  dispose(): void;
}
export interface SessionSelectOptions { forceTranscriptReload?: boolean; host?: string | null; keepBounceView?: boolean }
export function createSessionView(options: {
  document: Document; sessionState: SessionState; storage: Pick<Storage, 'setItem'>; endpoint: (host: string | null) => HostEndpoint;
  drafts: SessionViewDrafts; activity: SessionViewActivity; transcript: SessionViewTranscript;
  stream: SessionViewStream; resume: SessionViewResume; spawn: (id: string) => PendingSessionSpawn | null | undefined;
  closeViews: (keepBounce: boolean) => void; resetSearch: () => void; cancelStreaming: () => void; stopFollowing: () => void;
  closeTerminal: () => void; clearExtension: () => void; clearRelations: () => void; closeControls: () => void; hideAutocomplete: () => void;
  retireModels: () => void; retireCommands: () => void; queue: (value: null) => void; closeBtw: () => void; resetArtifacts: () => void;
  thinking: () => void; terminal: () => void; mic: () => void; mood: (description: string, face: string) => void; status: (message: string, type?: string) => void;
  render: () => void; cancelRecording: () => void; hideNote: () => void; math: () => Promise<unknown>; reveal: (id: string, host?: string | null) => void;
  seen: (session: SessionEntry) => void; artifacts: (owner: SelectionOwner) => unknown; header: () => void; relations: (owner: SelectionOwner) => unknown;
  models: (id: string, harness?: string) => unknown; commands: (id: string) => unknown;
}) {
  const { document, sessionState } = options; const element = (id: string) => document.getElementById(id)!;
  let currentSessionSpawnId: string | null = null, disposed = false;
function pendingComposerKey(spawnId: string) { return `spawn:${spawnId}`; }

// Ordered retirement phases: advance/stash draft, stash DOM, retire transports,
// reset activity. Activation stays at its existing seams between these phases.
function beginSelectionRetirement() {
  sessionState.advanceSelection();
  // Clear transient marks before caching already-finalized transcript nodes.
  options.resetSearch();
  options.transcript.retire();
  options.drafts.stash();
}

function stashRetiringTranscript(keepBounce: boolean) {
  options.cancelStreaming();
  // Dictation must never land in the replacement composer's draft.
  options.cancelRecording();
  options.hideNote();
  options.closeViews(keepBounce);
  options.transcript.stash();
}

function retireSessionResources() {
  options.stream.stop();
  options.stopFollowing();
  options.closeTerminal();
  options.clearExtension();
  options.clearRelations();
}

function resetSelectionActivity(current: SessionEntry | null) {
  options.queue(null);
  options.closeBtw();
  options.activity.setCompacting(!!current?.isActive && !!current.compacting);
  options.activity.setTurn(!!current?.isActive && !!current.turnInProgress);
  options.resetArtifacts();
}

// Show a usable pane before the bridge has produced a real session id. Keep
// currentSession null so no transcript/stream/action can accidentally target
// the operation id; only the composer is owned by the provisional key.
function showPendingSessionView(spawnId: string) {
  if (disposed) return; const spawn = options.spawn(spawnId);
  if (!spawn) return;
  const harnessLabel = spawn.harnessLabel || 'Pi';
  beginSelectionRetirement();
  stashRetiringTranscript(false);
  sessionState.setCurrentSession(null);
  currentSessionSpawnId = spawnId;

  retireSessionResources();
  options.closeControls();
  options.hideAutocomplete();
  options.retireModels();
  options.retireCommands();

  element('emptyState').style.display = 'none';
  element('sessionView').style.display = 'flex';
  document.querySelector<HTMLElement>('.input-area')!.style.display = '';
  element('resumeBar').style.display = 'none';
  document.querySelector<HTMLElement>('.session-actions')!.style.display = 'none';

  resetSelectionActivity(null);

  const nameEl = element('sessionName');
  nameEl.textContent = 'Starting session…';
  nameEl.classList.remove('editable-name');
  nameEl.title = '';
  const modelBtn = element('sessionModel');
  modelBtn.textContent = `${harnessLabel} starting`;
  modelBtn.style.cursor = 'default';
  const ctxReset = element('sessionContext');
  ctxReset.textContent = '0%';
  ctxReset.className = 'tool-btn tool-ctx';
  const cacheReset = element('sessionCache');
  cacheReset.style.display = 'none';
  cacheReset.textContent = '';
  options.thinking();
  options.terminal();
  options.mic();

  options.transcript.reset();
  options.mood('', '');
  const targetLabel = spawn.target ? 'tmux' : 'the headless session';
  element('messages').innerHTML = `<div class="empty-state pending-session-state" style="padding: 48px;">
    <p>Starting ${escapeHtml(harnessLabel)} in ${targetLabel}…</p>
    <small>You can write your prompt while it starts.</small>
  </div>`;

  options.drafts.restore(pendingComposerKey(spawnId));
  options.drafts.waiting(true);
  options.status(`${harnessLabel} is starting — your draft will be ready when it connects`, 'working');
  options.render();
  element('promptInput').focus();
}

function showPendingSessionFailure(spawnId: string, message: string, spawn?: Pick<PendingSessionSpawn, 'harnessLabel'>) {
  if (disposed || currentSessionSpawnId !== spawnId) return;
  const harnessLabel = spawn?.harnessLabel || 'Agent';
  element('sessionName').textContent = 'Session failed to start';
  element('messages').innerHTML = `<div class="empty-state pending-session-state" style="padding: 48px;">
    <p>${escapeHtml(harnessLabel)} could not start.</p>
    <small>${escapeHtml(message)}</small>
  </div>`;
  const input = element('promptInput') as HTMLTextAreaElement;
  input.placeholder = 'Your draft is preserved here so you can copy it';
  const btn = element('btnSend') as HTMLButtonElement;
  btn.disabled = true;
  btn.title = message;
}

async function selectSession(id: string, { forceTranscriptReload = false, host = null, keepBounceView = false }: SessionSelectOptions = {}) {
  // Validate the target before tearing anything down: a stale id (a resume
  // racing a filtered refresh, a pruned session) must leave the current view
  // intact instead of stashing the transcript and then bailing on a blank pane.
  if (disposed || !sessionState.findSession(id, host)) return;
  beginSelectionRetirement();
  currentSessionSpawnId = null;
  options.drafts.waiting(false);
  stashRetiringTranscript(keepBounceView);
  const current = sessionState.setCurrentSession(id, host); if (!current) return;
  const owner = sessionState.captureSelection(); if (!owner) return;
  const endpoint = Object.freeze({ ...options.endpoint(owner.host) });
  const owns = () => !disposed && sessionState.ownsSelection(owner) && options.endpoint(owner.host).base === endpoint.base;
  if (forceTranscriptReload) options.transcript.deleteCached(sessionRefKey(current));
  // Math rendering is transcript-only. Start its one-shot load while the
  // synchronous session chrome is updated, then gate markdown hydration on it.
  const mathAssetsReady = options.math().catch(() => {});
  options.reveal(id, current.host);
  // Retire the previous stream before awaiting new transcript hydration.
  retireSessionResources();
  options.storage.setItem('pi-dish-session', sessionRefKey(current));
  options.seen(current);
  
  element('emptyState').style.display = 'none';
  element('sessionView').style.display = 'flex';
  
  // Show/hide input area vs resume bar based on active state
  const inputArea = document.querySelector<HTMLElement>('.input-area')!;
  const resumeBar = element('resumeBar');
  const sessionActions = document.querySelector<HTMLElement>('.session-actions')!;
  
  options.closeControls();

  if (current.isActive) {
    if (inputArea) inputArea.style.display = '';
    if (resumeBar) resumeBar.style.display = 'none';
    options.resume.reset();
    options.drafts.restore();
  } else {
    options.drafts.clear();
    if (inputArea) inputArea.style.display = 'none';
    // A live subagent's transcript belongs to the session running it, so
    // resuming would put a second harness process on a file that process
    // keeps appending to. The bar keeps the read-only label and Stats; only
    // the Resume affordance goes.
    const resumable = current.capabilities?.resume !== false;
    if (resumeBar) {
      resumeBar.style.display = '';
      const cwdSpan = resumeBar.querySelector('.resume-cwd');
      if (cwdSpan) cwdSpan.textContent = current.cwd || '~';
      const label = resumeBar.querySelector('.resume-label');
      if (label) {
        label.textContent = resumable
          ? 'Read-only — session is inactive'
          : 'Read-only — a live session owns this transcript';
      }
      const resumeBtn = resumeBar.querySelector<HTMLElement>('#resumeSessionBtn');
      if (resumeBtn) resumeBtn.style.display = resumable ? '' : 'none';
    }
    if (resumable) options.resume.load(current);
    else options.resume.reset();
  }
  if (sessionActions) sessionActions.style.display = current.isActive ? '' : 'none';

  // Seed from the new session without clearing a still-active turn's timing.
  resetSelectionActivity(current);
  options.artifacts(owner);

  options.render();
  options.header();
  options.relations(owner); // summary-only; don't stall transcript hydration
  if (current.isActive) {
    // Fire-and-forget: nothing below needs the results, and both can ask the
    // live session over its socket — don't stall the transcript on them.
    options.models(id, current.harnessId);
    options.commands(id); // refresh autocomplete with this session's commands
  }
  await mathAssetsReady;
  if (!owns()) return;
  await options.transcript.load(owner);
  if (!owns()) return;
  
  if (sessionState.currentSession?.isActive) {
    options.stream.start(owner);
  } else {
    options.stream.stop();
  }
}

return { select: selectSession, pending: showPendingSessionView, failure: showPendingSessionFailure, get spawnId() { return currentSessionSpawnId; }, dispose() { if (disposed) return; disposed = true; options.stream.stop(); options.transcript.retire(); options.resume.dispose(); } };
}
