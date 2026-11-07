/**
 * Self-contained host tree a hub deploys to a `deploy: true` ssh remote, under
 * ~/.pi/dish/host-bundle/<hash>/: lib/pi-dish-host.js (npm deps bundled),
 * lib/*.js copies, extensions/, skills/, satellite/watchdog, package.json.
 * Native modules stay out (no node-pty terminal; fff falls back to a dir walk).
 * The content hash names the remote dir, so an unchanged tree uploads once.
 */
import crypto = require('node:crypto');
import fs = require('node:fs');
import path = require('node:path');
import { dishDir } from './dish-store';

export interface HostBundle {
  dir: string;
  hash: string;
}

// Native addons can't be bundled; esbuild is lazy-loaded so a deployed host never needs it.
const EXTERNALS = ['node-pty', '@ff-labs/fff-node', 'esbuild'];
const COPIED_DIRS = ['extensions', 'skills'];

/**
 * Termux:Boot and JobScheduler (~15 min) keep sshd up; the hub starts pi-dish.
 * Neither runner is a login shell, so the termux-services supervisor may be
 * absent: start it for an enabled sshd service, else a plain sshd. Never both,
 * or runit's sshd loops on the port the plain one holds.
 */
const SATELLITE_WATCHDOG = `#!/data/data/com.termux/files/usr/bin/sh
# pi-dish satellite watchdog. Installed and refreshed by the pi-dish hub that
# deploys this phone's host; local edits are overwritten on its next connection.
: "\${PREFIX:=/data/data/com.termux/files/usr}"
PATH="$PREFIX/bin:$PATH"
SVDIR="$PREFIX/var/service"
export PREFIX PATH SVDIR
if [ -d "$SVDIR/sshd" ] && [ ! -e "$SVDIR/sshd/down" ] && command -v service-daemon >/dev/null 2>&1; then
  # Exits non-zero when the supervisor already runs; runit then restarts sshd itself.
  service-daemon start >/dev/null 2>&1 || :
else
  pgrep -x sshd >/dev/null 2>&1 || sshd
fi
`;

let memo: { root: string; base: string; bundle: Promise<HostBundle> } | null = null;

function copyTree(from: string, to: string, keep: (name: string) => boolean): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    if (entry.isDirectory()) copyTree(source, path.join(to, entry.name), keep);
    else if (entry.isFile() && keep(entry.name)) fs.copyFileSync(source, path.join(to, entry.name));
  }
}

function treeFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...treeFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

function hashTree(dir: string): string {
  const hash = crypto.createHash('sha256');
  for (const rel of treeFiles(dir)) {
    hash.update(rel).update('\0').update(fs.readFileSync(path.join(dir, rel))).update('\0');
  }
  return hash.digest('hex').slice(0, 24);
}

async function build(root: string, base: string): Promise<HostBundle> {
  const staging = path.join(base, `.staging-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    copyTree(path.join(root, 'lib'), path.join(staging, 'lib'), name => name.endsWith('.js'));
    for (const dir of COPIED_DIRS) copyTree(path.join(root, dir), path.join(staging, dir), () => true);
    fs.copyFileSync(path.join(root, 'package.json'), path.join(staging, 'package.json'));
    fs.mkdirSync(path.join(staging, 'satellite'));
    fs.writeFileSync(path.join(staging, 'satellite', 'watchdog'), SATELLITE_WATCHDOG, { mode: 0o755 });
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
    if (fs.existsSync(dir)) fs.rmSync(staging, { recursive: true, force: true });
    else fs.renameSync(staging, dir);
    for (const name of fs.readdirSync(base)) {
      if (name !== hash && !name.startsWith('.staging-')) fs.rmSync(path.join(base, name), { recursive: true, force: true });
    }
    return { dir, hash };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/** The host tree for `root` (default: this checkout), built at most once per process and dish dir. */
export function hostBundle(root = path.resolve(__dirname, '..')): Promise<HostBundle> {
  const base = path.join(dishDir(), 'host-bundle');
  if (memo && memo.root === root && memo.base === base) return memo.bundle;
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const bundle = build(root, base);
  memo = { root, base, bundle };
  // A failed build is retried by the next deploy instead of being cached.
  bundle.catch(() => { if (memo?.bundle === bundle) memo = null; });
  return bundle;
}
