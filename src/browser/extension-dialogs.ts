import type { ApiRequest, HostEndpoint } from './api-client';
import { sendJson } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import type { ExtensionRequest, ExtensionResponse, ExtensionAuth } from './extension-ui-data';
import { authCallbackMatches, authUrlState, parseAuthCallback } from './extension-auth';
import { escapeHtml } from '../core/helper-format';
import { sessionKey } from './helper-identity';
import { record } from '../core/helper-values';
export type ExtensionSession = Readonly<Pick<SelectionOwner, 'id' | 'host'>>;
interface DialogEntry {
  readonly el: HTMLElement; readonly events: AbortController; readonly endpoint: Readonly<HostEndpoint>;
  owner: SelectionOwner | null; readonly sessionId: string; readonly hostId: string | null; readonly sessionKey: string;
  readonly requestId: string; minimized: boolean; readonly sig: string; readonly loginId?: string; readonly authKind?: string;
}
export function createExtensionDialogs(options: {
  document: Document; sessionState: SessionState; request: ApiRequest; host: (id: string | null) => HostEndpoint | null;
  status: (message: string, type?: string) => void; toast: (message: string, type: 'info' | 'warning' | 'error') => void;
}) {
  const { document, sessionState } = options;
  let disposed = false;
  const openExtDialogs = new Map<string, DialogEntry>();
  // Values already answered per (session, loginId): never re-submit them from the clipboard.
  const authSubmitted = new Map<string, Set<string>>();
  function extDialogKey(requestId: string, sessionId: string, hostId: string | null) { return JSON.stringify([hostId, sessionId, requestId]); }
  function extDialogSig(req: ExtensionRequest) { return req.method === 'ask' ? 'ask:' + JSON.stringify(req.questions) : `${req.method}:${JSON.stringify([req.title, req.message, req.options, req.placeholder, req.prefill])}`; }
  function matches(entry: DialogEntry) {
    const selected = sessionState.currentSession, host = options.host(entry.hostId);
    return !!selected && selected.id === entry.sessionId && (selected.host || null) === entry.hostId && !!host && host.base === entry.endpoint.base;
  }
  function currentCard(key: string, card: HTMLElement) {
    const entry = openExtDialogs.get(key); return !disposed && !!entry && entry.el === card && card.isConnected && matches(entry) && sessionState.ownsSelection(entry.owner);
  }
  function findDuplicateExtDialog(req: ExtensionRequest, session: ExtensionSession) {
    const sig = extDialogSig(req), key = sessionKey(session.host, session.id);
    return [...openExtDialogs.values()].find(entry => entry.sessionKey === key && entry.sig === sig && matches(entry)) || null;
  }
function getExtDialogDock() {
  const inputArea = document.querySelector('.input-area');
  if (!inputArea) return null;
  let dock = document.getElementById('extUiDialogs');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'extUiDialogs';
    dock.className = 'ext-ui-dialog-dock';
    inputArea.insertBefore(dock, document.getElementById('attachmentStrip'));
  }
  return dock;
}

// Drop the dock element once it empties. The composer stays put either way —
// the dock sits above it like an extension widget and caps its own height.
function updateExtDialogDock() {
  const dock = document.getElementById('extUiDialogs');
  if (dock && !dock.children.length) dock.remove();
}

function dockExtDialog(entry: DialogEntry) {
  if (disposed || !matches(entry)) return;
  const dock = getExtDialogDock();
  if (!dock) return;
  entry.owner = sessionState.captureSelection();
  if (entry.el.parentNode !== dock) dock.appendChild(entry.el);
  entry.el.classList.toggle('minimized', entry.minimized);
  updateExtDialogDock();
}

function setExtDialogMinimized(requestId: string, minimized: boolean) {
  const entry = openExtDialogs.get(requestId);
  if (!entry) return;
  entry.minimized = minimized;
  entry.el.classList.toggle('minimized', minimized);
  updateExtDialogDock();
  if (!minimized) {
    entry.el.querySelector<HTMLElement>('.ext-ui-ask-option, .ext-ui-dialog-option, .ext-ui-dialog-input, .ext-ui-dialog-editor')?.focus();
  }
}

function sendExtDialogResponse(dialogKey: string, response: ExtensionResponse, card: HTMLElement) {
  const entry = openExtDialogs.get(dialogKey);
  if (!entry || !currentCard(dialogKey, card)) return;
  const host = options.host(entry.hostId); if (!host || host.base !== entry.endpoint.base) return;
  const owner = entry.owner;
  void sendJson(options.request, Object.freeze({ ...host }), `/api/sessions/${encodeURIComponent(entry.sessionId)}/ui-response`, { requestId: entry.requestId, ...response })
    .catch(error => { if (!disposed && sessionState.ownsSelection(owner)) options.status('Dialog response failed: ' + (error instanceof Error ? error.message : String(error)), 'error'); });
  dismissExtDialog(dialogKey);
}

function dismissExtDialog(requestId: string) {
  const entry = openExtDialogs.get(requestId);
  if (!entry) return;
  entry.events.abort(); entry.el.remove();
  openExtDialogs.delete(requestId);
  if (entry.loginId) authSubmitted.delete(JSON.stringify([entry.sessionKey, entry.loginId]));
  updateExtDialogDock();
}

// Shared chrome: title row with minimize (background) and close (cancel),
// then the per-method body, then the label shown while minimized.
function buildExtDialogCard(requestId: string, events: AbortController, { title, bodyHtml, footerHtml, collapsedLabel, onClose }: { title: string; bodyHtml: string; footerHtml?: string; collapsedLabel: string; onClose: () => void }) {
  const card = document.createElement('div');
  card.className = 'ext-ui-dialog-modal ext-ui-docked-dialog';
  card.innerHTML = `
    <div class="ext-ui-dialog-head">
      <div class="ext-ui-dialog-title">${escapeHtml(title)}</div>
      <button class="ext-ui-dialog-min" title="Background — keep the composer usable and answer later">–</button>
      <button class="ext-ui-dialog-close" title="Dismiss (cancel)">×</button>
    </div>
    <div class="ext-ui-dialog-body">${bodyHtml}</div>
    ${footerHtml ? `<div class="ext-ui-dialog-foot">${footerHtml}</div>` : ''}
    <div class="ext-ui-dialog-collapsed-label">${escapeHtml(collapsedLabel)}</div>`;
  card.querySelector('.ext-ui-dialog-min')!.addEventListener('click', (e) => {
    e.stopPropagation(); if (!currentCard(requestId, card)) return;
    setExtDialogMinimized(requestId, true);
  }, { signal: events.signal });
  card.querySelector('.ext-ui-dialog-close')!.addEventListener('click', (e) => {
    e.stopPropagation(); if (!currentCard(requestId, card)) return;
    onClose();
  }, { signal: events.signal });
  card.addEventListener('click', () => {
    if (currentCard(requestId, card) && openExtDialogs.get(requestId)?.minimized) setExtDialogMinimized(requestId, false);
  }, { signal: events.signal });
  return card;
}

function showExtAskDialog(req: ExtensionRequest, session: ExtensionSession) {
  if (!req.id) return;
  const { id: sessionId, host: hostId } = session;
  const endpoint = options.host(hostId); if (disposed || !endpoint) return;
  const dialogKey = extDialogKey(req.id, sessionId, hostId);
  const previous = openExtDialogs.get(dialogKey); if (previous && previous.endpoint.base !== endpoint.base) dismissExtDialog(dialogKey);
  // Replayed request for a dialog we still hold (e.g. switch-back): re-dock
  // the live element so in-progress selections survive.
  const existing = openExtDialogs.get(dialogKey);
  if (existing) {
    dockExtDialog(existing);
    return;
  }
  const duplicate = findDuplicateExtDialog(req, session);
  if (duplicate) {
    dockExtDialog(duplicate);
    return;
  }
  const questions = req.questions;
  if (!questions.length) {
    options.toast('Ask dialog had no valid questions', 'warning');
    return;
  }

  const events = new AbortController();
  const card = buildExtDialogCard(dialogKey, events, {
    title: questions.length === 1 ? 'Question' : `${questions.length} questions`,
    collapsedLabel: questions.length === 1
      ? `Question pending: ${questions[0].question || ''}`
      : `${questions.length} questions pending — click to answer`,
    onClose: () => sendExtDialogResponse(dialogKey, { cancelled: true }, card),
    bodyHtml: `
    <div class="ext-ui-ask-questions">
      ${questions.map((question, questionIndex) => {
        const options = question.options;
        return `<section class="ext-ui-ask-question" data-question-index="${questionIndex}">
          ${question.header ? `<div class="ext-ui-ask-header">${escapeHtml(question.header)}</div>` : ''}
          <div class="ext-ui-ask-prompt">${escapeHtml(question.question || '')}</div>
          <div class="ext-ui-dialog-options">
            ${options.map((option, optionIndex) => {
              const normalized = option;
              const recommended = question.recommended === optionIndex;
              return `<button type="button" class="ext-ui-dialog-option ext-ui-ask-option${recommended ? ' recommended' : ''}"
                data-question-index="${questionIndex}" data-option-index="${optionIndex}" aria-pressed="false">
                <span class="ext-ui-ask-marker">${question.multi ? '☐' : '○'}</span>
                <span class="ext-ui-ask-option-copy">
                  <span class="ext-ui-ask-option-label">${escapeHtml(normalized.label || '')}${recommended ? ' <span class="ext-ui-ask-recommended">Recommended</span>' : ''}</span>
                  ${normalized.description ? `<span class="ext-ui-ask-option-description">${escapeHtml(normalized.description)}</span>` : ''}
                  ${normalized.preview ? `<pre class="ext-ui-ask-option-preview">${escapeHtml(normalized.preview)}</pre>` : ''}
                </span>
              </button>`;
            }).join('')}
          </div>
          <input class="ext-ui-dialog-input ext-ui-ask-custom" data-question-index="${questionIndex}"
            type="text" placeholder="Other (type your own)">
          <input class="ext-ui-dialog-input ext-ui-ask-note" data-question-index="${questionIndex}"
            type="text" placeholder="Optional note">
          <div class="ext-ui-ask-error" hidden>Choose an option or enter your own answer.</div>
        </section>`;
      }).join('')}
    </div>
    `,
    footerHtml: `
    <div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn" data-action="chat">Chat about this</button>
      <button class="ext-ui-dialog-btn primary" data-action="submit-ask">Submit</button>
    </div>`,
  });
  card.classList.add('ext-ui-ask-modal');

  const selections = questions.map(() => new Set<number>());
  card.querySelectorAll<HTMLButtonElement>('.ext-ui-ask-option').forEach(button => {
    button.addEventListener('click', () => {
      if (!currentCard(dialogKey, card)) return;
      const questionIndex = Number(button.dataset.questionIndex);
      const optionIndex = Number(button.dataset.optionIndex);
      const question = questions[questionIndex];
      if (!question || !Number.isInteger(optionIndex)) return;
      const selected = selections[questionIndex];
      if (question.multi) {
        if (selected.has(optionIndex)) selected.delete(optionIndex);
        else selected.add(optionIndex);
      } else {
        selected.clear();
        selected.add(optionIndex);
      }
      card.querySelectorAll<HTMLButtonElement>(`.ext-ui-ask-option[data-question-index="${questionIndex}"]`).forEach(candidate => {
        const index = Number(candidate.dataset.optionIndex);
        const active = selected.has(index);
        candidate.classList.toggle('selected', active);
        candidate.setAttribute('aria-pressed', active ? 'true' : 'false');
        candidate.querySelector('.ext-ui-ask-marker')!.textContent = question.multi
          ? (active ? '☑' : '☐')
          : (active ? '●' : '○');
      });
      const custom = card.querySelector<HTMLInputElement>(`.ext-ui-ask-custom[data-question-index="${questionIndex}"]`);
      if (!question.multi && custom) custom.value = '';
      card.querySelector<HTMLElement>(`.ext-ui-ask-question[data-question-index="${questionIndex}"] .ext-ui-ask-error`)?.setAttribute('hidden', '');
    }, { signal: events.signal });
  });

  card.querySelectorAll<HTMLInputElement>('.ext-ui-ask-custom').forEach(input => {
    input.addEventListener('input', () => {
      if (!currentCard(dialogKey, card)) return;
      const questionIndex = Number(input.dataset.questionIndex);
      const question = questions[questionIndex];
      if (!question || question.multi || !input.value.trim()) return;
      selections[questionIndex].clear();
      card.querySelectorAll<HTMLButtonElement>(`.ext-ui-ask-option[data-question-index="${questionIndex}"]`).forEach(candidate => {
        candidate.classList.remove('selected');
        candidate.setAttribute('aria-pressed', 'false');
        candidate.querySelector('.ext-ui-ask-marker')!.textContent = '○';
      });
    }, { signal: events.signal });
  });

  card.querySelector('[data-action="chat"]')!.addEventListener('click', () => {
    sendExtDialogResponse(dialogKey, { value: { kind: 'chat' } }, card);
  }, { signal: events.signal });
  card.querySelector('[data-action="submit-ask"]')!.addEventListener('click', () => {
    if (!currentCard(dialogKey, card)) return;
    const invalidSections: HTMLElement[] = [];
    const results = questions.map((question, questionIndex) => {
      const options = question.options;
      const customField = card.querySelector<HTMLInputElement>(`.ext-ui-ask-custom[data-question-index="${questionIndex}"]`);
      const noteField = card.querySelector<HTMLInputElement>(`.ext-ui-ask-note[data-question-index="${questionIndex}"]`);
      const customInput = customField?.value.trim() || undefined;
      const note = noteField?.value.trim() || undefined;
      const selectedOptions = [...selections[questionIndex]]
        .sort((a, b) => a - b)
        .map(index => {
          const option = options[index];
          return option?.label;
        })
        .filter(label => typeof label === 'string');
      if (!question.multi && selectedOptions.length === 0 && customInput === undefined) {
        const section = card.querySelector<HTMLElement>(`.ext-ui-ask-question[data-question-index="${questionIndex}"]`);
        section?.querySelector('.ext-ui-ask-error')?.removeAttribute('hidden');
        if (section) invalidSections.push(section);
      }
      return {
        id: question.id,
        question: question.question || '',
        options: options.map(option => option.label),
        multi: question.multi === true,
        selectedOptions,
        ...(customInput !== undefined ? { customInput } : {}),
        ...(note !== undefined ? { note } : {}),
      };
    });
    const invalid = invalidSections[0];
    if (invalid) {
      invalid.scrollIntoView({ block: 'nearest' });
      invalid.querySelector<HTMLElement>('.ext-ui-ask-option, .ext-ui-ask-custom')?.focus();
      return;
    }
    sendExtDialogResponse(dialogKey, { value: { kind: 'submit', results } }, card);
  }, { signal: events.signal });

  const entry: DialogEntry = { el: card, events, endpoint: Object.freeze({ ...endpoint }), owner: sessionState.captureSelection(), sessionId, hostId, sessionKey: sessionKey(hostId, sessionId), requestId: req.id, minimized: false, sig: extDialogSig(req) };
  openExtDialogs.set(dialogKey, entry);
  dockExtDialog(entry);
  card.querySelector<HTMLElement>('.ext-ui-ask-option, .ext-ui-ask-custom')?.focus();
}

function showExtDialog(req: ExtensionRequest, session: ExtensionSession) {
  if (!req.id) return;
  const { id: sessionId, host: hostId } = session;
  const endpoint = options.host(hostId); if (disposed || !endpoint) return;
  const dialogKey = extDialogKey(req.id, sessionId, hostId);
  const previous = openExtDialogs.get(dialogKey); if (previous && previous.endpoint.base !== endpoint.base) dismissExtDialog(dialogKey);
  const existing = openExtDialogs.get(dialogKey);
  if (existing) {
    dockExtDialog(existing);
    return;
  }
  const duplicate = findDuplicateExtDialog(req, session);
  if (duplicate) {
    dockExtDialog(duplicate);
    return;
  }

  let bodyHtml = '';
  if (req.message) bodyHtml += `<div class="ext-ui-dialog-message">${escapeHtml(req.message)}</div>`;

  if (req.method === 'select') {
    bodyHtml += '<div class="ext-ui-dialog-options">' +
      req.options.map((opt, i) => {
        const label = opt.label;
        const description = opt.description
          ? `<span class="ext-ui-ask-option-description">${escapeHtml(opt.description)}</span>` : '';
        return `<button class="ext-ui-dialog-option" data-option-index="${i}">
          <span class="ext-ui-ask-option-label">${escapeHtml(label)}</span>${description}
        </button>`;
      }).join('') + '</div>';
  } else if (req.method === 'confirm') {
    bodyHtml += `<div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn primary" data-action="yes">Yes</button>
      <button class="ext-ui-dialog-btn" data-action="no">No</button>
    </div>`;
  } else if (req.method === 'input') {
    bodyHtml += `<input class="ext-ui-dialog-input" type="text" placeholder="${escapeHtml(req.placeholder || '')}">
    <div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn primary" data-action="submit">Submit</button>
      <button class="ext-ui-dialog-btn" data-action="cancel">Cancel</button>
    </div>`;
  } else if (req.method === 'editor') {
    bodyHtml += `<textarea class="ext-ui-dialog-editor" rows="8">${escapeHtml(req.prefill || '')}</textarea>
    <div class="ext-ui-dialog-actions">
      <button class="ext-ui-dialog-btn primary" data-action="submit">Submit</button>
      <button class="ext-ui-dialog-btn" data-action="cancel">Cancel</button>
    </div>`;
  }

  const titles: Readonly<Record<string, string>> = { select: 'Select', confirm: 'Confirm', input: 'Input', editor: 'Editor' };
  const title = req.title || titles[req.method] || 'Dialog';
  const events = new AbortController();
  const card = buildExtDialogCard(dialogKey, events, {
    title,
    bodyHtml,
    collapsedLabel: `${title} pending — click to answer`,
    onClose: () => sendExtDialogResponse(dialogKey, { cancelled: true }, card),
  });

  card.querySelectorAll<HTMLButtonElement>('.ext-ui-dialog-option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentCard(dialogKey, card)) return;
      const option = req.options[Number(btn.dataset.optionIndex)];
      sendExtDialogResponse(dialogKey, { value: option?.label || '' }, card);
    }, { signal: events.signal });
  });
  card.querySelectorAll<HTMLButtonElement>('.ext-ui-dialog-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentCard(dialogKey, card)) return;
      const action = btn.dataset.action;
      if (action === 'yes') sendExtDialogResponse(dialogKey, { confirmed: true }, card);
      else if (action === 'no') sendExtDialogResponse(dialogKey, { confirmed: false }, card);
      else if (action === 'cancel') sendExtDialogResponse(dialogKey, { cancelled: true }, card);
      else if (action === 'submit') {
        const field = card.querySelector<HTMLInputElement | HTMLTextAreaElement>('.ext-ui-dialog-input, .ext-ui-dialog-editor');
        sendExtDialogResponse(dialogKey, { value: field ? field.value : '' }, card);
      }
    }, { signal: events.signal });
  });

  const entry: DialogEntry = { el: card, events, endpoint: Object.freeze({ ...endpoint }), owner: sessionState.captureSelection(), sessionId, hostId, sessionKey: sessionKey(hostId, sessionId), requestId: req.id, minimized: false, sig: extDialogSig(req) };
  openExtDialogs.set(dialogKey, entry);
  dockExtDialog(entry);
  const field = card.querySelector<HTMLInputElement | HTMLTextAreaElement>('.ext-ui-dialog-input, .ext-ui-dialog-editor');
  if (field) field.focus();
}

// Remote /login step. A later step with the same loginId replaces this card in
// place (new request id); answers keep the card in a Submitting state until the
// bridge supersedes or resolves the step.
function showExtAuthDialog(req: ExtensionRequest, auth: ExtensionAuth, session: ExtensionSession) {
  if (!req.id) return;
  const { id: sessionId, host: hostId } = session;
  const endpoint = options.host(hostId); if (disposed || !endpoint) return;
  const dialogKey = extDialogKey(req.id, sessionId, hostId);
  const previous = openExtDialogs.get(dialogKey); if (previous && previous.endpoint.base !== endpoint.base) dismissExtDialog(dialogKey);
  const existing = openExtDialogs.get(dialogKey);
  if (existing) { dockExtDialog(existing); return; }
  const key = sessionKey(hostId, sessionId);
  const supersededKey = [...openExtDialogs.keys()].find(id => {
    const entry = openExtDialogs.get(id)!;
    return entry.sessionKey === key && entry.loginId === auth.loginId && entry.endpoint.base === endpoint.base;
  });
  const superseded = supersededKey ? openExtDialogs.get(supersededKey)! : null;
  const submittedKey = JSON.stringify([key, auth.loginId]);
  const submitted = authSubmitted.get(submittedKey) || new Set<string>();
  authSubmitted.set(submittedKey, submitted);
  const prompt = auth.prompt, expectedState = auth.url ? authUrlState(auth.url) : null;
  const canPaste = prompt?.kind === 'code' && typeof navigator.clipboard?.readText === 'function';

  let bodyHtml = '';
  if (req.message) bodyHtml += `<div class="ext-ui-dialog-message ext-ui-auth-status">${escapeHtml(req.message)}</div>`;
  if (auth.url) bodyHtml += `<div class="ext-ui-dialog-actions ext-ui-auth-link-row">
      <a class="ext-ui-dialog-btn primary ext-ui-auth-open" href="${escapeHtml(auth.url)}" target="_blank" rel="noopener noreferrer">Open sign-in page</a>
      <button class="ext-ui-dialog-btn" data-action="copy-link">Copy link</button>
    </div>`;
  if (auth.instructions) bodyHtml += `<div class="ext-ui-auth-instructions">${escapeHtml(auth.instructions)}</div>`;
  if (auth.userCode) bodyHtml += `<div class="ext-ui-auth-code-row">
      <code class="ext-ui-auth-user-code">${escapeHtml(auth.userCode)}</code>
      <button class="ext-ui-dialog-btn" data-action="copy-code">Copy</button>
    </div>`;
  if (prompt) {
    if (prompt.message) bodyHtml += `<div class="ext-ui-auth-prompt">${escapeHtml(prompt.message)}</div>`;
    if (prompt.kind === 'select') {
      if (prompt.options.length > 8) bodyHtml += '<input class="ext-ui-dialog-input ext-ui-auth-filter" type="text" placeholder="Filter…">';
      bodyHtml += '<div class="ext-ui-dialog-options">' + prompt.options.map((opt, i) => `<button class="ext-ui-dialog-option" data-option-index="${i}">
          <span class="ext-ui-ask-option-label">${escapeHtml(opt.label)}</span>${opt.description ? `<span class="ext-ui-ask-option-description">${escapeHtml(opt.description)}</span>` : ''}
        </button>`).join('') + '</div>';
    } else {
      bodyHtml += `<input class="ext-ui-dialog-input ext-ui-auth-input" type="${prompt.kind === 'secret' ? 'password' : 'text'}" autocomplete="off" placeholder="${escapeHtml(prompt.placeholder)}">
      <div class="ext-ui-dialog-actions">
        ${canPaste ? '<button class="ext-ui-dialog-btn" data-action="paste">Paste</button>' : ''}
        <button class="ext-ui-dialog-btn primary" data-action="submit">Submit</button>
      </div>`;
      // Host instructions already explain the paste fallback; otherwise say it here.
      if (prompt.kind === 'code' && !auth.instructions) bodyHtml += '<div class="ext-ui-auth-hint">Signing in on another device, like your phone? If sign-in ends on a page that won’t load, copy that page’s full address and paste it here.</div>';
    }
  } else if (auth.url || auth.userCode) bodyHtml += '<div class="ext-ui-auth-waiting">Waiting for sign-in to finish…</div>';
  bodyHtml += '<div class="ext-ui-auth-submitting" hidden>Submitting…</div>';

  const title = req.title || 'Log in';
  const events = new AbortController();
  const card = buildExtDialogCard(dialogKey, events, {
    title, bodyHtml, collapsedLabel: `${title} pending — click to continue`,
    onClose: () => sendExtDialogResponse(dialogKey, { cancelled: true }, card),
  });
  card.classList.add('ext-ui-auth-dialog');
  const input = card.querySelector<HTMLInputElement>('.ext-ui-auth-input');
  const setSubmitting = (busy: boolean) => {
    for (const control of card.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.ext-ui-dialog-body input, .ext-ui-dialog-body button')) control.disabled = busy;
    card.classList.toggle('submitting', busy);
    card.querySelector<HTMLElement>('.ext-ui-auth-submitting')!.hidden = !busy;
  };
  const submit = (value: string) => {
    const entry = openExtDialogs.get(dialogKey);
    if (!entry || !currentCard(dialogKey, card) || card.classList.contains('submitting')) return;
    const host = options.host(entry.hostId); if (!host || host.base !== entry.endpoint.base) return;
    const owner = entry.owner;
    submitted.add(value.trim());
    setSubmitting(true);
    void sendJson(options.request, Object.freeze({ ...host }), `/api/sessions/${encodeURIComponent(entry.sessionId)}/ui-response`, { requestId: entry.requestId, value })
      .catch(error => {
        if (openExtDialogs.get(dialogKey)?.el === card) setSubmitting(false);
        if (!disposed && sessionState.ownsSelection(owner)) options.status('Dialog response failed: ' + (error instanceof Error ? error.message : String(error)), 'error');
      });
  };
  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => options.toast('Copied', 'info'), () => options.toast('Copy failed', 'warning'));
  };
  // Fill from clipboard text; auto-submit only when it provably is this login's redirect.
  const usePasted = (raw: string, fillUnmatched: boolean) => {
    const value = raw.trim();
    if (!input || !value || submitted.has(value) || !currentCard(dialogKey, card) || card.classList.contains('submitting')) return;
    const matched = authCallbackMatches(parseAuthCallback(value), expectedState);
    if (!matched && !fillUnmatched) return;
    input.value = value;
    if (matched) submit(value);
  };

  card.querySelectorAll<HTMLButtonElement>('.ext-ui-dialog-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const option = prompt?.options[Number(btn.dataset.optionIndex)];
      if (option) submit(option.id);
    }, { signal: events.signal });
  });
  card.querySelector<HTMLInputElement>('.ext-ui-auth-filter')?.addEventListener('input', (e) => {
    const filter = (e.currentTarget as HTMLInputElement).value.trim().toLowerCase();
    card.querySelectorAll<HTMLButtonElement>('.ext-ui-dialog-option').forEach(btn => { btn.hidden = !!filter && !(btn.textContent || '').toLowerCase().includes(filter); });
  }, { signal: events.signal });
  card.querySelectorAll<HTMLButtonElement>('.ext-ui-dialog-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentCard(dialogKey, card)) return;
      const action = btn.dataset.action;
      if (action === 'copy-link') copy(auth.url);
      else if (action === 'copy-code') copy(auth.userCode);
      else if (action === 'submit' && input) submit(input.value);
      else if (action === 'paste') void navigator.clipboard.readText().then(text => usePasted(text, true), () => options.toast('Clipboard unavailable', 'warning'));
    }, { signal: events.signal });
  });
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(input.value); } }, { signal: events.signal });
  if (prompt?.kind === 'code') {
    const view = document.defaultView;
    const autoRead = () => {
      if (document.visibilityState !== 'visible' || !currentCard(dialogKey, card) || !view?.navigator.permissions || !navigator.clipboard?.readText) return;
      void view.navigator.permissions.query({ name: 'clipboard-read' as PermissionName })
        .then(status => status.state === 'granted' ? navigator.clipboard.readText().then(text => usePasted(text, false)) : undefined)
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', autoRead, { signal: events.signal });
    view?.addEventListener('focus', autoRead, { signal: events.signal });
  }

  const entry: DialogEntry = { el: card, events, endpoint: Object.freeze({ ...endpoint }), owner: sessionState.captureSelection(), sessionId, hostId, sessionKey: key,
    requestId: req.id, minimized: superseded?.minimized ?? false, sig: 'auth:' + req.id, loginId: auth.loginId, authKind: prompt?.kind || '' };
  let focus = !superseded;
  if (superseded && supersededKey) {
    const oldInput = superseded.el.querySelector<HTMLInputElement>('.ext-ui-auth-input');
    if (input && oldInput && superseded.authKind === entry.authKind) { input.value = oldInput.value; focus = superseded.el.contains(document.activeElement); }
    if (superseded.el.isConnected) { superseded.el.replaceWith(card); entry.owner = superseded.owner; }
    superseded.events.abort(); openExtDialogs.delete(supersededKey);
  }
  openExtDialogs.set(dialogKey, entry);
  dockExtDialog(entry);
  if (focus && !entry.minimized && card.isConnected) card.querySelector<HTMLElement>('.ext-ui-dialog-input, .ext-ui-dialog-option')?.focus();
}


  function removeSession(session: ExtensionSession) {
    const key = sessionKey(session.host, session.id);
    for (const [id, entry] of openExtDialogs) if (entry.sessionKey === key) dismissExtDialog(id);
  }
  return {
    show(request: ExtensionRequest, session: ExtensionSession) {
      if (disposed) return;
      if (request.method === 'ask') showExtAskDialog(request, session);
      else if (request.method === 'auth') { if (request.auth) showExtAuthDialog(request, request.auth, session); }
      else showExtDialog(request, session);
    },
    detach() { for (const entry of openExtDialogs.values()) { entry.el.remove(); entry.owner = null; } updateExtDialogDock(); },
    resolved(id: unknown, session: ExtensionSession) { if (typeof id === 'string') dismissExtDialog(extDialogKey(id, session.id, session.host)); },
    reconcile(value: unknown, session: ExtensionSession) {
      if (disposed || !record(value) || !Array.isArray(value.dialogs)) return;
      const pending = new Set(value.dialogs.filter((id): id is string => typeof id === 'string')), key = sessionKey(session.host, session.id);
      for (const [id, entry] of openExtDialogs) if (entry.sessionKey === key && !pending.has(entry.requestId)) dismissExtDialog(id);
    },
    removeSession,
    dispose() { disposed = true; for (const id of [...openExtDialogs.keys()]) dismissExtDialog(id); },
  };
}
