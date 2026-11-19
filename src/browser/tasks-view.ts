import { errorMessage, responseError, sameEndpoint, type ApiRequest, type HostEndpoint } from './api-client';
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
}) {
  const document = options.root.ownerDocument;
  const sessionState = options.sessionState;
  const element = requiredElement(document, 'tasks view');

  let disposed = false;
  let viewOwner: SelectionOwner | null = null;
  let viewEndpoint: HostEndpoint | null = null;
  let data: SessionTasksPayload = EMPTY_TASKS;
  let selectedTaskId: string | null = null;
  let loadSeq = 0;
  let logSeq = 0;
  let loadInFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let logTimer: ReturnType<typeof setInterval> | undefined;
  let listEvents = new AbortController();

  const owns = () => !disposed && !!viewOwner && sessionState.ownsSelection(viewOwner)
    && sameEndpoint(options.endpoint(viewOwner.host), viewEndpoint);
  const isOpen = () => !disposed && options.root.classList.contains('tasks-open');

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
    listEvents.abort();
    viewOwner = null;
    viewEndpoint = null;
    selectedTaskId = null;
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

  async function loadTaskLog(taskId: string, reset: boolean) {
    if (!owns() || !viewOwner || !viewEndpoint) return;
    const task = data.tasks.find(t => t.id === taskId);
    const logEl = element('tasksDetailLog');
    const logMeta = element('tasksDetailLogMeta');
    if (!task || !task.hasLog) {
      logEl.textContent = task?.preview || (task?.status === 'running' ? 'Waiting for background task log…' : 'No log file recorded for this task.');
      logMeta.textContent = '';
      return;
    }
    const owner = viewOwner, endpoint = viewEndpoint, seq = ++logSeq;
    if (reset) {
      logEl.textContent = 'Loading log…';
      logMeta.textContent = '';
    }
    const stale = () => seq !== logSeq || !owns() || viewOwner !== owner || selectedTaskId !== taskId;
    try {
      const res = await options.request(endpoint,
        `/api/sessions/${encodeURIComponent(owner.id)}/tasks/${encodeURIComponent(taskId)}/log`);
      const payload: unknown = await res.json();
      if (stale()) return;
      if (!res.ok) throw new Error(responseError(res, payload));
      const log: TaskLogPayload | null = decodeTaskLog(payload);
      if (!log) return;
      const stickToTail = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60;
      logEl.textContent = log.content || '(empty log)';
      logMeta.textContent = `${formatByteSize(log.totalBytes)}${log.truncated ? ' (tail)' : ''} · updated ${formatRelativeTime(log.updatedAt)}`;
      if (reset || stickToTail) logEl.scrollTop = logEl.scrollHeight;
    } catch (error) {
      if (stale()) return;
      if (reset) logEl.textContent = `Log unavailable: ${errorMessage(error)}`;
    }
  }

  function selectTask(taskId: string) {
    if (!owns()) return;
    selectedTaskId = taskId;
    render();
    syncLogTimer();
    void loadTaskLog(taskId, true);
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
  }

  return {
    open,
    close,
    isOpen,
    reload: () => { if (owns()) void load(); },
    dispose() { close(); disposed = true; },
  };
}
