// Generated from src/core/agy-brain.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGY_BRAIN_PROFILE_ID = void 0;
exports.agyRouteId = agyRouteId;
exports.agyBrainRoot = agyBrainRoot;
exports.agyBrainDir = agyBrainDir;
exports.agyBrainTranscriptPath = agyBrainTranscriptPath;
exports.isAgyBrainTranscriptPath = isAgyBrainTranscriptPath;
exports.conversationIdFromBrainTranscript = conversationIdFromBrainTranscript;
exports.readSwarmMembersFile = readSwarmMembersFile;
exports.readSwarmBoardPosts = readSwarmBoardPosts;
exports.readAgySubagentDescriptors = readAgySubagentDescriptors;
exports.findAgySubagentParent = findAgySubagentParent;
exports.isAgySubagentLive = isAgySubagentLive;
exports.inspectAgyTranscriptActivity = inspectAgyTranscriptActivity;
exports.hasActiveAgyBrainWork = hasActiveAgyBrainWork;
exports.parseAgyBrainEntries = parseAgyBrainEntries;
exports.findLatestToolStepOutput = findLatestToolStepOutput;
exports.readRunningTaskLogTail = readRunningTaskLogTail;
exports.readAgyBrainCacheProbeEntries = readAgyBrainCacheProbeEntries;
exports.readLatestAgyBrainStepUsage = readLatestAgyBrainStepUsage;
exports.readAgyBackgroundTasks = readAgyBackgroundTasks;
exports.readAgyTaskLog = readAgyTaskLog;
exports.findAgySwarmCoordinator = findAgySwarmCoordinator;
exports.readAgySwarmState = readAgySwarmState;
exports.readAgySessionTasks = readAgySessionTasks;
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
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_url_1 = require("node:url");
const acp_transcript_1 = require("./acp-transcript");
const dish_store_1 = require("./dish-store");
const helper_values_1 = require("./helper-values");
const session_key_1 = require("./session-key");
const wire_protocol_1 = require("./wire-protocol");
/** Profile id for Antigravity brain `transcript.jsonl` files projected to Pi-v3 entries. */
exports.AGY_BRAIN_PROFILE_ID = 'agy-brain-v1';
/** Canonical `agy:<id>` route id for a validated native session id. */
function agyRouteId(nativeSessionId) {
    if (!(0, session_key_1.validSessionId)(nativeSessionId))
        throw new TypeError(`Invalid Antigravity session id: ${nativeSessionId}`);
    return (0, session_key_1.canonicalSessionId)((0, session_key_1.encodeSessionKey)('agy', nativeSessionId));
}
const MAX_SUBAGENTS_PER_PARENT = 128;
const MAX_TASK_LOG_BYTES = 256 * 1024;
const DEFAULT_TASK_LOG_BYTES = 64 * 1024;
const MAX_BOARD_POSTS = 2000;
const TAIL_BYTES = 128 * 1024;
const TASK_ID_RE = /^task-\d{1,12}$/;
/** Root containing `<conversationId>/.system_generated/`. Overridable for tests. */
function agyBrainRoot() {
    const override = process.env.PI_DISH_AGY_BRAIN_DIR;
    if (override && override.trim())
        return path.resolve(override.trim());
    return path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
}
function agyBrainDir(conversationId) {
    if (!(0, session_key_1.validSessionId)(conversationId))
        return null;
    return path.join(agyBrainRoot(), conversationId);
}
function agyBrainTranscriptPath(conversationId) {
    const dir = agyBrainDir(conversationId);
    return dir ? path.join(dir, '.system_generated', 'logs', 'transcript.jsonl') : null;
}
/** True when `file` is `<agyBrainRoot>/<id>/.system_generated/logs/transcript.jsonl`. */
function isAgyBrainTranscriptPath(file) {
    const root = agyBrainRoot();
    const rel = path.relative(root, path.resolve(file));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
        return false;
    const parts = rel.split(path.sep);
    return parts.length === 4 && (0, session_key_1.validSessionId)(parts[0])
        && parts[1] === '.system_generated' && parts[2] === 'logs' && parts[3] === 'transcript.jsonl';
}
function conversationIdFromBrainTranscript(file) {
    if (!isAgyBrainTranscriptPath(file))
        return null;
    const rel = path.relative(agyBrainRoot(), path.resolve(file));
    const id = rel.split(path.sep)[0];
    return (0, session_key_1.validSessionId)(id) ? id : null;
}
function readJsonFile(file, maxBytes = 2 * 1024 * 1024) {
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes)
            return null;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return (0, helper_values_1.record)(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function readRegularTail(file, maxBytes) {
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink())
            return null;
        const totalBytes = stat.size;
        const readSize = Math.min(totalBytes, maxBytes);
        const start = Math.max(0, totalBytes - readSize);
        const buf = Buffer.alloc(readSize);
        const fd = fs.openSync(file, 'r');
        try {
            fs.readSync(fd, buf, 0, readSize, start);
        }
        finally {
            fs.closeSync(fd);
        }
        return {
            content: buf.toString('utf8'),
            totalBytes,
            truncated: start > 0,
            updatedAt: stat.mtime.toISOString(),
        };
    }
    catch {
        return null;
    }
}
function fileUriToPath(uri) {
    if (!uri)
        return null;
    if (uri.startsWith('file://')) {
        try {
            return decodeURIComponent(new node_url_1.URL(uri).pathname);
        }
        catch {
            return null;
        }
    }
    return path.isAbsolute(uri) ? uri : null;
}
function parseJsonLines(content) {
    const out = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const parsed = JSON.parse(trimmed);
            if ((0, helper_values_1.record)(parsed))
                out.push(parsed);
        }
        catch { /* Skip torn or partial tail line. */ }
    }
    return out;
}
function readTranscriptTailSteps(file) {
    const tail = readRegularTail(file, TAIL_BYTES);
    if (!tail)
        return [];
    const textContent = tail.truncated ? tail.content.slice(tail.content.indexOf('\n') + 1) : tail.content;
    return parseJsonLines(textContent);
}
function readSwarmMembersFile(coordinatorId) {
    const dir = agyBrainDir(coordinatorId);
    if (!dir)
        return null;
    const raw = readJsonFile(path.join(dir, '.system_generated', 'swarm', 'members.json'));
    if (!raw)
        return null;
    const membersObj = (0, helper_values_1.record)(raw.members) ? raw.members : {};
    const members = [];
    for (const [name, value] of Object.entries(membersObj)) {
        if (!(0, helper_values_1.record)(value))
            continue;
        const convId = (0, helper_values_1.text)(value.conversation_id) || (0, helper_values_1.text)(value.conversationId);
        if (!(0, session_key_1.validSessionId)(convId))
            continue;
        const channels = Array.isArray(value.channels)
            ? value.channels.filter((c) => typeof c === 'string' && c.length > 0)
            : [];
        members.push({
            name,
            conversationId: convId,
            role: (0, helper_values_1.text)(value.role) || (name === 'coordinator' ? 'coordinator' : 'worker'),
            model: (0, helper_values_1.text)(value.applied_model) || (0, helper_values_1.text)(value.model) || (0, helper_values_1.text)(value.desired_model) || null,
            workspaceMode: (0, helper_values_1.text)(value.workspace_mode) || 'inherit',
            phase: (0, helper_values_1.text)(value.phase) || (0, helper_values_1.text)(value.desired_state) || '',
            wakeMode: (0, helper_values_1.text)(value.wake_mode) || 'mentions',
            waitSince: (0, helper_values_1.finite)(value.wait_since) ? value.wait_since : 0,
            lastReadSeq: (0, helper_values_1.finite)(value.last_read_seq) ? value.last_read_seq : 0,
            lastNudgedSeq: (0, helper_values_1.finite)(value.last_nudged_seq) ? value.last_nudged_seq : 0,
            killed: value.killed === true,
            channels,
        });
    }
    const channels = [];
    if ((0, helper_values_1.record)(raw.channels)) {
        for (const [chName, value] of Object.entries(raw.channels)) {
            if (!(0, helper_values_1.record)(value))
                continue;
            channels.push({
                name: chName,
                topic: (0, helper_values_1.text)(value.topic),
                archived: value.archived === true,
            });
        }
    }
    return { title: (0, helper_values_1.text)(raw.title), members, channels };
}
const MENTION_RE = /(?:^|[\s(])@([a-z0-9_#-][a-z0-9_-]*)/gi;
const TAG_RE = /\[(done|stall|blocked|review|error|quota)\]/gi;
function extractMentions(content) {
    const seen = new Set();
    for (const m of content.matchAll(MENTION_RE)) {
        const token = m[1].toLowerCase();
        if (token)
            seen.add(token);
    }
    return [...seen];
}
function extractTags(content) {
    const seen = new Set();
    for (const m of content.matchAll(TAG_RE)) {
        seen.add(m[1].toLowerCase());
    }
    return [...seen];
}
function readSwarmBoardPosts(coordinatorId, since = 0) {
    const dir = agyBrainDir(coordinatorId);
    if (!dir)
        return { posts: [], head: 0 };
    const boardPath = path.join(dir, '.system_generated', 'swarm', 'board.jsonl');
    let raw = '';
    try {
        const stat = fs.lstatSync(boardPath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
            return { posts: [], head: 0 };
        raw = fs.readFileSync(boardPath, 'utf8');
    }
    catch {
        return { posts: [], head: 0 };
    }
    const rows = parseJsonLines(raw);
    let head = 0;
    const posts = [];
    for (const row of rows) {
        const seq = (0, helper_values_1.finite)(row.seq) ? row.seq : 0;
        if (seq > head)
            head = seq;
        if (seq <= since)
            continue;
        const body = (0, helper_values_1.text)(row.text);
        posts.push({
            seq,
            agent: (0, helper_values_1.text)(row.agent) || 'unknown',
            text: body,
            time: (0, helper_values_1.text)(row.time),
            kind: (0, helper_values_1.text)(row.kind) || null,
            channel: (0, helper_values_1.text)(row.channel) || 'main',
            mentions: extractMentions(body),
            tags: extractTags(body),
        });
    }
    const bounded = posts.length > MAX_BOARD_POSTS ? posts.slice(posts.length - MAX_BOARD_POSTS) : posts;
    return { posts: bounded, head };
}
const SWARM_ROLE_RE = /^Swarm Worker \(([^)]+)\)$/;
function readAgySubagentDescriptors(parentNativeId) {
    const parentDir = agyBrainDir(parentNativeId);
    if (!parentDir)
        return [];
    const subDir = path.join(parentDir, '.system_generated', 'subagents');
    let entries;
    try {
        const stat = fs.lstatSync(subDir);
        if (!stat.isDirectory() || stat.isSymbolicLink())
            return [];
        entries = fs.readdirSync(subDir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const swarm = readSwarmMembersFile(parentNativeId);
    const swarmByConv = new Map();
    for (const member of swarm?.members ?? []) {
        if (member.conversationId !== parentNativeId)
            swarmByConv.set(member.conversationId, member);
    }
    const out = [];
    for (const entry of entries) {
        if (out.length >= MAX_SUBAGENTS_PER_PARENT)
            break;
        if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json'))
            continue;
        const raw = readJsonFile(path.join(subDir, entry.name));
        if (!raw)
            continue;
        const conversationId = (0, helper_values_1.text)(raw.conversationId);
        if (!(0, session_key_1.validSessionId)(conversationId) || conversationId === parentNativeId)
            continue;
        const transcriptFile = agyBrainTranscriptPath(conversationId);
        if (!transcriptFile)
            continue;
        const desc = (0, wire_protocol_1.asRecord)(raw.subagentDescriptor);
        const typeName = (0, helper_values_1.text)(desc.typeName) || 'subagent';
        const role = (0, helper_values_1.text)(desc.role);
        const swarmMember = swarmByConv.get(conversationId) ?? null;
        const roleMatch = SWARM_ROLE_RE.exec(role);
        const swarmMemberName = swarmMember?.name ?? (roleMatch ? roleMatch[1] : null);
        const isSwarmWorker = !!swarmMember || (typeName === 'worker' && !!roleMatch);
        const label = swarmMemberName ? `@${swarmMemberName}` : (role || `${typeName}:${conversationId.slice(0, 8)}`);
        const workspaceUris = Array.isArray(raw.workspaceUris)
            ? raw.workspaceUris.filter((u) => typeof u === 'string' && u.length > 0)
            : [];
        const cwd = workspaceUris.length ? fileUriToPath(workspaceUris[0]) : null;
        out.push({
            conversationId,
            parentId: parentNativeId,
            typeName,
            role: role || typeName,
            label,
            rawState: (0, helper_values_1.text)(raw.state) || 'SUBAGENT_STATE_ALIVE',
            spawnStepIndex: (0, helper_values_1.finite)(raw.spawnStepIndex) ? raw.spawnStepIndex : null,
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
const parentLookupCache = new Map();
const PARENT_CACHE_TTL_MS = 5000;
function findAgySubagentParent(childNativeId) {
    if (!(0, session_key_1.validSessionId)(childNativeId))
        return null;
    const cached = parentLookupCache.get(childNativeId);
    if (cached && Date.now() - cached.checkedAt < PARENT_CACHE_TTL_MS)
        return cached.descriptor;
    const root = agyBrainRoot();
    let dirs;
    try {
        dirs = fs.readdirSync(root, { withFileTypes: true });
    }
    catch {
        return null;
    }
    const targetFile = `${childNativeId}.json`;
    for (const ent of dirs) {
        if (!ent.isDirectory() || ent.isSymbolicLink() || !(0, session_key_1.validSessionId)(ent.name) || ent.name === childNativeId)
            continue;
        const candidatePath = path.join(root, ent.name, '.system_generated', 'subagents', targetFile);
        try {
            if (!fs.lstatSync(candidatePath).isFile())
                continue;
        }
        catch {
            continue;
        }
        const found = readAgySubagentDescriptors(ent.name).find(d => d.conversationId === childNativeId) ?? null;
        if (parentLookupCache.size > 512)
            parentLookupCache.clear();
        parentLookupCache.set(childNativeId, { checkedAt: Date.now(), descriptor: found });
        return found;
    }
    if (parentLookupCache.size > 512)
        parentLookupCache.clear();
    parentLookupCache.set(childNativeId, { checkedAt: Date.now(), descriptor: null });
    return null;
}
/**
 * True when a subagent is still loaded under a live parent. Killed, errored,
 * or explicitly finished subagents return false.
 */
function isAgySubagentLive(parentNativeId, childNativeId) {
    const desc = readAgySubagentDescriptors(parentNativeId).find(d => d.conversationId === childNativeId);
    if (!desc)
        return false;
    if (desc.swarmKilled)
        return false;
    if (/KILLED|ERROR|FAILED|STOPPED|DEAD/i.test(desc.rawState))
        return false;
    return true;
}
// ---- Transcript activity & step inspection ----------------------------------
function parseStepToolArgs(rawArgs) {
    if (!(0, helper_values_1.record)(rawArgs))
        return {};
    const out = {};
    for (const [key, value] of Object.entries(rawArgs)) {
        if (typeof value === 'string') {
            try {
                out[key] = JSON.parse(value);
            }
            catch {
                out[key] = value;
            }
        }
        else {
            out[key] = value;
        }
    }
    return out;
}
function summarizeStepTool(name, rawArgs) {
    const args = parseStepToolArgs(rawArgs);
    const norm = (0, acp_transcript_1.normalizeAcpTool)({ name, args });
    if (norm.toolName === 'bash') {
        const cmd = (0, helper_values_1.text)(norm.args.command).split('\n')[0].trim();
        return cmd ? `Running ${cmd.slice(0, 60)}` : 'Running command';
    }
    if (norm.toolName === 'read' || norm.toolName === 'edit' || norm.toolName === 'write') {
        const filePath = (0, helper_values_1.text)(norm.args.path);
        return `${norm.toolName} ${filePath ? path.basename(filePath) : 'file'}`;
    }
    if (name === 'swarm')
        return `swarm ${(0, helper_values_1.text)(args.action)}`;
    if (name === 'post_message')
        return 'Posting to board';
    if (name === 'read_board')
        return 'Reading board';
    if (name === 'swarm_wait')
        return 'Waiting on board';
    if (name === 'search_web')
        return `Searching: ${(0, helper_values_1.text)(args.query).slice(0, 50)}`;
    if (name === 'invoke_subagent')
        return `Spawning ${(0, helper_values_1.text)(args.Role) || (0, helper_values_1.text)(args.TypeName) || 'subagent'}`;
    return `Running ${name}`;
}
/**
 * Fast tail inspection of a brain `transcript.jsonl` to decide whether the
 * subagent/worker is actively executing a turn vs parked/done.
 */
function inspectAgyTranscriptActivity(conversationId) {
    const file = agyBrainTranscriptPath(conversationId);
    if (!file)
        return { working: false, parkedOnBoard: false, lastActivity: null, stepCount: 0, model: null, currentAction: null };
    let stat;
    try {
        stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            return { working: false, parkedOnBoard: false, lastActivity: null, stepCount: 0, model: null, currentAction: null };
        }
    }
    catch {
        return { working: false, parkedOnBoard: false, lastActivity: null, stepCount: 0, model: null, currentAction: null };
    }
    const steps = readTranscriptTailSteps(file);
    if (!steps.length) {
        return { working: false, parkedOnBoard: false, lastActivity: stat.mtime.toISOString(), stepCount: 0, model: null, currentAction: null };
    }
    let model = null;
    let lastStepIndex = 0;
    let lastPlannerCalls = [];
    let genericsAfterPlanner = 0;
    let lastPlannerHadTextOnly = false;
    let parkedOnBoard = false;
    for (const step of steps) {
        const idx = (0, helper_values_1.finite)(step.step_index) ? step.step_index : 0;
        if (idx >= lastStepIndex)
            lastStepIndex = idx;
        if (typeof step.model === 'string' && step.model)
            model = step.model;
        const type = (0, helper_values_1.text)(step.type);
        if (type === 'PLANNER_RESPONSE') {
            const calls = Array.isArray(step.tool_calls)
                ? step.tool_calls.flatMap(c => (0, helper_values_1.record)(c) && typeof c.name === 'string' ? [{ name: c.name, args: c.args }] : [])
                : [];
            lastPlannerCalls = calls;
            genericsAfterPlanner = 0;
            lastPlannerHadTextOnly = calls.length === 0;
            parkedOnBoard = false;
        }
        else if (type === 'GENERIC') {
            genericsAfterPlanner++;
            const matchedCall = lastPlannerCalls[genericsAfterPlanner - 1];
            if (matchedCall?.name === 'swarm_wait' && (0, helper_values_1.text)(step.status) !== 'ERROR' && (0, helper_values_1.text)(step.status) !== 'FAILED') {
                parkedOnBoard = true;
            }
        }
        else if (type === 'USER_INPUT' || type === 'SYSTEM_MESSAGE') {
            lastPlannerCalls = [];
            genericsAfterPlanner = 0;
            lastPlannerHadTextOnly = false;
            parkedOnBoard = false;
        }
    }
    const last = steps[steps.length - 1];
    const lastType = (0, helper_values_1.text)(last.type);
    const lastStatus = (0, helper_values_1.text)(last.status);
    const lastActivity = (0, helper_values_1.text)(last.created_at) || stat.mtime.toISOString();
    // If the last step is still RUNNING, or is a fresh USER_INPUT/SYSTEM_MESSAGE
    // awaiting model response, or a PLANNER_RESPONSE with unfinished tool calls: working!
    // Exception: blocking on `swarm_wait` means the worker is parked waiting on the board.
    const unfinishedTools = lastPlannerCalls.length > 0 && genericsAfterPlanner < lastPlannerCalls.length;
    const activeCall = unfinishedTools ? (lastPlannerCalls[genericsAfterPlanner] ?? lastPlannerCalls[lastPlannerCalls.length - 1]) : null;
    if (activeCall?.name === 'swarm_wait')
        parkedOnBoard = true;
    const freshMessage = (lastType === 'USER_INPUT' || lastType === 'SYSTEM_MESSAGE') && lastStatus === 'DONE';
    const runningStep = lastStatus === 'RUNNING' || lastStatus === 'PENDING' || lastStatus === 'IN_PROGRESS';
    const waitingForNextPlanner = lastPlannerCalls.length > 0 && genericsAfterPlanner >= lastPlannerCalls.length && !parkedOnBoard;
    // Guard against stale/crashed turns from long-dead conversations: callers also check parent liveness.
    const working = !parkedOnBoard && !lastPlannerHadTextOnly && (runningStep || unfinishedTools || freshMessage || waitingForNextPlanner);
    let currentAction = null;
    if (parkedOnBoard) {
        currentAction = 'Waiting on board';
    }
    else if (unfinishedTools) {
        currentAction = activeCall ? summarizeStepTool(activeCall.name, activeCall.args) : 'Running tool';
    }
    else if (runningStep && lastType === 'GENERIC') {
        currentAction = 'Running background task';
    }
    else if (working) {
        currentAction = 'Thinking…';
    }
    else if (lastType === 'PLANNER_RESPONSE' && (0, helper_values_1.text)(last.content)) {
        currentAction = (0, helper_values_1.text)(last.content).replace(/\s+/g, ' ').trim().slice(0, 100);
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
function hasActiveAgyBrainWork(nativeSessionId) {
    const subs = readAgySubagentDescriptors(nativeSessionId);
    for (const sub of subs) {
        if (sub.swarmKilled || /KILLED|ERROR|FAILED|STOPPED|DEAD/i.test(sub.rawState))
            continue;
        const act = inspectAgyTranscriptActivity(sub.conversationId);
        if (act.working)
            return true;
    }
    const tasks = readAgyBackgroundTasks(nativeSessionId, true);
    return tasks.some(task => task.status === 'running' && !task.isDaemon);
}
// ---- Brain transcript.jsonl → Pi-v3 SessionEntries --------------------------
function stripUserRequestWrapper(raw) {
    const m = /<USER_REQUEST>\s*\n?([\s\S]*?)\n?\s*<\/USER_REQUEST>/.exec(raw);
    return (m ? m[1] : raw).trim();
}
function stripToolTimestamps(raw) {
    // agy prepends 1–2 pairs of "Created At: ...\nCompleted At: ...\n" to GENERIC outputs.
    return raw.replace(/^(?:Created At: [^\n]*\n(?:Completed At: [^\n]*\n)?)+/, '').trim();
}
function parseSystemMessage(raw) {
    const innerMatch = /<SYSTEM_MESSAGE>\s*\n?([\s\S]*?)\n?\s*<\/SYSTEM_MESSAGE>/.exec(raw);
    const inner = (innerMatch ? innerMatch[1] : raw).trim();
    const isNoisySwarmWake = (body) => /^\[swarm\] new board message #\d+\b/i.test(body);
    const msgMatch = /^\[Message\]\s+timestamp=\S+\s+sender=(\S+)\s+priority=\S+\s+content=([\s\S]*)$/.exec(inner);
    if (!msgMatch) {
        if (!inner)
            return null;
        return { sender: 'system', content: inner, noisy: isNoisySwarmWake(inner) };
    }
    const sender = msgMatch[1];
    const content = msgMatch[2].trim();
    return { sender, content, noisy: isNoisySwarmWake(content) };
}
function defaultParentMirrorFor(parentId) {
    return path.join((0, dish_store_1.dishDir)(), 'agy', 'sessions', `${parentId}.jsonl`);
}
/**
 * Convert an Antigravity brain `transcript.jsonl` into standard Pi-v3
 * `SessionEntries` so `session-files.ts`, `session-index.ts`, `Subagents`,
 * and `Swarm` trace peeking all consume it without a separate message model.
 */
function parseAgyBrainEntries(content, file, hint) {
    const convId = hint?.conversationId || conversationIdFromBrainTranscript(file) || path.basename(path.dirname(file));
    const parentDesc = (!hint || hint.parentSession === undefined || hint.name === undefined)
        ? findAgySubagentParent(convId)
        : null;
    const parentSession = hint?.parentSession !== undefined
        ? hint.parentSession
        : parentDesc ? defaultParentMirrorFor(parentDesc.parentId) : null;
    const cwd = hint?.cwd ?? parentDesc?.cwd ?? null;
    const displayName = hint?.name ?? parentDesc?.label ?? null;
    const steps = parseJsonLines(content);
    const firstTs = steps.length && (0, helper_values_1.text)(steps[0].created_at) ? (0, helper_values_1.text)(steps[0].created_at) : new Date().toISOString();
    const entries = [];
    entries.firstEntryOnFirstLine = true;
    let parentEntryId = null;
    let seq = 0;
    const push = (type, fields, timestamp) => {
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
    let currentModel = null;
    const pendingCalls = [];
    for (const step of steps) {
        const stepIndex = (0, helper_values_1.finite)(step.step_index) ? step.step_index : seq;
        const timestamp = (0, helper_values_1.text)(step.created_at) || firstTs;
        const ms = Date.parse(timestamp);
        const msgTimestamp = Number.isFinite(ms) ? ms : Date.now();
        const type = (0, helper_values_1.text)(step.type);
        if (type === 'USER_INPUT') {
            const body = stripUserRequestWrapper((0, helper_values_1.text)(step.content));
            if (!body)
                continue;
            push('message', {
                message: { role: 'user', content: [{ type: 'text', text: body }], timestamp: msgTimestamp },
            }, timestamp);
            continue;
        }
        if (type === 'SYSTEM_MESSAGE') {
            const parsed = parseSystemMessage((0, helper_values_1.text)(step.content));
            if (!parsed || parsed.noisy || !parsed.content)
                continue;
            // The first assignment message to a subagent/worker reads best as the opening user prompt.
            if (stepIndex <= 1) {
                push('message', {
                    message: { role: 'user', content: [{ type: 'text', text: parsed.content }], timestamp: msgTimestamp },
                }, timestamp);
            }
            else {
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
            const model = (0, helper_values_1.text)(step.model) || currentModel;
            if (model && model !== currentModel) {
                currentModel = model;
                push('model_change', { modelId: model, provider: acp_transcript_1.AGY_PROVIDER }, timestamp);
            }
            const blocks = [];
            const thinking = (0, helper_values_1.text)(step.thinking);
            if (thinking)
                blocks.push({ type: 'thinking', thinking });
            const body = (0, helper_values_1.text)(step.content);
            if (body)
                blocks.push({ type: 'text', text: body });
            const rawCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
            for (let i = 0; i < rawCalls.length; i++) {
                const rawCall = rawCalls[i];
                if (!(0, helper_values_1.record)(rawCall) || typeof rawCall.name !== 'string' || !rawCall.name)
                    continue;
                const parsedArgs = parseStepToolArgs(rawCall.args);
                const norm = (0, acp_transcript_1.normalizeAcpTool)({ name: rawCall.name, args: parsedArgs });
                const callId = `step-${stepIndex}-call-${i}`;
                blocks.push({ type: 'toolCall', id: callId, name: norm.toolName, arguments: norm.args });
                pendingCalls.push({ id: callId, toolName: norm.toolName, nativeName: norm.nativeName });
            }
            if (!blocks.length)
                continue;
            const input = (0, helper_values_1.finite)(step.input_tokens) ? step.input_tokens : 0;
            const cacheRead = (0, helper_values_1.finite)(step.cache_read_tokens) ? step.cache_read_tokens : 0;
            const output = (0, helper_values_1.finite)(step.output_tokens) ? step.output_tokens : 0;
            const totalTokens = input + cacheRead + output;
            const usage = totalTokens > 0 ? { input, cacheRead, output, totalTokens } : undefined;
            push('message', {
                message: {
                    role: 'assistant',
                    content: blocks,
                    timestamp: msgTimestamp,
                    api: 'acp',
                    provider: acp_transcript_1.AGY_PROVIDER,
                    ...(model ? { model } : {}),
                    stopReason: rawCalls.length ? 'toolUse' : 'stop',
                    ...(usage ? { usage } : {}),
                },
            }, timestamp);
            continue;
        }
        if (type === 'GENERIC') {
            const call = pendingCalls.shift();
            if (!call)
                continue;
            const body = stripToolTimestamps((0, helper_values_1.text)(step.content));
            const isError = (0, helper_values_1.text)(step.status) === 'ERROR' || (0, helper_values_1.text)(step.status) === 'FAILED';
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
function findLatestToolStepOutput(nativeSessionId, nativeToolName) {
    if (!ENRICHABLE_TOOLS.has(nativeToolName))
        return null;
    const file = agyBrainTranscriptPath(nativeSessionId);
    if (!file)
        return null;
    const steps = readTranscriptTailSteps(file);
    if (!steps.length)
        return null;
    // Walk from the tail to find the most recent PLANNER_RESPONSE containing `nativeToolName`
    // and pair its matching GENERIC output step by ordinal offset.
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        if ((0, helper_values_1.text)(step.type) !== 'PLANNER_RESPONSE')
            continue;
        const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
        const matchIndex = calls.map(c => (0, helper_values_1.record)(c) ? (0, helper_values_1.text)(c.name) : '').lastIndexOf(nativeToolName);
        if (matchIndex < 0)
            continue;
        let seenGenerics = 0;
        for (let j = i + 1; j < steps.length; j++) {
            const next = steps[j];
            if ((0, helper_values_1.text)(next.type) === 'PLANNER_RESPONSE')
                break;
            if ((0, helper_values_1.text)(next.type) !== 'GENERIC')
                continue;
            if (seenGenerics === matchIndex) {
                const stepIdx = (0, helper_values_1.finite)(next.step_index) ? next.step_index : null;
                // Prefer the untruncated step output file when it exists and is bounded.
                if (stepIdx !== null) {
                    const outFile = path.join(agyBrainDir(nativeSessionId), '.system_generated', 'steps', String(stepIdx), 'output.txt');
                    const tail = readRegularTail(outFile, 16 * 1024);
                    if (tail && tail.content.trim())
                        return stripToolTimestamps(tail.content);
                }
                const cleaned = stripToolTimestamps((0, helper_values_1.text)(next.content));
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
function readRunningTaskLogTail(nativeSessionId, commandHint) {
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
        .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0];
    if (!freshOrphan)
        return null;
    const log = readAgyTaskLog(nativeSessionId, freshOrphan.id, 8192);
    return log?.content.trim() ? log.content : null;
}
/**
 * Per-step LLM cache probes from Antigravity's brain `transcript.jsonl`.
 * Mirrors only carry cumulative per-turn `PromptResponse.usage` (where a
 * multi-step turn's warm step 2 masks a cold step 1); brain steps report
 * exact per-call `input_tokens` and `cache_read_tokens` for the learner.
 */
function readAgyBrainCacheProbeEntries(nativeSessionId) {
    const file = agyBrainTranscriptPath(nativeSessionId);
    if (!file)
        return null;
    let content;
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 32 * 1024 * 1024)
            return null;
        content = fs.readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
    const steps = parseJsonLines(content);
    const entries = [];
    let currentModel = null;
    for (const step of steps) {
        if ((0, helper_values_1.text)(step.type) !== 'PLANNER_RESPONSE')
            continue;
        const model = (0, helper_values_1.text)(step.model) || currentModel;
        if (model)
            currentModel = model;
        if (!model)
            continue;
        const createdAt = (0, helper_values_1.text)(step.created_at);
        const ts = createdAt ? Date.parse(createdAt) : NaN;
        if (!Number.isFinite(ts))
            continue;
        const input = (0, helper_values_1.finite)(step.input_tokens) && step.input_tokens > 0 ? step.input_tokens : 0;
        const cacheRead = (0, helper_values_1.finite)(step.cache_read_tokens) && step.cache_read_tokens > 0 ? step.cache_read_tokens : 0;
        if (input + cacheRead <= 0)
            continue;
        entries.push({
            type: 'message',
            timestamp: createdAt,
            message: {
                role: 'assistant',
                api: 'acp',
                provider: acp_transcript_1.AGY_PROVIDER,
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
function readLatestAgyBrainStepUsage(nativeSessionId, minTimestampMs) {
    const file = agyBrainTranscriptPath(nativeSessionId);
    if (!file)
        return null;
    const steps = readTranscriptTailSteps(file);
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        if ((0, helper_values_1.text)(step.type) !== 'PLANNER_RESPONSE')
            continue;
        const createdAt = (0, helper_values_1.text)(step.created_at);
        const ts = createdAt ? Date.parse(createdAt) : NaN;
        if (minTimestampMs !== undefined && Number.isFinite(ts) && ts < minTimestampMs)
            return null;
        const input = (0, helper_values_1.finite)(step.input_tokens) && step.input_tokens >= 0 ? step.input_tokens : 0;
        const cacheRead = (0, helper_values_1.finite)(step.cache_read_tokens) && step.cache_read_tokens >= 0 ? step.cache_read_tokens : 0;
        const output = (0, helper_values_1.finite)(step.output_tokens) && step.output_tokens >= 0 ? step.output_tokens : 0;
        const totalTokens = input + cacheRead + output;
        if (totalTokens <= 0)
            return null;
        return { input, output, cacheRead, cacheWrite: 0, totalTokens };
    }
    return null;
}
const BG_TASK_ID_RE = /task id:\s*((?:[a-zA-Z0-9_-]+\/)?(task-\d+))/i;
const BG_TASK_DESC_RE = /Task Description:\s*([^\n]+)/i;
const EXIT_CODE_RE = /Command exited with code (-?\d+)/;
function readTaskCompletionMessages(nativeSessionId) {
    const dir = agyBrainDir(nativeSessionId);
    const out = new Map();
    if (!dir)
        return out;
    const msgDir = path.join(dir, '.system_generated', 'messages');
    let entries;
    try {
        if (!fs.lstatSync(msgDir).isDirectory())
            return out;
        entries = fs.readdirSync(msgDir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const entry of entries) {
        if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json') || entry.name === 'read.json')
            continue;
        const raw = readJsonFile(path.join(msgDir, entry.name));
        if (!raw)
            continue;
        const sender = (0, helper_values_1.text)(raw.sender);
        const slash = sender.lastIndexOf('/');
        const shortSender = slash >= 0 ? sender.slice(slash + 1) : sender;
        if (!TASK_ID_RE.test(shortSender))
            continue;
        const content = (0, helper_values_1.text)(raw.content);
        const exitMatch = EXIT_CODE_RE.exec(content);
        const exitCode = exitMatch ? Number(exitMatch[1]) : null;
        const failed = (exitCode !== null && exitCode !== 0) || /failed|error/i.test((0, helper_values_1.text)((0, wire_protocol_1.asRecord)(raw.renderDetails).messageTitle));
        out.set(shortSender, {
            finishedAt: (0, helper_values_1.text)(raw.timestamp) || null,
            content,
            exitCode,
            failed,
        });
    }
    return out;
}
function readAgyBackgroundTasks(nativeSessionId, parentLive) {
    const dir = agyBrainDir(nativeSessionId);
    if (!dir)
        return [];
    const tasksDir = path.join(dir, '.system_generated', 'tasks');
    const logStats = new Map();
    try {
        if (fs.lstatSync(tasksDir).isDirectory()) {
            for (const entry of fs.readdirSync(tasksDir, { withFileTypes: true })) {
                if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.log'))
                    continue;
                const id = entry.name.slice(0, -4);
                if (!TASK_ID_RE.test(id))
                    continue;
                try {
                    const st = fs.statSync(path.join(tasksDir, entry.name));
                    logStats.set(id, { size: st.size, mtime: st.mtime.toISOString() });
                }
                catch { }
            }
        }
    }
    catch { }
    const completions = readTaskCompletionMessages(nativeSessionId);
    const killedIds = new Set();
    const tasksById = new Map();
    const transcriptFile = agyBrainTranscriptPath(nativeSessionId);
    let steps = [];
    if (transcriptFile) {
        try {
            const stat = fs.lstatSync(transcriptFile);
            if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024) {
                steps = parseJsonLines(fs.readFileSync(transcriptFile, 'utf8'));
            }
        }
        catch { }
    }
    // Pre-pass: gather completion SYSTEM_MESSAGEs and manage_task kill calls so
    // earlier GENERIC start steps know their final status immediately.
    for (const step of steps) {
        const type = (0, helper_values_1.text)(step.type);
        const createdAt = (0, helper_values_1.text)(step.created_at) || null;
        if (type === 'PLANNER_RESPONSE') {
            const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
            for (const c of calls) {
                if (!(0, helper_values_1.record)(c) || c.name !== 'manage_task')
                    continue;
                const args = parseStepToolArgs(c.args);
                if ((0, helper_values_1.text)(args.Action) === 'kill') {
                    const tid = (0, helper_values_1.text)(args.TaskId);
                    const shortId = tid.includes('/') ? tid.slice(tid.lastIndexOf('/') + 1) : tid;
                    if (shortId)
                        killedIds.add(shortId);
                }
            }
            continue;
        }
        if (type === 'SYSTEM_MESSAGE') {
            const content = (0, helper_values_1.text)(step.content);
            const idMatch = /sender=(?:[a-zA-Z0-9_-]+\/)?(task-\d+)/.exec(content)
                ?? /Task id "(?:[a-zA-Z0-9_-]+\/)?(task-\d+)" finished/i.exec(content);
            if (idMatch && !completions.has(idMatch[1])) {
                const exitMatch = EXIT_CODE_RE.exec(content);
                const exitCode = exitMatch ? Number(exitMatch[1]) : null;
                completions.set(idMatch[1], {
                    finishedAt: createdAt,
                    content,
                    exitCode,
                    failed: exitCode !== null && exitCode !== 0,
                });
            }
        }
    }
    const pendingCalls = [];
    for (const step of steps) {
        const type = (0, helper_values_1.text)(step.type);
        const createdAt = (0, helper_values_1.text)(step.created_at) || null;
        if (type === 'PLANNER_RESPONSE') {
            const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
            for (const c of calls) {
                if (!(0, helper_values_1.record)(c) || typeof c.name !== 'string')
                    continue;
                pendingCalls.push({ name: c.name, args: parseStepToolArgs(c.args), createdAt });
            }
            continue;
        }
        if (type !== 'GENERIC')
            continue;
        const call = pendingCalls.shift();
        if (!call)
            continue;
        const content = (0, helper_values_1.text)(step.content);
        const status = (0, helper_values_1.text)(step.status);
        if (call.name === 'run_command') {
            const idMatch = BG_TASK_ID_RE.exec(content);
            const stepIdx = (0, helper_values_1.finite)(step.step_index) ? step.step_index : null;
            const inferredId = idMatch ? idMatch[2] : (stepIdx !== null && logStats.has(`task-${stepIdx}`) ? `task-${stepIdx}` : null);
            if (!inferredId)
                continue;
            const fullTaskId = idMatch ? idMatch[1] : `${nativeSessionId}/${inferredId}`;
            const cmd = (0, helper_values_1.text)(call.args.CommandLine);
            const summary = (0, helper_values_1.text)(call.args.toolSummary);
            const descMatch = BG_TASK_DESC_RE.exec(content);
            const log = logStats.get(inferredId);
            const comp = completions.get(inferredId);
            const isDaemon = call.args.IsDaemon === true;
            const killed = killedIds.has(inferredId);
            // When run_command backgrounds itself, the GENERIC step returns DONE with
            // `background task with task id: ...`; the task itself stays running until
            // a completion message arrives, manage_task kills it, or the parent exits.
            const backgrounded = !!idMatch || status === 'RUNNING';
            const resolvedStatus = killed
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
                startedAt: call.createdAt ?? createdAt,
                finishedAt: comp?.finishedAt ?? (resolvedStatus !== 'running' ? (log?.mtime ?? null) : null),
                exitCode: comp?.exitCode ?? null,
                hasLog: !!log,
                ...(log ? { logBytes: log.size } : {}),
            });
            continue;
        }
        if (call.name === 'schedule') {
            const idMatch = BG_TASK_ID_RE.exec(content);
            const bareMatch = !idMatch ? /(task-\d+)/i.exec(content) : null;
            const stepIdx = (0, helper_values_1.finite)(step.step_index) ? step.step_index : null;
            const id = idMatch ? idMatch[2] : bareMatch ? bareMatch[1] : `schedule-${stepIdx ?? tasksById.size + 1}`;
            const fullTaskId = idMatch ? idMatch[1] : TASK_ID_RE.test(id) ? `${nativeSessionId}/${id}` : undefined;
            const cron = (0, helper_values_1.text)(call.args.CronExpression) || undefined;
            const durationSeconds = (0, helper_values_1.finite)(call.args.DurationSeconds) ? call.args.DurationSeconds : undefined;
            const prompt = (0, helper_values_1.text)(call.args.Prompt);
            const isDaemon = call.args.IsDaemon === true;
            const killed = killedIds.has(id);
            const comp = completions.get(id);
            const resolvedStatus = killed
                ? 'killed'
                : comp && !cron ? 'completed'
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
                startedAt: call.createdAt ?? createdAt,
                finishedAt: comp?.finishedAt ?? null,
                exitCode: null,
                hasLog: logStats.has(id),
                ...(logStats.has(id) ? { logBytes: logStats.get(id).size } : {}),
                preview: prompt || undefined,
            });
            continue;
        }
        if (call.name === 'run_workflow') {
            const idMatch = BG_TASK_ID_RE.exec(content);
            const bareMatch = !idMatch ? /(task-\d+)/i.exec(content) : null;
            const stepIdx = (0, helper_values_1.finite)(step.step_index) ? step.step_index : null;
            const id = idMatch ? idMatch[2] : bareMatch ? bareMatch[1] : `workflow-${stepIdx ?? tasksById.size + 1}`;
            const fullTaskId = idMatch ? idMatch[1] : TASK_ID_RE.test(id) ? `${nativeSessionId}/${id}` : undefined;
            const desc = (0, helper_values_1.text)(call.args.Description) || (0, helper_values_1.text)(call.args.ScriptPath) || 'Workflow';
            const comp = completions.get(id);
            const killed = killedIds.has(id);
            const backgrounded = !!(idMatch || bareMatch) || status === 'RUNNING';
            const resolvedStatus = killed
                ? 'killed'
                : comp ? (comp.failed ? 'failed' : 'completed')
                    : (backgrounded && parentLive) ? 'running' : (status === 'ERROR' ? 'failed' : 'completed');
            tasksById.set(id, {
                id,
                ...(fullTaskId ? { fullTaskId } : {}),
                kind: 'workflow',
                status: resolvedStatus,
                title: desc.slice(0, 100),
                startedAt: call.createdAt ?? createdAt,
                finishedAt: comp?.finishedAt ?? null,
                exitCode: comp?.exitCode ?? null,
                hasLog: logStats.has(id),
                ...(logStats.has(id) ? { logBytes: logStats.get(id).size } : {}),
            });
        }
    }
    // Apply late kills (manage_task kill appears after the task step).
    for (const id of killedIds) {
        const task = tasksById.get(id);
        if (task && (task.status === 'running' || task.status === 'scheduled'))
            task.status = 'killed';
    }
    // Surface any orphaned task-*.log files whose start step wasn't in the parsed transcript.
    for (const [id, stat] of logStats) {
        if (tasksById.has(id))
            continue;
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
    const rank = (s) => s === 'running' ? 0 : s === 'scheduled' ? 1 : 2;
    const numOf = (id) => { const m = /(\d+)$/.exec(id); return m ? Number(m[1]) : 0; };
    return [...tasksById.values()].sort((a, b) => rank(a.status) - rank(b.status) || numOf(b.id) - numOf(a.id));
}
function readAgyTaskLog(nativeSessionId, taskId, requestedBytes = DEFAULT_TASK_LOG_BYTES) {
    if (!TASK_ID_RE.test(taskId))
        return null;
    const dir = agyBrainDir(nativeSessionId);
    if (!dir)
        return null;
    const maxBytes = Math.max(1024, Math.min(MAX_TASK_LOG_BYTES, (0, helper_values_1.finite)(requestedBytes) ? requestedBytes : DEFAULT_TASK_LOG_BYTES));
    const file = path.join(dir, '.system_generated', 'tasks', `${taskId}.log`);
    const tail = readRegularTail(file, maxBytes);
    if (!tail)
        return null;
    return { taskId, ...tail };
}
/** Resolve which conversation owns the swarm for `nativeSessionId` (either itself or its parent). */
function findAgySwarmCoordinator(nativeSessionId) {
    const dir = agyBrainDir(nativeSessionId);
    if (!dir)
        return null;
    const swarmDir = path.join(dir, '.system_generated', 'swarm');
    if (fs.existsSync(path.join(swarmDir, 'members.json')) || fs.existsSync(path.join(swarmDir, 'swarm.json'))) {
        return nativeSessionId;
    }
    const parent = findAgySubagentParent(nativeSessionId);
    if (!parent)
        return null;
    const parentDir = agyBrainDir(parent.parentId);
    if (!parentDir)
        return null;
    const pSwarm = path.join(parentDir, '.system_generated', 'swarm');
    if (fs.existsSync(path.join(pSwarm, 'members.json')) || fs.existsSync(path.join(pSwarm, 'swarm.json'))) {
        return parent.parentId;
    }
    return null;
}
function memberState(raw, activity, coordinatorActive, coordinatorTurnInProgress, isCoordinator) {
    if (raw.killed)
        return 'killed';
    if (!coordinatorActive)
        return 'stopped';
    if (isCoordinator)
        return coordinatorTurnInProgress || activity.working ? 'working' : 'waiting';
    return activity.working ? 'working' : 'waiting';
}
function readAgySwarmState(nativeSessionId, options = {}) {
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
    const coordDir = agyBrainDir(coordNativeId);
    const swarmDir = path.join(coordDir, '.system_generated', 'swarm');
    const swarmMeta = readJsonFile(path.join(swarmDir, 'swarm.json'));
    const membersFile = readSwarmMembersFile(coordNativeId);
    const allBoard = readSwarmBoardPosts(coordNativeId, 0);
    const since = (0, helper_values_1.finite)(options.since) && options.since > 0 ? options.since : 0;
    const posts = since > 0 ? allBoard.posts.filter(p => p.seq > since) : allBoard.posts;
    const lastPostByAgent = new Map();
    const channelCounts = new Map();
    for (const post of allBoard.posts) {
        lastPostByAgent.set(post.agent, { seq: post.seq, time: post.time });
        channelCounts.set(post.channel, (channelCounts.get(post.channel) || 0) + 1);
    }
    const subDescs = new Map(readAgySubagentDescriptors(coordNativeId).map(d => [d.conversationId, d]));
    const coordActive = options.isActive === true;
    const coordTurn = options.coordinatorTurnInProgress === true;
    const members = (membersFile?.members ?? []).map((m) => {
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
    const stateRank = (m) => m.name === 'coordinator' ? 0 : m.state === 'working' ? 1 : m.state === 'waiting' ? 2 : m.state === 'stopped' ? 3 : 4;
    members.sort((a, b) => stateRank(a) - stateRank(b) || a.name.localeCompare(b.name));
    // Build channel list (always include `main` if posts exist).
    const channelMap = new Map();
    channelMap.set('main', { name: 'main', topic: 'Main board', archived: false, postCount: channelCounts.get('main') || 0 });
    for (const ch of membersFile?.channels ?? []) {
        channelMap.set(ch.name, { name: ch.name, topic: ch.topic, archived: ch.archived, postCount: channelCounts.get(ch.name) || 0 });
    }
    for (const [chName, count] of channelCounts) {
        if (!channelMap.has(chName))
            channelMap.set(chName, { name: chName, topic: '', archived: false, postCount: count });
    }
    const plan = readJsonFile(path.join(swarmDir, 'plan.json'), 128 * 1024);
    let narratorView = null;
    const narrator = members.find(m => /^narrator(?:-\d+)?$/.test(m.name));
    if (narrator) {
        const narDir = agyBrainDir(narrator.conversationId);
        if (narDir)
            narratorView = readJsonFile(path.join(narDir, 'swarm_view', 'view.json'), 128 * 1024);
    }
    return {
        supported: true,
        hasSwarm: true,
        sessionId: sessionRouteId,
        coordinatorId: agyRouteId(coordNativeId),
        coordinatorNativeId: coordNativeId,
        title: membersFile?.title || 'Swarm',
        createdAt: (0, helper_values_1.text)(swarmMeta?.created_at) || null,
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
function readAgySessionTasks(nativeSessionId, options = {}) {
    const sessionId = agyRouteId(nativeSessionId);
    const isActive = options.isActive === true;
    const canControl = options.canControl ?? isActive;
    const tasks = readAgyBackgroundTasks(nativeSessionId, isActive);
    // Surface any live in-flight non-daemon tool calls (e.g. a running bash command
    // that hasn't hit WaitMsBeforeAsync yet, or an in-flight workflow).
    const existingRunningShells = new Set(tasks.filter(t => t.kind === 'shell' && t.status === 'running' && t.command).map(t => t.command.trim()));
    for (const live of options.liveRunningTools ?? []) {
        const args = (0, helper_values_1.record)(live.args) ? live.args : {};
        if (live.toolName === 'bash') {
            const cmd = (0, helper_values_1.text)(args.command).trim();
            if (cmd && existingRunningShells.has(cmd))
                continue;
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
    const subagents = [];
    const seen = new Set([nativeSessionId]);
    const walkSubs = (parentId, depth) => {
        if (depth > 4 || subagents.length >= MAX_SUBAGENTS_PER_PARENT)
            return;
        for (const sub of readAgySubagentDescriptors(parentId)) {
            if (seen.has(sub.conversationId))
                continue;
            seen.add(sub.conversationId);
            const act = inspectAgyTranscriptActivity(sub.conversationId);
            const state = sub.swarmKilled || /KILLED/i.test(sub.rawState)
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
    let swarm = null;
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
    const plan = (options.livePlan ?? []).map(p => ({ ...p }));
    if (!plan.length && coordId) {
        const swarmPlan = readJsonFile(path.join(agyBrainDir(coordId), '.system_generated', 'swarm', 'plan.json'), 128 * 1024);
        const taskMap = (0, helper_values_1.record)(swarmPlan?.tasks) ? swarmPlan.tasks : null;
        if (taskMap) {
            const sw = readAgySwarmState(coordId, { isActive });
            const byName = new Map(sw.members.map(m => [m.name, m]));
            for (const [memberName, desc] of Object.entries(taskMap)) {
                if (typeof desc !== 'string' || !desc.trim())
                    continue;
                const m = byName.get(memberName);
                const status = m?.state === 'working' ? 'in_progress'
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
