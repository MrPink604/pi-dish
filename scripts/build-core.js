#!/usr/bin/env node
// Compile into a temporary directory first: a type error cannot leave a
// partially updated runtime. --check compares without changing tracked files.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) {
  throw new Error('Usage: node scripts/build-core.js [--check]');
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-core-'));
try {
  const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.core.json', '--outDir', out], {
    cwd: root, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
  } else {
    const entries = fs.readdirSync(out, { withFileTypes: true });
    if (entries.some(entry => !entry.isFile())) {
      throw new Error('Core sources must be flat: keep TypeScript files directly in src/core/. Nested output is not supported.');
    }
    const files = entries.map(entry => entry.name).sort();
    // A removed/renamed source must not leave an old executable module that
    // --check can no longer see. Only inspect files bearing our own banner.
    const orphaned = fs.readdirSync(path.join(root, 'lib')).filter(file => {
      const target = path.join(root, 'lib', file);
      return /\.(js|ts)$/.test(file) && fs.statSync(target).isFile() && !files.includes(file)
        && fs.readFileSync(target, 'utf8').startsWith('// Generated from src/core/');
    });
    if (orphaned.length) throw new Error(`Remove obsolete core output before building:\n${orphaned.map(file => `lib/${file}`).join('\n')}`);
    const stale = [];
    for (const file of files) {
      const source = file.replace(/\.js$|\.d\.ts$/, '.ts');
      const generated = `// Generated from src/core/${source}; edit that source and run npm run build:core.\n`
        + fs.readFileSync(path.join(out, file), 'utf8');
      const target = path.join(root, 'lib', file);
      if (check) {
        if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== generated) stale.push(`lib/${file}`);
      } else {
        fs.writeFileSync(target, generated);
      }
    }
    if (stale.length) {
      console.error(`Core output is stale; run npm run build:core:\n${stale.join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(check ? 'Core types and generated output match.' : 'Core JavaScript and declarations generated.');
    }
  }
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
