// Generated test/tool from test/browser-composer-autocomplete.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { decodeSlashCommands, decodeFileCompletions, createSessionState, createSessionReferences } = context.PiDishBrowser;
test('autocomplete wire data narrows command and file fields without mutating input', () => {
    const wire = [null, { name: 1 }, { name: 'valid', args: {}, source: 'extension', description: ['bad'] }];
    const commands = decodeSlashCommands(wire);
    const command = commands[0];
    assert.ok(command);
    assert.equal(commands.length, 1);
    assert.equal(command.args, '');
    assert.equal(command.description, '');
    const files = decodeFileCompletions([{ path: 'a', isDir: 'yes', gitStatus: '__proto__' }, { path: 1 }]);
    const file = files[0];
    assert.ok(file);
    assert.equal(files.length, 1);
    assert.equal(file.isDir, false);
    const source = wire[2];
    assert.ok(source);
    assert.equal(source.source, 'extension');
});
test('session refs use target-host naming and keep exact host-id references unambiguous', () => {
    const state = createSessionState({ getSelfHostId: () => 'self', getHostLabel: id => id, onListsChanged() { }, onCurrentChanged() { } });
    state.setSessionLists([{ hostId: 'self', active: [{ id: 'same-id', name: 'Local' }] },
        { hostId: 'peer', active: [{ id: 'same-id', name: 'Remote' }, { id: 'other-id' }] }]);
    state.setCurrentSession('same-id', 'peer');
    const hosts = {
        self: { hostId: 'self', key: 'self', source: 'self', base: '', capabilities: {} },
        peer: { hostId: 'peer', key: 'peer', source: 'fleet', base: 'http://peer', name: 'named-peer', capabilities: {} },
    };
    const refs = createSessionReferences({ sessionState: state, selfId: () => 'self', host: id => id === 'peer' ? hosts.peer : hosts.self, hostLabel: id => id || '', config: () => ({}) });
    const matched = refs.match('same-id');
    assert.ok(matched);
    assert.equal(matched.host, 'peer');
    assert.equal(refs.candidates().filter(row => row.id === 'same-id').length, 1);
    assert.equal(refs.ref({ id: 'same-id', host: 'peer' }, { id: 'same-id', host: 'self' }), 'named-peer/same-id');
    assert.equal(refs.ref({ id: 'same-id', host: 'self' }, { id: 'same-id', host: 'peer' }), 'self:same-id');
});
