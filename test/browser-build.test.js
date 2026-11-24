// Generated test/tool from test/browser-build.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require('node:vm');
const node_child_process_1 = require("node:child_process");
const test_env_js_1 = require("./test-env.js");
test('browser build detects stale output and preserves it on type failure', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-browser-build-'));
    try {
        for (const dir of ['scripts', 'src/browser', 'public'])
            fs.mkdirSync(path.join(root, dir), { recursive: true });
        for (const file of ['scripts/build-browser.js', 'scripts/build-output.js', 'tsconfig.browser.json', 'tsconfig.base.json']) {
            fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
        }
        fs.symlinkSync(path.join(__dirname, '../node_modules'), path.join(root, 'node_modules'), 'junction');
        const shell = path.join(root, 'public/index.html');
        fs.writeFileSync(shell, '<link href="style.css" rel="stylesheet"><script src="app.js" defer></script>');
        const style = path.join(root, 'public/style.css');
        fs.writeFileSync(style, 'body { color: red; }');
        fs.writeFileSync(path.join(root, 'src/browser/theme-prepaint.ts'), 'const themeAnswer: number = 3; console.log(themeAnswer);');
        const appSource = path.join(root, 'src/browser/app.ts');
        const appSourceText = 'let fixtureState = 0; function fixtureApp(value: number) { fixtureState += value; return fixtureState; } console.log(fixtureApp(2));';
        fs.writeFileSync(appSource, appSourceText);
        const source = path.join(root, 'src/browser/index.ts');
        fs.writeFileSync(source, 'export const answer: number = 42;');
        const commentsSource = path.join(root, 'src/browser/artifact-comments.ts');
        fs.writeFileSync(commentsSource, 'const pageAnswer: number = 7; console.log(pageAnswer);');
        fs.writeFileSync(path.join(root, 'src/browser/forms-app.ts'), 'const formAnswer: number = 9; console.log(formAnswer);');
        const helpersSource = path.join(root, 'src/browser/shared-helpers.ts');
        fs.writeFileSync(helpersSource, 'export const fixtureHelper: number = 17;');
        fs.writeFileSync(path.join(root, 'src/browser/service-worker.ts'), 'const workerAnswer: number = 5; console.log(workerAnswer);');
        const run = (...args) => (0, node_child_process_1.spawnSync)(process.execPath, ['scripts/build-browser.js', ...args], {
            cwd: root, env: (0, test_env_js_1.sanitizeTestEnv)(process.env), encoding: 'utf8', timeout: 30000,
        });
        const first = run();
        assert.equal(first.status, 0, first.stdout + first.stderr);
        const firstShell = fs.readFileSync(shell, 'utf8');
        const output = path.join(root, 'public/browser.js');
        const original = fs.readFileSync(output, 'utf8');
        assert.equal(run('--check').status, 0);
        const appOutput = path.join(root, 'public/app.js');
        const appOriginal = fs.readFileSync(appOutput, 'utf8');
        const logged = [];
        const context = vm.createContext({ console: { log: (value) => logged.push(value) } });
        vm.runInContext(appOriginal, context);
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
        const importedApp = run();
        assert.equal(importedApp.status, 0, importedApp.stdout + importedApp.stderr);
        assert.notEqual(fs.readFileSync(shell, 'utf8'), firstShell, 'a changed bundle must get a new script URL');
        vm.runInContext(fs.readFileSync(appOutput, 'utf8'), context);
        assert.deepEqual(logged, [2, 42], 'runtime imports are bundled locally');
        assert.equal(vm.runInContext('typeof answer', context), 'undefined');
        fs.writeFileSync(appSource, appSourceText);
        fs.writeFileSync(style, 'body { color: blue; }');
        assert.equal(run().status, 0);
        assert.notEqual(fs.readFileSync(shell, 'utf8'), firstShell, 'a CSS-only change must get a new stylesheet URL');
        const cleanShell = fs.readFileSync(shell, 'utf8');
        // Lazy vendor assets declared in <meta name="pi-dish-asset-..."> get content-hashed too.
        fs.mkdirSync(path.join(root, 'public/vendor'), { recursive: true });
        const lazyVendor = path.join(root, 'public/vendor/three-gltf.js');
        fs.writeFileSync(lazyVendor, 'globalThis.PiDishThreeGltf = { apiVersion: 1 };');
        fs.writeFileSync(shell, '<meta name="pi-dish-asset-three-gltf" content="vendor/three-gltf.js"><link href="style.css" rel="stylesheet"><script src="app.js" defer></script>');
        assert.equal(run().status, 0);
        const metaShellOne = fs.readFileSync(shell, 'utf8');
        assert.match(metaShellOne, /content="vendor\/three-gltf\.js\?v=[0-9a-f]{16}"/);
        assert.equal(run('--check').status, 0);
        fs.writeFileSync(lazyVendor, 'globalThis.PiDishThreeGltf = { apiVersion: 2 };');
        assert.equal(run('--check').status, 1, 'changing a versioned lazy vendor bundle must fail --check until shell hash updates');
        assert.equal(run().status, 0);
        assert.notEqual(fs.readFileSync(shell, 'utf8'), metaShellOne);
        fs.rmSync(lazyVendor);
        // Unresolved merge conflict markers or duplicate app.js tags must never pass build or check.
        fs.writeFileSync(shell, '<<<<<<< HEAD\n<script src="app.js" defer></script>\n=======\n<script src="app.js" defer></script>\n>>>>>>> other\n');
        const conflicted = run('--check');
        assert.notEqual(conflicted.status, 0);
        assert.match(conflicted.stderr, /merge conflict markers/);
        fs.writeFileSync(shell, '<link href="style.css" rel="stylesheet"><script src="app.js" defer></script><script src="app.js" defer></script>');
        const duplicated = run('--check');
        assert.notEqual(duplicated.status, 0);
        assert.match(duplicated.stderr, /references local asset "app\.js" more than once/);
        fs.writeFileSync(shell, cleanShell);
        assert.equal(run('--check').status, 0);
        fs.mkdirSync(path.join(root, 'src/core'));
        const sharedSource = path.join(root, 'src/core/helper-fixture.ts');
        fs.writeFileSync(sharedSource, "export { answer } from '../browser/index';");
        fs.writeFileSync(appSource, "import { answer } from '../core/helper-fixture'; console.log(answer);");
        const backwardsHelper = run();
        assert.notEqual(backwardsHelper.status, 0, 'shared helpers cannot depend on browser implementations');
        assert.equal(fs.readFileSync(appOutput, 'utf8'), appOriginal, 'a rejected shared dependency leaves runtime output intact');
        assert.equal(fs.readFileSync(output, 'utf8'), original);
        fs.rmSync(sharedSource);
        fs.writeFileSync(appSource, appSourceText);
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
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
