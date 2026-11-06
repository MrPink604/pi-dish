#!/usr/bin/env node
// Checked-in output bootstraps the pinned compiler after npm ci; the complete
// sibling mapping is validated before any executable output is replaced.
import { buildProgram, checkRequested, generatedOutputs, orphanedOutputs, programFiles, siblingOutputs, verifyMapping, writeOutputs } from './build-output.js';

const BANNER = '// Generated tool from ';
const check = checkRequested('build-tools');
const sources = programFiles('tsconfig.tools.json');
for (const source of sources) {
  if (!/^(?:scripts|test)\/(?:[^/]+\/)*[^/]+\.(?:ts|mts)$/.test(source) || /\.d\.(?:ts|mts)$/.test(source)) {
    throw new Error(`Unsupported tool source: ${source}`);
  }
}
// Preserve the existing executable modes; a shebang alone did not make every
// historical tool executable.
const executables: Record<string, true> = {
  'scripts/build-tools.ts': true,
  'scripts/build-tests.ts': true,
  'scripts/build-edges.ts': true,
  'scripts/check-source-policy.mts': true,
  'scripts/run-tests.ts': true,
  'test/native-extensions.smoke.ts': true,
};
const outputs = siblingOutputs(sources, {
  kind: 'Tool',
  declarations: () => true,
  executable: source => executables[source] === true,
});

buildProgram('tsconfig.tools.json', 'pi-dish-tools-', (files, read) => {
  verifyMapping('Tool', files, outputs);
  const orphaned = orphanedOutputs(['scripts', 'test', 'test/ui-scenarios', 'test/fixtures'], BANNER, outputs, false);
  if (orphaned.length) throw new Error(`Remove obsolete tool output before building:\n${orphaned.join('\n')}`);
  writeOutputs(generatedOutputs(outputs, { banner: BANNER, command: 'build:tools', read: file => read(file) }), {
    check,
    kind: 'Tool',
    command: 'build:tools',
    checkOk: 'Tool types, generated output and modes match.',
    writeOk: 'Tool JavaScript and declarations generated.',
  });
});
