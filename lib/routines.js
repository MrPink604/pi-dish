'use strict';

/**
 * Routines: named, reusable session launch specs plus the ledger of the runs
 * they produced.
 *
 * A routine is a session *template* and an invocation is a session, so there
 * is no second history system here — transcript, cost and duration all come
 * from the session index. This module owns only the definition, the prompt's
 * version history, and the thin record linking one to the other.
 *
 * Storage follows lib/dish-store.js exactly as shares/pages/comments do:
 * re-read per call (so a test HOME works and an external edit is picked up),
 * temp-file + rename on write. Neither file is control authority — losing
 * them loses definitions and audit trail, never a running session.
 */

const crypto = require('crypto');
const { readStore, writeStore } = require('./dish-store');
const { getHarness } = require('./harnesses');
const { parseCron } = require('./cron');

const ROUTINES_FILE = 'routines.json';
const INVOCATIONS_FILE = 'routine-invocations.json';

const MAX_INVOCATIONS = 5000;
const MAX_VERSIONS = 50;
const MAX_PROMPT = 100000;
const MAX_DESCRIPTION = 500;
const MAX_SOURCE = 100;
const MAX_INPUT_BYTES = 32 * 1024;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const MODES = ['oneShot', 'continue'];
const ON_BUSY = ['skip', 'steer', 'followUp'];
const DELIVERIES = ['prompt', 'steer', 'followUp'];
const STATUSES = ['starting', 'running', 'completed', 'errored', 'interrupted', 'skipped'];
const ACTIVE_STATUSES = ['starting', 'running'];

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

function readRoutines() {
  const raw = readStore(ROUTINES_FILE);
  const source = raw.routines && typeof raw.routines === 'object' && !Array.isArray(raw.routines)
    ? raw.routines : {};
  const routines = {};
  for (const [id, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && value.id === id) routines[id] = value;
  }
  return routines;
}

function writeRoutines(routines) {
  writeStore(ROUTINES_FILE, { version: 1, routines });
}

function listRoutines() {
  return Object.values(readRoutines())
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Routines are addressed by uuid or by their (case-insensitive) unique name. */
function getRoutine(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  const routines = readRoutines();
  if (routines[ref]) return routines[ref];
  const wanted = ref.toLowerCase();
  return Object.values(routines).find((routine) => String(routine.name).toLowerCase() === wanted) || null;
}

function validateName(name, routines, selfId) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw fail('name must be lowercase letters, digits and dashes (1-48 chars, starting alphanumeric)');
  }
  const clash = Object.values(routines).find((routine) =>
    routine.id !== selfId && String(routine.name).toLowerCase() === name.toLowerCase());
  if (clash) throw fail(`A routine named "${clash.name}" already exists`, 409);
}

function validateOptionalString(value, field, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw fail(`${field} must be a string`);
  if (value.length > max) throw fail(`${field} must be at most ${max} characters`);
  return value;
}

function validateCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) throw fail('cwd is required');
  const trimmed = cwd.trim();
  if (!trimmed.startsWith('/') && !trimmed.startsWith('~')) {
    throw fail('cwd must be an absolute path or start with ~');
  }
  return trimmed;
}

function validateSchedule(schedule) {
  if (schedule === undefined || schedule === null) return null;
  if (typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw fail('schedule must be null or { cron }');
  }
  const cron = schedule.cron;
  if (typeof cron !== 'string' || !cron.trim()) throw fail('schedule.cron is required');
  try {
    parseCron(cron);
  } catch (error) {
    throw fail(`Invalid schedule: ${error.message}`);
  }
  return { cron: cron.trim() };
}

function validateEnum(value, field, allowed, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!allowed.includes(value)) throw fail(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

function validatePrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw fail('prompt is required');
  if (prompt.length > MAX_PROMPT) throw fail(`prompt must be at most ${MAX_PROMPT} characters`);
  return prompt;
}

function validateMinInterval(value) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0) throw fail('minIntervalSec must be an integer >= 0');
  return value;
}

function validateHarness(harness) {
  const id = harness === undefined || harness === null ? 'pi' : harness;
  if (!getHarness(id)) throw fail(`Unknown harness: ${id}`);
  return id;
}

function createRoutine(input = {}) {
  const routines = readRoutines();
  const id = crypto.randomUUID();
  validateName(input.name, routines, id);
  const now = Date.now();
  const prompt = validatePrompt(input.prompt);
  const routine = {
    id,
    name: input.name,
    description: validateOptionalString(input.description, 'description', MAX_DESCRIPTION),
    harness: validateHarness(input.harness),
    cwd: validateCwd(input.cwd),
    model: typeof input.model === 'string' && input.model.trim() ? input.model.trim() : undefined,
    thinking: validateEnum(input.thinking, 'thinking', THINKING_LEVELS, undefined),
    prompt,
    promptVersion: 1,
    versions: [{ version: 1, prompt, savedAt: now }],
    schedule: validateSchedule(input.schedule),
    enabled: input.enabled === undefined ? true : !!input.enabled,
    mode: validateEnum(input.mode, 'mode', MODES, 'oneShot'),
    onBusy: validateEnum(input.onBusy, 'onBusy', ON_BUSY, 'skip'),
    minIntervalSec: validateMinInterval(input.minIntervalSec),
    lastScheduledMinute: null,
    createdAt: now,
    updatedAt: now,
  };
  routines[id] = routine;
  writeRoutines(routines);
  return routine;
}

/**
 * Partial update. A changed prompt appends a version and bumps
 * `promptVersion`; nothing else does, so the version history stays a record of
 * what the model was actually asked, not of every checkbox toggle.
 */
function updateRoutine(ref, patch = {}) {
  const routines = readRoutines();
  const existing = getRoutine(ref);
  if (!existing) return null;
  const routine = { ...routines[existing.id] };

  if (patch.name !== undefined) {
    validateName(patch.name, routines, routine.id);
    routine.name = patch.name;
  }
  if (patch.description !== undefined) {
    routine.description = validateOptionalString(patch.description, 'description', MAX_DESCRIPTION);
  }
  if (patch.harness !== undefined) routine.harness = validateHarness(patch.harness);
  if (patch.cwd !== undefined) routine.cwd = validateCwd(patch.cwd);
  if (patch.model !== undefined) {
    if (patch.model === null || patch.model === '') routine.model = undefined;
    else if (typeof patch.model !== 'string') throw fail('model must be a string');
    else routine.model = patch.model.trim() || undefined;
  }
  if (patch.thinking !== undefined) {
    routine.thinking = patch.thinking === null || patch.thinking === ''
      ? undefined : validateEnum(patch.thinking, 'thinking', THINKING_LEVELS, undefined);
  }
  if (patch.schedule !== undefined) routine.schedule = validateSchedule(patch.schedule);
  if (patch.enabled !== undefined) routine.enabled = !!patch.enabled;
  if (patch.mode !== undefined) routine.mode = validateEnum(patch.mode, 'mode', MODES, routine.mode);
  if (patch.onBusy !== undefined) routine.onBusy = validateEnum(patch.onBusy, 'onBusy', ON_BUSY, routine.onBusy);
  if (patch.minIntervalSec !== undefined) routine.minIntervalSec = validateMinInterval(patch.minIntervalSec);

  const now = Date.now();
  if (patch.prompt !== undefined) {
    const prompt = validatePrompt(patch.prompt);
    if (prompt !== routine.prompt) {
      routine.prompt = prompt;
      routine.promptVersion = (routine.promptVersion || 1) + 1;
      // Trim from the front: the current version is the last entry, so the
      // cap can never drop what the routine would run right now.
      routine.versions = [...(routine.versions || []), { version: routine.promptVersion, prompt, savedAt: now }]
        .slice(-MAX_VERSIONS);
    }
  }
  routine.updatedAt = now;
  routines[routine.id] = routine;
  writeRoutines(routines);
  return routine;
}

function deleteRoutine(ref) {
  const existing = getRoutine(ref);
  if (!existing) return null;
  const routines = readRoutines();
  delete routines[existing.id];
  writeRoutines(routines);
  return existing;
}

/**
 * Remember the minute a scheduled fire happened, so a restart inside that same
 * minute cannot double-fire. Persisted on the routine rather than in memory
 * for exactly that reason.
 */
function markScheduled(id, minuteMs) {
  const routines = readRoutines();
  if (!routines[id]) return null;
  routines[id] = { ...routines[id], lastScheduledMinute: minuteMs };
  writeRoutines(routines);
  return routines[id];
}

// ---------------------------------------------------------------------------
// Invocation ledger
// ---------------------------------------------------------------------------

function readInvocations() {
  const raw = readStore(INVOCATIONS_FILE);
  const list = Array.isArray(raw.invocations) ? raw.invocations : [];
  return list.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string');
}

function writeInvocations(invocations) {
  writeStore(INVOCATIONS_FILE, { version: 1, invocations: invocations.slice(0, MAX_INVOCATIONS) });
}

function serializedInputSize(input) {
  if (input === undefined || input === null) return 0;
  return Buffer.byteLength(JSON.stringify(input), 'utf8');
}

function createInvocation(fields = {}) {
  const routine = fields.routine;
  if (!routine) throw fail('routine is required');
  if (!STATUSES.includes(fields.status)) throw fail(`status must be one of: ${STATUSES.join(', ')}`);
  const source = fields.source == null ? null : validateOptionalString(fields.source, 'source', MAX_SOURCE) || null;
  const input = fields.input === undefined ? null : fields.input;
  if (serializedInputSize(input) > MAX_INPUT_BYTES) {
    throw fail(`input must serialize to at most ${MAX_INPUT_BYTES} bytes`, 413);
  }
  const startedAt = Number.isFinite(fields.startedAt) ? fields.startedAt : Date.now();
  const terminal = fields.status === 'skipped';
  const invocation = {
    id: crypto.randomUUID(),
    routineId: routine.id,
    // Denormalized: the ledger outlives the routine it came from.
    routineName: routine.name,
    version: routine.promptVersion || 1,
    trigger: fields.trigger === 'schedule' ? 'schedule' : 'invoke',
    source,
    delivery: DELIVERIES.includes(fields.delivery) ? fields.delivery : 'prompt',
    status: fields.status,
    skipReason: fields.skipReason || null,
    sessionId: fields.sessionId || null,
    startedAt,
    endedAt: terminal ? startedAt : null,
    durationMs: terminal ? 0 : null,
    error: fields.error || null,
    input,
    summary: null,
    closed: false,
    closeError: null,
  };
  writeInvocations([invocation, ...readInvocations()]);
  return invocation;
}

const MUTABLE_FIELDS = new Set([
  'status', 'sessionId', 'endedAt', 'durationMs', 'error', 'summary', 'closed', 'closeError',
  'delivery', 'skipReason',
]);

/** Read-modify-write of one entry. Every status change hits disk. */
function updateInvocation(id, patch = {}) {
  const invocations = readInvocations();
  const index = invocations.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  const updated = { ...invocations[index] };
  for (const [key, value] of Object.entries(patch)) {
    if (MUTABLE_FIELDS.has(key)) updated[key] = value;
  }
  if (updated.endedAt && !Number.isFinite(updated.durationMs)) {
    updated.durationMs = Math.max(0, updated.endedAt - updated.startedAt);
  }
  invocations[index] = updated;
  writeInvocations(invocations);
  return updated;
}

function getInvocation(id) {
  return readInvocations().find((entry) => entry.id === id) || null;
}

/** Newest first; `before` is an exclusive `startedAt` cursor. */
function listInvocations({ routineId = null, limit = 50, before = null } = {}) {
  let list = readInvocations();
  if (routineId) list = list.filter((entry) => entry.routineId === routineId);
  if (Number.isFinite(before)) list = list.filter((entry) => entry.startedAt < before);
  return list.slice(0, Math.max(1, limit));
}

function countInvocations(routineId) {
  return readInvocations().filter((entry) => entry.routineId === routineId).length;
}

function lastInvocation(routineId, predicate = null) {
  return readInvocations().find((entry) =>
    entry.routineId === routineId && (!predicate || predicate(entry))) || null;
}

/** The invocation currently occupying the routine, if any (busy := this). */
function activeInvocation(routineId) {
  return lastInvocation(routineId, (entry) => ACTIVE_STATUSES.includes(entry.status));
}

function activeInvocations() {
  return readInvocations().filter((entry) => ACTIVE_STATUSES.includes(entry.status));
}

function countActive(routineId) {
  return readInvocations()
    .filter((entry) => entry.routineId === routineId && ACTIVE_STATUSES.includes(entry.status)).length;
}

/**
 * Latest invocation per session id — the source for the presentation-only
 * `routine` stamp on session list rows.
 */
function invocationsBySessionId() {
  const bySession = new Map();
  for (const entry of readInvocations()) {  // newest first, so the first wins
    if (entry.sessionId && !bySession.has(entry.sessionId)) bySession.set(entry.sessionId, entry);
  }
  return bySession;
}

module.exports = {
  // definitions
  readRoutines,
  listRoutines,
  getRoutine,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  markScheduled,
  // ledger
  readInvocations,
  createInvocation,
  updateInvocation,
  getInvocation,
  listInvocations,
  countInvocations,
  lastInvocation,
  activeInvocation,
  activeInvocations,
  countActive,
  invocationsBySessionId,
  serializedInputSize,
  // constants shared with the routes and the runner
  MAX_INVOCATIONS,
  MAX_VERSIONS,
  MAX_PROMPT,
  MAX_INPUT_BYTES,
  MAX_SOURCE,
  THINKING_LEVELS,
  MODES,
  ON_BUSY,
  DELIVERIES,
  STATUSES,
  NAME_RE,
};
