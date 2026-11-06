import express = require('express');
import fs = require('fs');
import path = require('path');
import os = require('os');
import stt = require('./stt');
import terminal = require('./terminal');
import tmux = require('./tmux');
import hostIdentity = require('./host-identity');
import remoteHosts = require('./remote-hosts');
import fleetArtifacts = require('./fleet-artifacts');
import pages = require('./pages');
import skillsLib = require('./skills');
import sessionIndex = require('./session-index');
import sessionProvenance = require('./session-provenance');
import routinesStore = require('./routines');
import recoveryStore = require('./session-recovery');
import * as piSDK from './pi-sdk';
import { readSessionMessages, readSessionCwd, readSessionTailEntry } from './session-files';
import { knownWorkspaceCwds } from './skill-feature-handlers';
import { getHarness, listHarnesses } from './harnesses';
import { readDishSettings, writeDishSettings } from './dish-settings';
import { createAccessHandlers } from './access-handlers';
import { createRelayHandlers } from './relay-handlers';
import { createTerminalHandlers } from './terminal-handlers';
import { createPublicationHandlers } from './publication-handlers';
import { createFileHandlers } from './file-handlers';
import { createSessionReadHandlers } from './session-read-handlers';
import { createSessionCommandHandlers } from './session-command-handlers';
import { createFeatureHandlers } from './feature-handlers';
import { harnessCommandAvailable, runHarnessModelCommand } from './harness-feature-commands';
import { decodeLaunchParents } from './session-catalog';
import { createSessionOwnership, liveSessionSupports, registryIdentity, routeIdentity, routeSessionId } from './session-ownership';
import { createSessionLaunch } from './session-launch';
import { createSessionOperations } from './session-operations';
import { createMessageHold } from './message-hold';
import { createCatalogRuntime, getContextWindow, getModelsCache, setModelsCache } from './session-catalog-runtime';
import { createLiveSessionInfo, createSessionLifecycleObserver } from './live-sessions';
import { createSessionBrowseHandlers } from './session-browse-handlers';
import { createSessionRelationHandlers } from './session-relation-handlers';
import { createSlashCommandHandler } from './session-slash-handlers';
import { createSessionMutationHandlers } from './session-mutation-handlers';
import { createSessionTreeHandler } from './session-tree-handlers';
import { createSessionStreamHandler } from './session-stream-handler';
import { createSessionCreateHandlers } from './session-create-handler';
import { createAgentDocHandlers, themesHandler } from './content-handlers';
import { observeServerStartup, startListeners } from './server-startup';
import { createVaultApprovals, createVaultHandlers, vaultPushPayload } from './vault-approvals';
import { createRoutineRunner } from './routine-runner';
import { createRoutineHandlers, composeRoutinePrompt } from './routine-handlers';
import { createRecoveryRuntime } from './recovery-runner';
import { createSessionBounceRuntime, createSessionLifecycleActions } from './session-bounces';
import { createSessionHibernation } from './session-hibernation';
import { createPushNotifier } from './push-notifications';
import { expandSessionRefs } from './session-refs';
import { getPrimeDaemon } from './prime-daemon';
import { canonicalSessionId } from './session-key';
import { listRegisteredSessions, invalidateRegistryCache, BridgeSession } from './bridge-session';
import { errorMessage, errorStatus } from './http-boundary';
import { requestBody, type ApplicationRequest, type ApplicationResponse } from './http-boundary';
import type { NextFunction } from 'express';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { HarnessLaunchTarget } from './session-launch';
import type { SessionRefDependencies } from './session-refs';
import type { LiveSession } from './session-ownership';
import type { SessionSource } from './session-source-contracts';
import type { SessionCatalog } from './session-catalog-contracts';
import type { SessionBounceMode } from './session-bounces';

export { observeServerStartup };
export type { ServerStartupObserver } from './server-startup';

export function startServer(rootDirectory: string): Server {
  const app = express();
  const PORT = Number.isFinite(Number(process.env.PORT)) ? Number(process.env.PORT) : 3333;
  // Localhost-only by default; opt in to LAN/VPN exposure explicitly. Auth is
  // opt-in too: without a token, anything that can reach the port can drive
  // agents with shell access.
  const HOST = process.env.HOST || '127.0.0.1';
  const PI_SETTINGS_FILE = path.join(os.homedir(), '.pi', 'agent', 'settings.json');
  const packageVersion: string = require(path.join(rootDirectory, 'package.json')).version;

  const accessHandlers = createAccessHandlers({
    version: packageVersion,
    readDishSettings,
    sttAvailable: () => !!stt.resolveSttConfig(readDishSettings()),
    usageLimitsAvailable: () => listHarnesses().some(d => d.argv?.usage && harnessCommandAvailable(d)),
  });
  app.use(accessHandlers.compression);
  app.use(accessHandlers.jsonBody);
  app.use(accessHandlers.cors);
  app.use(express.static(path.join(rootDirectory, 'public')));

  // The vault's loopback bridge carries its own token and must answer before
  // the bearer gate; the browser routes are ordinary gated /api routes.
  const vaultHandlers = createVaultHandlers(createVaultApprovals({
    notify: request => {
      pushNotifier.notify(vaultPushPayload(request))
        .catch(error => console.error(`[vault] push failed: ${errorMessage(error)}`));
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

  const relayHandlers = createRelayHandlers({
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

  const ownership = createSessionOwnership({
    onLive: session => lifecycleObserver(session),
    onRetired: route => { fileHandlers.retireSession(route); },
    readSessionTailEntry,
  });
  const {
    sessionSources, getRegisteredSession, getRPCSession,
    resolveSessionCandidate, liveSessionHistoryPending, getLiveSession,
    adoptBridgeSessionSwitch, describeRuntime, locatePiPane,
    liveSourceObservations,
  } = ownership;

  async function liveOrWake(sessionId: string): Promise<LiveSession | null> {
    const live = await getLiveSession(sessionId);
    if (live || !await hibernation.wake(sessionId)) return live;
    const woken = await getLiveSession(sessionId);
    // A hibernated bridge needs its hello before the caller may drive it.
    if (woken instanceof BridgeSession) await woken.waitForHello({ timeout: 5000 });
    return woken;
  }

  const messageHold = createMessageHold({
    getLiveSession: liveOrWake,
    supports: liveSessionSupports,
    readSettings: readDishSettings,
  });
  // Open browser event streams per canonical session: an open view is a reader
  // hibernation must not pull the agent out from under.
  const streamViewers = new Map<string, number>();
  const lifecycleObserver = createSessionLifecycleObserver({
    wakeSession: routeId => { messageHold.wake(routeId); },
    adoptSessionSwitch: (session, data) => { adoptBridgeSessionSwitch(session, data); },
  });
  const catalog = createCatalogRuntime({ ownership, getLiveSession, onPrimeSession: lifecycleObserver });
  const liveInfo = createLiveSessionInfo(ownership);

  function findSessionSource(sessionId: unknown, { exact = false } = {}): SessionSource | null {
    return sessionSources.resolve({ route: sessionId, exact, live: liveSourceObservations(sessionId) });
  }
  function findSessionFile(sessionId: unknown, options?: { exact?: boolean }): string | null {
    return findSessionSource(sessionId, options)?.file || null;
  }

  // Best-known working directory for a session: live registry first, then the
  // JSONL header. Null when neither knows (terminal + file search fall back).
  function resolveSessionCwd(sessionId: string): unknown {
    const registered = getRegisteredSession(sessionId);
    if (registered?.cwd) return registered.cwd;
    // A fresh Prime root may not have a JSONL header yet; its roster row does.
    const primeCwd = liveInfo.primeLiveSession(sessionId)?.cwd;
    if (primeCwd) return primeCwd;
    const session = findSessionSource(sessionId);
    if (session) {
      try { return catalog.parseSessionFile(session).cwd || null; } catch {}
    }
    return null;
  }

  const fileHandlers = createFileHandlers({ resolveSessionCwd, findSessionSource });
  const sessionReadHandlers = createSessionReadHandlers({
    findSessionSource, liveSessionHistoryPending, getRegisteredSession, getRPCSession,
    isLive: liveInfo.isLive,
    getLiveSession,
    liveTreeLeafId: liveInfo.liveTreeLeafId,
    getLiveContextUsage: liveInfo.getLiveContextUsage,
    getContextWindow,
    describeRuntime,
  });
  const publicationHandlers = createPublicationHandlers({
    findSessionSource, liveSessionHistoryPending, listRegisteredSessions,
    enumerateSessionCandidates: catalog.enumerateSessionCandidates,
    getRPCSession,
    exportSessionHtml: sessionReadHandlers.exportSessionHtml,
    getOmpShareSnapshot: sessionReadHandlers.getOmpShareSnapshot,
    relay: relayHandlers.publicArtifacts,
    publicBaseUrl: () => process.env.PI_DISH_SHARE_BASE_URL,
    resourceRoot: rootDirectory,
  });
  const sessionLaunch = createSessionLaunch({ runHarnessModelCommand });
  const sessionOperations = createSessionOperations({
    ownership,
    launch: sessionLaunch,
    getActiveSessions: catalog.getActiveSessions,
    readSessionCwd,
    recordLaunchProvenance: (id, sourceId, operationId) => sessionProvenance.recordLaunch(id, sourceId, operationId),
  });
  const featureHandlers = createFeatureHandlers({
    readDishSettings, writeDishSettings,
    buildSessionCatalog: catalog.buildSessionCatalog,
    enumerateSessionCandidates: catalog.enumerateSessionCandidates,
    findSessionSource,
    getSessionModels: catalog.getSessionModels,
    getLiveSession,
    locatePiPane,
    getModelsCache,
    setModelsCache,
    applicationRoot: rootDirectory,
    piSettingsFile: PI_SETTINGS_FILE,
  });

  app.use('/api/sessions/:id', (req: ApplicationRequest, res: ApplicationResponse, next: NextFunction) => {
    const refusal = sessionOperations.admitHttpAction(req.params.id, req.method);
    if (refusal) return res.status(refusal.status).json(refusal.body);
    next();
  });

  const browseHandlers = createSessionBrowseHandlers({
    catalog,
    hibernated: () => hibernation.records(),
  });
  const relationHandlers = createSessionRelationHandlers({ catalog, resolveSessionCandidate });

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

  // The catalog is only read once a prompt actually carries a `#ref`, so these
  // dependency bundles are built lazily.
  function sessionRefDeps(): SessionRefDependencies {
    let built: SessionCatalog | null = null;
    return {
      selfHostId: hostIdentity.getHostId(),
      resolveLocal: (id, exactOnly) => {
        if (!built) built = catalog.buildSessionCatalog();
        return catalog.resolveRefInCatalog(built, id, exactOnly).session;
      },
      fleetNames: () => remoteHosts.listRemotes().map((remote) => remote.name),
    };
  }

  const sessionCommandHandlers = createSessionCommandHandlers({
    getLiveSession,
    supports: liveSessionSupports,
    expandRefs: (message, refs) => expandSessionRefs(message, refs, sessionRefDeps()),
    hold: messageHold,
    readSettings: readDishSettings,
    sessionExists: id => !!routeIdentity(id) && !!findSessionSource(id, { exact: true }),
    wake: liveOrWake,
  });
  app.post('/api/sessions/:id/prompt', sessionCommandHandlers.prompt);
  app.post('/api/sessions/:id/steer', sessionCommandHandlers.steer);
  app.post('/api/sessions/:id/follow-up', sessionCommandHandlers.followUp);

  const mutationHandlers = createSessionMutationHandlers({
    getLiveSession, findSessionSource, getRegisteredSession,
  });
  app.post('/api/sessions/:id/queue/cancel', mutationHandlers.cancelQueued);
  app.post('/api/sessions/:id/thinking', mutationHandlers.thinking);
  app.post('/api/sessions/:id/fast', mutationHandlers.fast);
  app.get('/api/sessions/:id/stats', sessionReadHandlers.stats);
  app.get('/api/sessions/:id/export', sessionReadHandlers.export);

  // A share is a random token referencing a session or an immutable native HTML
  // snapshot. Management lives on the main app; GET /share/:token is mounted on
  // both the main app and the optional share listener. Every miss is a bare 404.
  app.post('/api/shares/import', express.text({ type: 'text/html', limit: '20mb' }), publicationHandlers.importShare);
  app.post('/api/sessions/:id/share', publicationHandlers.createShare);
  app.delete('/api/sessions/:id/share', publicationHandlers.revokeShare);
  app.get('/api/sessions/:id/share', publicationHandlers.getShare);
  app.get('/share/:token', publicationHandlers.serveSharedSession);

  // Published pages reach their own comments only through these page-scoped
  // routes. Every route is a GET or POST so the overlay's cross-origin calls
  // are never preflighted.
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
  // The public serving routes: directory roots serve index.html and contained
  // assets; every failure is a bare 404.
  app.get('/page/:token', publicationHandlers.page);
  app.get('/page/:token/*', publicationHandlers.pageAsset);

  app.post('/api/sessions/:id/command', createSlashCommandHandler({ getLiveSession, locatePiPane }).command);

  app.get('/api/sessions/:id/side-chat', mutationHandlers.sideChat);
  app.post('/api/sessions/:id/side-chat', mutationHandlers.sideChatAsk);
  app.post('/api/sessions/:id/side-chat/cancel', mutationHandlers.sideChatCancel);
  app.post('/api/sessions/:id/side-chat/close', mutationHandlers.sideChatClose);
  app.post('/api/sessions/:id/ui-response', mutationHandlers.uiResponse);
  app.post('/api/sessions/:id/rename', mutationHandlers.rename);
  app.post('/api/sessions/:id/model', mutationHandlers.model);
  app.get('/api/sessions/:id/tree', sessionReadHandlers.tree);
  app.post('/api/sessions/:id/branch',
    createSessionTreeHandler({ getLiveSession, findSessionSource, getRegisteredSession, getRPCSession, locatePiPane }).branch);

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

  app.post('/api/sessions/:id/close', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const { status, body } = await sessionOperations.closeSessionById(req.params.id);
    if (status >= 200 && status < 300) hibernation.forget(req.params.id);
    res.status(status).json(body);
  });

  app.get('/api/cwds', (_req: ApplicationRequest, res: ApplicationResponse) => {
    try {
      const cwdSet = new Set(knownWorkspaceCwds(catalog.buildSessionCatalog));
      const home = os.homedir();
      const cwds = [...cwdSet].sort().map(c => ({
        path: c,
        short: c.startsWith(home) ? '~' + c.slice(home.length) : c,
      }));
      res.json(cwds);
    } catch {
      res.status(500).json([]);
    }
  });

  // Feature flags the client needs before rendering chrome. `terminal` is
  // opt-in and additionally requires node-pty to have loaded: a missing native
  // binary must hide the button, not break the UI.
  app.get('/api/config', (_req: ApplicationRequest, res: ApplicationResponse) => {
    res.json({
      terminal: terminal.isTerminalEnabled(),
      tmux: tmux.isTmuxAvailable(),
      // A boolean only: the endpoint URL and its key stay server-side.
      stt: !!stt.resolveSttConfig(readDishSettings()),
      refAliases: true,
    });
  });

  // The browser posts raw audio; the server holds the endpoint and its key and
  // relays a multipart transcription request.
  const parseAudioBody = express.raw({ type: ['audio/*', 'video/webm'], limit: '25mb' });
  app.post('/api/stt', parseAudioBody, featureHandlers.transcribe);

  const agentDocs = createAgentDocHandlers(path.join(rootDirectory, 'docs', 'agent'));
  app.get('/api/agent-docs', agentDocs.list);
  app.get('/api/agent-docs/:topic', agentDocs.topic);
  app.get('/api/themes', themesHandler);

  // tmux spawn targets: the running tmux servers and their sessions. 200 with
  // available:false when tmux is missing (the client hides the control).
  app.get('/api/tmux/targets', async (_req: ApplicationRequest, res: ApplicationResponse) => {
    if (!tmux.isTmuxAvailable()) return res.json({ available: false, servers: [] });
    try {
      const servers = await tmux.listServers();
      // Opportunistically drop spawn placements whose pane and session are both
      // gone, so tmux-spawns.json doesn't grow without bound.
      try {
        const registered = new Set(listRegisteredSessions().map((entry) => {
          const identity = registryIdentity(entry);
          return identity ? routeSessionId(identity.harnessId, identity.nativeSessionId) : null;
        }).filter((id): id is string => id !== null));
        await tmux.pruneSpawns(registered);
      } catch {}
      res.json({ available: true, servers });
    } catch {
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

  const createHandlers = createSessionCreateHandlers({
    sessionOperations,
    sessionLaunch,
    findSessionFile,
    getRegisteredSession,
    getRPCSession,
  });
  app.post('/api/sessions/new', createHandlers.create);
  app.get('/api/session-spawns/:id', createHandlers.spawnStatus);

  app.post('/api/sessions/:id/resume', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const body = requestBody(req);
    try {
      res.json(await sessionOperations.resumeSessionById(req.params.id, {
        model: body.model,
        target: body.target as HarnessLaunchTarget | null | undefined,
      }));
      hibernation.forget(req.params.id);
      messageHold.wake(req.params.id);
    } catch (error) {
      res.status(errorStatus(error, 500)).json({ error: errorMessage(error) });
    }
  });

  const recoveryRunner = createRecoveryRuntime({
    operations: sessionOperations,
    ownership,
    getMode: () => readDishSettings().recoveryMode,
    hibernated: id => hibernation.isHibernated(id),
  });

  app.get('/api/recovery', (_req: ApplicationRequest, res: ApplicationResponse) => {
    try { res.json(recoveryRunner.report()); }
    catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  });
  app.put('/api/sessions/:id/recovery', (req: ApplicationRequest, res: ApplicationResponse) => {
    const { excluded } = requestBody(req);
    if (typeof excluded !== 'boolean') return res.status(400).json({ error: 'excluded must be a boolean' });
    const identity = routeIdentity(req.params.id);
    if (!identity || !getHarness(identity.harnessId)) return res.status(400).json({ error: 'Invalid session ID' });
    if (!recoveryStore.readRecord(identity.harnessId, identity.nativeSessionId)
        && !getRegisteredSession(req.params.id) && !getRPCSession(req.params.id)?.alive
        && !findSessionSource(req.params.id, { exact: true })) return res.status(404).json({ error: 'Session not found' });
    try {
      res.json({ excluded: recoveryStore.patchControl(identity.harnessId, identity.nativeSessionId, { excluded }).excluded });
    } catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  });
  app.post('/api/recovery/retry', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const { id } = requestBody(req);
    if (typeof id !== 'string') return res.status(400).json({ error: 'id is required' });
    try {
      const outcome = await recoveryRunner.retry(id);
      if (outcome.status === 'restored' || outcome.status === 'continued' || outcome.status === 'live') {
        hibernation.forget(outcome.id);
      }
      res.json(outcome);
    } catch (error) {
      res.status(errorStatus(error, 500)).json({ error: errorMessage(error) });
    }
  });

  app.post('/api/sessions/:id/restart', async (req: ApplicationRequest, res: ApplicationResponse) => {
    const result = await sessionOperations.restartSessionById(req.params.id);
    res.status(result.status).json(result.body);
  });

  const lifecycleActions = createSessionLifecycleActions({ operations: sessionOperations, ownership });
  const sessionBounces = createSessionBounceRuntime({
    operations: sessionOperations,
    ownership,
    catalog: () => { invalidateRegistryCache(); return catalog.getActiveSessions(); },
  });

  const hibernation = createSessionHibernation({
    readSettings: readDishSettings,
    readMeminfo: () => { try { return fs.readFileSync('/proc/meminfo', 'utf8'); } catch { return null; } },
    candidates: () => { invalidateRegistryCache(); return catalog.getActiveSessions(); },
    viewers: id => { try { return streamViewers.get(canonicalSessionId(id)) || 0; } catch { return 0; } },
    capture: lifecycleActions.capture,
    paneAttached: async authority => {
      if (!authority.spawn) return false;
      const clients = await tmux.paneAttachedClients(authority.spawn.socket, authority.spawn.paneId);
      return clients === null || clients > 0;
    },
    inspect: authority => lifecycleActions.inspect(authority, 'hibernate'),
    execute: async (authority, inspection) => { await lifecycleActions.execute(authority, 'hibernate', inspection); },
    resume: async id => {
      await sessionOperations.resumeSessionById(id);
      messageHold.wake(id);
    },
  });

  // Web Push: this host notifies subscribed devices about its own sessions.
  const pushNotifier = createPushNotifier({
    sessions: () => catalog.getActiveSessions(),
    agentLaunched: id => {
      const launchParents: ReadonlyMap<string, unknown> = decodeLaunchParents(sessionProvenance.readLaunches());
      return launchParents.has(id);
    },
    readMessages: file => readSessionMessages(file),
    host: () => ({ hostId: hostIdentity.getHostId(), label: hostIdentity.getHostLabel(readDishSettings()) }),
  });

  app.get('/api/push', (_req: ApplicationRequest, res: ApplicationResponse) => {
    try { res.json({ publicKey: pushNotifier.publicKey() }); }
    catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  });
  app.post('/api/push/subscriptions', (req: ApplicationRequest, res: ApplicationResponse) => {
    const { subscription, publicKey } = requestBody(req);
    try {
      const result = pushNotifier.subscribe(subscription, publicKey);
      if (result.ok) res.status(204).end();
      else res.status(result.status).json({ error: result.error });
    } catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  });
  app.delete('/api/push/subscriptions', (req: ApplicationRequest, res: ApplicationResponse) => {
    pushNotifier.unsubscribe(requestBody(req).endpoint);
    res.status(204).end();
  });
  app.post('/api/push/test', async (req: ApplicationRequest, res: ApplicationResponse) => {
    try {
      if (await pushNotifier.test(requestBody(req).endpoint)) res.status(204).end();
      else res.status(404).json({ error: 'This device is not registered with this host.' });
    } catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  });

  app.get('/api/session-bounces/preview', async (req: ApplicationRequest, res: ApplicationResponse) => {
    if (!['reload', 'restart'].includes(req.query.mode as string)) {
      return res.status(400).json({ error: 'mode must be reload or restart' });
    }
    try { res.json({ targets: await sessionBounces.preview(req.query.mode as SessionBounceMode) }); }
    catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  });

  app.post('/api/session-bounces', (req: ApplicationRequest, res: ApplicationResponse) => {
    const { mode, sessionIds } = requestBody(req);
    try { res.status(202).json({ operation: sessionBounces.enqueue(mode, sessionIds) }); }
    catch (error) { res.status(errorStatus(error, 500)).json({ error: errorMessage(error) }); }
  });

  app.get('/api/session-bounces', async (_req: ApplicationRequest, res: ApplicationResponse) => {
    try { res.json({ operations: await sessionBounces.list() }); }
    catch (error) { res.status(500).json({ error: errorMessage(error) }); }
  });

  app.delete('/api/session-bounces/:id', (req: ApplicationRequest, res: ApplicationResponse) => {
    const operation = sessionBounces.cancel(req.params.id);
    if (!operation) return res.status(404).json({ error: 'Unknown bulk operation' });
    res.json({ operation });
  });

  // A routine is a session template and an invocation is a session: each run
  // stamps its session with routine provenance.
  const routineRunner = createRoutineRunner({
    store: routinesStore,
    createSession: sessionOperations.createSession,
    resumeSession: sessionOperations.resumeSessionById,
    getLiveSession,
    closeSession: sessionOperations.closeSessionById,
    composePrompt: (routine, invocation) => composeRoutinePrompt(routine, invocation, sessionRefDeps()),
    isTurnInProgress: (sess) => !!sess?.turnInProgress,
    supports: liveSessionSupports,
    recoveryOutcome: sessionId => recoveryRunner.outcome(sessionId),
  });
  const routineHandlers = createRoutineHandlers({
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

  app.get('/api/sessions/:id/stream', createSessionStreamHandler({ getLiveSession, viewers: streamViewers }));

  const terminalHandlers = terminal.isTerminalEnabled() ? createTerminalHandlers({
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
  function closeResources(shareServer: Server | null): void {
    recoveryStopped = true;
    recoveryRunner.stop();
    routineRunner.stop();
    messageHold.stop();
    // Detach from Prime's daemon: the poller and socket belong to this server.
    getPrimeDaemon().shutdown();
    if (shareServer) { try { shareServer.close(); } catch {} }
    remoteHosts.shutdown();
    sessionBounces.stop();
    hibernation.stop();
    pushNotifier.stop();
  }

  // Fleet relay takes precedence even when this host's terminal is disabled.
  // Keep ordinary unbound handler calls and destroy every unclaimed socket.
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    let url: URL;
    try { url = new URL(req.url || '', 'http://localhost'); } catch { socket.destroy(); return; }
    if (relayUpgrade(req, socket, head, url) || terminalUpgrade?.(req, socket, head, url)) return;
    socket.destroy();
  }

  return startListeners({
    app, host: HOST, port: PORT, upgrade, closeResources,
    terminalShutdown: terminalHandlers?.shutdown,
    warm: () => { piSDK.getAvailableModels().then(setModelsCache).catch(() => {}); },
    onListening: () => {
      // Skill roots precede the first big index build; failure remains harmless.
      skillsLib.getSkillFilePaths({ cwds: knownWorkspaceCwds(catalog.buildSessionCatalog) })
        .then(paths => sessionIndex.setSkillRoots(paths))
        .catch(() => {});
      messageHold.start();
      sessionBounces.start();
      hibernation.start();
      pushNotifier.start();
      // Prime roots appear in the daemon roster, not the bridge registry: poll
      // it so the active list and capability projections track attaches/exits.
      getPrimeDaemon().start();
      // A restored idle session is interrupted work, not a completed oneShot.
      recoveryRunner.start()
        .then(() => routineRunner.recoverAfterRestart())
        .then(() => { if (!recoveryStopped) routineRunner.start(); })
        .catch((error) => console.error(`Session restart recovery failed: ${errorMessage(error)}`));
    },
    mountShareApp: shareApp => {
      shareApp.get('/share/:token', publicationHandlers.serveSharedSession);
      shareApp.get('/page/:token', publicationHandlers.publicPage);
      shareApp.get('/page/:token/*', publicationHandlers.publicPageAsset);
      shareApp.get('/style.css', publicationHandlers.fileStyles);
      shareApp.get('/vendor/hljs-theme.min.css', publicationHandlers.highlightStyles);
      shareApp.use((_req: ApplicationRequest, res: ApplicationResponse) => res.status(404).type('text/plain').send('Not found'));
    },
  });
}
