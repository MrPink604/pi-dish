#!/usr/bin/env node
// Checked-in output bootstraps the pinned compiler after npm ci. Compile and
// validate the complete sibling mapping before replacing any executable output.
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) {
  throw new Error('Usage: node scripts/build-tools.js [--check]');
}
const config: unknown = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.tools.json'), 'utf8'));
if (typeof config !== 'object' || config === null || !('files' in config)
    || !Array.isArray(config.files) || !config.files.every((file: unknown) => typeof file === 'string')) {
  throw new Error('Tool compiler configuration must list its source files');
}
const banner = '// Generated tool from ';
// Preserve the existing executable modes; a shebang alone did not make every
// historical tool executable. The new bootstrap itself is directly executable.
const executables: Record<string, true | undefined> = {
  'scripts/build-tools.ts': true,
  'scripts/build-tests.ts': true,
  'scripts/build-edges.ts': true,
  'scripts/check-source-policy.mts': true,
  'scripts/run-tests.ts': true,
  'test/native-extensions.smoke.ts': true,
};
const outputs = new Map<string, { source: string; executable: boolean }>();
for (const source of config.files as string[]) {
  if ((!/^scripts\/[^/]+\.(?:ts|mts)$/.test(source)
      && source !== 'test/test-env.ts'
      && source !== 'test/native-extensions.smoke.ts'
      && source !== 'test/cron.test.ts' && source !== 'test/session-capabilities.test.ts'
      && source !== 'test/session-provenance.test.ts'
      && source !== 'test/stt.test.ts' && source !== 'test/test-env.test.ts'
      && source !== 'test/tmux-service.test.ts'
      && source !== 'test/skills-coverage.test.ts' && source !== 'test/transport-frames.test.ts'
      && source !== 'test/routines.test.ts' && source !== 'test/session-bounces.test.ts'
      && source !== 'test/runtime-resources.test.ts' && source !== 'test/git-diff.test.ts'
      && source !== 'test/file-mention.test.ts' && source !== 'test/recovery-runner.test.ts'
      && source !== 'test/session-foundation.test.ts'
      && source !== 'test/core-contracts.test.ts' && source !== 'test/core-build.test.ts'
      && source !== 'test/edge-build.test.ts' && source !== 'test/source-policy.test.ts'
      && source !== 'test/install.test.ts'
      && source !== 'test/skill-mining.test.ts' && source !== 'test/skills-core.test.ts'
      && source !== 'test/harness-pricing.test.ts' && source !== 'test/fixtures/fake-omp-models.ts'
      && source !== 'test/host-auth.test.ts' && source !== 'test/session-recovery.test.ts'
      && source !== 'test/fixtures/session-recovery-writer.ts')
      || /\.d\.(?:ts|mts)$/.test(source)) {
    throw new Error(`Unsupported tool source: ${source}`);
  }
  const esm = source.endsWith('.mts');
  const stem = source.replace(/\.(?:ts|mts)$/, '');
  for (const suffix of esm ? ['.mjs', '.d.mts'] : ['.js', '.d.ts']) {
    const file = stem + suffix;
    if (outputs.has(file)) throw new Error(`Duplicate tool output: ${file}`);
    outputs.set(file, { source, executable: executables[source] === true && !suffix.startsWith('.d.') });
  }
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-tools-'));
try {
  const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.tools.json', '--outDir', out], {
    cwd: root, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
  } else {
    const emitted = fs.readdirSync(out, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.relative(out, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
    const unexpected = emitted.filter(file => !outputs.has(file));
    const missing = [...outputs.keys()].filter(file => !emitted.includes(file));
    if (unexpected.length || missing.length) {
      throw new Error(`Tool output mapping mismatch; unexpected: ${unexpected.join(', ')}; missing: ${missing.join(', ')}`);
    }
    const orphaned: string[] = [];
    for (const directory of ['scripts', 'test', 'test/ui-scenarios', 'test/fixtures']) {
      const outputDirectory = path.join(root, directory);
      if (!fs.existsSync(outputDirectory)) continue;
      for (const entry of fs.readdirSync(outputDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(?:js|mjs|d\.ts|d\.mts)$/.test(entry.name)) continue;
        const file = `${directory}/${entry.name}`;
        if (!outputs.has(file) && fs.readFileSync(path.join(root, file), 'utf8').replace(/^#![^\n]*\n/, '').startsWith(banner)) {
          orphaned.push(file);
        }
      }
    }
    if (orphaned.length) throw new Error(`Remove obsolete tool output before building:\n${orphaned.join('\n')}`);
    const prepared = [];
    for (const [file, { source, executable }] of outputs) {
      const raw = fs.readFileSync(path.join(out, file), 'utf8');
      const shebang = raw.match(/^#![^\n]*\n/)?.[0] || '';
      if (executable && shebang !== '#!/usr/bin/env node\n') throw new Error(`CLI shebang missing or invalid: ${source}`);
      const content = shebang + `${banner}${source}; edit that source and run npm run build:tools.\n` + raw.slice(shebang.length);
      prepared.push({ file, target: path.join(root, file), content, mode: executable ? 0o755 : 0o644 });
    }
    const stale: string[] = [];
    for (const { file, target, content, mode } of prepared) {
      if (check) {
        if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content
            || (fs.statSync(target).mode & 0o777) !== mode) stale.push(file);
      } else {
        fs.writeFileSync(target, content);
        fs.chmodSync(target, mode);
      }
    }
    if (stale.length) {
      console.error(`Tool output is stale; run npm run build:tools:\n${stale.join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(check ? 'Tool types, generated output and modes match.' : 'Tool JavaScript and declarations generated.');
    }
  }
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
