const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeFilePreview, decodeDiffView, renderDiffViewHtml } = context.PiDishBrowser;
test('file and diff wire decoding rejects missing file paths and narrows nested fields', () => {
  assert.throws(() => decodeFilePreview({ content: 'text' }), /Invalid file preview/);
  const file = decodeFilePreview({ path: '/tmp/a', content: {}, size: Infinity, image: { url: '/image', data: {} } });
  assert.equal(file.content, ''); assert.equal(file.size, 0); assert.equal(file.image.data, '');
  const wire = { root: '/tmp', gitAvailable: true, repos: [null, { path: 'repo', files: [null, { path: 'a', patch: {}, additions: '3' }] }] };
  const diff = decodeDiffView(wire); assert.equal(diff.repos.length, 1); assert.equal(diff.repos[0].files.length, 1); assert.equal(diff.repos[0].files[0].patch, ''); assert.equal(diff.repos[0].files[0].additions, 0);
  assert.equal(wire.repos[1].files[1].additions, '3');
});
test('diff render escapes repository and file attributes while preserving deferred snapshot identity', () => {
  const html = renderDiffViewHtml(decodeDiffView({ gitAvailable: true, snapshotId: '"snapshot', repos: [{ path: '"><img>', branch: '<script>', files: [{ path: 'a"b', patchDeferred: true, status: '<M>' }] }] }));
  assert.equal(html.includes('<img>'), false); assert.equal(html.includes('<script>'), false);
  assert.match(html, /data-path="a&quot;b"/); assert.match(html, /data-snapshot="&quot;snapshot"/); assert.match(html, /data-deferred="1"/);
});
