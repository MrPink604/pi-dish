#!/usr/bin/env node
import path = require('node:path');
import { spawnSync } from 'node:child_process';
import esbuild = require('esbuild');
import { checkRequested, root, writeOutputs, type GeneratedOutput } from './build-output.js';

const check = checkRequested('build-browser.js');
const compiled = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.browser.json'], { cwd: root, stdio: 'inherit' });
if (compiled.error) throw compiled.error;
if (compiled.status !== 0) process.exit(compiled.status || 1);

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
const prepared: GeneratedOutput[] = entries.map(entry => {
  const result = esbuild.buildSync({
    absWorkingDir: root, entryPoints: [entry.source], bundle: true,
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
  return { file: entry.target, target: path.join(root, entry.target), content: result.outputFiles[0].contents, mode: 0o644 };
});

writeOutputs(prepared, {
  check,
  kind: 'Browser',
  command: 'build:browser',
  checkOk: 'Browser types and generated outputs match.',
  writeOk: 'Browser scripts generated.',
});
