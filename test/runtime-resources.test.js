// Generated tool from test/runtime-resources.test.ts; edit that source and run npm run build:tools.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const runtime_resources_1 = require("../lib/runtime-resources");
const node_url_1 = require("node:url");
const root = path.resolve('desktop resources');
const archive = path.join(root, 'app.asar');
test('checkout resources resolve from the application root, not lib or cwd', () => {
    for (const resource of ['extensions/pi-dish-bridge-omp/index.ts', 'skills/pi-dish-sessions/scripts/pi-dish-sessions.js', 'lib/session-recovery.js', 'docs/agent/sessions.md']) {
        assert.equal((0, runtime_resources_1.runtimeResourcePath)(root, resource), path.join(root, resource));
    }
});
test('packaged external resources retain the extension, skill and lib sibling layout', () => {
    const bridge = (0, runtime_resources_1.runtimeResourcePath)(archive, 'extensions/pi-dish-bridge/core.ts');
    const recovery = (0, runtime_resources_1.runtimeResourcePath)(archive, 'lib/session-recovery.js');
    const cli = (0, runtime_resources_1.runtimeResourcePath)(archive, 'skills/pi-dish-sessions/scripts/pi-dish-sessions.js');
    const client = (0, runtime_resources_1.runtimeResourcePath)(archive, 'skills/lib/pi-dish-client.js');
    assert.equal(bridge, path.join(`${archive}.unpacked`, 'extensions/pi-dish-bridge/core.ts'));
    assert.equal(recovery, path.resolve(path.dirname(bridge), '../../lib/session-recovery.js'));
    assert.equal(cli, path.join(`${archive}.unpacked`, 'skills/pi-dish-sessions/scripts/pi-dish-sessions.js'));
    assert.equal(client, path.resolve(path.dirname(cli), '../../lib/pi-dish-client.js'));
    assert.equal((0, runtime_resources_1.runtimeResourcePath)(`${archive}${path.sep}`, './skills/pi-dish-skill-refine/SKILL.md'), path.join(`${archive}.unpacked`, 'skills/pi-dish-skill-refine/SKILL.md'));
});
test('packaged docs, assets and SDK paths remain in the archive', () => {
    for (const resource of ['docs/agent/sessions.md', 'public/app.js', 'server.js', 'node_modules/@earendil-works/pi-coding-agent/dist/index.js', 'skills/../docs/agent/sessions.md', 'extensions-other/index.ts', 'lib/nested/private.js', 'lib/session-recovery.d.ts']) {
        assert.equal((0, runtime_resources_1.runtimeResourcePath)(archive, resource), path.join(archive, resource));
    }
});
test('an unpacked root or an archive-like checkout name is not rewritten', () => {
    for (const applicationRoot of [`${archive}.unpacked`, `${archive}-checkout`, path.join(archive, 'project')]) {
        assert.equal((0, runtime_resources_1.runtimeResourcePath)(applicationRoot, 'extensions/pi-dish-bridge-omp/index.ts'), path.join(applicationRoot, 'extensions/pi-dish-bridge-omp/index.ts'));
    }
});
test('FFF checkout imports retain standard package resolution without reading metadata', () => {
    for (const applicationRoot of [root, `${archive}.unpacked`, `${archive}-checkout`]) {
        assert.equal((0, runtime_resources_1.fffImportSpecifier)(applicationRoot), '@ff-labs/fff-node');
    }
});
test('packaged FFF imports the physical import-only export, not main or a guessed entry', async (t) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-fff-resource-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const appRoot = path.join(temporary, 'app.asar');
    const packageRoot = path.join(`${appRoot}.unpacked`, 'node_modules/@ff-labs/fff-node');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
        type: 'module', main: './wrong.cjs', exports: { '.': { import: './native #entry.mjs' } },
    }));
    fs.writeFileSync(path.join(packageRoot, 'wrong.cjs'), 'throw new Error("wrong resolver");');
    fs.writeFileSync(path.join(packageRoot, 'native #entry.mjs'), 'export const loadedFrom = import.meta.url;');
    const loaded = await import((0, runtime_resources_1.fffImportSpecifier)(appRoot));
    assert.ok(typeof loaded === 'object' && loaded !== null && 'loadedFrom' in loaded);
    assert.ok(typeof loaded.loadedFrom === 'string');
    assert.equal((0, node_url_1.fileURLToPath)(loaded.loadedFrom), path.join(packageRoot, 'native #entry.mjs'));
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ main: './wrong.cjs' }));
    assert.throws(() => (0, runtime_resources_1.fffImportSpecifier)(appRoot));
});
