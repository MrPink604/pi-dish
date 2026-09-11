import { formatDuration } from './helper-format';
import type { SelectionOwner, createSessionState } from './session-state';
export function createSessionActivity(options: { document: Document; sessionState: ReturnType<typeof createSessionState>; clearQueue: () => void; status: (message: string) => void }) {
const { document, sessionState } = options;
let turnInProgress = false, disposed = false;
let owner: SelectionOwner | null = null;


// --- Live activity: elapsed turn time + currently running tool -----------
// The working badge reads "Working 1:42 · Bash" so a glance says what the
// agent is doing and for how long (mobile badge shows just the timer).
// Client-side by nature: opening a session mid-turn counts from connect.
let turnStartedAt: number | null = null;
let workingTicker: ReturnType<typeof setInterval> | null = null;
const runningTools = new Map<string, string>(); // toolCallId -> toolName

// Compaction state, tracked separately from the turn: manual compaction has
// no turn at all, while auto-compaction runs inside one. Whichever is on,
// the badge must say so — a send during compaction is held by the bridge,
// and the user needs to see why nothing is streaming (and must not fire a
// second /compact into it).
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

// One place decides whether the pulsing badge, its ticker, and the Stop
// button are on: a running turn or a running compaction (or both, during
// auto-compaction) keeps them alive. Text comes from updateWorkingIndicator.
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
  // Stop stays reachable during compaction — the bridge cancels a running
  // compaction on abort. Steer/follow-up only make sense against a turn,
  // so they remain setTurnInProgress's business.
  var btnStop = document.getElementById('btnStop');
  // visibility, not display: the context readout beside it keeps its
  // position whether or not a turn is running.
  if (btnStop) btnStop.style.visibility = active ? 'visible' : 'hidden';
  updateWorkingIndicator();
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
  // Reflect in the sidebar immediately — the working dot shouldn't wait for
  // the next 10s poll. (turn events only stream for the viewed session.)
  if (sessionState.currentSession && !!sessionState.currentSession.turnInProgress !== !!active) {
    sessionState.patchSession(sessionState.currentSession.id, { turnInProgress: !!active });
  }
  var btnSteer = document.getElementById('btnSteer');
  var btnFollowUp = document.getElementById('btnFollowUp');
  var btnSend = document.getElementById('btnSend');
  if (btnSteer) btnSteer.style.display = active ? '' : 'none';
  if (btnFollowUp) btnFollowUp.style.display = active ? '' : 'none';
  if (btnSend) btnSend.style.display = active ? 'none' : '';
  // A turn ending mid-compaction (manual /compact aborts the agent first;
  // auto-compaction holds queued sends) must not wipe the compaction badge,
  // the held-message strip, or the status line.
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
  // Sidebar dot immediately, same as the turn dot (compaction events only
  // stream for the viewed session; other rows update via the poll).
  if (sessionState.currentSession && !!sessionState.currentSession.compacting !== on) {
    sessionState.patchSession(sessionState.currentSession.id, { compacting: on });
  }
}


function toolStarted(id: string, name: string) { if (disposed) return; runningTools.set(id, name); updateWorkingIndicator(); }
function toolFinished(id: string) { if (disposed) return; runningTools.delete(id); updateWorkingIndicator(); }
const aborts = new Map<string, symbol>();
function beginAbort(key: string) { if (disposed || aborts.has(key)) return null; const token = Symbol(); aborts.set(key, token); return token; }
function endAbort(key: string, token?: symbol) { if (token === undefined || aborts.get(key) === token) aborts.delete(key); }
function dispose() { if (disposed) return; disposed = true; if (workingTicker) clearInterval(workingTicker); workingTicker = null; runningTools.clear(); aborts.clear(); }
return { setTurn: setTurnInProgress, setCompacting, update: updateWorkingIndicator, toolStarted, toolFinished, beginAbort, endAbort, isAborting: (key: string) => aborts.has(key), dispose,
  get turn() { return turnInProgress; }, get compacting() { return compactingNow; } };
}
