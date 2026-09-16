// Generated from src/core/harness-agents.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAgentFile = parseAgentFile;
exports.listTaskAgents = listTaskAgents;
exports._resetCacheForTests = _resetCacheForTests;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
// Bundled definitions change with the binary; unpacking requires a subprocess.
const BUNDLED_TTL_MS = 60_000;
const bundledCache = new Map();
const MAX_AGENT_FILES = 200;
function firstString(value) {
    if (typeof value === 'string')
        return value.trim() || null;
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = firstString(entry);
            if (found)
                return found;
        }
    }
    return null;
}
/** Malformed/missing frontmatter keeps the filename fallback; unreadable files drop. */
function parseAgentFile(file, source) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
    let meta = {};
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (match) {
        try {
            const parsed = YAML.parse(match[1]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                meta = parsed;
        }
        catch { /* a malformed header still leaves a usable filename-named agent */ }
    }
    const name = firstString(meta.name) || path.basename(file).replace(/\.md$/i, '');
    if (!name)
        return null;
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
    }
    catch {
        return [];
    }
    return entries
        .filter(entry => entry.isFile() && /\.md$/i.test(entry.name))
        .slice(0, MAX_AGENT_FILES)
        .map(entry => parseAgentFile(path.join(dir, entry.name), source))
        .filter((agent) => agent !== null);
}
async function readBundledAgents(descriptor, runJson) {
    const spec = descriptor.taskAgents;
    if (!spec || typeof spec.unpack !== 'function')
        return [];
    const cached = bundledCache.get(descriptor.id);
    if (cached && Date.now() - cached.at < BUNDLED_TTL_MS)
        return cached.agents;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-agents-'));
    try {
        await runJson(descriptor, spec.unpack(dir), { cwd: dir });
        const agents = readAgentDir(dir, 'bundled');
        bundledCache.set(descriptor.id, { at: Date.now(), agents });
        return agents;
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
async function listTaskAgents(descriptor, runJson, { cwd, env = process.env } = {}) {
    const spec = descriptor.taskAgents;
    if (!spec)
        return [];
    const bundled = await readBundledAgents(descriptor, runJson).catch(() => []);
    const user = typeof spec.userDir === 'function' ? readAgentDir(spec.userDir(env), 'user') : [];
    const project = cwd && typeof spec.projectDir === 'function'
        ? readAgentDir(spec.projectDir(cwd), 'project') : [];
    // Later sources win; insertion order is retained for rows not replaced.
    const byName = new Map();
    for (const agent of [...bundled, ...user, ...project])
        byName.set(agent.name, agent);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function _resetCacheForTests() { bundledCache.clear(); }
