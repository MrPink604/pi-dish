// Generated from src/core/runtime-resources.ts; edit that source and run npm run build:core.
/**
 * Resolve first-party application resources, not user paths or SDK data.
 * External harnesses and skill CLIs need real files with their lib siblings,
 * so callers resolve them against the installed application root.
 */
export declare function runtimeResourcePath(applicationRoot: string, relativePath: string): string;
