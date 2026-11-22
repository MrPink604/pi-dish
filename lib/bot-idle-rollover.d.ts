// Generated from src/core/bot-idle-rollover.ts; edit that source and run npm run build:core.
import type { CacheRetentionConfig } from './cache-retention';
import { type CacheExpiry } from './session-metadata';
/** The key in `~/.pi/dish/settings.json`; `false` turns the feature off, an object tunes it. */
export declare const IDLE_ROLLOVER_SETTING = "botIdleRollover";
/** The decision log in each bot's directory: one JSON line per plan, draft, skip, outcome and return. Best-effort. */
export declare const IDLE_ROLLOVER_LOG = "idle-rollover.jsonl";
/** The draft's request must still read the cache: closer to expiry than this, it is too late. */
export declare const MIN_WARM_MS = 60000;
export interface IdleRolloverConfig {
    enabled: boolean;
    /** Trigger A: a window holding this many tokens, or `minPercent` of the window limit, whichever is lower. */
    minTokens: number;
    minPercent: number;
    /** Trigger A: only caches that live at least this long; shorter ones would roll over at every pause. */
    minRetentionMs: number;
    /** Trigger A fires this long before expiry: the larger of `leadMs` and `leadPercent` of the TTL. */
    leadMs: number;
    leadPercent: number;
    /** Trigger B: a window at least this full rolls over once idle `earlyIdleMs` while the cache is warm. */
    earlyPercent: number;
    earlyIdleMs: number;
}
export declare const IDLE_ROLLOVER_DEFAULTS: Readonly<IdleRolloverConfig>;
/**
 * The configuration for one bot: the defaults, then `botIdleRollover` in settings, then its `bots` entry for this bot
 * (by id, or by name ignoring case). Either layer may be `false` to turn the feature off.
 */
export declare function idleRolloverConfig(settings: unknown, bot: {
    id: string;
    name: string;
}): IdleRolloverConfig;
/**
 * The window's prompt-cache expiry, projected through its assistant messages oldest first, as the session list
 * projects it from the bot's mirror (a warm read keeps the tier its write chose).
 */
export declare function windowCacheExpiry(messages: readonly unknown[], config: CacheRetentionConfig): CacheExpiry | null;
export type IdleRolloverTrigger = 'expiry' | 'early';
export interface IdleRolloverState {
    now: number;
    config: IdleRolloverConfig;
    cache: Pick<CacheExpiry, 'expiresAt' | 'retentionMs' | 'retention' | 'basis'> | null;
    /** The window's size: the last answer's input, output and cache tokens. */
    tokens: number;
    windowLimit: number;
    /** When the bot last went idle. */
    idleSince: number;
    /** A run (a script is part of one) or input this relay is still taking. */
    busy: boolean;
    /** Input queued for the next run. */
    queued: boolean;
    /** A worker's report is being posted. */
    reportPending: boolean;
    /** This window already had its one attempt. */
    attempted: boolean;
    /** Anything happened in this window beyond its handoff. */
    workSinceRollover: boolean;
    /** The bot's next scheduled routine run; null when none. */
    nextRoutineAt: number | null;
    /** Why this bot may not roll over at all (paused, on another model than its last answer); null when it may. */
    ineligible: string | null;
}
/** What the decision log records with each plan. */
export interface IdleRolloverFacts {
    tokens: number;
    percent: number;
    expiresAt: number | null;
    retention: string | null;
    basis: string | null;
    idleMs: number;
}
export type IdleRolloverPlan = IdleRolloverFacts & ({
    action: 'roll';
    trigger: IdleRolloverTrigger;
} | {
    action: 'wait';
    trigger: IdleRolloverTrigger;
    at: number;
} | {
    action: 'skip';
    reason: string;
});
/** The lead before expiry at which trigger A fires. */
export declare function idleRolloverLead(config: IdleRolloverConfig, retentionMs: number): number;
/**
 * Whether to roll the window over now, when to look again, or why not in this idle period. A skip is final until the
 * next run ends: anything that changes the answer (a turn, queued input, a report, a routine run) ends in one.
 */
export declare function planIdleRollover(state: IdleRolloverState): IdleRolloverPlan;
/**
 * The draft's request, sent to a fork of the conversation. It starts like the context reminder, so the reminder is not
 * added to it as well. Tools are blocked in a fork: the answer is the only thing taken from it. `notebook` is the
 * notebook as stored now: the window's instructions hold the one it opened with, and context_notes may have replaced
 * it since. It comes last, after the cached prefix, with any `</notebook>` inside it escaped so it cannot end the block.
 */
export declare function composeIdleDraftRequest(plan: IdleRolloverFacts, now: number, maxBytes: number, notebook: string): string;
/**
 * The summary and notebook of a draft answer, or why it is not one. Only the exact form counts: `Summary: <line>`, then
 * the notebook between its marker lines (each alone on its line, trailing blanks allowed), then nothing. Anything else
 * (a refusal, a fragment, prose around it) is a decline.
 */
export declare function parseNotebookDraft(text: string, maxBytes: number): {
    summary: string;
    notebook: string;
} | {
    error: string;
};
/** A notebook smaller than this is replaced whatever its draft's size. */
export declare const SHRINK_GUARD_MIN_BYTES = 1024;
/** A draft keeps at least this share of a larger notebook's bytes, or it is refused. */
export declare const SHRINK_GUARD_RATIO = 0.5;
/** Why a draft may not replace `previous`: it would drop more than half of a notebook that held something. */
export declare function notebookShrinkRefusal(previous: string, next: string): string | null;
/** A version of a notebook: the draft is applied only over the notebook it was shown. */
export declare function notebookDigest(notebook: string): string;
/** The decision log keeps its newest megabyte or two: past it, the file moves to `.1`, replacing the one before. */
export declare const IDLE_ROLLOVER_LOG_MAX_BYTES: number;
/**
 * Appends one decision to the log, owner-only (0600) like its rotated copy. A failed rotation still appends, then
 * throws so the caller reports it; the log only grows past its cap until a rotation succeeds.
 */
export declare function appendDecisionLog(file: string, entry: unknown, maxBytes?: number): void;
