import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import YAML = require('yaml');
import type { HarnessDescriptor, HarnessEnvironment } from './contracts';

/** Project > user > bundled definitions, matching the harness override order. */
export interface TaskAgent {
  name: string;
  description: string;
  model: string | null;
  thinkingLevel: string | null;
  source: 'project' | 'user' | 'bundled';
  path: string;
}

export interface HarnessJsonCommandOptions {
  cwd?: string;
}

export type HarnessJsonCommand = (
  descriptor: HarnessDescriptor,
  argv: string[],
  options?: HarnessJsonCommandOptions,
) => Promise<unknown>;

// Bundled definitions change with the binary; unpacking requires a subprocess.
const BUNDLED_TTL_MS = 60_000;
const bundledCache = new Map<string, { at: number; agents: TaskAgent[] }>();
const MAX_AGENT_FILES = 200;

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstString(entry);
      if (found) return found;
    }
  }
  return null;
}

/** Malformed/missing frontmatter keeps the filename fallback; unreadable files drop. */
export function parseAgentFile(file: string, source: TaskAgent['source']): TaskAgent | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let meta: Record<string, unknown> = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match) {
    try {
      const parsed: unknown = YAML.parse(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
    } catch { /* a malformed header still leaves a usable filename-named agent */ }
  }
  const name = firstString(meta.name) || path.basename(file).replace(/\.md$/i, '');
  if (!name) return null;
  return {
    name,
    description: firstString(meta.description) || '',
    model: firstString(meta.model),
    thinkingLevel: firstString(meta.thinkingLevel),
    source,
    path: file,
  };
}

function readAgentDir(dir: string, source: TaskAgent['source']): TaskAgent[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(entry => entry.isFile() && /\.md$/i.test(entry.name))
    .slice(0, MAX_AGENT_FILES)
    .map(entry => parseAgentFile(path.join(dir, entry.name), source))
    .filter((agent): agent is TaskAgent => agent !== null);
}

async function readBundledAgents(descriptor: HarnessDescriptor, runJson: HarnessJsonCommand): Promise<TaskAgent[]> {
  const spec = descriptor.taskAgents;
  if (!spec || typeof spec.unpack !== 'function') return [];
  const cached = bundledCache.get(descriptor.id);
  if (cached && Date.now() - cached.at < BUNDLED_TTL_MS) return cached.agents;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-agents-'));
  try {
    await runJson(descriptor, spec.unpack(dir), { cwd: dir });
    const agents = readAgentDir(dir, 'bundled');
    bundledCache.set(descriptor.id, { at: Date.now(), agents });
    return agents;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function listTaskAgents(
  descriptor: HarnessDescriptor,
  runJson: HarnessJsonCommand,
  { cwd, env = process.env }: { cwd?: string; env?: HarnessEnvironment } = {},
): Promise<TaskAgent[]> {
  const spec = descriptor.taskAgents;
  if (!spec) return [];
  const bundled = await readBundledAgents(descriptor, runJson).catch(() => []);
  const user = typeof spec.userDir === 'function' ? readAgentDir(spec.userDir(env), 'user') : [];
  const project = cwd && typeof spec.projectDir === 'function'
    ? readAgentDir(spec.projectDir(cwd), 'project') : [];
  // Later sources win; insertion order is retained for rows not replaced.
  const byName = new Map<string, TaskAgent>();
  for (const agent of [...bundled, ...user, ...project]) byName.set(agent.name, agent);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function _resetCacheForTests(): void { bundledCache.clear(); }
