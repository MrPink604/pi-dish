import assert = require('node:assert/strict');
import type * as BrowserApi from '../src/browser/index.js';
import type * as SharedHelpers from '../src/browser/shared-helpers.js';

type BrowserApiContext = { PiDishBrowser: typeof BrowserApi };
type SharedHelpersContext = { PiDishHelpers: typeof SharedHelpers };

function assertBrowserApiContext(context: object): asserts context is object & BrowserApiContext {
  assert.ok('PiDishBrowser' in context && typeof context.PiDishBrowser === 'object' && context.PiDishBrowser !== null);
}

function assertSharedHelpersContext(context: object): asserts context is object & SharedHelpersContext {
  assert.ok('PiDishHelpers' in context && typeof context.PiDishHelpers === 'object' && context.PiDishHelpers !== null);
}

export { assertBrowserApiContext, assertSharedHelpersContext };
