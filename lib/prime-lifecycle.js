// Generated from src/core/prime-lifecycle.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.primeWorkerTarget = primeWorkerTarget;
exports.stopPrimeWorker = stopPrimeWorker;
const fs = require("fs");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const promises_1 = require("timers/promises");
const line_splitter_1 = require("./line-splitter");
const pending_requests_1 = require("./pending-requests");
const process_identity_1 = require("./process-identity");
const helper_values_1 = require("./helper-values");
function workerEntry(value) {
    return (0, helper_values_1.record)(value)
        && (typeof value.pid === 'number' || typeof value.pid === 'string')
        && (typeof value.startTime === 'number' || typeof value.startTime === 'string');
}
// Prime 0.9.4 sets these in the resident worker, not in its TUI client.
// Read only these non-secret routing fields; never copy worker credentials
// into Dish's registry or use a guessed/default daemon socket. Older hosts
// without this evidence remain uncloseable. Like our pane ownership proof,
// this discovery is Linux-only and fenced by the process birth identity.
function primeWorkerTarget(entry) {
    if (!workerEntry(entry) || !(0, process_identity_1.processIdentityAlive)(entry))
        return null;
    try {
        const env = {};
        for (const item of fs.readFileSync(`/proc/${entry.pid}/environ`, 'utf8').split('\0')) {
            const split = item.indexOf('=');
            const key = item.slice(0, split);
            if (key === 'PRIME_AGENT_INTERNAL_DAEMON_WORKER'
                || key === 'PRIME_AGENT_INTERNAL_DAEMON_WORKER_ACTIVE_SESSION_ID'
                || key === 'PRIME_AGENT_INTERNAL_DAEMON_SUPERVISOR_SOCKET')
                env[key] = item.slice(split + 1);
        }
        const socket = env.PRIME_AGENT_INTERNAL_DAEMON_SUPERVISOR_SOCKET;
        const activeSessionId = env.PRIME_AGENT_INTERNAL_DAEMON_WORKER_ACTIVE_SESSION_ID;
        if (env.PRIME_AGENT_INTERNAL_DAEMON_WORKER !== '1'
            || !socket || !path.isAbsolute(socket) || !activeSessionId
            || !(0, process_identity_1.processIdentityAlive)(entry))
            return null;
        return { socket, activeSessionId };
    }
    catch {
        return null;
    }
}
// Use Prime's public supervisor protocol, never its private worker socket or
// process signals. No reconnect/retry: a lost kill response is indeterminate.
async function stopPrimeWorker(entry, beforeStop, { timeout = 10000 } = {}) {
    const target = primeWorkerTarget(entry);
    if (!target || !workerEntry(entry))
        throw new Error('Prime worker daemon identity is unavailable');
    const pending = new pending_requests_1.PendingRequests();
    const socket = net.createConnection(target.socket);
    const hello = pending.track('hello', { timeout, label: 'Prime daemon hello' });
    socket.on('error', error => pending.failAll(error));
    socket.on('close', () => pending.failAll(new Error('Prime daemon socket closed')));
    socket.on('data', (0, line_splitter_1.createLineSplitter)(line => {
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            return;
        }
        if (!(0, helper_values_1.record)(message))
            return;
        if (message.type === 'daemon_hello')
            pending.settle('hello', true, message);
        if (message.type === 'response' && (typeof message.id === 'string' || typeof message.id === 'number')) {
            pending.settle(message.id, message.success === true, message.data, message.error ? String(message.error) : undefined);
        }
    }));
    const clientId = `pi-dish:${crypto.randomUUID()}`;
    const protocol = { name: 'prime-agent.daemon', version: 7 };
    const request = (command) => {
        const id = crypto.randomUUID();
        const result = pending.track(id, { timeout, label: `Prime ${command.type}` });
        socket.write(JSON.stringify({ type: 'command', id, protocol, clientId, command: { ...command, id } }) + '\n');
        return result;
    };
    let stopRequested = false;
    try {
        const greeting = await hello;
        if (!(0, helper_values_1.record)(greeting) || !(0, helper_values_1.record)(greeting.protocol)
            || greeting.protocol.name !== protocol.name || greeting.protocol.version !== protocol.version) {
            throw new Error('Unsupported Prime daemon lifecycle protocol');
        }
        const roster = await request({ type: 'list' });
        const matches = (0, helper_values_1.record)(roster) && Array.isArray(roster.sessions)
            ? roster.sessions.filter((row) => {
                // An unreadable row invalidates the roster; do not discard evidence and
                // turn a malformed response into permission to stop a matching worker.
                if (row == null)
                    throw new TypeError('Prime daemon roster contains an unreadable worker entry');
                return (0, helper_values_1.record)(row) && row.activeSessionId === target.activeSessionId;
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
        while ((0, process_identity_1.processIdentityAlive)(entry) && Date.now() < deadline) {
            await (0, promises_1.setTimeout)(100);
        }
        if ((0, process_identity_1.processIdentityAlive)(entry))
            throw new Error('Prime worker did not exit after stop; no signal escalation was attempted');
    }
    catch (error) {
        const failure = Object.assign(error instanceof Error ? error : new Error(String(error)), { stopRequested });
        throw failure;
    }
    finally {
        socket.destroy();
    }
}
