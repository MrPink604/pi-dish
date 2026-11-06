#!/usr/bin/env node
import { buildProgram, checkRequested, generatedOutputs, orphanedOutputs, writeOutputs, type OutputMap } from './build-output.js';

const BANNER = '// Generated from ';
const check = checkRequested('build-core.js');

buildProgram('tsconfig.core.json', 'pi-dish-core-', (files, read) => {
  if (files.some(file => file.includes('/'))) {
    throw new Error('Core sources must be flat: keep TypeScript files directly in src/core/. Nested output is not supported.');
  }
  const outputs: OutputMap = new Map(files.map(file => [
    `lib/${file}`,
    { source: `src/core/${file.replace(/\.js$|\.d\.ts$/, '.ts')}`, executable: false },
  ]));
  const orphaned = orphanedOutputs(['lib'], BANNER, outputs, false);
  if (orphaned.length) throw new Error(`Remove obsolete core output before building:\n${orphaned.join('\n')}`);
  writeOutputs(generatedOutputs(outputs, { banner: BANNER, command: 'build:core', read: file => read(file.slice('lib/'.length)) }), {
    check,
    kind: 'Core',
    command: 'build:core',
    checkOk: 'Core types and generated output match.',
    writeOk: 'Core JavaScript and declarations generated.',
  });
});
