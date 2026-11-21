// Generated from src/core/code-build.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeBuild = codeBuild;
/**
 * Which build of pi-dish's code a process runs: a hash of what a bot relay loads, `lib/*.js`, and of
 * `package.json` and `package-lock.json`, which pin its dependencies. Any deploy that changes that code changes
 * it, and it needs no Git checkout. A relay records the build it started from in its lock; pi-dish compares it
 * with its own when it starts.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const APP_ROOT = path.resolve(__dirname, '..');
const builds = new Map();
/** The build of the code under `root`, read once per process: the code it loaded, not what a later deploy wrote. */
function codeBuild(root = APP_ROOT) {
    const known = builds.get(root);
    if (known)
        return known;
    const files = fs.readdirSync(path.join(root, 'lib')).filter(name => name.endsWith('.js')).sort()
        .map(name => `lib/${name}`);
    files.push('package.json', 'package-lock.json');
    const hash = crypto.createHash('sha256');
    for (const file of files) {
        let content;
        try {
            content = fs.readFileSync(path.join(root, file));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                continue;
            throw error;
        }
        hash.update(file).update('\0').update(content).update('\0');
    }
    const build = hash.digest('hex').slice(0, 12);
    builds.set(root, build);
    return build;
}
