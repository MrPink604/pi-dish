const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sanitizeTestEnv } = require('./test-env');

test('core build detects stale runtime/declarations and never repairs them in check mode', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-core-build-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'src', 'core'), { recursive: true });
    fs.mkdirSync(path.join(root, 'lib'));
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'build-core.js'), path.join(root, 'scripts', 'build-core.js'));
    fs.copyFileSync(path.join(__dirname, '..', 'tsconfig.core.json'), path.join(root, 'tsconfig.core.json'));
    fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(root, 'node_modules'), 'junction');
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}');
    const source = path.join(root, 'src', 'core', 'example.ts');
    fs.writeFileSync(source, 'function value(): number { return 42; }\nexport = { value };\n');
    const env = sanitizeTestEnv(process.env);
    const run = (...args) => spawnSync(process.execPath, ['scripts/build-core.js', ...args], {
      cwd: root, env, encoding: 'utf8', timeout: 30000,
    });
    const expectStatus = (result, status) => {
      assert.ifError(result.error);
      assert.equal(result.status, status, result.stdout + result.stderr);
    };
    expectStatus(run(), 0);
    const runtime = path.join(root, 'lib', 'example.js');
    const declarations = path.join(root, 'lib', 'example.d.ts');
    const originalRuntime = fs.readFileSync(runtime, 'utf8');
    const originalDeclarations = fs.readFileSync(declarations, 'utf8');
    assert.equal(require(runtime).value(), 42);
    expectStatus(run('--check'), 0);
    fs.appendFileSync(runtime, '\n// stale runtime\n');
    fs.appendFileSync(declarations, '\n// stale declarations\n');
    const mismatch = run('--check');
    expectStatus(mismatch, 1);
    assert.match(mismatch.stderr, /lib\/example.js/);
    assert.match(mismatch.stderr, /lib\/example.d.ts/);
    assert.match(fs.readFileSync(runtime, 'utf8'), /stale runtime/);
    assert.match(fs.readFileSync(declarations, 'utf8'), /stale declarations/);
    expectStatus(run(), 0);
    assert.equal(fs.readFileSync(runtime, 'utf8'), originalRuntime);
    assert.equal(fs.readFileSync(declarations, 'utf8'), originalDeclarations);

    fs.writeFileSync(source, 'const value: number = "type error";\nexport = { value };\n');
    assert.notEqual(run().status, 0);
    assert.equal(fs.readFileSync(runtime, 'utf8'), originalRuntime, 'type failure cannot partially overwrite runtime');
    assert.equal(fs.readFileSync(declarations, 'utf8'), originalDeclarations);

    fs.writeFileSync(source, 'function value(): number { return 42; }\nexport = { value };\n');
    fs.writeFileSync(path.join(root, 'lib', 'obsolete.js'), '// Generated from src/core/obsolete.ts;\n');
    const orphan = run('--check');
    expectStatus(orphan, 1);
    assert.match(orphan.stderr, /obsolete core output/);
    assert.equal(fs.readFileSync(runtime, 'utf8'), originalRuntime);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
