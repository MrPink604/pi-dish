// Generated test/tool from test/agy-import.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Import and staleness tests against the scripted fake agent: `session/list`
 * discovers external conversations, `session/load` rebuilds their mirrors, and
 * a stale mirror is re-imported (with the previous transcript kept) either by
 * the import runtime or by resume. No `agy` install and no provider traffic.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-import-'));
process.env.HOME = tmp;
const workDir = path.join(tmp, 'work');
fs.mkdirSync(workDir, { recursive: true });
fs.writeFileSync(path.join(workDir, 'README.md'), '# scratch\n');
fs.writeFileSync(path.join(workDir, 'calc.py'), 'def add(a, b):\n    return a - b\n');
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-agy-acp.js');
process.env.PI_DISH_AGY_COMMAND = `${process.execPath} ${FIXTURE}`;
const acp = require('../lib/acp-session.js');
const transcript = require('../lib/acp-transcript.js');
const importer = require('../lib/agy-import.js');
const discovery = require('../lib/session-discovery.js');
const harnesses = require('../lib/harnesses.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
function entries(file) {
    return fs.readFileSync(file, 'utf8').trim().split('\n').flatMap((line) => {
        try {
            const value = JSON.parse(line);
            return value && typeof value === 'object' && !Array.isArray(value) ? [value] : [];
        }
        catch {
            return [];
        }
    });
}
function mirroredMessages(file) {
    return entries(file).flatMap((entry) => {
        const message = entry.message;
        return entry.type === 'message' && message && typeof message === 'object' && !Array.isArray(message)
            ? [message]
            : [];
    });
}
function contentText(message) {
    const content = Array.isArray(message.content) ? message.content : [];
    return content.flatMap((block) => {
        if (!block || typeof block !== 'object')
            return [];
        const value = block;
        return value.type === 'text' && typeof value.text === 'string' ? [value.text] : [];
    }).join('\n');
}
function seedStaleMirror(id) {
    const file = path.join(acp.agyMirrorRoot(), `${id}.jsonl`);
    const sidecar = file.replace(/\.jsonl$/, '.acp.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const at = new Date(Date.now() - 60 * 60_000).toISOString();
    const header = { type: 'session', version: 3, id, cwd: workDir, timestamp: at, agy: { version: '1.5.10' } };
    const entry = {
        type: 'message', id: 'old-user-entry', parentId: null, timestamp: at,
        message: { role: 'user', content: [{ type: 'text', text: 'prompt from before the import' }], timestamp: Date.parse(at) },
    };
    fs.writeFileSync(file, JSON.stringify(header) + '\n' + JSON.stringify(entry) + '\n');
    fs.writeFileSync(sidecar, JSON.stringify({ t: 1, dir: 'in', msg: { marker: 'before-import' } }) + '\n');
    return { file, sidecar };
}
function mockAgyList(rows) {
    process.env.FAKE_AGY_LIST = JSON.stringify(rows);
}
test('imports an external conversation into a discoverable mirror', async () => {
    const id = crypto.randomUUID();
    mockAgyList([{ sessionId: id, cwd: workDir, title: 'TUI Readme Review', updatedAt: new Date().toISOString() }]);
    const runtime = importer.createAgyImportRuntime({ log: () => { } });
    const outcome = await runtime.run('test');
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.imported.length, 1);
    assert.equal(outcome.imported[0].sessionId, id);
    assert.equal(outcome.imported[0].backup, null, 'a first import has nothing to back up');
    const file = outcome.imported[0].file;
    assert.equal(file, path.join(acp.agyMirrorRoot(), `${id}.jsonl`));
    const header = transcript.readAcpMirrorHeader(file);
    assert.equal(header.id, id);
    assert.equal(header.cwd, workDir);
    assert.equal(header.agentVersion, '1.5.10');
    assert.equal(header.imported?.source, 'session/load');
    assert.ok(header.imported && header.imported.at > 0);
    const messages = mirroredMessages(file);
    assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'toolResult', 'assistant', 'user', 'assistant', 'toolResult', 'assistant']);
    assert.match(contentText(messages[0]), /Read README\.md/);
    const firstBlocks = Array.isArray(messages[1].content) ? messages[1].content : [];
    assert.equal(firstBlocks[0]?.type, 'toolCall');
    assert.equal(firstBlocks[0]?.name, 'read');
    assert.match(contentText(messages[3]), /single heading/);
    assert.equal(messages[2].toolName, 'read');
    assert.match(contentText(messages[2]), /content not reported by agy/);
    assert.equal(messages[6].toolName, 'edit');
    assert.match(contentText(messages[6]), /\+.*return a \+ b/);
    assert.match(contentText(messages[7]), /Fixed add\(\)\./);
    const title = entries(file).find(entry => entry.type === 'session_info');
    assert.equal(title?.name, 'TUI Readme Review');
    const descriptor = harnesses.getHarness('agy');
    assert.ok(descriptor);
    const found = discovery.discoverSessionCandidates(acp.agyMirrorRoot(), { descriptor });
    assert.ok(found.candidates.some(candidate => candidate.nativeSessionId === id && candidate.file === file), 'the imported mirror is discovered as an agy session');
});
test('re-imports a stale mirror and keeps the previous transcript and sidecar', async () => {
    const id = crypto.randomUUID();
    const { file, sidecar } = seedStaleMirror(id);
    mockAgyList([{ sessionId: id, cwd: workDir, title: 'Stale TUI', updatedAt: new Date().toISOString() }]);
    const runtime = importer.createAgyImportRuntime({ log: () => { } });
    const outcome = await runtime.run('test');
    assert.equal(outcome.imported.length, 1);
    const backup = outcome.imported[0].backup;
    assert.ok(backup, 'the previous mirror is kept');
    assert.match(fs.readFileSync(backup, 'utf8'), /prompt from before the import/);
    const backups = fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.bak')).sort();
    assert.ok(backups.some(name => name.startsWith(`${id}.jsonl.`)), 'mirror backup exists');
    assert.ok(backups.some(name => name.startsWith(`${id}.acp.jsonl.`)), 'sidecar backup exists');
    assert.ok(fs.existsSync(sidecar) && fs.statSync(sidecar).size > 0, 'a fresh sidecar records the replay');
    const header = transcript.readAcpMirrorHeader(file);
    assert.equal(header.imported?.source, 'session/load');
    assert.ok(transcript.readAcpMirrorLastTimestamp(file) > Date.now() - 60_000, 'the mirror was rebuilt');
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /prompt from before the import/);
});
test('skips conversations that a live relay already owns', async (t) => {
    const live = await acp.createAcpSession({
        cwd: workDir,
        command: process.execPath,
        args: [FIXTURE],
        env: { ...process.env, FAKE_AGY_SCRIPT: 'default' },
    });
    t.after(async () => {
        await live.close().catch(() => { });
        await acp.shutdownAcpSessions();
    });
    mockAgyList([{ sessionId: live.id, cwd: workDir, title: 'Live Conversation', updatedAt: new Date().toISOString() }]);
    const runtime = importer.createAgyImportRuntime({ log: () => { } });
    const outcome = await runtime.run('test');
    assert.deepEqual(outcome.live, [live.id]);
    assert.equal(outcome.imported.length, 0);
    assert.equal(transcript.readAcpMirrorHeader(live.sessionFile).imported, null, 'the live mirror was not replaced');
});
test('resume of a stale mirror loads the newer agy history instead of resuming', async (t) => {
    const id = crypto.randomUUID();
    const { file } = seedStaleMirror(id);
    const options = {
        command: process.execPath,
        args: [FIXTURE],
        env: {
            ...process.env,
            FAKE_AGY_SCRIPT: 'default',
            FAKE_AGY_LIST: JSON.stringify([{
                    sessionId: id, cwd: workDir, title: 'TUI Continued History', updatedAt: new Date().toISOString(),
                }]),
        },
    };
    const session = await acp.resumeAcpSession(file, options);
    t.after(async () => {
        await session.close().catch(() => { });
        await acp.shutdownAcpSessions();
    });
    assert.equal(session.state.sessionName, 'TUI Continued History', 'the load result supplied the title');
    assert.equal(transcript.readAcpMirrorHeader(file).imported?.source, 'session/load');
    const messages = mirroredMessages(file);
    assert.ok(messages.some(message => contentText(message).includes('Read README.md')), 'the replayed history is in the mirror');
    assert.ok(!messages.some(message => contentText(message).includes('prompt from before the import')), 'the stale mirror was replaced, not appended to');
    assert.ok(fs.readdirSync(path.dirname(file)).some(name => name.includes('.bak')), 'the old mirror is kept');
});
