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
const entries = [
  { source: 'src/browser/index.ts', target: 'public/browser.js', globalName: 'PiDishBrowser' },
  { source: 'src/browser/artifact-comments.ts', target: 'public/artifact-comments.js' },
];
const outputs = entries.map(entry => {
  const result = esbuild.buildSync({
    absWorkingDir: root, entryPoints: [entry.source], bundle: true,
    platform: 'browser', format: 'iife', globalName: entry.globalName, target: 'es2022',
    outfile: entry.target, write: false, metafile: true,
    banner: { js: '// Generated from src/browser/; edit sources and run npm run build:browser.' },
  });
  if (Object.keys(result.metafile.inputs).some(input => !input.startsWith('src/'))) {
    throw new Error('Browser runtime imports must stay in src/; legacy script imports must be type-only');
  }
  if (result.outputFiles.length !== 1 || Object.values(result.metafile.outputs).some(out => out.imports.length)) {
    throw new Error('Each browser entrypoint must produce one self-contained local script');
  }
  return { target: path.join(root, entry.target), contents: result.outputFiles[0].contents };
});
// Validate every entry before writing any output, including in check mode.
if (check) {
  const stale = outputs.filter(output => !fs.existsSync(output.target)
    || !fs.readFileSync(output.target).equals(output.contents));
  if (stale.length) {
    console.error('Browser output is stale; run npm run build:browser');
    process.exitCode = 1;
  } else console.log('Browser types and generated outputs match.');
} else {
  for (const output of outputs) fs.writeFileSync(output.target, output.contents);
  console.log('Browser scripts generated.');
}
