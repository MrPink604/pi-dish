// Checked-in local browser bundle. Type failures and check mode never rewrite it.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/build-browser.js [--check]');
const compiled = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.browser.json'], { cwd: root, stdio: 'inherit' });
if (compiled.error) throw compiled.error;
if (compiled.status !== 0) process.exit(compiled.status || 1);
const esbuild = require('esbuild');
const result = esbuild.buildSync({
  absWorkingDir: root, entryPoints: ['src/browser/index.ts'], bundle: true,
  platform: 'browser', format: 'iife', globalName: 'PiDishBrowser', target: 'es2022',
  outfile: 'public/browser.js', write: false, metafile: true,
  banner: { js: '// Generated from src/browser/; edit sources and run npm run build:browser.' },
});
if (Object.keys(result.metafile.inputs).some(input => !input.startsWith('src/'))) {
  throw new Error('Browser runtime imports must stay in src/; legacy script imports must be type-only');
}
if (result.outputFiles.length !== 1 || Object.values(result.metafile.outputs).some(out => out.imports.length)) {
  throw new Error('Browser build must produce one self-contained local script');
}
const output = result.outputFiles[0];
const target = path.join(root, 'public/browser.js');
if (check) {
  if (!fs.existsSync(target) || !fs.readFileSync(target).equals(output.contents)) {
    console.error('Browser output is stale; run npm run build:browser');
    process.exitCode = 1;
  } else console.log('Browser types and generated output match.');
} else {
  fs.writeFileSync(target, output.contents);
  console.log('Browser script generated.');
}
