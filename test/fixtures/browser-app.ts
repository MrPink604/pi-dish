// Fixture-only observation of the real composition. The production build has
// no probe import, global application object, or instrumentation switch.
import fs = require('node:fs');
import path = require('node:path');
import * as esbuild from 'esbuild';
import * as espree from 'espree';
import type { Page, Route } from '@playwright/test';
const root = path.resolve(__dirname, '../..');
let pending: Promise<string> | undefined;

function fixtureAppBundle(): Promise<string> {
  if (!pending) pending = esbuild.build({
    absWorkingDir: root, entryPoints: ['src/browser/app.ts'], bundle: true,
    platform: 'browser', format: 'iife', target: 'es2022', write: false,
    plugins: [{ name: 'observe-application-features', setup(build: esbuild.PluginBuild) {
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
            if (!call.range || !call.arguments.every(arg => arg.range)) throw new Error(`Application fixture cannot locate ${name}`);
            const [start, end] = call.range;
            const args = call.arguments.map(arg => source.slice(...arg.range!));
            edits.push({ start, end, text: `observeFeature(${JSON.stringify(name)}, ${JSON.stringify(call.callee.name)}, ${call.callee.name}${args.length ? ', ' + args.join(', ') : ''})` });
          }
        }
        if (!edits.length) throw new Error('Application fixture did not observe any feature construction');
        let contents = source;
        for (const edit of edits.reverse()) contents = contents.slice(0, edit.start) + edit.text + contents.slice(edit.end);
        return { contents: `import { observeFeature, completeFixtureObservation } from '../../test/fixtures/browser-feature-probe.mjs';\n${contents}\ncompleteFixtureObservation();`, loader: 'js', resolveDir: path.dirname(file) };
      });
    } }],
  }).then(result => result.outputFiles[0]!.text);
  return pending;
}

async function installFixtureApp(page: Page) {
  const bundle = await fixtureAppBundle();
  await page.route('**/app.js', (route: Route) => route.fulfill({ contentType: 'application/javascript', body: bundle }));
  await page.addInitScript(() => {
    Reflect.set(globalThis, 'fixtureElement', <T>(value: T | null | undefined, label: string): T => {
      if (value === null || value === undefined) throw new Error(`Missing fixture element: ${label}`);
      return value;
    });
    Reflect.set(globalThis, 'fixtureInput', (value: Element | null | undefined, label: string) => {
      if (!(value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement || value instanceof HTMLSelectElement)) {
        throw new Error(`Missing fixture input: ${label}`);
      }
      return value;
    });
    Reflect.set(globalThis, 'fixtureDetails', (value: Element | null | undefined, label: string) => {
      if (!(value instanceof HTMLDetailsElement)) throw new Error(`Missing fixture details: ${label}`);
      return value;
    });
    Reflect.set(globalThis, 'fixtureLink', (value: Element | null | undefined, label: string) => {
      if (!(value instanceof HTMLAnchorElement)) throw new Error(`Missing fixture link: ${label}`);
      return value;
    });
    Reflect.set(globalThis, 'fixtureCurrentSession', () => {
      const current = Reflect.get(Reflect.get(Reflect.get(globalThis, 'fixtureApp'), 'features'), 'sessionState');
      const session = Reflect.get(current, 'currentSession');
      if (!session) throw new Error('Fixture has no selected session');
      return session;
    });
    Reflect.set(globalThis, 'fixtureTerminalProbe', () => {
      const probe = Reflect.get(globalThis, 'termProbe');
      if (!probe || typeof probe !== 'object' || !Reflect.get(probe, 'controller')) {
        throw new Error('Terminal probe is incomplete');
      }
      return probe;
    });
  });
  // Isolated factory probes and pure helper assertions use their existing test
  // entrypoints. Neither entrypoint is loaded by the production page.
  await page.addInitScript({ content: ['browser.js', 'helpers.js'].map(file => fs.readFileSync(path.join(root, 'public', file), 'utf8')).join('\n') + '\nglobalThis.PiDishBrowser = PiDishBrowser;' });
}

export { fixtureAppBundle, installFixtureApp };
