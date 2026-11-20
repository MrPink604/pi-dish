/**
 * Imports Antigravity conversations that started outside pi-dish (the `agy`
 * TUI or another ACP client) into Pi-format mirrors.
 *
 * One short-lived `agy acp` child answers `session/list`, replays each missing
 * or stale conversation with `session/load`, then closes. The import runs once
 * shortly after server start, on an interval and on demand. It never touches
 * agy's token files or store, skips conversations live in a relay, and logs
 * errors instead of failing the server.
 */
import path = require('path');
import { readDishSettings } from './dish-store';
import { getHarness } from './harnesses';
import { harnessCommandAvailable } from './harness-feature-commands';
import { listRegisteredSessions } from './bridge-session';
import { record as isRecord } from './helper-values';
import { errorMessage } from './http-boundary';
import { readAcpMirrorLastTimestamp } from './acp-transcript';
import {
  AGY_STALE_TOLERANCE_MS,
  agyMirrorRoot,
  createAcpImportAgent,
  getAllAcpSessions,
  readAgySideChatIds,
  type AcpSession,
  type AgyConversation,
} from './acp-session';

/** Default automatic import cadence: every 15 minutes, shortly after start. */
export const AGY_IMPORT_DEFAULT_MS = 15 * 60_000;
export const AGY_IMPORT_INTERVAL_ENV = 'PI_DISH_AGY_IMPORT_INTERVAL_MS';
export const AGY_IMPORT_INTERVAL_SETTING = 'agyImportIntervalMinutes';

const FIRST_RUN_DELAY_MS = 15_000;
const RUN_BUDGET_MS = 5 * 60_000;

/** Interval in ms; `0` disables the automatic runs. Env wins over the setting. */
export function agyImportIntervalMs(settings: Record<string, unknown> = readDishSettings()): number {
  const fromEnv = Number(process.env[AGY_IMPORT_INTERVAL_ENV]);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  const minutes = Number(settings[AGY_IMPORT_INTERVAL_SETTING]);
  if (Number.isFinite(minutes) && minutes >= 0) return minutes * 60_000;
  return AGY_IMPORT_DEFAULT_MS;
}

function agyInstalled(): boolean {
  const descriptor = getHarness('agy');
  return !!descriptor && harnessCommandAvailable(descriptor);
}

/** Native ids of conversations a relay currently owns (bridge claim or in-process child). */
function liveAgySessionIds(): Set<string> {
  const ids = new Set(getAllAcpSessions().map(session => String(session.id)));
  for (const entry of listRegisteredSessions()) {
    const wrapper = isRecord(entry.wrapper) ? entry.wrapper : {};
    const harnessId = typeof wrapper.harnessId === 'string' ? wrapper.harnessId : entry.harnessId;
    if (harnessId !== 'agy') continue;
    const nativeId = typeof entry.nativeSessionId === 'string' && entry.nativeSessionId
      ? entry.nativeSessionId
      : entry.sessionId;
    if (nativeId) ids.add(nativeId);
  }
  return ids;
}

export interface AgyImportEntry {
  sessionId: string;
  cwd: string | null;
  title: string | null;
  file: string;
  backup: string | null;
}

export interface AgyImportFailure {
  sessionId: string | null;
  error: string;
}

export interface AgyImportOutcome {
  reason: string;
  status: 'completed' | 'skipped' | 'failed';
  skipped?: 'not-installed' | 'already-running';
  imported: AgyImportEntry[];
  live: string[];
  upToDate: number;
  errors: AgyImportFailure[];
  startedAt: number;
  finishedAt: number | null;
}

export interface AgyImportPorts {
  readSettings?: () => Record<string, unknown>;
  isLive?: (sessionId: string) => boolean;
  isInstalled?: () => boolean;
  log?: (line: string) => void;
}

export interface AgyImportRuntime {
  start(): void;
  stop(): void;
  run(reason?: string): Promise<AgyImportOutcome>;
}

function skippedOutcome(reason: string, skipped: 'not-installed' | 'already-running'): AgyImportOutcome {
  return {
    reason,
    status: 'skipped',
    skipped,
    imported: [],
    live: [],
    upToDate: 0,
    errors: [],
    startedAt: Date.now(),
    finishedAt: Date.now(),
  };
}

function needsImport(file: string, conversation: AgyConversation): boolean {
  const last = readAcpMirrorLastTimestamp(file);
  if (last === null) return true;
  if (conversation.updatedAt === null) return false;
  return conversation.updatedAt > last + AGY_STALE_TOLERANCE_MS;
}

export function createAgyImportRuntime(ports: AgyImportPorts = {}): AgyImportRuntime {
  // HOME is resolved per call so tests can point dishDir() at a temp directory.
  const readSettings = ports.readSettings ?? readDishSettings;
  const isLive = ports.isLive ?? (sessionId => liveAgySessionIds().has(sessionId));
  const isInstalled = ports.isInstalled ?? agyInstalled;
  const log = ports.log ?? ((line: string) => console.log(`[agy-import] ${line}`));

  let interval: NodeJS.Timeout | null = null;
  let firstRun: NodeJS.Timeout | null = null;
  let current: Promise<AgyImportOutcome> | null = null;
  let stopped = false;

  async function execute(reason: string): Promise<AgyImportOutcome> {
    const startedAt = Date.now();
    const outcome: AgyImportOutcome = {
      reason,
      status: 'completed',
      imported: [],
      live: [],
      upToDate: 0,
      errors: [],
      startedAt,
      finishedAt: null,
    };
    let agent: AcpSession | null = null;
    try {
      agent = await createAcpImportAgent({ cwd: process.cwd() });
      const conversations = await agent.listConversations();
      const sideChatIds = readAgySideChatIds();
      const deadline = startedAt + RUN_BUDGET_MS;
      for (const conversation of conversations) {
        if (Date.now() >= deadline) {
          outcome.errors.push({ sessionId: null, error: 'Import run exceeded its time budget.' });
          break;
        }
        if (sideChatIds.has(conversation.sessionId)) {
          continue;
        }
        if (isLive(conversation.sessionId)) {
          outcome.live.push(conversation.sessionId);
          continue;
        }
        const file = path.join(agyMirrorRoot(), `${conversation.sessionId}.jsonl`);
        if (!needsImport(file, conversation)) {
          outcome.upToDate += 1;
          continue;
        }
        try {
          const imported = await agent.importConversation(conversation, file);
          outcome.imported.push({
            sessionId: conversation.sessionId,
            cwd: conversation.cwd,
            title: conversation.title,
            file: imported.file,
            backup: imported.backup,
          });
        } catch (error) {
          outcome.errors.push({ sessionId: conversation.sessionId, error: errorMessage(error) });
          log(`could not import ${conversation.sessionId}: ${errorMessage(error)}`);
        }
      }
    } catch (error) {
      outcome.status = 'failed';
      outcome.errors.push({ sessionId: null, error: errorMessage(error) });
      log(`run failed: ${errorMessage(error)}`);
    } finally {
      if (agent) {
        try { await agent.close(); } catch { agent.kill(); }
      }
    }
    outcome.finishedAt = Date.now();
    if (outcome.imported.length) log(`imported ${outcome.imported.length} conversation(s)`);
    return outcome;
  }

  function run(reason = 'manual'): Promise<AgyImportOutcome> {
    if (current) return Promise.resolve(skippedOutcome(reason, 'already-running'));
    if (!isInstalled()) return Promise.resolve(skippedOutcome(reason, 'not-installed'));
    const task = execute(reason);
    current = task;
    void task.finally(() => { if (current === task) current = null; });
    return task;
  }

  return {
    start(): void {
      if (stopped || interval || firstRun) return;
      const cadence = agyImportIntervalMs(readSettings());
      if (cadence <= 0) {
        log('automatic import is disabled');
        return;
      }
      firstRun = setTimeout(() => {
        firstRun = null;
        if (!stopped) void run('startup');
      }, FIRST_RUN_DELAY_MS);
      firstRun.unref();
      interval = setInterval(() => { if (!stopped) void run('interval'); }, cadence);
      interval.unref();
    },
    stop(): void {
      stopped = true;
      clearTimeout(firstRun ?? undefined);
      clearInterval(interval ?? undefined);
      firstRun = null;
      interval = null;
    },
    run,
  };
}
