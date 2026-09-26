// Generated from src/core/model-feature-handlers.ts; edit that source and run npm run build:core.
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
exports.createModelFeatureHandlers = createModelFeatureHandlers;
const fs = require("node:fs");
const path = require("node:path");
const piSDK = __importStar(require("./pi-sdk"));
const bridge_session_1 = require("./bridge-session");
const harnesses_1 = require("./harnesses");
const helper_models_1 = require("./helper-models");
const session_ownership_1 = require("./session-ownership");
const harness_feature_commands_1 = require("./harness-feature-commands");
const RPC_BUILTIN_COMMANDS = [
    { name: 'compact', description: 'Manually compact the session context', args: '[instructions]' },
    { name: 'model', description: 'Switch model (usage: /model provider/model-id)', args: '<model>' },
    { name: 'name', description: 'Set session display name', args: '<name>' },
    { name: 'thinking', description: 'Set thinking level', args: '<off|minimal|low|medium|high|xhigh>' },
    { name: 'abort', description: 'Abort the current agent operation' },
    { name: 'new', description: 'Start a new session' },
    { name: 'export', description: 'Export session to HTML', args: '[path]' },
    { name: 'reload', description: 'Reload extensions, skills, and prompt templates' },
];
const BRIDGE_COMMAND_CAPABILITIES = {
    compact: 'compact', tree: 'treeNavigation', model: 'setModel', name: 'rename',
    thinking: 'setThinking', abort: 'abort', reload: 'reload', btw: 'btw',
};
// Payload fields remain opaque. These accesses intentionally retain native
// property/spread behavior; a bad command list falls through the existing catch.
function commandField(command, key) {
    if (command == null)
        throw new TypeError(`Cannot read properties of ${command} (reading '${key}')`);
    if (typeof command !== 'object')
        return undefined;
    return key === 'name'
        ? ('name' in command ? command.name : undefined)
        : ('supported' in command ? command.supported : undefined);
}
function commandList(value) {
    if (!Array.isArray(value))
        throw new TypeError('commands.filter is not a function');
    return value;
}
function responseCommands(data) {
    return data && typeof data === 'object' && 'commands' in data ? data.commands : undefined;
}
function errorMessage(error) {
    return error && typeof error === 'object' && 'message' in error ? error.message : undefined;
}
function filterBridgeCommands(sess, commands) {
    // Pi keeps its established full TUI list. Alternative harnesses retain only
    // supported commands and builtins mapped to an advertised bridge operation.
    if (sess.harnessId === 'pi')
        return commands;
    return commandList(commands).filter(command => commandField(command, 'supported') === true
        || (BRIDGE_COMMAND_CAPABILITIES[String(commandField(command, 'name'))]
            && (0, session_ownership_1.liveSessionSupports)(sess, BRIDGE_COMMAND_CAPABILITIES[String(commandField(command, 'name'))])));
}
async function appendHostBuiltins(ports, sessionId, sess, commands) {
    const descriptor = (0, harnesses_1.getHarness)(sess.harnessId);
    const available = [];
    // A reachable pane is weak presentation advice, never command authorization.
    // One lookup covers curated commands and OMP's context-bound /dish-reload.
    const wantsPane = descriptor?.hostBuiltins?.length || sess.harnessId === 'omp';
    const pane = wantsPane ? await ports.locatePiPane(sessionId) : null;
    if (pane && descriptor?.hostBuiltins?.length) {
        available.push(...descriptor.hostBuiltins.map(({ allowedArgs, blockedArgs, freeArgs, requireArgs, ...command }) => ({
            ...command, source: 'host', supported: true,
        })));
    }
    if (sess.harnessId === 'omp' && pane) {
        available.push({ name: 'reload', description: 'Reload the current Oh My Pi session/runtime state', source: 'host', supported: true });
    }
    if (!available.length)
        return commands;
    const hostNames = new Set(available.map(command => command.name));
    return [...commandList(commands).filter(command => !hostNames.has(commandField(command, 'name'))), ...available];
}
function createModelFeatureHandlers(ports) {
    // Read per response: the TUI may rewrite scoped-model settings at any time.
    function getEnabledModelPatterns() {
        let settings;
        try {
            settings = JSON.parse(fs.readFileSync(ports.piSettingsFile, 'utf-8'));
        }
        catch {
            settings = {};
        }
        if (settings == null)
            throw new TypeError(`Cannot read properties of ${settings} (reading 'enabledModels')`);
        const patterns = typeof settings === 'object' && 'enabledModels' in settings ? settings.enabledModels : undefined;
        return Array.isArray(patterns) && patterns.length ? patterns : null;
    }
    function annotateEnabled(models) {
        const patterns = getEnabledModelPatterns();
        return models.map(model => ({ ...model, enabled: (0, helper_models_1.isModelEnabled)(patterns, model) }));
    }
    const models = async (req, res) => {
        try {
            const sessionId = req.query.sessionId;
            if (sessionId) {
                const identity = (0, session_ownership_1.routeIdentity)(sessionId);
                if (!identity)
                    return res.status(400).json({ error: 'Invalid session ID' });
                // routeIdentity accepted this exact query value, not a coerced alias.
                const sessionModels = await ports.getSessionModels(sessionId);
                if (sessionModels) {
                    if (identity.harnessId === 'pi')
                        return res.json(annotateEnabled(sessionModels));
                    if (!sessionModels.some(model => model.reasoning !== false && !Array.isArray(model.thinking)))
                        return res.json(sessionModels);
                    // Legacy bridges need catalog enrichment, but project model overrides
                    // belong to this session's cwd, never the server's working directory.
                    const live = await ports.getLiveSession(sessionId);
                    if (typeof live?.cwd !== 'string' || !live.cwd)
                        return res.json(sessionModels);
                    return res.json(await (0, harness_feature_commands_1.withCatalogThinkingLevels)(sessionModels, (0, harnesses_1.getHarness)(identity.harnessId), { cwd: live.cwd }));
                }
                if (identity.harnessId !== 'pi') {
                    return res.status(409).json({ error: `Model discovery is unavailable for this ${(0, harnesses_1.getHarness)(identity.harnessId).label} session.` });
                }
            }
            const harnessId = req.query.harness || 'pi';
            const descriptor = (0, harnesses_1.getHarness)(harnessId);
            if (!descriptor)
                return res.status(400).json({ error: `Unknown harness: ${harnessId}` });
            if (descriptor.modelCatalog === 'command') {
                if (!(0, harness_feature_commands_1.harnessCommandAvailable)(descriptor))
                    return res.status(503).json({ error: `${descriptor.label} is not installed.` });
                if (req.query.cwd !== undefined && typeof req.query.cwd !== 'string') {
                    return res.status(400).json({ error: 'cwd must be a string' });
                }
                return res.json(await (0, harness_feature_commands_1.runHarnessModelCommand)(descriptor, { cwd: req.query.cwd }));
            }
            if (descriptor.modelCatalog !== 'pi-sdk') {
                return res.status(501).json({ error: `New-session model discovery is not supported for ${descriptor.label}.` });
            }
            let cache = ports.getModelsCache();
            if (!cache.models || Date.now() - cache.time > harness_feature_commands_1.MODELS_CACHE_TTL) {
                ports.setModelsCache(await piSDK.getAvailableModels());
                cache = ports.getModelsCache();
            }
            res.json(annotateEnabled(cache.models));
        }
        catch (e) {
            res.status(500).json({ error: errorMessage(e) });
        }
    };
    const updateEnabledModels = async (req, res) => {
        const body = req.body;
        const enabledIds = body && typeof body === 'object' && 'enabledIds' in body ? body.enabledIds : undefined;
        let normalizedIds;
        if (enabledIds != null) {
            if (!Array.isArray(enabledIds) || !enabledIds.every((id) => typeof id === 'string' && !!id.trim())) {
                return res.status(400).json({ error: 'enabledIds must be null or an array of model ids' });
            }
            normalizedIds = enabledIds.map(id => id.trim());
        }
        if (normalizedIds && new Set(normalizedIds).size !== normalizedIds.length) {
            return res.status(400).json({ error: 'enabledIds must not contain duplicate model ids' });
        }
        try {
            const sdk = await piSDK.getSDK();
            const settingsManager = sdk.SettingsManager.create(process.cwd(), path.dirname(ports.piSettingsFile), { projectTrusted: false });
            const patterns = normalizedIds?.length ? normalizedIds : undefined;
            settingsManager.setEnabledModels(patterns);
            await settingsManager.flush();
            const errors = settingsManager.drainErrors();
            if (errors.length)
                throw errors[0].error;
            res.json({ success: true, enabledModels: patterns || null });
        }
        catch (e) {
            res.status(500).json({ error: errorMessage(e) });
        }
    };
    const commands = async (req, res) => {
        try {
            const sessionId = req.query.sessionId;
            if (sessionId) {
                try {
                    // The owner returns null for a non-string route. Do not coerce query
                    // arrays into valid session identities before the fallback gate.
                    const sess = typeof sessionId === 'string' ? await ports.getLiveSession(sessionId) : null;
                    if (sess instanceof bridge_session_1.BridgeSession) {
                        if (!(0, session_ownership_1.liveSessionSupports)(sess, 'commands')) {
                            return res.status(409).json({ error: 'This session does not support command discovery.' });
                        }
                        const data = await sess.getCommands();
                        const listed = responseCommands(data);
                        if (listed) {
                            const filtered = filterBridgeCommands(sess, listed);
                            return res.json(await appendHostBuiltins(ports, sessionId, sess, filtered));
                        }
                    }
                    else if (sess) {
                        const data = await sess.getCommands();
                        const listed = responseCommands(data) || [];
                        if (!Array.isArray(listed))
                            throw new TypeError('(data?.commands || []).map is not a function');
                        return res.json([
                            ...RPC_BUILTIN_COMMANDS.map(command => ({ ...command, source: 'builtin', supported: true })),
                            ...listed.map(command => {
                                // Native boxing retains object-spread behavior for scalar/null
                                // payloads without pretending their fields were validated.
                                const fields = Object(command);
                                return { ...fields, supported: true };
                            }),
                        ]);
                    }
                }
                catch (e) {
                    console.warn(`Live command list failed for ${sessionId}:`, errorMessage(e));
                }
                const identity = (0, session_ownership_1.routeIdentity)(sessionId);
                if (!identity)
                    return res.status(400).json({ error: 'Invalid session ID' });
                if (identity.harnessId !== 'pi') {
                    return res.status(409).json({ error: `Command discovery is unavailable for this ${(0, harnesses_1.getHarness)(identity.harnessId).label} session.` });
                }
            }
            res.json(await piSDK.getCommands());
        }
        catch (e) {
            res.status(500).json({ error: errorMessage(e) });
        }
    };
    return { models, updateEnabledModels, commands };
}
