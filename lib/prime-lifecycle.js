'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { createLineSplitter } = require('./line-splitter');
const { PendingRequests } = require('./pending-requests');
const { processIdentityAlive } = require('./process-identity');

// Prime 0.9.4 sets these in the resident worker, not in its TUI client.
// Read only these non-secret routing fields; never copy worker credentials
// into Dish's registry or use a guessed/default daemon socket. Older hosts
// without this evidence remain uncloseable. Like our pane ownership proof,
// this discovery is Linux-only and fenced by the process birth identity.
function primeWorkerTarget(entry) {
  if (!processIdentityAlive(entry)) return null;
  try {
    const wanted = new Set([
      'PRIME_AGENT_INTERNAL_DAEMON_WORKER',
      'PRIME_AGENT_INTERNAL_DAEMON_WORKER_ACTIVE_SESSION_ID',
      'PRIME_AGENT_INTERNAL_DAEMON_SUPERVISOR_SOCKET',
    ]);
    const env = {};
    for (const item of fs.readFileSync(`/proc/${entry.pid}/environ`, 'utf8').split('\0')) {
      const split = item.indexOf('=');
      const key = item.slice(0, split);
      if (wanted.has(key)) env[key] = item.slice(split + 1);
    }
    const socket = env.PRIME_AGENT_INTERNAL_DAEMON_SUPERVISOR_SOCKET;
    const activeSessionId = env.PRIME_AGENT_INTERNAL_DAEMON_WORKER_ACTIVE_SESSION_ID;
    if (env.PRIME_AGENT_INTERNAL_DAEMON_WORKER !== '1'
        || !socket || !path.isAbsolute(socket) || !activeSessionId
        || !processIdentityAlive(entry)) return null;
    return { socket, activeSessionId };
  } catch { return null; }
}

// Use Prime's public supervisor protocol, never its private worker socket or
// process signals. No reconnect/retry: a lost kill response is indeterminate.
async function stopPrimeWorker(entry, beforeStop, { timeout = 10000 } = {}) {
  const target = primeWorkerTarget(entry);
  if (!target) throw new Error('Prime worker daemon identity is unavailable');
  const pending = new PendingRequests();
  const socket = net.createConnection(target.socket);
  const hello = pending.track('hello', { timeout, label: 'Prime daemon hello' });
  socket.on('error', error => pending.failAll(error));
  socket.on('close', () => pending.failAll(new Error('Prime daemon socket closed')));
  socket.on('data', createLineSplitter(line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message?.type === 'daemon_hello') pending.settle('hello', true, message);
    if (message?.type === 'response') {
      pending.settle(message.id, message.success === true, message.data, message.error);
    }
  }));
  const clientId = `pi-dish:${crypto.randomUUID()}`;
  const protocol = { name: 'prime-agent.daemon', version: 7 };
  const request = command => {
    const id = crypto.randomUUID();
    const result = pending.track(id, { timeout, label: `Prime ${command.type}` });
    socket.write(JSON.stringify({ type: 'command', id, protocol, clientId, command: { ...command, id } }) + '\n');
    return result;
  };
  let stopRequested = false;
  try {
    const greeting = await hello;
    if (greeting.protocol?.name !== protocol.name || greeting.protocol?.version !== protocol.version) {
      throw new Error('Unsupported Prime daemon lifecycle protocol');
    }
    const roster = await request({ type: 'list' });
    const matches = roster?.sessions?.filter(row => row.activeSessionId === target.activeSessionId);
    const root = matches?.length === 1 ? matches[0] : null;
    if (!root || root.workerPid !== entry.pid || root.sessionFile !== entry.sessionFile
        || root.parentActiveSessionId || root.parentSessionId || root.runtimeKind === 'subagent') {
      throw new Error('Prime daemon roster does not match the owned root worker');
    }
    await beforeStop();
    const fresh = primeWorkerTarget(entry);
    if (!fresh || fresh.socket !== target.socket || fresh.activeSessionId !== target.activeSessionId) {
      throw new Error('Prime worker identity changed before stop');
    }
    stopRequested = true;
    await request({ type: 'kill', activeSessionId: target.activeSessionId });
    const deadline = Date.now() + timeout;
    while (processIdentityAlive(entry) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (processIdentityAlive(entry)) throw new Error('Prime worker did not exit after stop; no signal escalation was attempted');
  } catch (error) {
    error.stopRequested = stopRequested;
    throw error;
  } finally {
    socket.destroy();
  }
}

module.exports = { primeWorkerTarget, stopPrimeWorker };
