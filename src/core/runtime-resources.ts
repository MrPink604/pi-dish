import path = require('node:path');

/**
 * Resolve first-party application resources, not user paths or SDK data.
 * External harnesses and skill CLIs need real files with their lib siblings,
 * so callers resolve them against the installed application root.
 */
export function runtimeResourcePath(applicationRoot: string, relativePath: string): string {
  return path.join(applicationRoot, relativePath);
}
