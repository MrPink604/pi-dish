// Generated from src/core/acp-transcript.ts; edit that source and run npm run build:core.
import { type ProtocolRecord } from './wire-protocol';
/** Model provider string for every agy session (also a zero-rate plan provider). */
export declare const AGY_PROVIDER = "google-antigravity";
/** ACP `PromptResponse.usage` → Pi's usage counters. */
export declare function acpUsage(value: unknown): ProtocolRecord | null;
/** `_meta.antigravity.tier.name` from `session/new` or `session/resume`. */
export declare function extractAcpPlanTier(result: unknown): string | null;
export interface NormalizedAgyUsageLimit {
    id: string | null;
    label: string;
    windowLabel: string | null;
    resetsAt: number | null;
    usedFraction: number;
    unit: string;
    status: string;
}
export interface NormalizedAgyUsageReport {
    provider: string;
    fetchedAt: number;
    planType: string | null;
    limits: NormalizedAgyUsageLimit[];
    resetCredits: null;
}
/**
 * `agy -p /usage --output-format json` → pi-dish's `/api/usage-limits` reports.
 * Only Gemini quota buckets are projected (matching agy's Gemini-only model scope).
 */
export declare function normalizeAgyUsageReports(parsed: unknown, options?: {
    planType?: string | null;
    fetchedAt?: number;
}): NormalizedAgyUsageReport[];
/**
 * ACP stop reasons → Pi's assistant `stopReason` vocabulary. Both ACP limits
 * (`max_tokens`, `max_turn_requests`) are `length`; callers keep the ACP value
 * in `rawStopReason`.
 */
export declare function acpStopReason(value: unknown): string;
export interface AcpToolCall {
    /** Pi-dish tool name the existing cards understand. */
    toolName: string;
    args: ProtocolRecord;
    /** agy's own tool name, kept for diagnostics and question matching. */
    nativeName: string;
    title: string;
    kind: string;
}
/** agy sends its native call in non-ACP `name`/`args` next to ACP's `title`/`kind`. */
export declare function normalizeAcpTool(update: unknown): AcpToolCall;
export interface AcpImageBlock {
    type: 'image';
    data: string;
    mimeType: string;
}
export interface AcpToolResult {
    text: string;
    images?: AcpImageBlock[];
    details?: ProtocolRecord;
}
/** Extract an image block from an ACP content item (`image`, image `resource` blob, or contained `resource_link`). */
export declare function extractAcpImageBlock(raw: unknown, allowedRoots?: readonly string[]): AcpImageBlock | null;
/** Completion content plus agy's `rawOutput`; bash keeps the exit status as Pi details. */
export declare function acpToolResult(update: unknown, call: AcpToolCall, options?: {
    allowedRoots?: readonly string[];
}): AcpToolResult;
export interface NormalizedPlanEntry {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority?: string;
}
/** Normalize ACP `plan` entries into structured checklist items. */
export declare function normalizeAcpPlan(entries: unknown): NormalizedPlanEntry[];
/** ACP `plan` update → a read-only widget (empty entries clear the widget). */
export declare function planWidgetRequest(id: string, entries: unknown): ProtocolRecord | null;
export interface AcpAskOption {
    label: string;
    /** ACP form `const` sent back in the elicitation content. */
    value: string;
}
export interface AcpAskQuestionSpec {
    key: string;
    multi: boolean;
    required?: boolean;
    options: AcpAskOption[];
}
export interface AcpAsk {
    request: ProtocolRecord;
    questions: AcpAskQuestionSpec[];
}
/**
 * One `elicitation/create` form → the browser's `ask` dialog. Each non-`_other`
 * property is a question; supports single-select (`oneOf`/`enum`) and
 * multi-select (`type: 'array'` with `items.anyOf`/`items.oneOf`/`items.enum`).
 */
export declare function askFromElicitation(id: string, params: unknown, pendingQuestions: unknown): AcpAsk | null;
/** The browser's ask response → the elicitation result (`accept` / `decline` / `cancel`). */
export declare function askElicitationResult(response: ProtocolRecord, questions: readonly AcpAskQuestionSpec[]): ProtocolRecord;
export interface AcpPermissionOption {
    optionId: string;
    label: string;
}
/** An unexpected permission request becomes a `select` dialog rather than hanging the turn. */
export declare function permissionDialog(id: string, params: unknown): {
    request: ProtocolRecord;
    options: AcpPermissionOption[];
} | null;
/** The select response → ACP's `{outcome:{outcome:'selected'|'cancelled'}}`. */
export declare function permissionResult(response: ProtocolRecord, options: readonly AcpPermissionOption[]): ProtocolRecord;
/** `session/load` rebuilds a lossy history; the header says so for the UI/docs. */
export interface AcpMirrorImport {
    at: number;
    source: 'session/load';
}
export interface AcpTranscriptOptions {
    file: string;
    sessionId: string;
    cwd: string;
    agentVersion: string | null;
    imported?: AcpMirrorImport | null;
}
export interface AcpMirrorHeader {
    id: string;
    cwd: string | null;
    agentVersion: string | null;
    imported: AcpMirrorImport | null;
}
/** Timestamp of the mirror's newest entry; null when it has none (or no file). */
export declare function readAcpMirrorLastTimestamp(file: string): number | null;
export interface AcpMirrorBackup {
    mirror: string | null;
    sidecar: string | null;
}
/** Rename a mirror and sidecar aside before re-import; `.bak` never matches discovery. */
export declare function backupAcpMirror(file: string): AcpMirrorBackup;
/** Put a backup back after a failed replay so resume can fall back to `session/resume`. */
export declare function restoreAcpMirror(file: string, backup: AcpMirrorBackup): void;
/** Read the mirror header (id, cwd, agy version); throws when the file is not a mirror. */
export declare function readAcpMirrorHeader(file: string): AcpMirrorHeader;
/** Linear parent chain; agy has no branches, so every entry extends the last. */
export declare class AcpTranscript {
    readonly file: string;
    readonly sidecarFile: string;
    private parentId;
    private replayUserText;
    private replayAssistant;
    constructor(options: AcpTranscriptOptions);
    /** Append one entry; `timestamp` is the Pi entry stamp, not the message start. */
    private entry;
    appendUser(content: string | readonly ProtocolRecord[], timestamp?: number): void;
    /** `message` is the finished assistant snapshot emitted on `message_end`. */
    appendAssistant(message: ProtocolRecord, at?: number): void;
    appendToolResult(data: {
        toolCallId: string;
        toolName: string;
        content: string;
        images?: readonly AcpImageBlock[];
        isError?: boolean;
        details?: ProtocolRecord;
        timestamp?: number;
    }): void;
    appendModelChange(modelId: string): void;
    appendThinkingLevel(thinkingLevel: string): void;
    appendSessionInfo(name: string): void;
    /**
     * `session/load` replay: user chunks carry whole prompts, assistant text and
     * completed tool calls arrive without updates or prompt results. A user chunk
     * closes the previous message; a completed/failed call is start plus end; the
     * load response flushes whatever is still open (`flushReplay`).
     */
    applyReplayUpdate(raw: unknown): void;
    /** The `session/load` response ends the replay; write the open message. */
    flushReplay(): void;
    private ensureReplayAssistant;
    private flushReplayAssistant;
    private flushReplayUser;
    /** Raw frame sidecar: `{t, dir, msg}` exactly as the capture recorder wrote it. */
    appendRaw(dir: 'in' | 'out', msg: unknown): void;
}
