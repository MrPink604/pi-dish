// Generated from src/core/host-bundle.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashTree = hashTree;
exports.hostBundle = hostBundle;
/**
 * The self-contained host tree a hub deploys to a `deploy: true` ssh remote
 * (remote-hosts.ts). Built from this checkout once per server process, on
 * first use, under `~/.pi/dish/host-bundle/<hash>/`:
 *
 *   lib/pi-dish-host.js   host-entry.ts with every npm dependency bundled
 *   lib/*.js              plain copies; bridge extensions import a few of them
 *   extensions/, skills/  loaded by spawned harnesses and the skills feature
 *   package.json          read for the version
 *
 * Native modules stay out: the web terminal (node-pty) is unavailable on a
 * deployed host and file search uses its directory-walk fallback (fff). The
 * content hash names the remote directory, so a hub upgrade redeploys and an
 * unchanged tree is never uploaded twice.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dish_store_1 = require("./dish-store");
// Native addons cannot be bundled; esbuild is the hub's own build tool and is
// loaded lazily, so a deployed host never needs it.
const EXTERNALS = ['node-pty', '@ff-labs/fff-node', 'esbuild'];
const COPIED_DIRS = ['extensions', 'skills'];
let memo = null;
function copyTree(from, to, keep) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const source = path.join(from, entry.name);
        if (entry.isDirectory())
            copyTree(source, path.join(to, entry.name), keep);
        else if (entry.isFile() && keep(entry.name))
            fs.copyFileSync(source, path.join(to, entry.name));
    }
}
function treeFiles(dir, prefix = '') {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory())
            out.push(...treeFiles(path.join(dir, entry.name), rel));
        else
            out.push(rel);
    }
    return out.sort();
}
/** sha256 over sorted relative paths and contents: names the tree, not its mtimes. */
function hashTree(dir) {
    const hash = crypto.createHash('sha256');
    for (const rel of treeFiles(dir)) {
        hash.update(rel).update('\0').update(fs.readFileSync(path.join(dir, rel))).update('\0');
    }
    return hash.digest('hex').slice(0, 24);
}
async function build(root, base) {
    const staging = path.join(base, `.staging-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
    fs.rmSync(staging, { recursive: true, force: true });
    try {
        copyTree(path.join(root, 'lib'), path.join(staging, 'lib'), name => name.endsWith('.js'));
        for (const dir of COPIED_DIRS)
            copyTree(path.join(root, dir), path.join(staging, dir), () => true);
        fs.copyFileSync(path.join(root, 'package.json'), path.join(staging, 'package.json'));
        // Not a static import: the deployed host bundles this module but has no esbuild.
        const esbuild = await import('esbuild');
        await esbuild.build({
            entryPoints: [path.join(root, 'lib', 'host-entry.js')],
            outfile: path.join(staging, 'lib', 'pi-dish-host.js'),
            bundle: true,
            platform: 'node',
            format: 'cjs',
            target: 'node22',
            external: EXTERNALS,
            legalComments: 'none',
            logLevel: 'silent',
        });
        const hash = hashTree(staging);
        const dir = path.join(base, hash);
        if (fs.existsSync(dir))
            fs.rmSync(staging, { recursive: true, force: true });
        else
            fs.renameSync(staging, dir);
        for (const name of fs.readdirSync(base)) {
            if (name !== hash && !name.startsWith('.staging-'))
                fs.rmSync(path.join(base, name), { recursive: true, force: true });
        }
        return { dir, hash };
    }
    catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
}
/** The host tree for `root` (default: this checkout), built at most once per process and dish dir. */
function hostBundle(root = path.resolve(__dirname, '..')) {
    const base = path.join((0, dish_store_1.dishDir)(), 'host-bundle');
    if (memo && memo.root === root && memo.base === base)
        return memo.bundle;
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    const bundle = build(root, base);
    memo = { root, base, bundle };
    // A failed build is retried by the next deploy instead of being cached.
    bundle.catch(() => { if (memo?.bundle === bundle)
        memo = null; });
    return bundle;
}
