const path = require('path');
const { pathToFileURL } = require('url');

// The pi package is ESM-only (exports map has no "require" condition), so
// require.resolve() on the bare specifier fails. Resolve dist paths directly.
const PKG_ROOT = path.join(__dirname, '..', 'node_modules', '@earendil-works', 'pi-coding-agent');
const SDK_PATH = pathToFileURL(path.join(PKG_ROOT, 'dist', 'index.js')).href;
const CLI_PATH = path.join(PKG_ROOT, 'dist', 'cli.js');

// Lazy-loaded pi SDK (ESM module, loaded via dynamic import)
let _sdk = null;
let _auth = null;
let _registry = null;

async function getSDK() {
  if (!_sdk) {
    _sdk = await import(SDK_PATH);
  }
  return _sdk;
}

async function getAuth() {
  if (!_auth) {
    const sdk = await getSDK();
    _auth = new sdk.AuthStorage();
  }
  return _auth;
}

async function getRegistry() {
  if (!_registry) {
    const sdk = await getSDK();
    const auth = await getAuth();
    _registry = new sdk.ModelRegistry(auth);
  }
  return _registry;
}

// Get available models by parsing `pi --list-models` output
// This matches exactly what the TUI shows (only accessible providers)
// Cross-references with SDK registry for cost/free info
async function getAvailableModels() {
  const { execSync } = require('child_process');
  try {
    const output = execSync(`node "${CLI_PATH}" --list-models 2>&1`, {
      timeout: 10000,
      encoding: 'utf-8',
      env: { ...process.env },
      shell: true,
    });

    // Build a cost lookup from the SDK registry
    const costMap = await getCostMap();

    const lines = output.trim().split('\n');
    // Skip header line
    const result = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s{2,}/);
      if (parts.length < 4) continue;
      const [provider, id, context, maxOut, ...rest] = parts;
      const isReasoning = rest[0] === 'yes'; // thinking column

      // Check if free via SDK cost data
      const cost = costMap.get(provider + '/' + id);
      const isFree = cost ? (cost.input === 0 && cost.output === 0) : false;

      result.push({
        id,
        name: id,
        provider,
        contextWindow: parseContextSize(context),
        reasoning: isReasoning,
        free: isFree,
      });
    }
    return result;
  } catch (e) {
    console.error('Failed to get models from pi --list-models:', e.message);
    // Fallback to SDK registry
    return getAvailableModelsFallback();
  }
}

// Build provider/id -> cost map from SDK registry
async function getCostMap() {
  const registry = await getRegistry();
  const allModels = registry.getAll();
  const map = new Map();
  for (const m of allModels) {
    if (m.cost) map.set(m.provider + '/' + m.id, m.cost);
  }
  return map;
}

function parseContextSize(str) {
  if (!str) return 0;
  const num = parseFloat(str);
  if (str.includes('M')) return Math.round(num * 1000000);
  if (str.includes('K')) return Math.round(num * 1000);
  return num;
}

// Fallback: use SDK registry (returns all models, not just accessible ones)
async function getAvailableModelsFallback() {
  const auth = await getAuth();
  const registry = await getRegistry();
  const allModels = registry.getAll();

  const result = [];
  const providers = [...new Set(allModels.map(m => m.provider))].sort();

  for (const provider of providers) {
    const hasKey = auth.getApiKey(provider) !== undefined;
    if (!hasKey) continue;

    const models = allModels
      .filter(m => m.provider === provider)
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider,
        contextWindow: m.contextWindow,
        reasoning: !!m.reasoning,
      }));

    result.push(...models);
  }

  return result;
}

// List all sessions using the SDK (more reliable than manual parsing)
async function listSessions() {
  const sdk = await getSDK();
  return sdk.SessionManager.listAll();
}

// Rename a session by appending a session_info entry to its JSONL file
async function renameSession(sessionPath, newName) {
  const sdk = await getSDK();
  const sm = sdk.SessionManager.open(sessionPath);
  sm.appendSessionInfo(newName);
  return true;
}

// Find session file path by ID
async function findSessionPath(sessionId) {
  const sessions = await listSessions();
  const match = sessions.find(s => s.id === sessionId);
  return match ? match.path : null;
}

// Switch model for a session by appending a model_change entry to its JSONL file
async function switchModel(sessionPath, provider, modelId) {
  const sdk = await getSDK();
  const sm = sdk.SessionManager.open(sessionPath);
  sm.appendModelChange(provider, modelId);
  return true;
}

// Resolve a full model ID (provider/id) to provider + id parts
function parseModelId(fullModelId) {
  const slashIdx = fullModelId.indexOf('/');
  if (slashIdx > 0) {
    return {
      provider: fullModelId.slice(0, slashIdx),
      id: fullModelId.slice(slashIdx + 1),
    };
  }
  return { provider: '', id: fullModelId };
}

// Cached commands list (extensions + skills + built-in)
let _commandsCache = null;

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
  if (_commandsCache) return _commandsCache;

  const sdk = await getSDK();
  const auth = await getAuth();
  const registry = await getRegistry();

  const { session } = await sdk.createAgentSession({
    sessionManager: sdk.SessionManager.inMemory(),
    authStorage: auth,
    modelRegistry: registry,
  });

  const commands = [];

  // Built-in commands
  commands.push(...BUILTIN_COMMANDS);

  // Extension commands
  try {
    const runner = session.extensionRunner;
    const extCmds = runner.getRegisteredCommands();
    for (const cmd of extCmds) {
      commands.push({
        name: cmd.name,
        description: cmd.description || '',
        source: 'extension',
      });
    }
  } catch (e) {}

  // Skills
  try {
    const rl = session.resourceLoader;
    const skills = rl.getSkills();
    for (const skill of skills.skills || []) {
      commands.push({
        name: 'skill:' + skill.name,
        description: skill.description || '',
        source: 'skill',
      });
    }
  } catch (e) {}

  // Prompt templates
  try {
    const rl = session.resourceLoader;
    const prompts = rl.getPrompts();
    for (const prompt of prompts.prompts || []) {
      commands.push({
        name: prompt.name,
        description: prompt.description || '',
        source: 'prompt',
      });
    }
  } catch (e) {}

  _commandsCache = commands;
  return commands;
}

// Get session tree structure for /tree modal
async function getSessionTree(sessionPath) {
  const sdk = await getSDK();
  const sm = sdk.SessionManager.open(sessionPath);
  const tree = sm.getTree();
  const leafId = sm.leafId;
  
  // Build active path (leaf → root)
  const activePathIds = new Set();
  const entries = sm.getEntries();
  const byId = new Map();
  for (const e of entries) byId.set(e.id, e);
  let cur = leafId;
  while (cur) {
    activePathIds.add(cur);
    const entry = byId.get(cur);
    if (!entry || !entry.parentId || entry.parentId === cur) break;
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
      } else if (msg.role === 'assistant') {
        result.text = extractText(msg.content, 120);
        result.model = msg.model;
        result.stopReason = msg.stopReason;
        result.errorMessage = msg.errorMessage;
        // Collect tool calls for tool result display
        if (Array.isArray(msg.content)) {
          result.toolCalls = msg.content
            .filter(b => b.type === 'toolCall')
            .map(b => ({ id: b.id, name: b.name, args: summarizeToolArgs(b.name, b.arguments) }));
        }
      } else if (msg.role === 'toolResult') {
        result.toolName = msg.toolName;
        result.toolCallId = msg.toolCallId;
        result.isError = !!msg.isError;
      }
    } else if (entry.type === 'compaction') {
      result.tokensBefore = entry.tokensBefore;
    } else if (entry.type === 'model_change') {
      result.modelId = entry.modelId;
      result.provider = entry.provider;
    } else if (entry.type === 'branch_summary') {
      result.summary = (entry.summary || '').substring(0, 120);
    }
    
    return result;
  }
  
  function extractText(content, maxLen) {
    if (!content) return '';
    if (typeof content === 'string') return content.substring(0, maxLen);
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c && c.type === 'text' && c.text) {
          return c.text.substring(0, maxLen).replace(/[\n\t]/g, ' ');
        }
      }
    }
    return '';
  }
  
  function summarizeToolArgs(name, args) {
    if (!args) return '';
    if (name === 'Bash' || name === 'bash') return (args.command || '').split('\n')[0].substring(0, 60);
    if (name === 'Read' || name === 'read') return args.path || '';
    if (name === 'Edit' || name === 'edit') return args.path || '';
    if (name === 'Write' || name === 'write') return args.path || '';
    return Object.values(args)[0] ? String(Object.values(args)[0]).substring(0, 60) : '';
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

// Export a session JSONL to a standalone HTML file. Uses pi's own exporter
// (not re-exported from the package index, so import the dist module directly).
async function exportSessionHtml(sessionPath, outputPath) {
  const sdk = await getSDK();
  const mod = await import(
    pathToFileURL(path.join(PKG_ROOT, 'dist', 'core', 'export-html', 'index.js')).href
  );
  const sm = sdk.SessionManager.open(sessionPath);
  return mod.exportSessionToHtml(sm, undefined, { outputPath });
}

// Branch session from a specific entry
async function branchSession(sessionPath, entryId) {
  const sdk = await getSDK();
  const sm = sdk.SessionManager.open(sessionPath);
  sm.branch(entryId);
  return true;
}

module.exports = {
  getSDK,
  getAvailableModels,
  listSessions,
  renameSession,
  switchModel,
  parseModelId,
  findSessionPath,
  getRegistry,
  getAuth,
  getCommands,
  getSessionTree,
  branchSession,
  exportSessionHtml,
};
