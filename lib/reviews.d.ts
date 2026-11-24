// Generated from src/core/reviews.ts; edit that source and run npm run build:core.
export declare const REVIEWS_CAPABILITY = "reviewsV1";
export declare const MAX_CARDS = 6;
export declare const MAX_QUESTIONS_PER_CARD = 3;
export declare const MAX_MEDIA_PER_CARD = 4;
export declare const MAX_CONTEXT_CHARS = 500;
export declare const MAX_TEXT_ANSWER = 2000;
export declare const MAX_NOTE = 1000;
/** A deck's JSON as posted; far above anything the bounds above allow, so it only stops abuse. */
export declare const MAX_SPEC_BYTES: number;
/** Open decks per session: an agent that keeps posting without waiting is refused. */
export declare const MAX_OPEN_REVIEWS = 10;
export declare const REVIEW_ID_RE: RegExp;
export declare const SUBMISSION_ID_RE: RegExp;
export type QuestionType = 'choice' | 'multi' | 'approve' | 'text';
export declare const QUESTION_TYPES: readonly QuestionType[];
export interface ReviewOption {
    value: string;
    label: string;
    description: string | null;
}
interface QuestionBase {
    id: string;
    prompt: string;
}
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
export interface ReviewMediaSpec {
    src: string;
    label: string | null;
    alt: string | null;
}
export interface ReviewCard {
    id: string;
    title: string;
    context: string;
    media: ReviewMediaSpec[];
    questions: ReviewQuestion[];
}
export interface ReviewSpec {
    title: string;
    companionPage: string | null;
    wait: boolean;
    cards: ReviewCard[];
}
/** How a shot is served: one of the review's resolved local files, or a URL the browser loads itself. */
export type MediaSource = {
    kind: 'asset';
    slot: number;
} | {
    kind: 'url';
    url: string;
};
/** A local file a shot resolved to when the deck was created. */
export interface ReviewAsset {
    path: string;
    realPath: string;
    mimeType: string;
}
export type AnswerValue = string | string[] | null;
export interface QuestionAnswer {
    value: AnswerValue;
    default: boolean;
    note?: string;
    other?: string;
}
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
/** The token a `/page/<token>[/asset]` reference names, or null. */
export declare function pageToken(src: string): string | null;
/** The deck as posted, checked against the format and its hard bounds; every problem is listed with where it is. */
export declare function validateReviewSpec(raw: unknown): {
    spec: ReviewSpec;
} | {
    errors: string[];
};
export declare function reviewQuestions(spec: ReviewSpec): ReviewQuestion[];
/**
 * The owner's answers checked against the deck: `{ [questionId]: { value?, note?, other? } }`.
 * A question left out is unanswered. `default` is true when the answer is the
 * question's own default with no "other" text.
 */
export declare function validateReviewAnswers(spec: ReviewSpec, raw: unknown): {
    answers: Record<string, QuestionAnswer>;
} | {
    errors: string[];
};
/** Questions with a default whose answer is not it, in deck order. */
export declare function changedQuestions(spec: ReviewSpec, answers: Record<string, QuestionAnswer>): string[];
/** What the agent receives, from the waiting CLI or `answers`: the design's structured answer. */
export declare function reviewResult(review: ReviewRecord): {
    reviewId: string;
    title: string;
    status: ReviewStatus;
    revision: number;
    submittedAt: string | null;
    changedFromDefault: string[];
    answers: Record<string, QuestionAnswer>;
    delivery: ReviewDelivery | null;
};
/**
 * Changed answers and answers with a note first, unchanged defaults
 * summarized, then answers to questions without a default; the footer names
 * the full answer set. The whole message fits MAX_MESSAGE_BYTES. In an OMP
 * session every line has OMP prompt syntax defused (see page-forms).
 */
export declare function formatReviewMessage(review: ReviewRecord, ompRecipient: boolean): string;
export declare function newReviewId(): string;
/** A session's decks, oldest first; a store that exists but cannot be read throws. */
export declare function readReviews(sessionId: string): ReviewRecord[];
export declare function writeReviews(sessionId: string, reviews: ReviewRecord[]): void;
/** Reads, changes and writes one deck; null when the session has no such deck. */
export declare function updateReview(sessionId: string, reviewId: string, change: (review: ReviewRecord) => void): ReviewRecord | null;
/** Every stored session's decks; an unreadable file is reported and skipped. */
export declare function readAllReviews(log: (line: string) => void): ReviewRecord[];
/** A shot as the browser loads it: `asset` is a slot under the review's media route; otherwise `url`. */
export interface ClientMedia {
    label: string | null;
    alt: string | null;
    asset: number | null;
    url: string | null;
}
export interface ClientCard {
    id: string;
    title: string;
    context: string;
    questions: ReviewQuestion[];
    media: ClientMedia[];
}
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
export declare function clientReview(review: ReviewRecord): ClientReview;
export {};
