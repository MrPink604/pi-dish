import fs = require('fs');
import net = require('net');
import path = require('path');
import crypto = require('crypto');
import { setTimeout as delay } from 'timers/promises';
import type { ProcessIdentityInput } from './contracts';
import { createLineSplitter } from './line-splitter';
import { PendingRequests } from './pending-requests';
import { processIdentityAlive } from './process-identity';
import { record } from './helper-values';

/** Routing observation of one exact live worker, not reusable stop authority. */
export interface PrimeWorkerTarget {
  socket: string;
  activeSessionId: string;
}

export interface PrimeStopError extends Error {
  /** Dispatch started; a lost reply remains indeterminate and must not relaunch. */
  stopRequested: boolean;
}

interface PrimeWorkerEntry extends ProcessIdentityInput, Record<string, unknown> {}

function workerEntry(value: unknown): value is PrimeWorkerEntry {
  return record(value)
    && (typeof value.pid === 'number' || typeof value.pid === 'string')
    && (typeof value.startTime === 'number' || typeof value.startTime === 'string');
}

// Prime 0.9.4 sets these in the resident worker, not in its TUI client.
// Read only these non-secret routing fields; never copy worker credentials
// into Dish's registry or use a guessed/default daemon socket. Older hosts
// without this evidence remain uncloseable. Like our pane ownership proof,
// this discovery is Linux-only and fenced by the process birth identity.
export function primeWorkerTarget(entry: unknown): PrimeWorkerTarget | null {
  if (!workerEntry(entry) || !processIdentityAlive(entry)) return null;
  try {
    const env: Record<string, string> = {};
    for (const item of fs.readFileSync(`/proc/${entry.pid}/environ`, 'utf8').split('\0')) {
      const split = item.indexOf('=');
      const key = item.slice(0, split);
      if (key === 'PRIME_AGENT_INTERNAL_DAEMON_WORKER'
          || key === 'PRIME_AGENT_INTERNAL_DAEMON_WORKER_ACTIVE_SESSION_ID'
          || key === 'PRIME_AGENT_INTERNAL_DAEMON_SUPERVISOR_SOCKET') env[key] = item.slice(split + 1);
    }
    const socket = env.PRIME_AGENT_INTERNAL_DAEMON_SUPERVISOR_SOCKET;
    const activeSessionId = env.PRIME_AGENT_INTERNAL_DAEMON_WORKER_ACTIVE_SESSION_ID;
    if (env.PRIME_AGENT_INTERNAL_DAEMON_WORKER !== '1'
        || !socket || !path.isAbsolute(socket) || !activeSessionId
        || !processIdentityAlive(entry)) return null;
    return { socket, activeSessionId };
  } catch { return null; }
}

type PrimeCommand = { type: 'list' } | { type: 'kill'; activeSessionId: string };

// Use Prime's public supervisor protocol, never its private worker socket or
// process signals. No reconnect/retry: a lost kill response is indeterminate.
export async function stopPrimeWorker(entry: unknown, beforeStop: () => void | Promise<void>, { timeout = 10000 } = {}): Promise<void> {
  const target = primeWorkerTarget(entry);
  if (!target || !workerEntry(entry)) throw new Error('Prime worker daemon identity is unavailable');
  const pending = new PendingRequests();
  const socket = net.createConnection(target.socket);
  const hello = pending.track('hello', { timeout, label: 'Prime daemon hello' });
  socket.on('error', error => pending.failAll(error));
  socket.on('close', () => pending.failAll(new Error('Prime daemon socket closed')));
  socket.on('data', createLineSplitter(line => {
    let message: unknown;
    try { message = JSON.parse(line); } catch { return; }
    if (!record(message)) return;
    if (message.type === 'daemon_hello') pending.settle('hello', true, message);
    if (message.type === 'response' && (typeof message.id === 'string' || typeof message.id === 'number')) {
      pending.settle(message.id, message.success === true, message.data, message.error ? String(message.error) : undefined);
    }
  }));
  const clientId = `pi-dish:${crypto.randomUUID()}`;
  const protocol = { name: 'prime-agent.daemon', version: 7 };
  const request = (command: PrimeCommand): Promise<unknown> => {
    const id = crypto.randomUUID();
    const result = pending.track(id, { timeout, label: `Prime ${command.type}` });
    socket.write(JSON.stringify({ type: 'command', id, protocol, clientId, command: { ...command, id } }) + '\n');
    return result;
  };
  let stopRequested = false;
  try {
    const greeting = await hello;
    if (!record(greeting) || !record(greeting.protocol)
        || greeting.protocol.name !== protocol.name || greeting.protocol.version !== protocol.version) {
      throw new Error('Unsupported Prime daemon lifecycle protocol');
    }
    const roster = await request({ type: 'list' });
    const matches = record(roster) && Array.isArray(roster.sessions)
      ? roster.sessions.filter((row: unknown): row is Record<string, unknown> => {
        // An unreadable row invalidates the roster; do not discard evidence and
        // turn a malformed response into permission to stop a matching worker.
        if (row == null) throw new TypeError('Prime daemon roster contains an unreadable worker entry');
        return record(row) && row.activeSessionId === target.activeSessionId;
      })
      : null;
    const root = matches?.length === 1 ? matches[0] : null;
    if (!root || root.workerPid !== entry.pid
        || root.sessionFile !== entry.sessionFile
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
      await delay(100);
    }
    if (processIdentityAlive(entry)) throw new Error('Prime worker did not exit after stop; no signal escalation was attempted');
  } catch (error) {
    const failure: PrimeStopError = Object.assign(error instanceof Error ? error : new Error(String(error)), { stopRequested });
    throw failure;
  } finally {
    socket.destroy();
  }
}
