import path = require('node:path');
import fs = require('node:fs');
import { pathToFileURL } from 'node:url';

/**
 * Resolve first-party application resources, not user paths or SDK data.
 * External harnesses and skill CLIs need real files with their lib siblings;
 * Electron-only resources (including docs) stay inside the archive.
 */
export function runtimeResourcePath(applicationRoot: string, relativePath: string): string {
  const root = path.join(applicationRoot, '.');
  const resource = path.normalize(relativePath);
  const external = resource === 'extensions' || resource.startsWith(`extensions${path.sep}`)
    || resource === 'skills' || resource.startsWith(`skills${path.sep}`)
    || (path.dirname(resource) === 'lib' && path.extname(resource) === '.js');
  return path.join(path.basename(root) === 'app.asar' && external ? `${root}.unpacked` : root, resource);
}

/**
 * FFF's native loader derives dlopen paths from its module location. Start it
 * outside ASAR so its platform package and ffi-rs resolve to real files too.
 * Checkout keeps ordinary ESM package resolution (FFF has import-only exports).
 */
export function fffImportSpecifier(applicationRoot: string): string {
  const root = path.join(applicationRoot, '.');
  if (path.basename(root) !== 'app.asar') return '@ff-labs/fff-node';
  const packageRoot = path.join(`${root}.unpacked`, 'node_modules/@ff-labs/fff-node');
  const metadata: unknown = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (metadata && typeof metadata === 'object' && 'exports' in metadata
      && metadata.exports && typeof metadata.exports === 'object' && '.' in metadata.exports) {
    const entry = metadata.exports['.'];
    if (entry && typeof entry === 'object' && 'import' in entry
        && typeof entry.import === 'string' && entry.import.startsWith('./')) {
      return pathToFileURL(path.resolve(packageRoot, entry.import)).href;
    }
  }
  throw new Error('Unpacked @ff-labs/fff-node has no supported ESM import entry');
}
