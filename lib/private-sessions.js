// Generated from src/core/private-sessions.ts; edit that source and run npm run build:core.
'use strict';
const fs = require("fs");
const os = require("os");
const path = require("path");
/**
 * Private sessions live outside every fleet-backed-up path. The root follows
 * the XDG state convention and is resolved per call (tests swap HOME), never
 * captured at module load.
 */
function privateRootPath(harnessId, env = process.env) {
    const stateHome = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
    return path.join(stateHome, 'pi-dish', 'private-sessions', harnessId);
}
/** Null for harnesses without private-session support (prime today). */
function privateRootFor(descriptor) {
    return typeof descriptor?.privateRootPath === 'function' ? descriptor.privateRootPath() : null;
}
/** Create the root (0700) before a spawn writes into it. */
function ensurePrivateRoot(root) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    // mkdir's mode is filtered by the umask and ignored for an existing root.
    fs.chmodSync(root, 0o700);
}
function resolvedPath(file) {
    try {
        return fs.realpathSync(file);
    }
    catch {
        return path.resolve(file);
    }
}
/**
 * Realpath-safe containment: a symlinked transcript must not masquerade as
 * private (or vice versa), and a not-yet-created root still answers false
 * rather than throwing. The lexical prefix fast-paths every ordinary row
 * without a syscall; only a lexically-inside path pays for realpath.
 */
function isPrivateSessionFile(descriptor, file) {
    const root = privateRootFor(descriptor);
    if (!root || typeof file !== 'string' || !path.isAbsolute(file))
        return false;
    const lexicalRoot = path.resolve(root);
    if (!path.resolve(file).startsWith(lexicalRoot + path.sep))
        return false;
    return resolvedPath(file).startsWith(resolvedPath(root) + path.sep);
}
/**
 * Every directory that can hold one harness's sessions, primary first. The
 * private root is walked as a single workspace: `pi --session-dir` writes a
 * flat `<ts>_<id>.jsonl`, which the nested corpus walk would skip. An
 * explicit `roots` override (tests, alternate corpora) suppresses the real
 * private root unless `privateRoots` names one too, so isolating a fixture
 * cannot quietly mix in the developer's own private sessions.
 */
function sessionRootsFor(descriptor, options = {}) {
    const roots = [];
    const override = options.roots?.[descriptor.id];
    roots.push({ root: override || descriptor.rootPath(), singleWorkspace: false, private: false });
    const privateRoot = options.privateRoots?.[descriptor.id] ?? (override ? null : privateRootFor(descriptor));
    if (privateRoot && privateRoot !== roots[0].root) {
        roots.push({ root: privateRoot, singleWorkspace: true, private: true });
    }
    return roots;
}
module.exports = { privateRootPath, privateRootFor, ensurePrivateRoot, isPrivateSessionFile, sessionRootsFor };
