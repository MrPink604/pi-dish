import { formatTime } from './helper-format';
import { sessionRefKey } from './helper-identity';
import { record } from './helper-values';
import { sendJson } from './api-client';
import type { ApiRequest, HostEndpoint } from './api-client';
import type { SessionState } from './session-state';
import type { createComposerDrafts } from './composer-drafts';
import type { createPromptDelivery } from './prompt-delivery';
import type { createSessionActivity } from './session-activity';
import type { createBtwPanel } from './btw-panel';
import type { MessageBlock, RenderMessage } from './message-data';
import type { createSessionReferences } from './session-references';
export function createComposerSubmit(options: {
  document: Document; sessionState: SessionState; drafts: ReturnType<typeof createComposerDrafts>; delivery: ReturnType<typeof createPromptDelivery>;
  activity: ReturnType<typeof createSessionActivity>; btw: ReturnType<typeof createBtwPanel>; request: ApiRequest; endpoint: (host: string | null) => HostEndpoint;
  spawnId: () => string | null; spawnPending: () => boolean; refs: ReturnType<typeof createSessionReferences>['hints'];
  status: (text: string, type?: string) => void; openTree: () => void; hideAutocomplete: () => void; refresh: () => unknown;
  follow: () => void; scroll: (container: HTMLElement) => void; renderUser: (message: RenderMessage, time: string, attrs: string) => string;
}) {
  const { document, sessionState, delivery, drafts: composerDrafts, activity: sessionActivity, btw: btwPanel } = options;
  let disposed = false, feedbackSequence = 0;
  async function send(endpoint: HostEndpoint, path: string, body?: unknown) {
    const value = await sendJson(options.request, endpoint, path, body), data = record(value) ? value : {};
    return { info: typeof data.info === 'string' ? data.info : '', answer: typeof data.answer === 'string' ? data.answer : '', result: { queued: record(data.result) && data.result.queued === true } };
  }
async function sendPrompt() {
  const input = document.getElementById('promptInput') as HTMLTextAreaElement;
  if (disposed) return;
  const message = input.value.trim();
  if (options.spawnId()) {
    if (message || composerDrafts.images.current().length) {
      const starting = options.spawnPending();
      options.status(starting
        ? 'Pi is still starting — your prompt is saved'
        : 'Pi did not start — your prompt is preserved', starting ? 'working' : 'error');
    }
    return;
  }
  if ((!message && !composerDrafts.images.current().length) || !sessionState.currentSession) return;
  const owner = sessionState.captureSelection();
  if (!owner || disposed) return;
  const endpoint = Object.freeze({ ...options.endpoint(owner.host) }), sequence = ++feedbackSequence;
  const owns = () => !disposed && sequence === feedbackSequence && sessionState.ownsSelection(owner) && options.endpoint(owner.host).base === endpoint.base;
  const { id: sessionId } = owner;
  const ownerKey = sessionRefKey(owner);
  if (sessionActivity.isAborting(ownerKey)) {
    options.status('Wait for the current turn to finish stopping', 'working');
    return;
  }

  if (message === '/tree') { input.value = ''; options.openTree(); return; }
  options.hideAutocomplete();

  // Slash commands go to the command endpoint, never to the model as text.
  if (message.startsWith('/')) {
    // The bridge refuses a /compact while one runs (concurrent compactions
    // race pi's message rewrite); fail fast here too so the composer text
    // survives and the feedback is immediate.
    if (sessionActivity.compacting && /^\/compact(\s|$)/.test(message)) {
      options.status('Compaction already in progress', 'error');
      return;
    }
    input.value = '';
    input.style.height = '';
    composerDrafts.record(message, ownerKey);
    composerDrafts.clearDraft(ownerKey);
    options.status('Running ' + message.split(' ')[0] + '...', 'working');
    // /btw's answer rides the command response, not the transcript: show the
    // question panel immediately so a long side turn has visible pending UI.
    const btwQuestion = message.match(/^\/btw\s+([\s\S]*)$/)?.[1]?.trim();
    const btwOwner = btwQuestion ? btwPanel.show(btwQuestion) : null;
    try {
      const data = await send(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/command`, { message });
      if (disposed || !sessionState.ownsSelection(owner) || options.endpoint(owner.host).base !== endpoint.base) return;
      if (btwQuestion) {
        if (typeof data.answer === 'string' && data.answer) btwPanel.resolve(data.answer, btwOwner);
        else btwPanel.fail('(no answer)', btwOwner);
      }
      if (owns()) options.status(data.info || 'Done');
      options.refresh();
    } catch (error) {
    if (disposed) return; const e = { message: error instanceof Error ? error.message : String(error) };
      composerDrafts.restorePayload(ownerKey, message, null);
      if (btwQuestion && options.endpoint(owner.host).base === endpoint.base) btwPanel.fail(e.message, btwOwner);
      if (owns()) {
        options.status(`${message.split(' ')[0]}: ${e.message}`, 'error');
      }
    }
    return;
  }

  input.value = '';
  input.style.height = '';
  composerDrafts.record(message, ownerKey);
  composerDrafts.clearDraft(ownerKey);
  const images = composerDrafts.images.take();
  const refs = options.refs(message);
  options.status('Sending...', 'working');

  const container = document.getElementById('messages')!;
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  const optimisticContent: MessageBlock[] = [];
  if (message) optimisticContent.push({ type: 'text', text: message });
  for (const img of images || []) optimisticContent.push({ type: 'image', data: img.data, mimeType: img.mimeType });
  const clientPromptId = delivery.nextId();
  const template = document.createElement('template');
  template.innerHTML = options.renderUser({
    role: 'user', content: optimisticContent, timestamp: Date.now(), sessionRefs: refs,
  }, formatTime(Date.now()), ` data-client-prompt-id="${clientPromptId}"`);
  const optimisticElement = template.content.firstElementChild;
  if (optimisticElement) container.appendChild(optimisticElement);
  // Arm the echo suppressor: pi re-emits this prompt as a user message_end
  // when the turn starts, and we've already rendered it. '' is a valid value
  // (images-only prompt). The stable id also lets queue Edit remove exactly
  // this optimistic bubble even when several prompts have identical text.
  delivery.add(ownerKey, message, optimisticElement, clientPromptId);
  options.follow(); // sending means: follow the stream from here on
  options.scroll(container);

  sessionActivity.setTurn(true);

  try {
    const body: Record<string, unknown> = images ? { message, images } : { message };
    if (refs.length) body.refs = refs;
    const resp = await send(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/prompt`, body);
    if (!disposed) delivery.acknowledge(clientPromptId, !!resp.result?.queued);
    if (!owns()) return;
    if (resp?.result?.queued) {
      // Held by the bridge until compaction finishes; no turn is running yet.
      // Raise the compacting indicator before undoing the optimistic
      // "Working" badge so the turn-off path doesn't blank the strip/status.
      sessionActivity.setCompacting(true);
      sessionActivity.setTurn(false);
      options.status('Queued — will send when compaction finishes', 'working');
      delivery.render(delivery.queue);
    } else {
      options.status('Waiting for response...', 'working');
    }
  } catch (error) {
    if (disposed) return; const e = { message: error instanceof Error ? error.message : String(error) };
    delivery.discard(clientPromptId); // no echo is coming for a failed send
    composerDrafts.restorePayload(ownerKey, message, images);
    if (owns()) {
      options.status(`Error: ${e.message}`, 'error');
      sessionActivity.setTurn(false);
    }
  }
}

async function sendQueuedMessage(kind: 'steer' | 'followUp') {
  const steer = kind === 'steer';
  const input = document.getElementById('promptInput') as HTMLTextAreaElement;
  if (disposed) return;
  const message = input.value.trim();
  if (options.spawnId()) {
    if (message || composerDrafts.images.current().length) {
      const starting = options.spawnPending();
      options.status(starting
        ? 'Pi is still starting — your prompt is saved'
        : 'Pi did not start — your prompt is preserved', starting ? 'working' : 'error');
    }
    return;
  }
  if ((!message && !composerDrafts.images.current().length) || !sessionState.currentSession || !sessionState.currentSession.isActive) return;
  const owner = sessionState.captureSelection();
  if (!owner || disposed) return;
  const endpoint = Object.freeze({ ...options.endpoint(owner.host) }), sequence = ++feedbackSequence;
  const owns = () => !disposed && sequence === feedbackSequence && sessionState.ownsSelection(owner) && options.endpoint(owner.host).base === endpoint.base;
  const { id: sessionId } = owner;
  const ownerKey = sessionRefKey(owner);
  if (sessionActivity.isAborting(ownerKey)) {
    options.status('Wait for the current turn to finish stopping', 'working');
    return;
  }

  input.value = '';
  input.style.height = '';
  composerDrafts.record(message, ownerKey);
  composerDrafts.clearDraft(ownerKey);
  const images = composerDrafts.images.take();
  options.status(steer ? 'Steering...' : 'Queueing follow-up...', 'working');

  const body: Record<string, unknown> = steer ? { message } : { message, deliverAs: 'followUp' };
  if (images) body.images = images;
  const refs = options.refs(message);
  if (refs.length) body.refs = refs;
  try {
    const resp = await send(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}${steer ? '/steer' : '/prompt'}`, body);
    if (!owns()) return;
    if (resp?.result?.queued) options.status('Queued — will send when compaction finishes');
    else options.status(steer ? 'Steered' : 'Queued for after this turn');
  } catch (error) {
    if (disposed) return; const e = { message: error instanceof Error ? error.message : String(error) };
    composerDrafts.restorePayload(ownerKey, message, images);
    if (owns()) {
      options.status(`${steer ? 'Steer' : 'Follow-up'} failed: ${e.message}`, 'error');
    }
  }
}

function sendSteer() { return sendQueuedMessage('steer'); }
function sendFollowUp() { return sendQueuedMessage('followUp'); }

async function abortTurn() {
  if (disposed) return;
  // Compaction counts: the bridge cancels a running compaction on abort, and
  // its compaction_end (aborted) event clears the compacting indicator.
  if (!sessionState.currentSession || (!sessionActivity.turn && !sessionActivity.compacting)) return;
  const owner = sessionState.captureSelection();
  if (!owner || disposed) return;
  const endpoint = Object.freeze({ ...options.endpoint(owner.host) }), sequence = ++feedbackSequence;
  const owns = () => !disposed && sequence === feedbackSequence && sessionState.ownsSelection(owner) && options.endpoint(owner.host).base === endpoint.base;
  const { id: sessionId } = owner;
  const ownerKey = sessionRefKey(owner);
  if (sessionActivity.isAborting(ownerKey)) return;
  const abortOwner = sessionActivity.beginAbort(ownerKey);
  if (!abortOwner) return;
  options.status('Stopping...', 'working');
  try {
    await send(endpoint, '/api/sessions/' + encodeURIComponent(sessionId) + '/abort');
    // HTTP acknowledgement only means the abort request was accepted. Keep
    // the turn owned by the stream until turn_end/agent_end performs cleanup
    // and JSONL catch-up.
  } catch (error) {
    if (disposed) return; const e = { message: error instanceof Error ? error.message : String(error) };
    sessionActivity.endAbort(ownerKey, abortOwner);
    if (owns()) options.status('Stop failed: ' + e.message, 'error');
  }
}

return { sendPrompt, sendQueuedMessage, sendSteer, sendFollowUp, abortTurn, dispose() { disposed = true; feedbackSequence++; } };
}
