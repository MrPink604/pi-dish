// Generated from src/core/runtime-resources.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeResourcePath = runtimeResourcePath;
const path = require("node:path");
/**
 * Resolve first-party application resources, not user paths or SDK data.
 * External harnesses and skill CLIs need real files with their lib siblings,
 * so callers resolve them against the installed application root.
 */
function runtimeResourcePath(applicationRoot, relativePath) {
    return path.join(applicationRoot, relativePath);
}
