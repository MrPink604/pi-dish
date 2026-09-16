import path = require('path');
import os = require('os');
import type { RequestHandler, Response } from 'express';
import type { ParsedQs } from 'qs';
import { getHarness } from './harnesses';
import * as routinesStore from './routines';
import type { Routine, RoutineInvocation } from './routines';
import type { RoutineRunner } from './routine-runner';
import type { SessionLaunch } from './session-launch';
import { expandSessionRefs, type SessionRefDependencies } from './session-refs';

export type RoutineHandler = RequestHandler<{ id: string }, unknown, unknown, ParsedQs, Record<string, unknown>>;
type RoutineResponse = Response<unknown, Record<string, unknown>>;

export interface RoutineHandlerPorts {
  runner: RoutineRunner;
  validateHarnessPilotSelection: SessionLaunch['validateHarnessPilotSelection'];
}

export interface RoutineHandlers {
  list: RoutineHandler;
  create: RoutineHandler;
  get: RoutineHandler;
  update: RoutineHandler;
  remove: RoutineHandler;
  invoke: RoutineHandler;
  listInvocations: RoutineHandler;
  getInvocation: RoutineHandler;
}

/** Access only: primitive boxing and null failures retain their original behavior. */
function property(value: unknown, key: string): unknown {
  if (value === null || value === undefined) throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`);
  return Reflect.get(Object(value), key);
}

const INVOCATION_ATTR_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeInvocationAttr(value: unknown): string {
  return String(value).replace(/[&<>"]/g, (ch) => INVOCATION_ATTR_ESCAPES[ch]);
}

/** Append caller input without templating the prompt, then expand composer-style #refs. */
export function composeRoutinePrompt(routine: Routine, invocation: RoutineInvocation | null | undefined, refs: SessionRefDependencies): string {
  let text = routine.prompt;
  if (invocation && invocation.input !== null && invocation.input !== undefined) {
    const source = invocation.source ? ` source="${escapeInvocationAttr(invocation.source)}"` : '';
    text += `\n\n<invocation-input${source} invocation="${invocation.id}">\n`
      + `${JSON.stringify(invocation.input, null, 2)}\n</invocation-input>`;
  }
  return expandSessionRefs(text, [], refs);
}

function expandRoutineCwd(cwd: unknown): unknown {
  return typeof cwd === 'string' && cwd.startsWith('~')
    ? path.join(os.homedir(), cwd.slice(1).replace(/^\//, '')) : cwd;
}

function routineErrorResponse(res: RoutineResponse, error: unknown): RoutineResponse {
  const payload: { error: unknown; invocation?: unknown; retryAfterSec?: unknown; lastInvocation?: unknown } = {
    error: property(error, 'message'),
  };
  if (property(error, 'invocation')) payload.invocation = property(error, 'invocation');
  if (property(error, 'retryAfterSec') !== undefined) {
    payload.retryAfterSec = property(error, 'retryAfterSec');
    payload.lastInvocation = property(error, 'lastInvocation') || null;
  }
  // Express remains the runtime validator for a thrown object's status value.
  return res.status((property(error, 'status') || 500) as number).json(payload);
}

const ROUTINE_INVOCATION_PAGE_MAX = 200;

export function createRoutineHandlers(ports: RoutineHandlerPorts): RoutineHandlers {
  const { runner, validateHarnessPilotSelection } = ports;

  // Same pilot validation and precedence as POST /api/sessions/new, before the
  // definition store validates its fields. Pi ignores pilot-only selections.
  async function validateRoutinePilot(input: unknown): Promise<void> {
    const harness = property(input, 'harness');
    const model = property(input, 'model');
    const thinking = property(input, 'thinking');
    const cwd = property(input, 'cwd');
    const descriptor = getHarness(harness || 'pi');
    if (!descriptor) throw Object.assign(new Error(`Unknown harness: ${harness}`), { status: 400 });
    await validateHarnessPilotSelection(descriptor, { model, thinking, cwd: expandRoutineCwd(cwd) });
  }

  function routineStats(routine: Routine, invocations: RoutineInvocation[]) {
    const mine = invocations.filter((entry) => entry.routineId === routine.id);
    return {
      invocations: mine.length,
      running: mine.filter((entry) => entry.status === 'starting' || entry.status === 'running').length,
      lastInvocation: mine[0] || null,
      nextRunAt: runner.nextRunAt(routine),
    };
  }

  /** List rows omit the version history, which can be large. */
  function routineSummary(routine: Routine, invocations: RoutineInvocation[]) {
    const { versions, ...rest } = routine;
    return { ...rest, stats: routineStats(routine, invocations) };
  }

  const list: RoutineHandler = (_req, res) => {
    const invocations = routinesStore.readInvocations();
    res.json({ routines: routinesStore.listRoutines().map((routine) => routineSummary(routine, invocations)) });
  };

  const create: RoutineHandler = async (req, res) => {
    const input = req.body || {};
    try {
      await validateRoutinePilot(input);
      res.status(201).json({ routine: routinesStore.createRoutine(input) });
    } catch (error) {
      routineErrorResponse(res, error);
    }
  };

  const get: RoutineHandler = (req, res) => {
    const routine = routinesStore.getRoutine(req.params.id);
    if (!routine) return res.status(404).json({ error: 'Routine not found' });
    res.json({ routine });
  };

  const update: RoutineHandler = async (req, res) => {
    const existing = routinesStore.getRoutine(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Routine not found' });
    const patch = req.body || {};
    try {
      await validateRoutinePilot({
        harness: property(patch, 'harness') ?? existing.harness,
        model: property(patch, 'model') === undefined ? existing.model : property(patch, 'model'),
        thinking: property(patch, 'thinking') === undefined ? existing.thinking : property(patch, 'thinking'),
        cwd: property(patch, 'cwd') ?? existing.cwd,
      });
      res.json({ routine: routinesStore.updateRoutine(existing.id, patch) });
    } catch (error) {
      routineErrorResponse(res, error);
    }
  };

  // Definition deletion retains its ledger and never controls its sessions.
  const remove: RoutineHandler = (req, res) => {
    const existing = routinesStore.deleteRoutine(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Routine not found' });
    res.json({ success: true, invocations: routinesStore.countInvocations(existing.id) });
  };

  const invoke: RoutineHandler = async (req, res) => {
    const routine = routinesStore.getRoutine(req.params.id);
    if (!routine) return res.status(404).json({ error: 'Routine not found' });
    const body = req.body || {};
    const input = routinesStore.RoutineInputAdmission.prepare(
      property(body, 'input') === undefined ? null : property(body, 'input'));
    if (!input) {
      return res.status(413).json({ error: `input must serialize to at most ${routinesStore.MAX_INPUT_BYTES} bytes` });
    }
    let source: string | null = null;
    if (property(body, 'source') !== undefined && property(body, 'source') !== null) {
      const candidate = property(body, 'source');
      if (typeof candidate !== 'string' || candidate.length > routinesStore.MAX_SOURCE) {
        return res.status(400).json({ error: `source must be a string of at most ${routinesStore.MAX_SOURCE} characters` });
      }
      // Control characters would break the invocation-input block's framing.
      if (/[\u0000-\u001f\u007f]/.test(candidate)) {
        return res.status(400).json({ error: 'source must not contain control characters' });
      }
      source = candidate || null;
    }
    try {
      const invocation = runner.invoke(routine, { trigger: 'invoke', source, input });
      if (req.query.wait === '1') {
        // A still-starting spawn is returned after a bounded wait, not detached
        // from its invocation or converted into a second run.
        const settled = await runner.waitForInvocation(invocation.id, 60000);
        return res.json({ invocation: settled || invocation });
      }
      res.status(202).json({ invocation });
    } catch (error) {
      routineErrorResponse(res, error);
    }
  };

  const listInvocations: RoutineHandler = (req, res) => {
    const routine = routinesStore.getRoutine(req.params.id);
    if (!routine) return res.status(404).json({ error: 'Routine not found' });
    const requested = Number(req.query.limit);
    const limit = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), ROUTINE_INVOCATION_PAGE_MAX) : 50;
    const before = Number(req.query.before);
    const invocations = routinesStore.listInvocations({
      routineId: routine.id,
      limit: limit + 1,
      before: Number.isFinite(before) ? before : null,
    });
    const page = invocations.slice(0, limit);
    res.json({
      invocations: page,
      nextBefore: invocations.length > limit ? page[page.length - 1].startedAt : null,
    });
  };

  const getInvocation: RoutineHandler = (req, res) => {
    const invocation = routinesStore.getInvocation(req.params.id);
    if (!invocation) return res.status(404).json({ error: 'Invocation not found' });
    res.json({ invocation });
  };

  return { list, create, get, update, remove, invoke, listInvocations, getInvocation };
}
