// Generated test/tool from test/native-extension-boundary.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const { sanitizeTestEnv } = require('./test-env');
const execute = (0, node_util_1.promisify)(node_child_process_1.execFile);
const nativeBoundaryHost = path.join(__dirname, 'fixtures', 'native-boundary-host.ts');
const nativeQueueHost = path.join(__dirname, 'fixtures', 'native-queue-boundary-host.ts');
test('native unknown-host guards retain Prime duplicate token adoption', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-native-boundary-'));
    const env = sanitizeTestEnv({ PATH: process.env.PATH, HOME: root, TMUX: '', TMUX_PANE: '' });
    env.PI_DISH_SOCKET_DIR = path.join(root, 'sockets');
    try {
        const result = await execute('bun', [nativeBoundaryHost], { env, cwd: root, timeout: 10000 });
        assert.match(result.stdout, /native boundary passed/);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
test('Pi malformed queue alignment refuses cancellation without losing display or delivered messages', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-pi-private-'));
    const env = sanitizeTestEnv({ PATH: process.env.PATH, HOME: root, TMUX: '', TMUX_PANE: '' });
    try {
        const result = await execute('bun', [nativeQueueHost], { env, cwd: root, timeout: 10000 });
        assert.match(result.stdout, /Pi malformed queue alignment passed/);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
