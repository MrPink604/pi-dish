// Generated from src/core/bot-runtime.ts; edit that source and run npm run build:core.
import type * as Durable from '@earendil-works/pi-durable' with { 'resolution-mode': 'import' };
import type { Message, Models, AssistantMessage } from '@earendil-works/pi-ai' with { 'resolution-mode': 'import' };
import type { BotPlace, BotRow } from './bot-registry';
import type { BotMirror } from './bot-mirror';
import type { ProtocolRecord } from './wire-protocol';
/** The notebook's cap, in UTF-8 bytes. */
export declare const NOTEBOOK_MAX_BYTES: number;
/** A window is sized to this many tokens even on a model with a larger context. */
export declare const WINDOW_TOKEN_CAP = 200000;
/** From this share of the window on, each request carries a reminder to roll over. */
export declare const REMINDER_RATIO = 0.75;
/** At this share the relay rolls the window over itself once the run ends. */
export declare const FORCED_RATIO = 0.9;
/** Runs the pi-dish-sessions CLI as the bot; resolves with its stdout. */
export type SessionsPort = (args: string[]) => Promise<string>;
/** pi-dish's HTTP API on the hub: GET `path`, or POST it `body`; resolves with the JSON answer. */
export type HubApi = (path: string, body?: ProtocolRecord) => Promise<unknown>;
export type BridgeEmit = (event: string, data: ProtocolRecord) => void;
export interface SettledWorker {
    state: 'finished' | 'waiting' | 'inactive';
    totalMessages: number;
    text: string;
}
/** Text blocks of a Pi message, joined; tool calls and thinking are left out. */
export declare function messageText(message: unknown): string;
/**
 * The settle rule `pi-dish-sessions wait` uses: a worker has settled when it is
 * not working or compacting, its transcript holds more than `since` messages,
 * and its newest message is not the user's (a prompt not picked up yet). A
 * pending question counts as settled. `session` is the resolve row; `window` is
 * `/messages?limit=1`. Null means keep waiting.
 */
export declare function settledWorker(session: unknown, window: unknown, since: number): SettledWorker | null;
export interface WorkerRecord {
    name: string;
    /** The short ref `list` shows, host-qualified for a remote worker. */
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
    /** When the session was seen to stop or was closed. */
    closedAt?: string;
    /** When the watch ended: the session stopped, or 24 hours passed. */
    watchEndedAt?: string;
}
export interface ClosedWindow {
    line: string;
    closedAt: string;
    forced: boolean;
}
export interface BotMemory {
    notebook: string;
    /** How many windows were closed when the notebook was last saved; -1 for never. */
    notebookSavedIn: number;
    windows: ClosedWindow[];
    workers: Record<string, WorkerRecord>;
}
/** Why `new_context` is refused, or null when it may run. */
export declare function newContextRefusal(memory: BotMemory, workSinceRollover: boolean): string | null;
/** The instructions of a window: fixed when it opens, never rewritten inside it. */
export declare function composeInstructions(identity: string, notebook: string, places?: readonly BotPlace[]): string;
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
}
/**
 * The first message of a new window: what the bot needs that its notebook does not hold. The latest request is
 * shown with what became of it: a rollover the bot made while handling it is done, and must not be read as a request
 * to roll over again.
 */
export declare function composeHandoff({ windowNumber, closed, tail, request, workers, forced }: HandoffInput): string;
/** A sub-bot's start, written by its parent into the sub-bot's directory and read once by its first relay. */
export declare const FORK_SEED = "fork.json";
export interface ForkSeed {
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
/** What another bot hands this one: a room post, a question from another family, or the answer to one. */
export interface BotInput {
    kind: 'room' | 'ask' | 'answer';
    requestId: string;
    text: string;
    data: Record<string, string | number>;
}
/** A sub-bot's first message: its purpose, and that the conversation above it is its parent's. */
export declare function composePurpose(parent: string, child: string, purpose: string): string;
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
    /** Where every bot's directory lives: a sub-bot's start is written into its own. */
    botsDir: string;
}
export interface BotRuntime {
    readonly busy: boolean;
    readonly model: string;
    contextUsage(): {
        tokens: number;
        contextWindow: number;
        percent: number;
    } | null;
    /** `followUp` queues behind a busy run; `steer` joins it. */
    prompt(message: string, mode: 'followUp' | 'steer'): Promise<void>;
    /** A room message, a question from another family or the answer to one, posted once per request id. */
    deliver(input: BotInput): Promise<void>;
    abort(): Promise<void>;
    close(): Promise<void>;
}
export declare function openBotRuntime(options: BotRuntimeOptions): Promise<BotRuntime>;
export type { AssistantMessage };
