'use strict';

/**
 * Task-agent inventory for the harness settings view — pi-dish's stand-in for
 * OMP's `/agents` hub.
 *
 * OMP has no "list agents" command, so discovery mirrors the harness's own
 * three sources, project first:
 *   - project: `<cwd>/.omp/agents/*.md`   (`omp agents unpack --project`)
 *   - user:    `<agent dir>/agents/*.md`  (`omp agents unpack --user`)
 *   - bundled: `omp agents unpack --dir <tmp> --json`, the only way to enumerate
 *              the agents compiled into the executable.
 * A name defined closer to the project wins, matching the harness's override
 * order; each row keeps the source it came from so the UI can say so.
 *
 * The per-agent *settings* (disabled, model override, prewalk, advisor) are
 * plain config records — `task.disabledAgents` and friends — and are read and
 * written by the caller through the harness's own `config get/set`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const YAML = require('yaml');

// Unpacking bundled agents spawns the harness, so the parsed result is cached
// for the process. Bundled definitions only change when the binary does.
const BUNDLED_TTL_MS = 60_000;
const bundledCache = new Map(); // harnessId -> { at, agents }

const MAX_AGENT_FILES = 200;

function firstString(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstString(entry);
      if (found) return found;
    }
  }
  return null;
}

/**
 * `name`/`description`/`model`/`thinkingLevel` out of an agent definition's
 * YAML frontmatter. A file without frontmatter is still an agent — the harness
 * falls back to the filename — so only unreadable files are dropped.
 */
function parseAgentFile(file, source) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let meta = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match) {
    try {
      const parsed = YAML.parse(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
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

function readAgentDir(dir, source) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(entry => entry.isFile() && /\.md$/i.test(entry.name))
    .slice(0, MAX_AGENT_FILES)
    .map(entry => parseAgentFile(path.join(dir, entry.name), source))
    .filter(Boolean);
}

async function readBundledAgents(descriptor, runJson) {
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

/**
 * @param {object} descriptor harness descriptor (needs `taskAgents`)
 * @param {(descriptor, argv, opts) => Promise<any>} runJson harness JSON runner
 * @param {object} [opts]
 * @param {string} [opts.cwd] project root whose `.omp/agents` also counts
 * @param {object} [opts.env] environment used to locate the user agents dir
 * @returns {Promise<Array>} one row per agent name, project override winning
 */
async function listTaskAgents(descriptor, runJson, { cwd, env = process.env } = {}) {
  const spec = descriptor.taskAgents;
  if (!spec) return [];
  const bundled = await readBundledAgents(descriptor, runJson).catch(() => []);
  const user = typeof spec.userDir === 'function' ? readAgentDir(spec.userDir(env), 'user') : [];
  const project = cwd && typeof spec.projectDir === 'function'
    ? readAgentDir(spec.projectDir(cwd), 'project') : [];
  // Later sources win, so fold in override order and keep insertion order for
  // rows the closer source didn't replace.
  const byName = new Map();
  for (const agent of [...bundled, ...user, ...project]) byName.set(agent.name, agent);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function _resetCacheForTests() { bundledCache.clear(); }

module.exports = { listTaskAgents, parseAgentFile, _resetCacheForTests };
