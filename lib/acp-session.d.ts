// Generated from src/core/acp-session.ts; edit that source and run npm run build:core.
/**
 * Antigravity CLI (`agy acp`) sessions: one owned stdio child per live session,
 * spoken to as an ACP v1 client. This is the fourth sibling of the bridge, Pi
 * RPC and Prime daemon transports; `TransportSession` supplies the replay maps
 * and the EventEmitter shape its consumers already expect.
 *
 * Pi-dish never injects prompt text or history (no `_meta` system prompt),
 * never reads `agy` token files and never sets GEMINI_HOME: the agent keeps its
 * own sign-in, tools and transcript store. The Pi-format mirror written here is
 * the only history surface pi-dish reads.
 */
import { type ChildProcessWithoutNullStreams } from 'child_process';
import { type ProtocolRecord } from './wire-protocol';
import { TransportSession } from './transport-session';
import type { NativeSessionId, PromptOptions } from './contracts';
import { type NormalizedPlanEntry } from './acp-transcript';
/** Versions the fake agent and the captures were verified against. */
export declare const AGY_VERIFIED_VERSIONS: readonly string[];
/**
 * agy persists a conversation slightly after pi-dish closes the mirror entry;
 * a comparison this loose still catches TUI turns, which are minutes apart.
 */
export declare const AGY_STALE_TOLERANCE_MS = 5000;
/** One conversation from `session/list`; the same shape in every workspace. */
export interface AgyConversation {
    sessionId: NativeSessionId;
    cwd: string | null;
    title: string | null;
    /** Epoch ms; agy may send an ISO string or seconds. */
    updatedAt: number | null;
}
/** Defensive read of `session/list`; unknown rows drop instead of breaking an import run. */
export declare function parseAgyConversationList(value: unknown): AgyConversation[];
export declare function agyMirrorRoot(): string;
/** Record an ephemeral side-chat ACP session id so `agy-import` never imports it into the sidebar. */
export declare function recordAgySideChatId(sessionId: string): void;
export declare function readAgySideChatIds(): Set<string>;
/** Persist the tier name (`Google AI Ultra`, `Google AI Pro`) observed on ACP session open. */
export declare function recordAgyPlanTier(planType: string | null): void;
export declare function readAgyPlanTier(): string | null;
export interface AcpLaunchOptions {
    cwd: string;
    /** Bare agy model id (`gemini-4-carbon`) or `google-antigravity/<id>`. */
    model?: string | null;
    /** A `thought_level` value from the session's config options. */
    thinking?: string | null;
    command?: string;
    args?: string[];
    env?: NodeJS.ProcessEnv;
}
export declare class AcpSession extends TransportSession {
    readonly harnessId: 'agy';
    id: NativeSessionId;
    nativeSessionId: NativeSessionId;
    sessionFile: string;
    cwd: string;
    alive: boolean;
    agentVersion: string | null;
    state: ProtocolRecord;
    private proc;
    private pending;
    private nextRequestId;
    private transcript;
    /** True while `session/load` replay frames are being written to a fresh mirror. */
    private replaying;
    private initialized;
    private configOptions;
    private modes;
    private currentMode;
    private commandRows;
    private stderrTail;
    private segment;
    private toolCalls;
    private askQuestions;
    private promptResponses;
    private newestPromptId;
    private inbound;
    private counter;
    private spawnFailure;
    private earlyFrames;
    /** Set while agy works with no outstanding prompt (a background command woke it). */
    private autonomousTimer;
    /** Usage reported by prompts that handed their turn to a steer; added to the turn's total. */
    private handoverUsage;
    /** Request-start timestamp of the in-flight or upcoming LLM step (includes TTFT). */
    private nextStepStartedAt;
    /** Distinguishes a new LLM step from sibling `tool_call`s emitted in one batch. */
    private sawStepSignal;
    /** Sum of earlier model-step durations in the active turn (excludes tool/dialog waits). */
    private turnGenMs;
    /** Arrival timestamp of the first chunk/tool frame in the open segment. */
    private segmentFirstOutputAt;
    /** Sum of earlier model-step TTFTs in the active turn, for multi-step streaming rate. */
    private turnTtftSumMs;
    /** Latest ACP `plan` entries for this session. */
    private planEntries;
    /** Polls live task-*.log tails onto long-running `run_command` tool cards. */
    private taskLogTimer;
    /** Sibling ACP session ids opened for ephemeral `/btw` side chats. */
    private sideSessionIds;
    private sideListeners;
    constructor(proc: ChildProcessWithoutNullStreams, cwd: string);
    get pid(): number | null;
    /** True while a non-daemon tool call has started and not yet completed or failed. */
    get hasActiveToolWork(): boolean;
    private _writeFrame;
    /** The sidecar is named by the agy session id, which startup frames precede; flush on adopt. */
    private _bufferFrame;
    private _request;
    private _notify;
    private _respond;
    private _respondError;
    private _handleFrame;
    private _handleResponse;
    private _handleNotification;
    private _handleRequest;
    private _sessionUpdate;
    private _emitUI;
    private _applyTitle;
    private _applyConfigUpdate;
    private _pushChunk;
    private _ensureSegment;
    private _closeSegment;
    private _toolCall;
    private _toolUpdate;
    private _emitTool;
    private _endTurn;
    /**
     * agy keeps working without an open prompt when a background command or
     * subagent runs past `session/prompt`'s `end_turn` response (or wakes the
     * agent later). Keep the turn alive while non-daemon tool calls or dialogs
     * are open, and end it once frames go quiet with nothing pending.
     */
    private _noteActivity;
    private _armAutonomousTimer;
    private _autonomousIdle;
    private _clearAutonomousTimer;
    private _hasRunningShellTools;
    private _syncTaskLogTimer;
    private _clearTaskLogTimer;
    /** Stream live `.system_generated/tasks/task-*.log` tails onto backgrounded bash cards. */
    private _pollRunningTaskLogs;
    getPlan(): NormalizedPlanEntry[];
    private _takeHandoverUsage;
    private _configOption;
    private _configValues;
    private _configValue;
    private _currentModelId;
    private _modelName;
    private _modeId;
    private _refreshStateFromConfig;
    private _adoptSession;
    private _warnUnverifiedVersion;
    _initialize(): Promise<void>;
    private _setConfigOption;
    /** New session: spawn → initialize → `session/new` → mirror header → initial options. */
    _start(opts: AcpLaunchOptions): Promise<void>;
    /**
     * Open an ephemeral sibling ACP session on the same `agy acp` process for
     * pi-dish's `/btw` Side Chat. Never creates a mirror or touches main session state.
     */
    openSideSession(): Promise<string>;
    promptSideSession(sideId: string, question: string, opts: {
        signal: AbortSignal;
        onTextDelta: (delta: string) => void;
    }): Promise<string>;
    closeSideSession(sideId: string): Promise<void>;
    /**
     * Rebuild a conversation's mirror from `session/load` replay. The previous
     * mirror and sidecar are kept as `.bak`; a failed replay restores them.
     */
    private _replayInto;
    /** `session/list` newer than the mirror's tail means turns happened outside pi-dish. */
    private _agyHasNewerTurns;
    /**
     * Resume: compare `session/list` with the mirror. A newer conversation is
     * rebuilt with `session/load` so the live session continues with complete
     * history; otherwise `session/resume` keeps the existing mirror and replays
     * nothing.
     */
    _startResume(sessionId: string, sessionFile: string, opts: Partial<AcpLaunchOptions>): Promise<void>;
    /** Every conversation agy knows about, across workspaces (`session/list`). */
    listConversations(timeout?: number): Promise<AgyConversation[]>;
    /**
     * Import one conversation started outside pi-dish into a fresh mirror. The
     * caller owns the short-lived child (see `createAcpImportAgent`).
     */
    importConversation(conversation: AgyConversation, sessionFile: string): Promise<{
        file: string;
        backup: string | null;
    }>;
    private _bareModelId;
    private _promptContent;
    private _sendPrompt;
    prompt(message: string, opts?: PromptOptions): Promise<{
        ok: true;
    }>;
    steer(message: string, opts?: PromptOptions): Promise<{
        ok: true;
    }>;
    abort(): Promise<unknown>;
    setModel(provider: string, modelId: string): Promise<unknown>;
    setThinkingLevel(level: string): Promise<unknown>;
    setMode(modeId: string): Promise<unknown>;
    /** agy has no rename ACP method; the title is read-only from `session_info_update`. */
    setName(_name: string): Promise<never>;
    getState(): Promise<ProtocolRecord>;
    /** Gemini-only; same payload shape the Pi RPC `get_available_models` returns. */
    getAvailableModels(): Promise<ProtocolRecord>;
    /** `available_commands_update` rows for the slash picker. */
    getCommands(): Promise<ProtocolRecord>;
    getSessionStats(): Promise<unknown>;
    respondExtensionUI(requestId: string, response: ProtocolRecord): Promise<void>;
    close(): Promise<void>;
    kill(): void;
}
export declare function createAcpSession(opts: AcpLaunchOptions): Promise<AcpSession>;
/**
 * A short-lived ACP child for `session/list` + `session/load` import work. It
 * is not registered as a live session; the caller closes it when the batch ends.
 */
export declare function createAcpImportAgent(opts: AcpLaunchOptions): Promise<AcpSession>;
/** Resume one mirror; concurrent resumes of the same file share a single child. */
export declare function resumeAcpSession(sessionFile: string, opts?: Partial<AcpLaunchOptions>): Promise<AcpSession>;
export declare function getAcpSession(nativeId: unknown): AcpSession | undefined;
export declare function getAllAcpSessions(): AcpSession[];
export declare function shutdownAcpSessions(): Promise<void>;
