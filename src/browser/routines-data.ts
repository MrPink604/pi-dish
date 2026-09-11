import { record, finite } from './helper-values';
import type { HostEndpoint } from './api-client';
export interface RoutineInvocation {
  readonly id: string; readonly version: number | null; readonly trigger: string; readonly source: string; readonly delivery: string; readonly status: string;
  readonly startedAt: number | null; readonly durationMs: number | null; readonly sessionId: string; readonly skipReason: string; readonly error: string; readonly closeError: string; readonly summary: string;
}
export interface RoutineVersion { readonly version: number; readonly savedAt: number; readonly prompt: string }
export interface Routine {
  readonly id: string; readonly name: string; readonly description: string; readonly harness: string; readonly cwd: string; readonly model: string; readonly thinking: string;
  readonly schedule: { readonly cron: string } | null; readonly enabled: boolean; readonly mode: 'oneShot' | 'continue'; readonly onBusy: 'skip' | 'steer' | 'followUp';
  readonly minIntervalSec: number; readonly prompt: string; readonly promptVersion: number; readonly versions: readonly RoutineVersion[];
  readonly stats: { readonly invocations: number; readonly nextRunAt: number | null; lastInvocation: RoutineInvocation | null };
  readonly host: string | null; readonly hostLabel: string; readonly endpoint: Readonly<HostEndpoint>;
}
export interface RoutineForm {
  name: string; description: string; harness: string; cwd: string; model: string; thinking: string; cron: string; enabled: boolean;
  mode: 'oneShot' | 'continue'; onBusy: 'skip' | 'steer' | 'followUp'; minIntervalSec: number; prompt: string;
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => finite(value) ? value : 0;
export function decodeRoutineInvocations(value: unknown): { invocations: RoutineInvocation[]; nextBefore: number | null } {
  if (!record(value)) throw new Error('Invalid routine invocation response');
  return { invocations: Array.isArray(value.invocations) ? value.invocations.flatMap((row: unknown) => {
    if (!record(row) || typeof row.id !== 'string') return [];
    return [{ id: row.id, version: finite(row.version) ? row.version : null, trigger: text(row.trigger), source: text(row.source), delivery: text(row.delivery), status: text(row.status),
      startedAt: finite(row.startedAt) ? row.startedAt : null, durationMs: finite(row.durationMs) ? row.durationMs : null, sessionId: text(row.sessionId),
      skipReason: text(row.skipReason), error: text(row.error), closeError: text(row.closeError), summary: text(row.summary) }];
  }) : [], nextBefore: finite(value.nextBefore) ? value.nextBefore : null };
}
export function decodeRoutine(value: unknown, host: { hostId: string | null; label?: string | null; base: string; token?: string | null }): Routine {
  if (!record(value)) throw new Error('Invalid routine response');
  const row = record(value.routine) ? value.routine : value;
  if (typeof row.id !== 'string' || !row.id) throw new Error('Invalid routine identity');
  const stats = record(row.stats) ? row.stats : {};
  const versions = Array.isArray(row.versions) ? row.versions.flatMap((version: unknown) => record(version) && finite(version.version) && typeof version.prompt === 'string'
    ? [{ version: version.version, savedAt: number(version.savedAt), prompt: version.prompt }] : []) : [];
  return { id: row.id, name: text(row.name), description: text(row.description), harness: text(row.harness) || 'pi', cwd: text(row.cwd), model: text(row.model), thinking: text(row.thinking),
    schedule: record(row.schedule) && typeof row.schedule.cron === 'string' ? { cron: row.schedule.cron } : null, enabled: row.enabled !== false,
    mode: row.mode === 'continue' ? 'continue' : 'oneShot', onBusy: row.onBusy === 'steer' || row.onBusy === 'followUp' ? row.onBusy : 'skip', minIntervalSec: number(row.minIntervalSec),
    prompt: text(row.prompt), promptVersion: number(row.promptVersion) || 1, versions,
    stats: { invocations: number(stats.invocations), nextRunAt: finite(stats.nextRunAt) ? stats.nextRunAt : null, lastInvocation: decodeRoutineInvocations({ invocations: [stats.lastInvocation] }).invocations[0] || null },
    host: host.hostId, hostLabel: host.label || '', endpoint: Object.freeze({ base: host.base, token: host.token }) };
}
export function decodeRoutineList(value: unknown, host: Parameters<typeof decodeRoutine>[1]): Routine[] {
  if (!record(value) || !Array.isArray(value.routines)) throw new Error('Invalid routines response');
  return value.routines.flatMap((row: unknown) => { try { return [decodeRoutine(row, host)]; } catch { return []; } });
}
