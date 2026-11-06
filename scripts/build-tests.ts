#!/usr/bin/env node
import fs = require('node:fs');
import path = require('node:path');
import { buildProgram, checkRequested, generatedOutputs, orphanedOutputs, programFiles, root, siblingOutputs, verifyMapping, writeOutputs } from './build-output.js';
import type { OutputEntry } from './build-output.js';

const BANNER = '// Generated test/tool from ';
const check = checkRequested('build-tests');
const programs = ['tsconfig.node-tests.json', 'tsconfig.browser-tests.json', 'tsconfig.ui-tests.json', 'tsconfig.dev-tools.json'];
const declarationPrograms: Record<string, true> = { 'tsconfig.node-tests.json': true, 'tsconfig.dev-tools.json': true };

const projectOf = new Map<string, string>();
const outputs = new Map<string, OutputEntry>();
for (const program of programs) {
  const sources = programFiles(program).filter(source => source !== 'test/browser/globals.d.ts');
  for (const source of sources) {
    if (!/^(?:test|scripts)\//.test(source) || /\.d\.(?:ts|mts)$/.test(source)) {
      throw new Error(`Unsupported ${program} source: ${source}`);
    }
  }
  for (const [file, entry] of siblingOutputs(sources, {
    kind: 'Test',
    declarations: () => declarationPrograms[program] === true,
    executable: () => false,
  })) {
    if (outputs.has(file)) throw new Error(`Duplicate test output: ${file}`);
    outputs.set(file, entry);
    projectOf.set(file, program);
  }
}

const emitted = new Map<string, string>();
let failed = false;
for (const program of programs) {
  const compiled = buildProgram(program, 'pi-dish-tests-', (files, read) => {
    for (const file of files) {
      if (projectOf.get(file) !== program) continue;
      if (emitted.has(file)) throw new Error(`Multiple compiler programs emitted owned output ${file}`);
      emitted.set(file, read(file));
    }
  });
  if (!compiled) { failed = true; break; }
}

if (!failed) {
  const unexpected = [...emitted.keys()].filter(file => !outputs.has(file));
  const missing = [...outputs.keys()].filter(file => !emitted.has(file));
  const orphaned = orphanedOutputs(['test', 'scripts'], BANNER, outputs, true);
  if (unexpected.length || missing.length || (check && orphaned.length)) {
    throw new Error(`Test output mapping mismatch; unexpected: ${unexpected.join(', ')}; missing: ${missing.join(', ')}; orphaned: ${orphaned.join(', ')}`);
  }
  if (!check) for (const file of orphaned) fs.rmSync(path.join(root, file));
  writeOutputs(generatedOutputs(outputs, { banner: BANNER, command: 'build:tests', read: file => emitted.get(file)! }), {
    check,
    kind: 'Test',
    command: 'build:tests',
    checkOk: 'Test types, generated outputs and modes match.',
    writeOk: 'Test JavaScript and declarations generated.',
  });
}
