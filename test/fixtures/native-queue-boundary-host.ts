import assert from 'node:assert/strict';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { Agent } from '@earendil-works/pi-agent-core';
import { piPrivate } from '../../extensions/pi-dish-bridge/pi-private.js';

type HostRecord = Record<PropertyKey, unknown>;
function record(value: unknown): value is HostRecord {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}
function method(target: HostRecord, name: PropertyKey): (...args: unknown[]) => unknown {
  const value = target[name];
  if (typeof value !== 'function') throw new Error(`native queue fixture requires ${String(name)}`);
  return (...args: unknown[]) => Reflect.apply(value, target, args);
}
function call(target: HostRecord, name: PropertyKey, ...args: unknown[]): unknown {
  return method(target, name)(...args);
}

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
  if (!record(agent)) throw new Error('native queue fixture failed to create agent');
  // Use the actual SDK queue producers and capture patch, without creating
  // a provider-backed session. Only the malformed mirror is fixture-owned.
  const session: unknown = Object.assign(Object.create(AgentSession.prototype), {
    agent, _eventListeners: [], _steeringMessages: [], _followUpMessages: [],
  });
  if (!record(session)) throw new Error('native queue fixture failed to create session');
  const release = call(session, 'subscribe', () => {});
  if (typeof release !== 'function') throw new Error('native queue fixture subscription is invalid');
  const queued: Array<{ text: string; images: Array<{ type: string; mimeType: string; data: string }> }> = [
    { text: 'duplicate', images: [{ type: 'image', mimeType: 'image/png', data: 'first' }] },
    { text: 'other', images: [] },
    { text: 'duplicate', images: [{ type: 'image', mimeType: 'image/gif', data: 'second' }] },
  ];
  for (const { text, images } of queued) {
    await call(session, kind === 'steering' ? '_queueSteer' : '_queueFollowUp', text, images);
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
  await call(agent, 'prompt', 'drain queued messages');
  const state = agent.state;
  if (!record(state) || !Array.isArray(state.messages)) throw new Error('native queue fixture agent state is invalid');
  const delivered = state.messages.flatMap((message: unknown) => {
    if (!record(message) || message.role !== 'user' || !Array.isArray(message.content)) return [];
    const first = message.content[0];
    return record(first) && first.text === 'drain queued messages' ? [] : [message.content];
  });
  assert.deepEqual(delivered, queued.map(({ text, images }) =>
    [{ type: 'text', text }, ...images]), 'a rejected edit preserves delivery order and both duplicate images');
  Reflect.apply(release, undefined, []);
}
console.log('Pi malformed queue alignment passed');
