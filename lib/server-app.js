// Generated from src/core/server-app.ts; edit that source and run npm run build:core.
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
exports.observeServerStartup = void 0;
exports.startServer = startServer;
const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const stt = require("./stt");
const terminal = require("./terminal");
const tmux = require("./tmux");
const hostIdentity = require("./host-identity");
const remoteHosts = require("./remote-hosts");
const fleetArtifacts = require("./fleet-artifacts");
const pages = require("./pages");
const skillsLib = require("./skills");
const sessionIndex = require("./session-index");
const sessionProvenance = require("./session-provenance");
const recoveryStore = require("./session-recovery");
const piSDK = __importStar(require("./pi-sdk"));
const session_files_1 = require("./session-files");
const skill_feature_handlers_1 = require("./skill-feature-handlers");
const harnesses_1 = require("./harnesses");
const dish_store_1 = require("./dish-store");
const access_handlers_1 = require("./access-handlers");
const relay_handlers_1 = require("./relay-handlers");
const terminal_handlers_1 = require("./terminal-handlers");
const publication_handlers_1 = require("./publication-handlers");
const file_handlers_1 = require("./file-handlers");
const session_read_handlers_1 = require("./session-read-handlers");
const session_command_handlers_1 = require("./session-command-handlers");
const feature_handlers_1 = require("./feature-handlers");
const harness_feature_commands_1 = require("./harness-feature-commands");
const session_catalog_1 = require("./session-catalog");
const session_ownership_1 = require("./session-ownership");
const session_launch_1 = require("./session-launch");
const session_operations_1 = require("./session-operations");
const message_hold_1 = require("./message-hold");
const session_catalog_runtime_1 = require("./session-catalog-runtime");
const live_sessions_1 = require("./live-sessions");
const session_browse_handlers_1 = require("./session-browse-handlers");
const session_relation_handlers_1 = require("./session-relation-handlers");
const session_slash_handlers_1 = require("./session-slash-handlers");
const session_mutation_handlers_1 = require("./session-mutation-handlers");
const session_tree_handlers_1 = require("./session-tree-handlers");
const session_stream_handler_1 = require("./session-stream-handler");
const session_create_handler_1 = require("./session-create-handler");
const content_handlers_1 = require("./content-handlers");
const server_startup_1 = require("./server-startup");
Object.defineProperty(exports, "observeServerStartup", { enumerable: true, get: function () { return server_startup_1.observeServerStartup; } });
const vault_approvals_1 = require("./vault-approvals");
const routine_runner_1 = require("./routine-runner");
const routine_handlers_1 = require("./routine-handlers");
const recovery_runner_1 = require("./recovery-runner");
const session_bounces_1 = require("./session-bounces");
const session_hibernation_1 = require("./session-hibernation");
const push_notifications_1 = require("./push-notifications");
const session_refs_1 = require("./session-refs");
const prime_daemon_1 = require("./prime-daemon");
const session_key_1 = require("./session-key");
const bridge_session_1 = require("./bridge-session");
const http_boundary_1 = require("./http-boundary");
function startServer(rootDirectory) {
    const app = express();
    const PORT = Number.isFinite(Number(process.env.PORT)) ? Number(process.env.PORT) : 3333;
    // Localhost-only by default. Auth is opt-in: without a token, anything that
    // reaches the port can drive agents with shell access.
    const HOST = process.env.HOST || '127.0.0.1';
    const packageVersion = require(path.join(rootDirectory, 'package.json')).version;
    const accessHandlers = (0, access_handlers_1.createAccessHandlers)({
        version: packageVersion,
        readDishSettings: dish_store_1.readDishSettings,
        sttAvailable: () => !!stt.resolveSttConfig((0, dish_store_1.readDishSettings)()),
        usageLimitsAvailable: () => (0, harnesses_1.listHarnesses)().some(d => d.argv?.usage && (0, harness_feature_commands_1.harnessCommandAvailable)(d)),
    });
    app.use(accessHandlers.compression);
    app.use(accessHandlers.jsonBody);
    app.use(accessHandlers.cors);
    app.use(express.static(path.join(rootDirectory, 'public')));
    // The vault's loopback bridge carries its own token and must answer before
    // the bearer gate; the browser routes are ordinary gated /api routes.
    const vaultHandlers = (0, vault_approvals_1.createVaultHandlers)((0, vault_approvals_1.createVaultApprovals)({
        notify: request => {
            pushNotifier.notify((0, vault_approvals_1.vaultPushPayload)(request))
                .catch(error => console.error(`[vault] push failed: ${(0, http_boundary_1.errorMessage)(error)}`));
        },
    }));
    app.use('/api/vault/bridge', vaultHandlers.bridgeGate);
    app.post('/api/vault/bridge/status', vaultHandlers.bridgeStatus);
    app.post('/api/vault/bridge/requests', vaultHandlers.bridgeCreate);
    app.get('/api/vault/bridge/requests/:id', vaultHandlers.bridgeGet);
    app.delete('/api/vault/bridge/requests/:id', vaultHandlers.bridgeAbandon);
    app.use('/api/page-comments', accessHandlers.pageCommentTransport);
    app.use('/api', accessHandlers.apiGate);
    app.get('/api/host', accessHandlers.host);
    app.post('/api/auth/ticket', accessHandlers.ticket);
    app.get('/api/vault', vaultHandlers.overview);
    app.post('/api/vault/requests/:id/decision', vaultHandlers.decide);
    app.delete('/api/vault/grants/:id', vaultHandlers.revokeGrant);
    const relayHandlers = (0, relay_handlers_1.createRelayHandlers)({
        fleetArtifacts,
        localPageExists: token => !!pages.getPage(token),
        publicBaseUrl: () => process.env.PI_DISH_SHARE_BASE_URL,
        hostDescriptor: accessHandlers.hostDescriptor,
        upgradeAuthorized: accessHandlers.upgradeAuthorized,
    });
    app.use('/hosts', accessHandlers.hostsGate);
    app.use('/hosts/:name/api', relayHandlers.rawApi);
    app.post('/api/fleet-artifacts', relayHandlers.registerArtifact);
    app.get('/api/fleet-artifacts', relayHandlers.listArtifacts);
    app.delete('/api/fleet-artifacts/:token', relayHandlers.removeArtifact);
    app.get('/api/hosts', relayHandlers.hosts);
    const ownership = (0, session_ownership_1.createSessionOwnership)({
        onLive: session => lifecycleObserver(session),
        onRetired: route => { fileHandlers.retireSession(route); },
        readSessionTailEntry: session_files_1.readSessionTailEntry,
    });
    const { sessionSources, getRegisteredSession, getRPCSession, resolveSessionCandidate, getLiveSession, adoptBridgeSessionSwitch, locatePiPane, liveSourceObservations, } = ownership;
    async function liveOrWake(sessionId) {
        const live = await getLiveSession(sessionId);
        if (live || !await hibernation.wake(sessionId))
            return live;
        const woken = await getLiveSession(sessionId);
        // A hibernated bridge needs its hello before the caller may drive it.
        if (woken instanceof bridge_session_1.BridgeSession)
            await woken.waitForHello({ timeout: 5000 });
        return woken;
    }
    const messageHold = (0, message_hold_1.createMessageHold)({
        getLiveSession: liveOrWake,
        supports: session_ownership_1.liveSessionSupports,
        readSettings: dish_store_1.readDishSettings,
    });
    // Open browser event streams per canonical session: an open view is a reader
    // hibernation must not pull the agent out from under.
    const streamViewers = new Map();
    const lifecycleObserver = (0, live_sessions_1.createSessionLifecycleObserver)({
        wakeSession: routeId => { messageHold.wake(routeId); },
        adoptSessionSwitch: (session, data) => { adoptBridgeSessionSwitch(session, data); },
    });
    const catalog = (0, session_catalog_runtime_1.createCatalogRuntime)({ ownership, onPrimeSession: lifecycleObserver });
    function findSessionSource(sessionId, { exact = false } = {}) {
        return sessionSources.resolve({ route: sessionId, exact, live: liveSourceObservations(sessionId) });
    }
    function findSessionFile(sessionId, options) {
        return findSessionSource(sessionId, options)?.file || null;
    }
    function sessionKnown(sessionId) {
        return !!getRegisteredSession(sessionId) || !!getRPCSession(sessionId)?.alive || !!findSessionSource(sessionId, { exact: true });
    }
    // Live registry first, then the JSONL header; null when neither knows.
    function resolveSessionCwd(sessionId) {
        const registered = getRegisteredSession(sessionId);
        if (registered?.cwd)
            return registered.cwd;
        // A fresh Prime root may not have a JSONL header yet; its roster row does.
        const primeCwd = (0, live_sessions_1.primeLiveSession)(sessionId)?.cwd;
        if (primeCwd)
            return primeCwd;
        const session = findSessionSource(sessionId);
        if (session) {
            try {
                return catalog.parseSessionFile(session).cwd || null;
            }
            catch { }
        }
        return null;
    }
    const fileHandlers = (0, file_handlers_1.createFileHandlers)({ resolveSessionCwd, findSessionSource });
    const sessionReadHandlers = (0, session_read_handlers_1.createSessionReadHandlers)({ ownership, catalog, findSessionSource });
    const publicationHandlers = (0, publication_handlers_1.createPublicationHandlers)({
        ownership, catalog, findSessionSource,
        reads: sessionReadHandlers,
        relay: relayHandlers.publicArtifacts,
        resourceRoot: rootDirectory,
    });
    const sessionLaunch = (0, session_launch_1.createSessionLaunch)({ runHarnessModelCommand: harness_feature_commands_1.runHarnessModelCommand });
    const sessionOperations = (0, session_operations_1.createSessionOperations)({
        ownership,
        launch: sessionLaunch,
        getActiveSessions: catalog.getActiveSessions,
        readSessionCwd: session_files_1.readSessionCwd,
        recordLaunchProvenance: (id, sourceId, operationId) => sessionProvenance.recordLaunch(id, sourceId, operationId),
    });
    const featureHandlers = (0, feature_handlers_1.createFeatureHandlers)({
        catalog, ownership, findSessionSource,
        applicationRoot: rootDirectory,
        piSettingsFile: path.join(os.homedir(), '.pi', 'agent', 'settings.json'),
    });
    app.use('/api/sessions/:id', (req, res, next) => {
        const refusal = sessionOperations.admitHttpAction(req.params.id, req.method);
        if (refusal)
            return res.status(refusal.status).json(refusal.body);
        next();
    });
    const browseHandlers = (0, session_browse_handlers_1.createSessionBrowseHandlers)({
        catalog,
        hibernated: () => hibernation.records(),
    });
    const relationHandlers = (0, session_relation_handlers_1.createSessionRelationHandlers)({ catalog, resolveSessionCandidate });
    app.get('/api/sessions', browseHandlers.list);
    app.get('/api/host/health', browseHandlers.hostHealth);
    app.get('/api/sessions/resolve', browseHandlers.resolve);
    app.get('/api/sessions/:id/related', relationHandlers.related);
    app.get('/api/sessions/:id/lineage', relationHandlers.lineage);
    app.get('/api/search', browseHandlers.search);
    app.get('/api/usage-summary', featureHandlers.usageSummary);
    app.get('/api/usage-limits', featureHandlers.usageLimits);
    app.get('/api/cache-lifetimes', featureHandlers.cacheLifetimes);
    app.get('/api/skills', featureHandlers.skills);
    app.get('/api/skills/activations', featureHandlers.skillActivations);
    app.get('/api/skills/coverage', featureHandlers.skillCoverage);
    app.get('/api/settings', featureHandlers.settings);
    app.put('/api/settings', featureHandlers.updateSettings);
    app.get('/api/sessions/:id/messages/:messageId/images/:blockIndex', sessionReadHandlers.image);
    app.get('/api/sessions/:id/messages', sessionReadHandlers.messages);
    app.get('/api/sessions/:id/search', sessionReadHandlers.search);
    // Built lazily: the catalog is only read once a prompt carries a `#ref`.
    function sessionRefDeps() {
        let built = null;
        return {
            selfHostId: hostIdentity.getHostId(),
            resolveLocal: (id, exactOnly) => {
                if (!built)
                    built = catalog.buildSessionCatalog();
                return catalog.resolveRefInCatalog(built, id, exactOnly).session;
            },
            fleetNames: () => remoteHosts.listRemotes().map((remote) => remote.name),
        };
    }
    const sessionCommandHandlers = (0, session_command_handlers_1.createSessionCommandHandlers)({
        getLiveSession,
        supports: session_ownership_1.liveSessionSupports,
        expandRefs: (message, refs) => (0, session_refs_1.expandSessionRefs)(message, refs, sessionRefDeps()),
        hold: messageHold,
        readSettings: dish_store_1.readDishSettings,
        sessionExists: id => !!(0, session_ownership_1.routeIdentity)(id) && !!findSessionSource(id, { exact: true }),
        wake: liveOrWake,
    });
    app.post('/api/sessions/:id/prompt', sessionCommandHandlers.prompt);
    app.post('/api/sessions/:id/steer', sessionCommandHandlers.steer);
    app.post('/api/sessions/:id/follow-up', sessionCommandHandlers.followUp);
    const mutationHandlers = (0, session_mutation_handlers_1.createSessionMutationHandlers)({ ownership, findSessionSource });
    app.post('/api/sessions/:id/queue/cancel', mutationHandlers.cancelQueued);
    app.post('/api/sessions/:id/thinking', mutationHandlers.thinking);
    app.post('/api/sessions/:id/fast', mutationHandlers.fast);
    app.get('/api/sessions/:id/stats', sessionReadHandlers.stats);
    app.get('/api/sessions/:id/export', sessionReadHandlers.export);
    // GET /share/:token is mounted on both the main app and the optional share
    // listener; management stays on the main app. Every miss is a bare 404.
    app.post('/api/shares/import', express.text({ type: 'text/html', limit: '20mb' }), publicationHandlers.importShare);
    app.post('/api/sessions/:id/share', publicationHandlers.createShare);
    app.delete('/api/sessions/:id/share', publicationHandlers.revokeShare);
    app.get('/api/sessions/:id/share', publicationHandlers.getShare);
    app.get('/share/:token', publicationHandlers.serveSharedSession);
    // Published pages reach their own comments only through these routes; GET/POST
    // only so the overlay's cross-origin calls are never preflighted.
    app.use('/api/page-comments/:token', relayHandlers.pageComments);
    app.get('/api/page-comments/:token', publicationHandlers.listPageComments);
    app.post('/api/page-comments/:token', publicationHandlers.createPageComment);
    app.post('/api/page-comments/:token/:id', publicationHandlers.updatePageComment);
    app.post('/api/page-comments/:token/:id/delete', publicationHandlers.deletePageComment);
    app.post('/api/comments', publicationHandlers.createComment);
    app.get('/api/comments/index', publicationHandlers.commentIndex);
    app.get('/api/comments/count', publicationHandlers.commentCount);
    app.post('/api/comments/get', publicationHandlers.getComments);
    // Acknowledged comments are the agent's record and stay immutable.
    app.patch('/api/comments/:id', publicationHandlers.updateComment);
    app.delete('/api/comments/:id', publicationHandlers.deleteComment);
    app.post('/api/comments/:id/ack', publicationHandlers.acknowledgeComment);
    app.post('/api/pages', publicationHandlers.createPage);
    app.get('/api/pages', publicationHandlers.listPages);
    app.delete('/api/pages/:token', publicationHandlers.revokePage);
    // Public serving routes; every failure is a bare 404.
    app.get('/page/:token', publicationHandlers.page);
    app.get('/page/:token/*', publicationHandlers.pageAsset);
    app.post('/api/sessions/:id/command', (0, session_slash_handlers_1.createSlashCommandHandler)({ getLiveSession, locatePiPane }).command);
    app.get('/api/sessions/:id/side-chat', mutationHandlers.sideChat);
    app.post('/api/sessions/:id/side-chat', mutationHandlers.sideChatAsk);
    app.post('/api/sessions/:id/side-chat/cancel', mutationHandlers.sideChatCancel);
    app.post('/api/sessions/:id/side-chat/close', mutationHandlers.sideChatClose);
    app.post('/api/sessions/:id/ui-response', mutationHandlers.uiResponse);
    app.post('/api/sessions/:id/rename', mutationHandlers.rename);
    app.post('/api/sessions/:id/model', mutationHandlers.model);
    app.get('/api/sessions/:id/tree', sessionReadHandlers.tree);
    app.post('/api/sessions/:id/branch', (0, session_tree_handlers_1.createSessionTreeHandler)({ ownership, findSessionSource }).branch);
    app.get('/api/harnesses', featureHandlers.harnesses);
    app.get('/api/harnesses/:id/config', featureHandlers.harnessConfig);
    app.put('/api/harnesses/:id/model-roles', featureHandlers.updateModelRoles);
    app.get('/api/harnesses/:id/agents', featureHandlers.harnessAgents);
    app.put('/api/harnesses/:id/agents', featureHandlers.updateHarnessAgents);
    app.get('/api/harnesses/:id/settings', featureHandlers.listHarnessSettings);
    app.put('/api/harnesses/:id/settings', featureHandlers.updateHarnessSettings);
    app.get('/api/models', featureHandlers.models);
    app.put('/api/models/enabled', featureHandlers.updateEnabledModels);
    app.get('/api/commands', featureHandlers.commands);
    app.post('/api/sessions/:id/abort', mutationHandlers.abort);
    app.post('/api/sessions/:id/close', async (req, res) => {
        const { status, body } = await sessionOperations.closeSessionById(req.params.id);
        if (status >= 200 && status < 300)
            hibernation.forget(req.params.id);
        res.status(status).json(body);
    });
    app.get('/api/cwds', (_req, res) => {
        try {
            const cwdSet = new Set((0, skill_feature_handlers_1.knownWorkspaceCwds)(catalog.buildSessionCatalog));
            const home = os.homedir();
            const cwds = [...cwdSet].sort().map(c => ({
                path: c,
                short: c.startsWith(home) ? '~' + c.slice(home.length) : c,
            }));
            res.json(cwds);
        }
        catch {
            res.status(500).json([]);
        }
    });
    // `terminal` also requires node-pty to have loaded: a missing native binary
    // must hide the button, not break the UI.
    app.get('/api/config', (_req, res) => {
        res.json({
            terminal: terminal.isTerminalEnabled(),
            tmux: tmux.isTmuxAvailable(),
            // A boolean only: the endpoint URL and its key stay server-side.
            stt: !!stt.resolveSttConfig((0, dish_store_1.readDishSettings)()),
            refAliases: true,
        });
    });
    // The server holds the STT endpoint and key; the browser only posts raw audio.
    const parseAudioBody = express.raw({ type: ['audio/*', 'video/webm'], limit: '25mb' });
    app.post('/api/stt', parseAudioBody, featureHandlers.transcribe);
    const agentDocs = (0, content_handlers_1.createAgentDocHandlers)(path.join(rootDirectory, 'docs', 'agent'));
    app.get('/api/agent-docs', agentDocs.list);
    app.get('/api/agent-docs/:topic', agentDocs.topic);
    app.get('/api/themes', content_handlers_1.themesHandler);
    // 200 with available:false when tmux is missing (the client hides the control).
    app.get('/api/tmux/targets', async (_req, res) => {
        if (!tmux.isTmuxAvailable())
            return res.json({ available: false, servers: [] });
        try {
            const servers = await tmux.listServers();
            // Prune placements whose pane and session are gone so tmux-spawns.json stays bounded.
            try {
                const registered = new Set((0, bridge_session_1.listRegisteredSessions)().map((entry) => {
                    const identity = (0, session_ownership_1.registryIdentity)(entry);
                    return identity ? (0, session_ownership_1.routeSessionId)(identity.harnessId, identity.nativeSessionId) : null;
                }).filter((id) => id !== null));
                await tmux.pruneSpawns(registered);
            }
            catch { }
            res.json({ available: true, servers });
        }
        catch {
            res.json({ available: true, servers: [] });
        }
    });
    app.get('/api/dirs', fileHandlers.searchDirectories);
    app.get('/api/dirs/children', fileHandlers.directoryChildren);
    app.get('/api/sessions/:id/files', fileHandlers.searchSessionFiles);
    app.get('/api/sessions/:id/file/content', fileHandlers.fileContent);
    app.get('/api/sessions/:id/file', fileHandlers.filePreview);
    app.get('/api/sessions/:id/diff/patch', fileHandlers.diffPatch);
    app.get('/api/sessions/:id/diff', fileHandlers.diffSummary);
    const createHandlers = (0, session_create_handler_1.createSessionCreateHandlers)({ sessionOperations, sessionLaunch, sessionKnown });
    app.post('/api/sessions/new', createHandlers.create);
    app.get('/api/session-spawns/:id', createHandlers.spawnStatus);
    app.post('/api/sessions/:id/resume', async (req, res) => {
        const body = (0, http_boundary_1.requestBody)(req);
        try {
            res.json(await sessionOperations.resumeSessionById(req.params.id, {
                model: body.model,
                target: body.target,
            }));
            hibernation.forget(req.params.id);
            messageHold.wake(req.params.id);
        }
        catch (error) {
            res.status((0, http_boundary_1.errorStatus)(error, 500)).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    });
    const recoveryRunner = (0, recovery_runner_1.createRecoveryRuntime)({
        operations: sessionOperations,
        ownership,
        getMode: () => (0, dish_store_1.readDishSettings)().recoveryMode,
        hibernated: id => hibernation.isHibernated(id),
    });
    app.get('/api/recovery', (_req, res) => {
        try {
            res.json(recoveryRunner.report());
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    });
    app.put('/api/sessions/:id/recovery', (req, res) => {
        const { excluded } = (0, http_boundary_1.requestBody)(req);
        if (typeof excluded !== 'boolean')
            return res.status(400).json({ error: 'excluded must be a boolean' });
        const identity = (0, session_ownership_1.routeIdentity)(req.params.id);
        if (!identity || !(0, harnesses_1.getHarness)(identity.harnessId))
            return res.status(400).json({ error: 'Invalid session ID' });
        if (!recoveryStore.readRecord(identity.harnessId, identity.nativeSessionId) && !sessionKnown(req.params.id)) {
            return res.status(404).json({ error: 'Session not found' });
        }
        try {
            res.json({ excluded: recoveryStore.patchControl(identity.harnessId, identity.nativeSessionId, { excluded }).excluded });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    });
    app.post('/api/recovery/retry', async (req, res) => {
        const { id } = (0, http_boundary_1.requestBody)(req);
        if (typeof id !== 'string')
            return res.status(400).json({ error: 'id is required' });
        try {
            const outcome = await recoveryRunner.retry(id);
            if (outcome.status === 'restored' || outcome.status === 'continued' || outcome.status === 'live') {
                hibernation.forget(outcome.id);
            }
            res.json(outcome);
        }
        catch (error) {
            res.status((0, http_boundary_1.errorStatus)(error, 500)).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    });
    app.post('/api/sessions/:id/restart', async (req, res) => {
        const result = await sessionOperations.restartSessionById(req.params.id);
        res.status(result.status).json(result.body);
    });
    const lifecycleActions = (0, session_bounces_1.createSessionLifecycleActions)({ operations: sessionOperations, ownership });
    const sessionBounces = (0, session_bounces_1.createSessionBounceRuntime)({
        operations: sessionOperations,
        ownership,
        catalog: () => { (0, bridge_session_1.invalidateRegistryCache)(); return catalog.getActiveSessions(); },
    });
    const hibernation = (0, session_hibernation_1.createSessionHibernation)({
        readSettings: dish_store_1.readDishSettings,
        readMeminfo: () => { try {
            return fs.readFileSync('/proc/meminfo', 'utf8');
        }
        catch {
            return null;
        } },
        candidates: () => { (0, bridge_session_1.invalidateRegistryCache)(); return catalog.getActiveSessions(); },
        viewers: id => { try {
            return streamViewers.get((0, session_key_1.canonicalSessionId)(id)) || 0;
        }
        catch {
            return 0;
        } },
        capture: lifecycleActions.capture,
        paneAttached: async (authority) => {
            if (!authority.spawn)
                return false;
            const clients = await tmux.paneAttachedClients(authority.spawn.socket, authority.spawn.paneId);
            return clients === null || clients > 0;
        },
        inspect: authority => lifecycleActions.inspect(authority, 'hibernate'),
        execute: async (authority, inspection) => { await lifecycleActions.execute(authority, 'hibernate', inspection); },
        resume: async (id) => {
            await sessionOperations.resumeSessionById(id);
            messageHold.wake(id);
        },
    });
    const pushNotifier = (0, push_notifications_1.createPushNotifier)({
        sessions: () => catalog.getActiveSessions(),
        agentLaunched: id => {
            const launchParents = (0, session_catalog_1.decodeLaunchParents)(sessionProvenance.readLaunches());
            return launchParents.has(id);
        },
        readMessages: file => (0, session_files_1.readSessionMessages)(file),
        host: () => ({ hostId: hostIdentity.getHostId(), label: hostIdentity.getHostLabel((0, dish_store_1.readDishSettings)()) }),
    });
    app.get('/api/push', (_req, res) => {
        try {
            res.json({ publicKey: pushNotifier.publicKey() });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    });
    app.post('/api/push/subscriptions', (req, res) => {
        const { subscription, publicKey } = (0, http_boundary_1.requestBody)(req);
        try {
            const result = pushNotifier.subscribe(subscription, publicKey);
            if (result.ok)
                res.status(204).end();
            else
                res.status(result.status).json({ error: result.error });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    });
    app.delete('/api/push/subscriptions', (req, res) => {
        pushNotifier.unsubscribe((0, http_boundary_1.requestBody)(req).endpoint);
        res.status(204).end();
    });
    app.post('/api/push/test', async (req, res) => {
        try {
            if (await pushNotifier.test((0, http_boundary_1.requestBody)(req).endpoint))
                res.status(204).end();
            else
                res.status(404).json({ error: 'This device is not registered with this host.' });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    });
    app.get('/api/session-bounces/preview', async (req, res) => {
        if (!['reload', 'restart'].includes(req.query.mode)) {
            return res.status(400).json({ error: 'mode must be reload or restart' });
        }
        try {
            res.json({ targets: await sessionBounces.preview(req.query.mode) });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    });
    app.post('/api/session-bounces', (req, res) => {
        const { mode, sessionIds } = (0, http_boundary_1.requestBody)(req);
        try {
            res.status(202).json({ operation: sessionBounces.enqueue(mode, sessionIds) });
        }
        catch (error) {
            res.status((0, http_boundary_1.errorStatus)(error, 500)).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    });
    app.get('/api/session-bounces', async (_req, res) => {
        try {
            res.json({ operations: await sessionBounces.list() });
        }
        catch (error) {
            res.status(500).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    });
    app.delete('/api/session-bounces/:id', (req, res) => {
        const operation = sessionBounces.cancel(req.params.id);
        if (!operation)
            return res.status(404).json({ error: 'Unknown bulk operation' });
        res.json({ operation });
    });
    // Each routine run stamps its session with routine provenance.
    const routineRunner = (0, routine_runner_1.createRoutineRunner)({
        createSession: sessionOperations.createSession,
        resumeSession: sessionOperations.resumeSessionById,
        getLiveSession,
        closeSession: sessionOperations.closeSessionById,
        composePrompt: (routine, invocation) => (0, routine_handlers_1.composeRoutinePrompt)(routine, invocation, sessionRefDeps()),
        isTurnInProgress: (sess) => !!sess?.turnInProgress,
        supports: session_ownership_1.liveSessionSupports,
        recoveryOutcome: recoveryRunner.outcome,
    });
    const routineHandlers = (0, routine_handlers_1.createRoutineHandlers)({
        runner: routineRunner,
        validateHarnessPilotSelection: sessionLaunch.validateHarnessPilotSelection,
    });
    app.get('/api/routines', routineHandlers.list);
    app.post('/api/routines', routineHandlers.create);
    app.get('/api/routines/:id', routineHandlers.get);
    app.put('/api/routines/:id', routineHandlers.update);
    app.delete('/api/routines/:id', routineHandlers.remove);
    app.post('/api/routines/:id/invoke', routineHandlers.invoke);
    app.get('/api/routines/:id/invocations', routineHandlers.listInvocations);
    app.get('/api/routine-invocations/:id', routineHandlers.getInvocation);
    app.get('/api/sessions/:id/stream', (0, session_stream_handler_1.createSessionStreamHandler)({ getLiveSession, viewers: streamViewers }));
    const terminalHandlers = terminal.isTerminalEnabled() ? (0, terminal_handlers_1.createTerminalHandlers)({
        upgradeAuthorized: accessHandlers.upgradeAuthorized,
        getRegisteredSession,
        getRPCSession,
        findSessionFile,
        resolveSessionCwd,
        locatePiPane,
    }) : null;
    const relayUpgrade = relayHandlers.upgrade;
    const terminalUpgrade = terminalHandlers?.upgrade;
    let recoveryStopped = false;
    function closeResources(shareServer) {
        recoveryStopped = true;
        recoveryRunner.stop();
        routineRunner.stop();
        messageHold.stop();
        // Detach from Prime's daemon: the poller and socket belong to this server.
        (0, prime_daemon_1.getPrimeDaemon)().shutdown();
        if (shareServer) {
            try {
                shareServer.close();
            }
            catch { }
        }
        remoteHosts.shutdown();
        sessionBounces.stop();
        hibernation.stop();
        pushNotifier.stop();
    }
    // Fleet relay takes precedence even when the terminal is disabled; unclaimed sockets are destroyed.
    function upgrade(req, socket, head) {
        let url;
        try {
            url = new URL(req.url || '', 'http://localhost');
        }
        catch {
            socket.destroy();
            return;
        }
        if (relayUpgrade(req, socket, head, url) || terminalUpgrade?.(req, socket, head, url))
            return;
        socket.destroy();
    }
    return (0, server_startup_1.startListeners)({
        app, host: HOST, port: PORT, upgrade, closeResources,
        terminalShutdown: terminalHandlers?.shutdown,
        warm: () => { piSDK.getAvailableModels().then(catalog.setModelsCache).catch(() => { }); },
        onListening: () => {
            // Skill roots precede the first big index build; failure remains harmless.
            skillsLib.getSkillFilePaths({ cwds: (0, skill_feature_handlers_1.knownWorkspaceCwds)(catalog.buildSessionCatalog) })
                .then(paths => sessionIndex.setSkillRoots(paths))
                .catch(() => { });
            messageHold.start();
            sessionBounces.start();
            hibernation.start();
            pushNotifier.start();
            // Prime roots live in the daemon roster, not the bridge registry, so poll it.
            (0, prime_daemon_1.getPrimeDaemon)().start();
            // A restored idle session is interrupted work, not a completed oneShot.
            recoveryRunner.start()
                .then(() => routineRunner.recoverAfterRestart())
                .then(() => { if (!recoveryStopped)
                routineRunner.start(); })
                .catch((error) => console.error(`Session restart recovery failed: ${(0, http_boundary_1.errorMessage)(error)}`));
        },
        mountShareApp: shareApp => {
            shareApp.get('/share/:token', publicationHandlers.serveSharedSession);
            shareApp.get('/page/:token', publicationHandlers.publicPage);
            shareApp.get('/page/:token/*', publicationHandlers.publicPageAsset);
            shareApp.get('/style.css', publicationHandlers.fileStyles);
            shareApp.get('/vendor/hljs-theme.min.css', publicationHandlers.highlightStyles);
            shareApp.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
        },
    });
}
