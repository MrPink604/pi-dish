// Generated from src/core/pi-sdk.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSDK = getSDK;
exports.getRuntime = getRuntime;
exports.getRegistry = getRegistry;
exports.getAvailableModels = getAvailableModels;
exports.getPricingModels = getPricingModels;
exports.renameSession = renameSession;
exports.switchModel = switchModel;
exports.getCommands = getCommands;
exports.getSessionTree = getSessionTree;
exports.exportSessionHtml = exportSessionHtml;
exports.branchSession = branchSession;
const path = __importStar(require("node:path"));
const node_url_1 = require("node:url");
const node_child_process_1 = require("node:child_process");
const helper_content_1 = require("./helper-content");
const omp_export_1 = require("./omp-export");
const harness_launch_spec_1 = require("./harness-launch-spec");
// The pi package is ESM-only (exports map has no "require" condition), so
// require.resolve() on the bare specifier fails. Resolve dist paths directly.
const PKG_ROOT = path.join(__dirname, '..', 'node_modules', '@earendil-works', 'pi-coding-agent');
const SDK_PATH = (0, node_url_1.pathToFileURL)(path.join(PKG_ROOT, 'dist', 'index.js')).href;
const CLI_PATH = path.join(PKG_ROOT, 'dist', 'cli.js');
// Lazy-loaded pi SDK (ESM module, loaded via dynamic import)
let _sdk = null;
let _runtime = null;
let _registry = null;
async function getSDK() {
    if (!_sdk) {
        _sdk = await import(SDK_PATH);
    }
    return _sdk;
}
// pi 0.80.10 folded auth + model catalog into one ModelRuntime (AuthStorage
// is no longer exported from the SDK index); ModelRegistry is now a
// synchronous facade over it.
async function getRuntime() {
    if (!_runtime) {
        const sdk = await getSDK();
        _runtime = await sdk.ModelRuntime.create();
    }
    return _runtime;
}
async function getRegistry() {
    if (!_registry) {
        const sdk = await getSDK();
        _registry = new sdk.ModelRegistry(await getRuntime());
    }
    return _registry;
}
// Get available models by parsing `pi --list-models` output
// This matches exactly what the TUI shows (only accessible providers)
// Cross-references with SDK registry for cost/free info
//
// The list comes from the HOST pi — the same launch spec sessions run with
// (getPiLaunchSpec: PI_DISH_PI_COMMAND / alias / PATH) — because that's the
// pi whose models the sessions can actually use. The vendored node_modules
// CLI is only a fallback for hosts without pi on PATH; it lags behind host
// upgrades (a new model in host pi never showed up here).
//
// Runs asynchronously — execSync here blocked the whole event loop (every
// request, including SSE streams) for the duration of the subprocess
// whenever the models cache went stale. Concurrent callers share one run.
let _listModelsInFlight = null;
function runListModels() {
    if (!_listModelsInFlight) {
        const run = (cmd, args, env) => new Promise((resolve, reject) => {
            (0, node_child_process_1.execFile)(cmd, args, { timeout: 10000, encoding: 'utf-8', env }, (err, stdout, stderr) => (err ? reject(err) : resolve(stdout + (stderr || ''))));
        });
        const spec = (0, harness_launch_spec_1.getPiLaunchSpec)();
        _listModelsInFlight = run(spec.argv[0], [...spec.argv.slice(1), '--list-models'], { ...process.env, ...spec.env })
            .catch(() => run(process.execPath, [CLI_PATH, '--list-models'], { ...process.env }))
            .finally(() => { _listModelsInFlight = null; });
    }
    return _listModelsInFlight;
}
async function getAvailableModels() {
    try {
        const output = await runListModels();
        // Build a cost lookup from the SDK registry
        const costMap = await getCostMap();
        const lines = output.trim().split('\n');
        // Skip header line
        const result = [];
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].trim().split(/\s{2,}/);
            if (parts.length < 4)
                continue;
            const [provider, id, context, maxOut, ...rest] = parts;
            const isReasoning = rest[0] === 'yes'; // thinking column
            // Check if free via SDK cost data
            const pricing = sanitizePricing(costMap.get(provider + '/' + id));
            result.push({
                id,
                name: id,
                provider,
                contextWindow: parseContextSize(context),
                reasoning: isReasoning,
                pricing,
                free: !!pricing && pricing.input === 0 && pricing.output === 0,
            });
        }
        // Unparseable rows are skipped, not errors — a CLI table-format change
        // would otherwise degrade silently to an empty model list.
        if (!result.length) {
            console.warn('pi --list-models output was not parseable, using SDK registry fallback');
            return getAvailableModelsFallback();
        }
        return result;
    }
    catch (e) {
        console.error('Failed to get models from pi --list-models:', e instanceof Error ? e.message : String(e));
        // Fallback to SDK registry
        return getAvailableModelsFallback();
    }
}
function sanitizePricing(cost) {
    if (!cost || typeof cost !== 'object')
        return null;
    const pricing = {};
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
        const value = key in cost ? Reflect.get(cost, key) : undefined;
        if (typeof value === 'number' && Number.isFinite(value))
            pricing[key] = value;
    }
    return typeof pricing.input === 'number' && typeof pricing.output === 'number'
        ? pricing : null;
}
// Build provider/id -> cost map from SDK registry
async function getCostMap() {
    const registry = await getRegistry();
    const allModels = registry.getAll();
    const map = new Map();
    for (const m of allModels) {
        if (m.cost)
            map.set(m.provider + '/' + m.id, m.cost);
    }
    return map;
}
/**
 * Complete Pi rate card, including providers that are not currently
 * authenticated. Historical sessions still need those rates after a key or
 * subscription is removed, so usage pricing cannot use the accessible-model
 * list returned by getAvailableModels().
 */
async function getPricingModels() {
    const registry = await getRegistry();
    return registry.getAll().flatMap(model => {
        const cost = sanitizePricing(model.cost);
        return cost ? [{ provider: model.provider, id: model.id, cost }] : [];
    });
}
function parseContextSize(str) {
    if (!str)
        return 0;
    const num = parseFloat(str);
    if (str.includes('M'))
        return Math.round(num * 1000000);
    if (str.includes('K'))
        return Math.round(num * 1000);
    return num;
}
// Fallback: use SDK registry (returns all models, not just accessible ones)
async function getAvailableModelsFallback() {
    const runtime = await getRuntime();
    const registry = await getRegistry();
    const allModels = registry.getAll();
    const result = [];
    const providers = [...new Set(allModels.map(m => m.provider))].sort();
    for (const provider of providers) {
        if (!runtime.hasConfiguredAuth(provider))
            continue;
        const models = allModels
            .filter(m => m.provider === provider)
            .map(m => ({
            id: m.id,
            name: m.name || m.id,
            provider: m.provider,
            contextWindow: m.contextWindow,
            reasoning: !!m.reasoning,
            pricing: sanitizePricing(m.cost),
            free: !!sanitizePricing(m.cost) && m.cost.input === 0 && m.cost.output === 0,
        }));
        result.push(...models);
    }
    return result;
}
// Rename a session by appending a session_info entry to its JSONL file
async function renameSession(sessionPath, newName) {
    const sdk = await getSDK();
    const sm = sdk.SessionManager.open(sessionPath);
    sm.appendSessionInfo(newName);
    return true;
}
// Switch model for a session by appending a model_change entry to its JSONL file
async function switchModel(sessionPath, provider, modelId) {
    const sdk = await getSDK();
    const sm = sdk.SessionManager.open(sessionPath);
    sm.appendModelChange(provider, modelId);
    return true;
}
// Only concurrent discovery is shared. Resource edits must be visible on the
// next request; the browser owns its short-lived presentation cache.
const commandsInFlight = new Map();
// Built-in interactive commands (handled by pi's interactive mode, not extensions)
const BUILTIN_COMMANDS = [
    { name: 'compact', description: 'Manually compact context, optional custom instructions', source: 'builtin', args: '[prompt]' },
    { name: 'model', description: 'Switch models', source: 'builtin' },
    { name: 'name', description: 'Set session display name', source: 'builtin', args: '<name>' },
    { name: 'tree', description: 'Jump to any point in the session and continue from there', source: 'builtin' },
    { name: 'fork', description: 'Create a new session from the current branch', source: 'builtin' },
    { name: 'new', description: 'Start a new session', source: 'builtin' },
    { name: 'resume', description: 'Pick from previous sessions', source: 'builtin' },
    { name: 'session', description: 'Show session info (path, tokens, cost)', source: 'builtin' },
    { name: 'settings', description: 'Thinking level, theme, message delivery', source: 'builtin' },
    { name: 'export', description: 'Export session to HTML file', source: 'builtin', args: '[file]' },
    { name: 'share', description: 'Upload as private GitHub gist with shareable HTML link', source: 'builtin' },
    { name: 'copy', description: 'Copy last assistant message to clipboard', source: 'builtin' },
    { name: 'reload', description: 'Reload extensions, skills, prompts, context files', source: 'builtin' },
    { name: 'login', description: 'OAuth authentication', source: 'builtin' },
    { name: 'logout', description: 'OAuth logout', source: 'builtin' },
    { name: 'scoped-models', description: 'Enable/disable models for Ctrl+P cycling', source: 'builtin' },
    { name: 'hotkeys', description: 'Show all keyboard shortcuts', source: 'builtin' },
    { name: 'quit', description: 'Quit pi', source: 'builtin' },
];
// Get all slash commands: built-in + extension + skill
async function getCommands() {
    const sdk = await getSDK();
    const cwd = process.cwd();
    const agentDir = sdk.getAgentDir();
    const key = JSON.stringify([cwd, agentDir, process.env]);
    const pending = commandsInFlight.get(key);
    if (pending)
        return pending;
    const discovery = (async () => {
        // Commands are resource metadata: constructing an AgentSession also
        // resolves provider credentials/models, builds tools, and retains a live
        // session that was never disposed. Use the same SDK loader without them.
        const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, noThemes: true, noContextFiles: true });
        await loader.reload();
        const commands = [...BUILTIN_COMMANDS];
        for (const extension of loader.getExtensions().extensions) {
            for (const command of extension.commands.values()) {
                commands.push({ name: command.name, description: command.description || '', source: 'extension' });
            }
        }
        for (const skill of loader.getSkills().skills) {
            commands.push({ name: 'skill:' + skill.name, description: skill.description || '', source: 'skill' });
        }
        for (const prompt of loader.getPrompts().prompts) {
            commands.push({ name: prompt.name, description: prompt.description || '', source: 'prompt' });
        }
        return commands;
    })().finally(() => { commandsInFlight.delete(key); });
    commandsInFlight.set(key, discovery);
    return discovery;
}
// Get session tree structure for /tree modal
async function getSessionTree(sessionPath) {
    const sdk = await getSDK();
    const sm = sdk.SessionManager.open(sessionPath);
    const tree = sm.getTree();
    const leafId = sm.getLeafId();
    // Build active path (leaf → root)
    const activePathIds = new Set();
    const entries = sm.getEntries();
    const byId = new Map();
    for (const e of entries)
        byId.set(e.id, e);
    let cur = leafId;
    while (cur) {
        activePathIds.add(cur);
        const entry = byId.get(cur);
        if (!entry || !entry.parentId || entry.parentId === cur)
            break;
        cur = entry.parentId;
    }
    // Flatten tree to serializable format
    function flattenNode(node, depth) {
        const entry = node.entry;
        const result = {
            id: entry.id,
            parentId: entry.parentId || null,
            type: entry.type,
            timestamp: entry.timestamp,
            depth,
            active: activePathIds.has(entry.id),
            isLeaf: entry.id === leafId,
            label: node.label || null,
            childCount: node.children.length,
        };
        // Add display info based on type
        if (entry.type === 'message') {
            const msg = entry.message;
            result.role = msg.role;
            if (msg.role === 'user') {
                result.text = extractText(msg.content, 120);
            }
            else if (msg.role === 'assistant') {
                result.text = extractText(msg.content, 120);
                result.model = msg.model;
                result.stopReason = msg.stopReason;
                result.errorMessage = msg.errorMessage;
                // Collect tool calls for tool result display
                if (Array.isArray(msg.content)) {
                    result.toolCalls = msg.content
                        .filter(b => b.type === 'toolCall')
                        .map(b => ({ id: b.id, name: b.name, args: (0, helper_content_1.getToolSummary)(b.name, b.arguments) }));
                }
            }
            else if (msg.role === 'toolResult') {
                result.toolName = msg.toolName;
                result.toolCallId = msg.toolCallId;
                result.isError = !!msg.isError;
            }
        }
        else if (entry.type === 'compaction') {
            result.tokensBefore = entry.tokensBefore;
        }
        else if (entry.type === 'model_change') {
            result.modelId = entry.modelId;
            result.provider = entry.provider;
        }
        else if (entry.type === 'branch_summary') {
            result.summary = (entry.summary || '').substring(0, 120);
        }
        return result;
    }
    // Single-line preview of a message's text (shared extractor + tidy-up).
    function extractText(content, maxLen) {
        return (0, helper_content_1.extractTextContent)(content).replace(/[\n\t]/g, ' ').trim().substring(0, maxLen);
    }
    // Flatten tree — only increase depth at actual branch points (like TUI)
    const nodes = [];
    function walk(nodeList, depth, parentHadBranch) {
        for (let i = 0; i < nodeList.length; i++) {
            const node = nodeList[i];
            nodes.push(flattenNode(node, depth));
            if (node.children.length > 0) {
                const hasBranch = node.children.length > 1;
                // Only increase depth when entering a branch point
                walk(node.children, hasBranch ? depth + 1 : depth, hasBranch);
            }
        }
    }
    walk(tree, 0, false);
    return { nodes, leafId, activePathIds: [...activePathIds] };
}
// Export a session JSONL to a standalone HTML file using the owning harness's
// renderer. OMP's transcript contains additional entry types and metadata, so
// feeding it through pi's otherwise-compatible exporter loses information.
async function exportSessionHtml(sessionPath, outputPath, profileId = 'pi-v3', { shareSnapshot } = {}) {
    if (profileId === 'omp-v1') {
        return (0, omp_export_1.exportOmpSessionHtml)(sessionPath, outputPath, { snapshot: shareSnapshot });
    }
    const sdk = await getSDK();
    const mod = await import((0, node_url_1.pathToFileURL)(path.join(PKG_ROOT, 'dist', 'core', 'export-html', 'index.js')).href);
    const sm = sdk.SessionManager.open(sessionPath);
    return mod.exportSessionToHtml(sm, undefined, { outputPath });
}
// The model an inactive session was last using — bills its branch summary.
// Last model_change entry wins; else the last assistant message's
// provider/model pair (assistant messages carry both since session v3).
function findSessionModelRef(entries) {
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.type === 'model_change' && e.provider && e.modelId) {
            return { provider: e.provider, id: e.modelId };
        }
        if (e.type === 'message' && e.message?.role === 'assistant' && e.message.provider && e.message.model) {
            return { provider: e.message.provider, id: e.message.model };
        }
    }
    return null;
}
/**
 * Navigate an *inactive* session's tree (the TUI's /tree without a live pi
 * process — live sessions go through the bridge's navigate_tree instead).
 * Mirrors AgentSession.navigateTree semantics: a user-message target moves
 * the leaf to its parent and returns the message text for the composer;
 * `summarize` generates an LLM summary of the abandoned branch (using the
 * session's own model + stored auth) and appends it as a branch_summary
 * entry at the new leaf, where pi injects it as context on resume.
 *
 * Persistence gotcha: sm.branch() only moves an in-memory pointer — a
 * reopened file re-derives its leaf from the *last entry*, so an external
 * branch must append something. branchWithSummary persists that way by
 * nature; the summary-less path appends a no-op label entry (labels
 * contribute nothing to the LLM context) purely to anchor the new leaf.
 */
async function branchSession(sessionPath, entryId, options = {}) {
    const sdk = await getSDK();
    const sm = sdk.SessionManager.open(sessionPath);
    const target = sm.getEntry(entryId);
    if (!target)
        throw new Error(`Entry ${entryId} not found`);
    let newLeafId = entryId;
    let editorText;
    if (target.type === 'custom_message') {
        newLeafId = target.parentId ?? null;
        editorText = (0, helper_content_1.extractTextContent)(target.content) || undefined;
    }
    else if (target.type === 'message' && target.message?.role === 'user') {
        newLeafId = target.parentId ?? null;
        editorText = (0, helper_content_1.extractTextContent)(target.message.content) || undefined;
    }
    let summaryText;
    let summaryDetails;
    if (options.summarize) {
        const { entries } = sdk.collectEntriesForBranchSummary(sm, sm.getLeafId(), entryId);
        if (entries.length) {
            const ref = findSessionModelRef(sm.getEntries());
            if (!ref)
                throw new Error('cannot summarize: no model recorded in this session');
            const registry = await getRegistry();
            const model = registry.find(ref.provider, ref.id);
            if (!model)
                throw new Error(`cannot summarize: model ${ref.provider}/${ref.id} not found in registry`);
            const auth = await registry.getApiKeyAndHeaders(model);
            if (!auth.ok || !auth.apiKey) {
                throw new Error(auth.ok ? `no API key for ${ref.provider}` : auth.error);
            }
            const result = await sdk.generateBranchSummary(entries, {
                model,
                apiKey: auth.apiKey,
                // SDK 0.85.1 declares string-only summary headers, but its implementation
                // forwards them unchanged through completeSummarization to completeSimple.
                // Preserve ProviderHeaders nulls: they suppress provider default headers.
                headers: auth.headers,
                env: auth.env,
                signal: new AbortController().signal,
                customInstructions: options.customInstructions || undefined,
            });
            if (result.error)
                throw new Error(result.error);
            summaryText = result.summary;
            summaryDetails = { readFiles: result.readFiles || [], modifiedFiles: result.modifiedFiles || [] };
        }
    }
    if (summaryText) {
        sm.branchWithSummary(newLeafId, summaryText, summaryDetails);
    }
    else if (newLeafId === null) {
        // Re-editing the first message: empty context, anchored by a root label.
        sm.resetLeaf();
        sm.appendLabelChange(entryId, sm.getLabel(entryId));
    }
    else {
        sm.branch(newLeafId);
        sm.appendLabelChange(newLeafId, sm.getLabel(newLeafId));
    }
    return { editorText, summarized: !!summaryText };
}
