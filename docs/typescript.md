# TypeScript migration guide

For current completion status and the ordered work queue, start with
[the roadmap](../BACKLOG.md). This document describes the typed boundaries,
build conventions and compatibility rules already implemented.

The shared foundation is complete within its defined scope. Browser migration
is in progress; the server application and feature stores remain largely
JavaScript. The original foundation introduced no UI framework, ESM runtime
migration or wire/store format change. Subsequent browser extractions use
vanilla TypeScript and ordinary DOM rendering.

| TypeScript source in `src/core/` | Responsibility |
| --- | --- |
| `contracts.ts` | Identity distinctions, process proof shapes, harness descriptors and running-tool snapshots |
| `session-key.ts` | Strict route decoding, harness/native encoding and legacy Pi canonicalization |
| `harnesses.ts` | Existing harness registry and launch argv/environment construction |
| `session-capabilities.ts` | Bridge capability defaults and API projection; lifecycle authority stays with callers |
| `session-api.ts` | Browser session/model DTOs, runtime decoders and client projection; feature extras stay unknown |
| `wire-protocol.ts` | RPC/bridge envelope validation and response/event distinctions; feature payloads remain unknown |
| `rpc-session.ts` | RPC child lifecycle, request methods, stream reconstruction and native-id pool |
| `bridge-session.ts` | Registry discovery/claims, socket handshake and pool, request methods and reconnect snapshots |
| `host-identity.ts` | Stable host id and host label |
| `host-colors.ts` | Shared pure color sanitization, palette assignment and RGB conversion |
| `dish-store.ts` | HOME-scoped reads and atomic writes for small JSON stores |
| `process-identity.ts` | Linux birth identity, liveness and bounded ancestry proofs |
| `pending-requests.ts` | Correlation, timeout and disconnect cleanup for socket/stdio requests |
| `line-splitter.ts` | Incremental UTF-8 LF framing |
| `running-tool-calls.ts` | Shared bridge/RPC reconnect snapshots |

`src/browser/session-state.ts` owns browser list/selection state and the existing
generation guards. It compiles strictly into the local `public/browser.js` bundle;
`app.js` creates the store through `PiDishBrowser.createSessionState`.
Its metadata fields stay unknown, and `test/types/browser-state.ts` checks its
public interface. Browser route/host ids are strings here, without claiming the
server's branded validation. `captureSelection()` returns a frozen host/id/
generation token; `ownsSelection()` checks all three. Transcript loads, stream
connections/retries, relations and metadata mutations now carry these tokens.
Composer/queue actions, file/diff guards, terminal connections, dialog responses
and bounce reconciliation use the same owner checks. The old id-plus-counter
guard is removed; file/diff request counters still distinguish newer requests
inside one selection. Resume, search, stats, shares/pages and comment callbacks
also retain captured owners. Their existing feature counters still distinguish
modal instances, file requests and comment drafts within a selected session.
Tree/branch operations and model/thinking menu loads also carry selection
owners; a late branch preserves returned editor text in its original draft.

`server.js`, most browser controllers/rendering and feature stores remain
JavaScript. Most harness extension sources are already TypeScript, loaded by
the harnesses outside the `src/` build; their remaining migration/checking scope
needs a separate audit. The typed browser adapter and model-selector DOM module
are described below. The foundation's declarations do not mean that all its
JavaScript callers have been checked.

## Source and runtime

Keep sources directly in `src/core/`; nested output is explicitly rejected
before any generated files are replaced. Edit `src/core/*.ts`, then run:

```sh
npm run build:core
npm run check
npm test
```

The pinned TypeScript compiler emits ES2022 CommonJS and declarations to the
existing `lib/` entrypoints. Both outputs are committed. Consumers keep using
paths such as `require('./lib/session-key')`; installs, direct server startup,
Electron's existing file list and native harness loaders need no TypeScript
loader or additional production dependency. Runtime-relative paths such as
the harness registry's extension paths are still resolved from `lib/`, so do
not execute `src/core/` directly.

`scripts/build-core.js` compiles to a temporary directory before replacing
output. A type error leaves existing output untouched. Its `--check` mode
compares bytes without writing, including declaration files, and rejects old
generated files whose source was removed. `npm run typecheck` includes this
check, so the existing Node CI matrix verifies the generated files that the
backend and browser integration suites actually execute. A compiler upgrade
may require regenerating output; inspect that separately from source changes.

This checked-in output is a deliberate compatibility measure for the bounded
migration. The new build is needed when editing the foundation, not when
starting a deployed checkout. Broader build/deployment changes need their own
decision and packaging checks.

## Contract conventions

- `NativeSessionId`, `SessionId` and `HostId` are distinct branded strings.
  Existing validators/decoders and the host-id producer establish them. A Pi
  route retains the native id's bytes, but the types distinguish its role.
  Use `resolveSessionRoute` when passing a route back to a harness; avoid casts
  at callers. `validSessionId` narrows an unknown native id after validation.
- `HarnessId` is the supported `pi | omp | prime` vocabulary. Dynamic input
  goes through `getHarness`; its descriptor's `id` can then be used to encode
  a route. Typed callers cannot index the registry with arbitrary strings.
- Advertised bridge capability values remain `unknown`. The policy preserves
  Pi's legacy defaults and requires exact `true` for alternative harnesses;
  projected session capabilities are complete boolean records. Close/restart
  flags are advice derived from independently checked ownership inputs.
- `SessionRef` requires both a host and route id and is readonly. It is a
  foundation contract for later consumers. Browser `SelectionOwner` also carries
  a selection generation; it protects asynchronous view writes, not lifecycle
  authority. Transcript metadata merges require a current owner and preserve
  the selected id and host even if wire fields contain different values.
- `ProcessIdentity` includes PID and birth time. Input functions still accept
  partial/coercible registry values so the existing fail-closed checks remain
  authoritative. Type annotations never substitute for checking a live process.
- `PendingRequests.track` returns `Promise<unknown>`; receiving a response does
  not validate its schema. `readStore` returns a record of unknown values. A
  later typed caller must narrow these at its own protocol/feature boundary.
- Both transports ignore malformed envelopes (including JSON primitives) and
  responses without boolean success, a valid correlation id shape, or a
  string/null error. An ignored response leaves its request pending until a
  valid reply, disconnect, or timeout. Unknown event names still pass through.
  Envelope decoding does not validate event or command payloads, and a decoded
  hello still requires the existing claim proof.
- RPC startup validates its state object, session-file shape, and native id
  before publishing a session. Event payload fields are narrowed where the RPC
  class consumes them; snapshots and command results retain unknown feature
  fields. Its discovery/recovery dependencies remain JavaScript behind explicit
  typed adapter signatures, so those implementations are not yet type checked.
- Bridge registry decoding establishes only a native id and socket-path shape.
  Entries failing that shape are pruned from disk, like stale registrations;
  a live producer may not rewrite its entry until its registry signature changes.
  A legacy hello with an invalid native id emits a protocol error and closes
  the socket without applying its state.
  Mutable metadata and harness identity remain unvalidated until their consuming
  boundaries. Protocol-v2 events/responses wait for an exact claim-matching
  hello before they can mutate state. A malformed switch id cannot retarget the
  connection; identity-less legacy switch resets remain supported. Bridge
  request ids are optional because an early rejection never tracked a request.
- Tool arguments and partial results remain opaque. The shared tracker owns
  lifecycle bookkeeping, not tool-specific validation.
- Harness contracts describe current behavior, including optional legacy
  resume arguments. They preserve lifecycle modes and capability differences;
  they do not enable additional harness commands.

`test/types/core.ts` checks the declarations through the public `lib/` imports,
including cases that must fail compilation. Runtime regressions exercise the
generated files. Preserve the existing assertions when subsequent consumers
migrate; adapt setup/imports without weakening behavioral coverage. See
[Testing](testing.md) for the full matrix and scope limitations.

The [browser framework assessment](browser-framework-assessment.md) records the
vanilla TypeScript direction and a deferred model-selector experiment.

The session/model API slice now has explicit decoded response contracts. Server
client-list projection and harness model normalization use this boundary; malformed
model identities are discarded. Client projection rejects malformed control
fields per row, so a damaged history file cannot break the entire sidebar list.
Missing capabilities remain optional, and thinking acknowledgements fall back
to the validated requested level when a harness returns an unusable value.
The typed browser adapter consumes these contracts. This does not validate transcript
content, every endpoint, or lifecycle authority.

## Browser build and API adapter

`src/browser/` compiles strictly using `tsconfig.browser.json`.
`npm run build:browser` checks types, then uses the pinned esbuild dependency to
emit the self-contained `public/browser.js` script, loaded before `app.js`.
The output is committed; normal server startup and Electron packaging continue
to use `public/` directly. `npm run check` rejects stale output without repairing
it. esbuild is a build dependency, not an application framework.

The adapter owns synchronous host/authorization resolution, generic JSON sends,
and decoded session-list/model reads and model/thinking/rename mutations.
Selection/view guards remain with callers; typed mutation methods retain the
captured host and route id. Enabled-model preferences retain server-local scope.
Other response payloads and transcript content remain outside this API slice.
The browser state store and its compile-only consumers use the same strict
TypeScript build. `SelectionOwner` is exported directly from the typed store;
the API adapter and model selector share that contract. The legacy standalone
`public/session-state.js` script has been removed. State unit tests execute the
generated browser bundle, matching the implementation loaded by the app.

Model, thinking, rename and enabled-model sends use `sessionApi`; intercept
`apiFetch` in integration tests for these operations, rather than `apiSend`.
Browser runtime imports must remain under `src/`; legacy script contracts use
type-only imports to avoid bundling a second copy of their runtime state.

The model-selector DOM implementation is also strictly checked under
`src/browser/`. Its view/actions interface and ordinary DOM baseline are
[documented with a repeatable behavior and timing baseline](model-selector-baseline.md).

Continue migrating coherent state, controller and DOM modules from `public/app.js`
into `src/browser/`, preserving owner-bearing actions and explicit cleanup.
Plain TypeScript is the current implementation choice. A leaf component pilot
can be reconsidered separately if a concrete maintenance problem warrants it.

`src/browser/host-connections.ts` owns connection observations and poll eligibility.
It retains the existing retry ladder, stable-success reset window, blocked-host
policy and one-way fleet seeding. `app.js` supplies the current host list and a
render callback; catalog persistence and descriptor requests remain outside this
module. `hostKeyOf` provides one key convention for connection and request state.
The reducer's existing tests now execute the browser bundle, alongside controller
checks for notification gating, reset and pruning.

`src/browser/host-session-loader.ts` owns per-host list requests, shared in-flight
work, last-known rows and indexing state. It preserves active-only family hints
and live-subagent merging. `app.js` supplies decoded list reads, the current
fan-out sequence and view callbacks; it retains query-host pruning, indexing
refresh timers and unread bookkeeping. A request snapshots the host endpoint
before awaiting and uses a unique owner; pruning or replacement retires it.
Only matching wire query, historical scope and captured host routing/credentials
can join a pending request. Retired successes and failures cannot replace newer
host observations or resurrect pruned caches. A still-current host request can
update connection state after its overall fan-out changes, but cannot publish
rows for that old fan-out. Cache failures retain the existing last-known lists.

`src/browser/thinking-selector.ts` owns another ordinary DOM leaf with typed
view/actions and disposal. Its readonly level list is copied before including
an unsupported current level; session-specific values cannot contaminate the
shared Pi vocabulary. Labels use text properties and native buttons, replacing
inline JavaScript handlers. The app still owns model discovery, level policy,
placement and API feedback, and checks each action's captured selection owner.

`src/browser/host-catalog.ts` owns host URL normalization, the persisted catalog
projection and merging self/fleet/user sources. The first route for an id/base
wins and later entries only fill missing metadata. It preserves the existing URL
policy and drops broken catalog rows without mutating inputs. Normalized routes
and tokens are typed for the transport/loaders; descriptor capabilities, version
and self labels remain opaque until their consuming feature narrows them.

`src/browser/harness-discovery.ts` owns the new-session harness catalog, request
sequence and per-host settings-badge cache. Picker requests capture the host and
cache key before awaiting; only the latest request for the still-selected host
can publish. Background reads share pending work per host and cannot overwrite
a newer picker catalog. Both cache writers refresh the settings badge.
Failed background reads remain retryable; successful
empty catalogs are cached. Failed picker reads retain the Pi fallback, while
empty catalogs leave the existing picker intact. Rows require a nonempty string
id, labels are narrowed, and capability/availability payloads remain opaque with
the existing truthiness/exact-false policies. The app supplies transport,
preference storage, host selection and rendering callbacks.

`src/browser/host-discovery.ts` owns self/fleet request sequences, fleet refresh
timing and direct-host descriptor requests. Each peer request captures its
endpoint and catalog source; replaced sources, changed credentials/routes and
superseding requests retire prior results, including failures. Fleet refreshes
also reject obsolete results; post-discovery rendering belongs to the latest
published fleet, so a later failed attempt cannot suppress that notification.
Fleet waiters follow replacement requests before releasing startup readiness.
Catalog saves preserve unchanged source objects while still removing changed
or extra fields. Descriptor identity is validated while optional metadata remains opaque. Directory writers own source mutation; the app supplies persistence and rendering callbacks.

`src/browser/host-directory.ts` owns self identity, the device catalog, fleet
source rows and the cached effective host list. It supplies exact lookups and
the existing transport fallback to self. Public catalog/host views are readonly;
add/remove/token, identity and fleet changes go through its writers. Catalog
saves retain unchanged source objects, while explicit replacement retires them.
Discovery updates must refer to a currently owned source and persist only device
catalog fields. Persisted labels are strings immediately after discovery; opaque
labels/version/capabilities remain available through descriptor overlays. The app
supplies storage and rendering/connection callbacks.

`src/browser/host-settings.ts` owns settings markup, row/form listeners, catalog
actions and add-host validation. Each request captures an endpoint and the
mounted view/attempt; edits, resubmission, unmount and remount retire old replies
before descriptor or catalog publication. Ownership is checked after both the
response and its body. Form and row listeners are disposed on replacement/close.
Color input preserves its row while updating the sidebar, and change refreshes
the controls. Color state is supplied by the typed host presentation controller; shared
label/HTML formatting remains an explicit callback.

`src/browser/host-presentation.ts` owns device-local color overrides, first-seen
palette order, chip/dot rendering and native color resolution. Preference writers
receive readonly values; failed storage writes preserve runtime color changes.
The shared pure color functions live in `src/core/host-colors.ts`, compiled into
both the browser bundle and `lib/host-colors.js`. `public/helpers.js` re-exports
those functions for its existing Node consumers. Color lookup accepts only own
validated overrides, including host keys that match Object prototype names.

`src/browser/directory-catalog.ts` owns known cwd rows and directory response
decoding. Reads capture the selected host id, route, token and request generation;
readonly rows are hidden immediately when their host is no longer selected.
`cwd-autocomplete.ts` owns shared cwd input/row listeners and debounce/blur timers.
Every keystroke retires earlier reads before the next debounce begins, while
existing visible paths remain selectable on their originating host. Suggestions
and picks retain host/query ownership, and disposal retires requests and listeners.
`directory-tree.ts` owns lazy tree DOM, node actions and tree-scoped abort signals.
Reset and close retire the old tree; delayed bodies and retained old nodes cannot
write to or select a path for the new host. Host catalog changes and late self
discovery renew open directories when the captured endpoint changes. The app supplies selected-host,
transport, fuzzy formatting and selection callbacks. Workspace chips and routine
CRUD remain in JavaScript pending their own feature migration.
