// Generated from src/core/harness-launch-spec.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.harnessLaunchSpec = harnessLaunchSpec;
exports.getPiLaunchSpec = getPiLaunchSpec;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const harnesses_1 = require("./harnesses");
function harnessLaunchSpec(descriptor) {
    return descriptor.id === 'pi' ? getPiLaunchSpec() : (0, harnesses_1.resolveLaunchSpec)(descriptor);
}
function getPiAliasSpec() {
    const files = [path.join(os.homedir(), '.zshrc'), path.join(os.homedir(), '.bashrc')];
    for (const file of files) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        }
        catch {
            continue;
        }
        const match = text.match(/^\s*alias\s+pi=(['"])([\s\S]*?)\1\s*$/m)
            || text.match(/^\s*alias\s+pi=([^\n#]+)\s*$/m);
        if (match)
            return (match[2] || match[1] || '').trim();
    }
    return null;
}
// A bare `pi` must mean the HOST installation. Under `npm start`/`npm test`,
// npm prepends every ancestor node_modules/.bin to PATH — and pi-dish depends
// on the pi package, so its own shim (the vendored, usually older copy) would
// silently shadow the real one: sessions and --list-models ran pi 0.80.3
// while the host had 0.80.6 (new models missing, bridge testing the wrong
// version). Resolve against PATH minus node_modules dirs.
function resolveHostPi() {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir || dir.split(path.sep).includes('node_modules'))
            continue;
        const candidate = path.join(dir, 'pi');
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        }
        catch { }
    }
    return 'pi';
}
/** Explicit PI_DISH_PI_COMMAND wins; otherwise a simple `alias pi=…` is mirrored. */
function getPiLaunchSpec() {
    const configured = process.env.PI_DISH_PI_COMMAND || getPiAliasSpec() || 'pi';
    const { env, words } = (0, harnesses_1.parseLaunchWords)(configured);
    const argv = words.length ? words : ['pi'];
    if (argv[0] === 'pi')
        argv[0] = resolveHostPi();
    return { env, argv };
}
