// Generated from src/core/bot-runtime.ts; edit that source and run npm run build:core.
import type * as Durable from '@earendil-works/pi-durable' with { 'resolution-mode': 'import' };
import type { Message, Models, AssistantMessage } from '@earendil-works/pi-ai' with { 'resolution-mode': 'import' };
import type { BotPlace, BotRow } from './bot-registry';
import type { BotMirror } from './bot-mirror';
import { type KnowledgeScope } from './knowledge';
import type { ProtocolRecord } from './wire-protocol';
import { type CacheRetentionConfig } from './cache-retention';
/** The notebook's cap, in UTF-8 bytes. */
export declare const NOTEBOOK_MAX_BYTES: number;
/** Total UTF-8 byte cap for injected `<knowledge-index>` content (shared + bot combined). */
export declare const KB_INDEX_MAX_BYTES: number;
/** A window is sized to this many tokens even on a model with a larger context. */
export declare const WINDOW_TOKEN_CAP = 200000;
/** From this share of the window on, each request carries a reminder to roll over. */
export declare const REMINDER_RATIO = 0.75;
/** At this share the relay requests one notebook rescue turn (or rolls over if already saved). */
export declare const FORCED_RATIO = 0.9;
/** At or above this share, forced rollover runs immediately without spending a rescue turn. */
export declare const HARD_FORCED_RATIO = 0.97;
/** A code mode script ends with an error after this long, whatever its options line asks for: the bot is busy while it runs. */
export declare const SCRIPT_TIME_CAP_MS: number;
/** Runs the pi-dish-sessions CLI as the bot; resolves with its stdout. `signal` stops it. */
export type SessionsPort = (args: string[], signal?: AbortSignal) => Promise<string>;
/** pi-dish's HTTP API on the hub: GET `path`, or POST it `body`; resolves with the JSON answer. */
export type HubApi = (path: string, body?: ProtocolRecord) => Promise<unknown>;
export type BridgeEmit = (event: string, data: ProtocolRecord) => void;
export interface SettledWorker {
    state: 'finished' | 'waiting' | 'inactive';
    totalMessages: number;
    text: string;
    /** A finished turn that failed: its answer is the error, not a result. */
    failed?: 'error' | 'aborted';
}
/** Text blocks of a Pi message, joined; tool calls and thinking are left out. */
export declare function messageText(message: unknown): string;
/** The image blocks of a Pi message: how many, and their base64 characters. */
export declare function imageLoad(message: unknown): ImageLoad;
/** `messageText` for a text path (a handoff, history): an image the message held is noted, its data never carried. */
export declare function messageTextNotingImages(message: unknown): string;
/** One image of a bot prompt, as pi-ai holds it. */
export interface BotImage {
    type: 'image';
    data: string;
    mimeType: string;
}
/** Images held by a context window, or arriving in one message. */
export interface ImageLoad {
    count: number;
    bytes: number;
}
/** The largest image a bot takes, in base64 characters: Pi's own per-image limit, under Anthropic's 5 MB. */
export declare const BOT_IMAGE_MAX_BYTES: number;
/**
 * A window holds at most this many images, and this many base64 characters of them: every request in the window
 * sends them all again, and Anthropic refuses a request over 32 MB or tightens its image limits past 20 images.
 */
export declare const BOT_WINDOW_IMAGE_MAX_COUNT = 20;
export declare const BOT_WINDOW_IMAGE_MAX_BYTES: number;
/** Bedrock's limit on an image side, the strictest a bot's routes have; the PWA sends at most 1568 px. */
export declare const BOT_IMAGE_MAX_SIDE = 8000;
/**
 * The type and size of a PNG or JPEG, read from its own bytes, or null when it is neither or is not whole: a PNG needs
 * IHDR first, then IDAT and IEND, each chunk within the data; a JPEG needs SOI, a frame header (SOF), a scan (SOS)
 * and then EOI. A cheap check of structure, not a decode.
 */
export declare function imageHeader(bytes: Buffer): {
    mimeType: string;
    width: number;
    height: number;
} | null;
/**
 * The images of a bridge `prompt` or `steer` frame, checked by their content before anything stores them: a whole
 * PNG or JPEG (the PWA sends JPEG) no larger than 8000 px a side, typed by its bytes whatever type it claims. Anything
 * else, GIF, WebP and SVG included, is refused with the reason, never dropped: a provider that cannot decode a stored
 * image would fail every later request of the window.
 */
export declare function botImages(value: unknown): BotImage[];
/**
 * Why `images` may not join a window that already holds `held`, on a model whose pi-ai `input` is given; null when
 * they may. A model without image input would see a placeholder instead, so it is refused rather than dropped.
 */
export declare function botImageRefusal(images: readonly BotImage[], held: ImageLoad, input: readonly string[] | undefined, model: string): string | null;
/**
 * The settle rule `pi-dish-sessions wait` uses: a worker has settled when it is
 * not working or compacting, its transcript holds more than `since` messages,
 * and its newest message ends the turn (`turnEnd`): a tool result, a notice or
 * a tool call between steps does not, nor does a prompt not picked up yet. A
 * pending question counts as settled. A stopped session without such an end
 * settles as inactive. Only the newest message is read, so a step in
 * between never brings back an older answer. `session` is the resolve row;
 * `window` is `/messages?limit=1`. Null means keep waiting.
 */
export declare function settledWorker(session: unknown, window: unknown, since: number): SettledWorker | null;
export interface WorkerRecord {
    name: string;
    /** The full session id, host-qualified for a remote worker. */
    ref: string;
    /** The full session id the routes speak. */
    sessionId: string;
    harness: string;
    host: string | null;
    startedAt: string;
    /** Reports delivered so far; the watch posts one per settle with new messages. */
    reports: number;
    /** Set by the bot's own close: once the session stops, the watch ends without a report. */
    closing?: true;
    /** Messages a script already took with `sessions wait`: the watch does not report an answer within them. */
    seen?: number;
    /** Harness time until which a script waits for this worker's answer with `sessions wait`; the watch holds its report. */
    waitingUntil?: number;
    /** When the session was seen to stop or was closed. */
    closedAt?: string;
    /** When the watch ended: the session stopped, or 24 hours passed. */
    watchEndedAt?: string;
}
/** Whether a ref names this worker through any of the CLI's equivalent forms. */
export declare function workerRefMatches(worker: WorkerRecord, wanted: string): boolean;
/** Find one owned worker by unique direct id or alias prefix match. */
export declare function findOwnedWorker(memory: BotMemory | undefined, wanted: string, options?: {
    openOnly?: boolean;
}): [string, WorkerRecord] | undefined;
export interface ClosedWindow {
    line: string;
    closedAt: string;
    forced: boolean;
    notebookUnsaved?: boolean;
    /** Closed by the idle rollover, from a notebook drafted before the prompt cache expired. */
    idle?: boolean;
}
/** The one idle rollover of a context window: its draft, and what came of it. */
export interface IdleAttempt {
    /** The context head (its head marker's entry id, 0 before the first) it was made in: the once-per-window key. */
    head: number;
    /** The newest entry when the draft started: the window is closed only if it is still the newest. */
    latest: number;
    /** The notebook the draft was shown (`notebookDigest`): it is applied only over that notebook. */
    notebookDigest: string;
    /** The window's number, for the log. */
    window: number;
    requestedAt: number;
    expiresAt: number;
    /** The fork the notebook is drafted in. */
    fork: Durable.ConversationId;
    result?: 'rolled-over' | 'not-rolled-over';
    /** Why it did not roll over. */
    reason?: string;
    resultAt?: number;
    /** The next real input after a rollover was logged. */
    returned?: boolean;
}
export interface BotMemory {
    notebook: string;
    /** How many windows were closed when the notebook was last saved; -1 for never. */
    notebookSavedIn: number;
    /** Window index (`windows.length`) that already received its one 90%-limit rescue turn. */
    limitRescueIn?: number;
    idleAttempt?: IdleAttempt;
    windows: ClosedWindow[];
    workers: Record<string, WorkerRecord>;
}
/** Why `new_context` is refused, or null when it may run. */
export declare function newContextRefusal(memory: BotMemory, workSinceRollover: boolean): string | null;
export interface KnowledgeIndexes {
    bot?: string | null;
    shared?: string | null;
}
/**
 * Formats an `index.md` body for injection into `<knowledge-index>`, capped at
 * `maxBytes` UTF-8 bytes without cutting mid-line and adding an "…and N more"
 * trailer when truncated.
 */
export declare function formatKnowledgeIndex(indexMarkdown: string, maxBytes?: number, scope?: KnowledgeScope): string | null;
/**
 * Formats both shared and bot KB indexes under a single combined UTF-8 byte
 * cap: each scope gets at least half when both are large, and any unused budget
 * from one scope is available to the other.
 */
export declare function formatKnowledgeIndexes(sharedMarkdown: string | null, botMarkdown: string | null, totalMaxBytes?: number): KnowledgeIndexes;
/** The instructions of a window: fixed when it opens, never rewritten inside it. */
export declare function composeInstructions(identity: string, notebook: string, places?: readonly BotPlace[], knowledgeIndex?: string | KnowledgeIndexes | null): string;
export interface HandoffInput {
    windowNumber: number;
    closed: readonly ClosedWindow[];
    tail: readonly {
        role: string;
        text: string;
    }[];
    request: string | null;
    workers: readonly WorkerRecord[];
    /** True when the window was closed at the context limit after a run; false when the bot's own new_context closed it. */
    forced: boolean;
    /** True when a forced rollover closed a window whose notebook was never saved during that window. */
    notebookUnsaved?: boolean;
    /** True when pi-dish opened the window while the bot was idle, before the prompt cache expired. */
    idle?: boolean;
    /** True when the bot called new_context in response to a bot.limit rescue notice after answering its last request. */
    afterLimit?: boolean;
}
/** An idle rollover's handoff quotes at most this much of the latest request; history has the rest. */
export declare const IDLE_HANDOFF_REQUEST_CHARS = 1500;
/** Any other rollover caps a giant latest request so the new window cannot overflow on turn 1; history has the rest. */
export declare const MAX_HANDOFF_REQUEST_CHARS = 16000;
/** At most `chars` code units of `text`, never ending between the two halves of a surrogate pair. */
export declare function cutText(text: string, chars: number): string;
/**
 * The first message of a new window: what the bot needs that its notebook does not hold. The latest request is
 * shown with what became of it: a rollover the bot made while handling it is done, and must not be read as a request
 * to roll over again. An idle rollover quotes only the start of a long request, so the new window stays small.
 */
export declare function composeHandoff({ windowNumber, closed, tail, request, workers, forced, notebookUnsaved, idle, afterLimit }: HandoffInput): string;
/** A sub-bot's start, written by its parent into the sub-bot's directory and read once by its first relay. */
export declare const FORK_SEED = "fork.json";
/** A sub-bot that starts from a copy of its parent's conversation. */
export interface ForkSeed {
    fresh?: false;
    parentId: string;
    parentName: string;
    /** The parent's instructions for its current window, which the sub-bot keeps until its first rollover. */
    instructions: string;
    /** The parent's thinking level for its current window: a request at another level would not reuse its cache. */
    thinkingLevel: string;
    /** The sub-bot's first message. */
    purpose: string;
    /** The parent's current window up to its last request, entry for entry. */
    entries: {
        kind: string;
        model?: Message[];
        data?: Durable.EntryRecord['data'];
        head?: 'self';
    }[];
}
/** A sub-bot that starts with an empty conversation and its own identity: only its purpose comes from its parent. */
export interface FreshSeed {
    fresh: true;
    parentId: string;
    parentName: string;
    purpose: string;
}
export type BotSeed = ForkSeed | FreshSeed;
/** A relayed room message, cross-family question or answer, routine run, or CI event. */
export interface BotInput {
    kind: 'room' | 'ask' | 'answer' | 'routine' | 'ci';
    requestId: string;
    text: string;
    data: Record<string, string | number>;
}
/** A sub-bot's first message: its purpose, and that the conversation above it is its parent's. */
export declare function composePurpose(parent: string, child: string, purpose: string): string;
/** A fresh sub-bot's first message: its purpose, with nothing of its parent's conversation before it. */
export declare function composeFreshPurpose(parent: string, child: string, purpose: string): string;
export interface BotModels {
    models: Models;
    close(): Promise<void>;
}
/**
 * `claude-code/<id>` runs on the Claude subscription through the Claude Code
 * CLI; anything else goes through Pi's model runtime and its credentials.
 */
export declare function openBotModels(selector: string): Promise<BotModels>;
export interface BotRuntimeOptions {
    bot: BotRow;
    /** `durable.sqlite`; `:memory:` keeps nothing. */
    storageFile: string;
    mirror: BotMirror;
    models: Models;
    sessions: SessionsPort;
    /** The knowledge routes are reached through this. */
    api: HubApi;
    /** The bot's current registry row, read when a window opens. */
    loadBot(): BotRow;
    emit: BridgeEmit;
    /** Called after each change of what the bridge claim reports. */
    changed(): void;
    log(line: string): void;
    /** Initial and longest delay between polls of a worker. */
    pollMs?: {
        first: number;
        max: number;
    };
    /** A code mode script's time cap; `SCRIPT_TIME_CAP_MS` by default. */
    scriptTimeoutMs?: number;
    /** Where every bot's directory lives: a sub-bot's start is written into its own. */
    botsDir: string;
    /** The pre-expiry idle rollover's inputs and its decision log; each has a default but `record`. */
    idleRollover?: IdleRolloverPorts;
}
/** One line of the idle-rollover decision log. */
export type IdleRolloverRecord = Record<string, string | number | boolean | null>;
export interface IdleRolloverPorts {
    /** `~/.pi/dish/settings.json`, read at each decision so a change applies from the next one. */
    settings?(): unknown;
    /** The cache TTL overrides from the same file. */
    cacheRetention?(): CacheRetentionConfig;
    /** When the bot's next scheduled routine run is due, from `from` on; null when none is. */
    nextRoutineAt?(from: number): number | null;
    /** Each decision: planned, triggered or skipped and why, the outcome, and how soon the user came back. */
    record?(entry: IdleRolloverRecord): void;
    /** The clock and timer the decisions run on; tests advance a fake one. */
    clock?: {
        now(): number;
        setTimeout(callback: () => void, ms: number): unknown;
        clearTimeout(handle: unknown): void;
    };
}
export interface BotActivity {
    running: boolean;
    queued: boolean;
}
export interface BotRuntime {
    readonly busy: boolean;
    readonly model: string;
    /**
     * What keeps the bot from being restarted, read from its durable store: a run in progress (a code mode script is
     * part of one), and input queued for the next one. A worker watch is background work and counts for neither: it
     * resumes after a restart.
     */
    activity(): Promise<BotActivity>;
    contextUsage(): {
        tokens: number;
        contextWindow: number;
        percent: number;
    } | null;
    /**
     * `followUp` queues behind a busy run; `steer` joins it, except an idle-rollover run, which it queues behind.
     * Images follow the text; a model without image input, an image over the cap or a window full of images is refused.
     */
    prompt(message: string, mode: 'followUp' | 'steer', images?: readonly BotImage[]): Promise<void>;
    /** A room message, a question from another family or the answer to one, posted once per request id. */
    deliver(input: BotInput): Promise<void>;
    /** Plans the idle rollover again: settings or the bot's registry row changed. */
    reconsiderIdle(): void;
    abort(): Promise<void>;
    close(): Promise<void>;
}
export declare function openBotRuntime(options: BotRuntimeOptions): Promise<BotRuntime>;
export type { AssistantMessage };
