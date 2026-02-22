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

module.exports = {
  getSDK,
  getAvailableModels,
  listSessions,
  renameSession,
  findSessionPath,
  getRegistry,
  getAuth,
};
