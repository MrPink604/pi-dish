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

interface RoutineError extends Error {
  status?: number;
  invocation?: RoutineInvocation;
  retryAfterSec?: number;
  lastInvocation?: RoutineInvocation | null;
}

function bodyFields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

const INVOCATION_ATTR_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Append caller input without templating the prompt, then expand composer-style #refs. */
export function composeRoutinePrompt(routine: Routine, invocation: RoutineInvocation | null | undefined, refs: SessionRefDependencies): string {
  let text = routine.prompt;
  if (invocation && invocation.input !== null && invocation.input !== undefined) {
    const source = invocation.source
      ? ` source="${invocation.source.replace(/[&<>"]/g, (ch) => INVOCATION_ATTR_ESCAPES[ch])}"` : '';
    text += `\n\n<invocation-input${source} invocation="${invocation.id}">\n`
      + `${JSON.stringify(invocation.input, null, 2)}\n</invocation-input>`;
  }
  return expandSessionRefs(text, [], refs);
}

function routineErrorResponse(res: RoutineResponse, error: unknown): RoutineResponse {
  const routineError = error as RoutineError;
  const payload: { error: unknown; invocation?: unknown; retryAfterSec?: unknown; lastInvocation?: unknown } = {
    error: routineError.message,
  };
  if (routineError.invocation) payload.invocation = routineError.invocation;
  if (routineError.retryAfterSec !== undefined) {
    payload.retryAfterSec = routineError.retryAfterSec;
    payload.lastInvocation = routineError.lastInvocation || null;
  }
  // Express remains the runtime validator for a thrown object's status value.
  return res.status(routineError.status || 500).json(payload);
}

const ROUTINE_INVOCATION_PAGE_MAX = 200;

export function createRoutineHandlers(ports: RoutineHandlerPorts): RoutineHandlers {
  const { runner, validateHarnessPilotSelection } = ports;

  // Same pilot validation and precedence as POST /api/sessions/new, before the
  // definition store validates its fields. Pi ignores pilot-only selections.
  async function validateRoutinePilot(harness: unknown, model: unknown, thinking: unknown, cwd: unknown): Promise<void> {
    const descriptor = getHarness(harness || 'pi');
    if (!descriptor) throw Object.assign(new Error(`Unknown harness: ${harness}`), { status: 400 });
    const expandedCwd = typeof cwd === 'string' && cwd.startsWith('~')
      ? path.join(os.homedir(), cwd.slice(1).replace(/^\//, '')) : cwd;
    await validateHarnessPilotSelection(descriptor, { model, thinking, cwd: expandedCwd });
  }

  function routineSummary(routine: Routine, invocations: RoutineInvocation[]) {
    const { versions, ...rest } = routine;
    const mine = invocations.filter((entry) => entry.routineId === routine.id);
    return {
      ...rest,
      stats: {
        invocations: mine.length,
        running: mine.filter((entry) => entry.status === 'starting' || entry.status === 'running').length,
        lastInvocation: mine[0] || null,
        nextRunAt: runner.nextRunAt(routine),
      },
    };
  }

  const list: RoutineHandler = (_req, res) => {
    const invocations = routinesStore.readInvocations();
    res.json({ routines: routinesStore.listRoutines().map((routine) => routineSummary(routine, invocations)) });
  };

  const create: RoutineHandler = async (req, res) => {
    const input = bodyFields(req.body);
    try {
      await validateRoutinePilot(input.harness, input.model, input.thinking, input.cwd);
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
    const patch = bodyFields(req.body);
    try {
      await validateRoutinePilot(
        patch.harness ?? existing.harness,
        patch.model === undefined ? existing.model : patch.model,
        patch.thinking === undefined ? existing.thinking : patch.thinking,
        patch.cwd ?? existing.cwd,
      );
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
    const body = bodyFields(req.body);
    const input = body.input === undefined ? null : body.input;
    if (routinesStore.inputBytes(input) > routinesStore.MAX_INPUT_BYTES) {
      return res.status(413).json({ error: `input must serialize to at most ${routinesStore.MAX_INPUT_BYTES} bytes` });
    }
    let source: string | null = null;
    if (body.source !== undefined && body.source !== null) {
      const candidate = body.source;
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
