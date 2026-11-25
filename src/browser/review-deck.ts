import { escapeHtml } from '../core/helper-format';
import { record } from '../core/helper-values';
import { classifyOriginError, type OriginFailure } from './origin-reachability';
import { ApiHttpError, errorMessage, readJson, responseError, sameEndpoint, type ApiRequest, type HostEndpoint } from './api-client';
import { sessionKey } from './helper-identity';
import type { SelectionOwner, SessionState } from './session-state';
import {
  buildSubmitAnswers, decodeClientReview, decodeReviewList, firstMissingRequired, hydrateDraft,
  initialDraft, MAX_REJECT_REASON, REVIEW_CLIENT_HEADER, REVIEW_CLIENT_VALUE, reviewDelivery, reviewReceiptSummary,
  type ClientReview, type DraftAnswer, type ReviewCard, type ReviewMedia, type ReviewQuestion, type ReviewDraft, type ReviewStatus,
} from './review-deck-data';

export interface ReviewSessionRef { readonly id: string; readonly host: string | null }

interface ActiveOwner {
  readonly selection: SelectionOwner;
  readonly endpoint: Readonly<HostEndpoint>;
}

interface LightboxShot {
  readonly src: string | null;
  readonly load?: () => Promise<string | null>;
  readonly label: string;
  readonly alt: string;
}

interface LightboxState {
  readonly reviewId: string;
  readonly overlay: HTMLElement;
  readonly events: AbortController;
}

const DISMISS_ARM_MS = 4000;
const STATUS_RANK: Record<ReviewStatus, number> = {
  open: 0,
  cancelled: 1,
  dismissed: 2,
  rejected: 2,
  submitted: 2,
};
const DELIVERY_RANK: Record<string, number> = {
  pending: 0,
  delivering: 1,
  uncertain: 2,
  failed: 2,
  delivered: 3,
};

function isForwardReviewUpdate(existing: ClientReview | undefined, incoming: ClientReview): boolean {
  if (!existing) return true;
  if (STATUS_RANK[incoming.status] < STATUS_RANK[existing.status]) return false;
  if (STATUS_RANK[incoming.status] > STATUS_RANK[existing.status]) return true;
  if (existing.updatedAt !== null && incoming.updatedAt !== null && incoming.updatedAt < existing.updatedAt) {
    return false;
  }
  if (existing.status === incoming.status) {
    const curDelivery = reviewDelivery(existing);
    const nextDelivery = reviewDelivery(incoming);
    if (curDelivery || nextDelivery) {
      const curRank = DELIVERY_RANK[curDelivery?.state ?? ''] ?? -1;
      const nextRank = DELIVERY_RANK[nextDelivery?.state ?? ''] ?? -1;
      if (nextRank < curRank) return false;
      if (nextRank > curRank) return true;
      const curAt = curDelivery?.at ?? existing.submission?.submittedAt ?? existing.resolution?.resolvedAt ?? 0;
      const nextAt = nextDelivery?.at ?? incoming.submission?.submittedAt ?? incoming.resolution?.resolvedAt ?? 0;
      if (nextAt < curAt) return false;
    }
  }
  return true;
}

function sameOwner(left: ActiveOwner | null, right: ActiveOwner): boolean {
  return !!left
    && left.selection.id === right.selection.id
    && left.selection.host === right.selection.host
    && left.selection.generation === right.selection.generation
    && sameEndpoint(left.endpoint, right.endpoint);
}

/**
 * Inline staged review decks rendered directly in `#messages`.
 * One card at a time, preselected recommended defaults, lazy shots with
 * lightbox navigation, sessionStorage draft retention, Focus-mode visibility,
 * and automatic collapse to a 1-line receipt on submission.
 */
export function createReviewDecks(options: {
  document: Document;
  sessionState: SessionState;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  request: ApiRequest;
  host: (id: string | null) => HostEndpoint | null;
  /** Whether the host is known to lack `reviewsV1` (returns false only when definitely absent). */
  supports?: (host: HostEndpoint) => boolean;
  /** Whether the host advertises `reviewsDismissV1` (fail-closed: false hides Reject/Dismiss). */
  supportsDismiss?: (host: HostEndpoint) => boolean;
  /** Builds a browser-loadable URL for session-scoped media (includes peer `/hosts/<name>` and private unlock). */
  mediaUrl: (hostId: string | null, apiPath: string) => string;
  /** Builds a browser-loadable URL for `/page/<token>...` paths or `https://` URLs. */
  pageUrl: (hostId: string | null, rawUrl: string) => string;
  markdown: (text: string) => string;
  originFailure?: (failure: OriginFailure | null) => void;
  pinned?: (container: HTMLElement) => boolean;
  scroll?: (container: HTMLElement) => void;
}) {
  const { document, sessionState } = options;
  const store = options.storage ?? (() => { try { return sessionStorage; } catch { return null; } })();
  let disposed = false;
  let sessionAbort: AbortController | null = null;
  let activeOwner: ActiveOwner | null = null;
  const reviewsById = new Map<string, ClientReview>();
  const drafts = new Map<string, ReviewDraft>();
  const renderedKeys = new Map<string, string>();
  const mediaBlobs = new Map<string, { url: string; reviewId: string }>();
  const mediaLoads = new Map<string, Promise<string | null>>();
  const expandedReceipts = new Set<string>();
  const submitting = new Map<string, { action: 'submit' | 'reject' | 'dismiss'; token: number }>();
  let nextRequestToken = 1;
  const rejectOpen = new Set<string>();
  const rejectReasons = new Map<string, string>();
  let dismissArmedId: string | null = null;
  let dismissArmTimer: ReturnType<typeof setTimeout> | null = null;
  const errors = new Map<string, string>();
  let jumpBarEl: HTMLButtonElement | null = null;
  let scrollFrame: number | null = null;
  let lightbox: LightboxState | null = null;
  const domEvents = new AbortController();

  function canDismissForOwner(owner: ActiveOwner | null): boolean {
    return !!owner && !!options.supportsDismiss?.(owner.endpoint);
  }

  function syncDismissButton(reviewId: string, armed: boolean): void {
    const container = document.getElementById('messages');
    const deck = container ? deckElement(container, reviewId) : null;
    const btn = deck?.querySelector<HTMLButtonElement>('[data-review-action="dismiss"]');
    if (btn) {
      btn.classList.toggle('armed', armed);
      btn.setAttribute('aria-pressed', armed ? 'true' : 'false');
      if (submitting.get(reviewId)?.action !== 'dismiss') {
        btn.textContent = armed ? 'Dismiss? Tap again' : 'Dismiss';
      }
    }
    const review = reviewsById.get(reviewId);
    if (review && activeOwner) {
      renderedKeys.set(reviewId, deckRenderKey(activeOwner.selection.host, review));
    }
  }

  function disarmDismiss(updateDom = true): void {
    const prevId = dismissArmedId;
    if (dismissArmTimer !== null) {
      clearTimeout(dismissArmTimer);
      dismissArmTimer = null;
    }
    dismissArmedId = null;
    if (updateDom && prevId) syncDismissButton(prevId, false);
  }

  function clearTransientDeckState(reviewId: string): void {
    rejectOpen.delete(reviewId);
    rejectReasons.delete(reviewId);
    if (dismissArmedId === reviewId) disarmDismiss(false);
  }

  function draftStorageKey(hostId: string | null, sessionId: string, reviewId: string): string {
    return `pi-dish-review-draft:${sessionKey(hostId, sessionId)}:${reviewId}`;
  }

  function isPrivateSession(hostId: string | null, sessionId: string): boolean {
    const current = sessionState.currentSession;
    if (current && current.id === sessionId && (current.host || null) === hostId && current.private === true) {
      return true;
    }
    return sessionState.findSession(sessionId, hostId)?.private === true;
  }

  function loadDraft(hostId: string | null, review: ClientReview): ReviewDraft {
    const existing = drafts.get(review.id);
    if (existing) return existing;
    let parsed: unknown = null;
    if (!isPrivateSession(hostId, review.sessionId)) {
      try {
        const raw = store?.getItem(draftStorageKey(hostId, review.sessionId, review.id));
        if (raw) parsed = JSON.parse(raw);
      } catch {}
    }
    const draft = parsed ? hydrateDraft(review, parsed) : initialDraft(review);
    drafts.set(review.id, draft);
    return draft;
  }

  function saveDraft(hostId: string | null, review: ClientReview, draft: ReviewDraft): void {
    drafts.set(review.id, draft);
    if (isPrivateSession(hostId, review.sessionId)) return;
    try { store?.setItem(draftStorageKey(hostId, review.sessionId, review.id), JSON.stringify(draft)); } catch {}
  }

  function clearDraft(hostId: string | null, reviewId: string, sessionId: string): void {
    drafts.delete(reviewId);
    try { store?.removeItem(draftStorageKey(hostId, sessionId, reviewId)); } catch {}
  }

  function owns(owner: ActiveOwner): boolean {
    if (disposed || !sessionState.ownsSelection(owner.selection)) return false;
    return sameEndpoint(options.host(owner.selection.host), owner.endpoint);
  }

  function needsAuthMedia(endpoint: Readonly<HostEndpoint> | null | undefined): boolean {
    return Boolean(endpoint?.token);
  }

  function mediaCacheKey(reviewId: string, asset: number): string {
    return `${reviewId}:${asset}`;
  }

  function revokeReviewMedia(reviewId: string): void {
    if (lightbox?.reviewId === reviewId) closeLightbox();
    for (const [key, entry] of [...mediaBlobs.entries()]) {
      if (entry.reviewId !== reviewId) continue;
      try { URL.revokeObjectURL(entry.url); } catch {}
      mediaBlobs.delete(key);
    }
    for (const key of [...mediaLoads.keys()]) {
      if (key.startsWith(`${reviewId}:`)) mediaLoads.delete(key);
    }
  }

  function revokeAllMedia(): void {
    closeLightbox();
    for (const entry of mediaBlobs.values()) {
      try { URL.revokeObjectURL(entry.url); } catch {}
    }
    mediaBlobs.clear();
    mediaLoads.clear();
  }

  function ensureAuthMedia(owner: ActiveOwner, reviewId: string, sessionId: string, asset: number): Promise<string | null> {
    const key = mediaCacheKey(reviewId, asset);
    const cached = mediaBlobs.get(key);
    if (cached) return Promise.resolve(cached.url);
    const pending = mediaLoads.get(key);
    if (pending) return pending;
    const signal = sessionAbort?.signal;
    const promise: Promise<string | null> = (async () => {
      try {
        const apiPath = `/api/sessions/${encodeURIComponent(sessionId)}/reviews/${encodeURIComponent(reviewId)}/media/${asset}`;
        const response = await options.request(owner.endpoint, apiPath, signal ? { signal } : {});
        if (!response.ok) return null;
        const blob = await response.blob();
        if (disposed || !owns(owner) || !sameOwner(activeOwner, owner) || reviewsById.get(reviewId)?.status !== 'open') {
          return null;
        }
        const url = URL.createObjectURL(blob);
        const prev = mediaBlobs.get(key);
        if (prev) { try { URL.revokeObjectURL(prev.url); } catch {} }
        mediaBlobs.set(key, { url, reviewId });
        const container = document.getElementById('messages');
        if (container) {
          for (const img of container.querySelectorAll<HTMLImageElement>(`img[data-review-media-key="${CSS.escape(key)}"]`)) {
            if (img.src !== url) img.src = url;
          }
        }
        return url;
      } catch {
        return null;
      }
    })();
    mediaLoads.set(key, promise);
    void promise.finally(() => {
      if (mediaLoads.get(key) === promise) mediaLoads.delete(key);
    });
    return promise;
  }

  function hydrateAuthMedia(owner: ActiveOwner, review: ClientReview, cardIndex: number): void {
    if (!needsAuthMedia(owner.endpoint) || review.status !== 'open') return;
    const card = review.cards[cardIndex];
    if (!card) return;
    for (const item of card.media) {
      if (item.asset !== null) void ensureAuthMedia(owner, review.id, review.sessionId, item.asset);
    }
  }

  function shotUrl(hostId: string | null, review: ClientReview, media: ReviewMedia): string | null {
    if (media.asset !== null) {
      return options.mediaUrl(hostId, `/api/sessions/${encodeURIComponent(review.sessionId)}/reviews/${encodeURIComponent(review.id)}/media/${media.asset}`);
    }
    if (media.url) return options.pageUrl(hostId, media.url);
    return null;
  }

  function closeLightbox(): void {
    if (!lightbox) return;
    lightbox.events.abort();
    lightbox.overlay.remove();
    lightbox = null;
  }

  function openLightbox(reviewId: string, shots: readonly LightboxShot[], startIndex: number): void {
    if (disposed || !shots.length) return;
    closeLightbox();
    let index = Math.max(0, Math.min(startIndex, shots.length - 1));
    const events = new AbortController();
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay review-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Review image preview');

    const stage = document.createElement('div');
    stage.className = 'review-lightbox-stage';
    const image = document.createElement('img');
    image.className = 'review-lightbox-img';
    const bar = document.createElement('div');
    bar.className = 'review-lightbox-bar';
    const caption = document.createElement('span');
    caption.className = 'review-lightbox-caption';
    const nav = document.createElement('div');
    nav.className = 'review-lightbox-nav';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'btn btn-sm review-lightbox-btn';
    prev.setAttribute('aria-label', 'Previous image');
    prev.textContent = '‹';
    const counter = document.createElement('span');
    counter.className = 'review-lightbox-counter';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn btn-sm review-lightbox-btn';
    next.setAttribute('aria-label', 'Next image');
    next.textContent = '›';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-sm review-lightbox-btn';
    closeBtn.setAttribute('aria-label', 'Close image');
    closeBtn.textContent = '✕';

    const paint = () => {
      const targetIndex = index;
      const current = shots[targetIndex]!;
      image.alt = current.alt;
      caption.textContent = current.label || current.alt || '';
      counter.textContent = `${targetIndex + 1} / ${shots.length}`;
      prev.disabled = targetIndex <= 0;
      next.disabled = targetIndex >= shots.length - 1;
      if (current.src) {
        image.src = current.src;
      } else {
        image.removeAttribute('src');
        if (current.load) {
          void current.load().then(resolved => {
            if (resolved && overlay.isConnected && index === targetIndex) image.src = resolved;
          });
        }
      }
    };
    const step = (delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= shots.length) return;
      index = target;
      paint();
    };

    if (shots.length > 1) nav.append(prev, counter, next);
    nav.append(closeBtn);
    bar.append(caption, nav);
    stage.append(image, bar);
    overlay.append(stage);
    paint();

    prev.addEventListener('click', e => { e.stopPropagation(); step(-1); }, { signal: events.signal });
    next.addEventListener('click', e => { e.stopPropagation(); step(1); }, { signal: events.signal });
    closeBtn.addEventListener('click', e => { e.stopPropagation(); closeLightbox(); }, { signal: events.signal });
    stage.addEventListener('click', e => { if (e.target === stage) closeLightbox(); }, { signal: events.signal });
    overlay.addEventListener('click', e => { if (e.target === overlay) closeLightbox(); }, { signal: events.signal });
    document.addEventListener('keydown', e => {
      if (!overlay.isConnected) { closeLightbox(); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    }, { signal: events.signal });

    // Horizontal swipe on touch screens.
    let touchX: number | null = null;
    overlay.addEventListener('touchstart', e => { touchX = e.touches[0]?.clientX ?? null; }, { passive: true, signal: events.signal });
    overlay.addEventListener('touchend', e => {
      if (touchX === null) return;
      const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
      touchX = null;
      if (Math.abs(dx) >= 40) step(dx < 0 ? 1 : -1);
    }, { passive: true, signal: events.signal });

    lightbox = { reviewId, overlay, events };
    document.body.append(overlay);
  }

  function renderMediaHtml(hostId: string | null, review: ClientReview, card: ReviewCard, cardIndex: number): string {
    if (!card.media.length) return '';
    const single = card.media.length === 1;
    const authMedia = needsAuthMedia(activeOwner?.endpoint);
    const shots = card.media.map((item, shotIndex) => {
      const label = item.label || '';
      const alt = item.alt || item.label || `Shot ${shotIndex + 1}`;
      if (item.asset !== null && authMedia) {
        const key = mediaCacheKey(review.id, item.asset);
        const cached = mediaBlobs.get(key)?.url ?? null;
        return `<figure class="review-shot">
          <button type="button" class="review-shot-btn" data-review-action="lightbox" data-card-index="${cardIndex}" data-shot-index="${shotIndex}" aria-label="${escapeHtml(`Zoom ${alt}`)}">
            <img class="review-shot-img" data-review-media-key="${escapeHtml(key)}"${cached ? ` src="${escapeHtml(cached)}"` : ''} alt="${escapeHtml(alt)}" loading="lazy" decoding="async">
          </button>
          ${label ? `<figcaption class="review-shot-label">${escapeHtml(label)}</figcaption>` : ''}
        </figure>`;
      }
      const src = shotUrl(hostId, review, item);
      if (!src) return '';
      return `<figure class="review-shot">
        <button type="button" class="review-shot-btn" data-review-action="lightbox" data-card-index="${cardIndex}" data-shot-index="${shotIndex}" aria-label="${escapeHtml(`Zoom ${alt}`)}">
          <img class="review-shot-img" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">
        </button>
        ${label ? `<figcaption class="review-shot-label">${escapeHtml(label)}</figcaption>` : ''}
      </figure>`;
    }).filter(Boolean).join('');
    if (!shots) return '';
    return `<div class="${single ? 'review-media review-media-single' : 'review-media review-media-strip'}">${shots}</div>`;
  }

  function renderQuestionHtml(question: ReviewQuestion, answer: DraftAnswer, disabled: boolean): string {
    const dis = disabled ? ' disabled' : '';
    const whyHtml = 'why' in question && question.why
      ? `<div class="review-question-why">${escapeHtml(question.why)}</div>` : '';

    if (question.type === 'choice' || question.type === 'multi') {
      const isMulti = question.type === 'multi';
      const selectedValues = isMulti ? (Array.isArray(answer.value) ? answer.value : []) : [];
      const defaultValues = isMulti ? (Array.isArray(question.default) ? question.default : []) : [];
      const optionsHtml = question.options.map(option => {
        const selected = isMulti ? selectedValues.includes(option.value) : answer.value === option.value;
        const isDefault = isMulti ? defaultValues.includes(option.value) : question.default === option.value;
        const marker = isMulti ? (selected ? '☑' : '☐') : (selected ? '●' : '○');
        return `<button type="button" class="ext-ui-dialog-option ext-ui-ask-option review-option${selected ? ' selected' : ''}"
          data-review-action="${isMulti ? 'toggle-multi' : 'pick-choice'}" data-question-id="${escapeHtml(question.id)}" data-value="${escapeHtml(option.value)}"
          aria-pressed="${selected ? 'true' : 'false'}"${dis}>
          <span class="ext-ui-ask-marker" aria-hidden="true">${marker}</span>
          <span class="ext-ui-ask-option-copy">
            <span class="ext-ui-ask-option-label">${escapeHtml(option.label)}${isDefault ? '<span class="ext-ui-ask-recommended">Recommended</span>' : ''}</span>
            ${option.description ? `<span class="ext-ui-ask-option-description">${escapeHtml(option.description)}</span>` : ''}
          </span>
        </button>`;
      }).join('');
      const disclosureLabel = question.allowOther
        ? (answer.noteOpen ? '− Hide other / note' : '+ Other / add note')
        : (answer.noteOpen ? '− Hide note' : '+ Add note');
      const notePanel = `<div class="review-disclosure" ${answer.noteOpen ? '' : 'hidden'}>
        ${question.allowOther ? `<label class="review-field-label">Other / punt<input type="text" class="review-input" data-review-input="other" data-question-id="${escapeHtml(question.id)}" value="${escapeHtml(answer.other)}" placeholder="Suggest another option or punt…"${dis}></label>` : ''}
        <label class="review-field-label">Note (optional)<input type="text" class="review-input" data-review-input="note" data-question-id="${escapeHtml(question.id)}" value="${escapeHtml(answer.note)}" placeholder="Extra detail for the agent…"${dis}></label>
      </div>`;
      return `<div class="review-question" data-question-id="${escapeHtml(question.id)}">
        <div class="review-question-prompt">${escapeHtml(question.prompt)}</div>
        ${whyHtml}
        <div class="review-options" role="${isMulti ? 'group' : 'radiogroup'}" aria-label="${escapeHtml(question.prompt)}">${optionsHtml}</div>
        <button type="button" class="review-disclosure-toggle" data-review-action="toggle-note" data-question-id="${escapeHtml(question.id)}" aria-expanded="${answer.noteOpen ? 'true' : 'false'}"${dis}>${disclosureLabel}</button>
        ${notePanel}
      </div>`;
    }

    if (question.type === 'approve') {
      const renderChoice = (val: 'approve' | 'revise', label: string) => {
        const selected = answer.value === val;
        const isDefault = question.default === val;
        return `<button type="button" class="ext-ui-dialog-option ext-ui-ask-option review-option review-approve-btn${selected ? ' selected' : ''}"
          data-review-action="pick-approve" data-question-id="${escapeHtml(question.id)}" data-value="${val}"
          aria-pressed="${selected ? 'true' : 'false'}"${dis}>
          <span class="ext-ui-ask-marker" aria-hidden="true">${selected ? '●' : '○'}</span>
          <span class="ext-ui-ask-option-copy">
            <span class="ext-ui-ask-option-label">${escapeHtml(label)}${isDefault ? '<span class="ext-ui-ask-recommended">Recommended</span>' : ''}</span>
          </span>
        </button>`;
      };
      const disclosureLabel = answer.noteOpen ? '− Hide note' : '+ Add note';
      return `<div class="review-question" data-question-id="${escapeHtml(question.id)}">
        <div class="review-question-prompt">${escapeHtml(question.prompt)}</div>
        ${whyHtml}
        <div class="review-approve-row" role="radiogroup" aria-label="${escapeHtml(question.prompt)}">
          ${renderChoice('approve', question.approveLabel)}
          ${renderChoice('revise', question.reviseLabel)}
        </div>
        <button type="button" class="review-disclosure-toggle" data-review-action="toggle-note" data-question-id="${escapeHtml(question.id)}" aria-expanded="${answer.noteOpen ? 'true' : 'false'}"${dis}>${disclosureLabel}</button>
        <div class="review-disclosure" ${answer.noteOpen ? '' : 'hidden'}>
          <label class="review-field-label">Note (optional)<input type="text" class="review-input" data-review-input="note" data-question-id="${escapeHtml(question.id)}" value="${escapeHtml(answer.note)}" placeholder="Changes or notes…"${dis}></label>
        </div>
      </div>`;
    }

    if (question.type !== 'text') return '';
    // Text question
    const value = typeof answer.value === 'string' ? answer.value : '';
    return `<div class="review-question" data-question-id="${escapeHtml(question.id)}">
      <label class="review-question-prompt" for="review-q-${escapeHtml(question.id)}">${escapeHtml(question.prompt)}${question.required ? ' <span class="review-required-tag">required</span>' : ''}</label>
      <textarea id="review-q-${escapeHtml(question.id)}" class="review-textarea" rows="2" data-review-input="text" data-question-id="${escapeHtml(question.id)}" placeholder="${escapeHtml(question.placeholder || 'Write a short answer…')}"${dis}>${escapeHtml(value)}</textarea>
    </div>`;
  }

  function deliveryBadgeHtml(review: ClientReview): string {
    const delivery = reviewDelivery(review);
    const state = delivery?.state;
    if (!state || state === 'delivered') return '';
    if (state === 'pending' || state === 'delivering') return '<span class="badge review-delivery-badge pending">sending…</span>';
    const title = delivery?.error ? ` title="${escapeHtml(delivery.error)}"` : '';
    return `<span class="badge review-delivery-badge warn"${title}>${escapeHtml(state)}</span>`;
  }

  function renderReceiptBodyHtml(review: ClientReview): string {
    const submission = review.submission;
    if (!submission) return '';
    const rows: string[] = [];
    for (const card of review.cards) {
      for (const question of card.questions) {
        const answer = submission.answers[question.id];
        if (!answer) continue;
        const valText = answer.value === null
          ? (answer.other ? '' : '(no answer)')
          : Array.isArray(answer.value) ? (answer.value.length ? answer.value.join(', ') : '(none)') : answer.value;
        const tag = answer.default ? '<span class="review-receipt-tag">default</span>'
          : submission.changed.includes(question.id) ? '<span class="review-receipt-tag changed">changed</span>' : '';
        const parts: string[] = [];
        if (valText) parts.push(`<span>${escapeHtml(valText)}</span>`);
        if (answer.other) parts.push(`<span class="review-receipt-other">other: ${escapeHtml(answer.other)}</span>`);
        if (answer.note) parts.push(`<span class="review-receipt-note">note: ${escapeHtml(answer.note)}</span>`);
        rows.push(`<div class="review-receipt-row"><dt>${escapeHtml(question.prompt)}${tag}</dt><dd>${parts.join(' ')}</dd></div>`);
      }
    }
    const deliveryNote = submission.delivery.error
      ? `<div class="review-receipt-delivery-note">${escapeHtml(submission.delivery.error)}</div>` : '';
    return `<div class="review-receipt-body"><dl class="review-receipt-list">${rows.join('')}</dl>${deliveryNote}</div>`;
  }

  function renderDeckInnerHtml(hostId: string | null, review: ClientReview): string {
    if (review.status === 'cancelled') {
      return `<div class="review-receipt-line">
        <span class="review-icon muted" aria-hidden="true">✕</span>
        <span class="review-receipt-title">Review withdrawn · ${escapeHtml(review.title)}</span>
      </div>`;
    }

    if (review.status === 'rejected' || review.status === 'dismissed') {
      const isRejected = review.status === 'rejected';
      const reason = isRejected ? (review.resolution?.reason || '') : '';
      const deliveryError = review.resolution?.delivery.error || '';
      const pageLink = review.companionPage
        ? `<a class="review-page-link" href="${escapeHtml(options.pageUrl(hostId, review.companionPage))}" target="_blank" rel="noopener noreferrer">Full ↗</a>` : '';
      return `<div class="review-receipt-line">
        <span class="review-icon ${isRejected ? 'rejected' : 'muted'}" aria-hidden="true">${isRejected ? '✕' : '–'}</span>
        <span class="review-receipt-copy">
          <span class="review-receipt-title">${isRejected ? 'Rejected' : 'Dismissed'} · ${escapeHtml(review.title)}</span>
          ${isRejected
            ? (reason ? `<span class="review-receipt-reason">${escapeHtml(reason)}</span>` : '<span class="review-receipt-meta">No answers sent</span>')
            : '<span class="review-receipt-meta">Declined to answer</span>'}
        </span>
        ${deliveryBadgeHtml(review)}
        ${pageLink}
      </div>
      ${deliveryError ? `<div class="review-receipt-delivery-note review-receipt-delivery-inline">${escapeHtml(deliveryError)}</div>` : ''}`;
    }

    if (review.status === 'submitted') {
      const open = expandedReceipts.has(review.id);
      const pageLink = review.companionPage
        ? `<a class="review-page-link" href="${escapeHtml(options.pageUrl(hostId, review.companionPage))}" target="_blank" rel="noopener noreferrer">Full ↗</a>` : '';
      return `<div class="review-receipt-line">
        <span class="review-icon done" aria-hidden="true">✓</span>
        <span class="review-receipt-copy">
          <span class="review-receipt-title">Reviewed ${escapeHtml(review.title)}</span>
          <span class="review-receipt-meta">${escapeHtml(reviewReceiptSummary(review))}</span>
        </span>
        ${deliveryBadgeHtml(review)}
        ${pageLink}
        <button type="button" class="btn btn-sm review-toggle-receipt" data-review-action="toggle-receipt" aria-expanded="${open ? 'true' : 'false'}">${open ? 'Hide' : 'Show'}</button>
      </div>
      ${open ? renderReceiptBodyHtml(review) : ''}`;
    }

    const draft = loadDraft(hostId, review);
    const pendingAction = submitting.get(review.id)?.action ?? null;
    const busy = pendingAction !== null;
    const error = errors.get(review.id) || '';
    const total = review.cards.length;
    const current = Math.max(0, Math.min(draft.cardIndex, total - 1));
    draft.cardIndex = current;
    const card = review.cards[current]!;
    const canDismiss = canDismissForOwner(activeOwner);
    const isRejectOpen = canDismiss && rejectOpen.has(review.id);
    const isDismissArmed = canDismiss && dismissArmedId === review.id;
    const rejectReason = rejectReasons.get(review.id) ?? '';
    const pageLink = review.companionPage
      ? `<a class="review-page-link" href="${escapeHtml(options.pageUrl(hostId, review.companionPage))}" target="_blank" rel="noopener noreferrer">Full ↗</a>` : '';
    const dots = total > 1
      ? `<div class="review-dots" role="tablist" aria-label="Review cards">${review.cards.map((item, idx) =>
        `<button type="button" class="review-dot${idx === current ? ' active' : idx < current ? ' visited' : ''}" role="tab" aria-selected="${idx === current ? 'true' : 'false'}" data-review-action="jump-card" data-card-index="${idx}" title="${escapeHtml(`Card ${idx + 1}: ${item.title}`)}" aria-label="${escapeHtml(`Card ${idx + 1} of ${total}: ${item.title}`)}"${busy ? ' disabled' : ''}></button>`).join('')}</div>`
      : '';

    const cardsHtml = review.cards.map((item, idx) => {
      const hiddenAttr = idx === current ? '' : ' hidden';
      const questionsHtml = item.questions.map(q => renderQuestionHtml(q, draft.answers[q.id]!, busy)).join('');
      return `<div class="review-card" data-card-index="${idx}"${hiddenAttr}>
        <div class="review-context markdown-body">${options.markdown(item.context)}</div>
        ${renderMediaHtml(hostId, review, item, idx)}
        <div class="review-questions">${questionsHtml}</div>
      </div>`;
    }).join('');

    const isFirst = current === 0;
    const isLast = current === total - 1;
    const canQuickSubmit = !isLast && !firstMissingRequired(review, draft);

    return `<div class="review-head">
      <div class="review-head-top">
        <span class="review-icon open" aria-hidden="true">◆</span>
        <span class="review-title">${escapeHtml(review.title)}</span>
        ${pageLink}
      </div>
      <div class="review-step-row">
        ${dots}
        <span class="review-step-label">${total > 1 ? `Card ${current + 1} of ${total}: ` : ''}${escapeHtml(card.title)}</span>
      </div>
    </div>
    <div class="review-body">${cardsHtml}</div>
    ${error ? `<div class="review-error" role="alert">${escapeHtml(error)}</div>` : ''}
    <div class="review-foot">
      <div class="review-foot-main">
        ${!isFirst ? `<button type="button" class="btn btn-sm review-back-btn" data-review-action="prev-card"${busy ? ' disabled' : ''}>← Back</button>` : '<span></span>'}
        <div class="review-foot-right">
          ${canQuickSubmit ? `<button type="button" class="btn btn-sm" data-review-action="submit"${busy ? ' disabled' : ''}>${pendingAction === 'submit' ? 'Sending…' : 'Accept defaults'}</button>` : ''}
          ${!isLast
            ? `<button type="button" class="btn btn-sm btn-primary" data-review-action="next-card"${busy ? ' disabled' : ''}>Next →</button>`
            : `<button type="button" class="btn btn-sm btn-primary" data-review-action="submit"${busy ? ' disabled' : ''}>${pendingAction === 'submit' ? 'Sending…' : 'Submit'}</button>`}
        </div>
      </div>
      ${canDismiss ? `<div class="review-foot-secondary">
        <button type="button" class="btn btn-sm review-secondary-btn review-dismiss-btn${isDismissArmed ? ' armed' : ''}" data-review-action="dismiss" aria-pressed="${isDismissArmed ? 'true' : 'false'}"${busy ? ' disabled' : ''}>${pendingAction === 'dismiss' ? 'Dismissing…' : isDismissArmed ? 'Dismiss? Tap again' : 'Dismiss'}</button>
        <button type="button" class="btn btn-sm review-secondary-btn review-reject-btn${isRejectOpen ? ' active' : ''}" data-review-action="open-reject" aria-expanded="${isRejectOpen ? 'true' : 'false'}"${busy ? ' disabled' : ''}>Reject…</button>
      </div>` : ''}
      ${isRejectOpen ? `<div class="review-reject-panel">
        <label class="review-reject-label" for="review-reject-${escapeHtml(review.id)}">
          <span>Reject proposal — optional reason</span>
          <span class="review-reject-count" data-review-reject-count="${escapeHtml(review.id)}">${rejectReason.length}/${MAX_REJECT_REASON}</span>
        </label>
        <textarea id="review-reject-${escapeHtml(review.id)}" class="review-textarea review-reject-input" rows="2" maxlength="${MAX_REJECT_REASON}" data-review-input="reject-reason" placeholder="Why not? (optional, max ${MAX_REJECT_REASON} chars)…"${busy ? ' disabled' : ''}>${escapeHtml(rejectReason)}</textarea>
        <div class="review-reject-actions">
          <button type="button" class="btn btn-sm review-secondary-btn" data-review-action="cancel-reject"${busy ? ' disabled' : ''}>Cancel</button>
          <button type="button" class="btn btn-sm review-danger-btn" data-review-action="confirm-reject"${busy ? ' disabled' : ''}>${pendingAction === 'reject' ? 'Rejecting…' : 'Confirm reject'}</button>
        </div>
      </div>` : ''}
    </div>`;
  }

  function deckElement(container: HTMLElement, reviewId: string): HTMLElement | null {
    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement && child.classList.contains('review-deck') && child.dataset.reviewId === reviewId) return child;
    }
    return null;
  }

  function topLevel(container: HTMLElement, node: Element): HTMLElement {
    let cur: Element = node;
    while (cur.parentElement && cur.parentElement !== container) cur = cur.parentElement;
    return cur as HTMLElement;
  }

  function placeDeck(container: HTMLElement, el: HTMLElement, review: ClientReview): boolean {
    const indexed = Array.from(container.querySelectorAll<HTMLElement>('[data-msg-index]'));
    if (review.anchorMessageIndex !== null && indexed.length) {
      const exact = container.querySelector<HTMLElement>(`[data-msg-index="${review.anchorMessageIndex}"]`);
      if (exact) {
        let anchor: Element = topLevel(container, exact);
        // Keep multiple decks anchored to the same message in creation order.
        while (anchor.nextElementSibling?.classList.contains('review-deck') && anchor.nextElementSibling !== el) {
          const siblingId = (anchor.nextElementSibling as HTMLElement).dataset.reviewId || '';
          const sibling = reviewsById.get(siblingId);
          if (!sibling || sibling.anchorMessageIndex !== review.anchorMessageIndex || sibling.createdAt > review.createdAt) break;
          anchor = anchor.nextElementSibling;
        }
        if (el.previousElementSibling !== anchor) anchor.after(el);
        return true;
      }
      const indices = indexed.map(node => Number.parseInt(node.dataset.msgIndex || '', 10)).filter(Number.isFinite);
      const oldest = indices.length ? Math.min(...indices) : null;
      // Non-open reviews anchored in unloaded older history wait until that window is paged in.
      if (review.status !== 'open' && oldest !== null && review.anchorMessageIndex < oldest) {
        el.remove();
        return false;
      }
    }
    if (el.parentElement !== container) container.appendChild(el);
    return true;
  }

  function deckRenderKey(hostId: string | null, review: ClientReview): string {
    if (review.status === 'cancelled') return `cancelled|${review.title}`;
    if (review.status === 'rejected' || review.status === 'dismissed') {
      return JSON.stringify([
        review.status, hostId ?? '', review.title, review.companionPage ?? '',
        review.resolution?.id ?? '', review.resolution?.reason ?? '',
        review.resolution?.delivery.state ?? '', review.resolution?.delivery.error ?? '',
      ]);
    }
    if (review.status === 'submitted') {
      return JSON.stringify([
        'submitted', hostId ?? '', review.title, review.companionPage ?? '',
        review.submission?.id ?? '', review.submission?.delivery.state ?? '', review.submission?.delivery.error ?? '',
        expandedReceipts.has(review.id),
      ]);
    }
    const draft = loadDraft(hostId, review);
    const questionState = review.cards.flatMap(card => card.questions.map(question => {
      const entry = draft.answers[question.id];
      if (!entry || question.type === 'text') return [question.id];
      return [question.id, entry.value, entry.noteOpen];
    }));
    const canDismiss = canDismissForOwner(activeOwner);
    return JSON.stringify([
      'open', hostId ?? '', review.title, review.companionPage ?? '', review.cards.length,
      draft.cardIndex, submitting.get(review.id)?.action ?? '', errors.get(review.id) ?? '',
      canDismiss, canDismiss && rejectOpen.has(review.id), canDismiss && dismissArmedId === review.id,
      questionState,
    ]);
  }

  function renderOne(container: HTMLElement, review: ClientReview, force = false): void {
    const owner = activeOwner;
    const hostId = owner?.selection.host ?? null;
    let el = deckElement(container, review.id);
    const created = !el;
    if (!el) {
      el = document.createElement('section');
      el.className = 'review-deck';
      el.dataset.reviewId = review.id;
      el.setAttribute('aria-label', `Review: ${review.title}`);
    }
    el.dataset.reviewStatus = review.status;
    el.classList.toggle('is-open', review.status === 'open');
    el.classList.toggle('is-submitted', review.status === 'submitted');
    el.classList.toggle('is-rejected', review.status === 'rejected');
    el.classList.toggle('is-dismissed', review.status === 'dismissed');
    el.classList.toggle('is-cancelled', review.status === 'cancelled');
    if (!placeDeck(container, el, review)) {
      renderedKeys.delete(review.id);
      revokeReviewMedia(review.id);
      return;
    }
    if (review.status !== 'open') revokeReviewMedia(review.id);
    const key = deckRenderKey(hostId, review);
    if (!force && !created && el.childElementCount > 0 && renderedKeys.get(review.id) === key) {
      return;
    }
    el.innerHTML = renderDeckInnerHtml(hostId, review);
    renderedKeys.set(review.id, key);
    if (owner && review.status === 'open') {
      const draft = loadDraft(hostId, review);
      hydrateAuthMedia(owner, review, draft.cardIndex);
    }
  }

  function syncJumpBar(): void {
    if (disposed) return;
    const container = document.getElementById('messages');
    const openReviews = [...reviewsById.values()].filter(review => review.status === 'open');
    if (!container || !openReviews.length || !activeOwner || !owns(activeOwner)) {
      jumpBarEl?.remove();
      jumpBarEl = null;
      return;
    }
    const target = openReviews[0]!;
    const deck = deckElement(container, target.id);
    if (!deck) {
      jumpBarEl?.remove();
      jumpBarEl = null;
      return;
    }
    const viewRect = container.getBoundingClientRect();
    const deckRect = deck.getBoundingClientRect();
    const visible = viewRect.height > 0 && deckRect.bottom > viewRect.top + 24 && deckRect.top < viewRect.bottom - 24;
    if (visible) {
      jumpBarEl?.remove();
      jumpBarEl = null;
      return;
    }
    const inputArea = document.querySelector<HTMLElement>('.input-area');
    if (!inputArea) return;
    if (!jumpBarEl || !jumpBarEl.isConnected) {
      jumpBarEl = document.createElement('button');
      jumpBarEl.type = 'button';
      jumpBarEl.className = 'review-jump-bar';
      jumpBarEl.addEventListener('click', () => {
        const currentOpen = [...reviewsById.values()].find(review => review.status === 'open');
        if (!currentOpen) return;
        const msgRoot = document.getElementById('messages');
        const el = msgRoot ? deckElement(msgRoot, currentOpen.id) : null;
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, { signal: domEvents.signal });
      inputArea.insertBefore(jumpBarEl, inputArea.firstChild);
    }
    const draft = loadDraft(activeOwner.selection.host, target);
    const arrow = deckRect.top < viewRect.top ? '↑' : '↓';
    const progress = target.cards.length > 1 ? ` (${draft.cardIndex + 1}/${target.cards.length})` : '';
    jumpBarEl.textContent = `◆ Review open: ${target.title}${progress} · Jump ${arrow}`;
  }

  function scheduleJumpBar(): void {
    if (scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      syncJumpBar();
    });
  }

  function sync(container: HTMLElement | null = document.getElementById('messages')): void {
    if (disposed || !container || container.id !== 'messages') return;
    if (!activeOwner || !owns(activeOwner)) return;
    const validIds = new Set(reviewsById.keys());
    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement && child.classList.contains('review-deck')) {
        const id = child.dataset.reviewId || '';
        if (!validIds.has(id)) {
          child.remove();
          renderedKeys.delete(id);
          if (id) revokeReviewMedia(id);
        }
      }
    }
    const ordered = [...reviewsById.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const review of ordered) renderOne(container, review);
    syncJumpBar();
  }

  async function submitReview(reviewId: string): Promise<void> {
    if (disposed || !activeOwner || !owns(activeOwner) || submitting.has(reviewId)) return;
    const review = reviewsById.get(reviewId);
    if (!review || review.status !== 'open') return;
    const captured = activeOwner;
    const draft = loadDraft(captured.selection.host, review);
    const missing = firstMissingRequired(review, draft);
    if (missing) {
      draft.cardIndex = missing.cardIndex;
      saveDraft(captured.selection.host, review, draft);
      errors.set(reviewId, missing.message);
      sync();
      return;
    }

    // Persist submissionId before sending (including untouched "Accept defaults") so reload retries stay idempotent.
    saveDraft(captured.selection.host, review, draft);
    disarmDismiss();
    errors.delete(reviewId);
    const token = nextRequestToken++;
    submitting.set(reviewId, { action: 'submit', token });
    sync();
    try {
      const response = await options.request(
        captured.endpoint,
        `/api/sessions/${encodeURIComponent(review.sessionId)}/reviews/${encodeURIComponent(review.id)}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [REVIEW_CLIENT_HEADER]: REVIEW_CLIENT_VALUE },
          body: JSON.stringify({ submissionId: draft.submissionId, answers: buildSubmitAnswers(review, draft) }),
        },
      );
      const data = await readJson(response);
      if (!owns(captured)) return;
      if (response.ok) {
        const updated = decodeClientReview(record(data) ? data.review : null);
        if (!updated) {
          errors.set(reviewId, 'Unexpected response from server — your draft is saved; retry or reload.');
          return;
        }
        clearDraft(captured.selection.host, review.id, review.sessionId);
        clearTransientDeckState(review.id);
        errors.delete(reviewId);
        if (isForwardReviewUpdate(reviewsById.get(updated.id), updated)) {
          reviewsById.set(updated.id, updated);
        }
        return;
      }
      if (response.status === 409 && record(data)) {
        const serverReview = decodeClientReview(data.review);
        if (serverReview && serverReview.status !== 'open') {
          clearDraft(captured.selection.host, review.id, review.sessionId);
          clearTransientDeckState(review.id);
          errors.delete(reviewId);
          if (isForwardReviewUpdate(reviewsById.get(serverReview.id), serverReview)) {
            reviewsById.set(serverReview.id, serverReview);
          }
          return;
        }
      }
      if (response.status === 401 || response.status === 403) {
        if (captured.endpoint.base === '') options.originFailure?.('auth');
        const detail = responseError(response, data, '');
        errors.set(reviewId, detail && !/HTTP 40[13]/.test(detail)
          ? `${detail} (your draft is saved)`
          : 'Sign-in expired — reload to sign in; your draft is saved.');
        return;
      }
      errors.set(reviewId, responseError(response, data, `Could not submit review (HTTP ${response.status})`));
    } catch (error) {
      if (!owns(captured)) return;
      const originFailure = captured.endpoint.base === '' ? classifyOriginError(error) : null;
      if (originFailure === 'auth') {
        options.originFailure?.('auth');
        errors.set(reviewId, 'Sign-in expired — reload to sign in; your draft is saved.');
      } else if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
        errors.set(reviewId, 'Sign-in expired — reload to sign in; your draft is saved.');
      } else {
        errors.set(reviewId, `Could not submit review: ${errorMessage(error)}`);
      }
    } finally {
      if (submitting.get(reviewId)?.token === token) submitting.delete(reviewId);
      if (owns(captured)) sync();
    }
  }

  async function resolveReview(reviewId: string, action: 'reject' | 'dismiss'): Promise<void> {
    if (disposed || !activeOwner || !owns(activeOwner) || submitting.has(reviewId)) return;
    if (!canDismissForOwner(activeOwner)) return;
    const review = reviewsById.get(reviewId);
    if (!review || review.status !== 'open') return;
    const captured = activeOwner;
    const draft = loadDraft(captured.selection.host, review);
    const reason = action === 'reject' ? (rejectReasons.get(reviewId) ?? '').trim() : '';
    if (action === 'reject' && reason.length > MAX_REJECT_REASON) {
      errors.set(reviewId, `Reason is ${reason.length} characters; max is ${MAX_REJECT_REASON}.`);
      sync();
      return;
    }

    // Persist resolutionId before sending so reload retries stay idempotent.
    saveDraft(captured.selection.host, review, draft);
    disarmDismiss();
    errors.delete(reviewId);
    const token = nextRequestToken++;
    submitting.set(reviewId, { action, token });
    sync();
    const verb = action === 'reject' ? 'reject' : 'dismiss';
    const payload = action === 'reject'
      ? { resolutionId: draft.resolutionId, ...(reason ? { reason } : {}) }
      : { resolutionId: draft.resolutionId };
    try {
      const response = await options.request(
        captured.endpoint,
        `/api/sessions/${encodeURIComponent(review.sessionId)}/reviews/${encodeURIComponent(review.id)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [REVIEW_CLIENT_HEADER]: REVIEW_CLIENT_VALUE },
          body: JSON.stringify(payload),
        },
      );
      const data = await readJson(response);
      if (!owns(captured)) return;
      if (response.ok) {
        const updated = decodeClientReview(record(data) ? data.review : null);
        if (!updated) {
          errors.set(reviewId, 'Unexpected response from server — retry or reload.');
          return;
        }
        clearDraft(captured.selection.host, review.id, review.sessionId);
        clearTransientDeckState(review.id);
        errors.delete(reviewId);
        if (isForwardReviewUpdate(reviewsById.get(updated.id), updated)) {
          reviewsById.set(updated.id, updated);
        }
        return;
      }
      if (response.status === 409 && record(data)) {
        const serverReview = decodeClientReview(data.review);
        if (serverReview && serverReview.status !== 'open') {
          clearDraft(captured.selection.host, review.id, review.sessionId);
          clearTransientDeckState(review.id);
          errors.delete(reviewId);
          if (isForwardReviewUpdate(reviewsById.get(serverReview.id), serverReview)) {
            reviewsById.set(serverReview.id, serverReview);
          }
          return;
        }
      }
      if (response.status === 401 || response.status === 403) {
        if (captured.endpoint.base === '') options.originFailure?.('auth');
        const detail = responseError(response, data, '');
        errors.set(reviewId, detail && !/HTTP 40[13]/.test(detail)
          ? detail
          : 'Sign-in expired — reload to sign in.');
        return;
      }
      errors.set(reviewId, responseError(response, data, `Could not ${verb} review (HTTP ${response.status})`));
    } catch (error) {
      if (!owns(captured)) return;
      const originFailure = captured.endpoint.base === '' ? classifyOriginError(error) : null;
      if (originFailure === 'auth') {
        options.originFailure?.('auth');
        errors.set(reviewId, 'Sign-in expired — reload to sign in.');
      } else if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
        errors.set(reviewId, 'Sign-in expired — reload to sign in.');
      } else {
        errors.set(reviewId, `Could not ${verb} review: ${errorMessage(error)}`);
      }
    } finally {
      if (submitting.get(reviewId)?.token === token) submitting.delete(reviewId);
      if (owns(captured)) sync();
    }
  }

  function handleContainerClick(event: MouseEvent): void {
    if (disposed || !activeOwner || !owns(activeOwner)) return;
    const target = event.target instanceof Element ? event.target : null;
    const actionEl = target?.closest<HTMLElement>('[data-review-action]');
    const deck = target?.closest<HTMLElement>('.review-deck');
    if (!actionEl || !deck) return;
    const reviewId = deck.dataset.reviewId || '';
    const review = reviewsById.get(reviewId);
    if (!review) return;
    const action = actionEl.dataset.reviewAction;

    if (action === 'toggle-receipt') {
      if (expandedReceipts.has(reviewId)) expandedReceipts.delete(reviewId);
      else expandedReceipts.add(reviewId);
      renderOne(document.getElementById('messages')!, review);
      return;
    }

    if (action === 'lightbox') {
      const cardIndex = Number(actionEl.dataset.cardIndex);
      const shotIndex = Number(actionEl.dataset.shotIndex);
      const card = review.cards[cardIndex];
      if (!card) return;
      const owner = activeOwner;
      const authMedia = needsAuthMedia(owner.endpoint);
      const shots: LightboxShot[] = card.media.flatMap<LightboxShot>((item, idx) => {
        const label = item.label || '';
        const alt = item.alt || item.label || `Shot ${idx + 1}`;
        if (item.asset !== null && authMedia) {
          const cached = mediaBlobs.get(mediaCacheKey(review.id, item.asset))?.url ?? null;
          return [{
            src: cached,
            load: () => ensureAuthMedia(owner, review.id, review.sessionId, item.asset!),
            label,
            alt,
          }];
        }
        const src = shotUrl(owner.selection.host, review, item);
        return src ? [{ src, label, alt }] : [];
      });
      if (shots.length) openLightbox(review.id, shots, Number.isFinite(shotIndex) ? shotIndex : 0);
      return;
    }

    if (review.status !== 'open' || submitting.has(reviewId)) return;
    const hostId = activeOwner.selection.host;
    const draft = loadDraft(hostId, review);
    const questionId = actionEl.dataset.questionId || '';
    const entry = questionId ? draft.answers[questionId] : undefined;

    if (action === 'dismiss') {
      if (!canDismissForOwner(activeOwner)) return;
      if (dismissArmedId === reviewId) {
        disarmDismiss(true);
        void resolveReview(reviewId, 'dismiss');
        return;
      }
      const captured = activeOwner;
      disarmDismiss(true);
      const hadReject = rejectOpen.delete(reviewId);
      const hadError = errors.delete(reviewId);
      dismissArmedId = reviewId;
      dismissArmTimer = setTimeout(() => {
        if (dismissArmedId !== reviewId) return;
        disarmDismiss(!disposed && owns(captured));
      }, DISMISS_ARM_MS);
      if (hadError) deck.querySelector('.review-error')?.remove();
      if (hadReject) {
        deck.querySelector('.review-reject-panel')?.remove();
        const rejectBtn = deck.querySelector<HTMLButtonElement>('[data-review-action="open-reject"]');
        if (rejectBtn) {
          rejectBtn.classList.remove('active');
          rejectBtn.setAttribute('aria-expanded', 'false');
        }
      }
      // Update label, class and aria-pressed in place so keyboard focus stays on Dismiss.
      syncDismissButton(reviewId, true);
      return;
    }

    if (action === 'open-reject') {
      if (!canDismissForOwner(activeOwner)) return;
      disarmDismiss();
      errors.delete(reviewId);
      const opening = !rejectOpen.has(reviewId);
      if (opening) rejectOpen.add(reviewId);
      else rejectOpen.delete(reviewId);
      const container = document.getElementById('messages')!;
      renderOne(container, review);
      if (opening) {
        const updatedDeck = deckElement(container, reviewId);
        const input = updatedDeck?.querySelector<HTMLTextAreaElement>('textarea[data-review-input="reject-reason"]');
        input?.focus();
      }
      return;
    }

    if (action === 'cancel-reject') {
      rejectOpen.delete(reviewId);
      errors.delete(reviewId);
      renderOne(document.getElementById('messages')!, review);
      return;
    }

    if (action === 'confirm-reject') {
      if (!canDismissForOwner(activeOwner)) return;
      void resolveReview(reviewId, 'reject');
      return;
    }

    if (dismissArmedId !== null) disarmDismiss();

    if (action === 'pick-choice' && entry) {
      entry.value = actionEl.dataset.value ?? null;
      errors.delete(reviewId);
      saveDraft(hostId, review, draft);
      renderOne(document.getElementById('messages')!, review);
    } else if (action === 'toggle-multi' && entry) {
      const value = actionEl.dataset.value ?? '';
      const list = Array.isArray(entry.value) ? [...entry.value] : [];
      const at = list.indexOf(value);
      if (at >= 0) list.splice(at, 1);
      else list.push(value);
      entry.value = list;
      errors.delete(reviewId);
      saveDraft(hostId, review, draft);
      renderOne(document.getElementById('messages')!, review);
    } else if (action === 'pick-approve' && entry) {
      const val = actionEl.dataset.value;
      if (val === 'approve' || val === 'revise') entry.value = val;
      errors.delete(reviewId);
      saveDraft(hostId, review, draft);
      renderOne(document.getElementById('messages')!, review);
    } else if (action === 'toggle-note' && entry) {
      entry.noteOpen = !entry.noteOpen;
      saveDraft(hostId, review, draft);
      const container = document.getElementById('messages')!;
      renderOne(container, review);
      // Focus the newly revealed field ONLY when the user explicitly tapped the disclosure.
      if (entry.noteOpen) {
        const updatedDeck = deckElement(container, reviewId);
        const input = updatedDeck?.querySelector<HTMLInputElement>(`.review-question[data-question-id="${CSS.escape(questionId)}"] .review-disclosure input`);
        input?.focus();
      }
    } else if (action === 'prev-card') {
      if (draft.cardIndex > 0) {
        draft.cardIndex -= 1;
        errors.delete(reviewId);
        saveDraft(hostId, review, draft);
        const container = document.getElementById('messages')!;
        renderOne(container, review);
        revealDeckTop(container, reviewId);
        syncJumpBar();
      }
    } else if (action === 'next-card') {
      const missing = firstMissingRequired(review, draft, draft.cardIndex);
      if (missing) {
        errors.set(reviewId, missing.message);
        renderOne(document.getElementById('messages')!, review);
        return;
      }
      if (draft.cardIndex < review.cards.length - 1) {
        draft.cardIndex += 1;
        errors.delete(reviewId);
        saveDraft(hostId, review, draft);
        const container = document.getElementById('messages')!;
        renderOne(container, review);
        revealDeckTop(container, reviewId);
        syncJumpBar();
      }
    } else if (action === 'jump-card') {
      const targetIndex = Number(actionEl.dataset.cardIndex);
      if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < review.cards.length) {
        draft.cardIndex = targetIndex;
        errors.delete(reviewId);
        saveDraft(hostId, review, draft);
        const container = document.getElementById('messages')!;
        renderOne(container, review);
        revealDeckTop(container, reviewId);
        syncJumpBar();
      }
    } else if (action === 'submit') {
      void submitReview(reviewId);
    }
  }

  function revealDeckTop(container: HTMLElement, reviewId: string): void {
    const el = deckElement(container, reviewId);
    if (!el) return;
    const viewRect = container.getBoundingClientRect();
    const deckRect = el.getBoundingClientRect();
    if (deckRect.top < viewRect.top) el.scrollIntoView({ block: 'nearest' });
  }

  function handleContainerInput(event: Event): void {
    if (disposed || !activeOwner || !owns(activeOwner)) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
    const kind = input.dataset.reviewInput;
    const deck = input.closest<HTMLElement>('.review-deck');
    if (!kind || !deck) return;
    const reviewId = deck.dataset.reviewId || '';
    const review = reviewsById.get(reviewId);
    if (!review || review.status !== 'open') return;
    if (kind === 'reject-reason') {
      rejectReasons.set(reviewId, input.value);
      const counter = deck.querySelector<HTMLElement>(`[data-review-reject-count="${CSS.escape(reviewId)}"]`);
      if (counter) counter.textContent = `${input.value.length}/${MAX_REJECT_REASON}`;
      if (errors.delete(reviewId)) {
        deck.querySelector('.review-error')?.remove();
        renderedKeys.set(reviewId, deckRenderKey(activeOwner.selection.host, review));
      }
      return;
    }
    const questionId = input.dataset.questionId || '';
    if (!questionId) return;
    const draft = loadDraft(activeOwner.selection.host, review);
    const entry = draft.answers[questionId];
    if (!entry) return;
    if (kind === 'text') entry.value = input.value;
    else if (kind === 'note') entry.note = input.value;
    else if (kind === 'other') entry.other = input.value;
    saveDraft(activeOwner.selection.host, review, draft);
    if (errors.delete(reviewId)) {
      deck.querySelector('.review-error')?.remove();
      renderedKeys.set(reviewId, deckRenderKey(activeOwner.selection.host, review));
    }
  }

  function mount(): void {
    const container = document.getElementById('messages');
    if (!container) return;
    container.addEventListener('click', handleContainerClick, { signal: domEvents.signal });
    container.addEventListener('input', handleContainerInput, { signal: domEvents.signal });
    container.addEventListener('scroll', scheduleJumpBar, { passive: true, signal: domEvents.signal });
  }

  function resetSessionState(): void {
    sessionAbort?.abort();
    sessionAbort = null;
    activeOwner = null;
    disarmDismiss(false);
    reviewsById.clear();
    drafts.clear();
    renderedKeys.clear();
    expandedReceipts.clear();
    submitting.clear();
    rejectOpen.clear();
    rejectReasons.clear();
    errors.clear();
    jumpBarEl?.remove();
    jumpBarEl = null;
    revokeAllMedia();
  }

  function clear(): void {
    resetSessionState();
  }

  async function load(selection = sessionState.captureSelection()): Promise<void> {
    if (disposed || !selection || !sessionState.ownsSelection(selection)) return;
    const endpoint = options.host(selection.host);
    if (!endpoint) return;
    const frozen = Object.freeze({ ...endpoint });
    const incomingOwner: ActiveOwner = { selection, endpoint: frozen };
    const isSameSession = sameOwner(activeOwner, incomingOwner);
    if (!isSameSession) {
      resetSessionState();
      activeOwner = incomingOwner;
      sessionAbort = new AbortController();
    } else if (!sessionAbort) {
      sessionAbort = new AbortController();
    }
    const owner = activeOwner!;
    const signal = sessionAbort.signal;

    if (options.supports && !options.supports(frozen)) {
      sync();
      return;
    }

    try {
      const response = await options.request(
        frozen,
        `/api/sessions/${encodeURIComponent(selection.id)}/reviews`,
        { signal },
      );
      if (!owns(owner) || !sameOwner(activeOwner, owner)) return;
      // Older pi-dish host without reviewsV1 answers 404: degrade silently.
      if (response.status === 404) { sync(); return; }
      const data = await readJson(response);
      if (!owns(owner) || !sameOwner(activeOwner, owner)) return;
      if (!response.ok) return;
      const container = document.getElementById('messages');
      const wasPinned = container && options.pinned ? options.pinned(container) : false;
      let hasNewOpen = false;
      for (const review of decodeReviewList(data)) {
        const existing = reviewsById.get(review.id);
        if (!isForwardReviewUpdate(existing, review)) continue;
        const wasNew = !existing;
        reviewsById.set(review.id, review);
        if (review.status === 'open') {
          if (wasNew) hasNewOpen = true;
        } else {
          clearDraft(selection.host, review.id, review.sessionId);
          clearTransientDeckState(review.id);
          revokeReviewMedia(review.id);
        }
      }
      sync(container);
      if (hasNewOpen && container && wasPinned) {
        scrollToOpenDeck(container);
        syncJumpBar();
      }
    } catch (error) {
      if (!owns(owner) || !sameOwner(activeOwner, owner)) return;
      const failure = frozen.base === '' ? classifyOriginError(error) : null;
      if (failure === 'auth') options.originFailure?.('auth');
    }
  }

  function scrollToOpenDeck(container: HTMLElement): void {
    const firstOpen = [...reviewsById.values()].find(item => item.status === 'open');
    const openEl = firstOpen ? deckElement(container, firstOpen.id) : null;
    if (openEl && openEl.offsetHeight > container.clientHeight - 24) {
      openEl.scrollIntoView({ block: 'start' });
    } else {
      options.scroll?.(container);
    }
  }

  function applyUpdate(payload: unknown, session: ReviewSessionRef): void {
    if (disposed) return;
    const review = decodeClientReview(record(payload) ? payload.review : null);
    if (!review) return;
    const current = sessionState.currentSession;
    if (!current || current.id !== session.id || (current.host || null) !== session.host) return;
    if (!activeOwner || !owns(activeOwner)) {
      const endpoint = options.host(session.host);
      const captured = sessionState.captureSelection();
      if (!endpoint || !captured) return;
      activeOwner = { selection: captured, endpoint: Object.freeze({ ...endpoint }) };
      if (!sessionAbort) sessionAbort = new AbortController();
    }
    const existing = reviewsById.get(review.id);
    const wasNew = !existing;
    if (!isForwardReviewUpdate(existing, review)) return;
    reviewsById.set(review.id, review);
    if (review.status !== 'open') {
      clearDraft(session.host, review.id, review.sessionId);
      clearTransientDeckState(review.id);
      revokeReviewMedia(review.id);
    }
    const container = document.getElementById('messages');
    const wasPinned = container && options.pinned ? options.pinned(container) : false;
    sync(container);
    if (wasNew && review.status === 'open' && container && wasPinned) {
      scrollToOpenDeck(container);
      syncJumpBar();
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    domEvents.abort();
    clear();
  }

  return { mount, clear, load, sync, applyUpdate, dispose };
}
