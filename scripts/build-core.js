#!/usr/bin/env node
// Generated tool from scripts/build-core.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const build_output_js_1 = require("./build-output.js");
const BANNER = '// Generated from ';
const check = (0, build_output_js_1.checkRequested)('build-core.js');
(0, build_output_js_1.buildProgram)('tsconfig.core.json', 'pi-dish-core-', (files, read) => {
    if (files.some(file => file.includes('/'))) {
        throw new Error('Core sources must be flat: keep TypeScript files directly in src/core/. Nested output is not supported.');
    }
    const outputs = new Map(files.map(file => [
        `lib/${file}`,
        { source: `src/core/${file.replace(/\.js$|\.d\.ts$/, '.ts')}`, executable: false },
    ]));
    const orphaned = (0, build_output_js_1.orphanedOutputs)(['lib'], BANNER, outputs, false);
    if (orphaned.length)
        throw new Error(`Remove obsolete core output before building:\n${orphaned.join('\n')}`);
    (0, build_output_js_1.writeOutputs)((0, build_output_js_1.generatedOutputs)(outputs, { banner: BANNER, command: 'build:core', read: file => read(file.slice('lib/'.length)) }), {
        check,
        kind: 'Core',
        command: 'build:core',
        checkOk: 'Core types and generated output match.',
        writeOk: 'Core JavaScript and declarations generated.',
    });
});
