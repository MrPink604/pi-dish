// Generated test/tool from test/browser-vm.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertBrowserApiContext = assertBrowserApiContext;
exports.assertSharedHelpersContext = assertSharedHelpersContext;
const assert = require("node:assert/strict");
function assertBrowserApiContext(context) {
    assert.ok('PiDishBrowser' in context && typeof context.PiDishBrowser === 'object' && context.PiDishBrowser !== null);
}
function assertSharedHelpersContext(context) {
    assert.ok('PiDishHelpers' in context && typeof context.PiDishHelpers === 'object' && context.PiDishHelpers !== null);
}
