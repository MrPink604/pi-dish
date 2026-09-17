const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sanitizeTestEnv } = require('./test-env');

test('edge delivery preserves executable CJS and ESM, rejects drift and leaves outputs intact on failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-edge-build-'));
  try {
    for (const dir of ['scripts', 'skills/scripts', 'electron', 'extensions']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../scripts/build-edges.js'), path.join(root, 'scripts/build-edges.js'));
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../tsconfig.edges.json'), 'utf8'));
    config.files = ['skills/scripts/example.ts', 'extensions/share.mts'];
    fs.writeFileSync(path.join(root, 'tsconfig.edges.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}');
    fs.symlinkSync(path.join(__dirname, '../node_modules'), path.join(root, 'node_modules'), 'junction');
    const cliSource = path.join(root, config.files[0]);
    fs.writeFileSync(cliSource, '#!/usr/bin/env node\nexport const value: number = 42;\nconsole.log(value);\n');
    fs.writeFileSync(path.join(root, config.files[1]), 'export default async function share(): Promise<string> { return "shared"; }\n');
    const env = sanitizeTestEnv(process.env);
    const run = (...args) => spawnSync(process.execPath, ['scripts/build-edges.js', ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    const passes = result => { assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr); };
    passes(run());
    const cli = path.join(root, 'skills/scripts/example.js');
    const execution = spawnSync(cli, [], { env, encoding: 'utf8' });
    passes(execution);
    assert.equal(execution.stdout, '42\n');
    const share = await import(require('node:url').pathToFileURL(path.join(root, 'extensions/share.mjs')).href);
    assert.equal(await share.default(), 'shared');
    passes(run('--check'));
    const outputs = ['skills/scripts/example.js', 'skills/scripts/example.d.ts', 'extensions/share.mjs', 'extensions/share.d.mts'];
    const before = outputs.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
    fs.chmodSync(cli, 0o644);
    assert.equal(run('--check').status, 1);
    assert.equal(fs.statSync(cli).mode & 0o777, 0o644, 'check must not repair permissions');
    passes(run());
    fs.appendFileSync(path.join(root, outputs[1]), '\n// stale declaration\n');
    assert.equal(run('--check').status, 1);
    assert.notEqual(fs.readFileSync(path.join(root, outputs[1]), 'utf8'), before[1], 'check must not repair declarations');
    passes(run());
    fs.unlinkSync(path.join(root, outputs[3]));
    assert.equal(run('--check').status, 1);
    assert.equal(fs.existsSync(path.join(root, outputs[3])), false);
    passes(run());
    fs.writeFileSync(cliSource, '#!/usr/bin/env node\nexport const value: number = "wrong";\n');
    assert.equal(run().status, 1);
    assert.deepEqual(outputs.map(file => fs.readFileSync(path.join(root, file), 'utf8')), before);
    fs.writeFileSync(cliSource, '#!/usr/bin/env node\nexport const value: number = 42;\nconsole.log(value);\n');
    const authored = path.join(root, 'electron/authored.js');
    fs.writeFileSync(authored, 'module.exports = 7;\n');
    const orphan = path.join(root, 'electron/obsolete.js');
    fs.writeFileSync(orphan, '// Generated edge from electron/obsolete.ts; edit that source and run npm run build:edges.\n');
    for (const args of [[], ['--check']]) {
      assert.equal(run(...args).status, 1);
      assert.deepEqual(outputs.map(file => fs.readFileSync(path.join(root, file), 'utf8')), before);
      assert.equal(require(authored), 7);
      assert.equal(fs.existsSync(orphan), true);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skill client bundle resolves aliases after installation without the source tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-edge-client-'));
  try {
    for (const dir of ['scripts', 'skills/lib', 'electron', 'extensions', 'src/core']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    for (const file of ['scripts/build-edges.js', 'skills/lib/pi-dish-client.ts']) {
      fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
    }
    // Compile the real canonical owner, not a second fixture implementation.
    fs.cpSync(path.join(__dirname, '../src/core'), path.join(root, 'src/core'), { recursive: true });
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../tsconfig.edges.json'), 'utf8'));
    config.files = ['skills/lib/pi-dish-client.ts'];
    fs.writeFileSync(path.join(root, 'tsconfig.edges.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}');
    fs.symlinkSync(path.join(__dirname, '../node_modules'), path.join(root, 'node_modules'), 'junction');
    const env = sanitizeTestEnv(process.env);
    const built = spawnSync(process.execPath, ['scripts/build-edges.js'], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    assert.ifError(built.error);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    fs.rmSync(path.join(root, 'src'), { recursive: true });
    fs.unlinkSync(path.join(root, 'node_modules'));
    const client = require(path.join(root, 'skills/lib/pi-dish-client.js'));
    const id = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-09-05T09-07-03-291Z_01a070d2-43fb-7360-aaba-a4ddf8d1deb0'])).toString('base64url');
    assert.equal(client.stableSessionRef(id, [id]), '01a070d2');
    assert.equal(client.stableSessionRef('legacy-session-long', ['legacy-session-long']), 'legacy-session-long');
    assert.equal(client.sessionHarnessId(id), 'omp');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
