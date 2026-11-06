#!/usr/bin/env node
// Generated tool from scripts/build-tools.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Checked-in output bootstraps the pinned compiler after npm ci; the complete
// sibling mapping is validated before any executable output is replaced.
const build_output_js_1 = require("./build-output.js");
const BANNER = '// Generated tool from ';
const check = (0, build_output_js_1.checkRequested)('build-tools.js');
const sources = (0, build_output_js_1.programFiles)('tsconfig.tools.json');
for (const source of sources) {
    if (!/^(?:scripts|test)\/(?:[^/]+\/)*[^/]+\.(?:ts|mts)$/.test(source) || /\.d\.(?:ts|mts)$/.test(source)) {
        throw new Error(`Unsupported tool source: ${source}`);
    }
}
// Preserve the existing executable modes; a shebang alone did not make every
// historical tool executable.
const executables = {
    'scripts/build-tools.ts': true,
    'scripts/build-tests.ts': true,
    'scripts/build-edges.ts': true,
    'scripts/check-source-policy.mts': true,
    'scripts/run-tests.ts': true,
    'test/native-extensions.smoke.ts': true,
};
const outputs = (0, build_output_js_1.siblingOutputs)(sources, {
    kind: 'Tool',
    declarations: () => true,
    executable: source => executables[source] === true,
});
(0, build_output_js_1.buildProgram)('tsconfig.tools.json', 'pi-dish-tools-', (files, read) => {
    (0, build_output_js_1.verifyMapping)('Tool', files, outputs);
    const orphaned = (0, build_output_js_1.orphanedOutputs)(['scripts', 'test', 'test/ui-scenarios', 'test/fixtures'], BANNER, outputs, false);
    if (orphaned.length)
        throw new Error(`Remove obsolete tool output before building:\n${orphaned.join('\n')}`);
    (0, build_output_js_1.writeOutputs)((0, build_output_js_1.generatedOutputs)(outputs, { banner: BANNER, command: 'build:tools', read: file => read(file) }), {
        check,
        kind: 'Tool',
        command: 'build:tools',
        checkOk: 'Tool types, generated output and modes match.',
        writeOk: 'Tool JavaScript and declarations generated.',
    });
});
