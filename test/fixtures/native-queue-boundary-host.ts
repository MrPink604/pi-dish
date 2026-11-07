import assert from 'node:assert/strict';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { Agent } from '@earendil-works/pi-agent-core';
import { piPrivate } from '../../extensions/pi-dish-bridge/pi-private.js';
import { callHost, isObject } from '../../extensions/pi-dish-bridge/host.js';

const reply = {
  role: 'assistant',
  content: [],
  api: 'fixture',
  provider: 'fixture',
  model: 'fixture',
  stopReason: 'stop',
  timestamp: 0,
  usage: {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};
const kinds: readonly ('steering' | 'followUp')[] = ['steering', 'followUp'];
for (const kind of kinds) {
  const agent: unknown = Reflect.construct(Agent, [{
    streamFn: () => ({
      async *[Symbol.asyncIterator]() { yield { type: 'done', reason: 'stop', message: reply }; },
      async result() { return reply; },
    }),
  }]);
  if (!isObject(agent)) throw new Error('native queue fixture failed to create agent');
  // Use the actual SDK queue producers and capture patch, without creating
  // a provider-backed session. Only the malformed mirror is fixture-owned.
  const session: unknown = Object.assign(Object.create(AgentSession.prototype), {
    agent, _eventListeners: [], _steeringMessages: [], _followUpMessages: [],
  });
  if (!isObject(session)) throw new Error('native queue fixture failed to create session');
  const release = callHost(session, 'subscribe', () => {});
  if (typeof release !== 'function') throw new Error('native queue fixture subscription is invalid');
  const queued: Array<{ text: string; images: Array<{ type: string; mimeType: string; data: string }> }> = [
    { text: 'duplicate', images: [{ type: 'image', mimeType: 'image/png', data: 'first' }] },
    { text: 'other', images: [] },
    { text: 'duplicate', images: [{ type: 'image', mimeType: 'image/gif', data: 'second' }] },
  ];
  for (const { text, images } of queued) {
    await callHost(session, kind === 'steering' ? '_queueSteer' : '_queueFollowUp', text, images);
  }
  const queue = session[kind === 'steering' ? '_steeringMessages' : '_followUpMessages'];
  if (!Array.isArray(queue)) throw new Error('native queue fixture queue is invalid');
  if (kind === 'steering') queue.pop();
  else queue[2] = 'changed display';
  const before = piPrivate.readQueue();
  assert.throws(
    () => piPrivate.cancelQueued(kind, kind === 'steering' ? 0 : 2,
      kind === 'steering' ? 'duplicate' : 'changed display'),
    kind === 'steering' ? /queues are out of sync/ : /message already delivered or queue changed/,
  );
  assert.deepEqual(piPrivate.readQueue(), before, 'a rejected edit leaves the displayed queue intact');
  await callHost(agent, 'prompt', 'drain queued messages');
  const state = agent.state;
  if (!isObject(state) || !Array.isArray(state.messages)) throw new Error('native queue fixture agent state is invalid');
  const delivered = state.messages.flatMap((message: unknown) => {
    if (!isObject(message) || message.role !== 'user' || !Array.isArray(message.content)) return [];
    const first = message.content[0];
    return isObject(first) && first.text === 'drain queued messages' ? [] : [message.content];
  });
  assert.deepEqual(delivered, queued.map(({ text, images }) =>
    [{ type: 'text', text }, ...images]), 'a rejected edit preserves delivery order and both duplicate images');
  Reflect.apply(release, undefined, []);
}
console.log('Pi malformed queue alignment passed');
