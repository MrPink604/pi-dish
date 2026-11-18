// Generated from src/core/acp-transcript.ts; edit that source and run npm run build:core.
import type { ProtocolRecord } from './wire-protocol';
/** Model provider string for every agy session (also a zero-rate plan provider). */
export declare const AGY_PROVIDER = "google-antigravity";
/** ACP `PromptResponse.usage` → Pi's usage counters. */
export declare function acpUsage(value: unknown): ProtocolRecord | null;
/** ACP stop reasons → Pi's assistant `stopReason` vocabulary. */
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
export interface AcpToolResult {
    text: string;
    details?: ProtocolRecord;
}
/** Completion content plus agy's `rawOutput`; bash keeps the exit status as Pi details. */
export declare function acpToolResult(update: unknown, call: AcpToolCall): AcpToolResult;
/** ACP `plan` update → a read-only widget, the only surface Pi has for it. */
export declare function planWidgetRequest(id: string, entries: unknown): ProtocolRecord | null;
export interface AcpAskOption {
    label: string;
    /** ACP form `const` sent back in the elicitation content. */
    value: string;
}
export interface AcpAskQuestionSpec {
    key: string;
    multi: boolean;
    options: AcpAskOption[];
}
export interface AcpAsk {
    request: ProtocolRecord;
    questions: AcpAskQuestionSpec[];
}
/**
 * One `elicitation/create` form → the browser's `ask` dialog. Each non-`_other`
 * property is a question; the recommended mark comes from the pending
 * `ask_question` call, which is the only place agy states it.
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
export interface AcpTranscriptOptions {
    file: string;
    sessionId: string;
    cwd: string;
    agentVersion: string | null;
}
export interface AcpMirrorHeader {
    id: string;
    cwd: string | null;
    agentVersion: string | null;
}
/** Read the mirror header (id, cwd, agy version); throws when the file is not a mirror. */
export declare function readAcpMirrorHeader(file: string): AcpMirrorHeader;
/** Linear parent chain; agy has no branches, so every entry extends the last. */
export declare class AcpTranscript {
    readonly file: string;
    readonly sidecarFile: string;
    private parentId;
    constructor(options: AcpTranscriptOptions);
    /** Append one entry; `timestamp` is the Pi entry stamp, not the message start. */
    private entry;
    appendUser(content: string | readonly ProtocolRecord[], timestamp?: number): void;
    /** `message` is the finished assistant snapshot emitted on `message_end`. */
    appendAssistant(message: ProtocolRecord): void;
    appendToolResult(data: {
        toolCallId: string;
        toolName: string;
        content: string;
        isError?: boolean;
        details?: ProtocolRecord;
        timestamp?: number;
    }): void;
    appendModelChange(modelId: string): void;
    appendThinkingLevel(thinkingLevel: string): void;
    appendSessionInfo(name: string): void;
    /** Raw frame sidecar: `{t, dir, msg}` exactly as the capture recorder wrote it. */
    appendRaw(dir: 'in' | 'out', msg: unknown): void;
}
