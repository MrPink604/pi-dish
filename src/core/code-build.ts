/**
 * Relay code identity: the top-level JS modules and package metadata. A relay
 * records this in its lock so the server can recognize an older relay.
 */
import { execFile } from 'node:child_process';
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import { promisify } from 'node:util';

const APP_ROOT = path.resolve(__dirname, '..');
const builds = new Map<string, string>();

/** The build of the code under `root`, read once per process: the code it loaded, not what a later deploy wrote. */
export function codeBuild(root = APP_ROOT): string {
  const known = builds.get(root);
  if (known) return known;
  const files = fs.readdirSync(path.join(root, 'lib')).filter(name => name.endsWith('.js')).sort()
    .map(name => `lib/${name}`);
  files.push('package.json', 'package-lock.json');
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    let content: Buffer;
    try { content = fs.readFileSync(path.join(root, file)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    hash.update(file).update('\0').update(content).update('\0');
  }
  const build = hash.digest('hex').slice(0, 12);
  builds.set(root, build);
  return build;
}

const git = promisify(execFile);

async function installedCommit(root: string): Promise<string | null> {
  try {
    // Explicitly use this install's .git (directory or worktree file), never
    // an enclosing checkout when running from a copied bundle.
    const { stdout } = await git('git', ['--git-dir=.git', 'rev-parse', '--verify', 'HEAD'], { cwd: root });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function shippedFingerprint(root: string): Promise<string> {
  const hash = crypto.createHash('sha256');

  async function addFile(file: string, symlink = false): Promise<void> {
    const filename = path.join(root, file);
    let content: Buffer;
    try {
      content = symlink ? await fs.promises.readlink(filename, { encoding: 'buffer' }) : await fs.promises.readFile(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    hash.update(file).update(symlink ? '\0link\0' : '\0file\0').update(String(content.length)).update('\0').update(content);
  }

  async function addTree(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(path.join(root, dir), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await addTree(file);
      else if (entry.isFile()) await addFile(file);
      else if (entry.isSymbolicLink()) await addFile(file, true);
    }
  }

  for (const dir of ['lib', 'public', 'scripts']) await addTree(dir);
  await addFile('package.json');
  await addFile('package-lock.json');
  return hash.digest('hex').slice(0, 12);
}

/** Resolve the server's deployment identity without delaying listener startup. */
export async function deployedBuild(root: string): Promise<{ sha: string; commit: string | null }> {
  const [commit, sha] = await Promise.all([installedCommit(root), shippedFingerprint(root)]);
  return { sha, commit };
}
