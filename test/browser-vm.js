// Generated test/tool from test/browser-vm.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertBrowserApiContext = assertBrowserApiContext;
exports.browserSandbox = browserSandbox;
exports.loadBrowser = loadBrowser;
exports.loadSharedHelpers = loadSharedHelpers;
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
function assertBrowserApiContext(context) {
    assert.ok('PiDishBrowser' in context && typeof context.PiDishBrowser === 'object' && context.PiDishBrowser !== null);
}
function runPublicScript(sandbox, file) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), sandbox);
}
/** A fresh realm with `public/browser.js` loaded; `globals` seed the realm before the script runs. */
function browserSandbox(globals = {}) {
    const context = { URL, ...globals };
    runPublicScript(context, 'browser.js');
    assertBrowserApiContext(context);
    return context;
}
function loadBrowser(globals = {}) {
    return browserSandbox(globals).PiDishBrowser;
}
/** Adds `public/helpers.js` to a browser sandbox, as the page loads both scripts. */
function loadSharedHelpers(sandbox) {
    runPublicScript(sandbox, 'helpers.js');
    assert.ok('PiDishHelpers' in sandbox && typeof sandbox.PiDishHelpers === 'object' && sandbox.PiDishHelpers !== null);
    return sandbox;
}
