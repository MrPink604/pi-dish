import { formatTime } from './helper-format';
import { sessionRefKey } from './helper-identity';
import { record } from '../core/helper-values';
import { formatByteSize } from '../core/attachment-text';
import { errorMessage, jsonResponse, sendJson, type ApiRequest, type ApiUpload, type HostEndpoint } from './api-client';
import { isComposerFile, type ComposerAttachment, type ComposerFile, type ComposerImage } from './composer-images';
import { appendFileManifest, formatPromptForHistory, resolveAttachmentsForSend, type AttachmentRefDescriptor } from './composer-refs';
import type { SessionState } from './session-state';
import type { createComposerDrafts } from './composer-drafts';
import type { createPromptDelivery } from './prompt-delivery';
import type { createSessionActivity } from './session-activity';
import type { SideChatController } from './side-chat';
import type { MessageBlock, RenderMessage } from './message-data';
import type { createSessionReferences } from './session-references';
// OMP expands ^model in prompt(), which also carries steers; queued follow-ups
// and compaction-buffered prompts bypass it and would leave a literal token.
const OMP_MODEL_MENTION = /(?:^|\s)\^[^\s^]+(?=\s|$)/;
export function createComposerSubmit(options: {
  document: Document; sessionState: SessionState; drafts: ReturnType<typeof createComposerDrafts>; delivery: ReturnType<typeof createPromptDelivery>;
  activity: ReturnType<typeof createSessionActivity>; sideChat: SideChatController; request: ApiRequest; upload: ApiUpload; endpoint: (host: string | null) => HostEndpoint;
  spawnId: () => string | null; spawnPending: () => boolean; refs: ReturnType<typeof createSessionReferences>['hints'];
  status: (text: string, type?: string) => void; openTree: () => void; hideAutocomplete: () => void; refresh: () => unknown;
  openTasks?: () => void; openSubagents?: () => void; openSwarm?: () => void; hasSwarm?: () => boolean;
  /** The prompt resumed a hibernated session: reload the list and attach its live stream. */
  woke: (id: string, host: string | null) => unknown;
  follow: () => void; scroll: (container: HTMLElement) => void; renderUser: (message: RenderMessage, time: string, attrs: string) => string;
}) {
  const { document, sessionState, delivery, drafts: composerDrafts, activity: sessionActivity, sideChat } = options;
  let disposed = false, feedbackSequence = 0;
  async function send(endpoint: HostEndpoint, path: string, body?: unknown) {
    const value = await sendJson(options.request, endpoint, path, body), data = record(value) ? value : {};
    return { info: typeof data.info === 'string' ? data.info : '', result: { queued: record(data.result) && data.result.queued === true } };
  }
  function resolveSubmission(rawMessage: string, attachments: readonly ComposerAttachment[] | null) {
    let imageSeq = 0, fileSeq = 0;
    const descriptors: (AttachmentRefDescriptor & { readonly item: ComposerAttachment })[] = [];
    for (const item of attachments || []) {
      if (isComposerFile(item)) {
        fileSeq++;
        descriptors.push({ kind: 'file', refId: item.refId ?? fileSeq, name: item.name, item });
      } else {
        imageSeq++;
        descriptors.push({ kind: 'image', refId: item.refId ?? imageSeq, item });
      }
    }
    const resolved = resolveAttachmentsForSend(rawMessage, descriptors);
    const images: ComposerImage[] = resolved.images
      .filter((item): item is ComposerImage => !isComposerFile(item))
      .map(({ data, mimeType }) => ({ data, mimeType }));
    const files: ComposerFile[] = resolved.files.filter(isComposerFile);
    return {
      message: resolved.message,
      images,
      files,
      hasFileTokens: resolved.hasFileTokens,
      imageTokens: resolved.imageTokens,
    };
  }
  /**
   * Streams the non-image attachments to the owner's host and resolves to the
   * message naming them. Runs after the composer is cleared, so a failure
   * restores the whole payload, reports it and yields null.
   */
  async function withUploads(
    endpoint: HostEndpoint,
    sessionId: string,
    ownerKey: string,
    owns: () => boolean,
    rawMessage: string,
    resolvedMessage: string,
    hasFileTokens: boolean,
    files: readonly ComposerFile[],
    rawAttachments: readonly ComposerAttachment[] | null,
  ) {
    const path = `/api/sessions/${encodeURIComponent(sessionId)}/uploads`;
    const references: string[] = [];
    // Shown (and blocking another send) from the limit check on.
    const shown = composerDrafts.images.uploading(composerDrafts.ownerKey(ownerKey), files);
    try {
      const limits = await jsonResponse(await options.request(endpoint, path), 'this host cannot receive file attachments; update its pi-dish');
      const maxBytes = record(limits) && typeof limits.maxBytes === 'number' ? limits.maxBytes : Infinity;
      const oversized = files.find(file => file.size > maxBytes);
      if (oversized) throw new Error(`${oversized.name} is ${formatByteSize(oversized.size)}; this host accepts files up to ${formatByteSize(maxBytes)} (PI_DISH_UPLOAD_MAX_MB)`);
      for (const [index, file] of files.entries()) {
        if (owns()) options.status(`Uploading ${file.name}${files.length > 1 ? ` (${index + 1}/${files.length})` : ''}...`, 'working');
        const reply = await options.upload(endpoint, `${path}?${new URLSearchParams({ name: file.name, type: file.mimeType })}`, file.file, loaded => shown.progress(index, loaded));
        if (!record(reply) || typeof reply.reference !== 'string') throw new Error(`${file.name}: the host did not confirm the upload`);
        references.push(reply.reference);
      }
    } catch (error) {
      if (disposed) return null;
      composerDrafts.restorePayload(ownerKey, rawMessage, rawAttachments);
      if (owns()) options.status(`Upload failed: ${errorMessage(error)}`, 'error');
      return null;
    } finally { shown.done(); }
    return disposed ? null : appendFileManifest(resolvedMessage, references, hasFileTokens);
  }
  /** `/btw <q>` starts a side chat; plain text continues an open one. */
  function sideChatQuestion(message: string): { question: string; fresh: boolean } | 'usage' | null {
    const btw = /^\/btw(?:\s+([\s\S]*))?$/.exec(message);
    if (btw) {
      const question = (btw[1] || '').trim();
      return question ? { question, fresh: true } : 'usage';
    }
    if (message.startsWith('/')) return null;
    const chat = sideChat.active();
    return chat ? { question: message, fresh: false } : null;
  }
  async function askInSideChat(route: { question: string; fresh: boolean }, message: string, input: HTMLTextAreaElement, ownerKey: string, owns: () => boolean) {
    if (composerDrafts.images.current().length) {
      options.status('Side chat messages cannot include attachments', 'error');
      return;
    }
    input.value = '';
    input.style.height = '';
    composerDrafts.record(message, ownerKey);
    composerDrafts.clearDraft(ownerKey);
    options.hideAutocomplete();
    options.status(route.fresh ? 'Asking in side chat...' : 'Sending to side chat...', 'working');
    try {
      await sideChat.ask(route.question, { fresh: route.fresh });
      if (owns()) options.status('Asked in side chat');
    } catch (error) {
      if (disposed) return;
      composerDrafts.restorePayload(ownerKey, message, null);
      if (owns()) options.status(`Side chat: ${errorMessage(error)}`, 'error');
    }
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
  if (composerDrafts.images.isUploading(composerDrafts.ownerKey(ownerKey))) {
    options.status('Wait for the attachments to finish uploading', 'working');
    return;
  }
  // The side chat is independent of the main turn: /btw and follow-ups must
  // never be delivered as a prompt, steer, or slash command.
  const route = sideChatQuestion(message);
  if (route === 'usage') { options.status('usage: /btw <question>', 'error'); return; }
  if (route) { await askInSideChat(route, message, input, ownerKey, owns); return; }

  if (sessionState.currentSession.harnessId === 'omp' && OMP_MODEL_MENTION.test(message) && sessionActivity.compacting) {
    options.status('Wait for compaction to finish before mentioning a model', 'error');
    return;
  }
  if (message === '/tree') { input.value = ''; options.openTree(); return; }
  if (sessionState.currentSession.harnessId === 'agy') {
    const openLocalView = (open: (() => void) | undefined) => {
      if (!open) return false;
      input.value = '';
      input.style.height = '';
      composerDrafts.record(message, ownerKey);
      composerDrafts.clearDraft(ownerKey);
      options.hideAutocomplete();
      open();
      return true;
    };
    if (/^\/tasks$/i.test(message) && openLocalView(options.openTasks)) return;
    if (/^\/agents$/i.test(message) && openLocalView(options.openSubagents)) return;
    if ((/^\/swarm\s+board$/i.test(message) || (/^\/swarm$/i.test(message) && options.hasSwarm?.()))
      && openLocalView(options.openSwarm)) return;
  }
  options.hideAutocomplete();

  if (message.startsWith('/')) {
    // The bridge refuses a concurrent /compact; fail fast so the text survives.
    if (sessionActivity.compacting && /^\/compact(\s|$)/.test(message)) {
      options.status('Compaction already in progress', 'error');
      return;
    }
    input.value = '';
    input.style.height = '';
    composerDrafts.record(message, ownerKey);
    composerDrafts.clearDraft(ownerKey);
    options.status('Running ' + message.split(' ')[0] + '...', 'working');
    try {
      const data = await send(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/command`, { message });
      if (disposed || !sessionState.ownsSelection(owner) || options.endpoint(owner.host).base !== endpoint.base) return;
      if (owns()) options.status(data.info || 'Done');
      options.refresh();
    } catch (error) {
    if (disposed) return; const e = { message: errorMessage(error) };
      composerDrafts.restorePayload(ownerKey, message, null);
      if (owns()) {
        options.status(`${message.split(' ')[0]}: ${e.message}`, 'error');
      }
    }
    return;
  }

  input.value = '';
  input.style.height = '';
  const attachments = composerDrafts.images.take();
  composerDrafts.clearDraft(ownerKey);
  const resolved = resolveSubmission(message, attachments);
  const images = resolved.images;
  const refs = options.refs(resolved.message);
  const hibernated = !sessionState.currentSession.isActive && !!sessionState.currentSession.hibernation;
  // Without files the send stays synchronous up to the request, as before.
  const text = resolved.files.length
    ? await withUploads(endpoint, sessionId, ownerKey, owns, message, resolved.message, resolved.hasFileTokens, resolved.files, attachments)
    : resolved.message;
  if (text === null) return;
  const historyText = formatPromptForHistory(text, resolved.imageTokens);
  if (historyText) composerDrafts.record(historyText, ownerKey);
  // Uploads can outlast the selection; the prompt still goes to its owner, unseen.
  const visible = owns();
  if (visible) options.status(hibernated ? 'Resuming hibernated session...' : 'Sending...', 'working');

  const container = document.getElementById('messages')!;
  const clientPromptId = delivery.nextId();
  let optimisticElement: Element | null = null;
  if (visible) {
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    const optimisticContent: MessageBlock[] = [];
    if (text) optimisticContent.push({ type: 'text', text });
    for (const img of images) optimisticContent.push({ type: 'image', data: img.data, mimeType: img.mimeType });
    const template = document.createElement('template');
    template.innerHTML = options.renderUser({
      role: 'user', content: optimisticContent, timestamp: Date.now(), sessionRefs: refs,
    }, formatTime(Date.now()), ` data-client-prompt-id="${clientPromptId}"`);
    optimisticElement = template.content.firstElementChild;
    if (optimisticElement) container.appendChild(optimisticElement);
  }
  // pi re-emits this prompt as message_end when the turn starts; '' is valid
  // (images only). The stable id lets queue Edit remove exactly this bubble.
  delivery.add(ownerKey, text, optimisticElement, clientPromptId);
  if (visible) {
    options.follow();
    options.scroll(container);
    sessionActivity.setTurn(true);
  }

  try {
    const body: Record<string, unknown> = images.length ? { message: text, images } : { message: text };
    if (refs.length) body.refs = refs;
    const resp = await send(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/prompt`, body);
    if (!disposed) delivery.acknowledge(clientPromptId, !!resp.result?.queued);
    if (!owns()) return;
    if (hibernated) options.woke(owner.id, owner.host);
    if (resp?.result?.queued) {
      // Raise compacting before clearing the turn so the strip/status don't blank.
      sessionActivity.setCompacting(true);
      sessionActivity.setTurn(false);
      options.status('Queued — will send when compaction finishes', 'working');
      delivery.render(delivery.queue);
    }
  } catch (error) {
    if (disposed) return; const e = { message: errorMessage(error) };
    delivery.discard(clientPromptId);
    composerDrafts.restorePayload(ownerKey, message, attachments);
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
  if (composerDrafts.images.isUploading(composerDrafts.ownerKey(ownerKey))) {
    options.status('Wait for the attachments to finish uploading', 'working');
    return;
  }
  // Both Steer and Follow-up use this path, so an open side chat (or /btw)
  // must claim the text here before it becomes a steer or queued prompt.
  const route = sideChatQuestion(message);
  if (route === 'usage') { options.status('usage: /btw <question>', 'error'); return; }
  if (route) { await askInSideChat(route, message, input, ownerKey, owns); return; }

  if (sessionState.currentSession.harnessId === 'omp' && OMP_MODEL_MENTION.test(message) && (!steer || sessionActivity.compacting)) {
    options.status(steer ? 'Wait for compaction to finish before mentioning a model'
      : 'OMP model mentions cannot be queued as follow-ups; steer or send after this turn', 'error');
    return;
  }

  input.value = '';
  input.style.height = '';
  const attachments = composerDrafts.images.take();
  composerDrafts.clearDraft(ownerKey);
  const resolved = resolveSubmission(message, attachments);
  const images = resolved.images;
  const text = resolved.files.length
    ? await withUploads(endpoint, sessionId, ownerKey, owns, message, resolved.message, resolved.hasFileTokens, resolved.files, attachments)
    : resolved.message;
  if (text === null) return;
  const historyText = formatPromptForHistory(text, resolved.imageTokens);
  if (historyText) composerDrafts.record(historyText, ownerKey);
  if (owns()) options.status(steer ? 'Steering...' : 'Queueing follow-up...', 'working');

  const body: Record<string, unknown> = steer ? { message: text } : { message: text, deliverAs: 'followUp' };
  if (images.length) body.images = images;
  const refs = options.refs(resolved.message);
  if (refs.length) body.refs = refs;
  try {
    const resp = await send(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}${steer ? '/steer' : '/prompt'}`, body);
    if (!owns()) return;
    if (resp?.result?.queued) options.status('Queued — will send when compaction finishes');
    else options.status(steer ? 'Steered' : 'Queued for after this turn');
  } catch (error) {
    if (disposed) return; const e = { message: errorMessage(error) };
    composerDrafts.restorePayload(ownerKey, message, attachments);
    if (owns()) {
      options.status(`${steer ? 'Steer' : 'Follow-up'} failed: ${e.message}`, 'error');
    }
  }
}

function sendSteer() { return sendQueuedMessage('steer'); }
function sendFollowUp() { return sendQueuedMessage('followUp'); }

async function abortTurn() {
  if (disposed) return;
  // Abort also cancels a running compaction; its compaction_end clears the indicator.
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
    // HTTP ack only means accepted; the stream's turn_end/agent_end does cleanup.
  } catch (error) {
    if (disposed) return; const e = { message: errorMessage(error) };
    sessionActivity.endAbort(ownerKey, abortOwner);
    if (owns()) options.status('Stop failed: ' + e.message, 'error');
  }
}

return { sendPrompt, sendQueuedMessage, sendSteer, sendFollowUp, abortTurn, dispose() { disposed = true; feedbackSequence++; } };
}
