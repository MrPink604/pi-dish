// Compile-only consumers of the declarations at the real CommonJS paths.
// Keep negative cases: a widened declaration must not silently erase the contract.
import { canonicalSessionId, resolveSessionRoute, encodeSessionKey, validSessionId } from '../../lib/session-key';
import { getHostId } from '../../lib/host-identity';
import { registry, getHarness, resolveLaunchSpec } from '../../lib/harnesses';
import { PendingRequests } from '../../lib/pending-requests';
import { readStore } from '../../lib/dish-store';
import { createLineSplitter } from '../../lib/line-splitter';
import { trackRunningToolCalls } from '../../lib/running-tool-calls';
import { bridgeSupports, sessionCapabilities } from '../../lib/session-capabilities';
import { decodeBridgeFrame, decodeRPCFrame } from '../../lib/wire-protocol';
import { getRPCSession } from '../../lib/rpc-session';
import { BridgeSession } from '../../lib/bridge-session';
import type { HostId, NativeSessionId, SessionId, SessionRef, ProcessIdentity, RunningToolCall, HarnessDescriptor } from '../../lib/contracts';

const hostId: HostId = getHostId();
const capabilities = sessionCapabilities('omp', { prompt: 'unvalidated wire value' }, { active: true });
const canPrompt: boolean = capabilities.prompt;
bridgeSupports('pi', {}, 'treeNavigation');
// @ts-expect-error UI capabilities and bridge operation names are distinct.
bridgeSupports('omp', {}, 'tree');
// @ts-expect-error Every public capability is a boolean after projection.
capabilities.close = 'true';
// @ts-expect-error Lifecycle authorization is an explicit boolean input.
sessionCapabilities('prime', {}, { closeAllowed: 'yes' });
const sessionId: SessionId = canonicalSessionId('legacy-pi');
const nativeId: NativeSessionId = resolveSessionRoute(sessionId).nativeSessionId;
const rpc = getRPCSession(nativeId);
const bridge = new BridgeSession({ sessionId: nativeId, socketPath: '/fixture.sock' });
const bridgeRequest = bridge.send('tree_read');
bridge.cancelQueued('steering', 0, 'queued text');
// @ts-expect-error Queue names differ from prompt delivery modes.
bridge.cancelQueued('steer', 0, 'queued text');
// @ts-expect-error Queue cancellation must carry the text used to check the selected item.
bridge.cancelQueued('steering', 0);
// @ts-expect-error OMP tree navigation only forwards the summarize option.
bridge.treeNavigate('entry', { label: 'not forwarded' });
if (bridgeRequest.requestId !== undefined) {
  const correlationId: number = bridgeRequest.requestId;
  void correlationId;
}
// @ts-expect-error An early rejected bridge request has no correlation id.
const guaranteedCorrelationId: number = bridgeRequest.requestId;
bridge.on('custom_event', payload => {
  // @ts-expect-error A named bridge event does not validate its payload.
  payload.message.content.map(String);
});
// @ts-expect-error Bridge model selection takes a model reference, unlike RPC's two arguments.
bridge.setModel({ provider: 'test', id: 'model' });
if (rpc) {
  const unsubscribe: () => void = rpc.on('message_update', payload => {
    // @ts-expect-error Event subscribers must narrow the payload they consume.
    payload.message.content.map(String);
  });
  // @ts-expect-error Prompt text cannot be a parsed protocol object.
  rpc.prompt({ text: 'hello' });
  // @ts-expect-error A command result has not been schema validated by correlation.
  rpc.getCommands().then(result => result.commands.map(String));
  void unsubscribe;
}
// @ts-expect-error The RPC pool is indexed by native Pi ids, not public routes.
getRPCSession(sessionId);
const owner: SessionRef = { hostId, sessionId };
encodeSessionKey('omp', nativeId);
const input: unknown = 'from-json';
const rpcFrame = decodeRPCFrame(input);
if (rpcFrame?.kind === 'response') {
  const success: boolean = rpcFrame.response.success;
  // @ts-expect-error A valid response envelope does not validate its command payload.
  rpcFrame.response.data.sessions.map(String);
  void success;
}
const bridgeFrame = decodeBridgeFrame(input);
if (bridgeFrame?.kind === 'event') {
  // @ts-expect-error Bridge event payloads require feature-specific narrowing.
  bridgeFrame.data.method.trim();
}
if (validSessionId(input)) encodeSessionKey('prime', input);
// @ts-expect-error Dynamic harness names must go through getHarness.
registry[String(input)].closeMode;
// @ts-expect-error The registry vocabulary cannot be extended by typed callers.
registry.pi = registry.omp;
// @ts-expect-error Only supported harnesses can produce typed routes.
encodeSessionKey('constructor', nativeId);
const decoded = resolveSessionRoute(sessionId);
// @ts-expect-error Parsed identities retain the supported harness vocabulary.
decoded.harnessId = 'unsupported';
encodeSessionKey(decoded.harnessId, nativeId);

// @ts-expect-error A route id is not a harness-native id, even when Pi uses the same bytes.
encodeSessionKey('pi', sessionId);
// @ts-expect-error A bare string must pass the native-id boundary first.
encodeSessionKey('omp', 'unchecked');
// @ts-expect-error A session reference must carry its owning host.
const incompleteOwner: SessionRef = { sessionId };
// @ts-expect-error A host id cannot be substituted for a route id.
const mixedOwner: SessionRef = { hostId, sessionId: hostId };
// @ts-expect-error Async request ownership is captured, not retargeted in place.
owner.hostId = hostId;
// @ts-expect-error A full process identity includes the process birth time.
const incompleteProcess: ProcessIdentity = { pid: 123 };

const harness = getHarness(input);
if (harness) {
  encodeSessionKey(harness.id, nativeId);
  const launch: { env: Record<string, string>; argv: string[] } = resolveLaunchSpec(harness);
  launch.argv.map(arg => arg.toUpperCase());
  // @ts-expect-error A model option is a model reference, not a catalog object.
  harness.argv.new({ model: { id: 'model' } });
}
// @ts-expect-error Lifecycle modes are an explicit vocabulary.
const closeMode: HarnessDescriptor['closeMode'] = 'kill-any-process';

async function consumeUnvalidatedResponse() {
  const pending = new PendingRequests();
  const response = await pending.track('hello');
  // @ts-expect-error Receiving a response does not validate its payload.
  response.sessions.map(String);
}
// @ts-expect-error Store contents need feature-specific validation after JSON parsing.
readStore('settings.json').hostLabel.trim();

const feed = createLineSplitter(line => line.toUpperCase());
feed(Buffer.from('hello\n'));
feed(new Uint8Array([10]));
// @ts-expect-error Socket chunks are bytes or text, not parsed protocol objects.
feed({ type: 'hello' });

const running = new Map<string, RunningToolCall>();
trackRunningToolCalls(running, 'tool_execution_start', { toolCallId: 't1', toolName: 'Bash', args: { command: 'true' } });
// @ts-expect-error Reconnect snapshots require a numeric timestamp.
running.set('t1', { toolName: 'Bash', args: {}, startedAt: 'yesterday', lastPartialResult: null });

void [guaranteedCorrelationId, canPrompt, incompleteOwner, mixedOwner, incompleteProcess, closeMode, consumeUnvalidatedResponse];

// Browser API contracts describe validated values, not arbitrary JSON casts.
import { decodeModelCatalog, decodeSessionMetadata, decodeThinkingResult } from '../../lib/session-api';
import type { ModelChangeRequest } from '../../lib/session-api';
const apiModel = decodeModelCatalog([])[0]!;
const apiProvider: string = apiModel.provider;
const apiSession = decodeSessionMetadata({ id: 'a' });
const apiControl: boolean | undefined = apiSession.capabilities?.btw;
const apiLevel: string = decodeThinkingResult({ success: true, level: 'high' }).level;
const apiChange: ModelChangeRequest = { modelId: apiProvider + '/model' };
// @ts-expect-error Unknown feature fields require narrowing.
const apiExtra: string = apiSession.extensionMetadata;
// @ts-expect-error Control flags cannot accept wire strings.
apiSession.capabilities = { close: 'true' };
// @ts-expect-error Model changes must carry a selector.
const missingSelector: ModelChangeRequest = {};
void [apiControl, apiLevel, apiChange, apiExtra, missingSelector];

if (apiSession.capabilities) {
  // @ts-expect-error An unadvertised capability is undefined, even with a capabilities object.
  const absentCapability: boolean = apiSession.capabilities.future;
  void absentCapability;
}

// The implemented source/index/catalog contracts are checked through generated declarations.
import type { SessionFields, SessionRow, SessionMutationPatch, SessionActivityPatch, SessionTranscriptPatch } from '../../lib/session-api';
import type { SessionSource, SessionSourceResolver } from '../../lib/session-source-contracts';
import type { SessionMetadataIndex } from '../../lib/session-index-contracts';
import * as implementedIndex from '../../lib/session-index';
import { createSessionSourceResolver } from '../../lib/session-source';
import { composeSessionCatalog } from '../../lib/session-catalog';
import type { SessionCatalogInput, SessionCatalogOptions, SessionCatalog } from '../../lib/session-catalog-contracts';
const checkedIndex: SessionMetadataIndex = implementedIndex;
const checkedResolver: SessionSourceResolver = createSessionSourceResolver();
declare const catalogInput: SessionCatalogInput;
declare const catalogOptions: SessionCatalogOptions;
const checkedCatalog: SessionCatalog = composeSessionCatalog(catalogInput, catalogOptions);
void [checkedIndex, checkedResolver, checkedCatalog];
import type { CatalogSession, CatalogLiveObservation } from '../../lib/session-catalog-contracts';
import { sessionForClient } from '../../lib/session-api';
declare const serverCatalogRow: CatalogSession;
// @ts-expect-error Server projection cannot accept malformed first-party metadata.
sessionForClient({ ...serverCatalogRow, model: 123 });
const serverTimestamp: Date | string | number | null | undefined = sessionForClient(serverCatalogRow).lastActivity;
// @ts-expect-error A pre-JSON server projection is not a wire-only timestamp.
const prematureWireTimestamp: string | number | null | undefined = sessionForClient(serverCatalogRow).lastActivity;
declare const liveObservation: CatalogLiveObservation;
const pendingHistory: CatalogLiveObservation = { ...liveObservation, source: null, claimedFile: '/tmp/not-created-yet.jsonl' };
const closedFields: SessionFields = { name: null, contextTokens: 0, compacting: false, familyParentId: null };
const closedRow: SessionRow = { id: 'peer', fields: closedFields, extras: { extension: { native: true } } };
const omittedPatch: SessionMutationPatch = {};
const nullablePatch: SessionTranscriptPatch = { name: null, cwd: null, lastActivity: 0 };
// @ts-expect-error Known model values are text or null.
const badMetadata: SessionFields = { model: 42 };
// @ts-expect-error Misspelled first-party patches are not extension data.
const typoPatch: SessionMutationPatch = { modle: 'typo' };
// @ts-expect-error Metadata patches cannot change route identity.
const identityPatch: SessionMutationPatch = { id: 'other' };
// @ts-expect-error Activity does not own registry liveness.
const livePatch: SessionActivityPatch = { isActive: true };
// @ts-expect-error Transcripts cannot overwrite capability policy.
const controlPatch: SessionTranscriptPatch = { capabilities: { close: true } };
// @ts-expect-error Browser timestamps have already crossed JSON serialization.
const datePatch: SessionTranscriptPatch = { lastActivity: new Date() };
declare const source: SessionSource;
declare const sourceResolver: SessionSourceResolver;
declare const metadataIndex: SessionMetadataIndex;
metadataIndex.scanSessions([source]);
sourceResolver.resolve({ route: sessionId, live: [] });
// @ts-expect-error Native ids and route ids are not interchangeable.
const wrongSource: SessionSource = { ...source, nativeSessionId: sessionId };
// @ts-expect-error Route ids cannot be built from native ids without canonicalization.
const wrongRoute: SessionSource = { ...source, routeId: nativeId };
// @ts-expect-error A bare path does not identify a parser profile or harness.
metadataIndex.getSessionInfo('/tmp/session.jsonl');
// @ts-expect-error Borrowed cache observations are not mutable catalog snapshots.
metadataIndex.scanSessions([source]).infos.get(source.file)!.name = 'mutated';
// @ts-expect-error Authoritative metadata has no open extension index signature.
closedRow.fields.extension = true;
void [pendingHistory, serverTimestamp, prematureWireTimestamp, omittedPatch, nullablePatch, badMetadata, typoPatch, identityPatch, livePatch, controlPatch, datePatch, wrongSource, wrongRoute];
