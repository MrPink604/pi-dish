const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeComposerImages, mergeComposerText } = context.PiDishBrowser;
test('composer image payloads are copied and exclude unsupported or malformed media', () => {
  const wire = [{ data: 'abc', mimeType: 'image/png', extra: 'ignored' }, { data: 1, mimeType: 'image/png' }, { data: 'x', mimeType: 'audio/webm' }, null];
  const images = decodeComposerImages(wire); assert.equal(images.length, 1); assert.equal(images[0].data, 'abc'); assert.equal(images[0].extra, undefined);
  wire[0].data = 'changed'; assert.equal(images[0].data, 'abc');
});
test('restored composer text preserves both distinct drafts without duplicating equal text', () => {
  assert.equal(mergeComposerText('', 'restored'), 'restored'); assert.equal(mergeComposerText(' existing ', 'existing'), 'existing'); assert.equal(mergeComposerText('current', 'restored'), 'current\n\nrestored');
});
