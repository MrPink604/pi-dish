import { shortModelName } from './helper-usage';
import { harnessBadgeInnerHtml } from './sidebar-render';
import { contextClass, formatTokens } from './helper-format';
import { harnessBadgeInfo } from './helper-identity';
import { record } from './helper-values';
import type { SessionState, SessionEntry } from './session-state';
function string(value: unknown) { return typeof value === 'string' ? value : ''; }
function number(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function supports(session: SessionEntry, capability: string) { const caps = session.capabilities; return !record(caps) || caps[capability] !== false; }
export function createSessionHeader(options: {
  document: Document; sessionState: SessionState; multi: () => boolean; host: (id: string | null | undefined) => unknown;
  down: (id: string | null | undefined) => boolean; color: (id: string | null | undefined) => string; label: (id: string | null | undefined) => string;
  settings: (session: SessionEntry) => boolean; ensureHarness: (host: string | null) => void; thinking: () => void; terminal: () => void; mic: () => void;
}) {
const { document, sessionState } = options; let disposed = false;
const element = (id: string) => document.getElementById(id)!;
function setModelChipLabel(btn: HTMLElement, model: string, suffix: string) {
  const full = String(model || '');
  btn.title = full ? `${full} — change model` : 'Change model';
  btn.textContent = full + suffix;
  // scrollWidth is 0 while the header is hidden; then the full ref stands
  // and the next header update (the view is visible by then) trims it.
  if (btn.clientWidth && btn.scrollWidth > btn.clientWidth) {
    const short = shortModelName(full);
    if (short !== full) btn.textContent = short + suffix;
  }
}

function updateSessionHeader() {
  if (disposed || !sessionState.currentSession) return;
  const raw = sessionState.currentSession, current = { ...raw, name: string(raw.name), model: string(raw.model), cwd: string(raw.cwd), harnessId: string(raw.harnessId), harnessLabel: string(raw.harnessLabel),
    contextPercent: number(raw.contextPercent), contextTokens: number(raw.contextTokens), isActive: !!raw.isActive };

  element('sessionName').textContent = current.name || 'Unnamed';
  const hostEl = element('sessionHost');
  if (hostEl) {
    const showHost = options.multi() && !!options.host(current.host);
    hostEl.style.display = showHost ? '' : 'none';
    hostEl.className = 'badge host-badge' + (options.down(current.host) ? ' offline' : '');
    // Same color the sidebar gave this host; the dot is a ::before, so the
    // badge stays a textContent write.
    hostEl.style.setProperty('--host-color', showHost ? options.color(current.host) : '');
    hostEl.textContent = showHost ? options.label(current.host) : '';
  }
  const harnessEl = element('sessionHarness');
  const showHarness = current.harnessId && current.harnessId !== 'pi';
  harnessEl.style.display = showHarness ? '' : 'none';
  if (showHarness) {
    const info = harnessBadgeInfo(current.harnessId, current.harnessLabel);
    const title = current.harnessLabel || info.label;
    options.ensureHarness(current.host || null);
    // Clickable only where the host reports a settings view for this harness
    // (OMP's /agents + /models hubs today).
    const configurable = options.settings(raw);
    harnessEl.className = `badge harness-badge harness-badge-${current.harnessId}`
      + (configurable ? ' clickable' : '');
    harnessEl.title = configurable ? `${title} settings: agents and models` : `${title} harness`;
    harnessEl.setAttribute('aria-label', configurable ? `${title} settings` : `${title} harness`);
    if (configurable) harnessEl.setAttribute('role', 'button');
    else harnessEl.removeAttribute('role');
    // Icon only in the header — the label span is CSS-hidden here, the name
    // lives in the tooltip. Sidebar rows show the full badge.
    harnessEl.innerHTML = harnessBadgeInnerHtml(info);
  } else {
    harnessEl.textContent = '';
  }
  // The tree has no header button any more (type /tree in the composer); the
  // mobile control panel keeps its row, so it still follows harness support.
  const cpTree = element('cpTreeRow');
  if (cpTree) cpTree.style.display = supports(raw, 'tree') ? '' : 'none';
  // Phone parity for the header badge: same modal from the control panel.
  const cpHarness = element('cpHarnessRow');
  if (cpHarness) cpHarness.style.display = options.settings(raw) ? '' : 'none';
  element('btnExport').style.display = supports(raw, 'export') ? '' : 'none';

  const nameEl = element('sessionName');
  const canRename = current.isActive && supports(raw, 'rename');
  nameEl.classList.toggle('editable-name', canRename);
  nameEl.title = canRename ? 'Click to rename' : '';

  const modelBtn = element('sessionModel');
  const canSetModel = current.isActive && supports(raw, 'setModel');
  setModelChipLabel(modelBtn, current.model, canSetModel ? ' ▾' : '');
  modelBtn.style.cursor = canSetModel ? 'pointer' : 'default';

  // One readout, in the composer field: percent only (its slot is fixed
  // width), with the token count in the tooltip.
  const ctxClass = contextClass(current.contextPercent);
  const contextEl = element('sessionContext');
  contextEl.textContent = `${current.contextPercent}%`;
  contextEl.className = 'tool-btn tool-ctx' + (ctxClass ? ' ' + ctxClass : '');
  contextEl.title = current.contextTokens
    ? `Session stats — ${formatTokens(current.contextTokens)} tokens of context`
    : 'Session stats';

  options.thinking();
  options.terminal();
  options.mic();

  // Phone chip row: the working directory is the one piece of session
  // context the header used to hide behind the stats modal.
  const cwdChip = element('sessionCwdChip');
  if (cwdChip) {
    const cwd = current.cwd || '';
    cwdChip.style.display = cwd ? '' : 'none';
    cwdChip.textContent = cwd ? (cwd.split('/').filter(Boolean).pop() || cwd) : '';
    cwdChip.title = cwd ? `${cwd} — session stats` : 'Session stats';
  }
}

return { update: updateSessionHeader, label: setModelChipLabel, dispose() { disposed = true; } };
}
