// Generated tool from test/source-policy.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
// These temporary compiler inputs are deliberate violations, not product escapes.
test('source policy distinguishes type escapes, directives and literal text', async (t) => {
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
        const project = snapshot.getDefaultProjectForFile(file);
        assert.ok(project);
        const source = project.program.getSourceFile(file);
        assert.ok(source);
        const failures = inspectSource(source);
        assert.equal(failures.filter(f => f.includes('explicit any')).length, 2);
        assert.equal(failures.filter(f => f.includes('@ts-ignore')).length, 2);
        assert.equal(failures.filter(f => f.includes('@ts-nocheck')).length, 1);
        assert.equal(failures.filter(f => f.includes('@ts-expect-error')).length, 1);
        assert.equal(inspectSource(source, true).length, 5);
    }
    finally {
        api.close();
    }
});
test('source policy rejects checked JavaScript JSDoc escape types', async (t) => {
    const { API } = await import('typescript/unstable/sync');
    const { inspectSource } = await import('../scripts/check-source-policy.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-policy-js-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'fixture.js');
    fs.writeFileSync(file, '/** @type {any} */\nlet value;\n/** @type {*} */\nlet wildcard;');
    const api = new API();
    try {
        const snapshot = api.updateSnapshot({ openFiles: [file] });
        const project = snapshot.getDefaultProjectForFile(file);
        assert.ok(project);
        const source = project.program.getSourceFile(file);
        assert.ok(source);
        assert.equal(inspectSource(source).filter(f => f.includes('explicit any')).length, 2);
    }
    finally {
        api.close();
    }
});
test('source inventory rejects unclassified bodies, declaration facades and stale exceptions', async () => {
    // The policy API is ESM while generated node:test files are CommonJS.
    const { classifyExecutableInventory } = await import('../scripts/check-source-policy.mjs');
    const result = classifyExecutableInventory([
        'src/owned.ts',
        'lib/owned.js',
        'test/support.d.ts',
        'test/broken-support.d.ts',
        'docs/history.js',
        'rogue.js',
        'types/facade.d.ts',
    ], new Set(['lib/owned.js']), new Set(['src/owned.ts', 'test/support.d.ts', 'types/facade.d.ts']), new Set(['test/support.d.ts', 'test/broken-support.d.ts']), new Set(['docs/history.js', 'docs/missing-history.js']));
    assert.deepEqual([...result.compilerBodies], ['src/owned.ts']);
    assert.deepEqual(result.failures, [
        'test/broken-support.d.ts: compiler-support declaration is not in an actual program',
        'rogue.js: unclassified tracked executable path',
        'types/facade.d.ts: unclassified tracked executable path',
        'docs/missing-history.js: stale named exception',
    ]);
});
test('repository inventory follows tracked paths and effective Git attributes', async (t) => {
    // The policy API is ESM while generated node:test files are CommonJS.
    const { isExecutableFamilyPath, repositoryPaths, shellInventoryPaths, validateLinguist, } = await import('../scripts/check-source-policy.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-policy-git-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    (0, node_child_process_1.execFileSync)('git', ['init', '-q'], { cwd: dir });
    for (const file of [
        '.amp/rogue.js',
        '.agents/setup',
        'authored.js',
        'generated.js',
        'nested/bundle.js',
        'outside/rogue.jsx',
        'outside/rogue.tsx',
    ]) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), file === '.agents/setup' ? '#!/usr/bin/env bash\n' : '');
    }
    fs.chmodSync(path.join(dir, '.agents/setup'), 0o755);
    fs.writeFileSync(path.join(dir, '.gitattributes'), [
        'generated.js linguist-generated=true',
        'nested/bundle.js linguist-generated=true',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'nested/.gitattributes'), '');
    (0, node_child_process_1.execFileSync)('git', ['add', '.amp/rogue.js', '.agents/setup', '.gitattributes', 'authored.js',
        'generated.js', 'nested', 'outside'], { cwd: dir });
    fs.writeFileSync(path.join(dir, '.amp/local.js'), '');
    const repository = repositoryPaths(dir);
    assert.equal(repository.paths.has('.amp/rogue.js'), true);
    assert.equal(repository.paths.has('.amp/local.js'), false);
    assert.deepEqual(shellInventoryPaths(repository.paths, repository.modes), ['.agents/setup']);
    assert.equal(isExecutableFamilyPath('outside/rogue.jsx'), true);
    assert.equal(isExecutableFamilyPath('outside/rogue.tsx'), true);
    const generated = new Set(['generated.js', 'nested/bundle.js']);
    const baseline = [];
    validateLinguist(dir, '.gitattributes', repository.paths, generated, baseline);
    assert.deepEqual(baseline, []);
    fs.writeFileSync(path.join(dir, '.gitattributes'), [
        'authored.js linguist-generated',
        'generated.js -linguist-generated',
        'nested/bundle.js linguist-generated=true',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'nested/.gitattributes'), 'bundle.js -linguist-generated\n');
    const overrides = [];
    validateLinguist(dir, '.gitattributes', repository.paths, generated, overrides);
    assert.deepEqual(overrides, [
        'authored.js: non-generated path has effective linguist-generated=set',
        'generated.js: generated output has effective linguist-generated=unset',
        'nested/bundle.js: generated output has effective linguist-generated=unset',
    ]);
    fs.writeFileSync(path.join(dir, '.gitattributes'), 'generated.js linguist-generated=false\n');
    fs.writeFileSync(path.join(dir, 'nested/.gitattributes'), '');
    const falseAndUnspecified = [];
    validateLinguist(dir, '.gitattributes', repository.paths, generated, falseAndUnspecified);
    assert.deepEqual(falseAndUnspecified, [
        'generated.js: generated output has effective linguist-generated=false',
        'nested/bundle.js: generated output has effective linguist-generated=unspecified',
    ]);
});
test('named shell inventory enforces declared sets, index modes and worktree state', async (t) => {
    // The policy API is ESM while generated node:test files are CommonJS.
    const { repositoryPaths, validateShellInventory } = await import('../scripts/check-source-policy.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-policy-shell-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    (0, node_child_process_1.execFileSync)('git', ['init', '-q'], { cwd: dir });
    fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents/setup'), '#!/usr/bin/env bash\n');
    fs.writeFileSync(path.join(dir, 'service.sh'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(dir, '.agents/setup'), 0o755);
    fs.chmodSync(path.join(dir, 'service.sh'), 0o755);
    (0, node_child_process_1.execFileSync)('git', ['add', '.agents/setup', 'service.sh'], { cwd: dir });
    const declared = new Set(['.agents/setup', 'service.sh']);
    assert.deepEqual(validateShellInventory(dir, repositoryPaths(dir), declared), {
        paths: ['.agents/setup', 'service.sh'],
        failures: [],
    });
    fs.chmodSync(path.join(dir, '.agents/setup'), 0o644);
    (0, node_child_process_1.execFileSync)('git', ['add', '.agents/setup'], { cwd: dir });
    assert.deepEqual(validateShellInventory(dir, repositoryPaths(dir), declared), {
        paths: ['.agents/setup', 'service.sh'],
        failures: [
            '.agents/setup: tracked shell index mode must be 100755 (got 100644)',
            '.agents/setup: shell worktree mode must be 0755 (got 0644)',
        ],
    });
    fs.chmodSync(path.join(dir, '.agents/setup'), 0o755);
    (0, node_child_process_1.execFileSync)('git', ['add', '.agents/setup'], { cwd: dir });
    fs.chmodSync(path.join(dir, 'service.sh'), 0o644);
    assert.deepEqual(validateShellInventory(dir, repositoryPaths(dir), declared), {
        paths: ['.agents/setup', 'service.sh'],
        failures: ['service.sh: shell worktree mode must be 0755 (got 0644)'],
    });
    fs.chmodSync(path.join(dir, 'service.sh'), 0o755);
    fs.rmSync(path.join(dir, '.agents/setup'));
    assert.deepEqual(validateShellInventory(dir, repositoryPaths(dir), declared), {
        paths: ['.agents/setup', 'service.sh'],
        failures: ['.agents/setup: declared shell path is absent from worktree'],
    });
    fs.writeFileSync(path.join(dir, '.agents/setup'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(dir, '.agents/setup'), 0o755);
    fs.writeFileSync(path.join(dir, '.git/setup-target'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(dir, '.git/setup-target'), 0o755);
    fs.rmSync(path.join(dir, '.agents/setup'));
    fs.symlinkSync('../.git/setup-target', path.join(dir, '.agents/setup'));
    assert.deepEqual(validateShellInventory(dir, repositoryPaths(dir), declared), {
        paths: ['.agents/setup', 'service.sh'],
        failures: ['.agents/setup: declared shell path is not a regular file'],
    });
    fs.rmSync(path.join(dir, '.agents/setup'));
    fs.writeFileSync(path.join(dir, '.agents/setup'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(dir, '.agents/setup'), 0o755);
    fs.rmSync(path.join(dir, 'service.sh'));
    fs.mkdirSync(path.join(dir, 'service.sh'));
    assert.deepEqual(validateShellInventory(dir, repositoryPaths(dir), declared), {
        paths: ['.agents/setup', 'service.sh'],
        failures: ['service.sh: declared shell path is not a regular file'],
    });
    fs.rmdirSync(path.join(dir, 'service.sh'));
    fs.writeFileSync(path.join(dir, 'service.sh'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(dir, 'service.sh'), 0o755);
    fs.writeFileSync(path.join(dir, 'rogue'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(dir, 'rogue'), 0o755);
    (0, node_child_process_1.execFileSync)('git', ['add', 'rogue'], { cwd: dir });
    assert.deepEqual(validateShellInventory(dir, repositoryPaths(dir), declared), {
        paths: ['.agents/setup', 'rogue', 'service.sh'],
        failures: ['rogue: unclassified tracked shell path'],
    });
    assert.deepEqual(validateShellInventory(dir, repositoryPaths(dir), new Set([...declared, 'missing.sh'])).failures, [
        'rogue: unclassified tracked shell path',
        'missing.sh: declared shell path is not tracked',
        'missing.sh: declared shell path is absent from worktree',
    ]);
});
