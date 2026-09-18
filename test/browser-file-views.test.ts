import { assertBrowserApiContext } from './browser-vm.js';
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
assertBrowserApiContext(context);
const { decodeFilePreview, decodeDiffView, renderDiffViewHtml } = context.PiDishBrowser;
test('file and diff wire decoding rejects missing file paths and narrows nested fields', () => {
  assert.throws(() => decodeFilePreview({ content: 'text' }), /Invalid file preview/);
  const file = decodeFilePreview({ path: '/tmp/a', content: {}, size: Infinity, image: { url: '/image', data: {} } });
  assert.equal(file.content, ''); assert.equal(file.size, 0); assert.ok(file.image); assert.equal(file.image.data, '');
  const wire = { root: '/tmp', gitAvailable: true, repos: [null, { path: 'repo', files: [null, { path: 'a', patch: {}, additions: '3' }] }] };
  const diff = decodeDiffView(wire); const repo = diff.repos[0]; assert.ok(repo); const changed = repo.files[0]; assert.ok(changed); assert.equal(diff.repos.length, 1); assert.equal(repo.files.length, 1); assert.equal(changed.patch, ''); assert.equal(changed.additions, 0);
  const wireRepo = wire.repos[1]; assert.ok(wireRepo); const wireFile = wireRepo.files[1]; assert.ok(wireFile); assert.equal(wireFile.additions, '3');
});
test('diff render escapes repository and file attributes while preserving deferred snapshot identity', () => {
  const html = renderDiffViewHtml(decodeDiffView({ gitAvailable: true, snapshotId: '"snapshot', repos: [{ path: '"><img>', branch: '<script>', files: [{ path: 'a"b', patchDeferred: true, status: '<M>' }] }] }));
  assert.equal(html.includes('<img>'), false); assert.equal(html.includes('<script>'), false);
  assert.match(html, /data-path="a&quot;b"/); assert.match(html, /data-snapshot="&quot;snapshot"/); assert.match(html, /data-deferred="1"/);
});

export {};
