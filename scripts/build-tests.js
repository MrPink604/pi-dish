#!/usr/bin/env node
// Generated tool from scripts/build-tests.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const build_output_js_1 = require("./build-output.js");
const BANNER = '// Generated test/tool from ';
const check = (0, build_output_js_1.checkRequested)('build-tests');
const programs = ['tsconfig.node-tests.json', 'tsconfig.browser-tests.json', 'tsconfig.ui-tests.json', 'tsconfig.dev-tools.json'];
const declarationPrograms = { 'tsconfig.node-tests.json': true, 'tsconfig.dev-tools.json': true };
const projectOf = new Map();
const outputs = new Map();
for (const program of programs) {
    const sources = (0, build_output_js_1.programFiles)(program).filter(source => source !== 'test/browser/globals.d.ts');
    for (const source of sources) {
        if (!/^(?:test|scripts)\//.test(source) || /\.d\.(?:ts|mts)$/.test(source)) {
            throw new Error(`Unsupported ${program} source: ${source}`);
        }
    }
    for (const [file, entry] of (0, build_output_js_1.siblingOutputs)(sources, {
        kind: 'Test',
        declarations: () => declarationPrograms[program] === true,
        executable: () => false,
    })) {
        if (outputs.has(file))
            throw new Error(`Duplicate test output: ${file}`);
        outputs.set(file, entry);
        projectOf.set(file, program);
    }
}
const emitted = new Map();
let failed = false;
for (const program of programs) {
    const compiled = (0, build_output_js_1.buildProgram)(program, 'pi-dish-tests-', (files, read) => {
        for (const file of files) {
            if (projectOf.get(file) !== program)
                continue;
            if (emitted.has(file))
                throw new Error(`Multiple compiler programs emitted owned output ${file}`);
            emitted.set(file, read(file));
        }
    });
    if (!compiled) {
        failed = true;
        break;
    }
}
if (!failed) {
    const unexpected = [...emitted.keys()].filter(file => !outputs.has(file));
    const missing = [...outputs.keys()].filter(file => !emitted.has(file));
    const orphaned = (0, build_output_js_1.orphanedOutputs)(['test', 'scripts'], BANNER, outputs, true);
    if (unexpected.length || missing.length || (check && orphaned.length)) {
        throw new Error(`Test output mapping mismatch; unexpected: ${unexpected.join(', ')}; missing: ${missing.join(', ')}; orphaned: ${orphaned.join(', ')}`);
    }
    if (!check)
        for (const file of orphaned)
            fs.rmSync(path.join(build_output_js_1.root, file));
    (0, build_output_js_1.writeOutputs)((0, build_output_js_1.generatedOutputs)(outputs, { banner: BANNER, command: 'build:tests', read: file => emitted.get(file) }), {
        check,
        kind: 'Test',
        command: 'build:tests',
        checkOk: 'Test types, generated outputs and modes match.',
        writeOk: 'Test JavaScript and declarations generated.',
    });
}
