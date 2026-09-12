const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { sanitizeTestEnv } = require('./test-env');

test('browser build detects stale output and preserves it on type failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-browser-build-'));
  try {
    for (const dir of ['scripts', 'src/browser', 'public']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../scripts/build-browser.js'), path.join(root, 'scripts/build-browser.js'));
    fs.copyFileSync(path.join(__dirname, '../tsconfig.browser.json'), path.join(root, 'tsconfig.browser.json'));
    fs.symlinkSync(path.join(__dirname, '../node_modules'), path.join(root, 'node_modules'), 'junction');
    fs.writeFileSync(path.join(root, 'src/browser/theme-prepaint.ts'), 'const themeAnswer: number = 3; console.log(themeAnswer);');
    const appSource = path.join(root, 'src/browser/app.ts');
    const appSourceText = 'let fixtureState = 0; function fixtureApp(value: number) { fixtureState += value; return fixtureState; } console.log(fixtureApp(2));';
    fs.writeFileSync(appSource, appSourceText);
    const source = path.join(root, 'src/browser/index.ts');
    fs.writeFileSync(source, 'export const answer: number = 42;');
    const commentsSource = path.join(root, 'src/browser/artifact-comments.ts');
    fs.writeFileSync(commentsSource, 'const pageAnswer: number = 7; console.log(pageAnswer);');
    const helpersSource = path.join(root, 'src/browser/shared-helpers.ts');
    fs.writeFileSync(helpersSource, 'export const fixtureHelper: number = 17;');
    const run = (...args) => spawnSync(process.execPath, ['scripts/build-browser.js', ...args], {
      cwd: root, env: sanitizeTestEnv(process.env), encoding: 'utf8', timeout: 30000,
    });
    const first = run();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const output = path.join(root, 'public/browser.js');
    const original = fs.readFileSync(output, 'utf8');
    assert.equal(run('--check').status, 0);
    const appOutput = path.join(root, 'public/app.js');
    const appOriginal = fs.readFileSync(appOutput, 'utf8');
    const logged = [];
    const context = vm.createContext({ console: { log: value => logged.push(value) } }); vm.runInContext(appOriginal, context);
    assert.deepEqual(logged, [2]);
    assert.equal(vm.runInContext('typeof fixtureApp', context), 'undefined', 'application functions stay inside the bundle');
    assert.equal(vm.runInContext('typeof fixtureState', context), 'undefined', 'application state stays inside the bundle');
    const commentsOutput = path.join(root, 'public/artifact-comments.js');
    const commentsOriginal = fs.readFileSync(commentsOutput, 'utf8');
    const helpersOutput = path.join(root, 'public/helpers.js');
    const helpersOriginal = fs.readFileSync(helpersOutput, 'utf8');
    const themeOutput = path.join(root, 'public/theme-prepaint.js');
    const themeOriginal = fs.readFileSync(themeOutput, 'utf8');
    for (const target of [output, commentsOutput, helpersOutput, themeOutput, appOutput]) {
      fs.appendFileSync(target, '\n// stale');
      const stale = run('--check');
      assert.equal(stale.status, 1);
      assert.match(stale.stderr, /Browser output is stale/, stale.stdout + stale.stderr);
      assert.match(fs.readFileSync(target, 'utf8'), /stale/);
      assert.equal(run().status, 0);
      assert.equal(fs.readFileSync(output, 'utf8'), original);
      assert.equal(fs.readFileSync(commentsOutput, 'utf8'), commentsOriginal);
      assert.equal(fs.readFileSync(helpersOutput, 'utf8'), helpersOriginal);
      assert.equal(fs.readFileSync(themeOutput, 'utf8'), themeOriginal);
      assert.equal(fs.readFileSync(appOutput, 'utf8'), appOriginal);
    }
    fs.writeFileSync(appSource, "import { answer } from './index'; console.log(answer);");
    const importedApp = run(); assert.equal(importedApp.status, 0, importedApp.stdout + importedApp.stderr);
    vm.runInContext(fs.readFileSync(appOutput, 'utf8'), context);
    assert.deepEqual(logged, [2, 42], 'runtime imports are bundled locally');
    assert.equal(vm.runInContext('typeof answer', context), 'undefined');
    fs.writeFileSync(appSource, appSourceText);
    assert.equal(run().status, 0);
    fs.writeFileSync(path.join(root, 'public/legacy.js'), 'export const answer = 42;');
    // A declaration can type a legacy import, but must not permit bundling it.
    fs.writeFileSync(path.join(root, 'public/legacy.d.ts'), 'export const answer: number;');
    fs.writeFileSync(source, "export { answer } from '../../public/legacy.js';");
    const legacy = run();
    assert.notEqual(legacy.status, 0);
    assert.match(legacy.stderr, /legacy script imports must be type-only/);
    assert.equal(fs.readFileSync(output, 'utf8'), original);
    // Failure in the second entry must not partially rewrite the first.
    fs.writeFileSync(source, 'export const answer: number = 43;');
    fs.writeFileSync(commentsSource, "export { answer } from '../../public/legacy.js';");
    assert.notEqual(run().status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), original);
    assert.equal(fs.readFileSync(commentsOutput, 'utf8'), commentsOriginal);
    fs.writeFileSync(commentsSource, 'const answer: number = "wrong";');
    assert.notEqual(run().status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), original);
    assert.equal(fs.readFileSync(commentsOutput, 'utf8'), commentsOriginal);
    // Third entry validation also completes before any output is written.
    fs.writeFileSync(commentsSource, 'const pageAnswer: number = 8; console.log(pageAnswer);');
    fs.writeFileSync(helpersSource, "export { answer } from '../../public/legacy.js';");
    assert.notEqual(run().status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), original);
    assert.equal(fs.readFileSync(commentsOutput, 'utf8'), commentsOriginal);
    assert.equal(fs.readFileSync(helpersOutput, 'utf8'), helpersOriginal);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
