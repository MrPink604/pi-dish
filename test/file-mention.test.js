// Generated tool from test/file-mention.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for lib/file-mention.js — resolving chat-mentioned filenames
 * through a session's tool-call trail, and the viewer read (caps, binary
 * detection, images).
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const file_mention_1 = require("../lib/file-mention");
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-mention-'));
const home = path.join(root, 'home');
const cwd = path.join(home, 'proj');
const deep = path.join(cwd, 'a', 'b', 'c');
const scratch = path.join(root, 'scratch'); // outside cwd and home
fs.mkdirSync(deep, { recursive: true });
fs.mkdirSync(scratch, { recursive: true });
fs.writeFileSync(path.join(cwd, 'README.md'), '# top\n');
fs.writeFileSync(path.join(cwd, 'findings.md'), 'stale top-level findings\n');
fs.writeFileSync(path.join(deep, 'findings.md'), 'deep findings\n');
fs.writeFileSync(path.join(deep, 'sibling.md'), 'sibling of the written file\n');
fs.writeFileSync(path.join(scratch, 'notes.md'), 'scratch notes\n');
fs.writeFileSync(path.join(root, 'secret.txt'), 'outside everything\n');
// A session whose agent read the top-level findings first, then wrote the
// deep one (recency should prefer the deep file for a bare mention), touched
// a scratch file outside the cwd, and cd'd around in bash.
const toolMsg = (name, args) => ({
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'x', name, arguments: args }],
});
const messages = [
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    toolMsg('read', { path: 'findings.md' }),
    toolMsg('read', { path: path.join(scratch, 'notes.md') }),
    toolMsg('bash', { command: `cat ${deep}/findings.md | wc -l` }),
    toolMsg('write', { path: path.join(deep, 'findings.md'), content: 'deep findings\n' }),
];
test('normalizeMention strips decorations and extracts :line', () => {
    assert.deepEqual((0, file_mention_1.normalizeMention)('`lib/a.js:42:7`,', home), { mention: 'lib/a.js', line: 42 });
    assert.deepEqual((0, file_mention_1.normalizeMention)('(~/x.md)', home), { mention: path.join(home, 'x.md'), line: null });
    assert.deepEqual((0, file_mention_1.normalizeMention)('@src/main.js', home), { mention: 'src/main.js', line: null });
    assert.deepEqual((0, file_mention_1.normalizeMention)('findings.md.', home), { mention: 'findings.md', line: null });
});
test('extractSessionPaths mines structured args, bash tokens, and dirnames', () => {
    const paths = (0, file_mention_1.extractSessionPaths)(messages, cwd, home);
    assert.ok(paths.has(path.join(deep, 'findings.md')), 'write path');
    assert.ok(paths.has(deep), 'dirname of written file');
    assert.ok(paths.has(path.join(scratch, 'notes.md')), 'absolute read outside cwd');
    assert.ok(paths.has(path.join(cwd, 'findings.md')), 'relative read resolved against cwd');
    // Recency: the write (later) outranks the bash mention (earlier).
    const deepIndex = paths.get(path.join(deep, 'findings.md'));
    const scratchIndex = paths.get(path.join(scratch, 'notes.md'));
    assert.ok(typeof deepIndex === 'number' && typeof scratchIndex === 'number');
    assert.ok(deepIndex > scratchIndex);
});
test('extractSessionPaths rejects a null message instead of silently losing its trail', () => {
    assert.throws(() => (0, file_mention_1.extractSessionPaths)([null], cwd, home), TypeError);
});
test('bare basename resolves to the most recently tool-touched file, not the cwd one', async () => {
    const r = await (0, file_mention_1.resolveFileMention)('findings.md', { cwd, messages, home });
    assert.ok(r);
    assert.equal(r.absPath, path.join(deep, 'findings.md'));
});
test('qualified mention prefers the exact cwd-relative file', async () => {
    const r = await (0, file_mention_1.resolveFileMention)('a/b/c/sibling.md', { cwd, messages, home });
    assert.ok(r);
    assert.equal(r.absPath, path.join(deep, 'sibling.md'));
    const top = await (0, file_mention_1.resolveFileMention)('./findings.md', { cwd, messages, home });
    assert.ok(top);
    assert.equal(top.absPath, path.join(cwd, 'findings.md'), 'explicit ./ names the top-level file');
});
test('siblings of tool-touched files resolve by basename', async () => {
    const r = await (0, file_mention_1.resolveFileMention)('sibling.md', { cwd, messages, home });
    assert.ok(r);
    assert.equal(r.absPath, path.join(deep, 'sibling.md'));
});
test('files outside the cwd resolve only via the tool trail', async () => {
    const r = await (0, file_mention_1.resolveFileMention)('notes.md', { cwd, messages, home });
    assert.ok(r);
    assert.equal(r.absPath, path.join(scratch, 'notes.md'));
    // Same file, no tool trail → not reachable.
    assert.equal(await (0, file_mention_1.resolveFileMention)('notes.md', { cwd, messages: [], home }), null);
});
test('traversal and absolute paths outside the session reach are rejected', async () => {
    const secret = path.join(root, 'secret.txt');
    assert.equal(await (0, file_mention_1.resolveFileMention)(`../../secret.txt`, { cwd, messages, home }), null);
    assert.equal(await (0, file_mention_1.resolveFileMention)(secret, { cwd, messages, home }), null);
    // But an absolute path under the cwd is fine.
    const ok = await (0, file_mention_1.resolveFileMention)(path.join(deep, 'findings.md'), { cwd, messages: [], home });
    assert.ok(ok);
    assert.equal(ok.absPath, path.join(deep, 'findings.md'));
});
test('falls back to file search under cwd for untracked files', async () => {
    // README.md never appears in tool calls; the walker fallback finds it.
    const r = await (0, file_mention_1.resolveFileMention)('README.md', { cwd, messages, home });
    assert.ok(r);
    assert.equal(r.absPath, path.join(cwd, 'README.md'));
});
test('mentions carry :line through resolution', async () => {
    const r = await (0, file_mention_1.resolveFileMention)('sibling.md:12', { cwd, messages, home });
    assert.ok(r);
    assert.equal(r.absPath, path.join(deep, 'sibling.md'));
    assert.equal(r.line, 12);
});
test('readFileForViewer: text, truncation flag, binary rejection, images', () => {
    const t = (0, file_mention_1.readFileForViewer)(path.join(deep, 'findings.md'));
    assert.ok('content' in t && typeof t.content === 'string');
    assert.equal(t.content, 'deep findings\n');
    assert.equal(t.truncated, false);
    assert.ok(t.size > 0);
    const binPath = path.join(cwd, 'blob.bin');
    fs.writeFileSync(binPath, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
    const b = (0, file_mention_1.readFileForViewer)(binPath);
    assert.ok('error' in b);
    assert.ok(b.error, 'binary files refuse a text preview');
    const pngPath = path.join(cwd, 'shot.png');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    fs.writeFileSync(pngPath, pngBytes);
    const img = (0, file_mention_1.readFileForViewer)(pngPath);
    assert.ok('image' in img && img.image);
    assert.equal(img.image.mimeType, 'image/png');
    assert.equal(img.image.data, pngBytes.toString('base64'), 'PNG served as base64 despite NUL bytes');
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
