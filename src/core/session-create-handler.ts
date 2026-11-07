import { errorMessage, errorStatus, requestBody, type RouteHandler } from './http-boundary';
import { getHarness } from './harnesses';
import sessionProvenance = require('./session-provenance');
import type { HarnessLaunchTarget, SessionLaunch } from './session-launch';
import type { SessionOperations } from './session-operations';

export interface SessionCreatePorts {
  sessionOperations: SessionOperations;
  sessionLaunch: SessionLaunch;
  /** Registered, running over RPC, or persisted on this host. */
  sessionKnown(id: string): boolean;
}

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function createSessionCreateHandlers(ports: SessionCreatePorts) {
  const create: RouteHandler = async (req, res) => {
    const body = requestBody(req);
    const harness = body.harness === undefined ? 'pi' : body.harness;
    const descriptor = getHarness(harness);
    if (!descriptor) return res.status(400).json({ error: `Unknown harness: ${harness}` });
    const name = typeof body.name === 'string' ? body.name.trim() : body.name;
    const { model, thinking, cwd, target, private: isPrivate } = body;
    if (isPrivate !== undefined && typeof isPrivate !== 'boolean') {
      return res.status(400).json({ error: 'private must be a boolean' });
    }
    if (isPrivate === true && !descriptor.privateRootPath) {
      return res.status(400).json({ error: `${descriptor.label} does not support private sessions.` });
    }
    if (name !== undefined && (typeof name !== 'string' || !name)) {
      return res.status(400).json({ error: 'Name must be a non-empty string' });
    }
    if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
      return res.status(400).json({ error: 'Model must be a non-empty string' });
    }
    if (cwd !== undefined && typeof cwd !== 'string') {
      return res.status(400).json({ error: 'cwd must be a string' });
    }
    if (thinking !== undefined && !THINKING_LEVELS.includes(thinking as string)) {
      return res.status(400).json({ error: 'Invalid reasoning level' });
    }
    // requestedBySessionId is the public provenance field; sourceSessionId stays
    // a compatibility alias. The header lets the bundled CLI identify itself.
    const claimedSource = req.get('X-Pi-Dish-Session-Id')
      || body.requestedBySessionId || body.sourceSessionId || null;
    // Callers may name themselves fleet-globally (`<hostId>:<sessionId>`); this
    // host's qualifier is stripped and validated locally. Provenance is
    // advisory and grants nothing, so a foreign id is recorded as-is.
    const sourceSessionId = typeof claimedSource === 'string'
      ? sessionProvenance.localizeCallerId(claimedSource) : null;
    const unknownSource = sourceSessionId && !sessionProvenance.isHostQualified(sourceSessionId)
      && !ports.sessionKnown(sourceSessionId);
    if (unknownSource || (claimedSource !== null && typeof claimedSource !== 'string')) {
      return res.status(400).json({
        error: 'requestedBySessionId must identify an existing session on this host; name a session on another fleet host as <hostId>:<sessionId>',
      });
    }
    const selected = {
      harness,
      name: name as string | undefined,
      model,
      thinking,
      cwd,
      target: target as HarnessLaunchTarget | null | undefined,
      private: isPrivate === true,
    };
    if (body.async === true) {
      const spawnId = ports.sessionOperations.startSessionSpawn({
        ...selected, sourceSessionId,
      });
      return res.status(202).json({ success: true, pending: true, spawnId });
    }
    try {
      await ports.sessionLaunch.validateHarnessPilotSelection(descriptor, selected);
    } catch (error) {
      return res.status(errorStatus(error, 500)).json({ error: errorMessage(error) });
    }
    try {
      const id = await ports.sessionOperations.createSession(selected);
      const operationId = sourceSessionId
        ? ports.sessionOperations.recordSessionLaunch(id, sourceSessionId) : null;
      res.json({ success: true, id, ...(operationId ? { operationId } : {}) });
    } catch (error) {
      console.error('Failed to create session:', error);
      res.status(errorStatus(error, 500)).json({ success: false, error: errorMessage(error) });
    }
  };

  const spawnStatus: RouteHandler = (req, res) => {
    const operation = ports.sessionOperations.getSessionSpawn(req.params.id);
    if (!operation) return res.status(404).json({ error: 'Session spawn not found' });
    res.status(operation.status === 'starting' ? 202 : 200).json(operation);
  };

  return { create, spawnStatus };
}
