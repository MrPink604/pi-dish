/**
 * Unit tests for lib/file-mention.js — resolving chat-mentioned filenames
 * through a session's tool-call trail, and the viewer read (caps, binary
 * detection, images).
 *
 * Run with: npm test
 */
import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');

import { normalizeMention, extractSessionPaths, resolveFileMention, readFileForViewer, readFileForContent } from '../lib/file-mention';
import { parseByteRange } from '../lib/range-response';
import { videoMimeForPath, isVideoPath } from '../lib/helper-media';

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
const toolMsg = (name: string, args: unknown) => ({
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
  assert.deepEqual(normalizeMention('`lib/a.js:42:7`,', home), { mention: 'lib/a.js', line: 42 });
  assert.deepEqual(normalizeMention('(~/x.md)', home), { mention: path.join(home, 'x.md'), line: null });
  assert.deepEqual(normalizeMention('@src/main.js', home), { mention: 'src/main.js', line: null });
  assert.deepEqual(normalizeMention('findings.md.', home), { mention: 'findings.md', line: null });
});

test('extractSessionPaths mines structured args, bash tokens, and dirnames', () => {
  const paths = extractSessionPaths(messages, cwd, home);
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

test('bare basename resolves to the most recently tool-touched file, not the cwd one', async () => {
  const r = await resolveFileMention('findings.md', { cwd, messages, home });
  assert.ok(r);
  assert.equal(r.absPath, path.join(deep, 'findings.md'));
});

test('qualified mention prefers the exact cwd-relative file', async () => {
  const r = await resolveFileMention('a/b/c/sibling.md', { cwd, messages, home });
  assert.ok(r);
  assert.equal(r.absPath, path.join(deep, 'sibling.md'));
  const top = await resolveFileMention('./findings.md', { cwd, messages, home });
  assert.ok(top);
  assert.equal(top.absPath, path.join(cwd, 'findings.md'), 'explicit ./ names the top-level file');
});

test('siblings of tool-touched files resolve by basename', async () => {
  const r = await resolveFileMention('sibling.md', { cwd, messages, home });
  assert.ok(r);
  assert.equal(r.absPath, path.join(deep, 'sibling.md'));
});

test('files outside the cwd resolve only via the tool trail', async () => {
  const r = await resolveFileMention('notes.md', { cwd, messages, home });
  assert.ok(r);
  assert.equal(r.absPath, path.join(scratch, 'notes.md'));
  // Same file, no tool trail → not reachable.
  assert.equal(await resolveFileMention('notes.md', { cwd, messages: [], home }), null);
});

test('traversal and absolute paths outside the session reach are rejected', async () => {
  const secret = path.join(root, 'secret.txt');
  assert.equal(await resolveFileMention(`../../secret.txt`, { cwd, messages, home }), null);
  assert.equal(await resolveFileMention(secret, { cwd, messages, home }), null);
  // But an absolute path under the cwd is fine.
  const ok = await resolveFileMention(path.join(deep, 'findings.md'), { cwd, messages: [], home });
  assert.ok(ok);
  assert.equal(ok.absPath, path.join(deep, 'findings.md'));
});

test('falls back to file search under cwd for untracked files', async () => {
  // README.md never appears in tool calls; the walker fallback finds it.
  const r = await resolveFileMention('README.md', { cwd, messages, home });
  assert.ok(r);
  assert.equal(r.absPath, path.join(cwd, 'README.md'));
});

test('mentions carry :line through resolution', async () => {
  const r = await resolveFileMention('sibling.md:12', { cwd, messages, home });
  assert.ok(r);
  assert.equal(r.absPath, path.join(deep, 'sibling.md'));
  assert.equal(r.line, 12);
});

test('readFileForViewer: text, truncation flag, binary rejection, images', () => {
  const t = readFileForViewer(path.join(deep, 'findings.md'));
  assert.ok('content' in t && typeof t.content === 'string');
  assert.equal(t.content, 'deep findings\n');
  assert.equal(t.truncated, false);
  assert.ok(t.size > 0);

  const binPath = path.join(cwd, 'blob.bin');
  fs.writeFileSync(binPath, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
  const b = readFileForViewer(binPath);
  assert.ok('error' in b);
  assert.ok(b.error, 'binary files refuse a text preview');

  const pngPath = path.join(cwd, 'shot.png');
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  fs.writeFileSync(pngPath, pngBytes);
  const img = readFileForViewer(pngPath);
  assert.ok('image' in img && img.image);
  assert.equal(img.image.mimeType, 'image/png');
  assert.equal(img.image.data, pngBytes.toString('base64'), 'PNG served as base64 despite NUL bytes');

  const expectedVideos: readonly [string, string][] = [
    ['clip.mp4', 'video/mp4'],
    ['movie.m4v', 'video/mp4'],
    ['capture.webm', 'video/webm'],
    ['iphone.MOV', 'video/quicktime'],
    ['sample.ogv', 'video/ogg'],
    ['recording.mkv', 'video/x-matroska'],
  ];
  for (const [name, expectedMime] of expectedVideos) {
    const vidPath = path.join(cwd, name);
    const bytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x00]);
    fs.writeFileSync(vidPath, bytes);
    const vid = readFileForViewer(vidPath);
    assert.ok('video' in vid && vid.video, `${name} returns video metadata`);
    assert.equal(vid.video.mimeType, expectedMime);
    assert.equal(vid.size, bytes.length);
  }

  // 3D models (.glb/.gltf) return model metadata; raw companions (.ktx2/.bin)
  // remain rejected for preview (415) while permitted for raw /file/content.
  const glbPath = path.join(cwd, 'weapon.glb');
  const glbBytes = Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0x00]);
  fs.writeFileSync(glbPath, glbBytes);
  const glbPreview = readFileForViewer(glbPath);
  assert.ok('model' in glbPreview && glbPreview.model);
  assert.equal(glbPreview.model.mimeType, 'model/gltf-binary');
  assert.equal(glbPreview.size, glbBytes.length);
  const glbRaw = readFileForContent(glbPath);
  assert.ok('mimeType' in glbRaw && glbRaw.mimeType === 'model/gltf-binary');

  const gltfPath = path.join(cwd, 'scene.gltf');
  fs.writeFileSync(gltfPath, '{"asset":{"version":"2.0"}}');
  const gltfPreview = readFileForViewer(gltfPath);
  assert.ok('model' in gltfPreview && gltfPreview.model);
  assert.equal(gltfPreview.model.mimeType, 'model/gltf+json');

  const ktxPath = path.join(cwd, 'albedo.ktx2');
  const ktxBytes = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  fs.writeFileSync(ktxPath, ktxBytes);
  const ktxPreview = readFileForViewer(ktxPath);
  assert.ok('error' in ktxPreview && ktxPreview.status === 415);
  const ktxRaw = readFileForContent(ktxPath);
  assert.ok('mimeType' in ktxRaw && ktxRaw.mimeType === 'image/ktx2' && ktxRaw.size === ktxBytes.length);

  const binRaw = readFileForContent(binPath);
  assert.ok('mimeType' in binRaw && binRaw.mimeType === 'application/octet-stream');

  const exePath = path.join(cwd, 'program.dat');
  fs.writeFileSync(exePath, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
  const exeRaw = readFileForContent(exePath);
  assert.ok('error' in exeRaw && exeRaw.status === 415, 'unrelated binary files remain rejected on /file/content');
});

test('videoMimeForPath and parseByteRange handle video extensions and RFC 9110 byte ranges', () => {
  assert.equal(videoMimeForPath('demo.mp4?v=1#t=2'), 'video/mp4');
  assert.equal(videoMimeForPath('dir/clip.m4v:10'), 'video/mp4');
  assert.equal(videoMimeForPath('https://example.com/a.WEBM'), 'video/webm');
  assert.equal(videoMimeForPath('notes.txt'), null);
  assert.equal(videoMimeForPath('.mp4'), null);
  assert.equal(isVideoPath('clip.mkv'), true);
  assert.equal(isVideoPath('clip.png'), false);

  // iOS Safari initial probe + open/suffix/clamped/invalid ranges
  assert.deepEqual(parseByteRange('bytes=0-1', 100), { start: 0, end: 1 });
  assert.deepEqual(parseByteRange('bytes=10-20', 100), { start: 10, end: 20 });
  assert.deepEqual(parseByteRange('bytes=50-', 100), { start: 50, end: 99 });
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange('bytes=-500', 100), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange('bytes=0-9999', 100), { start: 0, end: 99 });
  assert.equal(parseByteRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=20-10', 100), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=-0', 100), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=0-0', 0), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=0-1, 4-5', 100), null);
  assert.equal(parseByteRange('items=0-1', 100), null);
  assert.equal(parseByteRange('bytes=abc-def', 100), null);
  assert.equal(parseByteRange(undefined, 100), null);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
