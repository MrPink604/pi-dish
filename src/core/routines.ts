/**
 * Routines own definitions, prompt versions and the thin invocation ledger, not
 * sessions or their histories. Both stores are re-read per call and are advisory:
 * deleting a definition never removes its invocation history or running session.
 */
import crypto = require('crypto');
import { readStore, writeStore } from './dish-store';
import { getHarness } from './harnesses';
import { parseCron } from './cron';

export type RoutineMode = 'oneShot' | 'continue';
export type RoutineDelivery = 'prompt' | 'steer' | 'followUp';
export type RoutineStatus = 'starting' | 'running' | 'completed' | 'errored' | 'interrupted' | 'skipped';
export type RoutineThinking = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RoutineOnBusy = 'skip' | 'steer' | 'followUp';

/** Persisted rows establish only id; other fields and extra keys remain untrusted. */
export interface Routine extends Record<string, unknown> {
  id: string;
  name?: unknown;
  description?: unknown;
  harness?: unknown;
  cwd?: unknown;
  model?: unknown;
  thinking?: unknown;
  prompt?: unknown;
  promptVersion?: unknown;
  versions?: unknown;
  schedule?: unknown;
  enabled?: unknown;
  mode?: unknown;
  onBusy?: unknown;
  minIntervalSec?: unknown;
  lastScheduledMinute?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RoutineInvocation extends Record<string, unknown> {
  id: string;
  routineId?: unknown;
  routineName?: unknown;
  version?: unknown;
  trigger?: unknown;
  source?: unknown;
  delivery?: unknown;
  status?: unknown;
  skipReason?: unknown;
  sessionId?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  durationMs?: unknown;
  error?: unknown;
  input?: unknown;
  summary?: unknown;
  closed?: unknown;
  closeError?: unknown;
}

const ROUTINES_FILE = 'routines.json';
const INVOCATIONS_FILE = 'routine-invocations.json';

export const MAX_INVOCATIONS = 5000;
export const MAX_VERSIONS = 50;
export const MAX_PROMPT = 100000;
const MAX_DESCRIPTION = 500;
export const MAX_SOURCE = 100;
export const MAX_INPUT_BYTES = 32 * 1024;
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const THINKING_LEVELS: RoutineThinking[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const MODES: RoutineMode[] = ['oneShot', 'continue'];
export const ON_BUSY: RoutineOnBusy[] = ['skip', 'steer', 'followUp'];
export const DELIVERIES: RoutineDelivery[] = ['prompt', 'steer', 'followUp'];
export const STATUSES: RoutineStatus[] = ['starting', 'running', 'completed', 'errored', 'interrupted', 'skipped'];
const ACTIVE_STATUSES: RoutineStatus[] = ['starting', 'running'];

function fail(message: string, status = 400): Error & { status: number } {
  const error = new Error(message);
  return Object.assign(error, { status });
}

/** Property access, not a schema: retain primitive boxing and nullish failures. */
function property(value: unknown, key: string): unknown {
  if (value === null || value === undefined) throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`);
  return Reflect.get(Object(value), key);
}

function includes<T>(allowed: readonly T[], value: unknown): value is T {
  const values: readonly unknown[] = allowed;
  return values.includes(value);
}

function isRoutine(value: unknown, id: string): value is Routine {
  return !!value && typeof value === 'object' && property(value, 'id') === id;
}

function isInvocation(value: unknown): value is RoutineInvocation {
  return !!value && typeof value === 'object' && typeof property(value, 'id') === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export function readRoutines(): Record<string, Routine> {
  const raw = readStore(ROUTINES_FILE);
  const source = raw.routines && typeof raw.routines === 'object' && !Array.isArray(raw.routines)
    ? raw.routines : {};
  const routines: Record<string, Routine> = {};
  const entries: [string, unknown][] = Object.entries(source);
  for (const [id, value] of entries) {
    if (isRoutine(value, id)) routines[id] = value;
  }
  return routines;
}

function writeRoutines(routines: Record<string, Routine>): void {
  writeStore(ROUTINES_FILE, { version: 1, routines });
}

export function listRoutines(): Routine[] {
  return Object.values(readRoutines())
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Routines are addressed by uuid or by their (case-insensitive) unique name. */
export function getRoutine(ref: unknown): Routine | null {
  if (typeof ref !== 'string' || !ref) return null;
  const routines = readRoutines();
  if (routines[ref]) return routines[ref];
  const wanted = ref.toLowerCase();
  return Object.values(routines).find((routine) => String(routine.name).toLowerCase() === wanted) || null;
}

function validateName(name: unknown, routines: Record<string, Routine>, selfId: unknown): asserts name is string {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw fail('name must be lowercase letters, digits and dashes (1-48 chars, starting alphanumeric)');
  }
  const clash = Object.values(routines).find((routine) =>
    routine.id !== selfId && String(routine.name).toLowerCase() === name.toLowerCase());
  if (clash) throw fail(`A routine named "${clash.name}" already exists`, 409);
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
  const cron = property(schedule, 'cron');
  if (typeof cron !== 'string' || !cron.trim()) throw fail('schedule.cron is required');
  try {
    parseCron(cron);
  } catch (error) {
    throw fail(`Invalid schedule: ${property(error, 'message')}`);
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
  // Number.isInteger establishes the numeric operand; the assertion changes no coercion.
  if (!Number.isInteger(value) || (value as number) < 0) throw fail('minIntervalSec must be an integer >= 0');
  return value as number;
}

function validateHarness(harness: unknown): unknown {
  const id = harness === undefined || harness === null ? 'pi' : harness;
  if (!getHarness(id)) throw fail(`Unknown harness: ${id}`);
  return id;
}

export function createRoutine(input: unknown = {}): Routine {
  const routines = readRoutines();
  const id = crypto.randomUUID();
  validateName(property(input, 'name'), routines, id);
  const now = Date.now();
  const prompt = validatePrompt(property(input, 'prompt'));
  const routine: Routine = {
    id,
    name: property(input, 'name'),
    description: validateOptionalString(property(input, 'description'), 'description', MAX_DESCRIPTION),
    harness: validateHarness(property(input, 'harness')),
    cwd: validateCwd(property(input, 'cwd')),
    // Repeated reads preserve getter behavior as well as the original validation order.
    model: typeof property(input, 'model') === 'string' && (property(input, 'model') as string).trim()
      ? (property(input, 'model') as string).trim() : undefined,
    thinking: validateEnum(property(input, 'thinking'), 'thinking', THINKING_LEVELS, undefined),
    prompt,
    promptVersion: 1,
    versions: [{ version: 1, prompt, savedAt: now }],
    schedule: validateSchedule(property(input, 'schedule')),
    enabled: property(input, 'enabled') === undefined ? true : !!property(input, 'enabled'),
    mode: validateEnum(property(input, 'mode'), 'mode', MODES, 'oneShot'),
    onBusy: validateEnum(property(input, 'onBusy'), 'onBusy', ON_BUSY, 'skip'),
    minIntervalSec: validateMinInterval(property(input, 'minIntervalSec')),
    lastScheduledMinute: null,
    createdAt: now,
    updatedAt: now,
  };
  routines[id] = routine;
  writeRoutines(routines);
  return routine;
}

/** Only changed prompt text appends a version; ordinary edits do not. */
export function updateRoutine(ref: unknown, patch: unknown = {}): Routine | null {
  const routines = readRoutines();
  const existing = getRoutine(ref);
  if (!existing) return null;
  const routine = { ...routines[existing.id] };

  if (property(patch, 'name') !== undefined) {
    validateName(property(patch, 'name'), routines, routine.id);
    routine.name = property(patch, 'name');
  }
  if (property(patch, 'description') !== undefined) {
    routine.description = validateOptionalString(property(patch, 'description'), 'description', MAX_DESCRIPTION);
  }
  if (property(patch, 'harness') !== undefined) routine.harness = validateHarness(property(patch, 'harness'));
  if (property(patch, 'cwd') !== undefined) routine.cwd = validateCwd(property(patch, 'cwd'));
  if (property(patch, 'model') !== undefined) {
    if (property(patch, 'model') === null || property(patch, 'model') === '') routine.model = undefined;
    else if (typeof property(patch, 'model') !== 'string') throw fail('model must be a string');
    else routine.model = (property(patch, 'model') as string).trim() || undefined;
  }
  if (property(patch, 'thinking') !== undefined) {
    routine.thinking = property(patch, 'thinking') === null || property(patch, 'thinking') === ''
      ? undefined : validateEnum(property(patch, 'thinking'), 'thinking', THINKING_LEVELS, undefined);
  }
  if (property(patch, 'schedule') !== undefined) routine.schedule = validateSchedule(property(patch, 'schedule'));
  if (property(patch, 'enabled') !== undefined) routine.enabled = !!property(patch, 'enabled');
  if (property(patch, 'mode') !== undefined) routine.mode = validateEnum(property(patch, 'mode'), 'mode', MODES, routine.mode);
  if (property(patch, 'onBusy') !== undefined) routine.onBusy = validateEnum(property(patch, 'onBusy'), 'onBusy', ON_BUSY, routine.onBusy);
  if (property(patch, 'minIntervalSec') !== undefined) routine.minIntervalSec = validateMinInterval(property(patch, 'minIntervalSec'));

  const now = Date.now();
  if (property(patch, 'prompt') !== undefined) {
    const prompt = validatePrompt(property(patch, 'prompt'));
    if (prompt !== routine.prompt) {
      routine.prompt = prompt;
      // Operand-only assertions preserve native + and iteration: a saved string
      // version concatenates, and a truthy non-iterable versions value still throws.
      routine.promptVersion = ((routine.promptVersion || 1) as number) + 1;
      // Trim from the front; the current version always remains in the history.
      routine.versions = [...((routine.versions || []) as Iterable<unknown>), { version: routine.promptVersion, prompt, savedAt: now }]
        .slice(-MAX_VERSIONS);
    }
  }
  routine.updatedAt = now;
  routines[routine.id] = routine;
  writeRoutines(routines);
  return routine;
}

export function deleteRoutine(ref: unknown): Routine | null {
  const existing = getRoutine(ref);
  if (!existing) return null;
  const routines = readRoutines();
  delete routines[existing.id];
  writeRoutines(routines);
  return existing;
}

/** Persist the fired minute to prevent double-firing after a same-minute restart. */
export function markScheduled(id: unknown, minuteMs: unknown): Routine | null {
  const routines = readRoutines();
  // Index-only assertions retain the original repeated ToPropertyKey coercions.
  if (!routines[id as string]) return null;
  routines[id as string] = { ...routines[id as string], lastScheduledMinute: minuteMs };
  writeRoutines(routines);
  return routines[id as string];
}

// ---------------------------------------------------------------------------
// Invocation ledger
// ---------------------------------------------------------------------------

export function readInvocations(): RoutineInvocation[] {
  const raw = readStore(INVOCATIONS_FILE);
  const list: unknown[] = Array.isArray(raw.invocations) ? raw.invocations : [];
  return list.filter(isInvocation);
}

function writeInvocations(invocations: RoutineInvocation[]): void {
  writeStore(INVOCATIONS_FILE, { version: 1, invocations: invocations.slice(0, MAX_INVOCATIONS) });
}

export function serializedInputSize(input: unknown): number {
  if (input === undefined || input === null) return 0;
  // JSON.stringify may return undefined; retain Buffer.byteLength's native failure.
  return Buffer.byteLength(JSON.stringify(input), 'utf8');
}

export function createInvocation(fields: unknown = {}): RoutineInvocation {
  const routine = property(fields, 'routine');
  if (!routine) throw fail('routine is required');
  if (!includes(STATUSES, property(fields, 'status'))) throw fail(`status must be one of: ${STATUSES.join(', ')}`);
  const source = property(fields, 'source') == null ? null : validateOptionalString(property(fields, 'source'), 'source', MAX_SOURCE) || null;
  const input = property(fields, 'input') === undefined ? null : property(fields, 'input');
  if (serializedInputSize(input) > MAX_INPUT_BYTES) {
    throw fail(`input must serialize to at most ${MAX_INPUT_BYTES} bytes`, 413);
  }
  const startedAt = Number.isFinite(property(fields, 'startedAt')) ? property(fields, 'startedAt') : Date.now();
  const terminal = property(fields, 'status') === 'skipped';
  const invocation: RoutineInvocation = {
    id: crypto.randomUUID(),
    routineId: property(routine, 'id'),
    // Denormalized: the ledger outlives the routine it came from.
    routineName: property(routine, 'name'),
    version: property(routine, 'promptVersion') || 1,
    trigger: property(fields, 'trigger') === 'schedule' ? 'schedule' : 'invoke',
    source,
    delivery: includes(DELIVERIES, property(fields, 'delivery')) ? property(fields, 'delivery') : 'prompt',
    status: property(fields, 'status'),
    skipReason: property(fields, 'skipReason') || null,
    sessionId: property(fields, 'sessionId') || null,
    startedAt,
    endedAt: terminal ? startedAt : null,
    durationMs: terminal ? 0 : null,
    error: property(fields, 'error') || null,
    input,
    summary: null,
    closed: false,
    closeError: null,
  };
  writeInvocations([invocation, ...readInvocations()]);
  return invocation;
}

const MUTABLE_FIELDS: Readonly<Record<string, true>> = {
  status: true, sessionId: true, endedAt: true, durationMs: true, error: true,
  summary: true, closed: true, closeError: true, delivery: true, skipReason: true,
};

/** Read-modify-write of one entry. Every status change hits disk. */
export function updateInvocation(id: unknown, patch: unknown = {}): RoutineInvocation | null {
  const invocations = readInvocations();
  const index = invocations.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  const updated: RoutineInvocation = { ...invocations[index] };
  // Object.entries itself owns primitive boxing and nullish failure behavior.
  const entries: [string, unknown][] = Object.entries(patch as object);
  for (const [key, value] of entries) {
    if (Object.hasOwn(MUTABLE_FIELDS, key)) updated[key] = value;
  }
  if (updated.endedAt && !Number.isFinite(updated.durationMs)) {
    // Preserve native subtraction coercions (including bigint/Symbol failures).
    updated.durationMs = Math.max(0, (updated.endedAt as number) - (updated.startedAt as number));
  }
  invocations[index] = updated;
  writeInvocations(invocations);
  return updated;
}

export function getInvocation(id: unknown): RoutineInvocation | null {
  return readInvocations().find((entry) => entry.id === id) || null;
}

/** Newest first; before is an exclusive startedAt cursor. */
export function listInvocations(options: unknown = {}): RoutineInvocation[] {
  const rawRoutineId = property(options, 'routineId');
  const routineId = rawRoutineId === undefined ? null : rawRoutineId;
  const rawLimit = property(options, 'limit');
  const limit = rawLimit === undefined ? 50 : rawLimit;
  const rawBefore = property(options, 'before');
  const before = rawBefore === undefined ? null : rawBefore;
  let list = readInvocations();
  if (routineId) list = list.filter((entry) => entry.routineId === routineId);
  // These assertions apply only to the operators, never to persisted row shapes.
  if (isFiniteNumber(before)) list = list.filter((entry) => (entry.startedAt as number) < before);
  return list.slice(0, Math.max(1, limit as number));
}

export function countInvocations(routineId: unknown): number {
  return readInvocations().filter((entry) => entry.routineId === routineId).length;
}

export function lastInvocation(routineId: unknown, predicate: ((entry: RoutineInvocation) => unknown) | null = null): RoutineInvocation | null {
  return readInvocations().find((entry) =>
    entry.routineId === routineId && (!predicate || predicate(entry))) || null;
}

/** The invocation currently occupying the routine, if any (busy := this). */
export function activeInvocation(routineId: unknown): RoutineInvocation | null {
  return lastInvocation(routineId, (entry) => includes(ACTIVE_STATUSES, entry.status));
}

export function activeInvocations(): RoutineInvocation[] {
  return readInvocations().filter((entry) => includes(ACTIVE_STATUSES, entry.status));
}

export function countActive(routineId: unknown): number {
  return readInvocations()
    .filter((entry) => entry.routineId === routineId && includes(ACTIVE_STATUSES, entry.status)).length;
}

/** Latest invocation per session id; presentation-only provenance, never authority. */
export function invocationsBySessionId(): Map<unknown, RoutineInvocation> {
  const bySession = new Map<unknown, RoutineInvocation>();
  for (const entry of readInvocations()) { // newest first, so the first wins
    if (entry.sessionId && !bySession.has(entry.sessionId)) bySession.set(entry.sessionId, entry);
  }
  return bySession;
}

/** Existing module surface, shared by consumers without a factory-derived port. */
export interface RoutineStore {
  readRoutines: typeof readRoutines;
  listRoutines: typeof listRoutines;
  getRoutine: typeof getRoutine;
  createRoutine: typeof createRoutine;
  updateRoutine: typeof updateRoutine;
  deleteRoutine: typeof deleteRoutine;
  markScheduled: typeof markScheduled;
  readInvocations: typeof readInvocations;
  createInvocation: typeof createInvocation;
  updateInvocation: typeof updateInvocation;
  getInvocation: typeof getInvocation;
  listInvocations: typeof listInvocations;
  countInvocations: typeof countInvocations;
  lastInvocation: typeof lastInvocation;
  activeInvocation: typeof activeInvocation;
  activeInvocations: typeof activeInvocations;
  countActive: typeof countActive;
  invocationsBySessionId: typeof invocationsBySessionId;
  serializedInputSize: typeof serializedInputSize;
  MAX_INVOCATIONS: typeof MAX_INVOCATIONS;
  MAX_VERSIONS: typeof MAX_VERSIONS;
  MAX_PROMPT: typeof MAX_PROMPT;
  MAX_INPUT_BYTES: typeof MAX_INPUT_BYTES;
  MAX_SOURCE: typeof MAX_SOURCE;
  THINKING_LEVELS: typeof THINKING_LEVELS;
  MODES: typeof MODES;
  ON_BUSY: typeof ON_BUSY;
  DELIVERIES: typeof DELIVERIES;
  STATUSES: typeof STATUSES;
  NAME_RE: typeof NAME_RE;
}
