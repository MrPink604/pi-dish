// Generated from src/core/session-command-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionCommandHandlers = createSessionCommandHandlers;
const message_hold_1 = require("./message-hold");
const http_boundary_1 = require("./http-boundary");
const wire_protocol_1 = require("./wire-protocol");
// Malformed attachments are dropped; the message itself is still delivered.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function sanitizeImages(images) {
    if (!Array.isArray(images))
        return [];
    const out = [];
    for (const image of images) {
        if (!image || typeof image !== 'object')
            continue;
        const { data, mimeType } = image;
        if (typeof data === 'string' && BASE64_RE.test(data)
            && typeof mimeType === 'string' && mimeType.startsWith('image/')) {
            out.push({ type: 'image', data, mimeType });
        }
    }
    return out;
}
/** HTTP admission plus server-originated text input; lifecycle, routine and recovery delivery keep their owners. */
function createSessionCommandHandlers(ports) {
    async function deliver(req, res, operation) {
        const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
            ? req.body : {};
        const message = body.message;
        const deliverAs = operation === 'prompt' ? body.deliverAs : operation === 'followUp' ? 'followUp' : undefined;
        const images = sanitizeImages(body.images);
        if (!message && !images.length)
            return res.status(400).json({ error: 'Message required' });
        if (deliverAs != null && deliverAs !== 'steer' && deliverAs !== 'followUp') {
            return res.status(400).json({ error: 'deliverAs must be steer or followUp' });
        }
        try {
            const sender = (0, message_hold_1.peerSender)(body.sender);
            const hold = sender && (operation === 'prompt' || operation === 'followUp')
                && deliverAs !== 'steer' && !images.length && typeof message === 'string' && message.length > 0
                && (0, message_hold_1.messageHoldWindowMs)(ports.readSettings()) > 0;
            let session;
            try {
                session = await ports.getLiveSession(req.params.id);
            }
            catch (error) {
                if (!hold)
                    throw error;
                session = null;
            }
            const capability = operation === 'steer' || deliverAs === 'steer' ? 'steer'
                : deliverAs === 'followUp' ? 'followUp' : 'prompt';
            // A held message wakes its target at delivery. A steer has no turn to
            // interrupt in a hibernated session, so it never resumes one.
            if (!session && !hold && capability !== 'steer')
                session = await ports.wake(req.params.id);
            if (!session && !(hold && ports.sessionExists(req.params.id))) {
                return res.status(404).json({ error: 'Session not active' });
            }
            if (session && !ports.supports(session, capability)) {
                const unsupported = operation === 'steer' ? 'steering' : operation === 'followUp' ? 'follow-ups' : capability;
                return res.status(409).json({ error: `This session does not support ${unsupported}.` });
            }
            if (hold) {
                const text = ports.expandRefs(message, body.refs);
                const delivery = operation === 'followUp' || deliverAs === 'followUp' ? 'followUp' : 'prompt';
                return res.json({ success: true, ...ports.hold.enqueue(req.params.id, delivery, text, sender) });
            }
            if (!session)
                return res.status(404).json({ error: 'Session not active' });
            const opts = deliverAs ? { deliverAs } : {};
            if (images.length)
                opts.images = images;
            const text = ports.expandRefs(message, body.refs);
            // Explicit steer is not prompt(deliverAs: steer), even when admission matches.
            const result = operation === 'steer' ? await session.steer(text, opts) : await session.prompt(text, opts);
            res.json({ success: true, result });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
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
    async function deliverText(id, text) {
        const session = await ports.getLiveSession(id) ?? await ports.wake(id);
        if (!session)
            throw (0, http_boundary_1.httpError)('the session that published this page is not running', 409);
        const followUp = ports.supports(session, 'followUp');
        const prompt = ports.supports(session, 'prompt');
        if (!followUp && !prompt)
            throw (0, http_boundary_1.httpError)('this session does not accept messages', 409);
        const admission = 'promptOrFollowUp' in session ? session.promptOrFollowUp(text) : null;
        if (!admission) {
            await session.prompt(text, prompt ? {} : { deliverAs: 'followUp' });
            return null;
        }
        const result = (0, wire_protocol_1.asRecord)(await admission);
        if (result.queued === true)
            return 'the session is compacting; the message waits in its queue';
        if (result.admitted !== true)
            return 'the session did not confirm it took the message in time';
        return null;
    }
    return {
        prompt: (req, res) => deliver(req, res, 'prompt'),
        steer: (req, res) => deliver(req, res, 'steer'),
        followUp: (req, res) => deliver(req, res, 'followUp'),
        deliverText,
    };
}
