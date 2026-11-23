// Generated test/tool from test/upload-handlers.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Composer file uploads (lib/upload-handlers.js): the body streams to a fresh
 * per-upload directory under the session's upload folder, names are reduced to
 * one safe path component, the size limit is enforced before and while
 * streaming, and the reply carries the prompt line naming the stored file.
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const upload_handlers_1 = require("../lib/upload-handlers");
const file_handlers_1 = require("../lib/file-handlers");
const attachment_text_1 = require("../lib/attachment-text");
const SESSION = '2026-11-21T10-00-00-uploads';
const MAX_BYTES = 64;
async function serve(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-uploads-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const handlers = (0, upload_handlers_1.createUploadHandlers)({ root: () => root, maxBytes: () => MAX_BYTES });
    const app = express();
    app.use(express.json());
    app.get('/api/sessions/:id/uploads', handlers.limits);
    app.post('/api/sessions/:id/uploads', handlers.upload);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', () => resolve()));
    t.after(() => new Promise(resolve => server.close(() => resolve())));
    const base = `http://127.0.0.1:${server.address().port}/api/sessions/${SESSION}/uploads`;
    return { root, handlers, base, sessionDir: path.join(root, `pi-${SESSION}`) };
}
/** Regular files below `directory`, relative to it. */
function filesUnder(directory) {
    if (!fs.existsSync(directory))
        return [];
    return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile()).map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)));
}
test('an upload is stored under its session with a safe name and named in a prompt line', async (t) => {
    const { base, sessionDir } = await serve(t);
    const response = await fetch(`${base}?${new URLSearchParams({ name: '../../.ssh/My "report"?.txt', type: 'Text/Plain; charset=utf-8' })}`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'hello world',
    });
    assert.equal(response.status, 200);
    const stored = await response.json();
    const file = String(stored.path);
    assert.equal(path.dirname(path.dirname(file)), sessionDir);
    assert.equal(path.basename(file), 'My _report__.txt');
    assert.equal(fs.readFileSync(file, 'utf8'), 'hello world');
    assert.equal((fs.statSync(file).mode & 0o777), 0o600);
    assert.deepEqual({ name: stored.name, originalName: stored.originalName, mimeType: stored.mimeType, size: stored.size }, { name: 'My _report__.txt', originalName: '../../.ssh/My "report"?.txt', mimeType: 'text/plain', size: 11 });
    assert.equal(stored.reference, `[Attached file: ${file} (original name "../../.ssh/My "report"?.txt", text/plain, 11 B)]`);
    assert.deepEqual(filesUnder(sessionDir), [path.relative(sessionDir, file)], 'no partial file remains');
    const limits = await (await fetch(base)).json();
    assert.deepEqual(limits, { maxBytes: MAX_BYTES, directory: sessionDir });
});
test('the same name uploaded twice keeps both files', async (t) => {
    const { base, sessionDir } = await serve(t);
    const paths = [];
    for (const body of ['first', 'second']) {
        const response = await fetch(`${base}?name=clip.mp3&type=audio%2Fmpeg`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body });
        paths.push(String((await response.json()).path));
    }
    assert.notEqual(paths[0], paths[1]);
    assert.deepEqual(paths.map(file => fs.readFileSync(file, 'utf8')), ['first', 'second']);
    assert.equal(filesUnder(sessionDir).length, 2);
});
test('an upload over the limit is refused, declared or streamed, and leaves nothing behind', async (t) => {
    const { base, sessionDir } = await serve(t);
    const declared = await fetch(`${base}?name=big.mp4&type=video%2Fmp4`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'x'.repeat(MAX_BYTES + 1),
    });
    assert.equal(declared.status, 413);
    assert.match(String((await declared.json()).error), /64 B upload limit \(PI_DISH_UPLOAD_MAX_MB\)/);
    // Chunked: no Content-Length to refuse up front, so the stream is cut.
    const outcome = await new Promise((resolve) => {
        const req = http.request(`${base}?name=big.mp4`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' } }, (res) => {
            res.resume();
            res.on('end', () => resolve(`status ${res.statusCode}`));
        });
        req.on('error', () => resolve('connection closed'));
        req.write('x'.repeat(MAX_BYTES));
        setImmediate(() => req.end('x'.repeat(MAX_BYTES)));
    });
    assert.ok(outcome === 'connection closed' || outcome === 'status 413', outcome);
    // Cleanup runs after the cut; poll for it rather than sleeping a guessed time.
    for (let attempt = 0; attempt < 200 && filesUnder(sessionDir).length; attempt++)
        await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(filesUnder(sessionDir), []);
});
test('only octet-stream bodies and valid session routes are accepted', async (t) => {
    const { base, root } = await serve(t);
    const json = await fetch(`${base}?name=data.json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(json.status, 415);
    const invalid = await fetch(base.replace(SESSION, '~sk1_malformed'), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'x' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(fs.readdirSync(root), []);
});
test('session directories never leave the upload root and are removed with the session', async (t) => {
    const { root, handlers, base, sessionDir } = await serve(t);
    for (const id of ['..', '.', 'a:b.c']) {
        const directory = (0, upload_handlers_1.sessionUploadDir)(root, id);
        assert.ok(directory && path.dirname(directory) === root && /^pi-[A-Za-z0-9_-]+$/.test(path.basename(directory)), String(directory));
    }
    assert.equal((0, upload_handlers_1.sessionUploadDir)(root, '../escape'), null);
    await fetch(`${base}?name=a.txt`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'a' });
    assert.ok(fs.existsSync(sessionDir));
    handlers.removeSession(SESSION);
    assert.equal(fs.existsSync(sessionDir), false);
});
test('upload names, sizes and limits are formatted for people and agents', () => {
    assert.equal((0, attachment_text_1.safeUploadName)('.env'), 'env');
    assert.equal((0, attachment_text_1.safeUploadName)('..'), 'file');
    assert.equal((0, attachment_text_1.safeUploadName)(''), 'file');
    assert.equal((0, attachment_text_1.safeUploadName)('a\\b/c\nd.txt'), 'c_d.txt');
    const long = (0, attachment_text_1.safeUploadName)(`${'é'.repeat(200)}.tar.gz`);
    assert.ok(Buffer.byteLength(long) <= 150 && long.endsWith('.gz'), long);
    assert.deepEqual([0, 912, 4300, 2.1 * 1024 * 1024, 730 * 1024 * 1024].map(attachment_text_1.formatByteSize), ['0 B', '912 B', '4.2 KB', '2.1 MB', '730 MB']);
    assert.equal((0, attachment_text_1.attachmentReference)({ path: '/u/report.pdf', name: 'report.pdf', originalName: 'report.pdf', mimeType: 'application/pdf', size: 2.1 * 1024 * 1024 }), '[Attached file: /u/report.pdf (application/pdf, 2.1 MB)]');
    assert.equal((0, upload_handlers_1.uploadMaxBytes)({}), 512 * 1024 * 1024);
    assert.equal((0, upload_handlers_1.uploadMaxBytes)({ PI_DISH_UPLOAD_MAX_MB: '2' }), 2 * 1024 * 1024);
    assert.equal((0, upload_handlers_1.uploadMaxBytes)({ PI_DISH_UPLOAD_MAX_MB: 'nope' }), 512 * 1024 * 1024);
});
test('uploaded text and video files resolve in the file viewer for their own session only', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-upload-view-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-upload-cwd-'));
    t.after(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(cwd, { recursive: true, force: true });
    });
    const uploads = (0, upload_handlers_1.createUploadHandlers)({ root: () => root, maxBytes: () => 4096 });
    const files = (0, file_handlers_1.createFileHandlers)({
        resolveSessionCwd: () => cwd,
        findSessionSource: () => null,
        uploadRoot: () => root,
    });
    const app = express();
    app.post('/api/sessions/:id/uploads', uploads.upload);
    app.get('/api/sessions/:id/file', files.filePreview);
    app.get('/api/sessions/:id/file/content', files.fileContent);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', () => resolve()));
    t.after(() => new Promise(resolve => server.close(() => resolve())));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const txtUp = await (await fetch(`${origin}/api/sessions/${SESSION}/uploads?name=notes.txt&type=text%2Fplain`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'uploaded note',
    })).json();
    const mp4Up = await (await fetch(`${origin}/api/sessions/${SESSION}/uploads?name=clip.mp4&type=video%2Fmp4`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('000000186674797069736f6d', 'hex'),
    })).json();
    const previewRes = await fetch(`${origin}/api/sessions/${SESSION}/file?path=${encodeURIComponent(String(txtUp.path))}`);
    assert.equal(previewRes.status, 200);
    const preview = await previewRes.json();
    assert.equal(preview.content, 'uploaded note');
    const videoRes = await fetch(`${origin}/api/sessions/${SESSION}/file/content?path=${encodeURIComponent(String(mp4Up.path))}`);
    assert.equal(videoRes.status, 200);
    assert.equal(videoRes.headers.get('content-type'), 'video/mp4');
    // Another session must never read this session's uploads.
    const otherRes = await fetch(`${origin}/api/sessions/2026-11-21T10-00-00-other/file?path=${encodeURIComponent(String(txtUp.path))}`);
    assert.equal(otherRes.status, 404);
});
