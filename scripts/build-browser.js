// Generated tool from scripts/build-browser.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const esbuild = require("esbuild");
const build_output_js_1 = require("./build-output.js");
const check = (0, build_output_js_1.checkRequested)('build-browser.js');
const compiled = (0, node_child_process_1.spawnSync)(process.execPath, [path.join(build_output_js_1.root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.browser.json'], { cwd: build_output_js_1.root, stdio: 'inherit' });
if (compiled.error)
    throw compiled.error;
if (compiled.status !== 0)
    process.exit(compiled.status || 1);
const entries = [
    { source: 'src/browser/app.ts', target: 'public/app.js' },
    { source: 'src/browser/theme-prepaint.ts', target: 'public/theme-prepaint.js' },
    { source: 'src/browser/index.ts', target: 'public/browser.js', globalName: 'PiDishBrowser' },
    { source: 'src/browser/artifact-comments.ts', target: 'public/artifact-comments.js' },
    { source: 'src/browser/service-worker.ts', target: 'public/sw.js' },
    { source: 'src/browser/shared-helpers.ts', target: 'public/helpers.js', globalName: 'PiDishHelpers',
        footer: 'if (typeof module !== "undefined" && module.exports) module.exports = PiDishHelpers; else Object.assign(globalThis, PiDishHelpers);' },
];
// Every entry is built and validated before any output is written.
const prepared = entries.map(entry => {
    const result = esbuild.buildSync({
        absWorkingDir: build_output_js_1.root, entryPoints: [entry.source], bundle: true,
        platform: 'browser', format: 'iife', globalName: entry.globalName, target: 'es2022',
        outfile: entry.target, write: false, metafile: true, minify: true,
        footer: entry.footer ? { js: entry.footer } : undefined,
        banner: { js: '// Generated from src/browser/; edit sources and run npm run build:browser.' },
    });
    if (Object.keys(result.metafile.inputs).some(input => !input.startsWith('src/'))) {
        throw new Error('Browser runtime imports must stay in src/; legacy script imports must be type-only');
    }
    for (const [input, metadata] of Object.entries(result.metafile.inputs)) {
        if (input.startsWith('src/core/helper-')
            && metadata.imports.some(dependency => !dependency.path.startsWith('src/core/helper-'))) {
            throw new Error(`Shared helper runtime dependencies must stay in the portable core helper closure: ${input}`);
        }
    }
    if (result.outputFiles.length !== 1 || Object.values(result.metafile.outputs).some(out => out.imports.length)) {
        throw new Error('Each browser entrypoint must produce one self-contained local script');
    }
    return { file: entry.target, target: path.join(build_output_js_1.root, entry.target), content: result.outputFiles[0].contents, mode: 0o644 };
});
(0, build_output_js_1.writeOutputs)(prepared, {
    check,
    kind: 'Browser',
    command: 'build:browser',
    checkOk: 'Browser types and generated outputs match.',
    writeOk: 'Browser scripts generated.',
});
