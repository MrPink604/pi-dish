import { finite, record, text } from '../core/helper-values';

export interface PlanItem {
  readonly content: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
  readonly priority: string;
}

export interface BackgroundTaskItem {
  readonly id: string;
  readonly fullTaskId: string;
  readonly kind: 'shell' | 'schedule' | 'workflow' | 'tool';
  readonly status: 'running' | 'completed' | 'failed' | 'killed' | 'scheduled';
  readonly title: string;
  readonly command: string;
  readonly cron: string;
  readonly durationSeconds: number | null;
  readonly isDaemon: boolean;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly exitCode: number | null;
  readonly hasLog: boolean;
  readonly logBytes: number | null;
  readonly preview: string;
}

export interface SubagentTaskItem {
  readonly id: string;
  readonly nativeSessionId: string;
  readonly name: string;
  readonly typeName: string;
  readonly role: string;
  readonly state: 'working' | 'waiting' | 'done' | 'killed' | 'error';
  readonly isSwarmWorker: boolean;
  readonly swarmMemberName: string;
  readonly model: string;
  readonly lastActivity: string | null;
  readonly stepCount: number;
  readonly currentAction: string;
}

export interface SwarmSummary {
  readonly active: boolean;
  readonly coordinatorId: string;
  readonly coordinatorNativeId: string;
  readonly title: string;
  readonly memberCount: number;
  readonly workingCount: number;
  readonly waitingCount: number;
  readonly killedCount: number;
  readonly postCount: number;
  readonly lastPostAt: string | null;
}

export interface SessionTasksPayload {
  readonly supported: boolean;
  readonly sessionId: string;
  readonly nativeSessionId: string;
  readonly isActive: boolean;
  readonly canControl: boolean;
  readonly plan: readonly PlanItem[];
  readonly tasks: readonly BackgroundTaskItem[];
  readonly subagents: readonly SubagentTaskItem[];
  readonly swarm: SwarmSummary | null;
}

export interface TaskLogPayload {
  readonly taskId: string;
  readonly content: string;
  readonly totalBytes: number;
  readonly truncated: boolean;
  readonly updatedAt: string;
}

export interface SwarmMember {
  readonly name: string;
  readonly role: string;
  readonly conversationId: string;
  readonly routeId: string;
  readonly state: 'working' | 'waiting' | 'stopped' | 'killed';
  readonly model: string;
  readonly workspaceMode: string;
  readonly workspacePath: string;
  readonly channels: readonly string[];
  readonly lastReadSeq: number;
  readonly lastPostSeq: number | null;
  readonly lastPostTime: string | null;
  readonly unreadCount: number;
  readonly currentAction: string;
  readonly stepCount: number;
  readonly lastActivity: string | null;
}

export interface SwarmChannel {
  readonly name: string;
  readonly topic: string;
  readonly archived: boolean;
  readonly postCount: number;
}

export interface SwarmBoardPost {
  readonly seq: number;
  readonly agent: string;
  readonly text: string;
  readonly time: string;
  readonly kind: string;
  readonly channel: string;
  readonly mentions: readonly string[];
  readonly tags: readonly string[];
}

export interface SessionSwarmPayload {
  readonly supported: boolean;
  readonly hasSwarm: boolean;
  readonly sessionId: string;
  readonly coordinatorId: string;
  readonly coordinatorNativeId: string;
  readonly title: string;
  readonly createdAt: string | null;
  readonly isActive: boolean;
  readonly coordinatorTurnInProgress: boolean;
  readonly head: number;
  readonly members: readonly SwarmMember[];
  readonly channels: readonly SwarmChannel[];
  readonly posts: readonly SwarmBoardPost[];
  readonly plan: Readonly<Record<string, unknown>> | null;
  readonly narratorView: Readonly<Record<string, unknown>> | null;
}

export const EMPTY_TASKS: SessionTasksPayload = {
  supported: false, sessionId: '', nativeSessionId: '', isActive: false, canControl: false,
  plan: [], tasks: [], subagents: [], swarm: null,
};

export const EMPTY_SWARM: SessionSwarmPayload = {
  supported: false, hasSwarm: false, sessionId: '', coordinatorId: '', coordinatorNativeId: '',
  title: '', createdAt: null, isActive: false, coordinatorTurnInProgress: false, head: 0,
  members: [], channels: [], posts: [], plan: null, narratorView: null,
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];

const nullableString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

const nullableNumber = (value: unknown): number | null =>
  finite(value) ? value : null;

export function decodeSessionTasks(value: unknown): SessionTasksPayload {
  if (!record(value)) return EMPTY_TASKS;
  const plan: PlanItem[] = Array.isArray(value.plan) ? value.plan.flatMap((row): PlanItem[] => {
    if (!record(row)) return [];
    const content = text(row.content);
    if (!content) return [];
    const status = row.status === 'completed' || row.status === 'in_progress' ? row.status : 'pending';
    return [{ content, status, priority: text(row.priority) }];
  }) : [];
  const tasks: BackgroundTaskItem[] = Array.isArray(value.tasks) ? value.tasks.flatMap((row): BackgroundTaskItem[] => {
    if (!record(row)) return [];
    const id = text(row.id);
    if (!id) return [];
    const kind = row.kind === 'shell' || row.kind === 'schedule' || row.kind === 'workflow' || row.kind === 'tool' ? row.kind : 'shell';
    const status = row.status === 'running' || row.status === 'completed' || row.status === 'failed' || row.status === 'killed' || row.status === 'scheduled'
      ? row.status : 'completed';
    return [{
      id,
      fullTaskId: text(row.fullTaskId) || id,
      kind, status,
      title: text(row.title) || id,
      command: text(row.command),
      cron: text(row.cron),
      durationSeconds: nullableNumber(row.durationSeconds),
      isDaemon: row.isDaemon === true,
      startedAt: nullableString(row.startedAt),
      finishedAt: nullableString(row.finishedAt),
      exitCode: nullableNumber(row.exitCode),
      hasLog: row.hasLog === true,
      logBytes: nullableNumber(row.logBytes),
      preview: text(row.preview),
    }];
  }) : [];
  const subagents: SubagentTaskItem[] = Array.isArray(value.subagents) ? value.subagents.flatMap((row): SubagentTaskItem[] => {
    if (!record(row)) return [];
    const id = text(row.id);
    if (!id) return [];
    const state = row.state === 'working' || row.state === 'waiting' || row.state === 'done' || row.state === 'killed' || row.state === 'error'
      ? row.state : 'done';
    return [{
      id,
      nativeSessionId: text(row.nativeSessionId),
      name: text(row.name) || id.slice(0, 8),
      typeName: text(row.typeName),
      role: text(row.role),
      state,
      isSwarmWorker: row.isSwarmWorker === true,
      swarmMemberName: text(row.swarmMemberName),
      model: text(row.model),
      lastActivity: nullableString(row.lastActivity),
      stepCount: finite(row.stepCount) ? row.stepCount : 0,
      currentAction: text(row.currentAction),
    }];
  }) : [];
  let swarm: SwarmSummary | null = null;
  if (record(value.swarm) && text(value.swarm.coordinatorId)) {
    const sw = value.swarm;
    swarm = {
      active: sw.active === true,
      coordinatorId: text(sw.coordinatorId),
      coordinatorNativeId: text(sw.coordinatorNativeId),
      title: text(sw.title) || 'Swarm',
      memberCount: finite(sw.memberCount) ? sw.memberCount : 0,
      workingCount: finite(sw.workingCount) ? sw.workingCount : 0,
      waitingCount: finite(sw.waitingCount) ? sw.waitingCount : 0,
      killedCount: finite(sw.killedCount) ? sw.killedCount : 0,
      postCount: finite(sw.postCount) ? sw.postCount : 0,
      lastPostAt: nullableString(sw.lastPostAt),
    };
  }
  return {
    supported: value.supported === true,
    sessionId: text(value.sessionId),
    nativeSessionId: text(value.nativeSessionId),
    isActive: value.isActive === true,
    canControl: value.canControl === true,
    plan, tasks, subagents, swarm,
  };
}

export function decodeTaskLog(value: unknown): TaskLogPayload | null {
  if (!record(value) || typeof value.content !== 'string') return null;
  return {
    taskId: text(value.taskId),
    content: value.content,
    totalBytes: finite(value.totalBytes) ? value.totalBytes : value.content.length,
    truncated: value.truncated === true,
    updatedAt: text(value.updatedAt),
  };
}

export function decodeSessionSwarm(value: unknown): SessionSwarmPayload {
  if (!record(value)) return EMPTY_SWARM;
  const members: SwarmMember[] = Array.isArray(value.members) ? value.members.flatMap((row): SwarmMember[] => {
    if (!record(row)) return [];
    const name = text(row.name);
    if (!name) return [];
    const state = row.state === 'working' || row.state === 'waiting' || row.state === 'stopped' || row.state === 'killed'
      ? row.state : 'stopped';
    return [{
      name,
      role: text(row.role) || 'worker',
      conversationId: text(row.conversationId),
      routeId: text(row.routeId),
      state,
      model: text(row.model),
      workspaceMode: text(row.workspaceMode) || 'inherit',
      workspacePath: text(row.workspacePath),
      channels: stringArray(row.channels),
      lastReadSeq: finite(row.lastReadSeq) ? row.lastReadSeq : 0,
      lastPostSeq: nullableNumber(row.lastPostSeq),
      lastPostTime: nullableString(row.lastPostTime),
      unreadCount: finite(row.unreadCount) ? row.unreadCount : 0,
      currentAction: text(row.currentAction),
      stepCount: finite(row.stepCount) ? row.stepCount : 0,
      lastActivity: nullableString(row.lastActivity),
    }];
  }) : [];
  const channels: SwarmChannel[] = Array.isArray(value.channels) ? value.channels.flatMap((row): SwarmChannel[] => {
    if (!record(row)) return [];
    const name = text(row.name);
    if (!name) return [];
    return [{
      name,
      topic: text(row.topic),
      archived: row.archived === true,
      postCount: finite(row.postCount) ? row.postCount : 0,
    }];
  }) : [];
  const posts: SwarmBoardPost[] = Array.isArray(value.posts) ? value.posts.flatMap((row): SwarmBoardPost[] => {
    if (!record(row) || !finite(row.seq)) return [];
    return [{
      seq: row.seq,
      agent: text(row.agent) || 'unknown',
      text: text(row.text),
      time: text(row.time),
      kind: text(row.kind),
      channel: text(row.channel) || 'main',
      mentions: stringArray(row.mentions),
      tags: stringArray(row.tags),
    }];
  }) : [];
  return {
    supported: value.supported === true,
    hasSwarm: value.hasSwarm === true,
    sessionId: text(value.sessionId),
    coordinatorId: text(value.coordinatorId),
    coordinatorNativeId: text(value.coordinatorNativeId),
    title: text(value.title) || 'Swarm',
    createdAt: nullableString(value.createdAt),
    isActive: value.isActive === true,
    coordinatorTurnInProgress: value.coordinatorTurnInProgress === true,
    head: finite(value.head) ? value.head : 0,
    members, channels, posts,
    plan: record(value.plan) ? value.plan : null,
    narratorView: record(value.narratorView) ? value.narratorView : null,
  };
}
