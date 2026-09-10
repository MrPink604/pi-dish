// Compile-only consumers of the declarations at the real CommonJS paths.
// Keep negative cases: a widened declaration must not silently erase the contract.
import { canonicalSessionId, resolveSessionRoute, encodeSessionKey, validSessionId } from '../../lib/session-key';
import { getHostId } from '../../lib/host-identity';
import { registry, getHarness, resolveLaunchSpec } from '../../lib/harnesses';
import { PendingRequests } from '../../lib/pending-requests';
import { readStore } from '../../lib/dish-store';
import { createLineSplitter } from '../../lib/line-splitter';
import { trackRunningToolCalls } from '../../lib/running-tool-calls';
import type { HostId, NativeSessionId, SessionId, SessionRef, ProcessIdentity, RunningToolCall, HarnessDescriptor } from '../../lib/contracts';

const hostId: HostId = getHostId();
const sessionId: SessionId = canonicalSessionId('legacy-pi');
const nativeId: NativeSessionId = resolveSessionRoute(sessionId).nativeSessionId;
const owner: SessionRef = { hostId, sessionId };
encodeSessionKey('omp', nativeId);
const input: unknown = 'from-json';
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

void [incompleteOwner, mixedOwner, incompleteProcess, closeMode, consumeUnvalidatedResponse];
