const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sanitizeTestEnv } = require('./test-env');

test('browser build detects stale output and preserves it on type failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-browser-build-'));
  try {
    for (const dir of ['scripts', 'src/browser', 'public']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../scripts/build-browser.js'), path.join(root, 'scripts/build-browser.js'));
    fs.copyFileSync(path.join(__dirname, '../tsconfig.browser.json'), path.join(root, 'tsconfig.browser.json'));
    fs.symlinkSync(path.join(__dirname, '../node_modules'), path.join(root, 'node_modules'), 'junction');
    const source = path.join(root, 'src/browser/index.ts');
    fs.writeFileSync(source, 'export const answer: number = 42;');
    const run = (...args) => spawnSync(process.execPath, ['scripts/build-browser.js', ...args], {
      cwd: root, env: sanitizeTestEnv(process.env), encoding: 'utf8', timeout: 30000,
    });
    const first = run();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const output = path.join(root, 'public/browser.js');
    const original = fs.readFileSync(output, 'utf8');
    assert.equal(run('--check').status, 0);
    fs.appendFileSync(output, '\n// stale');
    const stale = run('--check');
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /Browser output is stale/, stale.stdout + stale.stderr);
    assert.match(fs.readFileSync(output, 'utf8'), /stale/);
    assert.equal(run().status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), original);
    fs.writeFileSync(path.join(root, 'public/legacy.js'), 'export const answer = 42;');
    // A declaration can type a legacy import, but must not permit bundling it.
    fs.writeFileSync(path.join(root, 'public/legacy.d.ts'), 'export const answer: number;');
    fs.writeFileSync(source, "export { answer } from '../../public/legacy.js';");
    const legacy = run();
    assert.notEqual(legacy.status, 0);
    assert.match(legacy.stderr, /legacy script imports must be type-only/);
    assert.equal(fs.readFileSync(output, 'utf8'), original);
    fs.writeFileSync(source, 'export const answer: number = "wrong";');
    assert.notEqual(run().status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), original);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
