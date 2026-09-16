// Generated from src/core/routines.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoutineInputAdmission = exports.STATUSES = exports.DELIVERIES = exports.ON_BUSY = exports.MODES = exports.THINKING_LEVELS = exports.NAME_RE = exports.MAX_INPUT_BYTES = exports.MAX_SOURCE = exports.MAX_PROMPT = exports.MAX_VERSIONS = exports.MAX_INVOCATIONS = void 0;
exports.readRoutines = readRoutines;
exports.listRoutines = listRoutines;
exports.getRoutine = getRoutine;
exports.createRoutine = createRoutine;
exports.updateRoutine = updateRoutine;
exports.deleteRoutine = deleteRoutine;
exports.markScheduled = markScheduled;
exports.readInvocations = readInvocations;
exports.createInvocation = createInvocation;
exports.updateInvocation = updateInvocation;
exports.getInvocation = getInvocation;
exports.listInvocations = listInvocations;
exports.countInvocations = countInvocations;
exports.lastInvocation = lastInvocation;
exports.activeInvocation = activeInvocation;
exports.activeInvocations = activeInvocations;
exports.countActive = countActive;
exports.invocationsBySessionId = invocationsBySessionId;
/**
 * Routines own definitions, prompt versions and the thin invocation ledger, not
 * sessions or their histories. Both stores are re-read per call and are advisory:
 * deleting a definition never removes its invocation history or running session.
 */
const crypto = require("crypto");
const dish_store_1 = require("./dish-store");
const harnesses_1 = require("./harnesses");
const cron_1 = require("./cron");
const ROUTINES_FILE = 'routines.json';
const INVOCATIONS_FILE = 'routine-invocations.json';
exports.MAX_INVOCATIONS = 5000;
exports.MAX_VERSIONS = 50;
exports.MAX_PROMPT = 100000;
const MAX_DESCRIPTION = 500;
exports.MAX_SOURCE = 100;
exports.MAX_INPUT_BYTES = 32 * 1024;
exports.NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
exports.THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
exports.MODES = ['oneShot', 'continue'];
exports.ON_BUSY = ['skip', 'steer', 'followUp'];
exports.DELIVERIES = ['prompt', 'steer', 'followUp'];
exports.STATUSES = ['starting', 'running', 'completed', 'errored', 'interrupted', 'skipped'];
const ACTIVE_STATUSES = ['starting', 'running'];
function fail(message, status = 400) {
    const error = new Error(message);
    return Object.assign(error, { status });
}
/** Property access, not a schema: retain primitive boxing and nullish failures. */
function property(value, key) {
    if (value === null || value === undefined)
        throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`);
    return Reflect.get(Object(value), key);
}
function includes(allowed, value) {
    const values = allowed;
    return values.includes(value);
}
function isRoutine(value, id) {
    return !!value && typeof value === 'object' && property(value, 'id') === id;
}
function isInvocation(value) {
    return !!value && typeof value === 'object' && typeof property(value, 'id') === 'string';
}
function isFiniteNumber(value) {
    return Number.isFinite(value);
}
// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------
function readRoutines() {
    const raw = (0, dish_store_1.readStore)(ROUTINES_FILE);
    const source = raw.routines && typeof raw.routines === 'object' && !Array.isArray(raw.routines)
        ? raw.routines : {};
    const routines = {};
    const entries = Object.entries(source);
    for (const [id, value] of entries) {
        if (isRoutine(value, id))
            routines[id] = value;
    }
    return routines;
}
function writeRoutines(routines) {
    (0, dish_store_1.writeStore)(ROUTINES_FILE, { version: 1, routines });
}
function listRoutines() {
    return Object.values(readRoutines())
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
/** Routines are addressed by uuid or by their (case-insensitive) unique name. */
function getRoutine(ref) {
    if (typeof ref !== 'string' || !ref)
        return null;
    return lookupRoutine(readRoutines(), ref);
}
function lookupRoutine(routines, ref) {
    if (typeof ref !== 'string' || !ref)
        return null;
    if (routines[ref])
        return routines[ref];
    const wanted = ref.toLowerCase();
    return Object.values(routines).find((routine) => String(routine.name).toLowerCase() === wanted) || null;
}
function validateName(name, routines, selfId) {
    if (typeof name !== 'string' || !exports.NAME_RE.test(name)) {
        throw fail('name must be lowercase letters, digits and dashes (1-48 chars, starting alphanumeric)');
    }
    const clash = Object.values(routines).find((routine) => routine.id !== selfId && String(routine.name).toLowerCase() === name.toLowerCase());
    if (clash)
        throw fail(`A routine named "${clash.name}" already exists`, 409);
}
function validateOptionalString(value, field, max) {
    if (value === undefined || value === null)
        return '';
    if (typeof value !== 'string')
        throw fail(`${field} must be a string`);
    if (value.length > max)
        throw fail(`${field} must be at most ${max} characters`);
    return value;
}
function validateCwd(cwd) {
    if (typeof cwd !== 'string' || !cwd.trim())
        throw fail('cwd is required');
    const trimmed = cwd.trim();
    if (!trimmed.startsWith('/') && !trimmed.startsWith('~')) {
        throw fail('cwd must be an absolute path or start with ~');
    }
    return trimmed;
}
function validateSchedule(schedule) {
    if (schedule === undefined || schedule === null)
        return null;
    if (typeof schedule !== 'object' || Array.isArray(schedule)) {
        throw fail('schedule must be null or { cron }');
    }
    const cron = property(schedule, 'cron');
    if (typeof cron !== 'string' || !cron.trim())
        throw fail('schedule.cron is required');
    try {
        (0, cron_1.parseCron)(cron);
    }
    catch (error) {
        throw fail(`Invalid schedule: ${property(error, 'message')}`);
    }
    return { cron: cron.trim() };
}
function validateEnum(value, field, allowed, fallback) {
    if (value === undefined || value === null)
        return fallback;
    if (!includes(allowed, value))
        throw fail(`${field} must be one of: ${allowed.join(', ')}`);
    return value;
}
function validatePrompt(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim())
        throw fail('prompt is required');
    if (prompt.length > exports.MAX_PROMPT)
        throw fail(`prompt must be at most ${exports.MAX_PROMPT} characters`);
    return prompt;
}
function validateMinInterval(value) {
    if (value === undefined || value === null)
        return 0;
    // Number.isInteger establishes the numeric operand; the assertion changes no coercion.
    if (!Number.isInteger(value) || value < 0)
        throw fail('minIntervalSec must be an integer >= 0');
    return value;
}
function validateHarness(harness) {
    const id = harness === undefined || harness === null ? 'pi' : harness;
    if (!(0, harnesses_1.getHarness)(id))
        throw fail(`Unknown harness: ${id}`);
    return id;
}
function createRoutine(input = {}) {
    const routines = readRoutines();
    const id = crypto.randomUUID();
    validateName(property(input, 'name'), routines, id);
    const now = Date.now();
    const prompt = validatePrompt(property(input, 'prompt'));
    const routine = {
        id,
        name: property(input, 'name'),
        description: validateOptionalString(property(input, 'description'), 'description', MAX_DESCRIPTION),
        harness: validateHarness(property(input, 'harness')),
        cwd: validateCwd(property(input, 'cwd')),
        // Repeated reads preserve getter behavior as well as the original validation order.
        model: typeof property(input, 'model') === 'string' && property(input, 'model').trim()
            ? property(input, 'model').trim() : undefined,
        thinking: validateEnum(property(input, 'thinking'), 'thinking', exports.THINKING_LEVELS, undefined),
        prompt,
        promptVersion: 1,
        versions: [{ version: 1, prompt, savedAt: now }],
        schedule: validateSchedule(property(input, 'schedule')),
        enabled: property(input, 'enabled') === undefined ? true : !!property(input, 'enabled'),
        mode: validateEnum(property(input, 'mode'), 'mode', exports.MODES, 'oneShot'),
        onBusy: validateEnum(property(input, 'onBusy'), 'onBusy', exports.ON_BUSY, 'skip'),
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
function updateRoutine(ref, patch = {}) {
    const routines = readRoutines();
    const existing = lookupRoutine(routines, ref);
    if (!existing)
        return null;
    const routine = { ...routines[existing.id] };
    if (property(patch, 'name') !== undefined) {
        validateName(property(patch, 'name'), routines, routine.id);
        routine.name = property(patch, 'name');
    }
    if (property(patch, 'description') !== undefined) {
        routine.description = validateOptionalString(property(patch, 'description'), 'description', MAX_DESCRIPTION);
    }
    if (property(patch, 'harness') !== undefined)
        routine.harness = validateHarness(property(patch, 'harness'));
    if (property(patch, 'cwd') !== undefined)
        routine.cwd = validateCwd(property(patch, 'cwd'));
    if (property(patch, 'model') !== undefined) {
        if (property(patch, 'model') === null || property(patch, 'model') === '')
            routine.model = undefined;
        else if (typeof property(patch, 'model') !== 'string')
            throw fail('model must be a string');
        else
            routine.model = property(patch, 'model').trim() || undefined;
    }
    if (property(patch, 'thinking') !== undefined) {
        routine.thinking = property(patch, 'thinking') === null || property(patch, 'thinking') === ''
            ? undefined : validateEnum(property(patch, 'thinking'), 'thinking', exports.THINKING_LEVELS, undefined);
    }
    if (property(patch, 'schedule') !== undefined)
        routine.schedule = validateSchedule(property(patch, 'schedule'));
    if (property(patch, 'enabled') !== undefined)
        routine.enabled = !!property(patch, 'enabled');
    if (property(patch, 'mode') !== undefined)
        routine.mode = validateEnum(property(patch, 'mode'), 'mode', exports.MODES, routine.mode);
    if (property(patch, 'onBusy') !== undefined)
        routine.onBusy = validateEnum(property(patch, 'onBusy'), 'onBusy', exports.ON_BUSY, routine.onBusy);
    if (property(patch, 'minIntervalSec') !== undefined)
        routine.minIntervalSec = validateMinInterval(property(patch, 'minIntervalSec'));
    const now = Date.now();
    if (property(patch, 'prompt') !== undefined) {
        const prompt = validatePrompt(property(patch, 'prompt'));
        if (prompt !== routine.prompt) {
            routine.prompt = prompt;
            // Operand-only assertions preserve native + and iteration: a saved string
            // version concatenates, and a truthy non-iterable versions value still throws.
            routine.promptVersion = (routine.promptVersion || 1) + 1;
            // Trim from the front; the current version always remains in the history.
            routine.versions = [...(routine.versions || []), { version: routine.promptVersion, prompt, savedAt: now }]
                .slice(-exports.MAX_VERSIONS);
        }
    }
    routine.updatedAt = now;
    routines[routine.id] = routine;
    writeRoutines(routines);
    return routine;
}
function deleteRoutine(ref) {
    const routines = readRoutines();
    const existing = lookupRoutine(routines, ref);
    if (!existing)
        return null;
    delete routines[existing.id];
    writeRoutines(routines);
    return existing;
}
/** Persist the fired minute to prevent double-firing after a same-minute restart. */
function markScheduled(id, minuteMs) {
    const routines = readRoutines();
    // Index-only assertions retain the original repeated ToPropertyKey coercions.
    if (!routines[id])
        return null;
    routines[id] = { ...routines[id], lastScheduledMinute: minuteMs };
    writeRoutines(routines);
    return routines[id];
}
// ---------------------------------------------------------------------------
// Invocation ledger
// ---------------------------------------------------------------------------
function readInvocations() {
    const raw = (0, dish_store_1.readStore)(INVOCATIONS_FILE);
    const list = Array.isArray(raw.invocations) ? raw.invocations : [];
    return list.filter(isInvocation);
}
function writeInvocations(invocations) {
    (0, dish_store_1.writeStore)(INVOCATIONS_FILE, { version: 1, invocations: invocations.slice(0, exports.MAX_INVOCATIONS) });
}
/**
 * One admission measurement, not an immutable snapshot of caller data.
 * Only this private brand can carry a prior measurement through the input slot;
 * the captured reference is also the exact value the ledger receives.
 */
class RoutineInputAdmission {
    #input;
    #size;
    constructor(input) {
        this.#input = input;
        // JSON.stringify may return undefined; retain byteLength's native failure.
        this.#size = input === undefined || input === null
            ? 0 : Buffer.byteLength(JSON.stringify(input), 'utf8');
    }
    /** Null means oversized; native serialization errors still escape to the caller. */
    static prepare(input) {
        const admission = input !== null && typeof input === 'object' && #input in input
            ? input : new RoutineInputAdmission(input);
        return admission.#size > exports.MAX_INPUT_BYTES ? null : admission;
    }
    /** Read the private slot, never a caller-overridable value getter. */
    static value(admission) {
        return admission.#input;
    }
}
exports.RoutineInputAdmission = RoutineInputAdmission;
function createInvocation(fields = {}) {
    const routine = property(fields, 'routine');
    if (!routine)
        throw fail('routine is required');
    if (!includes(exports.STATUSES, property(fields, 'status')))
        throw fail(`status must be one of: ${exports.STATUSES.join(', ')}`);
    const source = property(fields, 'source') == null ? null : validateOptionalString(property(fields, 'source'), 'source', exports.MAX_SOURCE) || null;
    const input = property(fields, 'input') === undefined ? null : property(fields, 'input');
    const admission = RoutineInputAdmission.prepare(input);
    if (!admission) {
        throw fail(`input must serialize to at most ${exports.MAX_INPUT_BYTES} bytes`, 413);
    }
    const startedAt = Number.isFinite(property(fields, 'startedAt')) ? property(fields, 'startedAt') : Date.now();
    const terminal = property(fields, 'status') === 'skipped';
    const delivery = property(fields, 'delivery');
    const invocation = {
        id: crypto.randomUUID(),
        routineId: property(routine, 'id'),
        // Denormalized: the ledger outlives the routine it came from.
        routineName: property(routine, 'name'),
        version: property(routine, 'promptVersion') || 1,
        trigger: property(fields, 'trigger') === 'schedule' ? 'schedule' : 'invoke',
        source,
        delivery: includes(exports.DELIVERIES, delivery) ? delivery : 'prompt',
        status: property(fields, 'status'),
        skipReason: property(fields, 'skipReason') || null,
        sessionId: property(fields, 'sessionId') || null,
        startedAt,
        endedAt: terminal ? startedAt : null,
        durationMs: terminal ? 0 : null,
        error: property(fields, 'error') || null,
        input: RoutineInputAdmission.value(admission),
        summary: null,
        closed: false,
        closeError: null,
    };
    writeInvocations([invocation, ...readInvocations()]);
    return invocation;
}
const MUTABLE_FIELDS = {
    status: true, sessionId: true, endedAt: true, durationMs: true, error: true,
    summary: true, closed: true, closeError: true, delivery: true, skipReason: true,
};
/** Read-modify-write of one entry. Every status change hits disk. */
function updateInvocation(id, patch = {}) {
    const invocations = readInvocations();
    const index = invocations.findIndex((entry) => entry.id === id);
    if (index < 0)
        return null;
    const updated = { ...invocations[index] };
    // Object.entries itself owns primitive boxing and nullish failure behavior.
    const entries = Object.entries(patch);
    for (const [key, value] of entries) {
        if (Object.hasOwn(MUTABLE_FIELDS, key))
            updated[key] = value;
    }
    if (updated.endedAt && !Number.isFinite(updated.durationMs)) {
        // Preserve native subtraction coercions (including bigint/Symbol failures).
        updated.durationMs = Math.max(0, updated.endedAt - updated.startedAt);
    }
    invocations[index] = updated;
    writeInvocations(invocations);
    return updated;
}
function getInvocation(id) {
    return readInvocations().find((entry) => entry.id === id) || null;
}
/** Newest first; before is an exclusive startedAt cursor. */
function listInvocations(options = {}) {
    const rawRoutineId = property(options, 'routineId');
    const routineId = rawRoutineId === undefined ? null : rawRoutineId;
    const rawLimit = property(options, 'limit');
    const limit = rawLimit === undefined ? 50 : rawLimit;
    const rawBefore = property(options, 'before');
    const before = rawBefore === undefined ? null : rawBefore;
    let list = readInvocations();
    if (routineId)
        list = list.filter((entry) => entry.routineId === routineId);
    // These assertions apply only to the operators, never to persisted row shapes.
    if (isFiniteNumber(before))
        list = list.filter((entry) => entry.startedAt < before);
    return list.slice(0, Math.max(1, limit));
}
function countInvocations(routineId) {
    return readInvocations().filter((entry) => entry.routineId === routineId).length;
}
function lastInvocation(routineId, predicate = null) {
    return readInvocations().find((entry) => entry.routineId === routineId && (!predicate || predicate(entry))) || null;
}
/** The invocation currently occupying the routine, if any (busy := this). */
function activeInvocation(routineId) {
    return lastInvocation(routineId, (entry) => includes(ACTIVE_STATUSES, entry.status));
}
function activeInvocations() {
    return readInvocations().filter((entry) => includes(ACTIVE_STATUSES, entry.status));
}
function countActive(routineId) {
    return readInvocations()
        .filter((entry) => entry.routineId === routineId && includes(ACTIVE_STATUSES, entry.status)).length;
}
/** Latest invocation per session id; presentation-only provenance, never authority. */
function invocationsBySessionId() {
    const bySession = new Map();
    for (const entry of readInvocations()) { // newest first, so the first wins
        if (entry.sessionId && !bySession.has(entry.sessionId))
            bySession.set(entry.sessionId, entry);
    }
    return bySession;
}
