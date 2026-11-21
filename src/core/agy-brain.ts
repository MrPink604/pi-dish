/**
 * Read-only access to Antigravity CLI's documented per-conversation brain
 * artifacts under `~/.gemini/antigravity-cli/brain/<conversationId>/`:
 *
 * - `.system_generated/subagents/<childId>.json` — subagent & swarm worker links
 * - `.system_generated/logs/transcript.jsonl` — live step-by-step transcript
 * - `.system_generated/tasks/task-<N>.log` — live background command output
 * - `.system_generated/messages/<msgId>.json` — task & subagent completion notices
 * - `.system_generated/swarm/{swarm.json,members.json,board.jsonl,plan.json}` — live swarm state
 *
 * Never reads Antigravity token files or SQLite/protobuf `conversations/*.db`.
 */
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { URL } from 'node:url';
import { AGY_PROVIDER, normalizeAcpTool } from './acp-transcript';
import { dishDir } from './dish-store';
import { finite, record as isRecord, text } from './helper-values';
import { canonicalSessionId, encodeSessionKey, validSessionId } from './session-key';
import type { NativeSessionId, SessionId } from './contracts';
import type { SessionEntries } from './session-metadata';
import { asRecord, type ProtocolRecord } from './wire-protocol';

/** Profile id for Antigravity brain `transcript.jsonl` files projected to Pi-v3 entries. */
export const AGY_BRAIN_PROFILE_ID = 'agy-brain-v1';

/** Canonical `agy:<id>` route id for a validated native session id. */
export function agyRouteId(nativeSessionId: string): SessionId {
  if (!validSessionId(nativeSessionId)) throw new TypeError(`Invalid Antigravity session id: ${nativeSessionId}`);
  return canonicalSessionId(encodeSessionKey('agy', nativeSessionId as NativeSessionId));
}

const MAX_SUBAGENTS_PER_PARENT = 128;
const MAX_TASK_LOG_BYTES = 256 * 1024;
const DEFAULT_TASK_LOG_BYTES = 64 * 1024;
const MAX_BOARD_POSTS = 2000;
const TAIL_BYTES = 128 * 1024;
const TASK_ID_RE = /^task-\d{1,12}$/;

/** Root containing `<conversationId>/.system_generated/`. Overridable for tests. */
export function agyBrainRoot(): string {
  const override = process.env.PI_DISH_AGY_BRAIN_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
}

export function agyBrainDir(conversationId: string): string | null {
  if (!validSessionId(conversationId)) return null;
  return path.join(agyBrainRoot(), conversationId);
}

export function agyBrainTranscriptPath(conversationId: string): string | null {
  const dir = agyBrainDir(conversationId);
  return dir ? path.join(dir, '.system_generated', 'logs', 'transcript.jsonl') : null;
}

/** True when `file` is `<agyBrainRoot>/<id>/.system_generated/logs/transcript.jsonl`. */
export function isAgyBrainTranscriptPath(file: string): boolean {
  const root = agyBrainRoot();
  const rel = path.relative(root, path.resolve(file));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  return parts.length === 4 && validSessionId(parts[0])
    && parts[1] === '.system_generated' && parts[2] === 'logs' && parts[3] === 'transcript.jsonl';
}

export function conversationIdFromBrainTranscript(file: string): string | null {
  if (!isAgyBrainTranscriptPath(file)) return null;
  const rel = path.relative(agyBrainRoot(), path.resolve(file));
  const id = rel.split(path.sep)[0];
  return validSessionId(id) ? id : null;
}

function readJsonFile(file: string, maxBytes = 2 * 1024 * 1024): ProtocolRecord | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRecord(parsed) ? parsed as ProtocolRecord : null;
  } catch {
    return null;
  }
}

function readRegularTail(file: string, maxBytes: number): { content: string; totalBytes: number; truncated: boolean; updatedAt: string } | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const totalBytes = stat.size;
    const readSize = Math.min(totalBytes, maxBytes);
    const start = Math.max(0, totalBytes - readSize);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, readSize, start); } finally { fs.closeSync(fd); }
    return {
      content: buf.toString('utf8'),
      totalBytes,
      truncated: start > 0,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function fileUriToPath(uri: string): string | null {
  if (!uri) return null;
  if (uri.startsWith('file://')) {
    try { return decodeURIComponent(new URL(uri).pathname); } catch { return null; }
  }
  return path.isAbsolute(uri) ? uri : null;
}

function parseJsonLines(content: string): ProtocolRecord[] {
  const out: ProtocolRecord[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) out.push(parsed as ProtocolRecord);
    } catch { /* Skip torn or partial tail line. */ }
  }
  return out;
}

function readTranscriptTailSteps(file: string): ProtocolRecord[] {
  const tail = readRegularTail(file, TAIL_BYTES);
  if (!tail) return [];
  const textContent = tail.truncated ? tail.content.slice(tail.content.indexOf('\n') + 1) : tail.content;
  return parseJsonLines(textContent);
}

// ---- Swarm raw files --------------------------------------------------------

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
  channels: { name: string; topic: string; archived: boolean }[];
}

export function readSwarmMembersFile(coordinatorId: string): AgySwarmMembersFile | null {
  const dir = agyBrainDir(coordinatorId);
  if (!dir) return null;
  const raw = readJsonFile(path.join(dir, '.system_generated', 'swarm', 'members.json'));
  if (!raw) return null;
  const membersObj = isRecord(raw.members) ? raw.members : {};
  const members: AgySwarmMemberRaw[] = [];
  for (const [name, value] of Object.entries(membersObj)) {
    if (!isRecord(value)) continue;
    const convId = text(value.conversation_id) || text(value.conversationId);
    if (!validSessionId(convId)) continue;
    const channels = Array.isArray(value.channels)
      ? value.channels.filter((c): c is string => typeof c === 'string' && c.length > 0)
      : [];
    members.push({
      name,
      conversationId: convId,
      role: text(value.role) || (name === 'coordinator' ? 'coordinator' : 'worker'),
      model: text(value.applied_model) || text(value.model) || text(value.desired_model) || null,
      workspaceMode: text(value.workspace_mode) || 'inherit',
      phase: text(value.phase) || text(value.desired_state) || '',
      wakeMode: text(value.wake_mode) || 'mentions',
      waitSince: finite(value.wait_since) ? value.wait_since : 0,
      lastReadSeq: finite(value.last_read_seq) ? value.last_read_seq : 0,
      lastNudgedSeq: finite(value.last_nudged_seq) ? value.last_nudged_seq : 0,
      killed: value.killed === true,
      channels,
    });
  }
  const channels: { name: string; topic: string; archived: boolean }[] = [];
  if (isRecord(raw.channels)) {
    for (const [chName, value] of Object.entries(raw.channels)) {
      if (!isRecord(value)) continue;
      channels.push({
        name: chName,
        topic: text(value.topic),
        archived: value.archived === true,
      });
    }
  }
  return { title: text(raw.title), members, channels };
}

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

const MENTION_RE = /(?:^|[\s(])@([a-z0-9_#-][a-z0-9_-]*)/gi;
const TAG_RE = /\[(done|stall|blocked|review|error|quota)\]/gi;

function extractMentions(content: string): string[] {
  const seen = new Set<string>();
  for (const m of content.matchAll(MENTION_RE)) {
    const token = m[1].toLowerCase();
    if (token) seen.add(token);
  }
  return [...seen];
}

function extractTags(content: string): string[] {
  const seen = new Set<string>();
  for (const m of content.matchAll(TAG_RE)) {
    seen.add(m[1].toLowerCase());
  }
  return [...seen];
}

export function readSwarmBoardPosts(coordinatorId: string, since = 0): { posts: AgySwarmBoardPost[]; head: number } {
  const dir = agyBrainDir(coordinatorId);
  if (!dir) return { posts: [], head: 0 };
  const boardPath = path.join(dir, '.system_generated', 'swarm', 'board.jsonl');
  let raw = '';
  try {
    const stat = fs.lstatSync(boardPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) return { posts: [], head: 0 };
    raw = fs.readFileSync(boardPath, 'utf8');
  } catch {
    return { posts: [], head: 0 };
  }
  const rows = parseJsonLines(raw);
  let head = 0;
  const posts: AgySwarmBoardPost[] = [];
  for (const row of rows) {
    const seq = finite(row.seq) ? row.seq : 0;
    if (seq > head) head = seq;
    if (seq <= since) continue;
    const body = text(row.text);
    posts.push({
      seq,
      agent: text(row.agent) || 'unknown',
      text: body,
      time: text(row.time),
      kind: text(row.kind) || null,
      channel: text(row.channel) || 'main',
      mentions: extractMentions(body),
      tags: extractTags(body),
    });
  }
  const bounded = posts.length > MAX_BOARD_POSTS ? posts.slice(posts.length - MAX_BOARD_POSTS) : posts;
  return { posts: bounded, head };
}

// ---- Subagent discovery & metadata ------------------------------------------

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

const SWARM_ROLE_RE = /^Swarm Worker \(([^)]+)\)$/;

export function readAgySubagentDescriptors(parentNativeId: string): AgySubagentDescriptor[] {
  const parentDir = agyBrainDir(parentNativeId);
  if (!parentDir) return [];
  const subDir = path.join(parentDir, '.system_generated', 'subagents');
  let entries: fs.Dirent[];
  try {
    const stat = fs.lstatSync(subDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
    entries = fs.readdirSync(subDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const swarm = readSwarmMembersFile(parentNativeId);
  const swarmByConv = new Map<string, AgySwarmMemberRaw>();
  for (const member of swarm?.members ?? []) {
    if (member.conversationId !== parentNativeId) swarmByConv.set(member.conversationId, member);
  }

  const out: AgySubagentDescriptor[] = [];
  for (const entry of entries) {
    if (out.length >= MAX_SUBAGENTS_PER_PARENT) break;
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue;
    const raw = readJsonFile(path.join(subDir, entry.name));
    if (!raw) continue;
    const conversationId = text(raw.conversationId);
    if (!validSessionId(conversationId) || conversationId === parentNativeId) continue;
    const transcriptFile = agyBrainTranscriptPath(conversationId);
    if (!transcriptFile) continue;
    const desc = asRecord(raw.subagentDescriptor);
    const typeName = text(desc.typeName) || 'subagent';
    const role = text(desc.role);
    const swarmMember = swarmByConv.get(conversationId) ?? null;
    const roleMatch = SWARM_ROLE_RE.exec(role);
    const swarmMemberName = swarmMember?.name ?? (roleMatch ? roleMatch[1] : null);
    const isSwarmWorker = !!swarmMember || (typeName === 'worker' && !!roleMatch);
    const label = swarmMemberName ? `@${swarmMemberName}` : (role || `${typeName}:${conversationId.slice(0, 8)}`);
    const workspaceUris = Array.isArray(raw.workspaceUris)
      ? raw.workspaceUris.filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [];
    const cwd = workspaceUris.length ? fileUriToPath(workspaceUris[0]) : null;
    out.push({
      conversationId,
      parentId: parentNativeId,
      typeName,
      role: role || typeName,
      label,
      rawState: text(raw.state) || 'SUBAGENT_STATE_ALIVE',
      spawnStepIndex: finite(raw.spawnStepIndex) ? raw.spawnStepIndex : null,
      cwd,
      workspaceUris,
      transcriptFile,
      isSwarmWorker,
      swarmMemberName,
      swarmKilled: swarmMember?.killed === true,
      swarmModel: swarmMember?.model ?? null,
    });
  }
  out.sort((a, b) => (a.spawnStepIndex ?? 0) - (b.spawnStepIndex ?? 0) || a.label.localeCompare(b.label));
  return out;
}

/**
 * Reverse lookup: find which parent brain directory owns `childNativeId`.
 * Cached briefly in memory by child id so repeated transcript parses don't re-scan.
 */
const parentLookupCache = new Map<string, { checkedAt: number; descriptor: AgySubagentDescriptor | null }>();
const PARENT_CACHE_TTL_MS = 5000;

export function findAgySubagentParent(childNativeId: string): AgySubagentDescriptor | null {
  if (!validSessionId(childNativeId)) return null;
  const cached = parentLookupCache.get(childNativeId);
  if (cached && Date.now() - cached.checkedAt < PARENT_CACHE_TTL_MS) return cached.descriptor;
  const root = agyBrainRoot();
  let dirs: fs.Dirent[];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  const targetFile = `${childNativeId}.json`;
  for (const ent of dirs) {
    if (!ent.isDirectory() || ent.isSymbolicLink() || !validSessionId(ent.name) || ent.name === childNativeId) continue;
    const candidatePath = path.join(root, ent.name, '.system_generated', 'subagents', targetFile);
    try {
      if (!fs.lstatSync(candidatePath).isFile()) continue;
    } catch { continue; }
    const found = readAgySubagentDescriptors(ent.name).find(d => d.conversationId === childNativeId) ?? null;
    if (parentLookupCache.size > 512) parentLookupCache.clear();
    parentLookupCache.set(childNativeId, { checkedAt: Date.now(), descriptor: found });
    return found;
  }
  if (parentLookupCache.size > 512) parentLookupCache.clear();
  parentLookupCache.set(childNativeId, { checkedAt: Date.now(), descriptor: null });
  return null;
}

/**
 * True when a subagent is still loaded under a live parent. Killed, errored,
 * or explicitly finished subagents return false.
 */
export function isAgySubagentLive(parentNativeId: string, childNativeId: string): boolean {
  const desc = readAgySubagentDescriptors(parentNativeId).find(d => d.conversationId === childNativeId);
  if (!desc) return false;
  if (desc.swarmKilled) return false;
  if (/KILLED|ERROR|FAILED|STOPPED|DEAD/i.test(desc.rawState)) return false;
  return true;
}

// ---- Transcript activity & step inspection ----------------------------------

function parseStepToolArgs(rawArgs: unknown): ProtocolRecord {
  if (!isRecord(rawArgs)) return {};
  const out: ProtocolRecord = {};
  for (const [key, value] of Object.entries(rawArgs)) {
    if (typeof value === 'string') {
      try { out[key] = JSON.parse(value); } catch { out[key] = value; }
    } else {
      out[key] = value;
    }
  }
  return out;
}

function summarizeStepTool(name: string, rawArgs: unknown): string {
  const args = parseStepToolArgs(rawArgs);
  const norm = normalizeAcpTool({ name, args });
  if (norm.toolName === 'bash') {
    const cmd = text(norm.args.command).split('\n')[0].trim();
    return cmd ? `Running ${cmd.slice(0, 60)}` : 'Running command';
  }
  if (norm.toolName === 'read' || norm.toolName === 'edit' || norm.toolName === 'write') {
    const filePath = text(norm.args.path);
    return `${norm.toolName} ${filePath ? path.basename(filePath) : 'file'}`;
  }
  if (name === 'swarm') return `swarm ${text(args.action)}`;
  if (name === 'post_message') return 'Posting to board';
  if (name === 'read_board') return 'Reading board';
  if (name === 'swarm_wait') return 'Waiting on board';
  if (name === 'search_web') return `Searching: ${text(args.query).slice(0, 50)}`;
  if (name === 'invoke_subagent') return `Spawning ${text(args.Role) || text(args.TypeName) || 'subagent'}`;
  return `Running ${name}`;
}

export interface AgyTranscriptActivity {
  working: boolean;
  parkedOnBoard: boolean;
  lastActivity: string | null;
  stepCount: number;
  model: string | null;
  currentAction: string | null;
}

const SERVER_RESTART_NOTICE_RE = /background tasks have been stopped due to server restart/i;
/** A DONE non-running tail step older than this is no longer awaiting an immediate LLM response. */
const STALE_PENDING_STEP_MS = 5 * 60 * 1000;

/**
 * Fast tail inspection of a brain `transcript.jsonl` to decide whether the
 * subagent/worker is actively executing a turn vs parked/done.
 */
export function inspectAgyTranscriptActivity(conversationId: string): AgyTranscriptActivity {
  const file = agyBrainTranscriptPath(conversationId);
  if (!file) return { working: false, parkedOnBoard: false, lastActivity: null, stepCount: 0, model: null, currentAction: null };
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { working: false, parkedOnBoard: false, lastActivity: null, stepCount: 0, model: null, currentAction: null };
    }
  } catch {
    return { working: false, parkedOnBoard: false, lastActivity: null, stepCount: 0, model: null, currentAction: null };
  }
  const steps = readTranscriptTailSteps(file);
  if (!steps.length) {
    return { working: false, parkedOnBoard: false, lastActivity: stat.mtime.toISOString(), stepCount: 0, model: null, currentAction: null };
  }
  let model: string | null = null;
  let lastStepIndex = 0;
  let lastPlannerCalls: { name: string; args: unknown }[] = [];
  let genericsAfterPlanner = 0;
  let lastPlannerHadTextOnly = false;
  let parkedOnBoard = false;
  let parkedOnTimer = false;
  let stoppedByRestart = false;

  for (const step of steps) {
    const idx = finite(step.step_index) ? step.step_index : 0;
    if (idx >= lastStepIndex) lastStepIndex = idx;
    if (typeof step.model === 'string' && step.model) model = step.model;
    const type = text(step.type);
    if (type === 'PLANNER_RESPONSE') {
      const calls = Array.isArray(step.tool_calls)
        ? step.tool_calls.flatMap(c => isRecord(c) && typeof c.name === 'string' ? [{ name: c.name, args: c.args }] : [])
        : [];
      lastPlannerCalls = calls;
      genericsAfterPlanner = 0;
      lastPlannerHadTextOnly = calls.length === 0;
      parkedOnBoard = false;
      parkedOnTimer = false;
      stoppedByRestart = false;
    } else if (type === 'GENERIC') {
      genericsAfterPlanner++;
      const matchedCall = lastPlannerCalls[genericsAfterPlanner - 1];
      const stepStatus = text(step.status);
      if (matchedCall?.name === 'swarm_wait' && stepStatus !== 'ERROR' && stepStatus !== 'FAILED') {
        parkedOnBoard = true;
      } else if (matchedCall?.name === 'schedule' && stepStatus !== 'ERROR' && stepStatus !== 'FAILED') {
        parkedOnTimer = true;
      }
    } else if (type === 'USER_INPUT' || type === 'SYSTEM_MESSAGE') {
      lastPlannerCalls = [];
      genericsAfterPlanner = 0;
      lastPlannerHadTextOnly = false;
      parkedOnBoard = false;
      parkedOnTimer = false;
      stoppedByRestart = type === 'SYSTEM_MESSAGE' && SERVER_RESTART_NOTICE_RE.test(text(step.content));
    }
  }

  const last = steps[steps.length - 1];
  const lastType = text(last.type);
  const lastStatus = text(last.status);
  const lastActivity = text(last.created_at) || stat.mtime.toISOString();

  // If the last step is still RUNNING, or is a fresh USER_INPUT/SYSTEM_MESSAGE
  // awaiting model response, or a PLANNER_RESPONSE with unfinished tool calls: working!
  // Exceptions: `swarm_wait` (parked on board), `schedule` (sleeping on timer),
  // server-restart notices, and stale DONE steps that never produced a follow-up.
  const unfinishedTools = lastPlannerCalls.length > 0 && genericsAfterPlanner < lastPlannerCalls.length;
  const activeCall = unfinishedTools ? (lastPlannerCalls[genericsAfterPlanner] ?? lastPlannerCalls[lastPlannerCalls.length - 1]) : null;
  if (activeCall?.name === 'swarm_wait') parkedOnBoard = true;
  if (activeCall?.name === 'schedule') parkedOnTimer = true;
  const transcriptStale = Date.now() - stat.mtimeMs > STALE_PENDING_STEP_MS;
  const freshMessage = !stoppedByRestart && !transcriptStale
    && (lastType === 'USER_INPUT' || lastType === 'SYSTEM_MESSAGE') && lastStatus === 'DONE';
  const runningStep = !parkedOnTimer
    && (lastStatus === 'RUNNING' || lastStatus === 'PENDING' || lastStatus === 'IN_PROGRESS');
  const waitingForNextPlanner = !transcriptStale
    && lastPlannerCalls.length > 0 && genericsAfterPlanner >= lastPlannerCalls.length
    && !parkedOnBoard && !parkedOnTimer;

  // Guard against stale/crashed turns from long-dead conversations: callers also check parent liveness.
  const working = !parkedOnBoard && !parkedOnTimer && !stoppedByRestart && !lastPlannerHadTextOnly
    && (runningStep || unfinishedTools || freshMessage || waitingForNextPlanner);

  let currentAction: string | null = null;
  if (parkedOnBoard) {
    currentAction = 'Waiting on board';
  } else if (parkedOnTimer) {
    currentAction = 'Waiting on schedule';
  } else if (unfinishedTools) {
    currentAction = activeCall ? summarizeStepTool(activeCall.name, activeCall.args) : 'Running tool';
  } else if (runningStep && lastType === 'GENERIC') {
    currentAction = 'Running background task';
  } else if (working) {
    currentAction = 'Thinking…';
  } else if (lastType === 'PLANNER_RESPONSE' && text(last.content)) {
    currentAction = text(last.content).replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  return {
    working,
    parkedOnBoard,
    lastActivity,
    stepCount: lastStepIndex + 1,
    model,
    currentAction,
  };
}

/** True when any subagent, swarm worker, or non-daemon task of `sessionId` is actively running. */
export function hasActiveAgyBrainWork(nativeSessionId: string, visited = new Set<string>()): boolean {
  if (visited.has(nativeSessionId)) return false;
  visited.add(nativeSessionId);
  const restartMs = readLastServerRestartMs(nativeSessionId);
  const subs = readAgySubagentDescriptors(nativeSessionId);
  for (const sub of subs) {
    if (sub.swarmKilled || /KILLED|ERROR|FAILED|STOPPED|DEAD/i.test(sub.rawState)) continue;
    if (restartMs > 0) {
      try {
        if (fs.statSync(sub.transcriptFile).mtimeMs < restartMs) continue;
      } catch { continue; }
    }
    const act = inspectAgyTranscriptActivity(sub.conversationId);
    if (act.working) return true;
    if (hasActiveAgyBrainWork(sub.conversationId, visited)) return true;
  }
  const tasks = readAgyBackgroundTasks(nativeSessionId, true);
  return tasks.some(task => task.status === 'running' && !task.isDaemon);
}

// ---- Brain transcript.jsonl → Pi-v3 SessionEntries --------------------------

function stripUserRequestWrapper(raw: string): string {
  const m = /<USER_REQUEST>\s*\n?([\s\S]*?)\n?\s*<\/USER_REQUEST>/.exec(raw);
  return (m ? m[1] : raw).trim();
}

function stripToolTimestamps(raw: string): string {
  // agy prepends 1–2 pairs of "Created At: ...\nCompleted At: ...\n" to GENERIC outputs.
  return raw.replace(/^(?:Created At: [^\n]*\n(?:Completed At: [^\n]*\n)?)+/, '').trim();
}

function parseSystemMessage(raw: string): { sender: string; content: string; noisy: boolean } | null {
  const innerMatch = /<SYSTEM_MESSAGE>\s*\n?([\s\S]*?)\n?\s*<\/SYSTEM_MESSAGE>/.exec(raw);
  const inner = (innerMatch ? innerMatch[1] : raw).trim();
  const isNoisySwarmWake = (body: string) => /^\[swarm\] new board message #\d+\b/i.test(body);
  const msgMatch = /^\[Message\]\s+timestamp=\S+\s+sender=(\S+)\s+priority=\S+\s+content=([\s\S]*)$/.exec(inner);
  if (!msgMatch) {
    if (!inner) return null;
    return { sender: 'system', content: inner, noisy: isNoisySwarmWake(inner) };
  }
  const sender = msgMatch[1];
  const content = msgMatch[2].trim();
  return { sender, content, noisy: isNoisySwarmWake(content) };
}

function resolveAgyParentSessionPath(parentId: string): string | null {
  const mirror = path.join(dishDir(), 'agy', 'sessions', `${parentId}.jsonl`);
  if (fs.existsSync(mirror)) return mirror;
  const transcript = agyBrainTranscriptPath(parentId);
  if (transcript && fs.existsSync(transcript)) return transcript;
  return null;
}

/**
 * Convert an Antigravity brain `transcript.jsonl` into standard Pi-v3
 * `SessionEntries` so `session-files.ts`, `session-index.ts`, `Subagents`,
 * and `Swarm` trace peeking all consume it without a separate message model.
 */
export function parseAgyBrainEntries(
  content: string,
  file: string,
  hint?: { conversationId?: string; parentSession?: string | null; cwd?: string | null; name?: string | null } | null,
): SessionEntries {
  const convId = hint?.conversationId || conversationIdFromBrainTranscript(file) || path.basename(path.dirname(file));
  const parentDesc = (!hint || hint.parentSession === undefined || hint.name === undefined)
    ? findAgySubagentParent(convId)
    : null;
  const parentSession = hint?.parentSession !== undefined
    ? hint.parentSession
    : parentDesc ? resolveAgyParentSessionPath(parentDesc.parentId) : null;
  const cwd = hint?.cwd ?? parentDesc?.cwd ?? null;
  const displayName = hint?.name ?? parentDesc?.label ?? null;

  const steps = parseJsonLines(content);
  const firstTs = steps.length && text(steps[0].created_at) ? text(steps[0].created_at) : new Date().toISOString();

  const entries: unknown[] & { firstEntryOnFirstLine?: boolean } = [];
  entries.firstEntryOnFirstLine = true;
  let parentEntryId: string | null = null;
  let seq = 0;

  const push = (type: string, fields: ProtocolRecord, timestamp: string) => {
    const id = `brain-${convId.slice(0, 8)}-${++seq}`;
    entries.push({ type, id, parentId: parentEntryId, timestamp, ...fields });
    parentEntryId = id;
  };

  entries.push({
    type: 'session',
    version: 3,
    id: convId,
    ...(cwd ? { cwd } : {}),
    ...(parentSession ? { parentSession } : {}),
    timestamp: firstTs,
    agy: { brain: true, ...(parentDesc ? { typeName: parentDesc.typeName, role: parentDesc.role } : {}) },
  });

  if (displayName) {
    push('session_info', { name: displayName }, firstTs);
  }

  let currentModel: string | null = null;
  interface PendingCall { id: string; toolName: string; nativeName: string }
  const pendingCalls: PendingCall[] = [];

  for (const step of steps) {
    const stepIndex = finite(step.step_index) ? step.step_index : seq;
    const timestamp = text(step.created_at) || firstTs;
    const ms = Date.parse(timestamp);
    const msgTimestamp = Number.isFinite(ms) ? ms : Date.now();
    const type = text(step.type);

    if (type === 'USER_INPUT') {
      const body = stripUserRequestWrapper(text(step.content));
      if (!body) continue;
      push('message', {
        message: { role: 'user', content: [{ type: 'text', text: body }], timestamp: msgTimestamp },
      }, timestamp);
      continue;
    }

    if (type === 'SYSTEM_MESSAGE') {
      const parsed = parseSystemMessage(text(step.content));
      if (!parsed || parsed.noisy || !parsed.content) continue;
      // The first assignment message to a subagent/worker reads best as the opening user prompt.
      if (stepIndex <= 1) {
        push('message', {
          message: { role: 'user', content: [{ type: 'text', text: parsed.content }], timestamp: msgTimestamp },
        }, timestamp);
      } else {
        push('custom_message', {
          customType: 'agy-message',
          content: [{ type: 'text', text: parsed.content }],
          details: { sender: parsed.sender },
          display: true,
        }, timestamp);
      }
      continue;
    }

    if (type === 'PLANNER_RESPONSE') {
      const model: string | null = text(step.model) || currentModel;
      if (model && model !== currentModel) {
        currentModel = model;
        push('model_change', { modelId: model, provider: AGY_PROVIDER }, timestamp);
      }
      const blocks: ProtocolRecord[] = [];
      const thinking = text(step.thinking);
      if (thinking) blocks.push({ type: 'thinking', thinking });
      const body = text(step.content);
      if (body) blocks.push({ type: 'text', text: body });
      const rawCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
      for (let i = 0; i < rawCalls.length; i++) {
        const rawCall = rawCalls[i];
        if (!isRecord(rawCall) || typeof rawCall.name !== 'string' || !rawCall.name) continue;
        const parsedArgs = parseStepToolArgs(rawCall.args);
        const norm = normalizeAcpTool({ name: rawCall.name, args: parsedArgs });
        const callId = `step-${stepIndex}-call-${i}`;
        blocks.push({ type: 'toolCall', id: callId, name: norm.toolName, arguments: norm.args });
        pendingCalls.push({ id: callId, toolName: norm.toolName, nativeName: norm.nativeName });
      }
      if (!blocks.length) continue;
      const input = finite(step.input_tokens) ? step.input_tokens : 0;
      const cacheRead = finite(step.cache_read_tokens) ? step.cache_read_tokens : 0;
      const output = finite(step.output_tokens) ? step.output_tokens : 0;
      const totalTokens = input + cacheRead + output;
      const usage = totalTokens > 0 ? { input, cacheRead, output, totalTokens } : undefined;
      push('message', {
        message: {
          role: 'assistant',
          content: blocks,
          timestamp: msgTimestamp,
          api: 'acp',
          provider: AGY_PROVIDER,
          ...(model ? { model } : {}),
          stopReason: rawCalls.length ? 'toolUse' : 'stop',
          ...(usage ? { usage } : {}),
        },
      }, timestamp);
      continue;
    }

    if (type === 'GENERIC') {
      const call = pendingCalls.shift();
      if (!call) continue;
      const body = stripToolTimestamps(text(step.content));
      const isError = text(step.status) === 'ERROR' || text(step.status) === 'FAILED';
      const exitMatch = call.nativeName === 'run_command' ? /Command exited with code (-?\d+)/.exec(body) : null;
      const details = call.nativeName === 'run_command'
        ? { kind: 'bash', timedOut: false, timeoutDisabled: true, ...(exitMatch ? { exitCode: Number(exitMatch[1]) } : {}) }
        : undefined;
      push('message', {
        message: {
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.toolName,
          content: [{ type: 'text', text: body }],
          isError,
          timestamp: msgTimestamp,
          ...(details ? { details } : {}),
        },
      }, timestamp);
    }
  }

  return entries;
}

// ---- Tool output enrichment & live task log streaming -----------------------

const ENRICHABLE_TOOLS = new Set([
  'swarm', 'post_message', 'read_board', 'swarm_wait',
  'invoke_subagent', 'manage_subagents', 'define_subagent', 'send_message',
  'manage_task', 'schedule', 'run_workflow', 'search_web',
]);

/**
 * agy ACP leaves `content` and `rawOutput` empty on non-filesystem tool updates
 * (`swarm`, `read_board`, `invoke_subagent`, `manage_task`, …), while writing
 * the real result to `brain/<id>/.system_generated/logs/transcript.jsonl`.
 * Best-effort lookup of the matching recent tool output.
 */
export function findLatestToolStepOutput(nativeSessionId: string, nativeToolName: string): string | null {
  if (!ENRICHABLE_TOOLS.has(nativeToolName)) return null;
  const file = agyBrainTranscriptPath(nativeSessionId);
  if (!file) return null;
  const steps = readTranscriptTailSteps(file);
  if (!steps.length) return null;

  // Walk from the tail to find the most recent PLANNER_RESPONSE containing `nativeToolName`
  // and pair its matching GENERIC output step by ordinal offset.
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (text(step.type) !== 'PLANNER_RESPONSE') continue;
    const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    const matchIndex = calls.map(c => isRecord(c) ? text(c.name) : '').lastIndexOf(nativeToolName);
    if (matchIndex < 0) continue;
    let seenGenerics = 0;
    for (let j = i + 1; j < steps.length; j++) {
      const next = steps[j];
      if (text(next.type) === 'PLANNER_RESPONSE') break;
      if (text(next.type) !== 'GENERIC') continue;
      if (seenGenerics === matchIndex) {
        const stepIdx = finite(next.step_index) ? next.step_index : null;
        // Prefer the untruncated step output file when it exists and is bounded.
        if (stepIdx !== null) {
          const outFile = path.join(agyBrainDir(nativeSessionId)!, '.system_generated', 'steps', String(stepIdx), 'output.txt');
          const tail = readRegularTail(outFile, 16 * 1024);
          if (tail && tail.content.trim()) return stripToolTimestamps(tail.content);
        }
        const cleaned = stripToolTimestamps(text(next.content));
        return cleaned || null;
      }
      seenGenerics++;
    }
    break;
  }
  return null;
}

/**
 * Find the live `.system_generated/tasks/task-<N>.log` tail for an in-flight
 * backgrounded `run_command` (matching `command` if multiple tasks run).
 */
export function readRunningTaskLogTail(nativeSessionId: string, commandHint?: string): string | null {
  const tasks = readAgyBackgroundTasks(nativeSessionId, true);
  const running = tasks.filter(t => t.kind === 'shell' && t.status === 'running' && t.hasLog);
  if (running.length) {
    const normalizedHint = (commandHint || '').trim();
    const matched = (normalizedHint
      ? running.find(t => t.command && t.command.trim() === normalizedHint)
        ?? running.find(t => t.command && normalizedHint.startsWith(t.command.trim().slice(0, 40)))
      : null) ?? running[running.length - 1];
    const log = readAgyTaskLog(nativeSessionId, matched.id, 8192);
    return log?.content.trim() ? log.content : null;
  }
  // Fallback: while a `run_command` tool is live over ACP, agy creates `tasks/task-<N>.log`
  // before the corresponding GENERIC step flushes to `transcript.jsonl`. Read the freshest
  // recently modified log that has not been recorded as completed or killed.
  const recentThreshold = Date.now() - 15_000;
  const freshOrphan = tasks
    .filter(t => t.kind === 'shell' && t.hasLog && t.exitCode === null && t.status !== 'killed'
      && t.finishedAt && Date.parse(t.finishedAt) >= recentThreshold)
    .sort((a, b) => Date.parse(b.finishedAt!) - Date.parse(a.finishedAt!))[0];
  if (!freshOrphan) return null;
  const log = readAgyTaskLog(nativeSessionId, freshOrphan.id, 8192);
  return log?.content.trim() ? log.content : null;
}

/**
 * Per-step LLM cache probes from Antigravity's brain `transcript.jsonl`.
 * Mirrors only carry cumulative per-turn `PromptResponse.usage` (where a
 * multi-step turn's warm step 2 masks a cold step 1); brain steps report
 * exact per-call `input_tokens` and `cache_read_tokens` for the learner.
 */
export function readAgyBrainCacheProbeEntries(nativeSessionId: string): { file: string; entries: SessionEntries } | null {
  const file = agyBrainTranscriptPath(nativeSessionId);
  if (!file) return null;
  let content: string;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 32 * 1024 * 1024) return null;
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const steps = parseJsonLines(content);
  const entries: unknown[] = [];
  let currentModel: string | null = null;
  for (const step of steps) {
    if (text(step.type) !== 'PLANNER_RESPONSE') continue;
    const model: string | null = text(step.model) || currentModel;
    if (model) currentModel = model;
    if (!model) continue;
    const createdAt = text(step.created_at);
    const ts = createdAt ? Date.parse(createdAt) : NaN;
    if (!Number.isFinite(ts)) continue;
    const input = finite(step.input_tokens) && step.input_tokens > 0 ? step.input_tokens : 0;
    const cacheRead = finite(step.cache_read_tokens) && step.cache_read_tokens > 0 ? step.cache_read_tokens : 0;
    if (input + cacheRead <= 0) continue;
    entries.push({
      type: 'message',
      timestamp: createdAt,
      message: {
        role: 'assistant',
        api: 'acp',
        provider: AGY_PROVIDER,
        model,
        timestamp: ts,
        content: [],
        usage: { input, cacheRead, cacheWrite: 0 },
      },
    });
  }
  return entries.length ? { file, entries } : null;
}

/**
 * Latest per-step usage from brain `transcript.jsonl`, used as a fallback for
 * autonomous ACP turns that finish without a `PromptResponse.usage` frame.
 */
export function readLatestAgyBrainStepUsage(nativeSessionId: string, minTimestampMs?: number): ProtocolRecord | null {
  const file = agyBrainTranscriptPath(nativeSessionId);
  if (!file) return null;
  const steps = readTranscriptTailSteps(file);
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (text(step.type) !== 'PLANNER_RESPONSE') continue;
    const createdAt = text(step.created_at);
    const ts = createdAt ? Date.parse(createdAt) : NaN;
    if (minTimestampMs !== undefined && Number.isFinite(ts) && ts < minTimestampMs) return null;
    const input = finite(step.input_tokens) && step.input_tokens >= 0 ? step.input_tokens : 0;
    const cacheRead = finite(step.cache_read_tokens) && step.cache_read_tokens >= 0 ? step.cache_read_tokens : 0;
    const output = finite(step.output_tokens) && step.output_tokens >= 0 ? step.output_tokens : 0;
    const totalTokens = input + cacheRead + output;
    if (totalTokens <= 0) return null;
    return { input, output, cacheRead, cacheWrite: 0, totalTokens };
  }
  return null;
}

// ---- Background tasks, schedules & plan -------------------------------------

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

const BG_SHELL_BANNER_RE = /^Tool is running as a background task with task id:\s*((?:[a-zA-Z0-9_-]+\/)?(task-\d+))/im;
const BG_TASK_ID_RE = /task id:\s*((?:[a-zA-Z0-9_-]+\/)?(task-\d+))/i;
const BG_TASK_DESC_RE = /Task Description:\s*([^\n]+)/i;
const EXIT_CODE_RE = /Command exited with code (-?\d+)/;
const TASK_CANCELED_RE = /\b(?:was cance(?:l|ll)ed|Tool execution was cance(?:l|ll)ed)\b/i;

function taskIdBelongsToSession(fullTaskId: string | undefined, nativeSessionId: string): boolean {
  if (!fullTaskId) return true;
  const slash = fullTaskId.indexOf('/');
  return slash < 0 || fullTaskId.slice(0, slash) === nativeSessionId;
}

interface TaskCompletionRecord {
  finishedAt: string | null;
  content: string;
  exitCode: number | null;
  failed: boolean;
  canceled: boolean;
}

function readTaskCompletionMessages(nativeSessionId: string): {
  completions: Map<string, TaskCompletionRecord>;
  lastServerRestartMs: number;
} {
  const dir = agyBrainDir(nativeSessionId);
  const completions = new Map<string, TaskCompletionRecord>();
  let lastServerRestartMs = 0;
  if (!dir) return { completions, lastServerRestartMs };
  const msgDir = path.join(dir, '.system_generated', 'messages');
  let entries: fs.Dirent[];
  try {
    if (!fs.lstatSync(msgDir).isDirectory()) return { completions, lastServerRestartMs };
    entries = fs.readdirSync(msgDir, { withFileTypes: true });
  } catch { return { completions, lastServerRestartMs }; }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json') || entry.name === 'read.json') continue;
    const raw = readJsonFile(path.join(msgDir, entry.name));
    if (!raw) continue;
    const sender = text(raw.sender);
    const content = text(raw.content);
    const tsText = text(raw.timestamp) || null;
    if (sender === 'system' && SERVER_RESTART_NOTICE_RE.test(content)) {
      const ms = tsText ? Date.parse(tsText) : NaN;
      if (Number.isFinite(ms) && ms > lastServerRestartMs) lastServerRestartMs = ms;
      continue;
    }
    const slash = sender.lastIndexOf('/');
    if (slash > 0 && sender.slice(0, slash) !== nativeSessionId) continue;
    const shortSender = slash >= 0 ? sender.slice(slash + 1) : sender;
    if (!TASK_ID_RE.test(shortSender)) continue;
    const exitMatch = EXIT_CODE_RE.exec(content);
    const exitCode = exitMatch ? Number(exitMatch[1]) : null;
    const title = text(asRecord(raw.renderDetails).messageTitle);
    const canceled = TASK_CANCELED_RE.test(content) || TASK_CANCELED_RE.test(title);
    const failed = !canceled && ((exitCode !== null && exitCode !== 0) || /failed|error/i.test(title));
    completions.set(shortSender, {
      finishedAt: tsText,
      content,
      exitCode,
      failed,
      canceled,
    });
  }
  return { completions, lastServerRestartMs };
}

/** Epoch ms of the latest `server restart` notice recorded for `nativeSessionId`, or 0. */
export function readLastServerRestartMs(nativeSessionId: string): number {
  let latest = readTaskCompletionMessages(nativeSessionId).lastServerRestartMs;
  const transcriptFile = agyBrainTranscriptPath(nativeSessionId);
  if (!transcriptFile) return latest;
  for (const step of readTranscriptTailSteps(transcriptFile)) {
    if (text(step.type) !== 'SYSTEM_MESSAGE') continue;
    if (!SERVER_RESTART_NOTICE_RE.test(text(step.content))) continue;
    const ms = Date.parse(text(step.created_at));
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  }
  return latest;
}

export function readAgyBackgroundTasks(nativeSessionId: string, parentLive: boolean): AgyBackgroundTask[] {
  const dir = agyBrainDir(nativeSessionId);
  if (!dir) return [];
  const tasksDir = path.join(dir, '.system_generated', 'tasks');
  const logStats = new Map<string, { size: number; mtime: string }>();
  try {
    if (fs.lstatSync(tasksDir).isDirectory()) {
      for (const entry of fs.readdirSync(tasksDir, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.log')) continue;
        const id = entry.name.slice(0, -4);
        if (!TASK_ID_RE.test(id)) continue;
        try {
          const st = fs.statSync(path.join(tasksDir, entry.name));
          logStats.set(id, { size: st.size, mtime: st.mtime.toISOString() });
        } catch {}
      }
    }
  } catch {}

  const msgInfo = readTaskCompletionMessages(nativeSessionId);
  const completions = msgInfo.completions;
  let lastServerRestartMs = msgInfo.lastServerRestartMs;
  let lastServerRestartStep = -1;
  const killedIds = new Set<string>();
  const tasksById = new Map<string, AgyBackgroundTask>();
  const systemMessageSteps: { pos: number; sender: string; createdAt: string | null }[] = [];

  const transcriptFile = agyBrainTranscriptPath(nativeSessionId);
  let steps: ProtocolRecord[] = [];
  if (transcriptFile) {
    try {
      const stat = fs.lstatSync(transcriptFile);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024) {
        steps = parseJsonLines(fs.readFileSync(transcriptFile, 'utf8'));
      }
    } catch {}
  }

  // Pre-pass: gather completion/cancellation/restart SYSTEM_MESSAGEs and
  // manage_task kill calls so earlier GENERIC start steps know their final status immediately.
  for (let stepPos = 0; stepPos < steps.length; stepPos++) {
    const step = steps[stepPos];
    const type = text(step.type);
    const createdAt = text(step.created_at) || null;
    if (type === 'PLANNER_RESPONSE') {
      const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
      for (const c of calls) {
        if (!isRecord(c) || c.name !== 'manage_task') continue;
        const args = parseStepToolArgs(c.args);
        if (text(args.Action) === 'kill') {
          const tid = text(args.TaskId);
          if (!taskIdBelongsToSession(tid, nativeSessionId)) continue;
          const shortId = tid.includes('/') ? tid.slice(tid.lastIndexOf('/') + 1) : tid;
          if (shortId) killedIds.add(shortId);
        }
      }
      continue;
    }
    if (type === 'SYSTEM_MESSAGE') {
      const content = text(step.content);
      const parsedSys = parseSystemMessage(content);
      if (parsedSys && !parsedSys.noisy) {
        systemMessageSteps.push({ pos: stepPos, sender: parsedSys.sender, createdAt });
      }
      if (SERVER_RESTART_NOTICE_RE.test(content)) {
        lastServerRestartStep = stepPos;
        const ms = createdAt ? Date.parse(createdAt) : NaN;
        if (Number.isFinite(ms) && ms > lastServerRestartMs) lastServerRestartMs = ms;
        continue;
      }
      const idMatch = /sender=((?:[a-zA-Z0-9_-]+\/)?(task-\d+))/.exec(content)
        ?? /Task id "((?:[a-zA-Z0-9_-]+\/)?(task-\d+))"\s+(?:finished|was cance(?:l|ll)ed|cance(?:l|ll)ed|killed|stopped)/i.exec(content);
      if (idMatch && taskIdBelongsToSession(idMatch[1], nativeSessionId)) {
        const shortId = idMatch[2];
        const canceled = TASK_CANCELED_RE.test(content);
        if (canceled) killedIds.add(shortId);
        if (!completions.has(shortId)) {
          const exitMatch = EXIT_CODE_RE.exec(content);
          const exitCode = exitMatch ? Number(exitMatch[1]) : null;
          completions.set(shortId, {
            finishedAt: createdAt,
            content,
            exitCode,
            failed: !canceled && exitCode !== null && exitCode !== 0,
            canceled,
          });
        }
      }
    }
  }

  interface CallRecord { name: string; args: ProtocolRecord; createdAt: string | null }
  const pendingCalls: CallRecord[] = [];
  const wasStoppedByRestart = (stepPos: number, startedAt: string | null): boolean => {
    if (stepPos < lastServerRestartStep) return true;
    const ms = startedAt ? Date.parse(startedAt) : NaN;
    return Number.isFinite(ms) && lastServerRestartMs > 0 && ms < lastServerRestartMs;
  };

  for (let stepPos = 0; stepPos < steps.length; stepPos++) {
    const step = steps[stepPos];
    const type = text(step.type);
    const createdAt = text(step.created_at) || null;
    if (type === 'USER_INPUT') {
      // A new user prompt starts a fresh turn; clear any unreturned calls from an aborted turn.
      pendingCalls.length = 0;
      continue;
    }
    if (type === 'PLANNER_RESPONSE') {
      const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
      for (const c of calls) {
        if (!isRecord(c) || typeof c.name !== 'string') continue;
        pendingCalls.push({ name: c.name, args: parseStepToolArgs(c.args), createdAt });
      }
      continue;
    }
    if (type !== 'GENERIC') continue;
    const call = pendingCalls.shift();
    if (!call) continue;
    const content = text(step.content);
    const cleaned = stripToolTimestamps(content);
    const status = text(step.status);

    if (call.name === 'run_command') {
      // Only treat `run_command` as backgrounded when it carries agy's actual
      // background-task banner for THIS conversation (never a quoted `task id:`
      // printed in synchronous command stdout) or when the step itself is RUNNING.
      const bannerMatch = BG_SHELL_BANNER_RE.exec(cleaned);
      const validBanner = bannerMatch && taskIdBelongsToSession(bannerMatch[1], nativeSessionId) ? bannerMatch : null;
      const stepIdx = finite(step.step_index) ? step.step_index : null;
      const inferredId = validBanner ? validBanner[2] : (stepIdx !== null && logStats.has(`task-${stepIdx}`) ? `task-${stepIdx}` : null);
      if (!inferredId) continue;
      const fullTaskId = validBanner ? validBanner[1] : `${nativeSessionId}/${inferredId}`;
      const cmd = text(call.args.CommandLine);
      const summary = text(call.args.toolSummary);
      const descMatch = BG_TASK_DESC_RE.exec(cleaned);
      const log = logStats.get(inferredId);
      const comp = completions.get(inferredId);
      const isDaemon = call.args.IsDaemon === true || call.args.IsDaemon === 'true';
      const startedAt = call.createdAt ?? createdAt;
      const killed = killedIds.has(inferredId) || comp?.canceled === true || (!comp && wasStoppedByRestart(stepPos, startedAt));
      // When run_command backgrounds itself, the GENERIC step starts with the
      // background-task banner (usually status RUNNING); the task stays running
      // until a completion/cancel message arrives, manage_task kills it, server restarts,
      // or the parent exits.
      const backgrounded = !!validBanner || status === 'RUNNING';
      const resolvedStatus: AgyBackgroundTask['status'] = killed
        ? 'killed'
        : comp
          ? (comp.failed ? 'failed' : 'completed')
          : (backgrounded && parentLive) ? 'running' : 'completed';
      tasksById.set(inferredId, {
        id: inferredId,
        fullTaskId,
        kind: 'shell',
        status: resolvedStatus,
        title: summary || (descMatch ? descMatch[1].trim() : '') || cmd.split('\n')[0].slice(0, 80) || inferredId,
        command: cmd || undefined,
        isDaemon,
        startedAt,
        finishedAt: comp?.finishedAt ?? (resolvedStatus !== 'running' ? (log?.mtime ?? null) : null),
        exitCode: comp?.exitCode ?? null,
        hasLog: !!log,
        ...(log ? { logBytes: log.size } : {}),
      });
      continue;
    }

    if (call.name === 'schedule') {
      const rawIdMatch = BG_TASK_ID_RE.exec(cleaned);
      const idMatch = rawIdMatch && taskIdBelongsToSession(rawIdMatch[1], nativeSessionId) ? rawIdMatch : null;
      const bareMatch = !idMatch ? /(task-\d+)/i.exec(cleaned) : null;
      const stepIdx = finite(step.step_index) ? step.step_index : null;
      const id = idMatch ? idMatch[2] : bareMatch ? bareMatch[1] : `schedule-${stepIdx ?? tasksById.size + 1}`;
      const fullTaskId = idMatch ? idMatch[1] : TASK_ID_RE.test(id) ? `${nativeSessionId}/${id}` : undefined;
      const cron = text(call.args.CronExpression) || undefined;
      const durationSeconds = finite(call.args.DurationSeconds) ? call.args.DurationSeconds : undefined;
      const timerCondition = text(call.args.TimerCondition);
      const prompt = text(call.args.Prompt);
      const isDaemon = call.args.IsDaemon === true || call.args.IsDaemon === 'true';
      const startedAt = call.createdAt ?? createdAt;
      const comp = completions.get(id);
      const killed = killedIds.has(id) || comp?.canceled === true || (!comp && wasStoppedByRestart(stepPos, startedAt));
      // A one-shot timer with `TimerCondition` ('any' or a sender id) is silently
      // cancelled early by agy when a matching SYSTEM_MESSAGE arrives.
      const earlyWake = !cron && timerCondition && timerCondition !== 'never'
        ? systemMessageSteps.find(msg => msg.pos > stepPos && (timerCondition === 'any' || msg.sender === timerCondition || msg.sender.endsWith(`/${timerCondition}`)))
        : undefined;
      const resolvedStatus: AgyBackgroundTask['status'] = killed
        ? 'killed'
        : (comp || earlyWake) && !cron ? 'completed'
        : parentLive ? 'scheduled' : 'completed';
      tasksById.set(id, {
        id,
        ...(fullTaskId ? { fullTaskId } : {}),
        kind: 'schedule',
        status: resolvedStatus,
        title: prompt.slice(0, 100) || (cron ? `Cron ${cron}` : `Timer ${durationSeconds ?? 0}s`),
        cron,
        durationSeconds,
        isDaemon,
        startedAt,
        finishedAt: comp?.finishedAt ?? earlyWake?.createdAt ?? null,
        exitCode: null,
        hasLog: logStats.has(id),
        ...(logStats.has(id) ? { logBytes: logStats.get(id)!.size } : {}),
        preview: prompt || undefined,
      });
      continue;
    }

    if (call.name === 'run_workflow') {
      const rawIdMatch = BG_TASK_ID_RE.exec(cleaned);
      const idMatch = rawIdMatch && taskIdBelongsToSession(rawIdMatch[1], nativeSessionId) ? rawIdMatch : null;
      const bareMatch = !idMatch ? /(task-\d+)/i.exec(cleaned) : null;
      const stepIdx = finite(step.step_index) ? step.step_index : null;
      const id = idMatch ? idMatch[2] : bareMatch ? bareMatch[1] : `workflow-${stepIdx ?? tasksById.size + 1}`;
      const fullTaskId = idMatch ? idMatch[1] : TASK_ID_RE.test(id) ? `${nativeSessionId}/${id}` : undefined;
      const desc = text(call.args.Description) || text(call.args.ScriptPath) || 'Workflow';
      const startedAt = call.createdAt ?? createdAt;
      const comp = completions.get(id);
      const killed = killedIds.has(id) || comp?.canceled === true || (!comp && wasStoppedByRestart(stepPos, startedAt));
      const backgrounded = !!(idMatch || bareMatch) || status === 'RUNNING';
      const resolvedStatus: AgyBackgroundTask['status'] = killed
        ? 'killed'
        : comp ? (comp.failed ? 'failed' : 'completed')
        : (backgrounded && parentLive) ? 'running' : (status === 'ERROR' ? 'failed' : 'completed');
      tasksById.set(id, {
        id,
        ...(fullTaskId ? { fullTaskId } : {}),
        kind: 'workflow',
        status: resolvedStatus,
        title: desc.slice(0, 100),
        startedAt,
        finishedAt: comp?.finishedAt ?? null,
        exitCode: comp?.exitCode ?? null,
        hasLog: logStats.has(id),
        ...(logStats.has(id) ? { logBytes: logStats.get(id)!.size } : {}),
      });
    }
  }

  // Apply late kills (manage_task kill appears after the task step).
  for (const id of killedIds) {
    const task = tasksById.get(id);
    if (task && (task.status === 'running' || task.status === 'scheduled')) task.status = 'killed';
  }

  // Surface any orphaned task-*.log files whose start step wasn't in the parsed transcript.
  for (const [id, stat] of logStats) {
    if (tasksById.has(id)) continue;
    const comp = completions.get(id);
    const killed = killedIds.has(id);
    tasksById.set(id, {
      id,
      fullTaskId: `${nativeSessionId}/${id}`,
      kind: 'shell',
      status: killed ? 'killed' : comp ? (comp.failed ? 'failed' : 'completed') : 'completed',
      title: id,
      startedAt: null,
      finishedAt: comp?.finishedAt ?? stat.mtime,
      exitCode: comp?.exitCode ?? null,
      hasLog: true,
      logBytes: stat.size,
    });
  }

  // Running/scheduled first, then newest by task number / startedAt.
  const rank = (s: AgyBackgroundTask['status']) => s === 'running' ? 0 : s === 'scheduled' ? 1 : 2;
  const numOf = (id: string) => { const m = /(\d+)$/.exec(id); return m ? Number(m[1]) : 0; };
  return [...tasksById.values()].sort((a, b) => rank(a.status) - rank(b.status) || numOf(b.id) - numOf(a.id));
}

export interface AgyTaskLogPayload {
  taskId: string;
  content: string;
  totalBytes: number;
  truncated: boolean;
  updatedAt: string;
}

export function readAgyTaskLog(nativeSessionId: string, taskId: string, requestedBytes = DEFAULT_TASK_LOG_BYTES): AgyTaskLogPayload | null {
  if (!TASK_ID_RE.test(taskId)) return null;
  const dir = agyBrainDir(nativeSessionId);
  if (!dir) return null;
  const maxBytes = Math.max(1024, Math.min(MAX_TASK_LOG_BYTES, finite(requestedBytes) ? requestedBytes : DEFAULT_TASK_LOG_BYTES));
  const file = path.join(dir, '.system_generated', 'tasks', `${taskId}.log`);
  const tail = readRegularTail(file, maxBytes);
  if (!tail) return null;
  return { taskId, ...tail };
}

// ---- Swarm full view state --------------------------------------------------

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
export function findAgySwarmCoordinator(nativeSessionId: string): string | null {
  const dir = agyBrainDir(nativeSessionId);
  if (!dir) return null;
  const swarmDir = path.join(dir, '.system_generated', 'swarm');
  if (fs.existsSync(path.join(swarmDir, 'members.json')) || fs.existsSync(path.join(swarmDir, 'swarm.json'))) {
    return nativeSessionId;
  }
  const parent = findAgySubagentParent(nativeSessionId);
  if (!parent) return null;
  const parentDir = agyBrainDir(parent.parentId);
  if (!parentDir) return null;
  const pSwarm = path.join(parentDir, '.system_generated', 'swarm');
  if (fs.existsSync(path.join(pSwarm, 'members.json')) || fs.existsSync(path.join(pSwarm, 'swarm.json'))) {
    return parent.parentId;
  }
  return null;
}

function memberState(
  raw: AgySwarmMemberRaw,
  activity: AgyTranscriptActivity,
  coordinatorActive: boolean,
  coordinatorTurnInProgress: boolean,
  isCoordinator: boolean,
): AgySwarmMemberView['state'] {
  if (raw.killed) return 'killed';
  if (!coordinatorActive) return 'stopped';
  if (isCoordinator) return coordinatorTurnInProgress || activity.working ? 'working' : 'waiting';
  return activity.working ? 'working' : 'waiting';
}

export function readAgySwarmState(
  nativeSessionId: string,
  options: { isActive?: boolean; coordinatorTurnInProgress?: boolean; since?: number } = {},
): AgySwarmStatePayload {
  const sessionRouteId = agyRouteId(nativeSessionId);
  const coordNativeId = findAgySwarmCoordinator(nativeSessionId);
  if (!coordNativeId) {
    return {
      supported: true,
      hasSwarm: false,
      sessionId: sessionRouteId,
      coordinatorId: sessionRouteId,
      coordinatorNativeId: nativeSessionId,
      title: '',
      createdAt: null,
      isActive: options.isActive === true,
      coordinatorTurnInProgress: options.coordinatorTurnInProgress === true,
      head: 0,
      members: [],
      channels: [],
      posts: [],
      plan: null,
      narratorView: null,
    };
  }

  const coordDir = agyBrainDir(coordNativeId)!;
  const swarmDir = path.join(coordDir, '.system_generated', 'swarm');
  const swarmMeta = readJsonFile(path.join(swarmDir, 'swarm.json'));
  const membersFile = readSwarmMembersFile(coordNativeId);
  const allBoard = readSwarmBoardPosts(coordNativeId, 0);
  const since = finite(options.since) && options.since > 0 ? options.since : 0;
  const posts = since > 0 ? allBoard.posts.filter(p => p.seq > since) : allBoard.posts;

  const lastPostByAgent = new Map<string, { seq: number; time: string }>();
  const channelCounts = new Map<string, number>();
  for (const post of allBoard.posts) {
    lastPostByAgent.set(post.agent, { seq: post.seq, time: post.time });
    channelCounts.set(post.channel, (channelCounts.get(post.channel) || 0) + 1);
  }

  const subDescs = new Map(readAgySubagentDescriptors(coordNativeId).map(d => [d.conversationId, d]));
  const coordActive = options.isActive === true;
  const coordTurn = options.coordinatorTurnInProgress === true;

  const members: AgySwarmMemberView[] = (membersFile?.members ?? []).map((m) => {
    const isCoord = m.name === 'coordinator' || m.conversationId === coordNativeId;
    const act = inspectAgyTranscriptActivity(m.conversationId);
    const lastPost = lastPostByAgent.get(m.name);
    const sub = subDescs.get(m.conversationId);
    const state = memberState(m, act, coordActive, coordTurn, isCoord);
    return {
      name: m.name,
      role: m.role,
      conversationId: m.conversationId,
      routeId: agyRouteId(m.conversationId),
      state,
      model: m.model || act.model,
      workspaceMode: m.workspaceMode,
      workspacePath: sub?.cwd ?? null,
      channels: m.channels.length ? m.channels : ['main'],
      lastReadSeq: m.lastReadSeq,
      lastPostSeq: lastPost?.seq ?? null,
      lastPostTime: lastPost?.time ?? null,
      unreadCount: m.killed ? 0 : Math.max(0, allBoard.head - m.lastReadSeq),
      currentAction: state === 'killed' ? 'Retired' : act.currentAction,
      stepCount: act.stepCount,
      lastActivity: act.lastActivity,
    };
  });
  // Coordinator first, then working, waiting, stopped, killed.
  const stateRank = (m: AgySwarmMemberView) =>
    m.name === 'coordinator' ? 0 : m.state === 'working' ? 1 : m.state === 'waiting' ? 2 : m.state === 'stopped' ? 3 : 4;
  members.sort((a, b) => stateRank(a) - stateRank(b) || a.name.localeCompare(b.name));

  // Build channel list (always include `main` if posts exist).
  const channelMap = new Map<string, AgySwarmChannelView>();
  channelMap.set('main', { name: 'main', topic: 'Main board', archived: false, postCount: channelCounts.get('main') || 0 });
  for (const ch of membersFile?.channels ?? []) {
    channelMap.set(ch.name, { name: ch.name, topic: ch.topic, archived: ch.archived, postCount: channelCounts.get(ch.name) || 0 });
  }
  for (const [chName, count] of channelCounts) {
    if (!channelMap.has(chName)) channelMap.set(chName, { name: chName, topic: '', archived: false, postCount: count });
  }

  const plan = readJsonFile(path.join(swarmDir, 'plan.json'), 128 * 1024);
  let narratorView: ProtocolRecord | null = null;
  const narrator = members.find(m => /^narrator(?:-\d+)?$/.test(m.name));
  if (narrator) {
    const narDir = agyBrainDir(narrator.conversationId);
    if (narDir) narratorView = readJsonFile(path.join(narDir, 'swarm_view', 'view.json'), 128 * 1024);
  }

  return {
    supported: true,
    hasSwarm: true,
    sessionId: sessionRouteId,
    coordinatorId: agyRouteId(coordNativeId),
    coordinatorNativeId: coordNativeId,
    title: membersFile?.title || 'Swarm',
    createdAt: text(swarmMeta?.created_at) || null,
    isActive: coordActive,
    coordinatorTurnInProgress: coordTurn,
    head: allBoard.head,
    members,
    channels: [...channelMap.values()],
    posts,
    plan,
    narratorView,
  };
}

export function readAgySessionTasks(
  nativeSessionId: string,
  options: {
    isActive?: boolean;
    canControl?: boolean;
    coordinatorTurnInProgress?: boolean;
    livePlan?: readonly AgyPlanItem[];
    liveRunningTools?: readonly { toolCallId: string; toolName: string; args: unknown; startedAt: number }[];
  } = {},
): AgySessionTasksPayload {
  const sessionId = agyRouteId(nativeSessionId);
  const isActive = options.isActive === true;
  const canControl = options.canControl ?? isActive;
  const tasks = readAgyBackgroundTasks(nativeSessionId, isActive);

  // Surface any live in-flight non-daemon tool calls (e.g. a running bash command
  // that hasn't hit WaitMsBeforeAsync yet, or an in-flight workflow).
  const existingRunningShells = new Set(
    tasks.filter(t => t.kind === 'shell' && t.status === 'running' && t.command).map(t => t.command!.trim()),
  );
  for (const live of options.liveRunningTools ?? []) {
    const args = isRecord(live.args) ? live.args : {};
    if (live.toolName === 'bash') {
      const cmd = text(args.command).trim();
      if (cmd && existingRunningShells.has(cmd)) continue;
      tasks.unshift({
        id: live.toolCallId,
        kind: 'tool',
        status: 'running',
        title: cmd.split('\n')[0].slice(0, 80) || 'bash',
        command: cmd || undefined,
        startedAt: new Date(live.startedAt).toISOString(),
        finishedAt: null,
        exitCode: null,
        hasLog: false,
      });
    }
  }

  // Collect direct & nested subagents (depth-capped to 4, cycle-guarded).
  const subagents: AgySubagentTaskSummary[] = [];
  const seen = new Set<string>([nativeSessionId]);
  const walkSubs = (parentId: string, depth: number) => {
    if (depth > 4 || subagents.length >= MAX_SUBAGENTS_PER_PARENT) return;
    for (const sub of readAgySubagentDescriptors(parentId)) {
      if (seen.has(sub.conversationId)) continue;
      seen.add(sub.conversationId);
      const act = inspectAgyTranscriptActivity(sub.conversationId);
      const state: AgySubagentTaskSummary['state'] = sub.swarmKilled || /KILLED/i.test(sub.rawState)
        ? 'killed'
        : /ERROR|FAILED/i.test(sub.rawState)
          ? 'error'
          : !isActive
            ? 'done'
            : act.working
              ? 'working'
              : sub.isSwarmWorker
                ? 'waiting'
                : 'done';
      subagents.push({
        id: agyRouteId(sub.conversationId),
        nativeSessionId: sub.conversationId,
        name: sub.label,
        typeName: sub.typeName,
        role: sub.role,
        state,
        isSwarmWorker: sub.isSwarmWorker,
        swarmMemberName: sub.swarmMemberName,
        model: sub.swarmModel || act.model,
        lastActivity: act.lastActivity,
        stepCount: act.stepCount,
        currentAction: state === 'killed' ? 'Retired' : act.currentAction,
      });
      walkSubs(sub.conversationId, depth + 1);
    }
  };
  walkSubs(nativeSessionId, 0);

  // Compact swarm summary (reusing readAgySwarmState).
  const coordId = findAgySwarmCoordinator(nativeSessionId);
  let swarm: AgySwarmSummary | null = null;
  if (coordId) {
    const sw = readAgySwarmState(coordId, {
      isActive,
      coordinatorTurnInProgress: options.coordinatorTurnInProgress,
    });
    if (sw.hasSwarm) {
      const workers = sw.members.filter(m => m.name !== 'coordinator');
      const lastPost = sw.posts.length ? sw.posts[sw.posts.length - 1] : null;
      swarm = {
        active: isActive,
        coordinatorId: sw.coordinatorId,
        coordinatorNativeId: sw.coordinatorNativeId,
        title: sw.title,
        memberCount: sw.members.length,
        workingCount: sw.members.filter(m => m.state === 'working').length,
        waitingCount: workers.filter(m => m.state === 'waiting').length,
        killedCount: workers.filter(m => m.state === 'killed').length,
        postCount: sw.head,
        lastPostAt: lastPost?.time ?? null,
      };
    }
  }

  // Merge ACP plan entries (preferred when live) with swarm plan.json tasks as fallback.
  const plan: AgyPlanItem[] = (options.livePlan ?? []).map(p => ({ ...p }));
  if (!plan.length && coordId) {
    const swarmPlan = readJsonFile(path.join(agyBrainDir(coordId)!, '.system_generated', 'swarm', 'plan.json'), 128 * 1024);
    const taskMap = isRecord(swarmPlan?.tasks) ? swarmPlan!.tasks : null;
    if (taskMap) {
      const sw = readAgySwarmState(coordId, { isActive });
      const byName = new Map(sw.members.map(m => [m.name, m]));
      for (const [memberName, desc] of Object.entries(taskMap)) {
        if (typeof desc !== 'string' || !desc.trim()) continue;
        const m = byName.get(memberName);
        const status: AgyPlanItem['status'] = m?.state === 'working' ? 'in_progress'
          : m?.state === 'killed' ? 'completed' : 'pending';
        plan.push({ content: `@${memberName}: ${desc.trim()}`, status });
      }
    }
  }

  return {
    supported: true,
    sessionId,
    nativeSessionId,
    isActive,
    canControl,
    plan,
    tasks,
    subagents,
    swarm,
  };
}

// ---- Brain artifacts (top-level .md / .html / images + optional metadata) ---

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

const ARTIFACT_EXT_KIND: Readonly<Record<string, AgyBrainArtifact['kind']>> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.svg': 'image',
};

const SKIPPED_BRAIN_ENTRIES = new Set(['.system_generated', 'scratch', '.user_uploaded']);

function parseArtifactSidecar(filePath: string): AgyBrainArtifactMeta | null {
  const raw = readJsonFile(`${filePath}.metadata.json`, 256 * 1024);
  if (!raw) return null;
  const userFacing = raw.UserFacing !== undefined ? raw.UserFacing === true
    : raw.userFacing !== undefined ? raw.userFacing === true : true;
  const requestFeedback = raw.RequestFeedback === true || raw.requestFeedback === true;
  return {
    summary: text(raw.Summary) || text(raw.summary),
    userFacing,
    requestFeedback,
    artifactType: text(raw.ArtifactType) || text(raw.artifactType),
    updatedAt: text(raw.updatedAt) || text(raw.UpdatedAt) || null,
  };
}

/** Read optional `<file>.metadata.json` sidecar if `filePath` is a direct artifact inside this conversation's brain dir. */
export function readAgyBrainArtifactMeta(nativeSessionId: string, filePath: string): AgyBrainArtifactMeta | null {
  const dir = agyBrainDir(nativeSessionId);
  if (!dir) return null;
  const normDir = path.resolve(dir);
  const normFile = path.resolve(filePath);
  if (!normFile.startsWith(normDir + path.sep)) return null;
  const rel = normFile.slice(normDir.length + 1);
  if (!rel || rel.split(path.sep).includes('.system_generated')) return null;
  return parseArtifactSidecar(normFile);
}

/** List user-facing Antigravity brain artifacts (`.md`/`.html`/images) for one conversation. */
export function readAgyBrainArtifacts(nativeSessionId: string): AgyBrainArtifact[] {
  const dir = agyBrainDir(nativeSessionId);
  if (!dir) return [];
  let entries: fs.Dirent[];
  try {
    const dirStat = fs.lstatSync(dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return [];
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: AgyBrainArtifact[] = [];
  for (const entry of entries) {
    if (SKIPPED_BRAIN_ENTRIES.has(entry.name) || entry.name.startsWith('.')) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (entry.name.endsWith('.metadata.json')) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const kind = ARTIFACT_EXT_KIND[ext];
    if (!kind) continue;
    const absPath = path.join(dir, entry.name);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absPath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const meta = parseArtifactSidecar(absPath);
    if (meta && !meta.userFacing) continue;
    out.push({
      name: entry.name,
      path: absPath,
      kind,
      size: stat.size,
      updatedAt: meta?.updatedAt || stat.mtime.toISOString(),
      summary: meta?.summary || '',
      userFacing: meta ? meta.userFacing : true,
      requestFeedback: meta ? meta.requestFeedback : false,
      artifactType: meta?.artifactType || '',
    });
  }
  out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.name.localeCompare(b.name));
  return out;
}
