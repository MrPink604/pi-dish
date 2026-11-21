#!/usr/bin/env node
// Generated tool from scripts/run-tests.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * `npm test` — node:test launched from a sanitized environment. The operator's
 * shell exports the running deployment's HOST/PORT/share port, which suites that
 * boot server.js would inherit. Done here once, rather than through NODE_OPTIONS,
 * which would also re-enter this file inside spawned pi/omp children and strip
 * the bridge's own PI_DISH_SOCKET_DIR/PI_DISH_SPAWN_TOKEN.
 */
const fs = require("fs");
const path = require("path");
const child_process_1 = require("child_process");
const test_env_js_1 = require("../test/test-env.js");
const repo = path.dirname(__dirname);
const argv = process.argv.slice(2);
const flags = argv.filter((arg) => arg.startsWith('-'));
const files = argv.filter((arg) => !arg.startsWith('-'));
if (!files.length) {
    files.push(...fs.readdirSync(path.join(repo, 'test'))
        .filter((name) => name.endsWith('.test.js'))
        .sort()
        .map((name) => path.join('test', name)));
}
// All test files and their children allocate inside this owned run directory,
// including fixtures that don't otherwise import test-env.
process.env.TMPDIR = (0, test_env_js_1.createTestTempDir)('pd-test-');
const env = (0, test_env_js_1.sanitizeTestEnv)();
env.PI_DISH_OMP_COMMAND ??= test_env_js_1.fakeOmpModelsCommand;
const ownGroup = process.platform !== 'win32';
const child = (0, child_process_1.spawn)(process.execPath, ['--test', ...flags, ...files], {
    cwd: repo,
    env,
    detached: ownGroup,
    stdio: 'inherit',
});
// Node's test coordinator and its workers must stop together. Wait for the
// coordinator's exit before removing their shared TMPDIR.
let interrupted;
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
        interrupted = signal === 'SIGINT' ? 130 : 143;
        if (!ownGroup || !child.pid) {
            child.kill(signal);
            return;
        }
        try {
            process.kill(-child.pid, signal);
        }
        catch (error) {
            if (error.code !== 'ESRCH')
                throw error;
        }
    });
child.on('exit', (code, signal) => process.exit(interrupted ?? (signal ? 1 : code ?? 1)));
