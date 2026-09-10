# Typed foundation

The first migration is limited to existing shared primitives. It introduces no
feature-module extraction, UI framework, ESM runtime migration, or wire/store
format change.

| TypeScript source in `src/core/` | Responsibility |
| --- | --- |
| `contracts.ts` | Identity distinctions, process proof shapes, harness descriptors and running-tool snapshots |
| `session-key.ts` | Strict route decoding, harness/native encoding and legacy Pi canonicalization |
| `harnesses.ts` | Existing harness registry and launch argv/environment construction |
| `session-capabilities.ts` | Bridge capability defaults and API projection; lifecycle authority stays with callers |
| `wire-protocol.ts` | RPC/bridge envelope validation and response/event distinctions; feature payloads remain unknown |
| `rpc-session.ts` | RPC child lifecycle, request methods, stream reconstruction and native-id pool |
| `bridge-session.ts` | Registry discovery/claims, socket handshake and pool, request methods and reconnect snapshots |
| `host-identity.ts` | Stable host id and host label |
| `dish-store.ts` | HOME-scoped reads and atomic writes for small JSON stores |
| `process-identity.ts` | Linux birth identity, liveness and bounded ancestry proofs |
| `pending-requests.ts` | Correlation, timeout and disconnect cleanup for socket/stdio requests |
| `line-splitter.ts` | Incremental UTF-8 LF framing |
| `running-tool-calls.ts` | Shared bridge/RPC reconnect snapshots |

`public/session-state.js` now owns browser list/selection state and the existing
generation guards. It uses strict JavaScript/JSDoc checking, like cron, and loads
as a local plain script before `app.js`; there is no browser compilation step.
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

`server.js`, browser transport/rendering, feature stores and harness
extensions remain in their existing form. The foundation's declarations
do not mean that all its JavaScript callers have been checked.

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
