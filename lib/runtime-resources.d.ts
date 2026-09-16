// Generated from src/core/runtime-resources.ts; edit that source and run npm run build:core.
/**
 * Resolve first-party application resources, not user paths or SDK data.
 * External harnesses and skill CLIs need real files with their lib siblings;
 * Electron-only resources (including docs) stay inside the archive.
 */
export declare function runtimeResourcePath(applicationRoot: string, relativePath: string): string;
/**
 * FFF's native loader derives dlopen paths from its module location. Start it
 * outside ASAR so its platform package and ffi-rs resolve to real files too.
 * Checkout keeps ordinary ESM package resolution (FFF has import-only exports).
 */
export declare function fffImportSpecifier(applicationRoot: string): string;
