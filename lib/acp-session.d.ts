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
/** Versions the fake agent and the captures were verified against. */
export declare const AGY_VERIFIED_VERSIONS: readonly string[];
export declare function agyMirrorRoot(): string;
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
    constructor(proc: ChildProcessWithoutNullStreams, cwd: string);
    get pid(): number | null;
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
     * agy keeps working without a prompt when a background command it started
     * finishes after its turn was answered. That work is a turn of its own: open
     * one on the first frame, and end it once frames stop and no dialog awaits an
     * answer, since no prompt response will arrive to end it.
     */
    private _noteActivity;
    private _autonomousIdle;
    private _clearAutonomousTimer;
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
    private _initialize;
    private _setConfigOption;
    /** New session: spawn → initialize → `session/new` → mirror header → initial options. */
    _start(opts: AcpLaunchOptions): Promise<void>;
    /** Resume: initialize → `session/resume` (no history replay) → keep the existing mirror. */
    _startResume(sessionId: string, sessionFile: string, opts: Partial<AcpLaunchOptions>): Promise<void>;
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
/** Resume one mirror; concurrent resumes of the same file share a single child. */
export declare function resumeAcpSession(sessionFile: string, opts?: Partial<AcpLaunchOptions>): Promise<AcpSession>;
export declare function getAcpSession(nativeId: unknown): AcpSession | undefined;
export declare function getAllAcpSessions(): AcpSession[];
export declare function shutdownAcpSessions(): Promise<void>;
