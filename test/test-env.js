// Generated tool from test/test-env.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeTestEnv = sanitizeTestEnv;
exports.applyTestEnv = applyTestEnv;
/**
 * The environment every test process must start from: the operator's live
 * deployment variables (tailnet HOST, deployment PORT, share port, token) must
 * not reach a suite that boots server.js, and the bind target is pinned to an
 * ephemeral loopback port.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
// Each names a host binary or opts a suite out; none can retarget the server.
const KEEP = {
    PI_DISH_SKIP_INTEGRATION: true,
    PI_DISH_PI_COMMAND: true,
    PI_DISH_OMP_COMMAND: true,
    PI_DISH_PRIME_COMMAND: true,
    PI_DISH_REAL_OMP_BIN: true,
    PI_DISH_REAL_PRIME_BIN: true,
    PI_DISH_REAL_BUN_BIN_DIR: true,
};
// Read straight by server.js at listen time.
const DROP = ['HOST', 'PORT'];
// The OMP bridge suites spawn `bun`, which a non-interactive shell does not
// find in its usual `~/.bun/bin`.
function withBunOnPath(env) {
    const executable = (dir) => {
        try {
            fs.accessSync(path.join(dir, 'bun'), fs.constants.X_OK);
            return true;
        }
        catch {
            return false;
        }
    };
    const entries = (env.PATH || '').split(path.delimiter).filter(Boolean);
    if (entries.some(executable))
        return env;
    const found = [
        env.BUN_INSTALL && path.join(env.BUN_INSTALL, 'bin'),
        env.HOME && path.join(env.HOME, '.bun', 'bin'),
    ].filter((dir) => Boolean(dir)).find(executable);
    if (found)
        env.PATH = [found, ...entries].join(path.delimiter);
    return env;
}
function sanitizeTestEnv(env = process.env) {
    const next = { ...env };
    for (const key of Object.keys(next)) {
        if (key.startsWith('PI_DISH_') && KEEP[key] !== true)
            delete next[key];
    }
    for (const key of DROP)
        delete next[key];
    // Prime live rows come from a resident daemon socket outside HOME; pin a
    // nonexistent path so no test attaches to the operator's daemon. A suite
    // that needs a fake daemon sets its own path afterwards.
    next.PRIME_AGENT_DAEMON_SOCKET = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dish-prime-daemon-')), 'daemon.sock');
    next.HOST = '127.0.0.1';
    next.PORT = '0';
    return withBunOnPath(next);
}
function applyTestEnv() {
    const sanitized = sanitizeTestEnv(process.env);
    for (const key of Object.keys(process.env)) {
        if (!(key in sanitized))
            delete process.env[key];
    }
    Object.assign(process.env, sanitized);
    return process.env;
}
