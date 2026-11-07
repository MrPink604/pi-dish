/**
 * Routines own definitions, prompt versions and the thin invocation ledger, not
 * sessions or their histories. Both stores are re-read per call and are advisory:
 * deleting a definition never removes its invocation history or running session.
 */
import crypto = require('crypto');
import { isDeepStrictEqual } from 'util';
import { readStore, writeStore } from './dish-store';
import { asRecord } from './wire-protocol';
import { getHarness } from './harnesses';
import { parseCron } from './cron';
import { errorMessage } from './http-boundary';

export type RoutineMode = 'oneShot' | 'continue';
export type RoutineDelivery = 'prompt' | 'steer' | 'followUp';
export type RoutineStatus = 'starting' | 'running' | 'completed' | 'errored' | 'interrupted' | 'skipped';
export type RoutineThinking = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RoutineOnBusy = 'skip' | 'steer' | 'followUp';
export type RoutineTrigger = 'invoke' | 'schedule';

export interface RoutineVersion {
  version: number;
  prompt: string;
  savedAt: number;
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  harness: string;
  /** Stored as written; session launch rejects a non-string. */
  cwd: unknown;
  model?: string;
  thinking?: RoutineThinking;
  prompt: string;
  promptVersion: number;
  versions: RoutineVersion[];
  schedule: { cron: string } | null;
  enabled: boolean;
  mode: RoutineMode;
  onBusy: RoutineOnBusy;
  minIntervalSec: number;
  lastScheduledMinute: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoutineInvocation {
  id: string;
  routineId: string;
  routineName: string;
  version: number;
  trigger: RoutineTrigger;
  source: string | null;
  delivery: RoutineDelivery;
  status: RoutineStatus;
  skipReason: string | null;
  sessionId: string | null;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  error: string | null;
  input: unknown;
  summary: string | null;
  closed: boolean;
  closeError: string | null;
}

export interface NewInvocation {
  routine: Routine;
  status: RoutineStatus;
  trigger?: RoutineTrigger;
  source?: string | null;
  input?: unknown;
  delivery?: RoutineDelivery;
  skipReason?: string | null;
  sessionId?: string | null;
  startedAt?: number;
  error?: string | null;
}

export type InvocationPatch = Partial<Pick<RoutineInvocation,
  'status' | 'sessionId' | 'endedAt' | 'durationMs' | 'error' | 'summary' | 'closed' | 'closeError' | 'delivery' | 'skipReason'>>;

export interface ListInvocationOptions {
  routineId?: string | null;
  limit?: number;
  before?: number | null;
}

const ROUTINES_FILE = 'routines.json';
const INVOCATIONS_FILE = 'routine-invocations.json';

export const MAX_INVOCATIONS = 5000;
export const MAX_VERSIONS = 50;
export const MAX_PROMPT = 100000;
export const MAX_INPUT_BYTES = 32 * 1024;
export const MAX_SOURCE = 100;
const MAX_DESCRIPTION = 500;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const THINKING_LEVELS: RoutineThinking[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const MODES: RoutineMode[] = ['oneShot', 'continue'];
const ON_BUSY: RoutineOnBusy[] = ['skip', 'steer', 'followUp'];
const DELIVERIES: RoutineDelivery[] = ['prompt', 'steer', 'followUp'];
const STATUSES: RoutineStatus[] = ['starting', 'running', 'completed', 'errored', 'interrupted', 'skipped'];
const ACTIVE_STATUSES: RoutineStatus[] = ['starting', 'running'];

function fail(message: string, status = 400): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function includes<T>(allowed: readonly T[], value: unknown): value is T {
  const values: readonly unknown[] = allowed;
  return values.includes(value);
}

function parseVersions(value: unknown, promptVersion: number, prompt: string, createdAt: number): RoutineVersion[] {
  const rows = Array.isArray(value) ? value : [];
  const versions = rows.flatMap((row): RoutineVersion[] => {
    const entry = asRecord(row);
    return typeof entry.version === 'number' && typeof entry.prompt === 'string'
      ? [{ version: entry.version, prompt: entry.prompt, savedAt: numberOr(entry.savedAt, 0) }]
      : [];
  });
  return versions.length ? versions.slice(-MAX_VERSIONS) : [{ version: promptVersion, prompt, savedAt: createdAt }];
}

/** A stored row is validated once here; everything downstream sees a Routine. */
function parseRoutine(id: string, value: unknown): Routine | null {
  const row = asRecord(value);
  if (row.id !== id || typeof row.name !== 'string' || typeof row.prompt !== 'string') return null;
  const promptVersion = numberOr(row.promptVersion, 1);
  const cron = asRecord(row.schedule).cron;
  return {
    id,
    name: row.name,
    description: stringOr(row.description, ''),
    harness: stringOr(row.harness, 'pi'),
    cwd: row.cwd,
    model: typeof row.model === 'string' && row.model.trim() ? row.model.trim() : undefined,
    thinking: includes(THINKING_LEVELS, row.thinking) ? row.thinking : undefined,
    prompt: row.prompt,
    promptVersion,
    versions: parseVersions(row.versions, promptVersion, row.prompt, numberOr(row.createdAt, 0)),
    schedule: typeof cron === 'string' && cron.trim() ? { cron: cron.trim() } : null,
    enabled: row.enabled === undefined ? true : Boolean(row.enabled),
    mode: includes(MODES, row.mode) ? row.mode : 'oneShot',
    onBusy: includes(ON_BUSY, row.onBusy) ? row.onBusy : 'skip',
    minIntervalSec: numberOr(row.minIntervalSec, 0),
    lastScheduledMinute: typeof row.lastScheduledMinute === 'number' ? row.lastScheduledMinute : null,
    createdAt: numberOr(row.createdAt, 0),
    updatedAt: numberOr(row.updatedAt, 0),
  };
}

/** Raw rows, so a write leaves rows and fields this version cannot parse on disk. */
function storedRoutines(): Record<string, unknown> {
  return asRecord(readStore(ROUTINES_FILE).routines);
}

function parseRoutines(stored: Record<string, unknown>): Record<string, Routine> {
  const routines: Record<string, Routine> = {};
  for (const [id, value] of Object.entries(stored)) {
    const routine = parseRoutine(id, value);
    if (routine) routines[id] = routine;
  }
  return routines;
}

function readRoutines(): Record<string, Routine> {
  return parseRoutines(storedRoutines());
}

/** Write only the fields that changed, so stored values this version cannot parse survive. */
function changedFields(row: unknown, next: object, previous: object | null): Record<string, unknown> {
  const merged = { ...asRecord(row) };
  for (const [key, value] of Object.entries(next)) {
    if (previous && isDeepStrictEqual(value, Reflect.get(previous, key))) continue;
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

function saveRoutine(stored: Record<string, unknown>, routine: Routine, previous: Routine | null): void {
  stored[routine.id] = changedFields(stored[routine.id], routine, previous);
  writeStore(ROUTINES_FILE, { version: 1, routines: stored });
}

export function listRoutines(): Routine[] {
  return Object.values(readRoutines()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Routines are addressed by uuid or by their (case-insensitive) unique name. */
export function getRoutine(ref: string): Routine | null {
  return lookupRoutine(readRoutines(), ref);
}

function lookupRoutine(routines: Record<string, Routine>, ref: string): Routine | null {
  if (!ref) return null;
  if (routines[ref]) return routines[ref];
  const wanted = ref.toLowerCase();
  return Object.values(routines).find((routine) => routine.name.toLowerCase() === wanted) || null;
}

function validateName(name: unknown, routines: Record<string, Routine>, selfId: string): string {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw fail('name must be lowercase letters, digits and dashes (1-48 chars, starting alphanumeric)');
  }
  const clash = Object.values(routines).find((routine) =>
    routine.id !== selfId && routine.name.toLowerCase() === name.toLowerCase());
  if (clash) throw fail(`A routine named "${clash.name}" already exists`, 409);
  return name;
}

function validateOptionalString(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw fail(`${field} must be a string`);
  if (value.length > max) throw fail(`${field} must be at most ${max} characters`);
  return value;
}

function validateCwd(cwd: unknown): string {
  if (typeof cwd !== 'string' || !cwd.trim()) throw fail('cwd is required');
  const trimmed = cwd.trim();
  if (!trimmed.startsWith('/') && !trimmed.startsWith('~')) {
    throw fail('cwd must be an absolute path or start with ~');
  }
  return trimmed;
}

function validateSchedule(schedule: unknown): { cron: string } | null {
  if (schedule === undefined || schedule === null) return null;
  if (typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw fail('schedule must be null or { cron }');
  }
  const cron = asRecord(schedule).cron;
  if (typeof cron !== 'string' || !cron.trim()) throw fail('schedule.cron is required');
  try {
    parseCron(cron);
  } catch (error) {
    throw fail(`Invalid schedule: ${errorMessage(error)}`);
  }
  return { cron: cron.trim() };
}

function validateEnum<T extends string, F>(value: unknown, field: string, allowed: readonly T[], fallback: F): T | F {
  if (value === undefined || value === null) return fallback;
  if (!includes(allowed, value)) throw fail(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

function validatePrompt(prompt: unknown): string {
  if (typeof prompt !== 'string' || !prompt.trim()) throw fail('prompt is required');
  if (prompt.length > MAX_PROMPT) throw fail(`prompt must be at most ${MAX_PROMPT} characters`);
  return prompt;
}

function validateMinInterval(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw fail('minIntervalSec must be an integer >= 0');
  }
  return value;
}

function validateHarness(harness: unknown): string {
  const id = harness === undefined || harness === null ? 'pi' : harness;
  if (typeof id !== 'string' || !getHarness(id)) throw fail(`Unknown harness: ${id}`);
  return id;
}

export function createRoutine(input: unknown = {}): Routine {
  const body = asRecord(input);
  const stored = storedRoutines();
  const routines = parseRoutines(stored);
  const id = crypto.randomUUID();
  const name = validateName(body.name, routines, id);
  const prompt = validatePrompt(body.prompt);
  const now = Date.now();
  const routine: Routine = {
    id,
    name,
    description: validateOptionalString(body.description, 'description', MAX_DESCRIPTION),
    harness: validateHarness(body.harness),
    cwd: validateCwd(body.cwd),
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
    thinking: validateEnum(body.thinking, 'thinking', THINKING_LEVELS, undefined),
    prompt,
    promptVersion: 1,
    versions: [{ version: 1, prompt, savedAt: now }],
    schedule: validateSchedule(body.schedule),
    enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    mode: validateEnum(body.mode, 'mode', MODES, 'oneShot'),
    onBusy: validateEnum(body.onBusy, 'onBusy', ON_BUSY, 'skip'),
    minIntervalSec: validateMinInterval(body.minIntervalSec),
    lastScheduledMinute: null,
    createdAt: now,
    updatedAt: now,
  };
  saveRoutine(stored, routine, null);
  return routine;
}

/** Only changed prompt text appends a version; ordinary edits do not. */
export function updateRoutine(ref: string, patch: unknown = {}): Routine | null {
  const stored = storedRoutines();
  const routines = parseRoutines(stored);
  const existing = lookupRoutine(routines, ref);
  if (!existing) return null;
  const body = asRecord(patch);
  const routine: Routine = { ...existing };

  if (body.name !== undefined) routine.name = validateName(body.name, routines, routine.id);
  if (body.description !== undefined) {
    routine.description = validateOptionalString(body.description, 'description', MAX_DESCRIPTION);
  }
  if (body.harness !== undefined) routine.harness = validateHarness(body.harness);
  if (body.cwd !== undefined) routine.cwd = validateCwd(body.cwd);
  if (body.model !== undefined) {
    if (body.model === null || body.model === '') routine.model = undefined;
    else if (typeof body.model !== 'string') throw fail('model must be a string');
    else routine.model = body.model.trim() || undefined;
  }
  if (body.thinking !== undefined) {
    routine.thinking = body.thinking === null || body.thinking === ''
      ? undefined : validateEnum(body.thinking, 'thinking', THINKING_LEVELS, undefined);
  }
  if (body.schedule !== undefined) routine.schedule = validateSchedule(body.schedule);
  if (body.enabled !== undefined) routine.enabled = Boolean(body.enabled);
  if (body.mode !== undefined) routine.mode = validateEnum(body.mode, 'mode', MODES, routine.mode);
  if (body.onBusy !== undefined) routine.onBusy = validateEnum(body.onBusy, 'onBusy', ON_BUSY, routine.onBusy);
  if (body.minIntervalSec !== undefined) routine.minIntervalSec = validateMinInterval(body.minIntervalSec);

  const now = Date.now();
  if (body.prompt !== undefined) {
    const prompt = validatePrompt(body.prompt);
    if (prompt !== routine.prompt) {
      routine.prompt = prompt;
      routine.promptVersion += 1;
      routine.versions = [...routine.versions, { version: routine.promptVersion, prompt, savedAt: now }]
        .slice(-MAX_VERSIONS);
    }
  }
  routine.updatedAt = now;
  saveRoutine(stored, routine, existing);
  return routine;
}

export function deleteRoutine(ref: string): Routine | null {
  const stored = storedRoutines();
  const existing = lookupRoutine(parseRoutines(stored), ref);
  if (!existing) return null;
  delete stored[existing.id];
  writeStore(ROUTINES_FILE, { version: 1, routines: stored });
  return existing;
}

/** Persist the fired minute to prevent double-firing after a same-minute restart. */
export function markScheduled(id: string, minuteMs: number): Routine | null {
  const stored = storedRoutines();
  const existing = parseRoutine(id, stored[id]);
  if (!existing) return null;
  const routine: Routine = { ...existing, lastScheduledMinute: minuteMs };
  saveRoutine(stored, routine, existing);
  return routine;
}

function parseInvocation(value: unknown): RoutineInvocation | null {
  const row = asRecord(value);
  if (typeof row.id !== 'string' || !includes(STATUSES, row.status)) return null;
  return {
    id: row.id,
    routineId: stringOr(row.routineId, ''),
    routineName: stringOr(row.routineName, ''),
    version: numberOr(row.version, 1),
    trigger: row.trigger === 'schedule' ? 'schedule' : 'invoke',
    source: typeof row.source === 'string' ? row.source : null,
    delivery: includes(DELIVERIES, row.delivery) ? row.delivery : 'prompt',
    status: row.status,
    skipReason: typeof row.skipReason === 'string' ? row.skipReason : null,
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : null,
    startedAt: numberOr(row.startedAt, 0),
    endedAt: typeof row.endedAt === 'number' ? row.endedAt : null,
    durationMs: typeof row.durationMs === 'number' ? row.durationMs : null,
    error: typeof row.error === 'string' ? row.error : null,
    input: row.input === undefined ? null : row.input,
    summary: typeof row.summary === 'string' ? row.summary : null,
    closed: row.closed === true,
    closeError: typeof row.closeError === 'string' ? row.closeError : null,
  };
}

function storedInvocations(): unknown[] {
  const stored = readStore(INVOCATIONS_FILE).invocations;
  return Array.isArray(stored) ? stored : [];
}

export function readInvocations(): RoutineInvocation[] {
  return storedInvocations().flatMap((row) => {
    const invocation = parseInvocation(row);
    return invocation ? [invocation] : [];
  });
}

function writeInvocations(rows: unknown[]): void {
  writeStore(INVOCATIONS_FILE, { version: 1, invocations: rows.slice(0, MAX_INVOCATIONS) });
}

/** UTF-8 size of the JSON form callers persist; null and undefined are empty. */
export function inputBytes(input: unknown): number {
  if (input === undefined || input === null) return 0;
  return Buffer.byteLength(JSON.stringify(input)!, 'utf8');
}

export function createInvocation({
  routine,
  status,
  trigger = 'invoke',
  source = null,
  input = null,
  delivery = 'prompt',
  skipReason = null,
  sessionId = null,
  startedAt = Date.now(),
  error = null,
}: NewInvocation): RoutineInvocation {
  if (inputBytes(input) > MAX_INPUT_BYTES) {
    throw fail(`input must serialize to at most ${MAX_INPUT_BYTES} bytes`, 413);
  }
  const terminal = status === 'skipped';
  const invocation: RoutineInvocation = {
    id: crypto.randomUUID(),
    routineId: routine.id,
    // Denormalized: the ledger outlives the routine it came from.
    routineName: routine.name,
    version: routine.promptVersion || 1,
    trigger,
    source: source || null,
    delivery,
    status,
    skipReason: skipReason || null,
    sessionId: sessionId || null,
    startedAt,
    endedAt: terminal ? startedAt : null,
    durationMs: terminal ? 0 : null,
    error: error || null,
    input,
    summary: null,
    closed: false,
    closeError: null,
  };
  writeInvocations([invocation, ...storedInvocations()]);
  return invocation;
}

/** Read-modify-write of one entry. Every status change hits disk. */
export function updateInvocation(id: string, patch: InvocationPatch): RoutineInvocation | null {
  const rows = storedInvocations();
  for (const [index, row] of rows.entries()) {
    const current = parseInvocation(row);
    if (current?.id !== id) continue;
    const updated: RoutineInvocation = { ...current, ...patch };
    if (updated.endedAt && !Number.isFinite(updated.durationMs)) {
      updated.durationMs = Math.max(0, updated.endedAt - (updated.startedAt || 0));
    }
    rows[index] = changedFields(row, updated, current);
    writeInvocations(rows);
    return updated;
  }
  return null;
}

export function getInvocation(id: string): RoutineInvocation | null {
  return readInvocations().find((entry) => entry.id === id) || null;
}

/** Newest first; before is an exclusive startedAt cursor. */
export function listInvocations({ routineId = null, limit = 50, before = null }: ListInvocationOptions = {}): RoutineInvocation[] {
  let list = readInvocations();
  if (routineId) list = list.filter((entry) => entry.routineId === routineId);
  if (before !== null && Number.isFinite(before)) list = list.filter((entry) => entry.startedAt < before);
  return list.slice(0, Math.max(1, limit));
}

export function countInvocations(routineId: string): number {
  return readInvocations().filter((entry) => entry.routineId === routineId).length;
}

export function lastInvocation(
  routineId: string,
  predicate: ((entry: RoutineInvocation) => boolean) | null = null,
): RoutineInvocation | null {
  return readInvocations().find((entry) =>
    entry.routineId === routineId && (!predicate || predicate(entry))) || null;
}

/** The invocation currently occupying the routine, if any (busy := this). */
export function activeInvocation(routineId: string): RoutineInvocation | null {
  return lastInvocation(routineId, (entry) => includes(ACTIVE_STATUSES, entry.status));
}

export function activeInvocations(): RoutineInvocation[] {
  return readInvocations().filter((entry) => includes(ACTIVE_STATUSES, entry.status));
}

/** Latest invocation per session id; presentation-only provenance, never authority. */
export function invocationsBySessionId(): Map<string, RoutineInvocation> {
  const bySession = new Map<string, RoutineInvocation>();
  for (const entry of readInvocations()) { // newest first, so the first wins
    if (entry.sessionId && !bySession.has(entry.sessionId)) bySession.set(entry.sessionId, entry);
  }
  return bySession;
}
