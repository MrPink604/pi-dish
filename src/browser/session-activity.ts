import { formatDuration } from './helper-format';
import type { SelectionOwner, SessionState } from './session-state';
export function createSessionActivity(options: {
  document: Document; sessionState: SessionState; clearQueue: () => void; status: (message: string) => void;
  /** An open side chat makes Send the composer action even during a main turn. */
  sideChatActive: () => boolean;
}) {
const { document, sessionState } = options;
let turnInProgress = false, disposed = false;
let owner: SelectionOwner | null = null;


// Client-side: opening a session mid-turn counts from connect.
let turnStartedAt: number | null = null;
let workingTicker: ReturnType<typeof setInterval> | null = null;
const runningTools = new Map<string, string>(); // toolCallId -> toolName

// Tracked apart from the turn (manual compaction has none). Sends are held during
// compaction, so the badge must explain why nothing streams.
let compactingNow = false;
let compactingStartedAt: number | null = null;

function updateWorkingIndicator() {
  if (disposed || !sessionState.ownsSelection(owner)) return;
  const desktop = document.querySelector('#sessionWorking .spinner-text');
  const mobile = document.querySelector('#sessionWorkingMobile .spinner-text');
  // Compacting wins the badge text over the turn: it's the rarer state and
  // the one that changes what a send does right now.
  if (compactingNow) {
    const elapsed = compactingStartedAt ? formatDuration(Date.now() - compactingStartedAt) : '';
    if (desktop) desktop.textContent = 'Compacting context…' + (elapsed ? ' ' + elapsed : '');
    if (mobile) mobile.textContent = 'Compacting…';
    return;
  }
  if (!turnInProgress || !turnStartedAt) {
    if (desktop) desktop.textContent = 'Working';
    // The phone's chip row leads with run state, so this cell always says
    // something — blank would make the row's anchor move.
    if (mobile) mobile.textContent = 'idle';
    return;
  }
  const elapsed = formatDuration(Date.now() - turnStartedAt);
  let tool = null;
  for (const name of runningTools.values()) tool = name; // most recently started
  if (tool && tool.length > 24) tool = tool.slice(0, 24) + '…';
  if (desktop) desktop.textContent = `Working ${elapsed}` + (tool ? ` · ${tool}` : '');
  if (mobile) mobile.textContent = elapsed + (tool ? ` · ${tool}` : '');
}

// A running turn or compaction keeps the badge, ticker and Stop button alive.
function syncActivityIndicator() {
  const active = turnInProgress || compactingNow;
  if (active) {
    if (!workingTicker) workingTicker = setInterval(updateWorkingIndicator, 1000);
  } else if (workingTicker) {
    clearInterval(workingTicker);
    workingTicker = null;
  }
  var workingDesktop = document.getElementById('sessionWorking');
  var workingMobile = document.getElementById('sessionWorkingMobile');
  if (workingDesktop) workingDesktop.classList.toggle('active', active);
  if (workingMobile) workingMobile.classList.toggle('active', active);
  // The bridge cancels a running compaction on abort, so Stop stays reachable.
  var btnStop = document.getElementById('btnStop');
  // visibility, not display: the context readout beside it keeps its
  // position whether or not a turn is running.
  if (btnStop) btnStop.style.visibility = active ? 'visible' : 'hidden';
  updateWorkingIndicator();
}

// Side chats are independent of the main turn, so Send stays; Steer/follow-up would misdeliver.
function syncComposerButtons() {
  if (disposed) return;
  const sideChat = !!options.sideChatActive(), steering = turnInProgress && !sideChat;
  const btnSteer = document.getElementById('btnSteer');
  const btnFollowUp = document.getElementById('btnFollowUp');
  const btnSend = document.getElementById('btnSend');
  if (btnSteer) btnSteer.style.display = steering ? '' : 'none';
  if (btnFollowUp) btnFollowUp.style.display = steering ? '' : 'none';
  if (btnSend) btnSend.style.display = turnInProgress && !sideChat ? 'none' : '';
}

function setTurnInProgress(active: boolean) {
  if (disposed) return; owner = sessionState.captureSelection();
  const starting = active && !turnInProgress;
  turnInProgress = active;
  if (starting) {
    turnStartedAt = Date.now();
  } else if (!active) {
    turnStartedAt = null;
    runningTools.clear();
  }
  syncActivityIndicator();
  // Turn events only stream for the viewed session, so don't wait for the poll.
  if (sessionState.currentSession && !!sessionState.currentSession.turnInProgress !== !!active) {
    sessionState.patchSessionActivity(sessionState.currentSession.id, { turnInProgress: !!active }, owner?.host);
  }
  syncComposerButtons();
  // A turn ending mid-compaction must not wipe the compaction badge, held strip or status.
  if (!active && !compactingNow) {
    options.clearQueue();
    options.status('');
  }
}

function setCompacting(active: boolean) {
  if (disposed) return; owner = sessionState.captureSelection();
  const on = !!active;
  compactingNow = on;
  compactingStartedAt = on ? (compactingStartedAt || Date.now()) : null;
  syncActivityIndicator();
  // Compaction events only stream for the viewed session; other rows update via the poll.
  if (sessionState.currentSession && !!sessionState.currentSession.compacting !== on) {
    sessionState.patchSessionActivity(sessionState.currentSession.id, { compacting: on }, owner?.host);
  }
}


function toolStarted(id: string, name: string) { if (disposed) return; runningTools.set(id, name); updateWorkingIndicator(); }
function toolFinished(id: string) { if (disposed) return; runningTools.delete(id); updateWorkingIndicator(); }
const aborts = new Map<string, symbol>();
function beginAbort(key: string) { if (disposed || aborts.has(key)) return null; const token = Symbol(); aborts.set(key, token); return token; }
function endAbort(key: string, token?: symbol) { if (token === undefined || aborts.get(key) === token) aborts.delete(key); }
function dispose() { if (disposed) return; disposed = true; if (workingTicker) clearInterval(workingTicker); workingTicker = null; runningTools.clear(); aborts.clear(); }
return { setTurn: setTurnInProgress, setCompacting, update: updateWorkingIndicator, toolStarted, toolFinished, beginAbort, endAbort, isAborting: (key: string) => aborts.has(key), syncComposerButtons, dispose,
  get turn() { return turnInProgress; }, get compacting() { return compactingNow; } };
}
