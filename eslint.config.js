const fs = require('node:fs');
const { createRequire } = require('node:module');
const espree = require('espree');
const globals = require('globals');

// Isolated tests load the independent helper and factory entrypoints. The
// production application bundles its dependencies and shares no app bindings.
/** @param {string} file */
function scriptGlobals(file) {
  const helperAst = espree.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
  /** @type {Record<string, 'readonly'>} */
  const helperGlobals = {};
  for (const node of helperAst.body) {
    if (node.type === 'FunctionDeclaration' && node.id) helperGlobals[node.id.name] = 'readonly';
    if (node.type === 'VariableDeclaration') for (const decl of node.declarations) {
      if (decl.id.type === 'Identifier') helperGlobals[decl.id.name] = 'readonly';
    }
  }
  return helperGlobals;
}
// Inspect the generated bundle's export names, not its erased implementation.
// The implementation is already checked by the browser/core compiler programs.
/** @type {Record<string, unknown>} */
const helperExports = createRequire(__filename)('./public/helpers');
const helperGlobals = { ...scriptGlobals('public/helpers.js'),
  ...Object.fromEntries(Object.keys(helperExports).map(name => [name, 'readonly'])),
};
const browserGlobals = scriptGlobals('public/browser.js');
/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  { ignores: ['.claude/**', '.agents/**', '.codex/**', 'node_modules/**', 'public/vendor/**', 'dist/**', 'test-results/**', 'playwright-report/**', 'docs/**', 'pd-scratch/**'] },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    rules: {
      'no-undef': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error',
      'no-duplicate-case': 'error', 'no-unreachable': 'error',
      'no-unsafe-finally': 'error', 'valid-typeof': 'error',
    },
  },
  { files: ['**/*.mjs'], languageOptions: { sourceType: 'module' } },
  { files: ['public/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...helperGlobals, ...browserGlobals, marked: 'readonly', hljs: 'readonly', katex: 'readonly', mermaid: 'readonly', Terminal: 'readonly', FitAddon: 'readonly' } } },
  // Feature observations exist only in the intercepted test fixture bundle.
  { files: ['test/ui-smoke.js', 'test/ui-scenarios/*.js', 'test/browser/*.js', 'scripts/readme-shots.js'], languageOptions: { globals: { ...globals.browser, ...helperGlobals, ...browserGlobals, fixtureApp: 'readonly' } } },
];
