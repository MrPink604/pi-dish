// Generated from src/core/agy-brain.ts; edit that source and run npm run build:core.
import type { SessionId } from './contracts';
import type { SessionEntries } from './session-metadata';
import { type ProtocolRecord } from './wire-protocol';
/** Profile id for Antigravity brain `transcript.jsonl` files projected to Pi-v3 entries. */
export declare const AGY_BRAIN_PROFILE_ID = "agy-brain-v1";
/** Canonical `agy:<id>` route id for a validated native session id. */
export declare function agyRouteId(nativeSessionId: string): SessionId;
/** Root containing `<conversationId>/.system_generated/`. Overridable for tests. */
export declare function agyBrainRoot(): string;
export declare function agyBrainDir(conversationId: string): string | null;
export declare function agyBrainTranscriptPath(conversationId: string): string | null;
/** True when `file` is `<agyBrainRoot>/<id>/.system_generated/logs/transcript.jsonl`. */
export declare function isAgyBrainTranscriptPath(file: string): boolean;
export declare function conversationIdFromBrainTranscript(file: string): string | null;
export interface AgySwarmMemberRaw {
    name: string;
    conversationId: string;
    role: string;
    model: string | null;
    workspaceMode: string;
    phase: string;
    wakeMode: string;
    waitSince: number;
    lastReadSeq: number;
    lastNudgedSeq: number;
    killed: boolean;
    channels: string[];
}
export interface AgySwarmMembersFile {
    title: string;
    members: AgySwarmMemberRaw[];
    channels: {
        name: string;
        topic: string;
        archived: boolean;
    }[];
}
export declare function readSwarmMembersFile(coordinatorId: string): AgySwarmMembersFile | null;
export interface AgySwarmBoardPost {
    seq: number;
    agent: string;
    text: string;
    time: string;
    kind: string | null;
    channel: string;
    mentions: string[];
    tags: string[];
}
export declare function readSwarmBoardPosts(coordinatorId: string, since?: number): {
    posts: AgySwarmBoardPost[];
    head: number;
};
export interface AgySubagentDescriptor {
    conversationId: string;
    parentId: string;
    typeName: string;
    role: string;
    /** Display name: `@<member>` for swarm workers, else the subagent's role. */
    label: string;
    rawState: string;
    spawnStepIndex: number | null;
    cwd: string | null;
    workspaceUris: string[];
    transcriptFile: string;
    isSwarmWorker: boolean;
    swarmMemberName: string | null;
    swarmKilled: boolean;
    swarmModel: string | null;
}
export declare function readAgySubagentDescriptors(parentNativeId: string): AgySubagentDescriptor[];
export declare function findAgySubagentParent(childNativeId: string): AgySubagentDescriptor | null;
/**
 * True when a subagent is still loaded under a live parent. Killed, errored,
 * or explicitly finished subagents return false.
 */
export declare function isAgySubagentLive(parentNativeId: string, childNativeId: string): boolean;
export interface AgyTranscriptActivity {
    working: boolean;
    parkedOnBoard: boolean;
    lastActivity: string | null;
    stepCount: number;
    model: string | null;
    currentAction: string | null;
}
/**
 * Fast tail inspection of a brain `transcript.jsonl` to decide whether the
 * subagent/worker is actively executing a turn vs parked/done.
 */
export declare function inspectAgyTranscriptActivity(conversationId: string): AgyTranscriptActivity;
/** True when any subagent, swarm worker, or non-daemon task of `sessionId` is actively running. */
export declare function hasActiveAgyBrainWork(nativeSessionId: string): boolean;
/**
 * Convert an Antigravity brain `transcript.jsonl` into standard Pi-v3
 * `SessionEntries` so `session-files.ts`, `session-index.ts`, `Subagents`,
 * and `Swarm` trace peeking all consume it without a separate message model.
 */
export declare function parseAgyBrainEntries(content: string, file: string, hint?: {
    conversationId?: string;
    parentSession?: string | null;
    cwd?: string | null;
    name?: string | null;
} | null): SessionEntries;
/**
 * agy ACP leaves `content` and `rawOutput` empty on non-filesystem tool updates
 * (`swarm`, `read_board`, `invoke_subagent`, `manage_task`, …), while writing
 * the real result to `brain/<id>/.system_generated/logs/transcript.jsonl`.
 * Best-effort lookup of the matching recent tool output.
 */
export declare function findLatestToolStepOutput(nativeSessionId: string, nativeToolName: string): string | null;
/**
 * Find the live `.system_generated/tasks/task-<N>.log` tail for an in-flight
 * backgrounded `run_command` (matching `command` if multiple tasks run).
 */
export declare function readRunningTaskLogTail(nativeSessionId: string, commandHint?: string): string | null;
/**
 * Per-step LLM cache probes from Antigravity's brain `transcript.jsonl`.
 * Mirrors only carry cumulative per-turn `PromptResponse.usage` (where a
 * multi-step turn's warm step 2 masks a cold step 1); brain steps report
 * exact per-call `input_tokens` and `cache_read_tokens` for the learner.
 */
export declare function readAgyBrainCacheProbeEntries(nativeSessionId: string): {
    file: string;
    entries: SessionEntries;
} | null;
/**
 * Latest per-step usage from brain `transcript.jsonl`, used as a fallback for
 * autonomous ACP turns that finish without a `PromptResponse.usage` frame.
 */
export declare function readLatestAgyBrainStepUsage(nativeSessionId: string, minTimestampMs?: number): ProtocolRecord | null;
export interface AgyPlanItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority?: string;
}
export interface AgyBackgroundTask {
    id: string;
    fullTaskId?: string;
    kind: 'shell' | 'schedule' | 'workflow' | 'tool';
    status: 'running' | 'completed' | 'failed' | 'killed' | 'scheduled';
    title: string;
    command?: string;
    cron?: string;
    durationSeconds?: number;
    isDaemon?: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    exitCode: number | null;
    hasLog: boolean;
    logBytes?: number;
    preview?: string;
}
export interface AgySubagentTaskSummary {
    id: string;
    nativeSessionId: string;
    name: string;
    typeName: string;
    role: string;
    state: 'working' | 'waiting' | 'done' | 'killed' | 'error';
    isSwarmWorker: boolean;
    swarmMemberName: string | null;
    model: string | null;
    lastActivity: string | null;
    stepCount: number;
    currentAction: string | null;
}
export interface AgySwarmSummary {
    active: boolean;
    coordinatorId: string;
    coordinatorNativeId: string;
    title: string;
    memberCount: number;
    workingCount: number;
    waitingCount: number;
    killedCount: number;
    postCount: number;
    lastPostAt: string | null;
}
export interface AgySessionTasksPayload {
    supported: boolean;
    sessionId: string;
    nativeSessionId: string;
    isActive: boolean;
    canControl: boolean;
    plan: AgyPlanItem[];
    tasks: AgyBackgroundTask[];
    subagents: AgySubagentTaskSummary[];
    swarm: AgySwarmSummary | null;
}
export declare function readAgyBackgroundTasks(nativeSessionId: string, parentLive: boolean): AgyBackgroundTask[];
export interface AgyTaskLogPayload {
    taskId: string;
    content: string;
    totalBytes: number;
    truncated: boolean;
    updatedAt: string;
}
export declare function readAgyTaskLog(nativeSessionId: string, taskId: string, requestedBytes?: number): AgyTaskLogPayload | null;
export interface AgySwarmMemberView {
    name: string;
    role: string;
    conversationId: string;
    routeId: string;
    state: 'working' | 'waiting' | 'stopped' | 'killed';
    model: string | null;
    workspaceMode: string;
    workspacePath: string | null;
    channels: string[];
    lastReadSeq: number;
    lastPostSeq: number | null;
    lastPostTime: string | null;
    unreadCount: number;
    currentAction: string | null;
    stepCount: number;
    lastActivity: string | null;
}
export interface AgySwarmChannelView {
    name: string;
    topic: string;
    archived: boolean;
    postCount: number;
}
export interface AgySwarmStatePayload {
    supported: boolean;
    hasSwarm: boolean;
    sessionId: string;
    coordinatorId: string;
    coordinatorNativeId: string;
    title: string;
    createdAt: string | null;
    isActive: boolean;
    coordinatorTurnInProgress: boolean;
    head: number;
    members: AgySwarmMemberView[];
    channels: AgySwarmChannelView[];
    posts: AgySwarmBoardPost[];
    plan: ProtocolRecord | null;
    narratorView: ProtocolRecord | null;
}
/** Resolve which conversation owns the swarm for `nativeSessionId` (either itself or its parent). */
export declare function findAgySwarmCoordinator(nativeSessionId: string): string | null;
export declare function readAgySwarmState(nativeSessionId: string, options?: {
    isActive?: boolean;
    coordinatorTurnInProgress?: boolean;
    since?: number;
}): AgySwarmStatePayload;
export declare function readAgySessionTasks(nativeSessionId: string, options?: {
    isActive?: boolean;
    canControl?: boolean;
    coordinatorTurnInProgress?: boolean;
    livePlan?: readonly AgyPlanItem[];
    liveRunningTools?: readonly {
        toolCallId: string;
        toolName: string;
        args: unknown;
        startedAt: number;
    }[];
}): AgySessionTasksPayload;
export interface AgyBrainArtifact {
    name: string;
    path: string;
    kind: 'markdown' | 'html' | 'image';
    size: number;
    updatedAt: string;
    summary: string;
    userFacing: boolean;
    requestFeedback: boolean;
    artifactType: string;
}
export interface AgyBrainArtifactMeta {
    summary: string;
    userFacing: boolean;
    requestFeedback: boolean;
    artifactType: string;
    updatedAt: string | null;
}
/** Read optional `<file>.metadata.json` sidecar if `filePath` is a direct artifact inside this conversation's brain dir. */
export declare function readAgyBrainArtifactMeta(nativeSessionId: string, filePath: string): AgyBrainArtifactMeta | null;
/** List user-facing Antigravity brain artifacts (`.md`/`.html`/images) for one conversation. */
export declare function readAgyBrainArtifacts(nativeSessionId: string): AgyBrainArtifact[];
