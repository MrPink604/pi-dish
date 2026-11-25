import { record } from '../core/helper-values';

export const REVIEW_CLIENT_HEADER = 'X-Pi-Dish-Client';
export const REVIEW_CLIENT_VALUE = '1';
export const MAX_REJECT_REASON = 500;

export type ReviewQuestionType = 'choice' | 'multi' | 'approve' | 'text';
export type ReviewStatus = 'open' | 'submitted' | 'cancelled' | 'rejected' | 'dismissed';
export type ReviewDeliveryState = 'pending' | 'delivering' | 'delivered' | 'failed' | 'uncertain';
export type ReviewAnswerValue = string | string[] | null;

export interface ReviewOption {
  readonly value: string;
  readonly label: string;
  readonly description: string | null;
}

export interface ReviewChoiceQuestion {
  readonly id: string;
  readonly type: 'choice' | 'multi';
  readonly prompt: string;
  readonly options: readonly ReviewOption[];
  readonly default: string | readonly string[] | null;
  readonly why: string | null;
  readonly allowOther: boolean;
}

export interface ReviewApproveQuestion {
  readonly id: string;
  readonly type: 'approve';
  readonly prompt: string;
  readonly approveLabel: string;
  readonly reviseLabel: string;
  readonly default: 'approve' | 'revise' | null;
  readonly why: string | null;
}

export interface ReviewTextQuestion {
  readonly id: string;
  readonly type: 'text';
  readonly prompt: string;
  readonly placeholder: string | null;
  readonly default: string | null;
  readonly required: boolean;
}

export type ReviewQuestion = ReviewChoiceQuestion | ReviewApproveQuestion | ReviewTextQuestion;

export interface ReviewMedia {
  readonly label: string | null;
  readonly alt: string | null;
  readonly asset: number | null;
  readonly url: string | null;
}

export interface ReviewCard {
  readonly id: string;
  readonly title: string;
  readonly context: string;
  readonly media: readonly ReviewMedia[];
  readonly questions: readonly ReviewQuestion[];
}

export interface ReviewQuestionAnswer {
  readonly value: ReviewAnswerValue;
  readonly default: boolean;
  readonly note?: string;
  readonly other?: string;
}

export interface ReviewDelivery {
  readonly state: ReviewDeliveryState;
  readonly via: 'waiter' | 'message' | null;
  readonly at: number | null;
  readonly error: string | null;
}

export interface ReviewSubmission {
  readonly id: string;
  readonly submittedAt: number;
  readonly answers: Readonly<Record<string, ReviewQuestionAnswer>>;
  readonly changed: readonly string[];
  readonly delivery: ReviewDelivery;
}

export type ReviewOutcome = 'rejected' | 'dismissed';

export interface ReviewResolution {
  readonly outcome?: ReviewOutcome | null;
  readonly id: string;
  readonly resolvedAt: number;
  readonly reason: string | null;
  readonly delivery: ReviewDelivery;
}

export interface ClientReview {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly updatedAt: number | null;
  readonly anchorMessageIndex: number | null;
  readonly title: string;
  readonly companionPage: string | null;
  readonly wait: boolean;
  readonly status: ReviewStatus;
  readonly cards: readonly ReviewCard[];
  readonly submission: ReviewSubmission | null;
  readonly resolution: ReviewResolution | null;
}

export interface DraftAnswer {
  value: ReviewAnswerValue;
  note: string;
  other: string;
  noteOpen: boolean;
}

export interface ReviewDraft {
  cardIndex: number;
  submissionId: string;
  resolutionId: string;
  answers: Record<string, DraftAnswer>;
}

const DELIVERY_STATES: readonly string[] = ['pending', 'delivering', 'delivered', 'failed', 'uncertain'];
const STATUSES: readonly string[] = ['open', 'submitted', 'cancelled', 'rejected', 'dismissed'];

const str = (value: unknown): string | null => typeof value === 'string' ? value : null;
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

function safeReviewUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith('/page/')) return value;
  if (/^https:\/\//i.test(value)) {
    try { return new URL(value).protocol === 'https:' ? value : null; } catch { return null; }
  }
  return null;
}

function decodeAnswerValue(value: unknown): ReviewAnswerValue {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return [...value];
  return null;
}

function decodeOption(raw: unknown): ReviewOption | null {
  if (!record(raw) || typeof raw.value !== 'string') return null;
  return { value: raw.value, label: str(raw.label) ?? raw.value, description: str(raw.description) };
}

function decodeQuestion(raw: unknown): ReviewQuestion | null {
  if (!record(raw) || typeof raw.id !== 'string' || typeof raw.prompt !== 'string') return null;
  if (raw.type === 'choice' || raw.type === 'multi') {
    if (!Array.isArray(raw.options)) return null;
    const options = raw.options.map(decodeOption).filter((item): item is ReviewOption => item !== null);
    if (!options.length) return null;
    const fallback = raw.type === 'choice'
      ? str(raw.default)
      : Array.isArray(raw.default) && raw.default.every(item => typeof item === 'string') ? [...raw.default] : null;
    return {
      id: raw.id, type: raw.type, prompt: raw.prompt, options, default: fallback,
      why: str(raw.why), allowOther: raw.allowOther !== false,
    };
  }
  if (raw.type === 'approve') {
    const fallback = raw.default === 'approve' || raw.default === 'revise' ? raw.default : null;
    return {
      id: raw.id, type: 'approve', prompt: raw.prompt,
      approveLabel: str(raw.approveLabel) ?? 'Approve',
      reviseLabel: str(raw.reviseLabel) ?? 'Revise',
      default: fallback, why: str(raw.why),
    };
  }
  if (raw.type === 'text') {
    return {
      id: raw.id, type: 'text', prompt: raw.prompt,
      placeholder: str(raw.placeholder), default: str(raw.default), required: raw.required === true,
    };
  }
  return null;
}

function decodeMedia(raw: unknown): ReviewMedia | null {
  if (!record(raw)) return null;
  const asset = typeof raw.asset === 'number' && Number.isInteger(raw.asset) && raw.asset >= 0 ? raw.asset : null;
  const url = safeReviewUrl(raw.url);
  if (asset === null && url === null) return null;
  return { label: str(raw.label), alt: str(raw.alt), asset, url };
}

function decodeCard(raw: unknown): ReviewCard | null {
  if (!record(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.context !== 'string' || !Array.isArray(raw.questions)) {
    return null;
  }
  const questions = raw.questions.map(decodeQuestion).filter((item): item is ReviewQuestion => item !== null);
  if (!questions.length) return null;
  const media = Array.isArray(raw.media)
    ? raw.media.map(decodeMedia).filter((item): item is ReviewMedia => item !== null) : [];
  return { id: raw.id, title: raw.title, context: raw.context, media, questions };
}

function decodeSubmission(raw: unknown): ReviewSubmission | null {
  if (!record(raw) || typeof raw.id !== 'string' || !record(raw.delivery)) return null;
  const deliveryState = typeof raw.delivery.state === 'string' && DELIVERY_STATES.includes(raw.delivery.state)
    ? raw.delivery.state as ReviewDeliveryState : 'pending';
  const via = raw.delivery.via === 'waiter' || raw.delivery.via === 'message' ? raw.delivery.via : null;
  const answers: Record<string, ReviewQuestionAnswer> = {};
  if (record(raw.answers)) {
    for (const [id, item] of Object.entries(raw.answers)) {
      if (!record(item)) continue;
      const entry: ReviewQuestionAnswer = {
        value: decodeAnswerValue(item.value),
        default: item.default === true,
        ...(typeof item.note === 'string' && item.note ? { note: item.note } : {}),
        ...(typeof item.other === 'string' && item.other ? { other: item.other } : {}),
      };
      answers[id] = entry;
    }
  }
  const changed = Array.isArray(raw.changed) ? raw.changed.filter((item): item is string => typeof item === 'string') : [];
  return {
    id: raw.id,
    submittedAt: num(raw.submittedAt) ?? 0,
    answers,
    changed,
    delivery: { state: deliveryState, via, at: num(raw.delivery.at), error: str(raw.delivery.error) },
  };
}

function decodeOutcome(value: unknown): ReviewOutcome | null {
  return value === 'rejected' || value === 'dismissed' ? value : null;
}

function decodeResolution(raw: unknown): ReviewResolution | null {
  if (!record(raw) || typeof raw.id !== 'string' || !record(raw.delivery)) return null;
  const deliveryState = typeof raw.delivery.state === 'string' && DELIVERY_STATES.includes(raw.delivery.state)
    ? raw.delivery.state as ReviewDeliveryState : 'pending';
  const via = raw.delivery.via === 'waiter' || raw.delivery.via === 'message' ? raw.delivery.via : null;
  const outcome = decodeOutcome(raw.outcome);
  return {
    ...(outcome ? { outcome } : {}),
    id: raw.id,
    resolvedAt: num(raw.resolvedAt) ?? 0,
    reason: str(raw.reason),
    delivery: { state: deliveryState, via, at: num(raw.delivery.at), error: str(raw.delivery.error) },
  };
}

export function reviewDelivery(review: Pick<ClientReview, 'submission' | 'resolution'>): ReviewDelivery | null {
  return review.submission?.delivery ?? review.resolution?.delivery ?? null;
}

export function decodeClientReview(raw: unknown): ClientReview | null {
  if (!record(raw) || typeof raw.id !== 'string' || typeof raw.sessionId !== 'string' || typeof raw.title !== 'string'
    || typeof raw.status !== 'string' || !STATUSES.includes(raw.status) || !Array.isArray(raw.cards)) {
    return null;
  }
  const cards = raw.cards.map(decodeCard).filter((item): item is ReviewCard => item !== null);
  if (!cards.length) return null;
  const resolution = raw.resolution ? decodeResolution(raw.resolution) : null;
  const outcome = decodeOutcome(raw.outcome) ?? decodeOutcome(resolution?.outcome);
  const status: ReviewStatus = raw.status === 'cancelled' && outcome ? outcome : raw.status as ReviewStatus;
  return {
    id: raw.id,
    sessionId: raw.sessionId,
    createdAt: num(raw.createdAt) ?? 0,
    updatedAt: num(raw.updatedAt),
    anchorMessageIndex: num(raw.anchorMessageIndex),
    title: raw.title,
    companionPage: safeReviewUrl(raw.companionPage),
    wait: raw.wait !== false,
    status,
    cards,
    submission: raw.submission ? decodeSubmission(raw.submission) : null,
    resolution,
  };
}

export function decodeReviewList(raw: unknown): ClientReview[] {
  if (!record(raw) || !Array.isArray(raw.reviews)) return [];
  return raw.reviews.map(decodeClientReview).filter((item): item is ClientReview => item !== null);
}

function randomToken(prefix: string): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return prefix + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function generateSubmissionId(): string {
  return randomToken('sub_');
}

export function generateResolutionId(): string {
  return randomToken('res_');
}

export function initialDraft(review: ClientReview): ReviewDraft {
  const answers: Record<string, DraftAnswer> = {};
  for (const card of review.cards) {
    for (const question of card.questions) {
      let value: ReviewAnswerValue = null;
      if (question.type === 'choice' || question.type === 'approve' || question.type === 'text') {
        value = typeof question.default === 'string' ? question.default : null;
      } else if (question.type === 'multi') {
        value = Array.isArray(question.default) ? [...question.default] : [];
      }
      answers[question.id] = { value, note: '', other: '', noteOpen: false };
    }
  }
  return { cardIndex: 0, submissionId: generateSubmissionId(), resolutionId: generateResolutionId(), answers };
}

export function hydrateDraft(review: ClientReview, raw: unknown): ReviewDraft {
  const base = initialDraft(review);
  if (!record(raw)) return base;
  const idx = num(raw.cardIndex);
  if (idx !== null && Number.isInteger(idx) && idx >= 0 && idx < review.cards.length) base.cardIndex = idx;
  if (typeof raw.submissionId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw.submissionId)) base.submissionId = raw.submissionId;
  if (typeof raw.resolutionId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw.resolutionId)) base.resolutionId = raw.resolutionId;
  if (record(raw.answers)) {
    for (const card of review.cards) {
      for (const question of card.questions) {
        const saved = raw.answers[question.id];
        if (!record(saved)) continue;
        const entry = base.answers[question.id]!;
        if (question.type === 'choice') {
          if (saved.value === null) entry.value = null;
          else if (typeof saved.value === 'string' && question.options.some(option => option.value === saved.value)) entry.value = saved.value;
        } else if (question.type === 'multi') {
          if (Array.isArray(saved.value)) {
            const valid = new Set(question.options.map(option => option.value));
            entry.value = saved.value.filter((item): item is string => typeof item === 'string' && valid.has(item));
          }
        } else if (question.type === 'approve') {
          if (saved.value === 'approve' || saved.value === 'revise' || saved.value === null) entry.value = saved.value;
        } else if (question.type === 'text') {
          if (typeof saved.value === 'string' || saved.value === null) entry.value = saved.value;
        }
        if (typeof saved.note === 'string') entry.note = saved.note;
        if (typeof saved.other === 'string' && (question.type === 'choice' || question.type === 'multi') && question.allowOther) entry.other = saved.other;
        entry.noteOpen = saved.noteOpen === true || !!entry.note.trim() || !!entry.other.trim();
      }
    }
  }
  return base;
}

/** Validates required text questions across the given cards; returns first missing card index + message, or null. */
export function firstMissingRequired(review: ClientReview, draft: ReviewDraft, onlyCardIndex?: number): { cardIndex: number; questionId: string; message: string } | null {
  for (let cardIndex = 0; cardIndex < review.cards.length; cardIndex++) {
    if (onlyCardIndex !== undefined && cardIndex !== onlyCardIndex) continue;
    const card = review.cards[cardIndex]!;
    for (const question of card.questions) {
      if (question.type !== 'text' || !question.required) continue;
      const value = draft.answers[question.id]?.value;
      if (typeof value !== 'string' || !value.trim()) {
        return { cardIndex, questionId: question.id, message: `Please answer "${question.prompt}" before continuing.` };
      }
    }
  }
  return null;
}

export function buildSubmitAnswers(review: ClientReview, draft: ReviewDraft): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const card of review.cards) {
    for (const question of card.questions) {
      const entry = draft.answers[question.id];
      if (!entry) continue;
      if (question.type === 'text') {
        const text = typeof entry.value === 'string' ? entry.value.trim() : '';
        out[question.id] = { value: text || null };
        continue;
      }
      const payload: Record<string, unknown> = { value: entry.value };
      const note = entry.note.trim();
      if (note) payload.note = note;
      if ((question.type === 'choice' || question.type === 'multi') && question.allowOther) {
        const other = entry.other.trim();
        if (other) payload.other = other;
      }
      out[question.id] = payload;
    }
  }
  return out;
}

export function reviewReceiptSummary(review: ClientReview): string {
  const cards = `${review.cards.length} card${review.cards.length === 1 ? '' : 's'}`;
  const submission = review.submission;
  if (!submission) return cards;
  const changedCount = submission.changed.length;
  const notesCount = Object.values(submission.answers).filter(answer => !!answer.note || !!answer.other).length;
  const parts = [cards, changedCount ? `${changedCount} changed` : 'all defaults'];
  if (notesCount) parts.push(`${notesCount} note${notesCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export interface ParsedReviewResponseMessage {
  readonly title: string;
  readonly reviewId: string;
  readonly status: 'submitted' | 'rejected' | 'dismissed';
  readonly submittedAt: string;
  readonly body: string;
}

const REVIEW_RESPONSE_RE = /^\[review response:\s*(.+?)\s+\((rv_[0-9a-f]{16})\),\s*(?:submitted\s+([^\]]+)|REJECTED by the user at\s+([^\]]+)|DISMISSED by the user \(no answers\) at\s+([^\]]+))\]\n?([\s\S]*)$/;

export function parseReviewResponseMessage(text: string): ParsedReviewResponseMessage | null {
  const match = REVIEW_RESPONSE_RE.exec(text.trim());
  if (!match) return null;
  const status: 'submitted' | 'rejected' | 'dismissed' = match[3] ? 'submitted' : match[4] ? 'rejected' : 'dismissed';
  const at = (match[3] ?? match[4] ?? match[5] ?? '').trim();
  return { title: match[1]!.trim(), reviewId: match[2]!, status, submittedAt: at, body: (match[6] ?? '').trim() };
}
