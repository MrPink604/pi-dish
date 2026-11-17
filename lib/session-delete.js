// Generated from src/core/session-delete.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionDelete = createSessionDelete;
const fs = require("fs");
const path = require("path");
const harnesses_1 = require("./harnesses");
const private_sessions_1 = require("./private-sessions");
const session_discovery_1 = require("./session-discovery");
const http_boundary_1 = require("./http-boundary");
function realpath(file) {
    try {
        return fs.realpathSync(file);
    }
    catch {
        return path.resolve(file);
    }
}
function within(directory, file) {
    return file.startsWith(directory + path.sep);
}
/**
 * Permanently removes a closed session's JSONL and, for nested-subsession
 * harnesses (OMP), the sibling `<stem>/` subagent directory. The exact route
 * must resolve to a regular `.jsonl` inside one of the harness's own session
 * roots, and no live session may claim the file or anything in its subtree.
 */
function createSessionDelete(ports) {
    return function deleteSession(sessionId) {
        const source = ports.findSessionSource(sessionId, { exact: true });
        if (!source)
            throw (0, http_boundary_1.httpError)('Session not found', 404);
        const descriptor = (0, harnesses_1.getHarness)(source.harnessId);
        if (!descriptor)
            throw (0, http_boundary_1.httpError)(`Unknown harness: ${source.harnessId}`, 400);
        const { file } = source;
        let stat;
        try {
            stat = fs.lstatSync(file);
        }
        catch {
            throw (0, http_boundary_1.httpError)('Session not found', 404);
        }
        if (!stat.isFile() || !file.endsWith('.jsonl'))
            throw (0, http_boundary_1.httpError)('The session source is not a transcript file.', 400);
        const real = realpath(file);
        if (!(0, private_sessions_1.sessionRootsFor)(descriptor).some(({ root }) => within(realpath(root), real))) {
            throw (0, http_boundary_1.httpError)('The transcript is outside this harness\'s session folders.', 400);
        }
        const stem = file.slice(0, -'.jsonl'.length);
        let subtree = null;
        // lstat: a symlinked subagent directory is never followed or removed.
        if (descriptor.nestedSubsessions) {
            try {
                if (fs.lstatSync(stem).isDirectory())
                    subtree = stem;
            }
            catch { }
        }
        const realStem = realpath(stem);
        for (const active of ports.activeSessions()) {
            if (active.id === source.routeId)
                throw (0, http_boundary_1.httpError)('Close the session before deleting its transcript.', 409);
            if (!active.sessionFile)
                continue;
            const claimed = realpath(active.sessionFile);
            if (claimed === real || (subtree && within(realStem, claimed))) {
                throw (0, http_boundary_1.httpError)('A live session still uses this transcript; close it first.', 409);
            }
            // A live OMP parent may resume this subagent transcript.
            if (descriptor.nestedSubsessions && claimed.endsWith('.jsonl') && within(claimed.slice(0, -'.jsonl'.length), real)) {
                throw (0, http_boundary_1.httpError)('This subagent\'s parent session is live; close it first.', 409);
            }
        }
        fs.unlinkSync(file);
        (0, session_discovery_1.invalidateSessionHeader)(file);
        const deleted = [file];
        // Auxiliary files (agy's raw ACP sidecar) belong to this transcript only.
        for (const suffix of descriptor.auxiliaryJsonlSuffixes || []) {
            const sidecar = stem + suffix;
            try {
                if (fs.lstatSync(sidecar).isFile()) {
                    fs.unlinkSync(sidecar);
                    deleted.push(sidecar);
                }
            }
            catch { }
        }
        if (subtree) {
            fs.rmSync(subtree, { recursive: true });
            deleted.push(subtree);
        }
        return { deleted };
    };
}
