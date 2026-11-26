import type { RequestHandler } from 'express';
import type { ParsedQs } from 'qs';
import type { LiveSession, liveSessionSupports } from './session-ownership';
import { messageHoldWindowMs, peerSender, type MessageHold } from './message-hold';
import { errorMessage, errorStatus, httpError } from './http-boundary';
import { CuBrokerUnavailableError, CuSeatBusyError, cuBrokerUnavailableResponseFields } from './cu-agent-leases';
import { asRecord } from './wire-protocol';

type CommandHandler = RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
type CommandRequest = Parameters<CommandHandler>[0];
type CommandResponse = Parameters<CommandHandler>[1];

interface SessionCommandPorts {
  getLiveSession(id: string): Promise<LiveSession | null>;
  supports: typeof liveSessionSupports;
  expandRefs(message: unknown, refs: unknown): string;
  hold: MessageHold;
  readSettings(): Record<string, unknown>;
  sessionExists(id: string): boolean;
  /** Resumes a hibernated session and returns it live; null when it was not hibernated. */
  wake(id: string): Promise<LiveSession | null>;
}

interface CommandBody {
  message?: unknown;
  deliverAs?: unknown;
  images?: unknown;
  refs?: unknown;
  sender?: unknown;
}

interface ImageAttachment {
  type: 'image';
  data: string;
  mimeType: string;
}

// Malformed attachments are dropped; the message itself is still delivered.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function sanitizeImages(images: unknown): ImageAttachment[] {
  if (!Array.isArray(images)) return [];
  const out: ImageAttachment[] = [];
  for (const image of images) {
    if (!image || typeof image !== 'object') continue;
    const { data, mimeType } = image as Record<string, unknown>;
    if (typeof data === 'string' && BASE64_RE.test(data)
      && typeof mimeType === 'string' && mimeType.startsWith('image/')) {
      out.push({ type: 'image', data, mimeType });
    }
  }
  return out;
}

/** HTTP admission plus server-originated text input; lifecycle, routine and recovery delivery keep their owners. */
export function createSessionCommandHandlers(ports: SessionCommandPorts): {
  prompt: CommandHandler; steer: CommandHandler; followUp: CommandHandler;
  deliverText(id: string, text: string, inactiveMessage?: string): Promise<string | null>;
} {
  async function deliver(req: CommandRequest, res: CommandResponse, operation: 'prompt' | 'steer' | 'followUp') {
    const body: CommandBody = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as CommandBody : {};
    const message = body.message;
    const deliverAs = operation === 'prompt' ? body.deliverAs : operation === 'followUp' ? 'followUp' : undefined;
    const images = sanitizeImages(body.images);
    if (!message && !images.length) return res.status(400).json({ error: 'Message required' });
    if (deliverAs != null && deliverAs !== 'steer' && deliverAs !== 'followUp') {
      return res.status(400).json({ error: 'deliverAs must be steer or followUp' });
    }
    try {
      const sender = peerSender(body.sender);
      const hold = sender && (operation === 'prompt' || operation === 'followUp')
        && deliverAs !== 'steer' && !images.length && typeof message === 'string' && message.length > 0
        && messageHoldWindowMs(ports.readSettings()) > 0;
      let session: LiveSession | null;
      try { session = await ports.getLiveSession(req.params.id); }
      catch (error) { if (!hold) throw error; session = null; }
      const capability = operation === 'steer' || deliverAs === 'steer' ? 'steer'
        : deliverAs === 'followUp' ? 'followUp' : 'prompt';
      // A held message wakes its target at delivery. A steer has no turn to
      // interrupt in a hibernated session, so it never resumes one.
      if (!session && !hold && capability !== 'steer') session = await ports.wake(req.params.id);
      if (!session && !(hold && ports.sessionExists(req.params.id))) {
        return res.status(404).json({ error: 'Session not active' });
      }
      if (session && !ports.supports(session, capability)) {
        const unsupported = operation === 'steer' ? 'steering' : operation === 'followUp' ? 'follow-ups' : capability;
        return res.status(409).json({ error: `This session does not support ${unsupported}.` });
      }
      // A bot relay from before images were passed on would keep only the caption and report success; it restarts
      // onto the current code once idle, so the sender keeps the attachment and tries again.
      if (session && images.length && 'harnessId' in session && session.harnessId === 'bot' && !ports.supports(session, 'images')) {
        return res.status(503).json({
          error: 'This bot is still running older pi-dish code that cannot take images; it restarts onto the new code once it is idle. Nothing was sent: send it again in a minute.',
          retryable: true,
        });
      }
      if (hold) {
        const text = ports.expandRefs(message, body.refs);
        const delivery = operation === 'followUp' || deliverAs === 'followUp' ? 'followUp' : 'prompt';
        return res.json({ success: true, ...ports.hold.enqueue(req.params.id, delivery, text, sender) });
      }
      if (!session) return res.status(404).json({ error: 'Session not active' });
      const opts: NonNullable<Parameters<LiveSession['prompt']>[1]> = deliverAs ? { deliverAs } : {};
      if (images.length) opts.images = images;
      const text = ports.expandRefs(message, body.refs);
      // Explicit steer is not prompt(deliverAs: steer), even when admission matches.
      const result = operation === 'steer' ? await session.steer(text, opts) : await session.prompt(text, opts);
      res.json({ success: true, result });
    } catch (error) {
      if (error instanceof CuSeatBusyError) {
        return res.status(409).json({
          code: error.code,
          state: error.state,
          epoch: error.epoch,
          holder: error.holder,
          error: error.message,
        });
      }
      if (error instanceof CuBrokerUnavailableError) {
        return res.status(503).json({
          ...cuBrokerUnavailableResponseFields(error),
          error: error.message,
        });
      }
      res.status(errorStatus(error, 500)).json({ error: errorMessage(error) });
    }
  }

  /**
   * Input the server composes for a session (a published page's form answers):
   * the composer's admission without refs, images or a peer hold. A hibernated
   * session or a bot whose relay is down is woken. pi-dish never picks prompt
   * or follow-up from its own (possibly stale) view of the turn: a bridge that
   * offers `followUpIfBusy` decides at admission (OMP drains an idle follow-up
   * only after an assistant or tool-result tail) and reports what happened;
   * every other transport applies its own admission default to plain input.
   * Resolves to null once the session took it, or to why that is unconfirmed.
   */
  async function deliverText(id: string, text: string, inactiveMessage = 'the session that published this page is not running'): Promise<string | null> {
    const session = await ports.getLiveSession(id) ?? await ports.wake(id);
    if (!session) throw httpError(inactiveMessage, 409);
    const followUp = ports.supports(session, 'followUp');
    const prompt = ports.supports(session, 'prompt');
    if (!followUp && !prompt) throw httpError('this session does not accept messages', 409);
    const admission = 'promptOrFollowUp' in session ? session.promptOrFollowUp(text) : null;
    if (!admission) {
      await session.prompt(text, prompt ? {} : { deliverAs: 'followUp' });
      return null;
    }
    const result = asRecord(await admission);
    if (result.queued === true) return 'the session is compacting; the message waits in its queue';
    if (result.admitted !== true) return 'the session did not confirm it took the message in time';
    return null;
  }

  return {
    prompt: (req, res) => deliver(req, res, 'prompt'),
    steer: (req, res) => deliver(req, res, 'steer'),
    followUp: (req, res) => deliver(req, res, 'followUp'),
    deliverText,
  };
}
