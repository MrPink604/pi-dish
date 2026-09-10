const fs = require('node:fs');
const espree = require('espree');
const globals = require('globals');

// index.html loads helpers before app.js as ordinary scripts. Declare that
// actual shared surface instead of disabling undefined-name checks in app.js.
function scriptGlobals(file) {
  const helperAst = espree.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
  const helperGlobals = {};
  for (const node of helperAst.body) {
    if (node.type === 'FunctionDeclaration') helperGlobals[node.id.name] = 'readonly';
    if (node.type === 'VariableDeclaration') for (const decl of node.declarations) {
      if (decl.id.type === 'Identifier') helperGlobals[decl.id.name] = 'readonly';
    }
  }
  return helperGlobals;
}
const helperGlobals = scriptGlobals('public/helpers.js');
const sessionStateGlobals = scriptGlobals('public/session-state.js');
const appGlobals = scriptGlobals('public/app.js');
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
  { files: ['public/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...helperGlobals, ...sessionStateGlobals, marked: 'readonly', hljs: 'readonly', katex: 'readonly', mermaid: 'readonly', Terminal: 'readonly', FitAddon: 'readonly' } } },
  // Test evaluations share the actual browser script surface. Deriving these
  // names makes renamed/removed app functions fail lint in their callers too.
  { files: ['test/ui-smoke.js', 'test/ui-scenarios/*.js', 'test/browser/*.js', 'scripts/readme-shots.js'], languageOptions: { globals: { ...globals.browser, ...helperGlobals, ...sessionStateGlobals, ...appGlobals } } },
];
