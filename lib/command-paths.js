// Generated from src/core/command-paths.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchCommandPaths = matchCommandPaths;
// Absolute or ~-rooted tokens inside command strings. Resolution, authorization,
// ranking and skill classification belong to callers, not this Node-only matcher.
const COMMAND_PATH_RE = /(?:^|[\s'"`=(<>])((?:\/|~\/)[\w.@%+-]+(?:\/[\w.@%+-]+)*)/g;
function matchCommandPaths(command) {
    return command.matchAll(COMMAND_PATH_RE);
}
