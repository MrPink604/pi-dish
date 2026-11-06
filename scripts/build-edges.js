#!/usr/bin/env node
// Generated tool from scripts/build-edges.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Compile and validate the complete sibling mapping before replacing any output.
const node_module_1 = require("node:module");
const esbuild = require("esbuild");
const build_output_js_1 = require("./build-output.js");
const BANNER = '// Generated edge from ';
const ROOTS = ['skills', 'extensions'];
const CLIENT_SOURCE = 'skills/lib/pi-dish-client.ts';
// Imported for strict checking only; the client bundles its runtime subset.
const PORTABLE_SOURCES = [
    'helper-refs', 'helper-query', 'helper-values', 'helper-identity',
    'helper-format', 'helper-types', 'session-api',
].map(name => `src/core/${name}`);
const check = (0, build_output_js_1.checkRequested)('build-edges.js');
const sources = (0, build_output_js_1.programFiles)('tsconfig.edges.json');
for (const source of sources) {
    if (!/\.(?:ts|mts)$/.test(source) || /\.d\.(?:ts|mts)$/.test(source)
        || !ROOTS.some(dir => source.startsWith(`${dir}/`)) || source.split('/').includes('..')) {
        throw new Error(`Unsupported edge source: ${source}`);
    }
}
const outputs = (0, build_output_js_1.siblingOutputs)(sources, {
    kind: 'Edge',
    declarations: () => true,
    executable: source => source.startsWith('skills/') && source.includes('/scripts/'),
});
const compileOnly = sources.includes(CLIENT_SOURCE)
    ? PORTABLE_SOURCES.flatMap(source => [`${source}.js`, `${source}.d.ts`]) : [];
(0, build_output_js_1.buildProgram)('tsconfig.edges.json', 'pi-dish-edges-', (files, read) => {
    (0, build_output_js_1.verifyMapping)('Edge', files, outputs, compileOnly);
    const orphaned = (0, build_output_js_1.orphanedOutputs)(ROOTS, BANNER, outputs, true);
    if (orphaned.length)
        throw new Error(`Remove obsolete edge output before building:\n${orphaned.join('\n')}`);
    let clientBundle;
    if (sources.includes(CLIENT_SOURCE)) {
        const result = esbuild.buildSync({
            absWorkingDir: build_output_js_1.root, entryPoints: [CLIENT_SOURCE], bundle: true,
            platform: 'node', format: 'cjs', target: 'es2022',
            write: false, metafile: true,
        });
        if (Object.keys(result.metafile.inputs).some(input => input !== CLIENT_SOURCE
            && !PORTABLE_SOURCES.some(source => input === `${source}.ts`))) {
            throw new Error('Skill client runtime imports must stay in the portable helper closure');
        }
        if (result.outputFiles.length !== 1
            || Object.values(result.metafile.outputs).some(output => output.imports.some(dependency => !(0, node_module_1.isBuiltin)(dependency.path)))) {
            throw new Error('Skill client must be a standalone script with only Node builtin dependencies');
        }
        clientBundle = result.outputFiles[0].text;
    }
    (0, build_output_js_1.writeOutputs)((0, build_output_js_1.generatedOutputs)(outputs, {
        banner: BANNER,
        command: 'build:edges',
        read: (file, source) => source === CLIENT_SOURCE && file.endsWith('.js') ? clientBundle : read(file),
    }), {
        check,
        kind: 'Edge',
        command: 'build:edges',
        checkOk: 'Edge types, generated output and modes match.',
        writeOk: 'Edge JavaScript and declarations generated.',
    });
});
