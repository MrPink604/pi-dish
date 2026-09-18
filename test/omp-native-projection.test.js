// Generated test/tool from test/omp-native-projection.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const wire_protocol_js_1 = require("../lib/wire-protocol.js");
const { BridgeSession } = require('../lib/bridge-session');
async function waitFor(predicate, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = predicate();
        if (value)
            return value;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('condition timeout');
}
// The fake host patches a stand-in AgentSession with native-state's real
// prototype capture, so a step here moves state exactly the way OMP does: call
// the setter, let the capture publish. Each step is acked so the test drives
// the transitions instead of racing a timer against them.
async function startFakeHost() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-native-'));
    const home = path.join(root, 'home');
    const socketDir = path.join(root, 'sockets');
    const stepFile = path.join(root, 'native-step.json');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    const child = (0, node_child_process_1.spawn)('bun', [path.join(__dirname, 'fixtures', 'fake-omp-bridge-host.ts')], {
        cwd: path.resolve(__dirname, '..'),
        env: {
            ...process.env,
            HOME: home,
            PI_DISH_SOCKET_DIR: socketDir,
            FAKE_OMP_SESSION_FILE: path.join(root, 'fake-omp.jsonl'),
            FAKE_OMP_HAS_COMPACT: '0',
            FAKE_OMP_NATIVE_STEP_FILE: stepFile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    try {
        await new Promise((resolve, reject) => {
            let stdout = '';
            const timer = setTimeout(() => reject(new Error(`fake host timeout: ${stderr}`)), 8000);
            child.stdout.on('data', chunk => {
                stdout += chunk;
                if (stdout.includes('READY')) {
                    clearTimeout(timer);
                    resolve();
                }
            });
            child.once('exit', code => reject(new Error(`fake host exited ${code}: ${stderr}`)));
        });
    }
    catch (error) {
        child.kill('SIGTERM');
        fs.rmSync(root, { recursive: true, force: true });
        throw error;
    }
    const registryDir = path.join(home, '.pi', 'dish', 'sessions');
    const registryName = fs.readdirSync(registryDir).find(name => name.endsWith('.json'));
    if (!registryName)
        throw new Error('Fake OMP host did not register');
    const registryPath = path.join(registryDir, registryName);
    let seq = 0;
    return {
        claim: JSON.parse(fs.readFileSync(registryPath, 'utf8')),
        async step(patch) {
            const current = ++seq;
            fs.writeFileSync(stepFile, JSON.stringify({ seq: current, ...patch }));
            await waitFor(() => fs.existsSync(`${stepFile}.ack`)
                && fs.readFileSync(`${stepFile}.ack`, 'utf8') === String(current));
        },
        async close() {
            child.kill('SIGTERM');
            await new Promise(resolve => child.once('exit', () => resolve()));
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}
async function nextStatus(requests, from, statusKey) {
    const request = await waitFor(() => requests.slice(from)
        .find(request => request.method === 'setStatus' && request.statusKey === statusKey));
    return { statusText: typeof request.statusText === 'string' ? request.statusText : undefined };
}
test('OMP bridge projects captured goal-mode transitions as a status', async () => {
    const host = await startFakeHost();
    const session = new BridgeSession(host.claim);
    const requests = [];
    session.on('extension_ui_request', (request) => { if ((0, wire_protocol_js_1.isRecord)(request))
        requests.push(request); });
    try {
        await session.connect();
        let from = requests.length;
        await host.step({
            todos: [{ name: 'Implementation', tasks: [{ content: 'Wire goal state', status: 'in_progress' }] }],
            goal: {
                enabled: true,
                mode: 'active',
                goal: {
                    id: 'goal-1', objective: 'Ship the compaction fix', status: 'active',
                    tokenBudget: 50000, tokensUsed: 12300, timeUsedSeconds: 90,
                },
            },
        });
        assert.equal((await nextStatus(requests, from, 'goal')).statusText, 'Goal · Ship the compaction fix · 12.3K/50K tok');
        from = requests.length;
        await host.step({
            goal: {
                enabled: true,
                mode: 'active',
                goal: {
                    id: 'goal-1', objective: 'Ship the compaction fix', status: 'paused',
                    tokenBudget: 50000, tokensUsed: 12300, timeUsedSeconds: 120,
                },
            },
        });
        assert.equal((await nextStatus(requests, from, 'goal')).statusText, 'Goal · Ship the compaction fix · paused · 12.3K/50K tok');
        // A finished goal is history, not status: the line clears.
        from = requests.length;
        await host.step({
            goal: {
                enabled: true,
                mode: 'exiting',
                reason: 'completed',
                goal: {
                    id: 'goal-1', objective: 'Ship the compaction fix', status: 'complete',
                    tokenBudget: 50000, tokensUsed: 41000, timeUsedSeconds: 300,
                },
            },
        });
        assert.equal((await nextStatus(requests, from, 'goal')).statusText, undefined);
        const objective = 'Rewrite the native projection layer so goal mode\nand advisor state reach the phone';
        from = requests.length;
        await host.step({
            goal: {
                enabled: true,
                mode: 'active',
                goal: { id: 'goal-2', objective, status: 'active', tokensUsed: 900, timeUsedSeconds: 5 },
            },
        });
        const clipped = (await nextStatus(requests, from, 'goal')).statusText;
        assert.equal(clipped, `Goal · ${objective.replace('\n', ' ').slice(0, 59)}…`);
        assert.equal(clipped.includes('\n'), false, 'the status line stays single-line');
        assert.equal(clipped.includes('tok'), false, 'a budget-less goal shows no budget');
        // Dropping the goal state entirely (OMP clears it on exit) also clears.
        from = requests.length;
        await host.step({ goal: null });
        assert.equal((await nextStatus(requests, from, 'goal')).statusText, undefined);
    }
    finally {
        session.close();
        await host.close();
    }
});
test('OMP bridge projects captured advisor state as a status', async () => {
    const host = await startFakeHost();
    const session = new BridgeSession(host.claim);
    const requests = [];
    session.on('extension_ui_request', (request) => { if ((0, wire_protocol_js_1.isRecord)(request))
        requests.push(request); });
    try {
        await session.connect();
        let from = requests.length;
        await host.step({ advisor: { enabled: true, active: true, advisors: [{ name: 'reviewer', status: 'running' }] } });
        assert.equal((await nextStatus(requests, from, 'advisor')).statusText, 'Advisor on');
        from = requests.length;
        await host.step({
            advisor: {
                enabled: true,
                active: true,
                advisors: [
                    { name: 'reviewer', status: 'running' },
                    { name: 'security', status: 'paused' },
                    { name: 'perf', status: 'quota_exhausted' },
                ],
            },
        });
        assert.equal((await nextStatus(requests, from, 'advisor')).statusText, 'Advisor on · 3 advisors');
        // Enabled but no model resolved: nothing is actually watching.
        from = requests.length;
        await host.step({ advisor: { enabled: true, active: false, advisors: [{ name: 'reviewer', status: 'no_model' }] } });
        assert.equal((await nextStatus(requests, from, 'advisor')).statusText, 'Advisor · no model');
        // OMP can activate an advisor after background model discovery without a
        // setter call. Its normal status-line read must refresh the projection.
        from = requests.length;
        await host.step({ advisor: {
                enabled: true, active: true, readOnly: true,
                advisors: [{ name: 'reviewer', status: 'running' }],
            } });
        assert.equal((await nextStatus(requests, from, 'advisor')).statusText, 'Advisor on');
        from = requests.length;
        await host.step({ advisor: { enabled: false, active: false, advisors: [] } });
        assert.equal((await nextStatus(requests, from, 'advisor')).statusText, undefined);
        assert.equal(requests.some(request => request.statusKey === 'goal'), false, 'a session with no goal never emits a goal status');
    }
    finally {
        session.close();
        await host.close();
    }
});
