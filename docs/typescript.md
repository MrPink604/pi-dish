# TypeScript migration guide

For current completion status, the renewed simplification mission and the ordered
work queue, start with [the roadmap](../BACKLOG.md). This document describes
implemented typed boundaries and their limitations, plus the design rules for
the [session catalog/metadata stage](session-catalog-migration.md).
The stage now implements discovery, source/cache ownership, metadata accumulation,
the persistent index and catalog composition in `src/core/`. Closed session fields
and writer-specific patches continue through browser ingress, state and consumers.
The stage record separates implementation, verification and external review.

The shared foundation, browser and product server source migrations are
implemented; their review and delivery gates are tracked in the roadmap.
Server application and feature implementations are authored in `src/core/`;
runtime edges have their own checked programs. The original foundation introduced no UI framework, ESM runtime
migration or wire/store format change. Subsequent browser extractions use
vanilla TypeScript and ordinary DOM rendering. The subsequent
[composition cleanup](browser-composition-cleanup.md) bundles direct dependencies
and removes the app's global forwarding surface.

## Source completion is not contract completion

The browser migration made controller inputs, request/view ownership and delivery
strictly checked. It intentionally preserved much of the old data flow and
classic-script composition. The catalog stage removed repeated normalization
and competing metadata owners; the composition cleanup replaces the classic-script
facade with ordinary imports and direct controller wiring. External and deliberately
opaque data still require the runtime checks at their consumed-field boundaries.

`SessionEntry` exposes readonly closed `SessionFields`, including readonly
capabilities; opaque external fields live in a separate `extras` object. Lists,
lookup and selection returns are readonly views, not immutable snapshots.
Private publication detaches external rows/capabilities once; ordered published
lists rebind loader caches so failed/partial polls preserve acknowledged writes.
Mutation, activity and transcript patches retain distinct named fields and runtime
filtering. Host stamping and selection generations decide which session changes.

Readonly `RenderMessage` and `TranscriptPage` contracts carry HTTP/SSE projections
through rendering, streaming, mood and telemetry without decoding again. Child
trace ingress decodes independently and cannot retarget the parent selection.
First-party nested values are readonly; mutable `Date` timestamps detach at ingress.
Opaque tool values remain unknown. Browser compilation also checks unused locals
and parameters.

Discovery, source resolution, metadata accumulation, indexing, catalog composition,
lifecycle ownership and recovery have checked implementations. M1 also authors
the six session-read/SDK/pricing/mining implementations in `src/core/` and generates
their existing `lib/` entrypoints. The index imports those implementations directly;
closed usage buckets and persisted decoders retain sparse day/model fields and
legacy absent continuity. `session-read-handlers.ts` owns transcript/image/search,
stats, read-only tree and export response production, plus the bound native share
snapshot/export callbacks. The root still supplies narrow observation ports and
mounts each handler at its original registration position.

M3 authors the distinct page/share/comment/fleet stores and file search, mention,
preview and diff implementations in `src/core/`. Their checked-in `lib/` outputs
retain the existing CommonJS entrypoints and persisted/wire behavior.
`publication-handlers.ts` consumes M1's actual bound export/snapshot callbacks
and M5's actual public-artifact relay; `file-handlers.ts` owns diff snapshots,
retirement cleanup and both stale-version checks. Their root mounts retain
their original positions, including the restricted public listener. Native FFF
loading uses M6's checked resource resolver inside the existing cached failure
boundary; walker fallback is not evidence of native packaging.
Legacy store members and external payloads remain explicitly opaque where the
old implementation passed them through. This migration does not unify the
stores or move remaining root/application ownership into these factories.
The original root proposal and producer provenance are recorded in
[`m3-evidence.json`](m3-evidence.json); the
[M3 implementation record](remaining-migration-plan.md#implementation-record--m3)
records accepted parent integration and exact-source delivery evidence.

M4's feature slice checks task-agent discovery, the interactive harness JSON/model
runner, harness settings, STT, application settings/limits, indexed usage, SDK
skills/coverage, scoped models and command-list responses. It consumes the actual
checked M1 producers and M6 bundled-resource resolver. The integrated root
mounts all sixteen handlers at their original positions; settings persistence,
model-cache invalidation and session mutation/control remain root-owned. Coverage
algorithms are preserved, not simplified. The
[M4 implementation record](remaining-migration-plan.md#implementation-record--m4)
records parent acceptance. M7 now authors the remaining composition policy in
`src/core/server-app.ts`; milestone acceptance remains the integration lead's decision.

The generated `lib/server-app.js` exports `startServer(rootDirectory: string)` and
returns the actual initial `http.Server` synchronously. The passed application
root supplies static assets, agent documentation, package metadata and publication
resources; flat `lib/` output is not treated as the application root. The root
`server.js` is only `module.exports = require('./lib/server-app').startServer(__dirname);`
and is enrolled in strict `checkJs` and the authored-source policy. Existing
factory mounts, middleware ordering, startup/recovery sequencing, listener ownership
and close hooks remain in their original order. No session/control, fleet,
publication, SSE or validation policy remains in the launcher.

Raw payloads stay unknown until their original native operations. The private
property helper emits native indexed access; it does not decode or trust a DTO.
The three pre-existing reload-error annotations preserve sloppy-write behavior
under strict output using an ignored four-argument `Reflect.set` result, with
the original thrown value as receiver. These are compatibility boundaries, not
new validation or a general reflection layer. [M7 evidence](m7-evidence.json)
records the frozen inventory, exact approved boundaries and runtime verification.

See the [stage plan](session-catalog-migration.md) for scope, field authority,
dependencies, deletion criteria and verification. Lifecycle authority, host and
selection ownership, local assets and checked-in runtime delivery remain
invariants; they are not simplification targets.

## Ordered migration stages

The task documents separate delivered contracts from pending implementation:

1. [Browser contract cleanup](browser-contract-cleanup.md): implemented readonly
   views, decoded message continuity and session-only model loading; verified and reviewed.
2. [Shared runtime helper cutover](shared-runtime-helpers.md): implemented, locally
   verified and approved by Fable at `1cbd826` without blocking findings.
3. [Session lifecycle migration](session-lifecycle-migration.md): implemented checked
   authority, launch and operation owners, actual recovery/Bounce policies and all
   lifecycle callers; local strict, backend, browser/UI and real-harness gates passed.
   Fable approved implementation `8e89e99` without blocking findings.

Each record separates delivered contracts, preserved behavior and
verification/review status. Those earlier stages alone did not check the remaining
routes and feature stores; M1–M7 check their actual implementations.

All three plans have [Fable 5.1 high-effort signoff](../BACKLOG.md#next-stage-plan-review)
for their clarified task definitions. This does not change the implementation
coverage described below or waive any stage's verification/review gates.

The [remaining migration and simplification plan](remaining-migration-plan.md)
now scopes the work beyond those delivered stages. M0–M7 finish actual product
implementation/compiler boundaries; R1–R12 then remove specific duplicated
responsibilities and awkward coupling, including in the already-typed browser;
C1–C2 finish tests/tooling and enforce whole-repository coverage and delivery.
The M0 [frozen delivery and worker contracts](m0-contracts.md) record the initial
compiler targets, exact handler modules/ports, native loader and package
manifests, and shared projection/artifact semantics. They remain a historical
baseline, not a substitute for each implemented owner's source and delivery proof.
The integration lead, not this guide, records milestone acceptance.

## Implemented foundation inventory

| TypeScript source in `src/core/` | Responsibility |
| --- | --- |
| `contracts.ts` | Identity distinctions, process proof shapes, harness descriptors and running-tool snapshots |
| `server-app.ts` | Checked application composition, remaining route/control/SSE policy, ordered startup and owned listener teardown |
| `session-key.ts` | Strict route decoding, harness/native encoding and legacy Pi canonicalization |
| `harnesses.ts` | Existing harness registry and launch argv/environment construction |
| `runtime-resources.ts` | Real external extension/skill/lib paths and metadata-selected physical FFF imports for ASAR packages |
| `file-search.ts` | M3 checked FFF consumer, finder cache, bounded walker and path completion; uses the M6 physical import resolver |
| `session-capabilities.ts` | Bridge capability defaults and API projection; lifecycle authority stays with callers |
| `session-api.ts` | Closed session fields and patches, wire ingress decoders, model DTOs and client projection |
| `session-discovery.ts`, `session-source.ts` | Bounded discovery and header identity; explicit source descriptors and route/cache consistency |
| `session-metadata.ts` | One metadata accumulator for full and appended entries; persisted metadata validation |
| `session-index.ts`, `session-index-data.ts` | Persistent metadata/text/skills index, bounded backfill, closed usage buckets and persisted projection validation |
| `session-catalog.ts` | Captured observation ingress, active/history/child projection, context and relationship/routine annotations |
| `wire-protocol.ts` | RPC/bridge envelope validation and response/event distinctions; feature payloads remain unknown |
| `rpc-session.ts` | RPC child lifecycle, request methods, stream reconstruction and native-id pool |
| `bridge-session.ts` | Registry discovery/claims, socket handshake and pool, request methods and reconnect snapshots |
| `session-recovery.ts` | Durable observation/control separation, saved-byte checkpoints and observer lifecycle |
| `tmux.ts`, `prime-lifecycle.ts` | Placement persistence, exact process/pane operations and owned Prime supervisor stop |
| `session-ownership.ts` | Live/source lookup, weak runtime advice, distinct captures, fresh revalidation and saved recovery validation |
| `session-launch.ts` | Descriptor-based wrappers, argv/env, registration, cleanup and explicit backend/uncertainty outcomes |
| `session-operations.ts` | Create/resume/close/restart, durable close intent, distinct flights, canonical-file quarantine and HTTP outcome projection |
| `recovery-runner.ts`, `session-bounces.ts` | Actual runners plus checked production restore/delivery and idle/execute/reload policies |
| `harness-agents.ts` | Bounded project/user/bundled agent inventory and temporary unpack cleanup |
| `harness-feature-commands.ts` | Interactive JSON/model command execution, cwd-qualified model cache and thinking-level overlay; separate from pricing execution |
| `harness-feature-settings.ts` | Harness config/agent responses, serialized global-only partial writes and project overlays |
| `stt.ts` | Server-side transcription configuration, MIME mapping, multipart transport and safe transport errors |
| `feature-handlers.ts` | Sixteen named feature response handlers and narrow root observation/persistence ports |
| `skills.ts`, `skill-feature-handlers.ts` | Actual SDK skill inventory, bounded bundle/catalog estimates, activation NDJSON and current-version coverage projections |
| `usage-feature-handler.ts` | Indexed usage summaries, known subtotals/unknown counters, model facets and local-day windows |
| `model-feature-handlers.ts` | SDK/command/live model discovery, scoped-model persistence and capability-filtered command listings; no delivery |
| `session-files.ts` | Cached display parser, stable-ID image lookup, search/stats/usage projections and bounded cwd/tail reads |
| `harness-pricing.ts`, `skill-mining.ts` | Optional pricing refresh/override revisions and whole-file/batch-local skill evidence |
| `pi-sdk.ts`, `omp-export.ts`, `session-refs.ts` | Real bundled SDK adapters, raw native OMP HTML export and lazy prompt-reference expansion |
| `session-read-handlers.ts` | Individual Express read handlers and bound share snapshot/export operations |
| `pages.ts`, `shares.ts`, `comments.ts` | Distinct live page references, immutable imported share snapshots and anchored comments with ownership/acknowledgement rules |
| `fleet-artifacts.ts` | Host-scoped artifact reachability mappings and persisted timestamp compatibility |
| `file-search.ts`, `file-mention.ts` | Lazy native FFF search/fallback and bounded file completion/reach behavior |
| `file-page.ts` | Local-asset standalone Markdown/text/image previews and inert raw HTML/SVG handling |
| `git-diff.ts` | Bounded repository/patch aggregation, optional deferred patches and version production |
| `publication-handlers.ts` | Page/share/comment HTTP production and local-first public artifact serving through actual M1/M5 dependencies |
| `file-handlers.ts` | Session file HTTP production, captured diff snapshots, retirement and stale-version checks |
| `host-identity.ts` | Stable host id and host label |
| `host-colors.ts` | Shared pure color sanitization, palette assignment and RGB conversion |
| `dish-store.ts` | HOME-scoped reads and atomic writes for small JSON stores |
| `remote-hosts.ts` | Direct/SSH fleet requests, credential replacement, HOME-qualified forwards, bounded descriptor probes and reachability backoff |
| `terminal.ts`, `terminal-handlers.ts` | Optional native PTY pool, bounded reconnect replay, output-aware idle expiry, restart continuity and local WebSocket attachment |
| `access-handlers.ts`, `relay-handlers.ts` | Checked compression/parser bypass, auth/tickets/CORS, fleet descriptors and separate API/public/comment/peer-upgrade policies |
| `process-identity.ts` | Linux birth identity, liveness and bounded ancestry proofs |
| `pending-requests.ts` | Correlation, timeout and disconnect cleanup for socket/stdio requests |
| `line-splitter.ts` | Incremental UTF-8 LF framing |
| `running-tool-calls.ts` | Shared bridge/RPC reconnect snapshots |
| `helper-{values,content,models,query,refs}.ts` | Portable shared primitives, content, model and query/reference behavior |
| `helper-{format,identity,markdown,types}.ts` | Shared escaping/truncation, metadata text, explicit math-renderer provider and structural contracts |
| `cron.ts`, `routines.ts`, `session-provenance.ts` | Local-time cron matching, raw routine definition/invocation storage and advisory launch provenance |
| `routine-runner.ts`, `routine-handlers.ts` | Actual scheduling, restart reconciliation, invocation lifetime, prompt/ref composition and eight individually mounted HTTP handlers |

The `session-*-contracts.ts` files describe the implemented source, metadata,
index and catalog boundaries. Compile-time fixtures assign the real index/resolver
implementations to those ports. `decodeSessionRow` separates named fields from
opaque extras; `host-session-loader.ts` flattens validated fields once, before
endpoint-owned host stamping. The legacy `decodeSessionMetadata` wire helper
remains compatible for external callers and is not the browser state contract.
Client projection only omits private fields and preserves server `Date` values
until serialization; wire decoding is a separate boundary.

M2's routine consumers retain raw persisted selections and ledger ids until their
existing consuming operations. The runner uses the actual lifecycle coordinator
and M1 reference-expansion implementation, not parallel dependency declarations.
`server-app.ts` retains registration/startup ordering and supplies observations;
the root launcher contains none of the former routine prompt or route-policy bodies.

New-launch argv/cwd remain unknown through native spawn/execFile boundaries.
Resume options and identity/control authority remain typed. Direct RPC file-URL
cwd now has filesystem-path metadata via `fileURLToPath`, **after** unchanged
native launch. This is an explicitly authorized metadata-representation correction,
not unchanged behavior for direct JavaScript callers. String metadata, falsy HOME
fallback and absent-HOME null metadata are preserved. Node 26 asynchronous spawn
accepts but ignores Buffer/Uint8Array cwd, unlike spawnSync; no matching byte-path
decoding was established. Those values fail metadata normalization after native
launch, await owned-child cleanup and never publish a session. Native launch
errors retain precedence. No guessed cwd or broader output schema is introduced.
The [M2 evidence](m2-evidence.json) records baseline comparisons, verification
and the separate final-review status.

`src/browser/session-state.ts` owns browser list/selection state and the existing
generation guards. It compiles strictly into the local `public/app.js` bundle;
`src/browser/app.ts` creates the store through its `createSessionState` import.
Its metadata and restricted writer interfaces are checked by
`test/types/browser-state.ts`. Browser route/host ids are strings here, without claiming the
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

The remaining server composition and feature stores now have checked TypeScript
implementations and generated CommonJS. The one-line `server.js` launcher is checked
JavaScript. First-party browser controllers, rendering, composition and static bindings are TypeScript. Native
harness extensions are strictly checked by `tsconfig.extensions.json` without
emission; harnesses still load their original `.ts` entrypoints. Electron and
skill CLI sources have checked sibling output through `build:edges`, described
below. The foundation's declarations do not mean that all its JavaScript
callers have been checked.

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
Electron and installed skill CLIs need no TypeScript loader or additional
production dependency. Native harnesses retain their own TypeScript loaders.
Runtime-relative paths still belong to emitted locations; the harness registry
passes the application root to `runtimeResourcePath` for external resources.
Do not execute `src/core/` directly.

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

`npm run check` begins with `npm run check:source-policy`. The pinned TypeScript
7 native parser rejects authored explicit `any` (including JSDoc wildcard types),
`@ts-ignore`, `@ts-nocheck` and product `@ts-expect-error` in the compiler-owned
paths listed by `source-policy.json`. Named type-negative fixtures require their
diagnostic purpose; tsc still checks that their errors actually occur. Strings and
template text are not directives. No explicit-any type-utility exception exists.
The current gate covers `src/core`, `src/browser`, the exact edge/native source
lists, checked tool/configuration bodies and named fixtures, not remaining JS
implementations. Cron is authored in `src/core/cron.ts`; its former checked-JS
exception is removed.
Every new migration compiler target must enroll its authored sources and fixtures.
See the [M0 contract](m0-contracts.md#dependencies-and-authored-source-policy).

### Checked build tools and host configurations

The C1 tools prerequisite uses strict NodeNext/ES2022, Node-only
`tsconfig.tools.json` for sibling sources in `scripts/`: `build-tools`,
`build-core`, `build-browser`, `build-edges`, `build-vendor`,
`check-source-policy` and `report-ci-failure`. The policy source is `.mts`
and keeps its `.mjs` API/command path; the others are `.ts` with existing
CommonJS `.js` command paths. Generated JavaScript and declarations are checked in.

After `npm ci`, `npm run build:tools` executes the checked-in
`scripts/build-tools.js`, not unbuilt TypeScript. It invokes the pinned compiler
in a temporary directory, validates the complete output mapping before writing,
and preserves first-line shebangs and the existing executable modes.
`npm run build:tools -- --check` rejects missing, stale, orphaned or wrong-mode
outputs without repairing them; `npm run typecheck` includes this gate.
Commit sources and generated outputs together. This compiler is specific to
the tool siblings; core/browser/edge build algorithms and output locations stay
unchanged. The vendor tool retains its handwritten highlight loader until R12.

`tsconfig.configs.json` checks the actual host configuration bodies without
emission. `eslint.config.js` is the named strict-`checkJs` exception because
direct TypeScript configuration under supported Node 22 would need an additional
ESLint loader. It uses Espree's bundled declarations and inspects the generated
helper export names via a runtime `createRequire` boundary; the helper bodies
remain owned by the existing core/browser compiler programs.
`playwright.config.ts` uses Playwright's existing configuration transform, with
no JS alias or additional runtime loader. Both configurations and all seven
tool implementations are enrolled in `source-policy.json`.

This is not full C1 completion. Test runners, support/fixture implementations,
observational tools and behavioral test families remain separately gated.
The frozen inventory and proposed family/runtime mapping are recorded in
[`c1-tools-evidence.json`](c1-tools-evidence.json). Later sibling test compilation
must preserve `.test.js`/`.spec.js`, explicit-file arguments and resource paths.
Before Playwright source siblings land, configure generated-JS-only discovery:
its default would otherwise discover both `.spec.ts` and `.spec.js`.
Browser-evaluation bodies need their own DOM compiler environment, not DOM
globals in the Node tool program.

### M1 read and SDK boundaries

New M1 sources enter the existing core compiler and authored-source policy through
their configured `src/core` root; no alternate program, runtime loader or handwritten
declaration facade is added. Browser helper runtime exports are unchanged.
Display entries/tool payloads and live bridge responses remain unknown until their
consumed members are narrowed. The lossy display parser is never used for native
OMP export. Existing 8 KiB cwd, 16 KiB discovery-header, 64 KiB tail and streamed
fail-closed recovery paths remain separate.

The parent explicitly authorized one bounded M1 defect correction: nonnumeric or
nonfinite raw token/reasoning operands now contribute zero instead of concatenating
strings or contaminating sums. Finite negatives/fractions remain unchanged; raw
usage still reaches the existing retry and pricing policies. Finite operands do
not guarantee finite sums, and overflow is not saturated. Persisted consumed
nonnumeric/nonfinite counters are rejected. This is not the later R1 reducer
refactor. M1 evidence records the before/after regression and review disposition.

The bundled SDK's `ProviderHeaders` permits null tombstones, while its 0.85.1
branch-summary option declaration omits null. The SDK adapter documents one narrow
call-site assertion to that actual SDK option type after inspecting the runtime
forwarding chain. The original header object and null suppression semantics are
preserved; no filtering, replacement ambient declaration or alternate SDK model
is introduced. This external declaration mismatch remains an explicit boundary.


## Native extensions, skill CLIs and Electron

`tsconfig.extensions.json` uses strict ESNext/Bundler checking and `noEmit` for
the seven native `.ts` sources under `extensions/`. Pi extension/TUI/TypeBox
contracts come from the real dependencies. Host-only OMP imports enter as
`unknown` and are narrowed at the existing use sites; the ambient host declaration
does not recreate an SDK. Compile-only negative cases live in
`test/types/extensions.ts`.

`tsconfig.edges.json` uses strict NodeNext/ES2022 compilation for six authored
sibling sources:

| Source | Checked-in runtime output |
| --- | --- |
| `skills/lib/pi-dish-client.ts` | `skills/lib/pi-dish-client.js` |
| `skills/pi-dish-{sessions,comments,pages}/scripts/pi-dish-*.ts` | Corresponding CommonJS `.js` and `.d.ts` |
| `electron/main.ts` | `electron/main.js` and `.d.ts` |
| `extensions/pi-dish-share-omp.mts` | `extensions/pi-dish-share-omp.mjs` and `.d.mts` |

The shared client also emits its `.d.ts`. Run `npm run build:core` before
`npm run build:edges` when a shared contract changes. `scripts/build-edges.js`
compiles into a temporary directory before replacing output; type errors leave
existing output intact. `--check` rejects byte/declaration drift, stale generated
outputs and incorrect modes without repairing them. CLI shebangs stay first and
their `.js` outputs remain executable. `npm run check` includes both edge drift
and native `noEmit` checking.

Installed CLI directory symlinks resolve to the generated CommonJS and its shared
client using ordinary external Node. Neither a TypeScript loader nor an installed
production package dependency is required by those scripts. Registry and HTTP
values remain unknown until the fields actually consumed are narrowed; typing
does not grant process ownership or redefine optional presentation metadata.

Electron's root package main/export stays `server.js`; only packaged metadata
uses `electron/main.js`. The explicit first-party manifest excludes authored
edge sources, declarations, maps and build/test tools while retaining native
harness `.ts` and local browser assets. `runtimeResourcePath` maps shipped
extensions, skills and direct `lib/*.js` siblings to `app.asar.unpacked`; docs,
SDK resources and application assets retain archive paths. User paths are not
passed through this resolver.

FFF additionally requires its complete native dependency tree outside ASAR.
`fffImportSpecifier(applicationRoot: string): string` keeps the bare ESM package in checkout
and reads the real unpacked package's `exports["."].import` in an `app.asar`
root. It returns a physical file URL rather than guessing an entry filename
or using CommonJS resolution for an import-only package. M3's checked `loadFff`
consumer calls this helper without duplicating ASAR detection and preserves its
lazy import cache and walker fallback. Native load acceptance requires actual
scan/search and PTY execution, not archive presence alone.
Linux results do not establish macOS package/runtime support.
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
  fields. Discovery uses the checked `session-discovery.ts` import. Recovery
  observation remains JavaScript behind an explicit typed adapter signature;
  that implementation is not claimed to be type checked.
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
- Harness contracts preserve optional legacy resume arguments; a required-file
  overload proves string-only argv without a runtime scan. Lifecycle modes and
  capability differences remain unchanged.
- Lifecycle captures are operation-specific, not reusable authorizations.
  Async preparation returns a synchronous final checker where the existing action
  requires one. Weak runtime/source advice and report DTOs cannot serve as captures.
- Launch and operation discriminants retain cleanup, stop and replacement
  uncertainty before HTTP mapping. Recovery observations cannot patch controls;
  legacy attempt fields remain unknown until their actual consumer narrows them.

`test/types/core.ts` checks the declarations through the public `lib/` imports,
including cases that must fail compilation. Runtime regressions exercise the
generated files. Preserve the existing assertions when subsequent consumers
migrate; adapt setup/imports without weakening behavioral coverage. See
[Testing](testing.md) for the full matrix and scope limitations.

The [browser framework assessment](browser-framework-assessment.md) records the
vanilla TypeScript direction and a deferred model-selector experiment.

The session/model API slice now has explicit decoded response contracts. Server
client-list projection and harness model normalization use this boundary; malformed
model identities are discarded. Metadata accumulation sanitizes malformed history
fields before catalog composition; browser ingress rejects malformed control
fields per row. Client projection only strips private fields.
Missing capabilities remain optional, and thinking acknowledgements fall back
to the validated requested level when a harness returns an unusable value.
The typed browser adapter consumes these contracts. This does not validate transcript
content, every endpoint, or lifecycle authority.

## Browser build and API adapter

`src/browser/` compiles strictly using `tsconfig.browser.json`.
`npm run build:browser` checks types, then uses the pinned esbuild dependency to
emit five local entrypoints: `public/app.js`, `public/browser.js`,
`public/helpers.js`, `public/artifact-comments.js` and `public/theme-prepaint.js`.
All entrypoints are validated before any generated output is written. The
application entrypoint bundles ordinary imports from feature modules and helpers
into an IIFE with private bindings. The production page loads `app.js` after the
local marked vendor; it does not load the independent `browser.js` or `helpers.js`
entrypoints. `index.ts` still supplies the factory bundle used by isolated tests,
and `helpers.js` retains its CommonJS compatibility surface.
Static HTML declares action names; `app-bindings.ts` validates the names and owns
their listeners, while `app.ts` supplies a complete, type-checked callback map.
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
independent factory bundle built from the same implementation used by the app.

Model, thinking, rename and enabled-model sends use `sessionApi`. Tests delay
HTTP routes or replace a feature's captured request port; they do not reassign
global app functions. `test/fixtures/browser-app.js` builds an instrumented copy
which records actual feature instances and their options. Its probe module lives
under `test/` and cannot enter the production build, whose inputs are confined to
`src/`. Production-bundle scenarios run without this instrumentation.
Browser runtime imports must remain under `src/`; vendored runtime contracts use
type-only imports to avoid bundling a second copy of their runtime state.

The model-selector DOM implementation is also strictly checked under
`src/browser/`. Its view/actions interface and ordinary DOM baseline are
[documented with a repeatable behavior and timing baseline](model-selector-baseline.md).

Edit browser implementation in `src/browser/`, preserving owner-bearing actions
and explicit cleanup. Never hand-edit the generated scripts in `public/`.
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
CRUD are owned by `new-session.ts` and `routines-view.ts`.

`src/browser/spawn-targets.ts` owns tmux payload decoding, target catalog and
choice state, selected descriptors and the run-in combobox. Every refresh clears
previous choices immediately and captures its host endpoint and sequence. Both
response and body publication require that owner; unavailable/failed reads stay
headless. Saved resume targets require an explicit matching session host. The
picker owns row/input listeners and blur cleanup, and retained rows can act only
on their current catalog. Preference access and selected-host/capability reads
remain explicit callbacks supplied by the app.

`src/browser/model-catalog.ts` owns model rows, catalog scope, enabled-model
writes and shared select markup. Request owners include the host endpoint and
request sequence. `app-models.ts` requires a session id and captures selection and
endpoint ownership; `new-session.ts` alone owns takeover generation, harness and
cwd. Pending reads retire on cwd pick/blur before the refresh debounce fires;
cwd equality guards reject stale replies while typing.
Row ownership is separate so interim cached rows remain usable for the same
host/harness/view. Peer cache reads use their own host suffix. Readonly rows and
replacement writers preserve captured persistence snapshots across later edits.

Published-page comments now have strict sources in `src/browser/artifact-comments.ts`
and `artifact-comment-data.ts`. The server injects the same standalone local
script path as before. Index/comment payloads and error text are narrowed before
use. Refresh sequences protect marks, and submitted draft generations protect
edit/delete completion. The shadow-root UI and its page-lifetime listeners remain
independent of the main app.

`src/browser/new-session-options.ts` owns launch model/thinking preferences and
select rendering plus the OMP defaults preview. Preview records narrow wire fields;
request owners capture host route/token, harness, cwd and takeover generation.
Retiring a read invalidates its config immediately but preserves layout until a
new load starts, keeping a cwd blur from moving the spawn button mid-click.

`src/browser/harness-settings-data.ts` narrows harness defaults and agent settings
at the wire boundary. `harness-settings.ts` owns editor DOM/listeners, captured
read scopes and serialized save patches. A submitted save retains its endpoint
and both patches through modal replacement, while UI completion requires the
same editor instance. Fallback models also require a matching host and harness.

`src/browser/session-spawns.ts` owns submitted operations independently of the
current pane. It snapshots request data/endpoint, narrows acceptance/status replies,
keys provisional rows by host plus wire operation id and reconciles registered
sessions against their owning host. App integration captures takeover/selection
ownership before kickoff and retains the submitted refine draft through the POST.

Shared runtime helpers live in `src/core/helper-*.ts`, with structural contracts in
`helper-types.ts`. Browser-only formatting, identity presentation, grouping, usage
and markdown/path/diff behavior remain under `src/browser/`. Browser and checked
core consumers import the actual owners; JavaScript Node consumers use narrow
generated `lib/helper-*.js` modules, not `public/helpers.js`.
`src/browser/shared-helpers.ts` preserves the 121 CommonJS/browser-global exports.
Its thin math adapter retains lazy renderer lookup; the core factory requires a
provider. The build rejects runtime imports out of the portable helper closure.
Portability is checked jointly by core NodeNext, browser Bundler/DOM with
`types: []`, and `tsconfig.helpers.json` without DOM libraries. The last probe
retains Node ambient types; it does not establish browser compatibility alone.
Atomic browser output validation and drift checks still cover all five entrypoints.

`new-session.ts` owns the new-session takeover itself, including its view
lifecycle, selected host/harness, refine draft, workspace listeners and the
configuration/discovery controllers it composes. `app.js` supplies host/session
accessors, shared model/spawn controllers and cross-view callbacks. Submitted
view guards stop owning their form on disposal as well as close/replacement.

`recovery.ts` owns recovery preferences and reports, with readonly host/report
contracts and explicit settings/report lifetimes. App callbacks supply capability
checks, fleet readiness and cross-view navigation. Host route/token changes
invalidate old requests and controls; submitted mutations retain their endpoints.

`bounce.ts` owns bulk reload/restart previews, selected snapshots, cancellation,
status polling and selected-session reconciliation. `bounce-data.ts` narrows wire
rows into readonly contracts. The app supplies host/session accessors and reload
callbacks; the controller retains endpoint/view ownership across asynchronous work.

`session-relations.ts` decodes the lineage wire rows and owns the header
family link; `subagents-view.ts` owns the takeover itself — tree pane, trace
peek (shared message renderer in peek mode), signal composer and repoll
timers. `session-search.ts` owns the whole-transcript search bar, match state
and paging navigation. The app provides transcript paging/scroll callbacks and
session/host accessors. Query results and rendered navigation controls retain
their original selection/endpoint instead of borrowing whichever session is
current later.

`skills.ts` owns the skills directory and coverage detail, using `skills-data.ts`
for unknown payload decoding. The entry host remains explicit through requests,
activation navigation and refinement setup. Rendered controls and indexing/focus
timers follow the owning view; refinement requires matching-path coverage.

`search-view.ts` owns fleet advanced-search requests, query/facet state and
result controls. `search-data.ts` decodes payloads and attaches the answering
host before merging. Input changes immediately invalidate prior responses;
result activation retains the query and endpoint that rendered its card.

`usage-view.ts` owns summary/limit request sequences, chart state, render listeners
and indexing/resize timers. `usage-data.ts` keeps unavailable costs explicit and
stamps host identity before partial merges. Render coalescers expose disposal so
closed or superseded fan-outs cannot leave a timer running.

Display preferences, themes and pointer resizing are owned by
`display-preferences.ts`, `themes.ts` and `panel-resize.ts`. The separate
`theme-prepaint.ts` entrypoint generates `public/theme-prepaint.js`; it runs
synchronously before CSS and shares the typed token decoder with theme switching.
The browser build validates all five outputs before writing any of them.

`terminal.ts` owns terminal instances and all open/connection/input lifetimes.
Pending opens are cancellable before an instance exists; font deadlines and
reconnect timers are cleared on retirement. Xterm/FitAddon imports are type-only,
and runtime assets remain the existing local vendor files.

Routine list/form/catalog/mutation/ledger lifetimes live in `routines-view.ts`,
with explicit definitions, versions and invocation decoding in `routines-data.ts`.
Form owners include host endpoints; changing views or form targets retires earlier
results. Closing preserves draft values while retiring listeners and timers.

Session statistics, process actions, sharing and published artifacts live in
`session-info.ts`, with wire narrowing in `session-info-data.ts`. Each modal
render and request retains its host/selection and independent section generation.
Message-share copies capture their owner before lookup and clipboard effects.

Transcript tree data and view/branch lifetimes live in `transcript-tree-data.ts`
and `transcript-tree.ts`. Closing a tree retires controls; reopening additionally
retires older branch completion effects. Returned editor text retains its origin.

Rich text is split across `rich-text.ts` (Markdown/final passes/copy controls),
`diagrams.ts` (source/theme render owners and lightboxes), `browser-assets.ts`
(local resource loading) and `clipboard.ts`. Vendored APIs have explicit contracts
in `rich-text-vendors.ts`; the app retains its existing local vendor paths.

Extension UI is split into typed wire requests (`extension-ui-data.ts`), host-aware
routing (`extension-ui.ts`), timed widget/status display (`extension-display.ts`)
and persistent, selection-owned dialog cards (`extension-dialogs.ts`). Stashing
preserves answers while listeners and endpoint guards retire obsolete controls.

File and diff takeovers live in `file-views.ts`, with explicit wire narrowing in
`file-view-data.ts` and escaped diff output in `file-view-render.ts`. Publication
operations, clipboard feedback and deferred patches retain independent ownership
under read-only view snapshots used by anchored-comment coordination.

Anchored comment selection, edits and marks live in `anchored-comments.ts` with
explicit file/diff targets in `anchored-comment-data.ts` and durable quote matching
in `comment-anchors.ts`. Editors and comment lists retain view owners; overlapping
refreshes, delayed selections and mutation completion effects have separate guards.

Session header orchestration lives in `session-controls.ts`: pending model/thinking
menus, rename editors, field-specific mutation ordering, serving-host preference
saves and export resource lifetimes. Existing typed selector components retain DOM
ownership. Tokenless exports navigate; authenticated exports retain captured bytes
and filenames while status feedback follows the originating selection.

Dictation lives in `composer-speech.ts`, which retains permission/take/transcription
owners and releases streams, listeners and timers on cancellation or disposal.
`composer-notes.ts` owns persistent text-only notes and their dismiss controls.

Draft/history persistence and attachment batches live in `composer-drafts.ts` and
`composer-images.ts`. Draft timers and history are composer-owned; provisional
keys migrate dirty text and in-flight images together. Retired image controls and
batches cannot modify a later composer, and bitmap/read resources are released.

Autocomplete lives in `composer-autocomplete.ts`, with explicit command/file data
in `composer-autocomplete-data.ts` and host-qualified session references in
`session-references.ts`. Query tokens capture selection, composer, text/caret and
endpoint before debounce; completion acceptance emits input for draft persistence.

Sidebar HTML projection lives in `sidebar-render.ts`. One render receives established
`SessionEntry` fields, host state and read-only preference snapshots; family grouping,
server-search authority, automation notes and host-qualified collapse stay intact.

Sidebar row interactions live in `sidebar-controls.ts`: preferences, host-qualified
family pins, close confirmation and request state, clipboard menus and pointer
listeners. The session state exposes a read-only selection generation for actions
started with no selected session. Replaced menus and disposed controls stay inert.

Sidebar query/scopes, list fan-out and activity markers live in `sidebar-query.ts`,
`sidebar-lists.ts` and `sidebar-activity.ts`. Input invalidates prior request owners
before debounce; polling and indexing timers have a shared disposal boundary.
Settings generations prevent old scope reads from overwriting newer definitions.

Message projection lives in `message-render.ts`, with wire narrowing in
`message-data.ts`, bounded identity-owned telemetry in `response-details.ts` and
idempotent DOM grouping in `message-groups.ts`. Retained detail buttons remain
usable when their host-qualified transcript is restored.

Live tool panels and coalesced assistant frames live in `live-tools.ts` and
`streaming-render.ts`. Both capture selected-session ownership; retained details
preserve user expansion. `mood.ts` owns the composer mood projection.

Transcript loading lives in `transcript.ts`, with `transcript-data.ts` narrowing
page payloads and `transcript-cache.ts` retaining bounded host/endpoint-owned DOM.
Selection retirement cancels requests before stashing without prematurely clearing
the outgoing transcript’s cursors. Replaced paging controls remain inert.

`session-activity.ts` owns turn/compaction flags, working timers and abort gates.
`btw-panel.ts` gives each ephemeral question its own response/control lifetime;
late answers, errors and clipboard feedback cannot alter a replacement question.

`composer-submit.ts` owns captured sends, commands, queued messages and aborts.
`prompt-delivery.ts` owns optimistic prompt associations and rendered queue rows;
cancellation preserves raw server text and restores the originating composer.

`message-stream.ts` owns source connections, ticket/reconnect generations and
selected-session event dispatch. Completion deduplication spans a turn, while
session-switch navigation also has an event sequence within the connection.

`session-view.ts` owns selected/provisional view transitions and their awaited
hydration. `session-resume.ts` owns picker/launch requests and `session-header.ts`
projects narrowed metadata. Retained live-tool metadata follows cached nodes and
may be adopted only by the same host/session under its new selection generation.

The final application composition lives in `app.ts`. `app-chrome.ts` owns viewport
following, focus preferences and mobile panel listeners/timers; `app-bindings.ts`
owns static control events. Startup restoration retains the selection generation
that began initialization, so a delayed list cannot replace a newer selection.
`host-view.ts` narrows discovery metadata for presentation without changing the
raw directory descriptor or copying state into another owner.
