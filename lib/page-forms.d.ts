// Generated from src/core/page-forms.ts; edit that source and run npm run build:core.
export type FieldType = 'choice' | 'grid' | 'multi' | 'yesno' | 'approve' | 'text' | 'longtext';
export type QuestionKind = 'choice' | 'multi' | 'bool' | 'text' | 'longtext';
export type Answer = string | string[] | boolean;
export interface FormOption {
    value: string;
    label: string;
    image: string | null;
    help: string | null;
}
/** One answerable item: a field, or one row of a choice grid. */
export interface FormQuestion {
    id: string;
    kind: QuestionKind;
    label: string;
    help: string | null;
    required: boolean;
    options: FormOption[];
    default: Answer | null;
    yes: string;
    no: string;
    placeholder: string | null;
}
export type FormSection = {
    kind: 'question';
    question: FormQuestion;
} | {
    kind: 'grid';
    id: string;
    label: string;
    help: string | null;
    options: FormOption[] | null;
    questions: FormQuestion[];
};
export interface FormSpec {
    title: string | null;
    intro: string | null;
    submitLabel: string | null;
    sections: FormSection[];
    questions: FormQuestion[];
}
export interface FormBlock {
    start: number;
    end: number;
    source: string;
}
export type ParsedForm = {
    spec: FormSpec;
    block: FormBlock;
} | {
    errors: string[];
    block: FormBlock | null;
};
/**
 * One accepted submission with its answers, stored before anything is sent;
 * `uncertain`: the agent may or may not have them. Kept in a bounded history.
 */
export type ReceiptState = 'delivering' | 'delivered' | 'failed' | 'uncertain';
export interface FormSubmission {
    id: string;
    state: ReceiptState;
    /** The page revision this submission becomes once delivered. */
    revision: number;
    acceptedAt: number;
    finishedAt: number | null;
    error: string | null;
    sessionId: string;
    fingerprint: string;
    answers: Record<string, Answer | null>;
    changed: string[];
}
/**
 * The durable record of a submission id, kept after its answers leave the
 * history: a retry of any id ever accepted reads it and is never dispatched again.
 */
export type FormReceiptRecord = Pick<FormSubmission, 'id' | 'state' | 'revision' | 'acceptedAt' | 'finishedAt' | 'error' | 'sessionId'>;
/** What the owner view polls: a receipt without its destination. */
export type FormReceipt = Omit<FormReceiptRecord, 'sessionId'>;
export declare const FIELD_TYPES: readonly FieldType[];
/** An option image that is served as given; anything else resolves under the page. */
export declare function isAbsoluteImage(url: string): boolean;
/** Advertised in /api/host; a hub relays form calls only to a host that has it. */
export declare const PAGE_FORMS_CAPABILITY = "pageFormsV2";
/** Submission ids, chosen by the form view; also checked before a hub relays one. */
export declare const SUBMISSION_ID_RE: RegExp;
/**
 * Required on every form route: `view` (the owner form view), `cli`
 * (pi-dish-pages) or `relay` (a hub's dedicated form relay). A cross-site page
 * cannot add a custom header without a CORS preflight these routes never
 * answer, so an older hub's generic relay, which strips Origin (and on plain
 * HTTP has no Fetch Metadata to forward), cannot carry a cross-site request.
 */
export declare const FORM_CLIENT_HEADER = "x-pi-dish-form-client";
/** Receipts are never evicted; a page that has taken this many takes no more. */
export declare const MAX_RECEIPTS = 2000;
/** The body a hub relays for one form call, and what every form response must fit. */
export declare const PAGE_FORMS_RELAY_LIMIT: number;
export declare const MAX_FORM_RESPONSE_BYTES: number;
export declare const MAX_ANSWER_BYTES: number;
/** Cheap pre-check before any parsing; matches every spelling the block regex accepts. */
export declare function mayContainForm(html: string): boolean;
/** The page document that may carry a form: an .html file root or a directory's index.html. */
export declare function pageDocumentPath(root: string): string | null;
/** Null when the document declares no form. */
export declare function parsePageForm(html: string): ParsedForm | null;
/** Reads the live page document; null when it has no form or cannot be read. */
export declare function readPageForm(root: string): ParsedForm | null;
export declare function parseFormSpec(source: string): {
    spec: FormSpec;
} | {
    errors: string[];
};
export declare function validateAnswers(spec: FormSpec, raw: unknown): {
    answers: Record<string, Answer | null>;
} | {
    errors: string[];
};
/** Questions with a default whose answer differs from it, in form order. */
export declare function changedQuestions(spec: FormSpec, answers: Record<string, Answer | null>): FormQuestion[];
export declare function visibleText(text: string): string;
export interface FormMessageInput {
    spec: FormSpec;
    answers: Record<string, Answer | null>;
    token: string;
    submissionId: string;
    pageTitle: string | null;
    submittedAt: number;
    revision: number;
    previousAt: number | null;
    /** The recipient is an OMP session (see literalPrompt). */
    ompRecipient: boolean;
}
/**
 * Changed answers first, unchanged defaults summarized, then answers that had
 * no default; the footer names this submission's own stored answer set. The
 * whole message, footer and omission marker included, fits MAX_MESSAGE_BYTES.
 */
export declare function formatFormMessage({ spec, answers, token, submissionId, pageTitle, submittedAt, revision, previousAt, ompRecipient }: FormMessageInput): string;
export interface FormRecord {
    /** The delivered revision, written with the outcome that advanced it. */
    revision: number;
    /** The delivered answer set the revision stands on, kept apart from the bounded history. */
    current: FormSubmission | null;
    /** Recent submissions with their answers, oldest first (bounded). */
    submissions: FormSubmission[];
    /** Every submission id ever accepted here, oldest first (never evicted). */
    receipts: FormReceiptRecord[];
}
export declare function readSubmissions(token: string): FormRecord;
export declare function receiptOf(receipt: FormReceiptRecord): FormReceipt;
/** Records an accepted submission, answers and receipt, before anything is sent. */
export declare function acceptSubmission(token: string, submission: FormSubmission): void;
/**
 * Settles a submission; a delivered one becomes the current answer set and
 * advances the revision in the same write. False when the page was
 * unpublished meanwhile: revocation removed the entry and wins.
 */
export declare function finishSubmission(token: string, id: string, outcome: Pick<FormSubmission, 'state' | 'error' | 'finishedAt'>): boolean;
export declare function deleteSubmissions(token: string): void;
/**
 * Everything the trusted owner form renders, image URLs resolved for it. A
 * grid's shared options travel once, on the grid; its rows carry only options
 * of their own. The fingerprint covers this (unresolved) plus the destination
 * session, so a view of another form or recipient cannot submit to this one.
 */
export declare function clientSpec(spec: FormSpec, resolveImage?: (url: string) => string | null): {
    title: string | null;
    intro: string | null;
    submitLabel: string | null;
    sections: ({
        kind: 'question';
        question: {
            id: string;
            kind: QuestionKind;
            label: string;
            help: string | null;
            required: boolean;
            default: Answer | null;
            yes: string;
            no: string;
            placeholder: string | null;
            options: {
                value: string;
                label: string;
                help: string | null;
                image: string | null;
            }[] | null;
        };
        id?: undefined;
        label?: undefined;
        help?: undefined;
        options?: undefined;
        questions?: undefined;
    } | {
        question?: undefined;
        kind: 'grid';
        id: string;
        label: string;
        help: string | null;
        options: {
            value: string;
            label: string;
            help: string | null;
            image: string | null;
        }[] | null;
        questions: {
            id: string;
            kind: QuestionKind;
            label: string;
            help: string | null;
            required: boolean;
            default: Answer | null;
            yes: string;
            no: string;
            placeholder: string | null;
            options: {
                value: string;
                label: string;
                help: string | null;
                image: string | null;
            }[] | null;
        }[];
    })[];
};
export declare function formFingerprint(spec: FormSpec, sessionId: string): string;
/** Shared by the artifact's inline preview and the owner form view's stylesheet. */
export declare const FORM_STYLE = "\n.pdf{--pdf-accent:#268bd2;color-scheme:light dark;font:16px/1.45 ui-sans-serif,system-ui,sans-serif;color:CanvasText;background:Canvas;\n  border:1px solid color-mix(in srgb,CanvasText 22%,Canvas);border-radius:12px;margin:16px 0;padding:0;max-width:100%}\n.pdf *{box-sizing:border-box}\n.pdf-head{padding:14px 16px 4px}.pdf-head h2{margin:0 0 6px;font-size:1.2em}.pdf-head p{margin:0 0 8px;white-space:pre-wrap}\n.pdf-notice{margin:8px 16px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,var(--pdf-accent) 12%,Canvas);font-size:14px}\n.pdf-notice:empty{display:none}\n.pdf-section{margin:0;padding:10px 16px;border:0;border-top:1px solid color-mix(in srgb,CanvasText 12%,Canvas)}\n.pdf-section>h3{margin:4px 0;font-size:1.05em}\n.pdf-q{margin:0;padding:10px 12px;border:0;border-left:4px solid transparent;border-radius:6px;min-width:0}\n.pdf-section>.pdf-q{padding-left:12px}\n.pdf-q[data-changed]{border-left-color:var(--pdf-accent);background:color-mix(in srgb,var(--pdf-accent) 7%,Canvas)}\n.pdf-q legend{padding:0;font-weight:600;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}\n.pdf-id{font:12px ui-monospace,monospace;padding:1px 6px;border-radius:4px;background:color-mix(in srgb,CanvasText 10%,Canvas)}\n.pdf-req{font-size:12px;font-weight:400;color:#cb4b16}\n.pdf-flag{display:none;font-size:12px;font-weight:600;color:var(--pdf-accent)}\n.pdf-q[data-changed] .pdf-flag{display:inline}\n.pdf-help{margin:4px 0 0;font-size:14px;color:color-mix(in srgb,CanvasText 70%,Canvas);white-space:pre-wrap}\n.pdf-opts{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}\n.pdf-opts.pdf-images{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}\n.pdf-opt{position:relative;display:flex;flex-direction:column;justify-content:center;gap:6px;min-height:44px;min-width:44px;padding:8px 12px;\n  border:1px solid color-mix(in srgb,CanvasText 25%,Canvas);border-radius:8px;cursor:pointer;background:Canvas}\n.pdf-opt:has(input:checked){border-color:var(--pdf-accent);box-shadow:0 0 0 2px var(--pdf-accent)}\n.pdf-opt:has(input:focus-visible){outline:2px solid var(--pdf-accent);outline-offset:2px}\n.pdf-opt input{position:absolute;opacity:0;pointer-events:none}\n.pdf-opt img{display:block;width:100%;height:auto;max-height:260px;object-fit:contain;border-radius:4px}\n.pdf-opt-label{display:flex;gap:6px;align-items:center;flex-wrap:wrap}\n.pdf-opt-label::before{content:\"\";flex:none;width:18px;height:18px;border:2px solid color-mix(in srgb,CanvasText 45%,Canvas);border-radius:50%}\n.pdf-opt[data-multi] .pdf-opt-label::before{border-radius:4px}\n.pdf-opt:has(input:checked) .pdf-opt-label::before{border-color:var(--pdf-accent);background:radial-gradient(var(--pdf-accent) 45%,transparent 50%)}\n.pdf-opt[data-multi]:has(input:checked) .pdf-opt-label::before{background:var(--pdf-accent)}\n.pdf-default{font-size:11px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,CanvasText 12%,Canvas)}\n.pdf-opt-help{font-size:13px;color:color-mix(in srgb,CanvasText 70%,Canvas)}\n.pdf-text{display:block;width:100%;min-height:44px;margin-top:8px;padding:10px;font:inherit;color:CanvasText;background:Canvas;\n  border:1px solid color-mix(in srgb,CanvasText 30%,Canvas);border-radius:8px}\ntextarea.pdf-text{min-height:96px;resize:vertical}\n.pdf-bar{position:sticky;bottom:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 16px;\n  border-top:1px solid color-mix(in srgb,CanvasText 18%,Canvas);border-radius:0 0 12px 12px;background:Canvas;box-shadow:0 -6px 16px #0002}\n.pdf-summary{flex:1 1 200px;font-size:14px;min-width:0;overflow-wrap:anywhere}\n.pdf-status{flex:1 1 100%;font-size:13px;color:color-mix(in srgb,CanvasText 70%,Canvas)}\n.pdf-status:empty{display:none}\n.pdf-status[data-tone=error]{color:#dc322f}\n.pdf-status[data-tone=ok]{color:#2aa035}\n.pdf-status[data-tone=warn]{color:#b58900}\n.pdf-submit{min-height:44px;min-width:44px;padding:10px 18px;font:inherit;font-weight:600;color:#fff;background:var(--pdf-accent);\n  border:0;border-radius:8px;cursor:pointer}\n.pdf-submit:disabled{opacity:.55;cursor:default}\n.pdf-button{min-height:44px;min-width:44px;padding:10px 14px;font:inherit;color:CanvasText;background:Canvas;\n  border:1px solid color-mix(in srgb,CanvasText 35%,Canvas);border-radius:8px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}\n.pdf-answer{display:inline-flex;align-items:center;min-height:44px;margin-top:6px;padding:10px 16px;font-weight:600;color:#fff;\n  background:var(--pdf-accent);border-radius:8px;text-decoration:none}\n.pdf-preview-notice{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:15px;font-weight:600;\n  border:2px solid var(--pdf-accent);box-shadow:0 4px 12px #0003;scroll-margin-top:8px}\n.pdf-preview-notice .pdf-answer{margin-top:0}\n.pdf:has(.pdf-preview-cover:active) .pdf-preview-notice,.pdf-preview-notice:target{outline:3px solid var(--pdf-accent);outline-offset:2px}\n.pdf-preview{position:relative}\n.pdf-preview-cover{position:absolute;inset:0;z-index:1;cursor:not-allowed}\n.pdf fieldset:disabled .pdf-opt,.pdf fieldset:disabled .pdf-text{cursor:not-allowed;color:color-mix(in srgb,CanvasText 55%,Canvas);\n  background:color-mix(in srgb,CanvasText 7%,Canvas);border-style:dashed}\n.pdf fieldset:disabled .pdf-opt:has(input:checked){border-color:color-mix(in srgb,CanvasText 45%,Canvas);\n  box-shadow:0 0 0 2px color-mix(in srgb,CanvasText 45%,Canvas)}\n.pdf fieldset:disabled .pdf-opt-label::before{opacity:.5}\n.pdf fieldset:disabled .pdf-opt:has(input:checked) .pdf-opt-label::before{background:radial-gradient(color-mix(in srgb,CanvasText 45%,Canvas) 45%,transparent 50%);\n  border-color:color-mix(in srgb,CanvasText 45%,Canvas)}\n.pdf-error{margin:16px 0;padding:12px 16px;border:2px solid #dc322f;border-radius:10px;font:14px/1.4 ui-sans-serif,system-ui,sans-serif}\nbody.pdf-app{margin:0 auto;padding:12px;max-width:860px;font:16px/1.45 ui-sans-serif,system-ui,sans-serif;color-scheme:light dark}\n.pdf-app-nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}\n.pdf-app-nav h1{margin:0;font-size:1.25em}\n.pdf-actions{display:flex;flex-wrap:wrap;gap:8px;flex:1 1 100%}\n.pdf-actions:empty{display:none}\n.pdf-conflict{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 16px;padding:12px 16px;border:2px solid #dc322f;border-radius:10px;font-size:14px;scroll-margin-top:12px}\n.pdf-conflict:empty{display:none}\n.pdf-conflict p{flex:1 1 100%;margin:0}\n";
/**
 * The artifact's copy: disabled controls showing the defaults, no submit and
 * no data beyond the page's own source. `answerHref` links the owner to
 * pi-dish's form view where the serving front has one. The notice sticks to
 * the top of the form, and a cover over the questions turns any tap on them
 * into a jump to it; no script, so the page's own CSP cannot break it.
 */
export declare function renderForm(spec: FormSpec, answerHref: string | null): string;
/** Replaces the declaration block with the rendered form, or with its errors. */
export declare function renderPageForm(html: string, parsed: ParsedForm, answerHref: string | null): string;
