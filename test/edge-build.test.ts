import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { SpawnSyncReturns } from 'node:child_process';
import { sanitizeTestEnv } from './test-env';

test('edge delivery preserves executable CJS and ESM, rejects drift and leaves outputs intact on failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-edge-build-'));
  try {
    for (const dir of ['scripts', 'skills/scripts', 'electron', 'extensions']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../scripts/build-edges.js'), path.join(root, 'scripts/build-edges.js'));
    const config: unknown = JSON.parse(fs.readFileSync(path.join(__dirname, '../tsconfig.edges.json'), 'utf8'));
    assert.ok(typeof config === 'object' && config !== null && 'files' in config);
    const fixtureSources = ['skills/scripts/example.ts', 'extensions/share.mts'];
    config.files = fixtureSources;
    fs.writeFileSync(path.join(root, 'tsconfig.edges.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}');
    fs.symlinkSync(path.join(__dirname, '../node_modules'), path.join(root, 'node_modules'), 'junction');
    const cliSource = path.join(root, fixtureSources[0]);
    fs.writeFileSync(cliSource, '#!/usr/bin/env node\nexport const value: number = 42;\nconsole.log(value);\n');
    fs.writeFileSync(path.join(root, fixtureSources[1]), 'export default async function share(): Promise<string> { return "shared"; }\n');
    const env = sanitizeTestEnv(process.env);
    const run = (...args: string[]): SpawnSyncReturns<string> => spawnSync(process.execPath, ['scripts/build-edges.js', ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    const passes = (result: SpawnSyncReturns<string>) => { assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr); };
    passes(run());
    const cli = path.join(root, 'skills/scripts/example.js');
    const execution = spawnSync(cli, [], { env, encoding: 'utf8' });
    passes(execution);
    assert.equal(execution.stdout, '42\n');
    const share: unknown = await import(pathToFileURL(path.join(root, 'extensions/share.mjs')).href);
    assert.ok(typeof share === 'object' && share !== null && 'default' in share);
    assert.ok(typeof share.default === 'function');
    const shared: unknown = await share.default();
    assert.equal(shared, 'shared');
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
      const authoredValue: unknown = require(authored);
      assert.equal(authoredValue, 7);
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
    const config: unknown = JSON.parse(fs.readFileSync(path.join(__dirname, '../tsconfig.edges.json'), 'utf8'));
    assert.ok(typeof config === 'object' && config !== null && 'files' in config);
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
    const client: unknown = require(path.join(root, 'skills/lib/pi-dish-client.js'));
    assert.ok(typeof client === 'object' && client !== null && 'stableSessionRef' in client && 'sessionHarnessId' in client);
    assert.ok(typeof client.stableSessionRef === 'function' && typeof client.sessionHarnessId === 'function');
    const id = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-09-05T09-07-03-291Z_01a070d2-43fb-7360-aaba-a4ddf8d1deb0'])).toString('base64url');
    const stableRef: unknown = client.stableSessionRef(id, [id]);
    const legacyRef: unknown = client.stableSessionRef('legacy-session-long', ['legacy-session-long']);
    const harnessId: unknown = client.sessionHarnessId(id);
    assert.equal(stableRef, '01a070d2');
    assert.equal(legacyRef, 'legacy-session-long');
    assert.equal(harnessId, 'omp');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
