// Lazy-loaded pi SDK (ESM module, loaded via dynamic import)
let _sdk = null;
let _auth = null;
let _registry = null;

async function getSDK() {
  if (!_sdk) {
    _sdk = await import('@mariozechner/pi-coding-agent');
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

// Get all available models grouped by provider (only providers with API keys)
async function getAvailableModels() {
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

  // Clean up the temp session
  try { process.nextTick(() => {}); } catch (e) {}

  return commands;
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
};
