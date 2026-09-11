import type { ApiRequest } from './api-client';
import { sendJson } from './api-client';
import type { DirectoryHost } from './directory-catalog';
import type { SpawnTarget } from './spawn-targets';

export interface SessionSpawnInput {
  readonly host: Readonly<DirectoryHost>;
  readonly name?: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly target?: SpawnTarget | null;
  readonly harness?: string;
  readonly draft?: string | null;
  readonly ownsView: () => boolean;
  readonly onAccepted?: () => void;
}
export interface PendingSessionSpawn {
  readonly spawnId: string;
  readonly host: string | null;
  readonly endpoint: Readonly<DirectoryHost>;
  readonly cwd: string;
  readonly target: boolean;
  readonly harness: string;
  readonly harnessLabel: string;
}
export type SpawnStatus = Readonly<{ status: 'starting' }>
  | Readonly<{ status: 'ready'; sessionId: string }>
  | Readonly<{ status: 'error'; error: string }>;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function decodeSpawnId(value: unknown): string {
  if (!record(value) || typeof value.spawnId !== 'string' || !value.spawnId) throw new Error('Failed to start session');
  return value.spawnId;
}
export function decodeSpawnStatus(value: unknown): SpawnStatus {
  if (record(value)) {
    if (value.status === 'starting') return { status: 'starting' };
    if (value.status === 'error') return { status: 'error', error: typeof value.error === 'string' && value.error ? value.error : 'Session failed to start' };
    if (value.status === 'ready' && typeof value.sessionId === 'string' && value.sessionId) return { status: 'ready', sessionId: value.sessionId };
  }
  throw new Error('Session spawn returned an invalid result');
}
export function sessionSpawnKey(host: string | null, spawnId: string): string { return JSON.stringify([host, spawnId]); }

/** Submitted operations own their endpoint and draft independently of the visible pane. */
export function createSessionSpawns(options: {
  request: ApiRequest;
  delay: () => Promise<void>;
  harnessLabel: (id: string) => string;
  current: () => string | null;
  changed: () => void;
  showPending: (key: string) => void;
  loadSessions: () => Promise<unknown>;
  hasSession: (id: string, host: string | null) => boolean;
  selectSession: (id: string, host: string | null) => void;
  stashPrompt: () => void;
  saveDraft: (key: string, draft: string) => void;
  migratePrompt: (key: string, host: string | null, sessionId: string) => void;
  discardPrompt: (key: string) => void;
  showFailure: (key: string, message: string, spawn: PendingSessionSpawn) => void;
  status: (message: string, kind?: 'working' | 'error') => void;
}) {
  const pending = new Map<string, PendingSessionSpawn>();
  async function monitor(key: string, spawn: PendingSessionSpawn): Promise<void> {
    try {
      let sessionId: string;
      for (;;) {
        let response: Response;
        try { response = await options.request(spawn.endpoint, `/api/session-spawns/${encodeURIComponent(spawn.spawnId)}`); }
        catch { await options.delay(); continue; }
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok && response.status !== 202) throw new Error(record(data) && typeof data.error === 'string' && data.error ? data.error : `spawn status failed (${response.status})`);
        const status = decodeSpawnStatus(data);
        if (status.status === 'starting') { await options.delay(); continue; }
        if (status.status === 'error') throw new Error(status.error);
        sessionId = status.sessionId;
        break;
      }
      // Registration may finish during an older list request. Wait for the
      // authoritative host-qualified row before transferring composer state.
      for (;;) {
        await options.loadSessions();
        if (options.hasSession(sessionId, spawn.host)) {
          pending.delete(key);
          options.changed();
          const showing = options.current() === key;
          if (showing) options.stashPrompt();
          options.migratePrompt(key, spawn.host, sessionId);
          if (showing) { options.status('Session created'); options.selectSession(sessionId, spawn.host); }
          return;
        }
        if (options.current() === key) options.status('Session created — connecting the UI…', 'working');
        await options.delay();
      }
    } catch (error) {
      pending.delete(key);
      options.changed();
      const message = error instanceof Error ? error.message : String(error);
      if (options.current() === key) {
        options.showFailure(key, message, spawn);
        options.status(`Session start failed: ${message}`, 'error');
      } else options.discardPrompt(key);
    }
  }
  async function submit(input: SessionSpawnInput): Promise<string> {
    const host = Object.freeze({ ...input.host });
    const target = input.target ? Object.freeze({ ...input.target }) : undefined;
    const { name, cwd, model, thinking, draft, ownsView, onAccepted } = input;
    const harness = input.harness || 'pi';
    const label = options.harnessLabel(harness);
    const data = await sendJson(options.request, host, '/api/sessions/new', {
      name: name || undefined, cwd: cwd || undefined, model: model || undefined,
      thinking: thinking || undefined, target, harness, async: true,
    });
    const spawnId = decodeSpawnId(data);
    const key = sessionSpawnKey(host.hostId || null, spawnId);
    const spawn: PendingSessionSpawn = Object.freeze({ spawnId, endpoint: host, host: host.hostId || null,
      cwd: cwd || '~', target: !!target, harness, harnessLabel: label });
    pending.set(key, spawn);
    if (draft) options.saveDraft(key, draft);
    onAccepted?.();
    if (ownsView()) options.showPending(key);
    else options.changed();
    void monitor(key, spawn);
    return key;
  }
  return { submit,
    has: (key: string) => pending.has(key),
    get: (key: string) => pending.get(key),
    entries: (): readonly (readonly [string, PendingSessionSpawn])[] => [...pending.entries()],
  };
}
