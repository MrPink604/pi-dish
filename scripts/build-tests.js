#!/usr/bin/env node
// Generated tool from scripts/build-tests.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) {
    throw new Error('Usage: node scripts/build-tests.js [--check]');
}
const projects = [
    'tsconfig.node-tests.json',
    'tsconfig.browser-tests.json',
    'tsconfig.ui-tests.json',
    'tsconfig.dev-tools.json',
];
const declarationProjects = new Set(['tsconfig.node-tests.json', 'tsconfig.dev-tools.json']);
const banner = '// Generated test/tool from ';
const outputs = new Map();
function sourceFiles(project) {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, project), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || !('files' in parsed)
        || !Array.isArray(parsed.files) || !parsed.files.every((file) => typeof file === 'string')) {
        throw new Error(`${project} must list its source files`);
    }
    return parsed.files;
}
function supportedSource(source) {
    return /^test\/[^/]+\.test\.ts$/.test(source)
        || /^test\/(?:sse-reader|ui-smoke|test-types|browser-vm)\.ts$/.test(source)
        || /^test\/fixtures\/[^/]+\.(?:ts|mts)$/.test(source)
        || /^test\/browser\/(?:fixtures|fixture-contracts|[^/]+\.spec)\.ts$/.test(source)
        || /^test\/ui-scenarios\/[^/]+\.ts$/.test(source)
        || /^scripts\/(?:session-catalog-baseline|test-real-lineage-harnesses|readme-shots)\.ts$/.test(source);
}
for (const project of projects) {
    for (const source of sourceFiles(project)) {
        if (source === 'test/browser/globals.d.ts')
            continue;
        if (!supportedSource(source) || /\.d\.(?:ts|mts)$/.test(source)) {
            throw new Error(`Unsupported ${project} source: ${source}`);
        }
        const esm = source.endsWith('.mts');
        const stem = source.replace(/\.(?:ts|mts)$/, '');
        const suffixes = esm
            ? (declarationProjects.has(project) ? ['.mjs', '.d.mts'] : ['.mjs'])
            : (declarationProjects.has(project) ? ['.js', '.d.ts'] : ['.js']);
        for (const suffix of suffixes) {
            const file = stem + suffix;
            if (outputs.has(file))
                throw new Error(`Duplicate test output: ${file}`);
            outputs.set(file, { source, project });
        }
    }
}
function generatedOutputs() {
    const files = [];
    for (const directory of ['test', 'scripts']) {
        const base = path.join(root, directory);
        for (const entry of fs.readdirSync(base, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile() || !/\.(?:js|mjs|d\.ts|d\.mts)$/.test(entry.name))
                continue;
            const target = path.join(entry.parentPath, entry.name);
            const content = fs.readFileSync(target, 'utf8').replace(/^#![^\n]*\n/, '');
            if (content.startsWith(banner))
                files.push(path.relative(root, target).split(path.sep).join('/'));
        }
    }
    return files;
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-tests-'));
try {
    const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    const emitted = new Map();
    let failed = false;
    for (const project of projects) {
        const projectOut = path.join(out, project.replace(/\.json$/, ''));
        const result = (0, node_child_process_1.spawnSync)(process.execPath, [compiler, '-p', project, '--outDir', projectOut], {
            cwd: root,
            stdio: 'inherit',
        });
        if (result.error)
            throw result.error;
        if (result.status !== 0) {
            failed = true;
            break;
        }
        for (const entry of fs.readdirSync(projectOut, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile())
                continue;
            const file = path.relative(projectOut, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
            if (outputs.get(file)?.project !== project)
                continue;
            if (emitted.has(file))
                throw new Error(`Multiple compiler programs emitted owned output ${file}`);
            emitted.set(file, path.join(projectOut, file));
        }
    }
    if (failed) {
        process.exitCode = 1;
    }
    else {
        const unexpected = [...emitted.keys()].filter(file => !outputs.has(file));
        const missing = [...outputs.keys()].filter(file => !emitted.has(file));
        const orphaned = generatedOutputs().filter(file => !outputs.has(file));
        if (unexpected.length || missing.length || (check && orphaned.length)) {
            throw new Error(`Test output mapping mismatch; unexpected: ${unexpected.join(', ')}; missing: ${missing.join(', ')}; orphaned: ${orphaned.join(', ')}`);
        }
        if (!check)
            for (const file of orphaned)
                fs.rmSync(path.join(root, file));
        const prepared = [];
        for (const [file, { source }] of outputs) {
            const raw = fs.readFileSync(emitted.get(file), 'utf8');
            const shebang = raw.match(/^#![^\n]*\n/)?.[0] || '';
            const content = shebang + `${banner}${source}; edit that source and run npm run build:tests.\n` + raw.slice(shebang.length);
            prepared.push({ file, target: path.join(root, file), content, mode: 0o644 });
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
            console.error(`Test output is stale; run npm run build:tests:\n${stale.join('\n')}`);
            process.exitCode = 1;
        }
        else {
            console.log(check ? 'Test types, generated outputs and modes match.' : 'Test JavaScript and declarations generated.');
        }
    }
}
finally {
    fs.rmSync(out, { recursive: true, force: true });
}
