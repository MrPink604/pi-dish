/**
 * HTTP admission for the peer-message hold (lib/session-command-handlers.js):
 * a validated peer sender inside a positive window is held instead of
 * forwarded, while W=0, a UI prompt (no sender), an explicit steer, a
 * deliverAs:steer redirect, and an attached image all go straight to the live
 * session. The hold itself is a recording stub here; lib/message-hold.js owns
 * the batching and durability tested in test/message-hold.test.js.
 *
 * Run with: npm test
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import express = require('express');
import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import { createSessionCommandHandlers } from '../lib/session-command-handlers';
import type { BridgeCapability } from '../lib/contracts';
import type { MessageHold, PeerSender } from '../lib/message-hold';
import type { LiveSession } from '../lib/session-ownership';

const PEER: PeerSender = { id: 'peer-1', ref: 'tycho/aaaa', name: 'Tycho' };
interface Held { sessionId: string; delivery: 'prompt' | 'followUp'; message: string; sender: PeerSender }
interface Prompt { text: string; options: unknown }

function harness({
  windowMs = 5_000, live = true, known = true,
  capabilities = ['prompt', 'followUp', 'steer'] as BridgeCapability[],
} = {}) {
  const held: Held[] = [];
  const prompts: Prompt[] = [];
  let steers = 0;
  const session = {
    prompt: async (text: string, options?: unknown) => { prompts.push({ text, options }); return { ok: true }; },
    steer: async (text: string) => { steers++; return { ok: true, text }; },
  };
  const hold: MessageHold = {
    enqueue(sessionId, delivery, message, sender) {
      held.push({ sessionId, delivery, message, sender });
      return { held: true, until: new Date(Date.now() + windowMs).toISOString() };
    },
    start() {}, wake() {}, stop() {},
  };
  const handlers = createSessionCommandHandlers({
    getLiveSession: async () => (live ? session as unknown as LiveSession : null),
    supports: (_session, capability) => capabilities.includes(capability),
    expandRefs: (message, refs) => (Array.isArray(refs) && refs.length ? `${String(message)} <refs>` : String(message)),
    hold,
    readSettings: () => (windowMs ? { messageHoldWindowMs: windowMs } : {}),
    sessionExists: () => known,
  });
  const app = express();
  app.use(express.json());
  app.post('/api/sessions/:id/prompt', handlers.prompt);
  app.post('/api/sessions/:id/steer', handlers.steer);
  app.post('/api/sessions/:id/follow-up', handlers.followUp);
  return { app, held, prompts, get steers() { return steers; } };
}

async function post(app: Express, requestPath: string, body: unknown) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const parsed: unknown = await response.json();
    return { status: response.status, body: (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

test('a peer prompt inside the window is held, not forwarded', async () => {
  const h = harness();
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'hello', sender: PEER });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['held', 'success', 'until']);
  assert.equal(res.body.held, true);
  assert.match(String(res.body.until), /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(h.held, [{ sessionId: 'sess-1', delivery: 'prompt', message: 'hello', sender: PEER }]);
  assert.equal(h.prompts.length, 0, 'a held message is not delivered synchronously');
});

test('the held text is the ref-expanded message', async () => {
  const h = harness();
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'hello', refs: ['#x'], sender: PEER });
  assert.equal(res.body.held, true);
  assert.equal(h.held[0].message, 'hello <refs>');
});

test('W=0 forwards immediately with no hold', async () => {
  const h = harness({ windowMs: 0 });
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'direct', sender: PEER });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal('held' in res.body, false);
  assert.equal(h.held.length, 0);
  assert.deepEqual(h.prompts, [{ text: 'direct', options: {} }]);
});

test('a UI prompt without a sender forwards immediately', async () => {
  const h = harness();
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'from the UI' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(h.held.length, 0);
  assert.equal(h.prompts.length, 1);
});

test('a malformed sender is treated as a UI prompt', async () => {
  const h = harness();
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'typo', sender: { id: 'peer-1' } });
  assert.equal(res.status, 200);
  assert.equal(h.held.length, 0);
  assert.equal(h.prompts.length, 1);
});

test('an explicit steer bypasses the hold', async () => {
  const h = harness();
  const res = await post(h.app, '/api/sessions/sess-1/steer', { message: 'steer now', sender: PEER });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(h.held.length, 0);
  assert.equal(h.steers, 1);
  assert.equal(h.prompts.length, 0);
});

test('a prompt redirected with deliverAs:steer bypasses the hold', async () => {
  const h = harness();
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'redirect', sender: PEER, deliverAs: 'steer' });
  assert.equal(res.status, 200);
  assert.equal(h.held.length, 0);
  assert.deepEqual(h.prompts, [{ text: 'redirect', options: { deliverAs: 'steer' } }]);
});

test('attached images bypass the hold and reach the live session', async () => {
  const h = harness();
  const images = [{ data: 'AAAA', mimeType: 'image/png' }];
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'look', sender: PEER, images });
  assert.equal(res.status, 200);
  assert.equal(h.held.length, 0);
  assert.deepEqual(h.prompts, [{ text: 'look', options: { images: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] } }]);
});

test('a peer follow-up holds with followUp delivery', async () => {
  const h = harness();
  const res = await post(h.app, '/api/sessions/sess-1/follow-up', { message: 'queued', sender: PEER });
  assert.equal(res.body.held, true);
  assert.deepEqual(h.held, [{ sessionId: 'sess-1', delivery: 'followUp', message: 'queued', sender: PEER }]);
});

test('a prompt redirected with deliverAs:followUp holds as a follow-up', async () => {
  const h = harness();
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'queued', sender: PEER, deliverAs: 'followUp' });
  assert.equal(res.body.held, true);
  assert.equal(h.held[0].delivery, 'followUp');
});

test('an inactive but known session still accepts a held peer message', async () => {
  const h = harness({ live: false, known: true });
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'offline peer', sender: PEER });
  assert.equal(res.status, 200);
  assert.equal(res.body.held, true);
  assert.deepEqual(h.held, [{ sessionId: 'sess-1', delivery: 'prompt', message: 'offline peer', sender: PEER }]);
});

test('an unknown session is 404 and is never held', async () => {
  const h = harness({ live: false, known: false });
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'nowhere', sender: PEER });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Session not active');
  assert.equal(h.held.length, 0);
});

test('a live session lacking the capability is 409 before any hold', async () => {
  const h = harness({ capabilities: ['followUp'] });
  const res = await post(h.app, '/api/sessions/sess-1/prompt', { message: 'nope', sender: PEER });
  assert.equal(res.status, 409);
  assert.equal(h.held.length, 0);
});
