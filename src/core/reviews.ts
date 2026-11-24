/**
 * Review decks: an agent asks the owner for a few decisions as a short
 * sequence of cards (one paragraph, up to four shots and one to three
 * questions each) shown inline in the session's transcript. This module owns
 * the bounded deck format, the answer checks, the message an agent receives
 * and the durable per-session store; review-handlers.ts owns the routes,
 * media, waiters and delivery.
 *
 * The bounds are hard: a deck over them is refused at creation with an error
 * that says how to split it, because prompt guidance alone drifts.
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import { dishDir, replaceFileDurably } from './dish-store';
import { literalPrompt, visibleText } from './page-forms';
import { record } from './helper-values';

export const REVIEWS_CAPABILITY = 'reviewsV1';
export const REVIEW_CLIENT_HEADER = 'x-pi-dish-client';
export const REVIEW_CLIENT_VALUE = '1';
export const MAX_CARDS = 6;
export const MAX_QUESTIONS_PER_CARD = 3;
export const MAX_MEDIA_PER_CARD = 4;
export const MAX_CONTEXT_CHARS = 500;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_TITLE = 120;
const MAX_PROMPT = 300;
const MAX_LABEL = 120;
const MAX_SHORT = 200;
const MAX_BUTTON = 40;
const MAX_URL = 2048;
export const MAX_TEXT_ANSWER = 2000;
export const MAX_NOTE = 1000;
/** A deck's JSON as posted; far above anything the bounds above allow, so it only stops abuse. */
export const MAX_SPEC_BYTES = 64 * 1024;
/** A submission's JSON body; checked before validating answers. */
export const MAX_SUBMIT_BYTES = 64 * 1024;
/** Open decks per session: an agent that keeps posting without waiting is refused. */
export const MAX_OPEN_REVIEWS = 10;
/** Decks kept per session, answered and cancelled ones evicted oldest first. */
const KEPT_REVIEWS = 50;
const MAX_MESSAGE_BYTES = 32 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const REVIEW_ID_RE = /^rv_[0-9a-f]{16}$/;
export const SUBMISSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type QuestionType = 'choice' | 'multi' | 'approve' | 'text';
export const QUESTION_TYPES: readonly QuestionType[] = ['choice', 'multi', 'approve', 'text'];

export interface ReviewOption { value: string; label: string; description: string | null }
interface QuestionBase { id: string; prompt: string }
export interface ChoiceQuestion extends QuestionBase {
  type: 'choice' | 'multi';
  options: ReviewOption[];
  default: string | string[] | null;
  why: string | null;
  allowOther: boolean;
}
export interface ApproveQuestion extends QuestionBase {
  type: 'approve';
  approveLabel: string;
  reviseLabel: string;
  default: 'approve' | 'revise' | null;
  why: string | null;
}
export interface TextQuestion extends QuestionBase {
  type: 'text';
  placeholder: string | null;
  default: string | null;
  required: boolean;
}
export type ReviewQuestion = ChoiceQuestion | ApproveQuestion | TextQuestion;

/** A shot as the agent named it: a local file, a `/page/<token>/…` path or an https URL. */
export interface ReviewMediaSpec { src: string; label: string | null; alt: string | null }
export interface ReviewCard { id: string; title: string; context: string; media: ReviewMediaSpec[]; questions: ReviewQuestion[] }
export interface ReviewSpec { title: string; companionPage: string | null; wait: boolean; cards: ReviewCard[] }

/** How a shot is served: one of the review's resolved local files, or a URL the browser loads itself. */
export type MediaSource = { kind: 'asset'; slot: number } | { kind: 'url'; url: string };
/** A local file a shot resolved to when the deck was created. */
export interface ReviewAsset { path: string; realPath: string; mimeType: string }

export type AnswerValue = string | string[] | null;
export interface QuestionAnswer { value: AnswerValue; default: boolean; note?: string; other?: string }
export type DeliveryState = 'pending' | 'delivering' | 'delivered' | 'failed' | 'uncertain';
export interface ReviewDelivery {
  state: DeliveryState;
  /** `waiter`: the agent's waiting CLI took it; `message`: it arrived as a session message. */
  via: 'waiter' | 'message' | null;
  at: number | null;
  error: string | null;
}
export interface ReviewSubmission {
  id: string;
  submittedAt: number;
  answers: Record<string, QuestionAnswer>;
  changed: string[];
  delivery: ReviewDelivery;
}
export type ReviewStatus = 'open' | 'submitted' | 'cancelled';
export interface ReviewRecord {
  id: string;
  sessionId: string;
  createdAt: number;
  /** The transcript's last message index when the deck was created; null when unknown. */
  anchorMessageIndex: number | null;
  spec: ReviewSpec;
  /** Per card, per shot: where it is served from. */
  media: MediaSource[][];
  assets: ReviewAsset[];
  status: ReviewStatus;
  submission: ReviewSubmission | null;
}

// ---- the deck format -----------------------------------------------------------

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[], where: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${where} has unknown key "${key}" (allowed: ${allowed.join(', ')})`);
  }
}

function text(value: unknown, where: string, max: number, errors: string[], required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) errors.push(`${where} is required`);
    return null;
  }
  if (typeof value !== 'string') { errors.push(`${where} must be text`); return null; }
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) errors.push(`${where} must not be empty`);
    return null;
  }
  if (trimmed.length > max) { errors.push(`${where} is ${trimmed.length} characters; max is ${max}`); return null; }
  return trimmed;
}

function flag(value: unknown, where: string, fallback: boolean, errors: string[]): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') { errors.push(`${where} must be true or false`); return fallback; }
  return value;
}

function list(value: unknown, where: string, min: number, max: number, errors: string[], advice: string): unknown[] | null {
  if (value === undefined && min === 0) return [];
  if (!Array.isArray(value)) { errors.push(`${where} must be a list`); return null; }
  if (value.length > max) { errors.push(`${where} has ${value.length} items; max is ${max} — ${advice}`); return null; }
  if (value.length < min) { errors.push(`${where} needs at least ${min} item${min === 1 ? '' : 's'}`); return null; }
  return value;
}

function claimId(value: unknown, where: string, ids: Set<string>, errors: string[]): string | null {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    errors.push(`${where} must be 1-64 characters of letters, digits, ".", "_", ":" or "-", starting with a letter or digit`);
    return null;
  }
  if (ids.has(value)) { errors.push(`${where} "${value}" is repeated`); return null; }
  ids.add(value);
  return value;
}

const PAGE_SRC_RE = /^\/page\/([A-Za-z0-9_-]{8,128})(?:\/[^?#]*)?$/;

/** The token a `/page/<token>[/asset]` reference names, or null. */
export function pageToken(src: string): string | null {
  const match = PAGE_SRC_RE.exec(src);
  return match ? match[1] : null;
}

function companionPage(value: unknown, errors: string[]): string | null {
  const page = text(value, 'companionPage', MAX_URL, errors, false);
  if (page === null) return null;
  if (pageToken(page) || /^https:\/\/[^\s]+$/i.test(page)) return page;
  errors.push('companionPage must be a /page/<token> path or an https URL');
  return null;
}

function validateMedia(raw: unknown, where: string, errors: string[]): ReviewMediaSpec | null {
  if (typeof raw === 'string') raw = { src: raw };
  if (!record(raw)) { errors.push(`${where} must be an object with "src"`); return null; }
  unknownKeys(raw, ['src', 'label', 'alt'], where, errors);
  const src = text(raw.src, `${where}.src`, MAX_URL, errors, true);
  if (src && /[\0\n]/.test(src)) { errors.push(`${where}.src must be one line`); return null; }
  if (src && /^[a-z][a-z0-9+.-]*:/i.test(src) && !/^https:\/\//i.test(src)) {
    errors.push(`${where}.src must be a file path, a /page/<token>/… path or an https URL`);
    return null;
  }
  return src ? { src, label: text(raw.label, `${where}.label`, MAX_LABEL, errors, false), alt: text(raw.alt, `${where}.alt`, MAX_SHORT, errors, false) } : null;
}

function validateOptions(raw: unknown, where: string, errors: string[]): ReviewOption[] | null {
  const items = list(raw, where, MIN_OPTIONS, MAX_OPTIONS, errors, 'narrow the choice before asking');
  if (!items) return null;
  const values = new Set<string>();
  const options: ReviewOption[] = [];
  items.forEach((item, index) => {
    const at = `${where}[${index}]`;
    if (typeof item === 'string') item = { value: item };
    if (!record(item)) { errors.push(`${at} must be text or an object with "value"`); return; }
    unknownKeys(item, ['value', 'label', 'description'], at, errors);
    const value = text(item.value, `${at}.value`, 64, errors, true);
    if (value === null) return;
    if (values.has(value)) { errors.push(`${at}.value "${value}" is repeated`); return; }
    values.add(value);
    options.push({
      value,
      label: text(item.label, `${at}.label`, MAX_LABEL, errors, false) ?? value,
      description: text(item.description, `${at}.description`, MAX_SHORT, errors, false),
    });
  });
  return options.length === items.length ? options : null;
}

const QUESTION_KEYS: Record<QuestionType, readonly string[]> = {
  choice: ['id', 'type', 'prompt', 'options', 'default', 'why', 'allowOther'],
  multi: ['id', 'type', 'prompt', 'options', 'default', 'why', 'allowOther'],
  approve: ['id', 'type', 'prompt', 'approveLabel', 'reviseLabel', 'default', 'why'],
  text: ['id', 'type', 'prompt', 'placeholder', 'default', 'required'],
};

function validateQuestion(raw: unknown, where: string, ids: Set<string>, errors: string[]): ReviewQuestion | null {
  if (!record(raw)) { errors.push(`${where} must be an object`); return null; }
  const type = raw.type;
  if (typeof type !== 'string' || !(QUESTION_TYPES as readonly string[]).includes(type)) {
    errors.push(`${where}.type must be one of ${QUESTION_TYPES.join(', ')}`);
    return null;
  }
  const kind = type as QuestionType;
  const named = typeof raw.id === 'string' ? `${where} ("${raw.id}")` : where;
  unknownKeys(raw, QUESTION_KEYS[kind], named, errors);
  const id = claimId(raw.id, `${named}.id`, ids, errors);
  const prompt = text(raw.prompt, `${named}.prompt`, MAX_PROMPT, errors, true);
  const before = errors.length;
  let question: ReviewQuestion | null = null;
  if (kind === 'choice' || kind === 'multi') {
    const options = validateOptions(raw.options, `${named}.options`, errors);
    let fallback: string | string[] | null = null;
    if (options && raw.default !== undefined && raw.default !== null) {
      const values = options.map(option => option.value);
      if (kind === 'choice') {
        if (typeof raw.default === 'string' && values.includes(raw.default)) fallback = raw.default;
        else errors.push(`${named}.default must be one of the option values (${values.join(', ')})`);
      } else if (Array.isArray(raw.default) && raw.default.every(item => typeof item === 'string' && values.includes(item))) {
        fallback = values.filter(value => (raw.default as string[]).includes(value));
      } else {
        errors.push(`${named}.default must be a list of option values (${values.join(', ')})`);
      }
    }
    if (options) {
      question = {
        id: id ?? '', type: kind, prompt: prompt ?? '', options, default: fallback,
        why: text(raw.why, `${named}.why`, MAX_SHORT, errors, false),
        allowOther: flag(raw.allowOther, `${named}.allowOther`, true, errors),
      };
    }
  } else if (kind === 'approve') {
    let fallback: 'approve' | 'revise' | null = null;
    if (raw.default === 'approve' || raw.default === 'revise') fallback = raw.default;
    else if (raw.default !== undefined && raw.default !== null) errors.push(`${named}.default must be "approve" or "revise"`);
    question = {
      id: id ?? '', type: 'approve', prompt: prompt ?? '', default: fallback,
      approveLabel: text(raw.approveLabel, `${named}.approveLabel`, MAX_BUTTON, errors, false) ?? 'Approve',
      reviseLabel: text(raw.reviseLabel, `${named}.reviseLabel`, MAX_BUTTON, errors, false) ?? 'Revise',
      why: text(raw.why, `${named}.why`, MAX_SHORT, errors, false),
    };
  } else {
    question = {
      id: id ?? '', type: 'text', prompt: prompt ?? '',
      placeholder: text(raw.placeholder, `${named}.placeholder`, MAX_LABEL, errors, false),
      default: text(raw.default, `${named}.default`, MAX_TEXT_ANSWER, errors, false),
      required: flag(raw.required, `${named}.required`, false, errors),
    };
  }
  return errors.length === before && id && prompt ? question : null;
}

function validateCard(raw: unknown, where: string, cardIds: Set<string>, questionIds: Set<string>, errors: string[]): ReviewCard | null {
  if (!record(raw)) { errors.push(`${where} must be an object`); return null; }
  const named = typeof raw.id === 'string' ? `${where} ("${raw.id}")` : where;
  unknownKeys(raw, ['id', 'title', 'context', 'media', 'questions'], named, errors);
  const before = errors.length;
  const id = claimId(raw.id, `${named}.id`, cardIds, errors);
  const title = text(raw.title, `${named}.title`, MAX_TITLE, errors, true);
  let context: string | null = null;
  if (typeof raw.context === 'string' && raw.context.trim().length > MAX_CONTEXT_CHARS) {
    errors.push(`${named}.context is ${raw.context.trim().length} characters; max is ${MAX_CONTEXT_CHARS} — one short paragraph: what is being decided and what changes`);
  } else {
    context = text(raw.context, `${named}.context`, MAX_CONTEXT_CHARS, errors, true);
  }
  const mediaItems = list(raw.media, `${named}.media`, 0, MAX_MEDIA_PER_CARD, errors,
    'show only the shots the decision depends on; link the rest through companionPage');
  const media = (mediaItems ?? []).map((item, index) => validateMedia(item, `${named}.media[${index}]`, errors));
  const questionItems = list(raw.questions, `${named}.questions`, 1, MAX_QUESTIONS_PER_CARD, errors,
    'split into separate cards or drop non-decisions');
  const questions = (questionItems ?? []).map((item, index) => validateQuestion(item, `${named}.questions[${index}]`, questionIds, errors));
  if (errors.length !== before || !id || !title || !context) return null;
  return {
    id, title, context,
    media: media.filter((item): item is ReviewMediaSpec => item !== null),
    questions: questions.filter((item): item is ReviewQuestion => item !== null),
  };
}

/** The deck as posted, checked against the format and its hard bounds; every problem is listed with where it is. */
export function validateReviewSpec(raw: unknown): { spec: ReviewSpec } | { errors: string[] } {
  const errors: string[] = [];
  if (!record(raw)) return { errors: ['the review must be a JSON object with "title" and "cards"'] };
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_SPEC_BYTES) {
    return { errors: [`the review is over ${MAX_SPEC_BYTES / 1024} KiB of JSON; shorten it`] };
  }
  unknownKeys(raw, ['title', 'companionPage', 'wait', 'cards'], 'the review', errors);
  const title = text(raw.title, 'title', MAX_TITLE, errors, true);
  const page = companionPage(raw.companionPage, errors);
  const wait = flag(raw.wait, 'wait', true, errors);
  const items = list(raw.cards, 'cards', 1, MAX_CARDS, errors, 'ask fewer things now, or post a follow-up deck after these answers');
  const cardIds = new Set<string>();
  const questionIds = new Set<string>();
  const cards = (items ?? []).map((item, index) => validateCard(item, `cards[${index}]`, cardIds, questionIds, errors));
  if (errors.length || !title) return { errors: errors.length ? errors : ['title is required'] };
  return { spec: { title, companionPage: page, wait, cards: cards.filter((card): card is ReviewCard => card !== null) } };
}

export function reviewQuestions(spec: ReviewSpec): ReviewQuestion[] {
  return spec.cards.flatMap(card => card.questions);
}

// ---- answers ---------------------------------------------------------------------

function sameValue(a: AnswerValue, b: AnswerValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}

function answerText(value: unknown, where: string, max: number, errors: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') { errors.push(`${where} must be text`); return null; }
  const trimmed = value.trim();
  if (trimmed.length > max) { errors.push(`${where} is ${trimmed.length} characters; max is ${max}`); return null; }
  return trimmed || null;
}

/**
 * The owner's answers checked against the deck: `{ [questionId]: { value?, note?, other? } }`.
 * A question left out is unanswered. `default` is true when the answer is the
 * question's own default with no "other" text.
 */
export function validateReviewAnswers(spec: ReviewSpec, raw: unknown): { answers: Record<string, QuestionAnswer> } | { errors: string[] } {
  const errors: string[] = [];
  if (!record(raw)) return { errors: ['answers must be an object keyed by question id'] };
  const questions = reviewQuestions(spec);
  const known = new Set(questions.map(question => question.id));
  for (const key of Object.keys(raw)) if (!known.has(key)) errors.push(`unknown question "${key}"`);
  const answers: Record<string, QuestionAnswer> = {};
  for (const question of questions) {
    const entry = raw[question.id] === undefined ? {} : raw[question.id];
    const where = `"${question.id}"`;
    if (!record(entry)) { errors.push(`${where} must be an object with "value"`); continue; }
    const choice = question.type === 'choice' || question.type === 'multi';
    unknownKeys(entry, question.type === 'text' ? ['value'] : choice ? ['value', 'note', 'other'] : ['value', 'note'], where, errors);
    const note = question.type === 'text' ? null : answerText(entry.note, `${where}.note`, MAX_NOTE, errors);
    const other = choice ? answerText(entry.other, `${where}.other`, MAX_NOTE, errors) : null;
    if (other && choice && !question.allowOther) errors.push(`${where} takes no "other" answer`);
    let value: AnswerValue = null;
    const given = entry.value === undefined ? null : entry.value;
    if (question.type === 'choice') {
      if (given !== null && (typeof given !== 'string' || !question.options.some(option => option.value === given))) {
        errors.push(`${where} must be one of ${question.options.map(option => option.value).join(', ')}`);
      } else value = given;
    } else if (question.type === 'multi') {
      if (given !== null && (!Array.isArray(given) || !given.every(item => typeof item === 'string' && question.options.some(option => option.value === item)))) {
        errors.push(`${where} must be a list of ${question.options.map(option => option.value).join(', ')}`);
      } else if (Array.isArray(given)) {
        value = question.options.map(option => option.value).filter(item => given.includes(item));
      }
    } else if (question.type === 'approve') {
      if (given !== null && given !== 'approve' && given !== 'revise') errors.push(`${where} must be "approve" or "revise"`);
      else value = given;
    } else if (question.type === 'text') {
      value = answerText(given, where, MAX_TEXT_ANSWER, errors);
      if (question.required && value === null) errors.push(`${where} is required`);
    }
    const answer: QuestionAnswer = { value, default: question.default !== null && !other && sameValue(value, question.default) };
    if (note) answer.note = note;
    if (other) answer.other = other;
    answers[question.id] = answer;
  }
  return errors.length ? { errors } : { answers };
}

/** Questions with a default whose answer is not it, in deck order. */
export function changedQuestions(spec: ReviewSpec, answers: Record<string, QuestionAnswer>): string[] {
  return reviewQuestions(spec).filter(question => question.default !== null && !answers[question.id]?.default).map(question => question.id);
}

/** What the agent receives, from the waiting CLI or `answers`: the design's structured answer. */
export function reviewResult(review: ReviewRecord) {
  const submission = review.submission;
  return {
    reviewId: review.id,
    title: review.spec.title,
    status: review.status,
    revision: submission ? 1 : 0,
    submittedAt: submission ? new Date(submission.submittedAt).toISOString() : null,
    changedFromDefault: submission?.changed ?? [],
    answers: submission?.answers ?? {},
    delivery: submission?.delivery ?? null,
  };
}

// ---- the delivered message ---------------------------------------------------------

function isoSeconds(at: number): string {
  return new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatValue(value: AnswerValue): string {
  if (value === null) return '(no answer)';
  if (Array.isArray(value)) return value.length ? value.map(item => visibleText(item)).join(', ') : '(none)';
  return visibleText(value);
}

function block(label: string, value: string): string[] {
  if (!value.includes('\n')) return [`${label}: ${value}`];
  return [`${label}: |`, ...value.split('\n').map(line => `  ${line}`)];
}

/**
 * Changed answers and answers with a note first, unchanged defaults
 * summarized, then answers to questions without a default; the footer names
 * the full answer set. The whole message fits MAX_MESSAGE_BYTES. In an OMP
 * session every line has OMP prompt syntax defused (see page-forms).
 */
export function formatReviewMessage(review: ReviewRecord, ompRecipient: boolean): string {
  const submission = review.submission;
  if (!submission) throw new Error('the review has no submission');
  const literal = ompRecipient ? literalPrompt : (line: string) => line;
  const title = visibleText(review.spec.title.replace(/\s+/g, ' '));
  const header = literal(`[review response: ${title} (${review.id}), submitted ${isoSeconds(submission.submittedAt)}]`);
  const raw: string[] = [];
  const questions = reviewQuestions(review.spec);
  const unanswered: string[] = [];
  let summarized = 0;
  const emit = (question: ReviewQuestion, answer: QuestionAnswer) => {
    const suffix = question.default !== null && !answer.default ? ` (default ${formatValue(question.default)})` : '';
    const hasValue = typeof answer.value === 'string' || (Array.isArray(answer.value) && answer.value.length > 0);
    if (answer.other && !hasValue) raw.push(...block(`${question.id}: other${suffix}`, visibleText(answer.other)));
    else {
      raw.push(...block(`${question.id}${suffix}`, formatValue(answer.value)));
      if (answer.other) raw.push(...block('  other', visibleText(answer.other)));
    }
    if (answer.note) raw.push(...block('  note', visibleText(answer.note)));
  };
  for (const question of questions) {
    const answer = submission.answers[question.id] ?? { value: null, default: false };
    if (question.default === null) continue;
    if (answer.default && !answer.note) { summarized++; continue; }
    emit(question, answer);
  }
  if (summarized) raw.push(raw.length ? 'all other questions with a default: default' : 'no changes from defaults');
  for (const question of questions) {
    if (question.default !== null) continue;
    const answer = submission.answers[question.id] ?? { value: null, default: false };
    if (answer.value === null && !answer.other && !answer.note) { unanswered.push(question.id); continue; }
    emit(question, answer);
  }
  if (unanswered.length) raw.push(`unanswered: ${unanswered.join(', ')}`);
  const lines = raw.map(literal);
  const footer = `full answer set: pi-dish-review answers ${review.id}`;
  const omitted = (count: number) => `… (${count} more lines in the full answer set)`;
  let used = Buffer.byteLength(header) + Buffer.byteLength(footer) + Buffer.byteLength(omitted(lines.length)) + 3;
  const kept: string[] = [];
  for (const [index, line] of lines.entries()) {
    const cost = Buffer.byteLength(line) + 1;
    if (used + cost > MAX_MESSAGE_BYTES) { kept.push(omitted(lines.length - index)); break; }
    kept.push(line);
    used += cost;
  }
  return [header, ...kept, footer].join('\n');
}

// ---- the store ----------------------------------------------------------------------

export function newReviewId(): string {
  return `rv_${crypto.randomBytes(8).toString('hex')}`;
}

function storeDir(): string {
  return path.join(dishDir(), 'reviews');
}

/** One owner-only file per session, named by a hash of its canonical id. */
function storeFile(sessionId: string): string {
  return path.join(storeDir(), `${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 32)}.json`);
}

function isRecordShape(value: unknown, sessionId: string): value is ReviewRecord {
  return record(value) && typeof value.id === 'string' && REVIEW_ID_RE.test(value.id) && value.sessionId === sessionId
    && typeof value.createdAt === 'number' && record(value.spec) && Array.isArray(value.media) && Array.isArray(value.assets)
    && (value.status === 'open' || value.status === 'submitted' || value.status === 'cancelled')
    && (value.submission === null || (record(value.submission) && typeof value.submission.id === 'string' && record(value.submission.delivery)))
    && (value.status === 'submitted') === (value.submission !== null);
}

function readFile(file: string): { sessionId: string; reviews: ReviewRecord[] } | null {
  let source: string;
  try { source = fs.readFileSync(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  // Fails closed: read as empty, a corrupt store could replay a delivered answer.
  const data: unknown = JSON.parse(source);
  if (!record(data) || typeof data.sessionId !== 'string' || !Array.isArray(data.reviews)) throw new Error(`${file} is malformed`);
  const sessionId = data.sessionId;
  if (!data.reviews.every(item => isRecordShape(item, sessionId))) throw new Error(`${file} holds a malformed review`);
  return { sessionId, reviews: data.reviews as ReviewRecord[] };
}

/** A session's decks, oldest first; a store that exists but cannot be read throws. */
export function readReviews(sessionId: string): ReviewRecord[] {
  return readFile(storeFile(sessionId))?.reviews ?? [];
}

export function writeReviews(sessionId: string, reviews: ReviewRecord[]): void {
  fs.mkdirSync(storeDir(), { recursive: true, mode: 0o700 });
  // Answered and cancelled decks are evicted first; open ones are bounded at creation.
  let kept = reviews;
  while (kept.length > KEPT_REVIEWS) {
    const index = kept.findIndex(review => review.status !== 'open'
      && !(review.submission && (review.submission.delivery.state === 'pending' || review.submission.delivery.state === 'delivering')));
    if (index < 0) break;
    kept = [...kept.slice(0, index), ...kept.slice(index + 1)];
  }
  replaceFileDurably(storeFile(sessionId), JSON.stringify({ sessionId, reviews: kept }) + '\n');
}

/** Reads, changes and writes one deck; null when the session has no such deck. */
export function updateReview(sessionId: string, reviewId: string, change: (review: ReviewRecord) => void): ReviewRecord | null {
  const reviews = readReviews(sessionId);
  const review = reviews.find(item => item.id === reviewId);
  if (!review) return null;
  change(review);
  writeReviews(sessionId, reviews);
  return review;
}

/** Removes one session's review store file, if it exists. */
export function deleteReviews(sessionId: string): void {
  try { fs.unlinkSync(storeFile(sessionId)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Every stored session's decks; an unreadable file is reported and skipped. */
export function readAllReviews(log: (line: string) => void): ReviewRecord[] {
  let names: string[];
  try { names = fs.readdirSync(storeDir()); } catch { return []; }
  const out: ReviewRecord[] = [];
  for (const name of names) {
    if (!/^[0-9a-f]{32}\.json$/.test(name)) continue;
    try { out.push(...readFile(path.join(storeDir(), name))?.reviews ?? []); }
    catch (error) { log(`[reviews] ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return out;
}

// ---- the browser's view -------------------------------------------------------------

/** A shot as the browser loads it: `asset` is a slot under the review's media route; otherwise `url`. */
export interface ClientMedia { label: string | null; alt: string | null; asset: number | null; url: string | null }
export interface ClientCard { id: string; title: string; context: string; questions: ReviewQuestion[]; media: ClientMedia[] }
/** What the inline deck renders: the spec with each shot resolved, plus status and answers. */
export interface ClientReview {
  id: string;
  sessionId: string;
  createdAt: number;
  anchorMessageIndex: number | null;
  title: string;
  companionPage: string | null;
  wait: boolean;
  status: ReviewStatus;
  cards: ClientCard[];
  submission: ReviewSubmission | null;
}

export function clientReview(review: ReviewRecord): ClientReview {
  return {
    id: review.id,
    sessionId: review.sessionId,
    createdAt: review.createdAt,
    anchorMessageIndex: review.anchorMessageIndex,
    title: review.spec.title,
    companionPage: review.spec.companionPage,
    wait: review.spec.wait,
    status: review.status,
    cards: review.spec.cards.map((card, cardIndex) => ({
      id: card.id, title: card.title, context: card.context, questions: card.questions,
      media: card.media.map((item, index) => {
        const source = review.media[cardIndex]?.[index];
        return {
          label: item.label, alt: item.alt,
          asset: source?.kind === 'asset' ? source.slot : null,
          url: source?.kind === 'url' ? source.url : null,
        };
      }),
    })),
    submission: review.submission,
  };
}
