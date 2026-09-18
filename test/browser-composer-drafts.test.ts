import { assertBrowserApiContext } from './browser-vm.js';
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
assertBrowserApiContext(context);
const { decodeComposerImages, mergeComposerText } = context.PiDishBrowser;
test('composer image payloads are copied and exclude unsupported or malformed media', () => {
  const wire = [{ data: 'abc', mimeType: 'image/png', extra: 'ignored' }, { data: 1, mimeType: 'image/png' }, { data: 'x', mimeType: 'audio/webm' }, null];
  const images = decodeComposerImages(wire); assert.equal(images.length, 1); const image = images[0]; assert.ok(image); assert.equal(image.data, 'abc'); assert.equal(Object.hasOwn(image, 'extra'), false);
  wire[0]!.data = 'changed'; assert.equal(image.data, 'abc');
});
test('restored composer text preserves both distinct drafts without duplicating equal text', () => {
  assert.equal(mergeComposerText('', 'restored'), 'restored'); assert.equal(mergeComposerText(' existing ', 'existing'), 'existing'); assert.equal(mergeComposerText('current', 'restored'), 'current\n\nrestored');
});

export {};
