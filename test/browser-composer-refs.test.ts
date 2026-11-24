import { loadBrowser } from './browser-vm.js';
import test = require('node:test');
import assert = require('node:assert/strict');

const {
  FILE_REF_NAME_MAX,
  sanitizeAttachmentRefName,
  formatAttachmentToken,
  formatAttachmentBadge,
  insertTokensAtSelection,
  findTokenRanges,
  atomicDeleteRange,
  removeTokensFromText,
  rewriteTokensInText,
  resolveAttachmentsForSend,
  appendFileManifest,
  formatPromptForHistory,
  decodeDraftRefs,
} = loadBrowser();

/** Copies VM-realm plain objects/arrays into the test realm for deepStrictEqual. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test('sanitizeAttachmentRefName strips unsafe characters and truncates while preserving short extensions', () => {
  assert.equal(sanitizeAttachmentRefName('report.pdf'), 'report.pdf');
  assert.equal(sanitizeAttachmentRefName('dir/sub/[weird]\r\nname.txt'), 'weird name.txt');
  assert.equal(sanitizeAttachmentRefName('   \n\t  '), 'file');
  const longPdf = sanitizeAttachmentRefName('quarterly-revenue-summary-2026.pdf');
  assert.ok(Array.from(longPdf).length <= FILE_REF_NAME_MAX);
  assert.ok(longPdf.endsWith('….pdf'), `expected ellipsis + .pdf, got ${longPdf}`);
  const longNoExt = sanitizeAttachmentRefName('abcdefghijklmnopqrstuvwxyz0123456789');
  assert.equal(Array.from(longNoExt).length, FILE_REF_NAME_MAX);
  assert.ok(longNoExt.endsWith('…'));
});

test('formatAttachmentToken and badge produce stable canonical labels', () => {
  assert.equal(formatAttachmentToken({ kind: 'image', refId: 1 }), '[Image #1]');
  assert.equal(formatAttachmentToken({ kind: 'file', refId: 2, name: 'notes.txt' }), '[File #2: notes.txt]');
  assert.equal(formatAttachmentBadge(3), '#3');
});

test('insertTokensAtSelection handles empty, trailing, mid-sentence, and selection replacement cleanly', () => {
  assert.deepEqual(plain(insertTokensAtSelection('', 0, 0, ['[Image #1]'])), {
    value: '[Image #1] ', caret: 11, inserted: '[Image #1] ', start: 0, end: 0,
  });
  assert.equal(insertTokensAtSelection('Compare', 7, 7, ['[Image #1]']).value, 'Compare [Image #1] ');
  assert.equal(insertTokensAtSelection('Compare ', 8, 8, ['[Image #1]']).value, 'Compare [Image #1] ');
  const mid = insertTokensAtSelection('Compare and contrast', 8, 8, ['[Image #1]']);
  assert.equal(mid.value, 'Compare [Image #1] and contrast');
  assert.equal(mid.caret, 19);
  const beforeSpace = insertTokensAtSelection('Compare and contrast', 7, 7, ['[Image #1]']);
  assert.equal(beforeSpace.value, 'Compare [Image #1] and contrast');
  assert.equal(beforeSpace.caret, 18);
  const replaced = insertTokensAtSelection('Check foo please', 6, 9, ['[File #1: a.pdf]']);
  assert.equal(replaced.value, 'Check [File #1: a.pdf] please');
  assert.equal(replaced.caret, 22);
});

test('findTokenRanges and atomicDeleteRange only match active staged tokens and collapse adjacent spaces', () => {
  const text = 'See [Image #1] and [Image #99]';
  const active = ['[Image #1]'];
  assert.deepEqual(plain(findTokenRanges(text, active)), [{ token: '[Image #1]', start: 4, end: 14 }]);
  // Backspace right after `]` deletes token plus one surrounding space.
  assert.deepEqual(plain(atomicDeleteRange(text, 14, 14, 'backward', active)), { start: 4, end: 15 });
  // Backspace inside token also deletes whole token.
  assert.deepEqual(plain(atomicDeleteRange(text, 9, 9, 'backward', active)), { start: 4, end: 15 });
  // Forward delete at `[` deletes whole token.
  assert.deepEqual(plain(atomicDeleteRange(text, 4, 4, 'forward', active)), { start: 4, end: 15 });
  // Backspace right after prose `[Image #99]` does not trigger atomic deletion.
  assert.equal(atomicDeleteRange(text, text.length, text.length, 'backward', active), null);
  // Non-collapsed selection stays native.
  assert.equal(atomicDeleteRange(text, 4, 10, 'backward', active), null);
  // Leading token deletes its trailing space cleanly.
  assert.deepEqual(plain(atomicDeleteRange('[Image #1] next', 10, 10, 'backward', active)), { start: 0, end: 11 });
});

test('removeTokensFromText strips all occurrences, preserves newlines, and adjusts caret', () => {
  assert.deepEqual(plain(removeTokensFromText('[Image #1] ', ['[Image #1]'], 11)), { value: '', caret: 0, removed: 1 });
  assert.deepEqual(plain(removeTokensFromText('Compare [Image #1] and [Image #1]', ['[Image #1]'], 33)), {
    value: 'Compare and', caret: 11, removed: 2,
  });
  assert.equal(removeTokensFromText('Line 1\n[Image #1] [Image #2]\nLine 2', ['[Image #1]']).value, 'Line 1\n[Image #2]\nLine 2');
  const keepCaret = removeTokensFromText('[File #1: a.txt] hello', ['[File #1: a.txt]'], 22);
  assert.equal(keepCaret.value, 'hello');
  assert.equal(keepCaret.caret, 5);
});

test('rewriteTokensInText renumbers in a single pass without cascading into prose', () => {
  const map = new Map([['[Image #2]', '[Image #1]'], ['[Image #3]', '[Image #2]']]);
  const res = rewriteTokensInText('Compare [Image #3] and [Image #2] vs prose [Image #99]', map);
  assert.equal(res.value, 'Compare [Image #2] and [Image #1] vs prose [Image #99]');
  assert.deepEqual([...res.matched].sort(), ['[Image #2]', '[Image #3]']);
});

test('resolveAttachmentsForSend keeps every staged attachment and compacts gaps consistently with strip order', () => {
  // Sparse refIds (#2, #3) after #1 was removed via strip ✕; #2 label deleted from prose.
  const resolved = resolveAttachmentsForSend('Focus on [Image #3] and [File #3: b.pdf] (see [Image #99])', [
    { kind: 'image', refId: 2, item: 'img2' },
    { kind: 'image', refId: 3, item: 'img3' },
    { kind: 'file', refId: 2, name: 'a.pdf', item: 'file2' },
    { kind: 'file', refId: 3, name: 'b.pdf', item: 'file3' },
  ]);
  assert.equal(resolved.message, 'Focus on [Image #2] and [File #2: b.pdf] (see [Image #99])');
  assert.deepEqual(plain(resolved.images), ['img2', 'img3']);
  assert.deepEqual(plain(resolved.files), ['file2', 'file3']);
  assert.equal(resolved.hasFileTokens, true);
  assert.deepEqual(plain(resolved.imageTokens), ['[Image #1]', '[Image #2]']);
  assert.deepEqual(plain(resolved.fileTokens), ['[File #1: a.pdf]', '[File #2: b.pdf]']);

  // Deleting all tokens still sends all staged items with hasFileTokens=false.
  const noLabels = resolveAttachmentsForSend('Summarize these', [
    { kind: 'image', refId: 1, item: 'img1' },
    { kind: 'file', refId: 1, name: 'a.txt', item: 'file1' },
  ]);
  assert.equal(noLabels.message, 'Summarize these');
  assert.deepEqual(plain(noLabels.images), ['img1']);
  assert.deepEqual(plain(noLabels.files), ['file1']);
  assert.equal(noLabels.hasFileTokens, false);
});

test('appendFileManifest labels lines when inline file refs exist and stays plain otherwise', () => {
  const refs = ['[Attached file: /tmp/a.pdf (application/pdf, 1.0 KB)]', '[Attached file: /tmp/b.pdf (application/pdf, 2.0 KB)]'];
  assert.equal(
    appendFileManifest('Compare [File #1: a.pdf] and [File #2: b.pdf]', refs, true),
    'Compare [File #1: a.pdf] and [File #2: b.pdf]\n\n[File #1] [Attached file: /tmp/a.pdf (application/pdf, 1.0 KB)]\n[File #2] [Attached file: /tmp/b.pdf (application/pdf, 2.0 KB)]',
  );
  assert.equal(
    appendFileManifest('Summarize these', refs, false),
    'Summarize these\n\n[Attached file: /tmp/a.pdf (application/pdf, 1.0 KB)]\n[Attached file: /tmp/b.pdf (application/pdf, 2.0 KB)]',
  );
  assert.equal(appendFileManifest('', [refs[0]!], false), refs[0]);
});

test('formatPromptForHistory strips unbacked image tokens while preserving file paths and prose', () => {
  assert.equal(formatPromptForHistory('[Image #1]', ['[Image #1]']), '');
  assert.equal(formatPromptForHistory('[Image #1] explain this', ['[Image #1]']), 'explain this');
  assert.equal(
    formatPromptForHistory('[Image #1] check [File #1: a.pdf]\n\n[File #1] [Attached file: /tmp/a.pdf (application/pdf, 1 B)]', ['[Image #1]']),
    'check [File #1: a.pdf]\n\n[File #1] [Attached file: /tmp/a.pdf (application/pdf, 1 B)]',
  );
  // Prose `[Image #1]` with no staged images stays intact.
  assert.equal(formatPromptForHistory('See [Image #1] above', []), 'See [Image #1] above');
});

test('decodeDraftRefs validates and deduplicates persisted ref lists', () => {
  assert.deepEqual(plain(decodeDraftRefs(JSON.stringify(['[Image #1]', '[Image #1]', 42, '', '[File #1: a.txt]']))), ['[Image #1]', '[File #1: a.txt]']);
  assert.deepEqual(plain(decodeDraftRefs('not json')), []);
  assert.deepEqual(plain(decodeDraftRefs('{"a":1}')), []);
  assert.deepEqual(plain(decodeDraftRefs(null)), []);
});

export {};
