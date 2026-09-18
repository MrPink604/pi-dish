// Generated test/tool from test/browser-recovery.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { decodeRecoveryMode, decodeRecoveryReport } = context.PiDishBrowser;
const plain = (value) => JSON.parse(JSON.stringify(value));
test('recovery wire data narrows rows and mode values without borrowing malformed payloads', () => {
    const wire = { mode: 'constructor', sessions: [null, { id: 5 }, { id: '' }, { id: 's', status: 'needs-review', name: { bad: true }, excluded: 'false', updatedAt: false }], truncated: true, totalRecords: Infinity };
    const result = decodeRecoveryReport(wire);
    const mutable = wire.sessions[3];
    assert.ok(mutable);
    mutable.status = 'changed';
    assert.deepEqual(plain(result), { mode: 'constructor', sessions: [{ id: 's', name: '', status: 'needs-review', harnessId: '', cwd: '', reason: '', excluded: false, updatedAt: null }], truncated: true, totalRecords: 1 });
    assert.equal(decodeRecoveryMode('continue'), 'continue');
    assert.equal(decodeRecoveryMode('restore'), 'restore');
    assert.equal(decodeRecoveryMode('constructor'), 'off');
    assert.throws(() => decodeRecoveryReport([]), /Invalid recovery report/);
});
