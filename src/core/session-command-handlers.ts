import type { RequestHandler } from 'express';
import type { ParsedQs } from 'qs';
import type { LiveSession, liveSessionSupports } from './session-ownership';
import { messageHoldWindowMs, peerSender, type MessageHold } from './message-hold';

type CommandHandler = RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;

interface SessionCommandPorts {
  getLiveSession(id: string): Promise<LiveSession | null>;
  supports: typeof liveSessionSupports;
  expandRefs(message: unknown, refs: unknown): string;
  hold: MessageHold;
  readSettings(): Record<string, unknown>;
  sessionExists(id: string): boolean;
}

// Retain the existing boundary's primitive boxing and null failures.
function property(value: unknown, key: string): unknown {
  if (value == null) throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`);
  return Reflect.get(Object(value), key);
}

// Drop malformed attachments without rejecting the remaining message.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function sanitizeImages(images: unknown) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image: unknown) => {
      if (!image) return false;
      const data = property(image, 'data'), mimeType = property(image, 'mimeType');
      return typeof data === 'string' && BASE64_RE.test(data)
        && typeof mimeType === 'string' && mimeType.startsWith('image/');
    })
    .map((image: unknown) => ({ type: 'image', data: property(image, 'data'), mimeType: property(image, 'mimeType') }));
}

/** HTTP admission only; lifecycle, routine and recovery delivery keep their owners. */
export function createSessionCommandHandlers(ports: SessionCommandPorts): {
  prompt: CommandHandler; steer: CommandHandler; followUp: CommandHandler;
} {
  async function deliver(
    req: Parameters<CommandHandler>[0], res: Parameters<CommandHandler>[1],
    operation: 'prompt' | 'steer' | 'followUp',
  ) {
    const message = property(req.body, 'message');
    const deliverAs = operation === 'prompt' ? property(req.body, 'deliverAs') : operation === 'followUp' ? 'followUp' : undefined;
    const images = sanitizeImages(property(req.body, 'images'));
    if (!message && !images.length) return res.status(400).json({ error: 'Message required' });
    if (deliverAs != null && deliverAs !== 'steer' && deliverAs !== 'followUp') {
      return res.status(400).json({ error: 'deliverAs must be steer or followUp' });
    }
    try {
      const sender = peerSender(property(req.body, 'sender'));
      const hold = sender && (operation === 'prompt' || operation === 'followUp')
        && deliverAs !== 'steer' && !images.length && typeof message === 'string' && message.length > 0
        && messageHoldWindowMs(ports.readSettings()) > 0;
      let session: LiveSession | null;
      try { session = await ports.getLiveSession(req.params.id); }
      catch (error) { if (!hold) throw error; session = null; }
      if (!session && !(hold && ports.sessionExists(req.params.id))) {
        return res.status(404).json({ error: 'Session not active' });
      }
      const capability = operation === 'steer' || deliverAs === 'steer' ? 'steer'
        : deliverAs === 'followUp' ? 'followUp' : 'prompt';
      if (session && !ports.supports(session, capability)) {
        const unsupported = operation === 'steer' ? 'steering' : operation === 'followUp' ? 'follow-ups' : capability;
        return res.status(409).json({ error: `This session does not support ${unsupported}.` });
      }
      if (hold) {
        const text = ports.expandRefs(message, property(req.body, 'refs'));
        const result = ports.hold.enqueue(req.params.id, operation === 'followUp' || deliverAs === 'followUp' ? 'followUp' : 'prompt', text, sender);
        return res.json({ success: true, ...result });
      }
      if (!session) return res.status(404).json({ error: 'Session not active' });
      const opts: NonNullable<Parameters<LiveSession['prompt']>[1]> = deliverAs ? { deliverAs } : {};
      if (images.length) opts.images = images;
      const text = ports.expandRefs(message, property(req.body, 'refs'));
      // Explicit steer is not prompt(deliverAs: steer), even when admission matches.
      const result = operation === 'steer' ? await session.steer(text, opts) : await session.prompt(text, opts);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: property(error, 'message') });
    }
  }

  return {
    prompt: (req, res) => deliver(req, res, 'prompt'),
    steer: (req, res) => deliver(req, res, 'steer'),
    followUp: (req, res) => deliver(req, res, 'followUp'),
  };
}
