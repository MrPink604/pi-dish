import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm');
import type * as BrowserApi from '../src/browser/index.js';
import type * as SharedHelpers from '../src/browser/shared-helpers.js';

type BrowserApiContext = { PiDishBrowser: typeof BrowserApi };
type Sandbox = Record<string, unknown> & BrowserApiContext;

export function assertBrowserApiContext(context: object): asserts context is object & BrowserApiContext {
  assert.ok('PiDishBrowser' in context && typeof context.PiDishBrowser === 'object' && context.PiDishBrowser !== null);
}

function runPublicScript(sandbox: object, file: string): void {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), sandbox);
}

/** A fresh realm with `public/browser.js` loaded; `globals` seed the realm before the script runs. */
export function browserSandbox(globals: Record<string, unknown> = {}): Sandbox {
  const context: Record<string, unknown> = { URL, ...globals };
  runPublicScript(context, 'browser.js');
  assertBrowserApiContext(context);
  return context;
}

export function loadBrowser(globals: Record<string, unknown> = {}): typeof BrowserApi {
  return browserSandbox(globals).PiDishBrowser;
}

/** Adds `public/helpers.js` to a browser sandbox, as the page loads both scripts. */
export function loadSharedHelpers(sandbox: Sandbox): Sandbox & { PiDishHelpers: typeof SharedHelpers } {
  runPublicScript(sandbox, 'helpers.js');
  assert.ok('PiDishHelpers' in sandbox && typeof sandbox.PiDishHelpers === 'object' && sandbox.PiDishHelpers !== null);
  return sandbox as Sandbox & { PiDishHelpers: typeof SharedHelpers };
}
