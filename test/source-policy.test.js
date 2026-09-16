const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// These temporary compiler inputs are deliberate violations, not product escapes.
test('source policy distinguishes type escapes, directives and literal text', async t => {
  const { API } = await import('typescript/unstable/sync');
  const { inspectSource } = await import('../scripts/check-source-policy.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-policy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fixture.ts');
  fs.writeFileSync(file, [
    'const any = "any @ts-ignore";',
    'const literal = `@ts-nocheck ${"@ts-ignore"} tail @ts-ignore`;',
    'const pattern = /[/*]@ts-ignore/;',
    'let value: any;',
    'type Escape = { nested: Array<any> };',
    '// @ts-ignore forbidden',
    'value = 1;',
    'function empty() { /* @ts-nocheck forbidden */ }',
    'const substitution = `x ${ /* @ts-ignore forbidden */ value }`;',
    '// @ts-expect-error Named negative purpose.',
    'const negative: number = "bad";',
  ].join('\n'));
  const api = new API();
  try {
    const snapshot = api.updateSnapshot({ openFiles: [file] });
    const source = snapshot.getDefaultProjectForFile(file).program.getSourceFile(file);
    const failures = inspectSource(source);
    assert.equal(failures.filter(f => f.includes('explicit any')).length, 2);
    assert.equal(failures.filter(f => f.includes('@ts-ignore is forbidden')).length, 2);
    assert.equal(failures.filter(f => f.includes('@ts-nocheck is forbidden')).length, 1);
    assert.equal(failures.filter(f => f.includes('confined to named')).length, 1);
    assert.equal(inspectSource(source, true).length, 5);
  } finally { api.close(); }
});

test('source policy rejects checked JavaScript JSDoc escape types', async t => {
  const { API } = await import('typescript/unstable/sync');
  const { inspectSource } = await import('../scripts/check-source-policy.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-policy-js-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fixture.js');
  fs.writeFileSync(file, '/** @type {any} */\nlet value;\n/** @type {*} */\nlet wildcard;');
  const api = new API();
  try {
    const snapshot = api.updateSnapshot({ openFiles: [file] });
    const source = snapshot.getDefaultProjectForFile(file).program.getSourceFile(file);
    assert.equal(inspectSource(source).filter(f => f.includes('explicit any')).length, 2);
  } finally { api.close(); }
});
