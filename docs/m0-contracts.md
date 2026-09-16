# M0 frozen migration contracts

Baseline: `37402f03294b51eeec14f893df1f7c72331301fa`. Owner branch:
`migration/m0-contracts`. This is the M0 implementation handoff, not milestone
acceptance. The integration controller owns the acceptance ledger in
[the remaining plan](remaining-migration-plan.md). M1–M7 remain unimplemented.

## Source, output and compiler ownership

| Owner | Authored source | Runtime/declaration output | Compiler/build |
| --- | --- | --- | --- |
| Existing core, M1–M5, M7 | Flat `src/core/<name>.ts` | `lib/<name>.js`, `lib/<name>.d.ts` | `tsconfig.core.json`; `scripts/build-core.js` |
| Existing portable helpers | Only `src/core/helper-*.ts` | Same flat core outputs, browser imports bundled | Additionally `tsconfig.helpers.json` (ES2022, no DOM) |
| Existing browser | `src/browser/**/*.ts` | `public/{app,browser,helpers,artifact-comments,theme-prepaint}.js` | `tsconfig.browser.json`; `scripts/build-browser.js`, pinned esbuild |
| M7 startup owner | `src/core/server-app.ts` | `lib/server-app.js`, `lib/server-app.d.ts` | Core; never portable helpers or browser |
| M7 root exception | Authored `server.js` | None | Add to strict `tsconfig.check.json`, `allowJs/checkJs/noEmit`; not generated |
| M6b CLI/client | Sibling `.ts` at the four existing skill JS paths below | Same-path `.js` and `.d.ts` | New `tsconfig.edges.json`, rootDir `.`, NodeNext/ES2022/strict; `scripts/build-edges.js` |
| M6c desktop | `electron/main.ts` | `electron/main.js`, `electron/main.d.ts` | Same edge compiler/build |
| M6a share hook | `extensions/pi-dish-share-omp.mts` | `extensions/pi-dish-share-omp.mjs`, `.d.mts` | Same edge compiler/build; `.mts` preserves ESM default export |
| M6a native extensions | Seven existing `.ts` files listed below | **No emitted siblings** | New `tsconfig.extensions.json`: ES2022, ESNext, Bundler resolution, strict, noEmit, Node types, real SDK types |

The four skill sources/outputs are `skills/lib/pi-dish-client`,
`skills/pi-dish-sessions/scripts/pi-dish-sessions`,
`skills/pi-dish-comments/scripts/pi-dish-comments`, and
`skills/pi-dish-pages/scripts/pi-dish-pages`. The client remains dependency-free
CommonJS, loaded relative to the **real path** of the calling installed script.
No server import or runtime TS loader enters those CLIs.

Native no-emit membership is exactly `extensions/mood.ts`,
`extensions/pi-dish-bridge/{core,index,pi-private}.ts`,
`extensions/pi-dish-bridge-omp/{index,native-state}.ts`, and
`extensions/pi-dish-bridge-prime/index.ts`. M6 also includes its native host/import
fixtures in that checking program. Do not include native TS in core or edge emit.
The optional share hook is explicitly loaded through `~/.omp/agent/share.mjs`,
not discovered as another bridge.

Core is NodeNext in a CommonJS package (not global ESM). New domain modules and
`server-app` are Node-only core members; names must not start `helper-`. Existing
browser build import confinement/portable-helper checks remain authoritative.
Every M package extends `source-policy.json` when its compiler program lands.
C1 owns development scripts/tests/config conversion; C2 rejects all remaining
unclassified executable additions. M0 does not claim whole-repository coverage.

Edge emission must copy from a successful **temporary** compile only; verify all
outputs before replacing any. `--check` compares JS and declarations, executable
CLI shebangs/mode, rejects missing/stale/orphaned generated siblings by its own
banner. Preserve authored files, including the M7 root exception. Core's existing
flat-output and orphan guard already covers new core targets without changing
its implementation. Neither build may delete an unrelated JS source.

### Root executable and export contract

Until M7, root `server.js` is unchanged and retains its inventoried unchecked
bodies. Root `package.json.main`, `npm start`, `npm run dev`, tests and Node callers
continue to target it. The M7 target is:

```js
module.exports = require('./lib/server-app').startServer(__dirname);
```

`startServer(rootDirectory: string): import('node:http').Server` owns all policy,
resources, construction and side effects. Root owns none. A strict-checkJs root
plus a TS consumer must compile through the **generated** declaration and observe
`.listening`, `.address()` and `.close()`, not a Promise, Express app, type cast,
proxy or facade. Preserve the current exported server object's timing/identity;
R7, not migration, owns listener-readiness redesign. No second launcher in M0.
Resource root is the passed application root, not `lib/` or `src/core/`.

## Checked handler modules and consumed ports

[The route inventory](m0-route-contracts.json) freezes all 115 baseline main/share
registrations and upgrade registrations in source order, their line ranges,
package owner and lexically consumed outer names. It is baseline evidence, not a
runtime router generator. Lines refer only to the named baseline. Root-owned
helpers called from a domain must become checked in that domain or be supplied
through the narrow owner port below; imported JS is not implementation coverage.

Each factory returns a named interface of **individual Express 4 request handlers**
(and explicitly named non-HTTP callbacks where needed), not a router that mounts
all routes in one place. Integration mounts each handler in its old position.
Each handler receives unknown body/response-local data until its own narrowing;
use maintained Express declarations with explicit generics, not Express's default
`any` as an authored contract. Do not derive public ports from factory ReturnType.
Libraries owned by a domain are ordinary imports, not injected whole-module bags.

| Package / exact new module | Factory / named ports | Consumed non-domain inputs and ownership |
| --- | --- | --- |
| M1 `session-read-handlers.ts` | `createSessionReadHandlers`, `SessionReadPorts`, `SessionReadHandlers` | `findSessionSource(id,{exact?})`, `liveSessionHistoryPending(id)`, `getRegisteredSession(id)`, `getRPCSession(id)`, `getLiveSession(id)`, `liveTreeLeafId(session)`, `getLiveContextUsage(id)`, `getContextWindow(model)`, `getSessionModels(id)`; capture source/live identity before awaits. Export `exportSessionHtml(source,outputPath,options)` and `getOmpShareSnapshot(source)` for M3; actual implementations, not JS callbacks containing response policy. |
| M2 `routine-handlers.ts` | `createRoutineHandlers`, `RoutineHandlerPorts`, `RoutineHandlers` | Checked routine runner (`invoke`, `nextRunAt` and actual route-consumed methods), launch `validateHarnessPilotSelection`, lazy `SessionRefDependencies` below. Move `composeRoutinePrompt`, `expandRoutineCwd`, `validateRoutinePilot`, `routineStats`, `routineSummary`, `routineErrorResponse` here. Runner continues consuming lifecycle coordinator methods directly, never a second launch authority. |
| M3 `publication-handlers.ts` | `createPublicationHandlers`, `PublicationPorts`, `PublicationHandlers` | Source lookup/history-pending, catalog for session/path inference, registered/RPC observations for `canonicalKnownSessionId`, M1 export/snapshot, M5 `PublicArtifactRelay`, public base URL and app resource root. Own public share/page handlers, payloads, comment target validation/projection and stores. |
| M3 `file-handlers.ts` | `createFileHandlers`, `FileHandlerPorts`, `FileHandlers` | `resolveSessionCwd`, source/known-session lookup, root for rendered file resources. Own directory completion, file search/view/content and both diff snapshot/version checks; no lifecycle capabilities granted by cwd. |
| M4 `feature-handlers.ts` | `createFeatureHandlers`, `FeaturePorts`, `FeatureHandlers` | `buildSessionCatalog`, `enumerateSessionCandidates`, `getSessionModels`, `getLiveSession`, settings read/write, model cache get/set/context invalidation, root resource paths; M1 actual SDK/pricing/mining/index projection imports. Own usage/limits/skills/STT and harness config/agent/model/command listing response bodies plus their command runners. Session mutation/control handlers remain M7 (rename/model/thinking/command/tree/branch). |
| M5 `access-handlers.ts` | `createAccessHandlers`, `AccessPorts`, `AccessHandlers` | Immutable startup token/config; `readDishSettings()` allowed origins, host identity/label/version/capability observations. Own compression/body-parser bypass, CORS/API/ticket/host gates and WS `upgradeAuthorized`; no shared generic policy framework. |
| M5 `relay-handlers.ts` | `createRelayHandlers`, `RelayPorts`, `RelayHandlers`, `PublicArtifactRelay` | M3 artifact store port below, local page existence lookup, public base URL, M5 access callback. Own raw API proxy, JSON artifact interception, public artifact and comment relay policies, fleet descriptor mapping and peer upgrade. |
| M5 `terminal-handlers.ts` | `createTerminalHandlers`, `TerminalPorts`, `TerminalHandlers` | `upgradeAuthorized`, `getRegisteredSession`, `getRPCSession`, `findSessionFile`, `resolveSessionCwd`, `locatePiPane`; actual typed tmux `attachPaneArgv/getPrefixKey`, terminal attach/kill imports. Return claimed/unclaimed upgrade callback and shutdown callback for M7 listener wiring. |

Ports are owner-defined consumed subsets of existing `SessionSource`,
`SessionIdentity`, bridge/RPC/live-session and lifecycle contracts, not widened
copies of the whole server. Optional/null/failure outcomes retain their existing
meaning. The JSON inventory's `consumes` column also names constants, direct
imports and domain-local helpers; it is not a requirement to inject those names.
M1 owns read-only tree projection/SDK serialization; M7 owns live tree control
routing and branch actions. M4 owns command *listing* and feature executable
adapters; M7 owns command *delivery*. M1/M4 must serialize shared SDK edits.

### Registration order is part of the contract

1. Compression (1024-byte threshold; bypass stream, `/hosts/`, SSE type), then
   30 MB JSON parser with raw `/hosts/` bypass, then opt-in CORS.
2. Public static assets, `/api` auth (OPTIONS and host descriptor exemptions;
   stream-purpose tickets only for the stream shape), host descriptor/ticket.
3. `/hosts` auth before `/hosts/:name/api` byte relay. Fleet registrations and
   hosts listing remain at their current positions.
4. `/api/sessions/:id` lifecycle admission middleware remains before the session
   routes, including its current interaction with `/sessions/resolve`.
   `/sessions/resolve` must precede any generic id handler that can capture it.
5. Keep per-route parsers: HTML share import is text/html with 20 MB limit;
   STT raw parser/MIME/limits remain local. Comment fleet relay stays **before**
   local comment handlers and consumes already-parsed bodies, unlike API relay.
6. Public main-app shares/pages retain annotation; the optional share-only
   listener mounts only shares/pages plus two stylesheets, then bare 404. It
   never mounts auth, registration, API, terminal, or the application shell.
7. Upgrade dispatch tries peer terminal before local terminal, claims at most
   once, destroys unclaimed sockets, and attaches to every owned listener.
8. Recovery completes before routine reconciliation/scheduling. Preserve close
   hooks, signal exit codes, SSH cleanup, bounce shutdown and terminal flag gates.

Domain owners submit deletion patches for baseline bodies with their checked
implementation. Only the integration owner applies root patches, one family at a
time. Do not leave duplicate response policy or implement all of M7 to unblock a
worker. Any changed cross-package port returns to the controller before use.

## M1 projection/SDK contract shared with M2, M3 and M4

No universal event schema. External JSON entries, tool arguments/results and SDK
extension details remain unknown until consumed. Reuse `SessionEntries` (including
its `firstEntryOnFirstLine` marker), `SessionSource`, `SessionInfo`,
`SearchProjection`, `SkillActivation`, `SkillState` and `SkillProjection` from the
existing core owners. M1a closes `IndexedUsage` in `session-index-data.ts`; that
file and index caller cutover have one M1a editor. M1b owns pricing/mining, M1c
owns all `pi-sdk`, `omp-export` and refs implementation edits. M4 consumes, not
redefines, their fields.

| Boundary | Fields / result | Preserved semantics |
| --- | --- | --- |
| Display transcript | Message id/role/content/timestamp, optional provider/model/responseModel, sanitized usage and response duration/output tokens; HTTP adds index and resource URL | Active branch (explicit live OMP leaf when available); readonly borrowed cache values. HTTP projection copies rather than mutating cache; live SSE images remain inline. |
| Image resources | Stable entry id + block index -> block bytes/MIME or missing | Whole-tree lookup, not active-branch position; legacy positional fallback only where already supported. OMP blob refs resolved through descriptor blobsPath. |
| Metadata | Existing `SessionInfo` and source/profile identity | Whole file; physical first-line header provenance, copy on `getSessionInfo`, model/context overlay at read time, not baked into cache. |
| Stats | tokens `{input,output,cacheRead,cacheWrite}`, `reasoningTokens`, cost/costs/costUnavailable, responseTiming `{measured,medianMs,slowestMs}`, user/assistant/tool/compaction counts, genMs/genOutput | Whole file, abandoned branches count. Assistant retries count differently from indexed usage. Known-cost subtotals retained; missing cost is not authoritative zero. |
| Indexed usage | total/days/models/cwd/state; state `{provider:string|null,model:string}`. Bucket tokens additionally include reasoning; costs and unavailable counters use input/output/cacheRead/cacheWrite/total; calls/measured/durationMs/slowestMs. Model buckets add provider/model/days. Day/model buckets historically permit absent zero-valued fields. | Local-day keys or `unknown`, responseModel billing, empty failed retries excluded, absent continuity readable but not incrementally extendable. `extendIndexedUsageFromEntries` mutates and returns the same usage. Persisted decoder must still reject malformed consumed fields. |
| Search | `{text,tree,leafId}` | Active branch; lowercased bounded text; append requires tree/leaf continuity. No extra corpus pass. |
| Skills | `SkillProjection` records/state; record skill/file/kind/ranges/truncatedTo?/ts/sessionId/entryId/cwd/model | Whole-file evidence, same existing fidelity/cross-batch limitations. M4 coverage is an estimate, not proof a skill was followed. |

Keep metadata/search/usage/skills derived from the existing shared parse. Retain
mtime+size+pricing revision invalidation, bounded LRUs, append-chain/schema
checks, warm no-parse paths and yielding index work. Cwd reads stay 8 KiB,
discovery headers 16 KiB, tails 64 KiB; recovery remains separately streamed,
fail-closed and non-replaying. Display parser tolerates malformed lines and may
elide large compaction archives; native OMP export must consume **raw** JSONL.

M1c freezes `SessionRefDependencies`: `selfHostId: string`,
`resolveLocal(id: string, exactOnly: boolean)` returns a nullable readonly consumed
session summary (`name`, `cwd`, `isActive`), and `fleetNames(): readonly string[]`.
`expandSessionRefs(message, hints: unknown, deps): string` remains lazy: no tokens
means neither catalog nor fleet is consulted. Hints are not remote authority.
M2 prompt input appending and all M7 prompt/steer/follow-up callers consume it.

M1c retains dynamic ESM `getSDK()` loading and actual bundled declarations;
`getAvailableModels`, `getPricingModels`, `getCommands`, `renameSession`,
`switchModel`, `getSessionTree`, `branchSession`, `exportSessionHtml` remain owned
by this mixed SDK module. Do not erase write/model/settings callers during a
read migration. `exportSessionHtml(sessionPath, outputPath, profileId='pi-v3',
{shareSnapshot}?)` routes OMP to its native exporter. The handler-level wrapper
accepts `SessionSource` plus `{shareSnapshot?, snapshotResolved?}` and awaits the
live snapshot only when not already resolved. M3 consumes this checked function,
not a second exporter. Preserve output-path result/failures and temp-file cleanup;
no invented native offline capabilities. Pricing refresh stays nonblocking.

## M3 artifact / M5 transport handshake

M3 owns `fleet-artifacts.ts` and its records; M5 owns `remote-hosts.ts` and name
validation. Preserve `isValidRemoteName(unknown): value is string` with
`^[a-z0-9][a-z0-9-]{0,31}$`; no host-id/name interchange. Artifact tokens are
base64url 1–128 characters. `ArtifactKind` is `share | page`.

`FleetArtifactRecord` has `host: string`, `kind: ArtifactKind`,
`createdAt: number | null` (malformed persisted timestamps normalize to null).
The M3-owned `FleetArtifactStore` consumed by relay has `get(token)` -> nullable
record; `record(token,host,kind)` -> nullable record; `remove(token,host?)` ->
boolean; `listByHost()` -> host-keyed arrays of `{token,kind,createdAt}`;
`isValidToken`/`isValidKind` guards. Inputs at untrusted boundaries stay unknown.
Existing record remaps preserve createdAt, list ordering is newest-first, and
remove with a host cannot revoke another valid host's mapping. A mapping grants
reachability, not authority. No shared mutable singleton beyond existing store
ownership. HOME resolution/re-read/temp-rename semantics remain `dish-store`'s.

M5-owned `Remote` is `{name,kind:'direct',origin,token:string|null}` or
`{name,kind:'ssh',sshDest,remoteHost,remotePort,token:string|null}`. Direct origin
strips URL path; invalid entries disappear, first duplicate name wins, SSH defaults
remain loopback:3333. `request(remoteOrName, {method?,path?,headers?,upgrade?})`
returns `Promise<http.ClientRequest>`: caller owns write/end/response/upgrade/error,
not buffered JSON. `probe` yields reachable descriptor or unreachable short error
with `at`; descriptor hostId is required, label/version nullable, capabilities
contain exact-true values. `reachability` is cached-only (adds `until`),
`noteTransportFailure` advances existing backoff; state stays HOME-qualified.

`PublicArtifactRelay.serve(req,res,kind,{annotate?})` is M3's only remote fallback
when no local token exists. Local-first never changes. M5 owns its separate
public-header allowlist, first-response deadline, mapping prune on peer 404,
annotation behavior and JSON interception limits. Comment relay consults local
page existence first and is authenticated/parsed JSON; raw API relay bypasses
parsers. Peer credentials replace hub credentials; WS preserves required upgrade
framing and strips the caller's bearer. Do not combine these policies in M0/M5;
R5 owns any later mechanics sharing.

Publication semantics: pages point to live files/directories and reuse token per
resolved root; session shares refer to sessions, imported HTML shares are immutable
snapshots. Preserve idempotence, import rollback, revoke HTML/cache cleanup,
missing-vs-null metadata, path containment/symlink checks and response DTOs separate
from persisted records. Comments distinguish file/diff/page targets, reads never
acknowledge, acknowledged comments cannot be edited/deleted. File/diff endpoints
retain caps, ignored/binary behavior, both version comparisons and stale 409.

## Dependencies and authored-source policy

Direct pinned **development** declarations now own Express **4.17.25** (runtime
4.22.1), compression **1.8.1** (runtime 1.8.1), ws **8.18.1** (runtime 8.21.0),
Node **22.20.2**, Pi TUI **0.85.1**, and TypeBox **1.3.7**. SDK runtime lock is
`@earendil-works/pi-coding-agent@0.85.1`; its real CustomEditor/ExtensionAPI
exports are the authority. TUI/TypeBox pins must move with that SDK's lock.
Electron **33.4.11**, node-pty **1.1.0**, and the SDK supply their own declarations;
no local ambient replacements. `skipLibCheck` skips third-party declaration
internals, not authored implementation coverage. Native extension runtime imports
remain external/host-loaded; dev declaration pins do not bundle another SDK.

The only planned unresolved-host declaration is the exact literal
`@oh-my-pi/pi-coding-agent` import in M6a's native state adapter, exposing an
**unknown** module value. M6a must narrow existing constructor/member checks;
no invented method/class signatures and no alternate-host-to-Pi API cast. This is
not needed or introduced in M0. Type-utility `any` exceptions currently: **none**.

`npm run check` now starts `check:source-policy`. The gate uses pinned TypeScript
**7.0.2** native parser (`typescript/unstable/sync` + AST/scanner), not espree for
TS or a whole-file regex. `source-policy.json` governs both source trees,
checked `lib/cron.js` and 47 exact named negative fixtures: **196 files** now.
Every executable addition beneath those source roots must belong to a configured
compiler program; missing and parse-invalid sources fail. Explicit AnyKeyword and
JSDoc wildcard types fail, as do comment `@ts-ignore`/`@ts-nocheck` and product
`@ts-expect-error`. Strings/regex/template text are not directives; comments inside
template expressions/empty blocks still are. Named fixtures require an inline
diagnostic purpose; strict tsc separately rejects unused expect-error directives.
The two parser regressions intentionally construct temporary violating inputs.

Seven native extensions (including pre-existing broad any), the remaining product
JS inventory and C1 tooling are **pending**, not silently accepted exceptions or
claimed checked by this gate. M6a must remove broad extension any with real SDK
types or consumed unknown narrowing and enroll all native files. Every later
package enrolls its compiler-owned source/program and names any justified fixture;
new product any/ignore/nocheck escapes are not a migration technique.

## Installer and Electron package contract

Installer remains shell. Pi gets `pi-dish-bridge`; OMP gets
`pi-dish-bridge-omp`; Prime gets both its wrapper and the stock shared-core sibling.
Prime's stock bridge stands down; wrapper token adoption/duplicate-load sentinel
ensures exactly one bridge. Preserve `.js` imports resolving native TS, OMP's
literal rewritten import/top-level await, and installed realpath behavior.
All directories with SKILL.md link only into Pi/OMP; `skills/lib` is not a skill.
Non-symlink destinations are refused, repeated links are idempotent. Mood/share
remain opt-in, not newly auto-installed by M0. M6's emitted share-hook authoring
source is never a second discovery entrypoint.

Root package main stays `server.js`. **M6c package-only** `build.extraMetadata.main`
will be `electron/main.js`; `electron:dev` keeps that entrypoint. The frozen
[M6c runtime manifest](m0-runtime-manifest.json) is a target contract, not active
builder configuration. It includes first-party runtime resources absent at baseline,
excludes edge TS authoring/config/tests/maps/declarations, and keeps only the seven
host-loaded extension TS sources. Electron security settings/external-link behavior
are unchanged. No harnesses, user skills links, credentials or HOME content ship.

External Node/Bun/harness processes cannot read Electron's virtual ASAR paths.
M6c must unpack extension and skill trees plus `lib/*.js` (the bridge imports
`../../lib/session-recovery.js`), preserve sibling layout, and hand
external consumers their real `app.asar.unpacked` paths. In-app docs may remain in
ASAR. Native `.node` and FFF `.so` resources must be unpacked and actually loaded.
M6c owns the small Node-only `src/core/runtime-resources.ts` ->
`lib/runtime-resources.{js,d.ts}` resolver with
`runtimeResourcePath(applicationRoot: string, relativePath: string): string`;
only known extension/skill resource consumers use it. In a checkout it returns the
application-root path; in a packaged app it selects the explicit unpacked sibling
for those external resources. Do not use it for arbitrary user paths or SDK data.
The integration owner serializes its harness descriptor/root consumer edits.

### Reproduced baseline defects (not desktop acceptance)

A real Linux directory package was built with the unmodified build configuration,
then started under Xvfb with clean HOME, isolated tmux path and no credentials.
The archive contains `electron/main.js` but package main is **server.js**. HTTP
`/api/host` succeeds; CDP `/json/list` returns **[]**: reproduced desktop-launch
defect, not a window-startup success. The archive has no first-party extensions,
skills or docs. `/api/agent-docs` returns `{topics:[]}`; requesting `sessions`
returns 404. Missing extension/skill files are observed archive omissions, not a
claim an actual harness launch was attempted from the archive.

`/api/skills` returns 500 with `The requested module 'node:fs' does not provide an
export named 'globSync'`. Electron 33.4.11 embeds Node **20.18.3**, older than the
SDK/server minimum. M6c must select a compatible Electron runtime (embedded Node
at least the declared 22.19.0 minimum), update its real declarations/lock together,
and exercise SDK-backed features. Do not suppress this import error or invent a
fallback SDK. Merely correcting package main will not resolve it. Native pty's
unpacked binary is present; presence is **not** successful PTY execution proof.

### Remaining M6c acceptance obligations

Implement source conversion, edge drift/check commands and actual runtime manifest;
prove the resulting archive exclusions, unpacked extension/skill/native paths and
package-only entrypoint. Start actual dev **and** packaged desktop windows; inspect
window/server readiness and security preferences; exercise local assets, SDK
features, PTY/native FFF and external harness resource paths with isolated fixtures.
Keep actual installed-link CLI/native-loader canaries. Linux evidence cannot claim
macOS acceptance. The M0 disposable compiler probes do not waive these gates.

## Completed M0 checks and disposable probes

[The durable evidence record](m0-evidence.json) separates actual commands/results,
runtime versions, disposable compiler/export probes, baseline defects and remaining
M6c obligations. `npm ci` and `npm run check` passed; full backend suite passed
998/998 with zero skips. After clean dependency installation, the focused
policy/build/installer/listener/terminal checkpoint passed 31/31. A real temporary
explicit-any source made **npm run check exit 1**, then was removed.
The flat core/root export, edge CommonJS and `.mts` ESM mappings were compiled
and their disposable emitted consumers executed. The native-extension compiler
probe used real SDK/TUI/TypeBox declarations, not facsimiles.
Actual root executable served host/docs/assets; a separate require consumer
observed listening/address/close. Installed-link CLI smoke records its actual
success/error behavior, not invented help support. No production UI/runtime
behavior changed, and no later milestone acceptance is inferred.

## Deletion/move ledger and worker release

M0 moves/deletes **no production implementation**, changes no wire/store format,
and introduces no runtime shim. Additions are the parser policy gate, its focused
regressions, declaration pins and frozen evidence/contracts. Later M1–M6 library
moves replace the original JS with generated JS at the same path (not algorithm
deletions). Handler moves delete old response bodies only when the integration
owner mounts the checked replacement. R simplification deletion claims stay separate.

Proposed independent ownership after the controller's M0 acceptance: M1a parser/
index (sole `session-index-data`/index editor), M1b pricing/mining, M1c SDK/export/
refs (sole SDK editor); M2 cron/store/provenance; M3 stores/files; M5 transport/PTY;
M6a extensions, M6b CLI, M6c Electron/build integration; M4 agent/STT. M2 prompt
integration waits for M1c; M4 usage/skills waits for M1a/b/c; M3 export/remote waits
for M1c/M5. Parent alone serializes `server.js` and shared build configuration,
then releases M7. No later milestone is started or accepted by this record.
