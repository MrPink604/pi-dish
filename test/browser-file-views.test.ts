import { loadBrowser } from './browser-vm.js';
import test = require('node:test');
import assert = require('node:assert/strict');
const { decodeFilePreview, decodeDiffView, renderDiffViewHtml, renderVideoPlayerHtml } = loadBrowser();
test('file and diff wire decoding rejects missing file paths and narrows nested fields', () => {
  assert.throws(() => decodeFilePreview({ content: 'text' }), /Invalid file preview/);
  const file = decodeFilePreview({ path: '/tmp/a', content: {}, size: Infinity, image: { url: '/image', data: {} }, video: { url: '/video', mimeType: 'video/mp4' } });
  assert.equal(file.content, ''); assert.equal(file.size, 0); assert.ok(file.image); assert.equal(file.image.data, '');
  assert.ok(file.video); assert.equal(file.video.url, '/video'); assert.equal(file.video.mimeType, 'video/mp4');
  const wire = { root: '/tmp', gitAvailable: true, repos: [null, { path: 'repo', files: [null, { path: 'a', patch: {}, additions: '3' }] }] };
  const diff = decodeDiffView(wire); const repo = diff.repos[0]; assert.ok(repo); const changed = repo.files[0]; assert.ok(changed); assert.equal(diff.repos.length, 1); assert.equal(repo.files.length, 1); assert.equal(changed.patch, ''); assert.equal(changed.additions, 0);
  const wireRepo = wire.repos[1]; assert.ok(wireRepo); const wireFile = wireRepo.files[1]; assert.ok(wireFile); assert.equal(wireFile.additions, '3');
});
test('video player markup uses preload=metadata, never autoplays, and escapes untrusted metadata', () => {
  const html = renderVideoPlayerHtml({
    src: '/api/sessions/s1/file/content?path=clip.mp4',
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    variant: 'inline',
    filePath: 'dir/a<b>"clip.mp4',
  });
  assert.match(html, /<video[^>]+controls[^>]+playsinline[^>]+preload="metadata"/);
  assert.doesNotMatch(html, /\bautoplay\b/i);
  assert.match(html, /<details class="video-disclosure" open><summary class="video-summary">/);
  assert.match(html, /<span class="video-filename" title="a&lt;b&gt;&quot;clip\.mp4">a&lt;b&gt;&quot;clip\.mp4<\/span>/);
  assert.equal(html.includes('<b>'), false);
  assert.match(html, /video-step-back/);
  assert.match(html, /video-step-fwd/);
  assert.match(html, /video-speed/);
  assert.match(html, /video-fallback/);
  assert.match(html, /data-file-path="dir\/a&lt;b&gt;&quot;clip\.mp4"/);
  const unsafe = renderVideoPlayerHtml({ src: 'javascript:alert(1)', variant: 'viewer' });
  assert.match(unsafe, /src="#"/);
});
test('diff render escapes repository and file attributes while preserving deferred snapshot identity', () => {
  const html = renderDiffViewHtml(decodeDiffView({ gitAvailable: true, snapshotId: '"snapshot', repos: [{ path: '"><img>', branch: '<script>', files: [{ path: 'a"b', patchDeferred: true, status: '<M>' }] }] }));
  assert.equal(html.includes('<img>'), false); assert.equal(html.includes('<script>'), false);
  assert.match(html, /data-path="a&quot;b"/); assert.match(html, /data-snapshot="&quot;snapshot"/); assert.match(html, /data-deferred="1"/);
});

export {};
