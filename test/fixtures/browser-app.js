// Fixture-only observation of the real composition. The production build has
// no probe import, global application object, or instrumentation switch.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const espree = require('espree');
const root = path.resolve(__dirname, '../..');
let pending;

function fixtureAppBundle() {
  if (!pending) pending = esbuild.build({
    absWorkingDir: root, entryPoints: ['src/browser/app.ts'], bundle: true,
    platform: 'browser', format: 'iife', target: 'es2022', write: false,
    plugins: [{ name: 'observe-application-features', setup(build) {
      build.onLoad({ filter: /\/src\/browser\/app\.ts$/ }, async ({ path: file }) => {
        const source = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', target: 'es2022' }).code;
        const tree = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true });
        const edits = [];
        // Capture only actual top-level feature construction, not arbitrary
        // private bindings or forwarding names. Options are the same objects
        // supplied to the owners, so races can hold a specific feature's port.
        for (const statement of tree.body) {
          const constructions = statement.type === 'VariableDeclaration'
            ? statement.declarations.map(declaration => ({ name: declaration.id.type === 'Identifier' ? declaration.id.name : null, call: declaration.init }))
            : statement.type === 'ExpressionStatement' && statement.expression.type === 'CallExpression'
              && statement.expression.callee.type === 'Identifier' && statement.expression.callee.name === 'createAppBindings'
              ? [{ name: 'appBindings', call: statement.expression }] : [];
          for (const { name, call } of constructions) {
            if (!name || call?.type !== 'CallExpression' || call.callee.type !== 'Identifier' || !call.callee.name.startsWith('create')) continue;
            const [start, end] = call.range;
            const args = call.arguments.map(arg => source.slice(...arg.range));
            edits.push({ start, end, text: `observeFeature(${JSON.stringify(name)}, ${call.callee.name}${args.length ? ', ' + args.join(', ') : ''})` });
          }
        }
        if (!edits.length) throw new Error('Application fixture did not observe any feature construction');
        let contents = source;
        for (const edit of edits.reverse()) contents = contents.slice(0, edit.start) + edit.text + contents.slice(edit.end);
        return { contents: `import { observeFeature } from '../../test/fixtures/browser-feature-probe.mjs';\n${contents}`, loader: 'js', resolveDir: path.dirname(file) };
      });
    } }],
  }).then(result => result.outputFiles[0].text);
  return pending;
}

async function installFixtureApp(page) {
  const bundle = await fixtureAppBundle();
  await page.route('**/app.js', route => route.fulfill({ contentType: 'application/javascript', body: bundle }));
  // Isolated factory probes and pure helper assertions use their existing test
  // entrypoints. Neither entrypoint is loaded by the production page.
  await page.addInitScript({ content: ['browser.js', 'helpers.js'].map(file => fs.readFileSync(path.join(root, 'public', file), 'utf8')).join('\n') + '\nglobalThis.PiDishBrowser = PiDishBrowser;' });
}

module.exports = { fixtureAppBundle, installFixtureApp };
