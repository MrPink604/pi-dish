// Generated test/tool from test/fixtures/fake-prime-daemon.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.primeRow = primeRow;
exports.startFakePrimeDaemon = startFakePrimeDaemon;
/**
 * A fake Prime daemon (protocol `prime-agent.daemon` v7) on a Unix socket.
 *
 * Mirrors the wire behavior pi-dish relies on: one hello frame per connection,
 * `command` requests answered with `response` frames, and `session_event`
 * frames pushed only to connections that `attach`ed. The roster is the mutable
 * `rows` array, so a test can add, mutate or remove agents between refreshes.
 * Node-test fixtures only; never touches a real Prime install.
 */
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const node_events_1 = require("node:events");
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
/** One root roster row with every field the daemon client reads. */
function primeRow(overrides = {}) {
    const native = typeof overrides.sessionId === 'string' ? overrides.sessionId : 'prime-native-1';
    return {
        activeSessionId: 'prime-active-1',
        sessionId: native,
        sessionFile: path.join('/tmp', `${native}.jsonl`),
        cwd: '/tmp',
        lifecycle: 'live',
        activity: 'idle',
        isStreaming: false,
        isCompacting: false,
        workerPid: 4242,
        workerInstanceId: 'prime-worker-1',
        attachedClients: 1,
        sessionName: 'Prime One',
        model: { provider: 'prime', id: 'prime-model' },
        thinkingLevel: 'medium',
        sessionActions: { queuedCount: 0, steering: [], followUps: [] },
        rlmDepth: 0,
        runtimeKind: 'root',
        created: '2026-01-01T00:00:00.000Z',
        lastActivityAt: '2026-01-01T00:00:01.000Z',
        ...overrides,
    };
}
async function startFakePrimeDaemon(socketPath, options = {}) {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true });
    try {
        fs.unlinkSync(socketPath);
    }
    catch { }
    const rows = options.rows ?? [];
    const commands = [];
    const sockets = new Set();
    const attached = new Set();
    let connections = 0;
    function respondDefault(command) {
        switch (command.type) {
            case 'list':
                return { data: { sessions: rows } };
            case 'attach':
                attached.add(String(command.activeSessionId));
                return { data: { snapshot: options.attachSnapshot ?? {} } };
            case 'detach':
                attached.delete(String(command.activeSessionId));
                return { data: {} };
            case 'kill':
                for (let i = rows.length - 1; i >= 0; i--) {
                    if (rows[i].activeSessionId === command.activeSessionId)
                        rows.splice(i, 1);
                }
                return { data: {} };
            case 'get_commands':
                return { data: { commands: [{ name: 'compact' }, { name: 'model' }, { name: 'reload' }, { name: 'branch' }] } };
            case 'get_available_models':
                return { data: { models: [{ provider: 'prime', id: 'prime-model', name: 'Prime Model' }] } };
            case 'get_session_stats':
                return { data: { contextUsage: { tokens: 10, percent: 0.1, contextWindow: 100 } } };
            case 'get_session_tree':
                return { data: options.sessionTree ?? { flatNodes: [], leafId: null } };
            case 'navigate_tree':
                return { data: { cancelled: false, editorText: '' } };
            case 'export_html':
                return { data: { path: '/tmp/prime-export.html' } };
            case 'mutate_queued_message':
                return { data: { status: 'applied' } };
            case 'get_state':
                return { data: { isStreaming: false, isCompacting: false } };
            default:
                return { data: {} };
        }
    }
    const server = net.createServer(socket => {
        connections += 1;
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => { });
        socket.write(JSON.stringify({
            type: 'daemon_hello',
            protocol: { name: 'prime-agent.daemon', version: options.protocolVersion ?? 7 },
            serverCapabilities: [],
        }) + '\n');
        let buffer = '';
        socket.on('data', chunk => {
            buffer += chunk.toString('utf8');
            for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                let message;
                try {
                    message = JSON.parse(line);
                }
                catch {
                    continue;
                }
                const frame = record(message);
                if (frame.type !== 'command')
                    continue;
                const command = record(frame.command);
                if (typeof command.type !== 'string')
                    continue;
                commands.push(command);
                const reply = options.respond?.(command) ?? respondDefault(command);
                const payload = {
                    type: 'response', id: frame.id, command: command.type,
                    success: !reply.error, ...(reply.error ? { error: reply.error } : { data: reply.data ?? {} }),
                };
                try {
                    socket.write(JSON.stringify(payload) + '\n');
                }
                catch { }
            }
        });
    });
    const listening = (0, node_events_1.once)(server, 'listening');
    server.listen(socketPath);
    await listening;
    return {
        socketPath,
        rows,
        commands,
        get connections() { return connections; },
        emit(activeSessionId, event) {
            if (!attached.has(activeSessionId))
                return;
            const frame = JSON.stringify({ type: 'session_event', activeSessionId, event }) + '\n';
            for (const socket of sockets) {
                try {
                    socket.write(frame);
                }
                catch { }
            }
        },
        async close() {
            for (const socket of sockets) {
                try {
                    socket.destroy();
                }
                catch { }
            }
            sockets.clear();
            const closed = (0, node_events_1.once)(server, 'close');
            server.close();
            await closed;
            try {
                fs.unlinkSync(socketPath);
            }
            catch { }
        },
    };
}
