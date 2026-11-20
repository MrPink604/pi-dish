import { errorMessage, responseError, sameEndpoint, sendJson, type ApiRequest, type HostEndpoint } from './api-client';
import { requiredElement } from './dom';
import type { SelectionOwner, SessionState } from './session-state';
import { formatRelativeTime } from './helper-format';
import {
  EMPTY_TASKS,
  decodeSessionTasks,
  decodeTaskLog,
  type BackgroundTaskItem,
  type SessionTasksPayload,
  type TaskLogPayload,
} from './agy-views-data';

const DEFAULT_LOG_TAIL = 65_536;
const MAX_LOG_TAIL = 262_144;

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createTasksView(options: {
  root: HTMLElement;
  request: ApiRequest;
  sessionState: SessionState;
  endpoint: (host: string | null) => HostEndpoint | null;
  closeOtherViews: () => void;
  openSubagent: (owner: SelectionOwner, endpoint: HostEndpoint, subagentId?: string) => void;
  openSwarm: (owner: SelectionOwner, endpoint: HostEndpoint, focusMember?: string) => void;
  status: (message: string, kind?: string) => void;
  copy: (text: string) => Promise<void>;
  confirm: (message: string) => boolean;
}) {
  const document = options.root.ownerDocument;
  const sessionState = options.sessionState;
  const element = requiredElement(document, 'tasks view');

  let disposed = false;
  let viewOwner: SelectionOwner | null = null;
  let viewEndpoint: HostEndpoint | null = null;
  let data: SessionTasksPayload = EMPTY_TASKS;
  let selectedTaskId: string | null = null;
  let followLog = true;
  let logTailBytes = DEFAULT_LOG_TAIL;
  let lastLogText = '';
  let lastLogTruncated = false;
  let loadSeq = 0;
  let logSeq = 0;
  let loadInFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let logTimer: ReturnType<typeof setInterval> | undefined;
  const rapidTimers = new Set<ReturnType<typeof setTimeout>>();
  let listEvents = new AbortController();
  const staticEvents = new AbortController();

  const owns = () => !disposed && !!viewOwner && sessionState.ownsSelection(viewOwner)
    && sameEndpoint(options.endpoint(viewOwner.host), viewEndpoint);
  const isOpen = () => !disposed && options.root.classList.contains('tasks-open');

  function clearRapidTimers() {
    for (const timer of rapidTimers) clearTimeout(timer);
    rapidTimers.clear();
  }

  function scheduleRapidReload() {
    for (const delay of [800, 2200]) {
      const timer = setTimeout(() => {
        rapidTimers.delete(timer);
        if (owns() && !loadInFlight) void load();
      }, delay);
      rapidTimers.add(timer);
    }
  }

  function selectedTask(): BackgroundTaskItem | null {
    if (!selectedTaskId) return null;
    return data.tasks.find(t => t.id === selectedTaskId) ?? null;
  }

  function open(owner: SelectionOwner, endpoint: HostEndpoint, initial?: SessionTasksPayload) {
    if (disposed || !sessionState.ownsSelection(owner)) return;
    close();
    options.closeOtherViews();
    viewOwner = owner;
    viewEndpoint = Object.freeze({ ...endpoint });
    data = initial?.supported ? initial : EMPTY_TASKS;
    selectedTaskId = data.tasks[0]?.id ?? null;
    followLog = true;
    logTailBytes = DEFAULT_LOG_TAIL;
    lastLogText = '';
    lastLogTruncated = false;
    options.root.classList.add('tasks-open');
    render();
    if (selectedTaskId) void loadTaskLog(selectedTaskId, true);
    void load();
    pollTimer = setInterval(() => {
      if (!owns() || loadInFlight) return;
      if (!sessionState.currentSession?.isActive && !data.isActive) return;
      void load();
    }, 3000);
  }

  function close() {
    if (!isOpen()) return;
    loadSeq++;
    logSeq++;
    clearInterval(pollTimer); pollTimer = undefined;
    clearInterval(logTimer); logTimer = undefined;
    clearRapidTimers();
    listEvents.abort();
    viewOwner = null;
    viewEndpoint = null;
    selectedTaskId = null;
    lastLogText = '';
    lastLogTruncated = false;
    options.root.classList.remove('tasks-open');
  }

  async function load() {
    if (!owns() || !viewOwner || !viewEndpoint) return;
    const owner = viewOwner, endpoint = viewEndpoint, seq = ++loadSeq;
    loadInFlight = true;
    const current = () => seq === loadSeq && owns() && viewOwner === owner;
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/tasks`);
      const payload: unknown = await res.json();
      if (!current()) return;
      if (!res.ok) throw new Error(responseError(res, payload));
      data = decodeSessionTasks(payload);
      if (!selectedTaskId || !data.tasks.some(t => t.id === selectedTaskId)) {
        selectedTaskId = data.tasks[0]?.id ?? null;
        logTailBytes = DEFAULT_LOG_TAIL;
      }
      render();
      syncLogTimer();
      if (selectedTaskId) void loadTaskLog(selectedTaskId, false);
    } catch (error) {
      if (current()) console.error('Failed to load session tasks:', error);
    } finally {
      loadInFlight = false;
    }
  }

  function syncLogTimer() {
    clearInterval(logTimer); logTimer = undefined;
    const task = selectedTask();
    if (!task || !task.hasLog || task.status !== 'running') return;
    logTimer = setInterval(() => {
      if (owns() && selectedTaskId === task.id) void loadTaskLog(task.id, false);
    }, 2000);
  }

  function updateLogControls() {
    const followBtn = element('tasksLogFollowBtn');
    followBtn.classList.toggle('active', followLog);
    followBtn.textContent = followLog ? '● Follow' : '○ Follow';
    const moreBtn = element('tasksLogMoreBtn');
    moreBtn.style.display = lastLogTruncated && logTailBytes < MAX_LOG_TAIL ? '' : 'none';
  }

  async function loadTaskLog(taskId: string, reset: boolean) {
    if (!owns() || !viewOwner || !viewEndpoint) return;
    const task = data.tasks.find(t => t.id === taskId);
    const logEl = element('tasksDetailLog');
    const logMeta = element('tasksDetailLogMeta');
    if (!task || !task.hasLog) {
      lastLogText = task?.preview || '';
      lastLogTruncated = false;
      logEl.textContent = lastLogText || (task?.status === 'running' ? 'Waiting for background task log…' : 'No log file recorded for this task.');
      logMeta.textContent = '';
      updateLogControls();
      return;
    }
    const owner = viewOwner, endpoint = viewEndpoint, seq = ++logSeq;
    if (reset) {
      logEl.textContent = 'Loading log…';
      logMeta.textContent = '';
    }
    const stale = () => seq !== logSeq || !owns() || viewOwner !== owner || selectedTaskId !== taskId;
    const query = logTailBytes > DEFAULT_LOG_TAIL ? `?tail=${logTailBytes}` : '';
    try {
      const res = await options.request(endpoint,
        `/api/sessions/${encodeURIComponent(owner.id)}/tasks/${encodeURIComponent(taskId)}/log${query}`);
      const payload: unknown = await res.json();
      if (stale()) return;
      if (!res.ok) throw new Error(responseError(res, payload));
      const log: TaskLogPayload | null = decodeTaskLog(payload);
      if (!log) return;
      const stickToTail = followLog && logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60;
      lastLogText = log.content;
      lastLogTruncated = log.truncated;
      logEl.textContent = log.content || '(empty log)';
      logMeta.textContent = `${formatByteSize(log.totalBytes)}${log.truncated ? ' (tail)' : ''} · updated ${formatRelativeTime(log.updatedAt)}`;
      updateLogControls();
      if (reset || stickToTail) logEl.scrollTop = logEl.scrollHeight;
    } catch (error) {
      if (stale()) return;
      if (reset) {
        lastLogText = '';
        lastLogTruncated = false;
        logEl.textContent = `Log unavailable: ${errorMessage(error)}`;
        updateLogControls();
      }
    }
  }

  function selectTask(taskId: string) {
    if (!owns()) return;
    selectedTaskId = taskId;
    followLog = true;
    logTailBytes = DEFAULT_LOG_TAIL;
    lastLogText = '';
    lastLogTruncated = false;
    render();
    syncLogTimer();
    void loadTaskLog(taskId, true);
  }

  async function sendTaskControlPrompt(message: string, successText: string): Promise<boolean> {
    if (!owns() || !viewOwner || !viewEndpoint || !data.canControl) return false;
    const endpoint = viewEndpoint, sessionId = viewOwner.id;
    const kind = sessionState.currentSession?.turnInProgress ? 'steer' : 'prompt';
    try {
      await sendJson(options.request, endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/${kind}`, { message });
      if (!owns()) return false;
      options.status(successText, 'success');
      scheduleRapidReload();
      return true;
    } catch (error) {
      if (owns()) options.status(errorMessage(error), 'error');
      return false;
    }
  }

  async function killSelectedTask() {
    const task = selectedTask();
    if (!owns() || !task || !data.canControl || task.kind === 'tool') return;
    if (task.status !== 'running' && task.status !== 'scheduled') return;
    const actionLabel = task.kind === 'schedule' ? 'Cancel schedule' : 'Kill background task';
    if (!options.confirm(`${actionLabel} "${task.title}" (${task.id})?`)) return;
    const targetId = task.fullTaskId || task.id;
    await sendTaskControlPrompt(
      `Kill background task "${targetId}" using manage_task with Action="kill" and TaskId=${JSON.stringify(targetId)}.`,
      task.kind === 'schedule' ? `Cancelling ${task.id}…` : `Killing ${task.id}…`,
    );
  }

  async function abortActiveTurn() {
    if (!owns() || !viewOwner || !viewEndpoint || !data.canControl) return;
    const endpoint = viewEndpoint, sessionId = viewOwner.id;
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/abort`, { method: 'POST' });
      const payload: unknown = await res.json().catch(() => ({}));
      if (!owns()) return;
      if (!res.ok) throw new Error(responseError(res, payload));
      options.status('Turn abort requested', 'success');
      scheduleRapidReload();
    } catch (error) {
      if (owns()) options.status(errorMessage(error), 'error');
    }
  }

  async function sendStdinToTask() {
    const task = selectedTask();
    if (!owns() || !task || !data.canControl || task.kind !== 'shell' || task.status !== 'running') return;
    const input = element<HTMLInputElement>('tasksStdinInput');
    const line = input.value;
    if (!line.trim()) return;
    const targetId = task.fullTaskId || task.id;
    const ok = await sendTaskControlPrompt(
      `Send stdin to running task "${targetId}" using manage_task with Action="send_input", TaskId=${JSON.stringify(targetId)}, and Input=${JSON.stringify(line + '\n')}.`,
      `Sent input to ${task.id}`,
    );
    if (ok && owns()) input.value = '';
  }

  async function copyTaskLog() {
    const textToCopy = lastLogText || element('tasksDetailLog').textContent || '';
    if (!textToCopy) return;
    try {
      await options.copy(textToCopy);
      if (owns()) options.status('Copied task log', 'success');
    } catch (error) {
      if (owns()) options.status(`Copy failed: ${errorMessage(error)}`, 'error');
    }
  }

  function render() {
    if (!owns() || !isOpen()) return;
    listEvents.abort();
    listEvents = new AbortController();

    const runningTasks = data.tasks.filter(t => t.status === 'running').length;
    const scheduledTasks = data.tasks.filter(t => t.status === 'scheduled').length;
    const workingSubs = data.subagents.filter(s => s.state === 'working').length;
    const noteParts: string[] = [];
    if (runningTasks) noteParts.push(`${runningTasks} running`);
    if (scheduledTasks) noteParts.push(`${scheduledTasks} scheduled`);
    if (data.tasks.length) noteParts.push(`${data.tasks.length} task${data.tasks.length === 1 ? '' : 's'}`);
    if (data.subagents.length) noteParts.push(`${data.subagents.length} subagent${data.subagents.length === 1 ? '' : 's'}${workingSubs ? ` (${workingSubs} working)` : ''}`);
    if (data.plan.length) {
      const done = data.plan.filter(p => p.status === 'completed').length;
      noteParts.push(`plan ${done}/${data.plan.length}`);
    }
    element('tasksViewNote').textContent = noteParts.join(' · ') || 'No tasks yet';

    const listEl = element('tasksList');
    listEl.replaceChildren();

    // 1. Plan section
    if (data.plan.length) {
      const sec = document.createElement('div');
      sec.className = 'tasks-section';
      const head = document.createElement('div');
      head.className = 'tasks-section-title';
      const done = data.plan.filter(p => p.status === 'completed').length;
      head.textContent = `Plan (${done}/${data.plan.length})`;
      sec.appendChild(head);
      for (const item of data.plan) {
        const row = document.createElement('div');
        row.className = `tasks-plan-row status-${item.status}`;
        const mark = document.createElement('span');
        mark.className = 'tasks-plan-mark';
        mark.textContent = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '▸' : '○';
        const textEl = document.createElement('span');
        textEl.className = 'tasks-plan-text';
        textEl.textContent = item.content;
        row.append(mark, textEl);
        sec.appendChild(row);
      }
      listEl.appendChild(sec);
    }

    // 2. Background tasks section
    const taskSec = document.createElement('div');
    taskSec.className = 'tasks-section';
    const taskHead = document.createElement('div');
    taskHead.className = 'tasks-section-title';
    taskHead.textContent = `Background tasks (${data.tasks.length})`;
    taskSec.appendChild(taskHead);
    if (!data.tasks.length) {
      const empty = document.createElement('div');
      empty.className = 'tasks-empty-note';
      empty.textContent = 'No background commands or schedules recorded.';
      taskSec.appendChild(empty);
    } else {
      for (const task of data.tasks) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `tasks-row status-${task.status}${task.id === selectedTaskId ? ' selected' : ''}`;
        row.dataset.taskId = task.id;
        const top = document.createElement('div');
        top.className = 'tasks-row-top';
        if (task.status === 'running' || task.status === 'scheduled') {
          const dot = document.createElement('span');
          dot.className = `tasks-dot ${task.status}`;
          top.appendChild(dot);
        }
        const title = document.createElement('span');
        title.className = 'tasks-row-title';
        title.textContent = task.title;
        top.appendChild(title);
        const badge = document.createElement('span');
        badge.className = `tasks-status-pill status-${task.status}`;
        badge.textContent = task.exitCode !== null && task.exitCode !== 0 ? `exit ${task.exitCode}` : task.status;
        top.appendChild(badge);
        row.appendChild(top);

        const meta = document.createElement('div');
        meta.className = 'tasks-row-meta';
        const bits = [task.id, task.kind];
        if (task.cron) bits.push(task.cron);
        else if (task.durationSeconds !== null) bits.push(`${task.durationSeconds}s`);
        if (task.isDaemon) bits.push('daemon');
        if (task.logBytes !== null) bits.push(formatByteSize(task.logBytes));
        if (task.startedAt) bits.push(formatRelativeTime(task.startedAt));
        meta.textContent = bits.join(' · ');
        row.appendChild(meta);

        row.addEventListener('click', () => selectTask(task.id), { signal: listEvents.signal });
        taskSec.appendChild(row);
      }
    }
    listEl.appendChild(taskSec);

    // 3. Subagents section (jumps straight into Subagents or Swarm view!)
    if (data.subagents.length) {
      const subSec = document.createElement('div');
      subSec.className = 'tasks-section';
      const subHead = document.createElement('div');
      subHead.className = 'tasks-section-title';
      subHead.textContent = `Subagents & workers (${data.subagents.length})`;
      subSec.appendChild(subHead);
      for (const sub of data.subagents) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `tasks-row tasks-subagent-row status-${sub.state}`;
        const top = document.createElement('div');
        top.className = 'tasks-row-top';
        if (sub.state === 'working' || sub.state === 'waiting') {
          const dot = document.createElement('span');
          dot.className = `tasks-dot ${sub.state === 'working' ? 'running' : 'scheduled'}`;
          top.appendChild(dot);
        }
        const title = document.createElement('span');
        title.className = 'tasks-row-title';
        title.textContent = sub.name;
        top.appendChild(title);
        const badge = document.createElement('span');
        badge.className = `tasks-status-pill status-${sub.state}`;
        badge.textContent = sub.state;
        top.appendChild(badge);
        row.appendChild(top);

        const meta = document.createElement('div');
        meta.className = 'tasks-row-meta';
        meta.textContent = [sub.isSwarmWorker ? 'swarm' : sub.typeName, sub.model, sub.currentAction].filter(Boolean).join(' · ');
        row.appendChild(meta);

        row.addEventListener('click', () => {
          if (!owns() || !viewOwner || !viewEndpoint) return;
          if (sub.isSwarmWorker && data.swarm) {
            options.openSwarm(viewOwner, viewEndpoint, sub.swarmMemberName || undefined);
          } else {
            options.openSubagent(viewOwner, viewEndpoint, sub.id);
          }
        }, { signal: listEvents.signal });
        subSec.appendChild(row);
      }
      listEl.appendChild(subSec);
    }

    renderDetail();
  }

  function renderDetail() {
    const empty = element('tasksDetailEmpty');
    const content = element('tasksDetailContent');
    const task = selectedTask();
    if (!task) {
      empty.style.display = '';
      content.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    content.style.display = 'flex';
    element('tasksDetailTitle').textContent = task.title;
    const metaBits = [task.id, task.kind, task.status];
    if (task.exitCode !== null) metaBits.push(`exit ${task.exitCode}`);
    if (task.cron) metaBits.push(`cron ${task.cron}`);
    if (task.durationSeconds !== null) metaBits.push(`timer ${task.durationSeconds}s`);
    if (task.isDaemon) metaBits.push('daemon');
    if (task.startedAt) metaBits.push(`started ${formatRelativeTime(task.startedAt)}`);
    if (task.finishedAt) metaBits.push(`ended ${formatRelativeTime(task.finishedAt)}`);
    element('tasksDetailMeta').textContent = metaBits.join(' · ');

    const cmdEl = element('tasksDetailCommand');
    const cmdText = task.command || (task.cron ? `${task.cron} — ${task.preview}` : task.preview);
    cmdEl.style.display = cmdText ? '' : 'none';
    cmdEl.textContent = cmdText;

    // Action buttons
    const canKill = data.canControl && task.kind !== 'tool' && (task.status === 'running' || task.status === 'scheduled');
    const killBtn = element<HTMLButtonElement>('tasksKillBtn');
    killBtn.style.display = canKill ? '' : 'none';
    if (canKill) {
      killBtn.textContent = task.kind === 'schedule' ? 'Cancel' : 'Kill';
      killBtn.title = task.kind === 'schedule' ? `Cancel scheduled task ${task.id}` : `Kill background task ${task.id}`;
    }
    const abortBtn = element<HTMLButtonElement>('tasksAbortTurnBtn');
    abortBtn.style.display = data.canControl && task.kind === 'tool' && task.status === 'running' ? '' : 'none';

    const stdinBar = element('tasksStdinBar');
    stdinBar.style.display = data.canControl && task.kind === 'shell' && task.status === 'running' ? 'flex' : 'none';

    updateLogControls();
  }

  // Static listeners
  element('tasksKillBtn').addEventListener('click', () => { void killSelectedTask(); }, { signal: staticEvents.signal });
  element('tasksAbortTurnBtn').addEventListener('click', () => { void abortActiveTurn(); }, { signal: staticEvents.signal });
  element('tasksLogFollowBtn').addEventListener('click', () => {
    followLog = !followLog;
    updateLogControls();
    if (followLog) {
      const logEl = element('tasksDetailLog');
      logEl.scrollTop = logEl.scrollHeight;
    }
  }, { signal: staticEvents.signal });
  element('tasksLogMoreBtn').addEventListener('click', () => {
    if (!owns() || !selectedTaskId) return;
    logTailBytes = MAX_LOG_TAIL;
    void loadTaskLog(selectedTaskId, false);
  }, { signal: staticEvents.signal });
  element('tasksLogCopyBtn').addEventListener('click', () => { void copyTaskLog(); }, { signal: staticEvents.signal });
  element('tasksStdinSendBtn').addEventListener('click', () => { void sendStdinToTask(); }, { signal: staticEvents.signal });
  element<HTMLInputElement>('tasksStdinInput').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void sendStdinToTask();
  }, { signal: staticEvents.signal });

  return {
    open,
    close,
    isOpen,
    reload: () => { if (owns()) void load(); },
    dispose() { close(); staticEvents.abort(); disposed = true; },
  };
}
