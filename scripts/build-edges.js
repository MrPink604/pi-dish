#!/usr/bin/env node
// Generated tool from scripts/build-edges.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Compile and validate the complete sibling mapping before replacing any output.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_module_1 = require("node:module");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) {
    throw new Error('Usage: node scripts/build-edges.js [--check]');
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.edges.json'), 'utf8'));
if (!config || typeof config !== 'object' || !('files' in config) || !Array.isArray(config.files)) {
    throw new Error('Edge config must contain a files array.');
}
const sources = config.files;
const roots = ['skills', 'electron', 'extensions'];
const banner = '// Generated edge from ';
const outputs = new Map();
for (const source of sources) {
    if (typeof source !== 'string' || !/\.(ts|mts)$/.test(source) || /\.d\.(ts|mts)$/.test(source)
        || !roots.some(dir => source.startsWith(`${dir}/`)) || source.split('/').includes('..')) {
        throw new Error(`Unsupported edge source: ${source}`);
    }
    const esm = source.endsWith('.mts');
    const stem = source.replace(/\.(?:ts|mts)$/, '');
    const cli = source.startsWith('skills/') && source.includes('/scripts/');
    for (const suffix of esm ? ['.mjs', '.d.mts'] : ['.js', '.d.ts']) {
        const file = stem + suffix;
        if (outputs.has(file))
            throw new Error(`Duplicate edge output: ${file}`);
        outputs.set(file, { source, executable: cli && suffix === '.js' });
    }
}
const clientSource = 'skills/lib/pi-dish-client.ts';
// Imported for strict checking only; the client bundles its runtime subset.
const portableSources = [
    'helper-refs', 'helper-query', 'helper-values', 'helper-identity',
    'helper-format', 'helper-types', 'session-api',
].map(name => `src/core/${name}`);
const compileOnly = sources.includes(clientSource)
    ? portableSources.flatMap(source => [`${source}.js`, `${source}.d.ts`]) : [];
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-edges-'));
try {
    const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    const result = (0, node_child_process_1.spawnSync)(process.execPath, [compiler, '-p', 'tsconfig.edges.json', '--outDir', out], {
        cwd: root, stdio: 'inherit',
    });
    if (result.error)
        throw result.error;
    if (result.status !== 0) {
        process.exitCode = result.status || 1;
    }
    else {
        const emitted = fs.readdirSync(out, { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => path.relative(out, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
        const unexpected = emitted.filter(file => !outputs.has(file) && !compileOnly.includes(file));
        const missing = [...outputs.keys()].filter(file => !emitted.includes(file));
        if (unexpected.length || missing.length) {
            throw new Error(`Edge output mapping mismatch; unexpected: ${unexpected.join(', ')}; missing: ${missing.join(', ')}`);
        }
        const orphaned = [];
        for (const dir of roots) {
            for (const entry of fs.readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })) {
                if (!entry.isFile() || !/\.(?:js|mjs|d\.ts|d\.mts)$/.test(entry.name))
                    continue;
                const target = path.join(entry.parentPath, entry.name);
                const file = path.relative(root, target).split(path.sep).join('/');
                if (!outputs.has(file) && fs.readFileSync(target, 'utf8').replace(/^#![^\n]*\n/, '').startsWith(banner)) {
                    orphaned.push(file);
                }
            }
        }
        if (orphaned.length)
            throw new Error(`Remove obsolete edge output before building:\n${orphaned.join('\n')}`);
        let clientBundle;
        if (sources.includes(clientSource)) {
            const result = esbuild.buildSync({
                absWorkingDir: root, entryPoints: [clientSource], bundle: true,
                platform: 'node', format: 'cjs', target: 'es2022',
                write: false, metafile: true,
            });
            if (Object.keys(result.metafile.inputs).some(input => input !== clientSource
                && !portableSources.some(source => input === `${source}.ts`))) {
                throw new Error('Skill client runtime imports must stay in the portable helper closure');
            }
            if (result.outputFiles.length !== 1
                || Object.values(result.metafile.outputs).some(output => output.imports.some(dependency => !(0, node_module_1.isBuiltin)(dependency.path)))) {
                throw new Error('Skill client must be a standalone script with only Node builtin dependencies');
            }
            clientBundle = result.outputFiles[0].text;
        }
        const prepared = [];
        for (const [file, { source, executable }] of outputs) {
            const raw = source === clientSource && file.endsWith('.js')
                ? clientBundle : fs.readFileSync(path.join(out, file), 'utf8');
            const shebang = raw.match(/^#![^\n]*\n/)?.[0] || '';
            if (executable && shebang !== '#!/usr/bin/env node\n')
                throw new Error(`CLI shebang missing or invalid: ${source}`);
            const content = shebang + `${banner}${source}; edit that source and run npm run build:edges.\n` + raw.slice(shebang.length);
            prepared.push({ file, target: path.join(root, file), content, mode: executable ? 0o755 : 0o644 });
        }
        const stale = [];
        for (const { file, target, content, mode } of prepared) {
            if (check) {
                if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content
                    || (fs.statSync(target).mode & 0o777) !== mode)
                    stale.push(file);
            }
            else {
                fs.writeFileSync(target, content);
                fs.chmodSync(target, mode);
            }
        }
        if (stale.length) {
            console.error(`Edge output is stale; run npm run build:edges:\n${stale.join('\n')}`);
            process.exitCode = 1;
        }
        else {
            console.log(check ? 'Edge types, generated output and modes match.' : 'Edge JavaScript and declarations generated.');
        }
    }
}
finally {
    fs.rmSync(out, { recursive: true, force: true });
}
