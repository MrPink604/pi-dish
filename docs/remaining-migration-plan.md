# Remaining TypeScript migration and simplifying refactors

Status: **M0, M1 and M5 accepted; M2, M3, M4 and M6 remain in progress**.
Baseline: `c46e7c5798d6a678dbb2a5f13ac2603f7f2a9952` (2026-09-15).
This is the forward plan after the delivered browser, catalog, composition,
contract, shared-helper and lifecycle stages. Their implementation records remain
historical evidence; this document does not reopen those stages by default.

## Mission and sequencing

Finish the implementations and compiler boundaries that still need migration,
then perform explicit simplifying refactors on the checked application. Moving a
function, introducing a type, shortening `server.js`, or replacing JavaScript with
TypeScript is not by itself a simplification result.

The remaining work has three separately accepted phases:

1. **Migration:** actual product implementations and their consumers become
   checked, with preserved behavior and supported runtime entrypoints.
2. **Simplification:** remove identified competing responsibilities, unnecessary
   indirection and cross-domain coupling in the now-checked application, including
   the already-TypeScript browser. This is committed scope, not optional cleanup.
3. **Repository closure:** finish tests/tooling, make coverage and exceptions
   enforceable, and prove delivery/build consistency across the supported surfaces.

Migration packages may remove adapters made obsolete by their own cutover, but
must not silently redesign operation policy or user workflows. The larger
simplifying refactors have their own contracts, deletion ledgers and behavior
checks. Test/tooling source conversion does not block the product refactor phase;
it does block claiming the repository migration is finished.

## Current position and measurement

The baseline has 155 authored product TypeScript files (1,632,779 bytes) and 30
product JavaScript files (549,637 bytes). Browser source accounts for 106 of those
TS files; core for 42; harness extensions for seven. Extensions are not included
in the main strict compiler programs merely because their filenames end in `.ts`.
The backend subset (`src/core/`, authored `lib/`, `server.js`) is 49.5% TS by
source bytes. Product source is 74.8% TS by bytes; neither is an effort estimate.

These figures count tracked JS/TS product sources, excluding generated outputs,
vendor files, historical documentation, tests and development tooling. The
GitHub language bar counts generated JavaScript and substantial JS test/tooling
source; it is not a migration acceptance gate. Keep four separate measures:
authored implementation inventory; compiler-program coverage; removed competing
owners/paths; and verified delivery. Do not claim a performance or complexity
improvement from source size alone.

The baseline passed strict/drift checks, 996 backend tests, 286 browser cases,
eight isolated UI scenarios, full desktop/mobile smoke, and real OMP/Prime
canaries. [All five CI jobs passed on the baseline commit](https://github.com/MrPink604/pi-dish/actions/runs/34963611465).
Those counts describe the starting point, not a required permanent test count or
verification of the future work below.

## Invariants and scope limits

- Preserve native/route/host identity distinctions and captured asynchronous
  ownership. A cache, catalog row, relationship hint, type brand or read snapshot
  never becomes permission to control a process.
- Preserve capability gates, launch-token/process-birth/registry proofs and final
  action-time revalidation. Do not flatten distinct lifecycle conflicts,
  quarantines or uncertain outcomes into a generic operation lock.
- Preserve API, store, JSONL and harness wire compatibility, including absent,
  null, malformed, fallback and partial-result behavior. First-party consumed
  fields are closed contracts; opaque external payloads remain unknown until
  consumed. No universal schema for every harness/tool/extension event.
- Preserve bounded/incremental reads, cache invalidation, retained transcript DOM,
  streaming coalescing and pagination. Record meaningful I/O/allocation effects
  before claiming a reduction; do not replace bounded paths with whole-corpus
  normalization.
- Keep local browser assets, existing deployment entrypoints and native loader
  behavior. A new compiler target is not permission to adopt ESM, add a production
  TS loader, change the Node minimum, or redesign packaging silently.
- Reuse existing state writers, domain owners and `dish-store`. No universal
  repository/service framework, catch-all capability bag, global event bus or
  framework adoption. No `any`/`@ts-nocheck`/unchecked handwritten declaration
  workaround to make implementation coverage appear complete.
- Named interfaces belong to the owner of a boundary. Newly introduced or
  renegotiated public ports must not derive from a concrete factory's `ReturnType`.
  R9 removes the specified existing hub-controller coupling; untouched legacy
  factory-derived ports are not silently claimed eliminated. No compatibility
  alias chains or type-only facade asserting an unchecked implementation is safe.
- Preserve unrelated local work and isolate tests from live sessions, credentials,
  user HOME, sockets and tmux servers.

## Package and review contract

Every package below is an implementation/review unit, not a promised single
commit. Before edits, its owner freezes the consumed-field/behavior matrix,
source and caller inventory, target owner, dependency edges and relevant smoke
fixtures. Contract changes return to the integration owner before concurrent
workers proceed. Producers and consumers that cannot coexist safely ship together.

Each completion record must contain:

1. Actual source and consumer cutover, compiler program and runtime output paths.
2. Removed implementation/adapters/state owners; distinguish moves from deletions.
3. Preserved edge cases and any separately approved policy change.
4. Focused behavior evidence plus applicable integration/runtime gates.
5. Explicit remaining unchecked or opaque boundaries, with no hidden new exception.

For simplification packages, also compare the contributor path for one concrete
change before and after: who owns the state/transition, which independently
maintained interpretations disappeared, and whether a new facade merely hid the
same coupling. File/line-count reductions are supporting inventory, not acceptance.

The integration lead maintains the implementation ledger in this document under
one `Implementation record — <package ID>` subsection per completed M/R/C package
(including separately landed subpackages). Each record names source commit(s),
owner, actual checks/runtime versions/skips, removed owners/paths, retained
boundaries and exact CI/review links. The package author supplies the evidence;
an independent reviewer checks the ledger against code and behavior, and the
integration lead records acceptance and updates BACKLOG. If a package needs its
own substantial design record, link it from that subsection rather than creating
an untracked parallel clearance list. Planning critique alone never accepts a
future implementation package.

## Complete remaining ownership inventory

The following assignment covers all 30 authored product JS files at the baseline.
Generated `lib` files are excluded. Server ranges below identify the baseline
seams; they are not permanent line-number contracts.

| Package | Authored implementations and associated consumers |
| --- | --- |
| M1 Read/SDK/projections | `lib/session-files.js`, `pi-sdk.js`, `omp-export.js`, `session-refs.js`, `harness-pricing.js`, `skill-mining.js`; typed index/metadata consumers and session read/export/tree/usage response production |
| M2 Automation | `lib/cron.js`, `routines.js`, `routine-runner.js`, `session-provenance.js`; routine HTTP/prompt/ledger composition and catalog provenance |
| M3 Publication/files | `lib/pages.js`, `shares.js`, `comments.js`, `fleet-artifacts.js`, `file-search.js`, `file-mention.js`, `file-page.js`, `git-diff.js`; publication/comment/file/diff routes |
| M4 Feature projections/integrations | `lib/skills.js`, `harness-agents.js`, `stt.js`; server usage aggregation, skill coverage/refinement and harness settings/command/model adapters |
| M5 Transport/terminal | `lib/remote-hosts.js`, `terminal.js`; HTTP access/tickets/CORS, fleet HTTP/public/WS relay and PTY attachment |
| M6 Runtime edges | `skills/lib/pi-dish-client.js`, the sessions/comments/pages skill CLIs, `electron/main.js`, `extensions/pi-dish-share-omp.mjs`; all seven existing extension TS implementations also enter strict checking |
| M7 Server completion | Remaining `server.js` implementation, including route mounting, session controls, SSE projection/replay, configuration/utilities and startup/shutdown |

M1 owns the shared Pi SDK, pricing and skill-mining implementation edits; M4 owns
their feature aggregation/HTTP consumers. M2 owns provenance. M3 owns artifact
records; M5 owns transport/auth policy. The M7 integration owner serializes edits
to shared server composition. No package claims a consumer is checked merely
because it imports a typed dependency.

Before M7, domain HTTP/response bodies move into flat checked core modules:
M1 session-read/export handlers, M2 routine handlers, M3 publication/file handlers,
M4 feature handlers and M5 access/relay/terminal handlers. M0 freezes their exact
module names and consumed ports; they are not a second framework or composition
layer. Each domain worker owns its new module plus the deletion patch for the old
body. Only the M7 integration owner applies the `server.js` patch, replacing the
old handler body with registration of that domain's checked handler at the same
middleware/order position. The interim JS root wires existing owners and mounts
routes; it must not retain a duplicate implementation or add a policy adapter.
Unchecked remaining root bodies stay explicitly assigned to M7. Thus domain
source can proceed concurrently, while shared-root edits are deliberately serial.

## Phase M — Finish product implementation migration

### M0 — Freeze delivery, contracts and coverage inventory

**Owner:** integration lead. **Dependency:** none. This is a prerequisite gate,
not a prolonged architecture-design phase.

Freeze the existing launch/export/resource-resolution contracts before source
moves. `server.js` is both the executable and a CommonJS export consumed by
Electron/tests (`.listening`, `.address()`, `.close()`); preserve that contract.
Keep the flat `src/core/* -> lib/*` compiler convention. The planned server target
is a checked `src/core/server-app.ts` implementation plus a minimal authored
root `server.js` CommonJS launcher. **Decision:** retain that launcher as an
explicit strict-`checkJs` entrypoint exception, not an unspecified generated
artifact. This is the **M7 target state**: it invokes the checked startup owner,
passes the root directory and exports the existing server object, owning no
configuration, route, state or lifecycle policy. M0 freezes that mapping,
future check-program membership and export fixture contract; M7 performs the
real root cutover and proves the generated-declaration consumer contract.
Until then the existing root retains the explicitly inventoried pending bodies.
M0 does not require a premature whole-server conversion or a second launcher.
Extend drift/orphan checks to new emitted targets, not this authored launcher.

**Edge layout decision:** author skill and Electron TS beside their current
entrypoints and emit JS to the existing installed paths; extensions retain native
loading. Every emitted sibling has a source/output mapping and check-before-write
drift rule. Installed symlinks continue to resolve real paths, but harness
discovery must load exactly one designated entrypoint, not both a new source and
its output. The installer inventory and duplicate-load smoke enforce that.

For Electron, use an explicit runtime file manifest: exclude skill/Electron TS
authoring files, configs, tests and maps from the packaged archive; include native
extension TS only where the host actually loads it. Inspect the produced archive
and unpacked native resources, not just the glob declarations. M6c defines the
supported resource contract and exercises it.

Freeze per-target compiler/build mappings before workers edit. Keep native
extensions out of the core CommonJS emission. Prefer existing TypeScript/esbuild
tooling; no runtime loader or global ESM conversion. Pin maintained major-matched
`@types/express` **4**, `@types/compression` and `@types/ws` compatible with the
installed packages; do not hand-write replacements for those maintained APIs.
Use actual bundled node-pty/Electron/SDK declarations. Only a genuinely
unrepresented consumed surface may receive a narrow, documented residual type
boundary; M6a specifies the special opaque host-import case.

The source/output map also names compiler membership per target. Node-only
`server-app.ts` and domain handler modules belong to `tsconfig.core.json`, not
the `tsconfig.helpers.json` portable `helper-*` subset. Browser bundles may not
import those Node implementations. Update the migration guide/build ownership
documentation when these targets land, rather than waiting for C2.

Record compiler-owned sources, outputs and narrowly justified exceptions.
Capture the relevant response/store/projection matrices and current API ordering
before parallel work. M1 contracts must distinguish transcript, resources,
metadata, stats, usage, search and skills instead of inventing one event schema.

M0 also introduces a compiler-parser-backed coverage/policy gate using the pinned
TypeScript toolchain, not an espree/regex scan of TS. For migrated first-party
implementation paths it rejects explicit `any`, `@ts-ignore` and `@ts-nocheck`;
pre-existing broad extension `any` must become actual SDK types or `unknown` plus
consumed-member narrowing. Third-party declarations are outside that authored-
source rule. Any necessary type-utility exception must be named by path/symbol,
justified and reviewed; it may not mask an unchecked implementation or host API.
Intentional `@ts-expect-error` negatives are confined to identified type fixtures
with their diagnostic purpose. Wire the gate into `npm run check` and prove it
rejects a temporary violating input. Extend the governed source set with every M/R/C
package. Strict `tsc` alone is not represented as enforcing this policy.

**Acceptance:** agreed source/output/program map, baseline executable/export/
installer smoke, and disposable compiler/export probes for proposed mappings;
clean-checkout startup is not broken. No new policy-bearing JS shim is introduced.
The final policy-free root/checkJs acceptance belongs to M7, not M0. Existing
build/installer/listener/terminal suites are the initial gates; a successful build
alone is not acceptance.

M0 owner handoff (acceptance remains with the integration lead):
[frozen compiler/port/semantics contracts](m0-contracts.md),
[baseline route-order inventory](m0-route-contracts.json), and
[M6c target runtime manifest](m0-runtime-manifest.json).
The implemented authored-source policy runs before lint/types in `npm run check`.
These contracts do not claim later compiler targets or a working packaged desktop;
the handoff distinguishes reproduced package defects from completed M0 probes.

### M1 — Session reads, SDK adapters and index projections

**Depends on:** M0. **Slices:** M1a parser/contracts; M1b pricing/mining; M1c
SDK/export/references. One SDK editor and one index-integration owner.

Migrate all six M1 implementations, not declarations over JS. Reuse existing
source/metadata/skill contracts. Close the usage bucket structures actually
consumed by the index and aggregation. Replace handwritten local implementation
signatures with actual typed imports when their producers are ready; preserve
disk/wire ingress validation. Move associated response production into checked
owners; identify any remaining JS route mounting explicitly until M7.

Preserve these different semantics:

- Active-branch transcript/search versus whole-tree stable-ID image lookup.
- Whole-file metadata/stats/usage/skill evidence, including different retry/count
  rules; local-day grouping, missing cost versus authoritative zero, known-cost
  subtotals, response-model billing and pricing revision invalidation.
- Physical-first-line framing, malformed display-line tolerance and archive
  elision; raw native OMP export must not pass through that lossy display parser.
- One parse already shared by index projections, append-chain/version checks,
  bounded LRUs, warm no-parse paths and yielding background work.
- Separate 8 KiB cwd, 16 KiB discovery header, 64 KiB tail and fail-closed streamed
  recovery reads. Recovery retains its existing limits and no-replay policy.
- Dynamic ESM SDK loading, private/native tree capabilities, write/model/settings
  callers of the mixed SDK module, export temporary-file cleanup and lazy
  reference expansion. Native offline capabilities must not be invented.

**Acceptance:** actual implementations and listed index/projection consumers
checked; the consumed-field matrix agrees with existing API/store outputs;
malformed persisted snapshots remain rejectable; no new full-file/header/recovery
reads or extra mandatory projection pass. Pricing refresh remains optional and
nonblocking for transcript loading.

**Gates:** `test/session-files.test.js`, `session-index.test.js`,
`harness-pricing.test.js`, `skill-mining.test.js`, `session-refs.test.js`,
`omp-export.test.js`, source/recovery and server pagination/image/tree/usage
cases; relevant transcript/search/usage/skills browser scenarios and isolated
real read/export execution.

### M2 — Routine definitions, admission, scheduling and provenance

**Depends on:** M0; M1's reference/SDK contracts before integrating routine prompt
construction. Provenance and cron/store slices can start independently.

Migrate the four M2 libraries and routine prompt/HTTP/summary composition.
`cron.js` is already checked JS but still needs source migration. Keep the
existing lifecycle coordinator as the only launch/resume/close authority.
Definitions, invocation history and scheduling have separate lifetimes; deleting
a definition does not delete its ledger. Persisted provenance remains advisory.

**Acceptance:** checked definitions/invocations and transitions, canonical alias
handling, schedule/timezone behavior, prompt-version/input behavior and existing
restart reconciliation. Recovery finishes before reconciliation/scheduling.
Preserve run-once recovery, busy/live/restored/uncertain distinctions, queued
timeout handling and the current close/detach rules. No generic job engine.

**Gates:** cron, routine, routine API and provenance suites; browser routine
scenarios; isolated schedule/run/restart/reconciliation smoke.

### M3 — Publication, comments, file views and diff snapshots

**Depends on:** M0; M1 export/read contracts and M5's remote-host naming contract
for integration. Stores, file search and diff implementations can start in parallel.

Migrate all eight M3 libraries and their response production. Keep persisted
records separate from response DTOs. Model session/HTML shares and
file/diff/page-comment targets distinctly. Reuse `dish-store` without imposing
one universal store API. Preserve lazy native FFF loading and fallback walking.

**Acceptance:** live page references versus immutable share snapshots remain
distinct; registration idempotence, rollback/revoke cleanup, local-first lookup,
host-scoped unmapping, acknowledged-comment immutability and read-only reads
remain intact. File previews/resources are inert for raw HTML/SVG, keep reach
rules/caps, and retain both diff-version checks and stale-409 behavior.

**Gates:** server publication/comments/file/diff cases, `fleet-artifacts.test.js`,
`file-mention.test.js`, `git-diff.test.js`, comments CLI, browser file/comment/
artifact/session-info scenarios and standalone local-page smoke.

### M4 — Usage, skills and external feature integrations

**Depends on:** M0; M1's parsed/mined/usage/SDK contracts. Harness-agent and STT
subtasks are independently runnable. Do not give M4 a second pricing/mining owner.

Migrate `skills`, `harness-agents`, `stt` and actual server feature aggregation:
usage/limits, skills catalog/coverage/refinement, settings/model/command results.
Keep SDK-owned skill discovery, estimated coverage/cost semantics and consumed
opaque fields honest. Preserve project > user > bundled agent precedence and
scan/temp-directory bounds. STT credentials remain server-side.

**Acceptance:** checked producer-to-response paths, malformed-input handling and
partial/unknown-cost semantics; no typed wrapper around a JS aggregation body.
Preserve mtime exclusions, the existing cross-batch mining fidelity limitation,
MIME/raw-body validation, multipart uploads, timeout classification and command
execution cwd/argument behavior. Do not merge interactive/pricing command runners
whose timeout and launch semantics differ.

**Gates:** skills/mining/index/pricing, OMP web-pilot, STT and server feature suites;
usage/skills/settings/speech browser scenarios and isolated executable adapters.

### M5 — HTTP/fleet policy and terminal transport

**Depends on:** M0. Coordinate M3 artifact records; transport and PTY slices can
run independently. Source conversion preserves policy; R5 handles shared mechanics.

Migrate `remote-hosts`, `terminal` and the corresponding access/proxy/attachment
implementations. Use explicit direct/SSH/probe and PTY/client-frame contracts.
Preserve credential replacement/stripping, HOME-qualified configuration, forward
reuse/backoff, bounded terminal replay, output-aware idle kill and restart socket
continuity.

**Acceptance:** checked implementations of auth/tickets/CORS and three distinct
API/public-artifact/comment relay policies; raw streaming/body-parser bypass,
first-response deadlines, public-header restrictions, token mappings and WS
handshakes stay compatible. A proxy observation must not widen local authority.

**Gates:** host-auth, remote-hosts, fleet-artifacts and terminal suites; actual
isolated HTTP/SSE/WS/direct/SSH and PTY smoke; host/terminal browser ownership cases.

### M6 — Extensions, skill CLIs and Electron compiler boundaries

**Depends on:** M0; M1 SDK/refs contracts as consumed. Three parallel ownership
slices, with one compiler/package integration owner.

**M6a Extensions:** strict checking of all bridge core/wrapper/private/native
files, mood and the share hook. Use actual Pi SDK types. Alternate host-only
capabilities remain explicitly narrowed; no ambient SDK facsimile or broad `any`
pretending to check OMP internals. Preserve the literal host-rewritten OMP import,
top-level await, `.js`-to-TS native loading, Prime sibling symlinks, duplicate-load
sentinel/token adoption, capability degradation and switch/queue retirement.
Make mood's SDK/TUI/typebox dependency ownership explicit without bundling a
second host SDK. Add real mood/share-hook smoke because current direct coverage
is absent.

**Mood type-source decision:** use the installed Pi SDK's real `CustomEditor`
declaration, and pin direct **dev-only** `@earendil-works/pi-tui` and `typebox`
declaration providers to the versions matching that SDK lock (baseline 0.85.1
and 1.3.7). Do not depend on accidental transitive hoisting. Record resolution
in M0's extension compiler map and update those pins together with the SDK.
The TUI value APIs and TypeBox schema calls are checked against their real types;
the opaque OMP-module exception below is not used for statically consumed value
APIs or class extension. Native extension imports remain unchanged/external and
must resolve through the supported harness loader; do not bundle a second host
SDK/TUI instance into an extension. The mood loader smoke proves that boundary.

**Host-only type decision:** retain the literal dynamic OMP import. Where the
project cannot resolve host SDK declarations, allow one explicitly named
declaration for that exact module exposing an **unknown** value, with no
constructors/methods asserted by the declaration. The native-state adapter narrows
that value using its existing runtime constructor/member guards. It checks our
adapter implementation, not the host SDK implementation. Prime and OMP wrapper
inputs likewise enter as unknown and are narrowed to owner-defined consumed
capabilities; use installed real types only where those exact runtime APIs match.
Do not cast alternate hosts to Pi's API (their compact/thinking contracts differ).
Include host-switch/import fixtures in the relevant checking programs while
retaining explicit malformed-host negative cases and native-loader execution.

**M6b Skills:** type the shared client and three actual CLIs; emit dependency-free
CommonJS at existing paths. Preserve realpath-relative loading through installed
symlinks, explicit/env/ancestry/cwd discovery precedence, bearer ownership, mixed
peer versions, paging/output/exit codes, spawn provenance and local-only attach.
R11 subsequently removes the copied canonical reference algorithm.

**M6c Electron:** type against the real Electron declarations; preserve existing
dev/package entrypoints, `nodeIntegration:false`, `contextIsolation:true` and
external-link handling. **Package-surface decision:** the Linux desktop package
must start the desktop shell and support the existing in-app runtime features
when their documented external harness/native prerequisites are supplied. It must
not silently lose features because first-party runtime resources are omitted.
Include the extension/skill/docs resources actually required by those features
in the M0 runtime manifest; this does not install harnesses or skill links into
the user's HOME, embed credentials, or add new product features.

Current file lists omit some referenced resources, and package main selection
needs a baseline launch check. Neither is claimed here as a reproduced defect.
Run that baseline check during M0, record the intended manifest/entrypoint and
any compatibility correction explicitly, then prove M6c's actual built archive,
native modules and window/server behavior. A newly discovered policy change
outside the stated surface needs separate approval, not a hidden waiver of this
gate. R7 removes guessed listener readiness after migration.

**Acceptance:** every listed implementation checked by CI, not just transpiled;
native loader/install paths and isolated Pi/OMP/Prime behavior pass; all three
CLIs work via installed links without a TS loader; real Electron dev and Linux
packaged startup/native-module/asset paths exercised. Do not claim untested macOS
support from Linux evidence; its packaging status stays explicit.

**Gates:** Pi integration, OMP/Prime protocol/native-state/installer suites and
real harness canaries; skills-core/skills-cli/comments-cli/session-control-cli/
skill-sessions-fleet suites; real Electron smoke.

### M7 — Complete checked server composition

**Depends on:** M1–M5 implementations/ports and M6's consumed extension contracts.
The integration owner may land already-ready route families incrementally;
the final gate waits for all product implementations, including M6.

Move remaining root-server behavior into the M0 checked application owner:
session control/prompt/queue/tree-mutation/model/command routes; settings
persistence/composition, themes/docs/directory utilities; session relations and
catalog integration; SSE replay and
listener/startup/shutdown construction. Preserve route registration order,
`/sessions/resolve` precedence, lifecycle admission middleware, share-only listener
restrictions, request limits and error/status projection. Use narrow domain ports,
not one whole-server context passed to every route.

**Acceptance:** every baseline server helper/handler has a checked implementation
or is deleted with its callers; the root launcher contains no hidden policy.
All original policy-bearing implementations in the 30-file inventory have
migrated; the sole planned root-launcher JS residue is the named M0 strict-
`checkJs` entrypoint exception. All seven preexisting extension TS files are
checked. Reconcile added files as well. Existing domain behavior and startup
ordering still pass.
This proves product source migration, not completion of Phase R below.

## Phase R — Explicit simplifying refactors

Start after the product migration gate. The following twelve bounded packages
are committed scope, not an invitation to redesign every typed module. Each
lists an established problem, replacement owner and deletion/behavior proof.
Small related primitives ship with their owning package; do not invent a generic
abstraction to make unrelated policies look alike.

### R1 — One interpretation of shared read/export facts

**After:** M1/M4. One index integration owner.

- Remove handwritten local projection signatures once their implementations are
  checked. Remove only `checked*` work proven redundant by the boundary table
  below; any removal during migration is credited here, not recreated.
- Extract equivalent chronological model-change/assistant-usage facts currently
  repeated in transcript/stats/indexed usage. Keep display identity, billing
  identity, skills continuity and aggregate/retry policies distinct.
- Replace `mineSkillsFromContent`'s independent tolerant JSON loop with the
  established parser plus entry miner only after preserving its framing behavior.
- Give native `omp-export` one embedded `session-data` decoder; remove the server's
  duplicate regex/base64/JSON decoding, retaining import/export-specific validation.

The R1 freeze must classify every existing callsite, not infer trust merely from
a TS return annotation:

| Existing edge in `src/core/session-index.ts` | Classification and required surviving validation |
| --- | --- |
| `parseSessionEntries` at full-read and delta-read sites (baseline 337/422), wrapped by `checkedEntries` (70) | Disk ingress. The typed parser must actually construct the array/framing marker and treat parsed JSON entries as unknown, preserving malformed-line/archive/physical-line rules. Consumers still narrow each field they use. The wrapper only checks array/framing, not entries; remove it only with constructor and malformed/framing proof, otherwise retain it. |
| Search build/extend (345/423), wrapped at 71–74 | Local projection of disk-derived unknown entries. Retain consumed-entry guards and append/branch failure rules; remove output-shape rechecks only when the checked producer constructs the projection rather than asserts it. |
| Usage build/extend (343/428), wrapped at 76–78 | Projection-to-persistence boundary. Baseline `decodeUsage` validates top-level containers/continuity, not opaque bucket internals. M1 must define and enforce consumed bucket invariants; keep runtime validation where JSON/pricing input, finiteness or persistence invariants are not guaranteed by checked construction. Typing a bucket as number is not a finite-number proof. |
| Skills mining (358/429), wrapped by `checkedSkills` | Local projection of disk-derived unknown entries. Preserve input/range/timestamp/state guards. Remove the second output scan only where checked validated construction guarantees those invariants; otherwise keep the needed checks in the producer/publication boundary. |
| Snapshot load `decodeUsage`, `decodeSkillRecords`, `decodeSkillState` (320/279/280) | Persisted disk ingress: retain and extend consumed-field decoders; never remove them as internal duplication. |

**Proof:** the deletion ledger names checks removed, checks relocated and checks
retained, with malformed/novel JSONL, full/delta framing and corrupt snapshot
cases. No second scan across a genuinely established local contract; no validation
dropped merely to claim a scan reduction. Full/delta outputs, branch/privacy/
cost/retry cases and raw native imports stay compatible. No universal reducer,
extra mandatory pass or raw-entry cache. Use M1 gates and an instrumented
throwaway parse/allocation comparison; retain a check if equivalence is unproved.

### R2 — Routine admission and single-read mutations

**After:** M2. Replace store rereads (`updateRoutine`/delete calling public lookups
after already reading the map) with private lookup against the owned snapshot.
Give routine admission one validated input/size result rather than serializing
input separately in route, runner and ledger creation. Keep external validation
and rejected-input error precedence; no publicly exposed unchecked ledger bypass.

**Proof:** one definition read per mutation and one size computation per accepted
invocation; rejected invocations create no ledger row; history survives definition
deletion. Keep watchdog/delivery/recovery close policies distinct. Routine/API
behavior suites plus isolated admission/schedule smoke prove the change.

### R3 — Compute skill coverage once per mapped record

**After:** M4. Move coverage derivation to the skills projection owner and replace
the repeated `coveredLines` set construction for each section. Build each mapped
record's line set once, update line/section counts, then discard it.

**Proof:** one set construction per mapped record independent of section count;
overlapping ranges count once per read; mtime filtering, section fractions,
heatmaps and unread estimates are unchanged. Delete server-local coverage/
section assembly rather than wrapping it. Skills/index/browser cases plus a
throwaway work-count probe establish the reduction.

### R4 — File preparation and diff snapshot ownership

**After:** M3. Preview/raw routes call one file-specific preparation operation;
they retain different JSON/resource response policies. One diff-view owner holds
the LRU/TTL/snapshot map and guarded aggregate/patch operations. Routes no longer
mutate snapshots or call arbitrary-path patch access outside membership/version
checks.

Also remove the identical command-path matcher shared by file mentions/mining
into a narrow Node-only primitive, and use existing `helper-format.escapeHtml`
instead of the standalone file page's duplicate. Do not merge path authorization,
ranking, classification or bare-`~` semantics.

**Proof:** one preparation path; no route-owned snapshot mutation; unchanged
inert content and stale-409 behavior including both version checks. M3 gates,
parser examples and a delayed-patch/file-change scenario protect the cutover.

### R5 — Share relay mechanics without sharing authorization policy

**After:** M3/M5 and M7 relay-route integration (the full product gate).
Replace repeated first-response timer/error settlement in API,
public-artifact and comment relay with a narrow helper; share equivalent safe
header copying only where policies match. Keep the three policy handlers.

**Proof:** duplicated mechanics deleted; API breaker feedback/raw streaming,
public token mapping/header restrictions, bounded comment JSON and artifact
rewriting remain separate. First-byte timeout does not become an SSE idle timeout
or start earlier across SSH setup. Unbuffered SSE, WS, public listener, comment
and remote-404 cases plus isolated relay smoke are required.

### R6 — Single extension replay writer; Pi-private adapter ownership

**After:** M6/M7. Two separately reviewed subpackages:

- **R6a Server-side replay:** the duplicate is between `server.js`
  `trackExtUIState` and **`src/core/bridge-session.ts` `BridgeSession._handle`**
  (baseline 470/541–567), both running in the pi-dish server process. Put the
  shared session-owned reducer at the server-side Bridge/RPC ingress before
  emitting events, with explicit acknowledgement/removal operations. Delete the
  server composition's duplicate reductions/tracking and route-side map writes.
  Retain `sess.extUIState` for browser SSE reconnect replay, even when no new
  bridge socket replay arrives. The **harness-side**
  `extensions/pi-dish-bridge/core.ts` `uiState`/`replayExtensionUI(sock)` is a
  different owner: it continues serving reconnecting server sockets and is not
  removed or centralized across the socket. No new cross-socket mechanism.
  Application-owned stale-ask cancellation and switch adoption stay separate.
  Preserve clear-before-emit, snapshots before connection resolution, RPC answer
  removal without a resolved event and Bounce pending-dialog visibility.
  SSE reads the same `sess.extUIState` object that the transport-owned reducer
  writes; do not create a second map set or copy-forwarding owner. Existing
  Bridge sessions already share that field (`state = sess.extUIState || ...`).
- **R6b Private Pi:** move Pi queue/private event access from shared bridge core
  into the existing `pi-private` adapter. Delete raw private-session exposure and
  shared-core knowledge of Pi's private field names. Expose only consumed queue,
  subscription and self-prime/abort operations. Keep cross-harness protocol and
  compaction buffering in shared core. Validate both aligned cancellation arrays
  before mutating either, including duplicate text/images.

**Proof:** one server-side replay-map reducer (not one map across processes) and
no Pi-private field mutation in shared extension core; no universal harness
adapter. Test browser SSE reconnect without a fresh bridge replay separately from
server-socket reconnect and harness replay. Bridge/RPC/Bounce, queue/compaction/
switch/reload, extension-dialog browser and real harness gates must pass.

### R7 — Explicit server construction, startup and Electron readiness

**After:** M5–M7. Construct upgrade dispatch and closeable resources before binding
listeners; remove retrospective `serverCloseHooks` registration and dependence
on later-populated handlers. Keep main/alias/restricted-share listeners distinct.
Recovery still precedes routine reconciliation and scheduling.

Expose actual owned-listener readiness from this lifecycle. Replace Electron's
300 ms delay and independent port guessing with that result. Handle retry's
replacement listener, delayed binding and ephemeral ports—not just the initially
exported server object's first event. Preserve the existing CommonJS server
export contract and close/signal behavior; startup failure becomes an explicit
Electron-visible outcome rather than an empty window.

**Proof:** no listener starts before its handlers exist; each resource registers
once; Electron loads only the owned ready endpoint. Listener alias/retry/
`PORT=0`/explicit URL, terminal/fleet WS and shutdown suites; real delayed-bind
Electron dev/package smoke. Do not silently redefine server shutdown policy.

### R8 — One explicit browser main-pane exclusion policy

**After:** M gate. Replace seven overlapping `closeOtherViews` peer lists and the
selection list in `app.ts` with a small main-pane coordinator. Register named
top-level takeover, session-scoped surface and overlay policies once. Controllers
retain their own close/dispose/request-generation implementations.

**Proof:** adding a takeover requires one policy registration, not edits to every
peer. Preserve the current asymmetries: recovery/subagents close additional file/
settings views; `keepBounceView` can retain Bounce during selection. Delete the
old peer lists; no “close everything” or generic router/event bus. All takeover,
production-composition, Bounce and desktop/mobile cases remain intact.

### R9 — One ordered selection-retirement sequence and narrow ports

**After:** R8. Keep `session-view` authoritative. Factor shared retirement phases
currently repeated by provisional and real selection; activation/chrome paths
remain distinct. Replace whole-controller factory-return inputs in session view
and message stream with owner-defined consumed-method interfaces.

**Proof:** one reviewed ordering for selection advancement, mark clearing, draft/
DOM stashing, stream/request retirement and activity reset. Unknown targets still
leave the current view intact. No universal cancellation generation or merger of
stream/transcript owners. Type negatives reject unrelated controller operations;
selection/spawn/composer/terminal/transcript/late-ticket cases prove behavior.

### R10 — Endpoint-explicit browser mutations

**After:** M gate; can run alongside R8 with a separate file owner.

Replace `session-controls`' per-mutation `createSessionApi` construction and
ignored-host closure with explicit API mutation operations accepting the captured
endpoint and session identity. Selection ownership remains in controls; transport
does not need a selection generation just to address a request.

**Proof:** no per-mutation factory allocation or host-argument substitution;
model/thinking/rename callers, exports and type fixtures migrate together.
Preserve latest-operation ordering, endpoint-base checks, refreshed credentials
and patching the original session after selection changes. Existing API/control/
delayed-mutation/endpoint-change cases plus real multi-host UI smoke are gates.

### R11 — One canonical reference algorithm across app and skill client

**After:** M6b. Bundle existing portable `src/core/helper-refs.ts` behavior into
the generated skill client; remove its copies of alias generation, staged
resolution and stable/short references. Keep the installed client dependency-free.

**Proof:** one authored algorithm; existing semantic precedence/ambiguity/
host-qualified exact-only cases pass through real CLI and browser/server paths.
Preserve the CLI's differing missing-native-ID parsing policy explicitly; do not
blindly replace its decoder with stricter canonical decoding. Remove copy-parity
tests that become wiring assertions, retaining consumer behavior coverage.

### R12 — Remove the handwritten vendor module loader

**After:** the vendor-tool source/runner portion of C1 is ready (it may land
earlier than the remainder of C1). Use existing pinned esbuild for the local
highlight bundle instead of `build-vendor`'s dependency collector and generated
`__mods`/`__cache`/`__req` implementation.

**Proof:** manual loader/resolver/cache wrappers deleted; `window.hljs`, common
languages, licenses and offline highlighting preserved. CSS/fonts and unrelated
vendor delivery stay unchanged. Rebuild vendor outputs only for this package;
exercise actual offline code rendering. No new bundler abstraction.

### Deliberate limits on refactoring

The scoping workers identified possible stale-stat/short-read index publication
risks, but did not reproduce corruption. M1's malformed/append/truncate matrix
must exercise the consumed-byte/stamp invariant. A demonstrated violation becomes
a focused regression/fix; a speculative transactional index/cache rewrite is not
part of the mandatory refactor list. No stronger atomicity claim is made here.

Also excluded: unifying differing header/cwd/recovery parsers; a generic terminal
routine “finish and close”; merging pricing persistence with generic store writes
despite permission/newline differences; merging interactive/pricing command
runners; broad host-catalog extraction from new-session forms; framework adoption.
Future ideas require their own problem/evidence, not expansion of this finish line.

## Phase C — Repository closure

### C1 — Checked tests, fixtures, development tools and configurations

**Depends on:** stable product contracts. Its runner/vendor-tool prerequisite may
start alongside late M/R work; test-family cutovers wait for the contract they use.

Convert the authored scripts (nine at baseline, plus M0's source-policy gate and
later additions), Node tests, Playwright tests, UI scenarios and support
implementations in bounded families. Explicitly allocate
`eslint.config.js` and `playwright.config.js`: keep compatible loader entrypoints
as named strict-`checkJs` configurations unless their hosts support a direct TS
cutover without a new runtime loader. Their bodies are checked, not deferred to
the final audit. Keep Node and browser-evaluation compiler environments separate.
Preserve intentional malformed inputs as unknown or explicit negative cases
rather than weakening product types.

Freeze the execution mapping before renaming: `run-tests.js` discovers only
`.test.js`, fixtures fork named JS files and tools rely on resource-relative paths.
Use explicit compilation into an isolated test execution tree where appropriate;
copy/resolve resources and subprocess entries deliberately. Existing command names
must discover and execute the same behavioral suites. Do not raise the Node
minimum or introduce a global TS loader/`NODE_OPTIONS` preload.

Build tools must bootstrap from checked-in executable outputs or a tiny explicitly
checked compiler launcher, never from unavailable unbuilt TS. Keep config loaders
compatible; small JS config/bootstrap exceptions need strict `checkJs` and a
named rationale where the host requires them. Intentional syntax/loader fixtures
remain distinct test data, not unchecked application implementations.

**Acceptance:** actual test/tool bodies checked; no blanket `test/`/`scripts/`
exception, loss of discovery or weakened assertions; clean `npm ci` followed by
documented commands works. Test conversion is not permission for wholesale test
restructuring. R12 can then replace the migrated vendor loader.

### C2 — Enforced source inventory and final delivery audit

**Depends on:** M, R and C1 completion; basic accounting can be introduced in M0.

Every tracked repository-owned executable JS/MJS/CJS/TS path must belong to one
compiler-owned implementation, generated-output mapping, or named justified
exception. Reject unclassified additions, missing/stale/orphan outputs and stale
exceptions. Enumerate deliberate fixture/vendor/historical-doc data separately.
Shell installers/tmux/tailnet scripts remain shell with behavior coverage;
preserve lock-FD inheritance and exit-code contracts. Do not touch the ignored
machine-local `launch-tailnet.sh` or credentials.

Mark only genuine generated outputs for GitHub Linguist; never hide all `lib/*.js`
or tests to manufacture a TS percentage. Retain the independent browser/helper
entrypoints: VM/parity/fixture/ESLint consumers still use them. Their removal would
require a separate consumer cutover, not an accounting change.

**Final completion gate:** no unclassified first-party implementation; all native
entrypoints and supported package paths exercised; all R deletion ledgers met;
temporary scaffolding removed; docs/build commands/coverage map reflect reality;
full required suites and exact pushed-commit CI green. Publish source coverage,
compiler coverage, simplification results and delivery evidence separately.
Product migration is not declared repository completion until this gate passes.

## Dependency waves and integration ownership

1. **Freeze:** M0 delivery/inventory and the small shared M1 projection/SDK and
   M3/M5 artifact/transport contracts. This establishes worker interfaces, not
   speculative implementations.
2. **Parallel migration:** M1a/b/c with explicit SDK/index editors; M2 store/
   provenance/cron; M3 stores/files; M5 transport/PTY; M6 extension/CLI/Electron
   checking. M4 independent agent/STT work can start here.
3. **Integrate migration:** M2 prompts wait for refs; M4 aggregation waits for
   M1; M3 export/remote integration waits for M1/M5; M7 serializes server-family
   integration and closes the complete product inventory. M6 runtime proofs finish.
4. **Parallel refactors after the product gate:** R1, R2, R3, R4, R5, R6, R7,
   R8, R10 and R11 can own separate files where contracts are stable. Serialize
   shared index, server and bridge edits; R1/R4 also serialize their shared mining
   primitive cutover. R9 follows R8. Do not run validation against another
   worker's half-integrated tree.
5. **Repository closure:** C1 loader mapping precedes test-family conversion;
   its vendor-tool slice unlocks R12. C2 audits the final result.

Use one integration owner for `server` composition, one for `session-index`, one
for Pi SDK/extension adapter signatures and one for browser `app.ts`/selection
ports. A worker owns source plus its callers and evidence, not an isolated
declaration. Independent work can be implemented in parallel; overlapping file
edits and producer/consumer contract changes are serialized explicitly.

## Planning evidence and critique gate

Four read-only workers ran as **`openai-codex/gpt-6-astra`**, high reasoning, with
read/grep/glob tools only: session reads; feature domains; application structure;
runtime/compiler closure. Their returned provider/model identities were checked.
They did not run implementation tests or change repository files.

Initial independent critiques from **`kimi-code/k3`**, **`zai/glm-5.3`** and
**`opencode-go/deepseek-v4.1-flash`** all returned `revise`, with thirteen
clarification findings. After those changes, **all three independently returned
`ready`**, with no unresolved original findings or blocking/important new findings.
The rechecks added three minor clarifications: same-object SSE replay state,
M0-versus-M7 launcher timing, and mood's real TUI/TypeBox declaration sources.
Those are incorporated above, with source-premise corrections recorded explicitly.

The [complete critique and resolution record](remaining-migration-review-2026-09-15.json)
retains the initial verdicts, exact reviewed digests, actual provider/model/session
identities, rechecks and maintainer dispositions. Rechecked scope is distinguished
from these final minor clarifications and review-status/link changes; it is not
represented as a third independent review of the final bytes.

Plan critique is not implementation approval or a claim that any future package
has passed its gates.

## Verification and completion policy

Use the existing [coverage map](testing.md#coverage-map-for-refactoring) and
[task-package convention](session-catalog-migration.md#higher-level-tasks).
Implementation changes run strict/build-drift checks and the relevant behavioral
suites. Run the full backend suite before committing behavior changes; browser
behavior changes additionally run browser scenarios, isolated UI scenarios and
full desktop/mobile smoke. Exercise actual CLI/Electron/harness loader surfaces
where changed; a compiler-only result is not runtime proof.

Keep regressions for real malformed-input, ownership, persistence or transition
risks. Do not add export-count, source-text, forwarding or module-wiring tests to
inflate coverage. Temporary smoke scripts must be removed after their evidence
is recorded. Existing tests that pin incidental plumbing should be replaced by
consumer-observable checks or removed, not translated mechanically.

The supported automated matrix remains Node 22.19.0, 22.x, 24.x and 26.x for
backend/checks, plus Node 24 managed Chromium for browser/UI. Real Pi uses the
lockfile SDK canary; real OMP and Prime remain explicit isolated canaries.
Unverified platform/package combinations must be named, not inferred from Linux
or a successful typecheck. Each shipped implementation checkpoint must pass the
required exact-commit CI gates. Documentation-only planning updates require
content/link checks, not a claim that the future implementation has passed tests.

## Implementation ledger

### Implementation record — M0

**Accepted by the integration lead on 2026-09-16.** Owner: OMP session
`01a0a963-f44d-71d2-b8d6-fe6d7807db69`, verified
`openai-codex/gpt-6-astra`, High.

- Implementation: `9988d5a0256f13ac4025a72c7dbfafb93885077f`.
- Final reviewed source/contracts: `5305af19fb674a624a17a267812bb3ed436089c6`;
  its only changes from the implementation are three contract/evidence documents.
- Attestation and integrated implementation checkpoint:
  `35ad0c4bd1433ae9b07bca6c1e422fa28cf4eb52`. The attestation adds only
  [the review record](m0-review.json). Main received the committed objects by
  fast-forward, not a copy of the review worktree.
- [All five CI jobs passed on that exact checkpoint](https://github.com/MrPink604/pi-dish/actions/runs/35079260428):
  backend/checks on Node 22.19.0, 22.x, 24.x and 26.x; Node 24 browser cases,
  isolated UI scenarios and desktop/mobile smoke.

**Delivered:** [source/output/compiler and consumed-port contracts](m0-contracts.md),
[115 ordered registrations and 557 resolved outer-name references](m0-route-contracts.json),
the [inactive M6c runtime-manifest target](m0-runtime-manifest.json), real declaration
pins, and the TypeScript-parser-backed source-policy gate wired into `npm run check`.
At M0 acceptance, the gate governed 196 compiler-owned sources; pending
implementations were not claimed checked. M0 makes no production moves/deletions and introduces
no runtime shim or wire/store policy change. Its new development script remains
within C1's checked-tooling obligation.

**Verification:** the [owner evidence](m0-evidence.json) records Node 26.8.2,
npm 12.0.2, TypeScript 7.0.2 and Linux x64; clean install, check, 998 backend
tests, 31 focused post-install cases, actual temporary explicit-any rejection,
compiler/export/native-type probes, isolated server executable/export and
installed-link loader checks. The parent inspected the implementation,
dependency delta, contract boundaries and all three durable final review
transcripts; integrated `npm run check` passed. An additional disposable parent
probe proved that a governed-root executable absent from all compiler programs
is rejected, while the valid source set passes before and after removal.
Temporary parent probe files were removed.

**Independent acceptance:** `zai/glm-5.3`,
`opencode-go/deepseek-v4.1-flash` and `kimi-code/k3` each explicitly accepted
`5305af1`. The review record retains exact identities, revisions, findings and
dispositions. The accidental review-time package extraction, confirmed cause,
byte-identical restoration and post-restoration check are recorded separately;
no contaminated working-tree bytes were integrated.

**Retained boundaries at M0 acceptance:** M1–M7 were pending. M6c must fix
the reproduced package entrypoint, omitted resources and Electron embedded-Node
incompatibility, and prove real desktop/native/SDK behavior; M0's HTTP-only
package launch is not desktop acceptance. M0 did not run opt-in real OMP/Prime
canaries or establish macOS package support.

**Release:** M1–M6 may implement their independent slices in isolated worktrees.
Producer-dependent integration still follows the frozen M1/M3/M5 contracts.
Private domain mount/deletion patches are proposals reviewed with their consumer
cutover; only the integration lead applies them to shared main, serially.
M7 owns the remaining server/root conversion. R and C completion are not implied.

### Implementation record — M1

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0a998-4175-7206-b4a7-e3e0c1fa532e`, verified OMP Astra High.
Producer `6b10e54d5cd15594a5c58e9abd4f02f6e71a7a8e`, original-position root
proposal `9d47ed6b02c990c3e832c2456c39ba1521fa6f16`, final reviewed source
`6d9b3e2830ff492ef26ea9ab5b02b2d38b8f694d`, and final attestation-only
`de99e3d03f6ab08b8093b7f0665c079ea01ff5aa` were integrated with M5 at
`dd618d6f28ac95d570f0d6d0d6a4f268b0d50fa4`.
[All five exact-commit CI jobs passed](https://github.com/MrPink604/pi-dish/actions/runs/35091165431).

**Cutover:** all six M1 libraries now have actual strict `src/core` implementations
and original-path generated JS/declarations. `SessionReadHandlers` owns messages,
images, search, stats, export and read-only tree responses. Index/data/discovery
consumers use the real producers. Root retains observation wiring, not duplicate
M1 response bodies. Six library moves are not algorithm simplification; obsolete
unchecked signatures and redundant result adapters were removed, with the raw-leaf
check and persisted ingress decoders retained. The R1 ledger must credit these
removals rather than recreate them.

**Preserved and explicit exceptions:** bounded reads/shared parsing, cache/delta
behavior, whole-tree images versus active-branch display, raw OMP export and
cost-availability semantics remain. The separately approved finite-counter bug fix
and field-specific real SDK header-null declaration mismatch are documented in
[the evidence](m1-evidence.json) and [review record](m1-review.json).
The raw `SourceLookup` input correction retains the original validator, alias
bytes and cache key; its post-parser type guard does not add admission policy.

**Verification:** owner full backend 1,002, focused 253 plus final-source 82,
44 browser cases, eight isolated UI scenarios, full desktop/mobile smoke, actual
Pi/native OMP exports and an OMP 18.1.21 canary passed. The parent read all three
final-source verdicts and inspected source/consumer boundaries before a clean
isolated merge. Combined M1/M5 verification passed clean install, check with
209 governed sources, 1,003 backend tests, 59 browser cases, eight isolated UI
scenarios and full desktop/mobile smoke. A real isolated server additionally
proved host exemption, bearer gating, transcript/search/stats and listener close;
an AST comparison preserved all 110 Express app/share-app registration identities
and ordering. Temporary parent probes were removed.

All three exact reviewers — `zai/glm-5.3`,
`opencode-go/deepseek-v4.1-flash`, `kimi-code/k3` — explicitly accepted final
source `6d9b3e2`; their refs, findings, corrections and limits are in the record.
Owner browser/native evidence covers unchanged bodies across the final type-only
delta; it is not falsely represented as rerun. Remaining domain/root behavior,
Prime/Electron delivery and Phase R are not accepted by this M1 record.

### Implementation record — M5

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0a998-3cd3-74ec-b7a1-dd8fe395dc15`, verified OMP Astra High.
Remote producer `57bed24194c0e251d18b58b02041309bf1534439`, handler producer
`c5d336a1e4e1d069a06306d81b654d703d0ccab0`, root proposal
`b7970d16dbe88c1bc7857313bf1ff700bdfc3d6b`, final reviewed source
`cf6b948a0b1e9be8a4957a2aed4bff3002dc62bd`, and attestation-only
`e9445b0e745d2d05b0123189428570fbcfea17de` are in the combined integration
`dd618d6f28ac95d570f0d6d0d6a4f268b0d50fa4`.
[All five exact-commit CI jobs passed](https://github.com/MrPink604/pi-dish/actions/runs/35091165431).

**Cutover:** remote transport, terminal, access, relay and terminal-handler
implementations are strict core sources with generated original-path outputs.
Fifteen M5 registration positions are preserved. M3's checked FleetArtifactStore
producer `d31b67b` was imported unchanged as `e9fc809`; that dependency is not
acceptance of the whole M3 package. No transport/auth policy adapter, R5 mechanics
redesign or R7 startup redesign was introduced.

**Verification:** [owner evidence](m5-evidence.json) records check, 999 backend
tests, 17 terminal cases, 15 host/terminal browser cases, full desktop/mobile smoke
and isolated real HTTP/SSE/WS/direct/OpenSSH/PTY execution. This includes raw body
bypass, credential/header policy, first-response deadlines without an SSE idle
timeout, forwarding reuse, restart/replay and shutdown. The final thrown-value
parity correction failed a real-WS regression before the fix, then passed;
success-path smoke and later error-path evidence are distinguished honestly.
The parent independently checked the final verdicts, dependency/root wiring and
the combined integration gates recorded under M1 above.

All three exact models explicitly accepted `cf6b948`, not merely the earlier
freeze. [The review record](m5-review.json) retains their refs, actual source
rechecks, findings and the withdrawn false baseline-error premise.

**Retained limits:** root composition/other domains remain pending. External
payload/error properties stay unknown until consumed. No additional SDK, harness,
CLI, Electron or macOS delivery is claimed by M5. One completed implementation
peer's graceful close reported residual-process uncertainty and later lacked
unambiguous live-bridge authority; no manual PID signals were used. That
work-session cleanup limit is separate from the successfully cleaned test/smoke
processes and credentials, and is not represented as resolved.

### Implementation record — M2

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0a998-5492-710e-88b2-9f532847418f`, verified OMP Astra High.
Final owner source `1840a7bca15cff76aaa83c8d47d47259ca8877f8` and attestation
`33a3f5b8980423b67c05dc772f409c13e004b07b` were integrated with M6 at
`0b51e8a541f950c18c105d6a9577308ec4bba8a1`. Final accepted checkpoint:
`709830d77978800420da5789b7c879d92c941ad8`.
[All five exact-commit CI jobs passed](https://github.com/MrPink604/pi-dish/actions/runs/35109156375):
checks/backend/bridge/lifecycle on Node 22.19.0, 22.x, 24.x and 26.x; full browser,
eight isolated UI scenarios and desktop/mobile smoke on Node 24.

**Cutover:** cron, routine definitions/storage, invocation scheduling,
provenance and routine HTTP/prompt composition now have strict core
implementations and generated original-path JS/declarations. Root consumes the
checked handlers and existing session coordinator rather than retaining duplicate
routine policy bodies. The coordinator remains the only launch/resume/close
authority. R2 algorithm simplification remains separate.

**Preserved boundaries and explicit decisions:** raw persisted rows and alias
bytes, native argv/cwd coercion and tmux shell behavior retain their recorded
contracts. File-URL metadata normalization occurs after native launch; byte cwd
cannot be faithfully reconstructed from async spawn, so the documented
post-native rejection awaits owned-child cleanup without publishing a session.
[Owner evidence](m2-evidence.json) and [the review record](m2-review.json)
retain the precise exceptions and execution evidence.

**Verification:** owner check, 1,009 backend cases, 82 focused cases, 11 routine
browser cases, full UI and actual routine/native/metadata probes passed.
Independent combined parent verification passed clean install, check with 230
governed sources, 1,026 backend cases, 11 routine browser cases, eight isolated UI
scenarios and full UI. A separate real browser created and ran a routine; the
invocation completed and its owned session closed successfully. The parent AST
comparison preserved all 110 app/share-app registration identities and ordering.

The first integration's CI exposed two Node 22.x test assumptions that
`invoke?wait=1` must already return completed; the runner actually returns on
leaving starting. Test-only `709830d` uses existing completion polling and
completed-ledger assertions, retaining the observable raw-ingress contracts
without pinning native error wording. No production/generated/config bytes
changed. All 14 routine API cases, check and all 1,026 backend cases passed again.
The other runtime/UI evidence applies to byte-identical production code.

All three original exact reviewers — `zai/glm-5.3`,
`opencode-go/deepseek-v4.1-flash`, `kimi-code/k3` — explicitly renewed whole-M2
acceptance at `709830d`, including the integrated root and dependencies. The parent
read each complete verdict directly before pushing the accepted checkpoint.
The review record preserves both historical and renewed acceptances. Disposable
parent probes were removed. This record does not accept M3/M4/M7 or Phase R.

### Implementation record — M6

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0a998-4644-742f-bbf6-102bc6f53c99`, verified OMP Astra High.
Final reviewed source `8d5bdadb791ac6ef76c4cdf794c83f47eb03a64d` and
attestation `c07753022d646323b3dcea247efd2e1b67f939de` were integrated at
`0b51e8a541f950c18c105d6a9577308ec4bba8a1`; accepted checkpoint `709830d`
changes only the M2 tests described above.
[All five exact-commit CI jobs passed](https://github.com/MrPink604/pi-dish/actions/runs/35109156375).

**Cutover:** first-party extensions, skill client/CLIs and Electron edges are
covered by their strict compiler programs and generated-output/mode checks.
Runtime resource resolution distinguishes checkout resources from physical
unpacked package paths, including the import-only FFF native dependency.
Electron's packaged entrypoint and required resources are included without
changing the root server export/engine contract or introducing a general path
fallback. R7 startup simplification remains open.

**Verification:** [owner evidence](m6-evidence.json) and
[the review record](m6-review.json) retain the complete checkout/package,
native harness and final CLI ingress proofs, including the two corrected optional
record merges. All three exact-model reviewers explicitly accepted entire final
source `8d5bdad`; the parent read the final verdicts and verified identities.
The combined check/backend/browser/UI evidence above applies to M6.

The parent independently rebuilt and launched both actual development and packaged
Electron 44.4.1/embedded Node 24.21.0 desktops. Proof exercised local HTTP assets,
real SDK import, PTY output, depth-eight native FFF search, all three installed
CLIs and external dispatch. Four isolated native harness modes passed: Pi in both
desktop modes (13 checks each), actual OMP 18.1.21 and Prime 0.9.4 (10 isolated
fake-provider requests each). All four reported exit zero, Electron exited and
no tmux cleanup failures. The parent inspected both desktop and all four harness
screenshots and the structured results; these were not HTTP-only package probes.

Parent packaged executable SHA-256:
`8407787e90832dceaf83d751cc2ad89a92b92f90c9c5dedcc126e54258649a6f`;
ASAR SHA-256:
`a154f13c18f41e10714572fadebd10fb0808e29f3e36b41c73a0aa59f44176d2`.
Recovered original proof scripts matched recorded hashes, ran against the new
integration and were removed afterward. Homes, sockets, tmux and provider
fixtures were isolated; no live agent credentials or sessions were used.
Proof artifacts remain separate from shipped source.

**Retained limits:** Linux x64 delivery is verified; macOS packaging was not
available and is not claimed. Root conversion, later domain packages, mandatory
simplifications and repository-tool/test closure remain open.

**Post-acceptance work-session cleanup:** graceful close was requested for both
owners and their six reviewers. Subsequent semantic resolution reports all eight
inactive with no close capability. One close call nevertheless reported pane
`%21` gone with owned process identities still alive:
`2609016@29809620`, `2609078@29809667`, `2609152@29809702`,
`2611326@29811231`, `2612233@29812156`, `2614483@29813908`.
The concurrent call's error did not identify its session; residual-process
cleanup is therefore not claimed complete. No manual PID signals or repeated
close requests without live authority were used. This limit concerns work
sessions, not the isolated product/harness proofs above.

### Implementation record — M3

**Accepted by the integration lead on 2026-09-16.** Owner: OMP session
`01a0a998-4b0e-76ce-9490-995db584afd2`, verified
`openai-codex/gpt-6-astra`, High.

- Final reviewed source: `8570631fb8047afab998538a479fed7257ab2263`.
- Documentation-only attestation: `df372295542d3209b9465f4ad29a0ad4f8234e62`.
- Initial parent integration: `ebfdadd7a5bc3d4ef0717128d33faa6d0e87844f`.
  Final combined M3/M4 integration: `940d669dd884d800c368977ef1e44c2d30b70895`.
- [All five CI jobs passed on that exact combined source](https://github.com/MrPink604/pi-dish/actions/runs/35112220471):
  checks and full backend suites on Node 22.19.0, 22.x, 24.x and 26.x;
  full browser cases, eight isolated scenarios and desktop/mobile smoke on Node 24.

**Delivered:** ten checked core modules and twenty generated JS/declaration
outputs cover the eight publication/file libraries and the two handler factories.
The [owner evidence](m3-evidence.json) records the source/output inventory,
original-position consumers, early fleet/search producer transfers and actual
M1 export, M5 relay and M6 native-resource dependencies. Parent integration
retained the accepted producers and one instance of each factory. It removed the
obsolete root file/publication bodies and the orphaned M5 relay/header copies;
early access/relay middleware and restricted share-listener order remain intact.
Distinct page/share/comment stores, inert raw previews, ownership checks,
captured diff snapshots and both stale-version checks remain distinct policies.

**Independent review:** [all three exact-model reviewers](m3-review.json)
explicitly accepted the entire final source: GLM session
`01a0a9e4-5ccb-7348-9bb0-da6dca4412c2`, DeepSeek session
`01a0a9e4-6667-712c-963a-fa32d9b2ec59`, and Kimi session
`01a0a9e4-6191-736d-965b-64f2690861b3`. Parent read the final decisions directly
and verified actual models. Kimi's personal review and delegated-read provenance
were checked separately, including the ten recorded resolved Kimi model identities.
The malformed-message finding was fixed, not waived: direct native property
access again preserves null/undefined errors, with a focused regression.
Historical approvals remain historical; attestation is not reviewed source.

**Parent execution:** isolated actual Node/HTTP and browser execution proved
file previews/raw `nosniff`, captured git patches and stale `409`, annotated main
versus unannotated public HTML, public API `404`, persisted anchored-comment
editing, acknowledgement removal from the open index, and revocation to public
`404`. Browser screenshots and saved HTTP results confirmed the actual surface.
After M4 integration, `npm run check` passed with 247 compiler-owned sources and
no explicit-any exceptions; all generated/type gates passed. Full backend:
1,027 passed, zero failed/skipped (32.06s). Full browser: 286 passed (3.0m).
All eight fresh-fixture scenarios and full desktop/mobile/multi-host/same-id UI
smoke passed; the combined browser/scenario/UI command took 294.66s. A disposable
native-Node AST comparison preserved all 113 main/share application calls in
method/path/order against accepted `709830d`, including listener construction.
Runtime: Node 26.8.2, npm 12.0.2, TypeScript 7.0.2, Playwright 1.63.0,
Chromium 153.0.8010.12, Linux x64.

**Cleanup and limits:** the browser was closed, isolated publication server
stopped, and owned smoke scripts/HOME removed. Its supervised stop exited 143;
no separate graceful-close banner was observed. No live product sessions or
provider credentials were used. Persisted legacy members and external SDK/tool
payloads remain explicitly opaque. Root implementation checking remains M7;
R4/R5 simplification and repository closure are not claimed. Native packaging
evidence remains scoped to the accepted M6 Linux record, not macOS.

### Implementation record — M4

**Accepted by the integration lead on 2026-09-16.** Owner: OMP session
`01a0a998-4fc3-744f-9e90-c6cda55bbd71`, verified
`openai-codex/gpt-6-astra`, High.

- Independent implementation: `8abe0b88b17c87f310c644effed254a4a9de5ad7`.
- Complete consumer cutover: `ab8627b2040c090c162353bf3daf908049e34ac8`.
- Final reviewed parity correction: `880b47fe3f6548bd829798c2909d238f882d1a9a`.
- Documentation-only attestation: `2c391d86178e08a2706e2f195c3d40e84aa31ac8`.
- Parent integration: `940d669dd884d800c368977ef1e44c2d30b70895`,
  with [all five exact-source CI jobs successful](https://github.com/MrPink604/pi-dish/actions/runs/35112220471).

**Delivered:** nine checked core implementations and eighteen generated outputs
own harness agents, interactive feature commands/settings, STT, usage, skills,
models and all sixteen feature responses. The [owner evidence](m4-evidence.json)
distinguishes the original fourteen registrations from the two parent-approved
application-settings registrations, inventories the twelve consumed ports, and
records actual M1/M6 producer provenance. Root mounts remain at their original
positions. Old response/helper copies and obsolete imports are removed;
`knownWorkspaceCwds` is one checked helper for skills, cwd listing and startup.
Root retains settings persistence, model-cache/context-window invalidation,
observation and session mutation/control. Pane presence is listing advice only.

**Independent review:** [the renewed whole-source decisions](m4-review.json)
are GLM `01a0a9e4-52f9-73ef-9864-4d689e70fd18:161`,
DeepSeek `01a0a9e4-49c5-7196-980e-4e2cec62a7c7:230`, and
Kimi `01a0a9e4-4e39-72e2-8a8d-a0ef9889a177:107`. Parent read each exact final
ACCEPT and verified its model. The coverage index side-effect/performance finding
was fixed by using the existing index accessor; the empty-array cache observation
was explicitly retracted. Prior-source approvals were not transferred silently.

**Parent execution:** all combined checks/backend/browser/scenario/UI and exact
CI gates above passed. An additional real Express HTTP coverage/NDJSON probe used
the actual index, source descriptor and an appended Pi JSONL deliberately excluded
from enumeration. Coverage refreshed that source: subsequent NDJSON contained
both `first` and `second` activations, the next coverage reported two mapped
reads and the latest timestamp, and the session label remained unchanged.
The owner record separately retains the failing pre-correction reproduction and
its passing corrected result, plus scoped SDK/JSONL/STT/installed-OMP proofs.
Those historical native commands are not represented as parent reruns.

**Cleanup and limits:** the disposable parent probe and isolated HOME were
removed after success; no live product sessions or provider credentials were
used. The coverage algorithm and repeated per-section line sets remain unchanged
for R3. Raw bridge/CLI payloads and actual SDK/Express ingress retain their opaque
boundaries; remaining root behavior belongs to M7. M0–M6 acceptance does not
complete product migration, the mandatory R packages, or C1/C2 closure.

**Post-acceptance work-session cleanup:** semantic graceful-close returned
success for all six M3/M4 reviewers, then for both owners. Their histories remain
available. The exact-commit CI observer exited successfully and its throwaway
script was removed; its final run/job/step evidence was retained separately.

### Implementation record — M7

**Accepted by the integration lead on 2026-09-16.** Owner: OMP session
`01a0aac9-75a0-750f-968b-29880a285368`, verified
`openai-codex/gpt-6-astra`, High.

- Whole reviewed source: `772f01be651d7d0e63f2d0f41c26f1281a7ff41d`.
- Separate documentation-only attestation:
  `753b962d0099f96caae4ba4133073bddc4d497f1`.
- Parent integration with the C1 tools checkpoint:
  `0e8faa1495065e9fcbdb1b70bea784dfb5baae53`.
- [All five CI jobs passed on that exact main commit](https://github.com/MrPink604/pi-dish/actions/runs/35123904656):
  checks/full backend on Node 22.19.0, 22.x, 24.x and 26.x; full browser,
  all isolated scenarios and desktop/mobile smoke on Node 24. Parent inspected
  the actual successful required steps, not only the workflow conclusion.

**Delivered:** all remaining root composition policy is authored in
`src/core/server-app.ts`, with generated flat `lib/server-app.js` and declaration.
The [frozen inventory](m7-evidence.json) accounts for all 257 original top-level
statements, all 2,499 original root lines and all 30 original product-policy rows.
Only the zero-caller `apiIdForCandidate` helper was removed. The checked,
policy-free root is exactly
`module.exports = require('./lib/server-app').startServer(__dirname);`.
It returns the actual initial native `http.Server` synchronously; application
resources use the supplied root. Existing domain owners, all 113 ordered
mount/listen calls, ownership/capability proofs, error precedence, cache,
SSE/replay and listener/close behavior remain intact.

**Independent review:** [all three whole-source ACCEPTs](m7-review.json) apply
to the same `772f01be`: GLM `01a0aaf1-efa1-742c-82fd-bf048ee982c0`
(`98335f88`), DeepSeek `01a0aaf1-f8f3-77c7-90a7-a9c83cceead1`
(`48f38a40`), and Kimi `01a0aaf1-f46a-7381-8a35-594a0d4a6017`
(`f0916092`). Parent independently read each verdict, resolved the exact
`zai/glm-5.3`, `opencode-go/deepseek-v4.1-flash`, `kimi-code/k3` models,
High/OMP provenance, and verified archive hashes, contiguous message indices
and verbatim verdict equality. No source changed during review.
DeepSeek and Kimi nevertheless ran compiler/source-policy checks despite the
requested no-check review protocol; both deviations are retained, not hidden.
GLM's fabricated-null-body “same 500 path” phrase is not endorsed as HTTP proof:
some reads precede route try blocks, and mounted body-parser admission prevents
that direct-handler state. There is no blanket native-error waiver.

**Parent execution:** clean pinned `npm ci`, all four generation commands and
`npm run check` passed: 258 compiler-owned sources, no explicit-any exceptions,
all source/type/generated-output/mode gates. Full backend: 1,027 passed,
zero failures/skips (32.27s). Browser: 286 passed; all eight isolated scenarios
and full desktop/mobile/multi-host/same-id smoke passed (combined 292.56s).
An initial build encountered missing declared development type packages in the
installed tree; clean installation restored them and the entire chain passed.
The cause of that installed-tree state was not established; no source workaround
or dependency change was made.

Independent isolated root and custom-root launches proved synchronous native
server identity, real main/share readiness, API version/static/doc roots,
publication on both listeners, share API exclusion and closure of both listeners.
The parent built the Linux unpacked package and exercised actual Electron
44.4.1/Node 24.21.0 development and packaged windows, local assets, real SDK,
native PTY, depth-eight native FFF search, external-link dispatch and all three
installed skill CLIs. Both screenshots were inspected. Native modules in the
package loaded from `app.asar.unpacked`; evidence/screenshots remain in
`/tmp/pd-m6c-proof-B78VJn`.

**Additional evidence and limits:** the attestation embeds the complete
supplemental cwd script/results: 12 raw-cwd variants, 192 real HTTP requests
and 24 real WebSocket/native-PTY cases across baseline/final, with parity except
validated random snapshot IDs. Parent read the script and all captured outcomes
and verified its embedded hash. This is injected-port handler proof, not a claim
of a full-root malformed-registry test or an additional valid-patch exercise.
The owner's separate real Pi/OMP/Prime dev/package lifecycle proofs remain
owner-executed evidence, not represented as parent reruns. macOS is unverified.
The stale Electron root-checking comment is deliberately reserved for R7;
repeated direct `startServer()` calls do not redefine the old cached launcher.

**Cleanup and release:** isolated parent servers/windows closed; owned runtime
fixtures, extracted smoke scripts and desktop fixture homes were removed while
screenshots/results/logs were retained. No live product sessions or provider
credentials were used. Contributor ownership/build guidance now reflects the
checked root and tool bootstrap. M0–M7 product migration is accepted; R1–R12
and full C1/C2 remain mandatory, separate work.

### Implementation record — C1 tools checkpoint

**Tools checkpoint accepted by the integration lead on 2026-09-16; C1 remains
open.** Owner: OMP session `01a0aacf-378b-7454-a8ed-c7c5422991b6`,
verified `openai-codex/gpt-6-astra`, High.

- Reviewed source: `ed61fff9592183e28bb2f18c190ae13e31f7ceb4`.
- Separate documentation-only attestation:
  `fb98c2b8ba400d453797218c9cccb75b7f54dc32`.
- Combined parent integration: `0e8faa1495065e9fcbdb1b70bea784dfb5baae53`,
  with [all five exact-commit CI jobs and required steps successful](https://github.com/MrPink604/pi-dish/actions/runs/35123904656).

**Delivered:** actual checked tool bodies for build-tools, core, browser, edges,
vendor, source-policy and CI-failure reporting, with sibling generated runtime
paths and declarations. The self-bootstrap preserves clean-install command paths,
shebangs and modes, and rejects stale/missing/orphaned output.
`tsconfig.tools.json` and `tsconfig.configs.json` check implementations, not
declaration facades. Playwright uses its existing host transform to load
`playwright.config.ts`; the named ESLint host exception remains strict-checkJs.
No Node minimum, runtime TS loader or vendor-loader algorithm changed.
The [execution inventory and proofs](c1-tools-evidence.json) retain all 247
classified records, deferred families, original runtime consumers and mapping
constraints. Their reported unchanged vendor/product bytes apply to the
tools-only checkpoint, not to the combined M7 product cutover.

**Independent review:** [all three whole-checkpoint ACCEPTs](c1-tools-review.json)
cover the same `ed61fff`: GLM `01a0aae0-f575-7414-a8a2-41190d242a29`,
DeepSeek `01a0aae0-fa3a-711d-93e2-45f1587038eb`, and
Kimi `01a0aae0-fefb-70ac-a2a1-9cc133f9f61b`. Parent independently read final
verdicts and verified exact models, High/OMP and source provenance.

**Verification:** parent tools bootstrap `--check`, source-policy and actual
Playwright TS-config discovery passed (286 cases in 54 files), followed by all
combined builds/checks/backend/browser/scenario/UI/runtime gates recorded above.
The owner additionally proved actual Node 22.19.0 tool/config execution,
negative type/source/output/mode cases and explicit-file test forwarding.
Its initial reserved-port listener failure and subsequent focused/full passes
remain recorded; they were not hidden or “fixed” by changing product/tests.

**Release boundary:** this accepted vendor-tool source/runner prerequisite and
the accepted M product gate permit R12. The handwritten highlight loader is
still present for R12 to remove. Remaining runner/support and behavioral-test
families require their own checked implementation and stable-contract release;
Playwright discovery must remain generated-JS-only before TS spec siblings land.
No blanket tests/scripts exception or full C1/C2 completion is claimed.

**Post-checkpoint work-session cleanup:** semantic graceful-close returned success
for all three M7 reviewers, all three C1 tools reviewers and the M7 owner. Histories
remain available; the C1 owner continues the remaining families. The exact-source
CI observer exited successfully; its throwaway script was removed and its complete
run/job/step evidence retained in `/tmp/pi-dish-parent-m7-c1-ci-result.json`.

### Implementation record — R5

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0ab39-98f6-7731-8053-0cb5bd29828e`, verified OMP
`openai-codex/gpt-6-astra`, High. Reviewed source:
`359e85ef22eeb5fe80568f3dfc89a925b4630abd`.

**Delivered:** `relayFirstResponse` privately owns the three equivalent
first-response settlement/timer/error paths in `src/core/relay-handlers.ts`;
`copyRelayResponseHeaders` owns the two equivalent safe response-header loops.
Authorization, credential replacement, public admission, API breaker policy,
comment buffering, SSE streaming and the distinct public slash/404 recheck remain
with their original handlers. No exported contract or universal proxy layer was
introduced. [Evidence](r5-evidence.json) and the
[separate complete review record](r5-review.json) retain the deletion/check
ledger, original under-scoped reports and their whole-source renewals.

**Independent review:** GLM `01a0ab4c-0f`, DeepSeek `01a0ab4c-0a` and
Kimi `01a0ab4c-1` accepted the same frozen source. Parent independently verified
actual exact models, High/OMP/cwd, complete semantic archive hashes and indices,
verbatim decisions and complete authored/generated read coverage. Initial
partial coverage was not treated as a passing gate.

**Parent runtime proof:** 11 isolated groups exercised real HTTP and WebSocket
paths, raw request bodies, credential/header policy, bounded comment responses,
artifact rewriting/overflow, 404 ownership pruning, breaker asymmetry and
unbuffered SSE. SSE delivered its first event in 171ms and remained open beyond
the first-response window (10,669ms total); API timeout was 10,152ms.
A delayed Unix-forward fixture separated 3,000ms setup from an 8,000ms peer
response (11,229ms total). This proves the timer boundary, **not** operation
against a real SSH daemon. Linux-only; no performance-improvement claim.
Complete parent proof is retained in `/tmp/pi-dish-parent-r5-smoke-result.json`.

**Combined delivery:** main
`6f521cc39cd6e612c146cedbcc2a3b23f02bf4d8` includes R5, R12 and the C1
runner/support checkpoint. Parent vendor regeneration, strict checks over 262
governed sources, 1,027 backend tests (zero failures/skips), 286 browser cases,
all eight isolated UI scenarios and full desktop/mobile smoke passed.
The code was checked at `40716810245f5742f1697daa3512701eba53bed1`; the
subsequent commit changes only vendor documentation.
[All five jobs and required steps passed on the exact pushed `6f521cc`](https://github.com/MrPink604/pi-dish/actions/runs/35137099031):
backend/check on Node 22.19.0, 22.x, 24.x and 26.x; browser/scenarios/full UI
on Node 24. Full parent records are retained in
`/tmp/pi-dish-parent-ready-local-result.json` and
`/tmp/pi-dish-parent-ready-ci-result.json`.

### Implementation record — R12

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0ab39-8f64-7161-b4d1-32502c535e23`, verified OMP
`openai-codex/gpt-6-astra`, High. Reviewed source:
`a5e2c172fa95cb2d0450cfc6aa66db118825edcb`.

**Delivered:** the checked vendor tool uses the existing pinned esbuild for
highlight.js common languages. Its handwritten dependency collector and
`__mods`/`__cache`/`__req` implementation are deleted; the generated local bundle
still supplies `window.hljs`. Other vendor assets, license delivery, CSS/fonts,
lazy loading and offline behavior are unchanged.
[Evidence](r12-evidence.json) and [review record](r12-review.json) retain the
source/output mapping and every historical report and gap disposition.

**Independent review:** GLM `01a0ab4a-18`, DeepSeek `01a0ab4a-1d` and
Kimi `01a0ab4a-2` accepted the same source. Parent verified exact
model/High/OMP/cwd provenance, complete archives and actual source-byte
coverage; Kimi's initial gap required same-session completion before acceptance.

**Parent proof:** 296 baseline/current VM comparisons preserved all 36 common
languages, public API/self aliases, version 11.9.0, native errors and license.
Actual uninstrumented production Chromium rendered JavaScript and Python after
lazy, local-only loading; a subsequent Rust block highlighted with networking
disabled and `navigator.onLine === false`. Screenshots were inspected.
The bundle grows from 352,131 to 376,926 bytes; no size or performance gain is
claimed. A browser evaluation-context correction affected only the probe,
not product code. Complete proofs remain in
`/tmp/pi-dish-parent-r12-parity-result.json` and
`/tmp/pi-dish-parent-r12-browser-proof.json`.

**Delivery:** R12 is included in the exact `6f521cc` integration and successful
five-job CI run recorded under R5 above. Parent also ran the actual vendor build.
Temporary runtime/parity scripts, fixture homes and browser processes were
removed after proof capture. No CDN or new bundler abstraction was introduced.

### Implementation record — C1 runner/support checkpoint

**Runner/support checkpoint accepted by the integration lead on 2026-09-16;
C1 remains open.** Owner: `01a0aacf-378b-7454-a8ed-c7c5422991b6`,
verified OMP `openai-codex/gpt-6-astra`, High. Reviewed source:
`f5df06e40e925bf93c417dcdacf463848391a494`.

**Delivered:** actual checked bodies for `scripts/run-tests.ts`,
`scripts/run-ui-scenarios.ts`, `test/test-env.ts` and
`test/ui-scenarios/index.ts`, with sibling generated CommonJS/declarations in
the existing Node-only strict tools program. Executable mode, JS command paths,
explicit test-file/flag forwarding, environment sanitization, signal/exit
behavior and ordered scenario loading are preserved. The eagerly loaded
scenario registry is intentionally opaque to its `Object.keys`-only consumer;
it does not assert unchecked callable implementations for deferred scenario
bodies. Exact mapping, mode and generated-banner orphan checks cover the three
owned directories. [Evidence](c1-runners-evidence.json) and
[review record](c1-runners-review.json) retain the complete contract and limits.

**Independent review:** GLM `01a0ab49-197c`, DeepSeek `01a0ab49-097e` and
Kimi `01a0ab49-1342` accepted the same frozen checkpoint. Parent verified
actual exact-model/High/OMP/cwd provenance, complete semantic archives,
verbatim reports and final source-byte coverage, including the required Kimi
completion rather than reusing an incomplete report.

**Parent execution and delivery:** the combined 1,027-test backend run and
all eight isolated scenarios exercised the actual new runner/support paths.
All strict drift/type/mode checks, browser and desktop/mobile gates passed;
the exact pushed `6f521cc` CI matrix above also exercised these installed JS
paths on all supported Node lines. Historical temporary read-only comparison
probes and review limitations remain disclosed in the record.

**Remaining boundary:** behavioral tests/specs, other fixtures/canaries,
observational tools, real-lineage runner and the eight scenario bodies still
need their checked implementations and stable-contract release. R12 is now
accepted separately; R11's canonical-client work remains independently gated.
Before any Playwright TS spec siblings land, discovery must become
generated-JS-only, and browser-evaluated code needs its own compiler boundary.
There is no full C1/C2 acceptance or release of unaccepted R1/R8 dependencies.

### Implementation record — R integration delivery

**Delivery verified by the integration lead on 2026-09-16.** Main
`266675059fda76ec2bd51b30dfe5e3714b724dd3` integrates the separately reviewed
R1, R2, R3, R6, R8, R10 and C1 native-canary sources and their attestation chains.
Integration is not blanket acceptance: the package dispositions below control.

**Local product proof:** strict source/drift/type/mode/lint checks over 265
compiler-owned sources, 1,041 backend tests (zero failures/skips), 291 browser
cases, all eight isolated UI scenarios and full desktop/mobile/multi-host UI
passed. Parent additionally exercised actual isolated native OMP export, Pi mood
and OMP sharing, routine HTTP admission/persistence, skill coverage, uninstrumented
pane transitions and real BridgeSession/SSE widget/input replay. Temporary
runtime scripts, fixture homes and browser/server processes were removed.
Complete records remain in `/tmp/pi-dish-parent-reset-local-result.json`,
`/tmp/pi-dish-parent-reset-core-smoke-result.json`,
`/tmp/pi-dish-parent-reset-native-results.json` and
`/tmp/pi-dish-parent-reset-browser-proof.json`.

**CI failure and correction:** the first exact-source
[run 35162106354](https://github.com/MrPink604/pi-dish/actions/runs/35162106354)
passed three backend jobs and every browser/scenario/UI step, but Node 22.x
returned `ELOCKED` in the existing concurrent-settings regression. Its child
timer did not guarantee release within the pinned SDK's bounded lock retry
window. Parent commit `272a338e0fe0292dfd5f45131890c1bcb273c3eb` changes only
that fixture: a real held lock produces the actual contention error, then the
competing snapshot is committed and released before the SDK's own retry.
The HTTP result and persisted merge assertions remain; no product retry policy,
lock result or assertion was weakened. Focused regression, strict checks and
all 1,041 backend tests passed again.

[Exact corrected-main run 35163287240 passed all five jobs and required steps](https://github.com/MrPink604/pi-dish/actions/runs/35163287240):
check/backend on Node 22.19.0, 22.x, 24.x and 26.x, and browser/scenarios/full UI
on Node 24. Parent inspected every mandatory step. The unauthenticated API
observer later returned HTTP 403; this was not a CI failure. Parent recovered
the final browser step conclusions and exact commit from GitHub's public HTML,
without credentials. Both the original failure and corrected proof are retained
in `/tmp/pi-dish-parent-reset-ci-result.json`,
`/tmp/pi-dish-parent-reset-ci-node22-failure.json`,
`/tmp/pi-dish-parent-reset-fixture-correction.json` and
`/tmp/pi-dish-parent-reset-corrected-ci-result.json`.

**Historical review boundaries at `272a338`:** the original frozen-source
approvals did not approve the parent-authored fixture correction. R1 and
dependent R4 were held for final-scope renewal despite unchanged product source.
R11 was not integrated or accepted: its same Kimi reviewer hit another quota
error while closing actual source/consumer/proof gaps, and its Astra owner
reported a usage limit. This record authorized no provider retry, substitution
or partial acceptance. Subsequent user-authorized renewal and integration are
recorded separately under R1 and R11 below; other package acceptance here stays
limited to its reviewed source and independently verified integration.

### Implementation record — R2

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0ab39-7c1b-768c-a142-60b465d84cca`, verified OMP
`openai-codex/gpt-6-astra`, High. Reviewed source:
`b70980d4a4c6b5ea6d8a8300e55c2c7a45ad0b90`; separate final attestation:
`1e621cd63712d67a14b90a81fe6ffe7c566b9e15`.

**Delivered:** one routine-input admission receipt carries the original input
and measured size; definition and invocation paths reuse established admission
and single-read storage contracts. It is deliberately not an immutable payload
snapshot. Original serialization, ordering, malformed values and ledger behavior
remain observable. [Evidence](r2-evidence.json) and
[review record](r2-review.json) retain the ownership/deletion ledger and limits.

**Review and proof:** parent verified the exact GLM, DeepSeek and Kimi
model/High/OMP provenance, same-source finals, contiguous archive hashes,
all eleven primary bodies, named consumers and decoded long proofs. Historical
superseded decisions, quota attempts, protocol deviations and the narrative
Kimi UUID typo remain disclosed; no full-protocol-compliance claim is made.
The token-bearing DeepSeek raw archive remains private; the redacted derivative
has a distinct identity and hash. No secret or raw protected archive is published.
Parent real HTTP checks exercised CRUD, 413-before-source admission,
404-before-size ordering, ledger retention and original-input serialization.
The exact corrected-main delivery gate above passed. No dependent package is
silently accepted by R2 acceptance.

### Implementation record — R3

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0ab39-725b-76e3-8133-95f93e585787`, verified OMP
`openai-codex/gpt-6-astra`, High. Reviewed source:
`3f68de7924c65a0feecbcd13d90a0e0cf0bee36e`.

**Delivered:** skill coverage derives the consumed projection in one pass and
reuses one covered-line set per mapped activation instead of repeatedly deriving
the same coverage. Current-version and exclusion policies remain with their
established owners. [Evidence](r3-evidence.json) and
[review record](r3-review.json) document retained checks and deleted duplication.

Parent independently verified all three exact-model/High/OMP whole-source
decisions, seven primary bodies, producer/browser consumers, archive integrity
and semantic closures. Earlier generated-preamble/render gaps and Kimi quota
history remain preserved, not counted as earlier passing reviews. Parent actual
mining-to-coverage execution and the complete corrected-main gates above passed.

### Implementation record — R6

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0ab39-6d9c-7296-b065-aa7eb90d56b9`, verified OMP
`openai-codex/gpt-6-astra`, High. Reviewed source:
`822db65d2c21e630f29727a641bd3b5649633c14`.

**Delivered:** one extension replay-state owner serves RPC/bridge consumers;
Pi private adapter behavior remains at its actual boundary instead of competing
server copies. Replay identity, answering/retirement and native adapter receiver,
coercion and error semantics remain preserved. [Evidence](r6-evidence.json)
and [review record](r6-review.json) retain the concrete deletion and boundary
ledgers, SDK consumer inventory and deliberately opaque values.

Parent audited all three exact-model/High/OMP same-source finals, twenty primary
bodies, twenty-two consumer/SDK windows, actual JSON frames and decoded proofs.
The same Kimi continuation closed previously incomplete reads; historical
partial decisions and quota errors remain. All three reviewer closures succeeded
and resolved inactive. One implementation-worker residual-process uncertainty
remains disclosed; no manual signal or false cleanup claim is made.
Parent production Chromium exercised real BridgeSession/SSE widget/input replay
across navigation and retirement of an answered dialog without a socket replay.
Native harness proof and corrected-main CI passed. **R7's server composition
dependency is released**; R7 still requires its own complete implementation,
runtime proof and review gate.

### Implementation record — R8

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0ab39-9dbd-7317-b73e-b0f8185783e8`, verified OMP
`openai-codex/gpt-6-astra`, High. Reviewed source:
`9d733a0e082cb6b44f95a1d7e02baf9b72e8aa09`.

**Delivered:** `main-pane.ts` owns named takeover/surface/overlay exclusion
policies; controller-owned close/dispose behavior is retained. The competing
peer lists and selection exclusion list are removed without a generic router
or close-everything policy. [Evidence](r8-evidence.json) and
[review record](r8-review.json) preserve the asymmetries and deletion ledger.

Parent audited the three exact-model/High/OMP same-source decisions, all assigned
authored/consumer bodies and decoded registration/commutation proof. Generated
review scope is the complete assigned delta, **not** the whole unchanged bundle.
Earlier missing-body decisions and the withdrawn all-pairs waiver remain
disclosed. Protocol deviations and protected token-bearing raw archive handling
are recorded without a full-compliance claim or publication of raw archives.
Parent uninstrumented desktop/mobile proof exercised ordinary takeover retaining
file/settings surfaces, recovery clearing them, selection retirement and usage
on a settled 390px viewport. Screenshots were inspected; interaction/transition
limitations are recorded. Corrected-main CI passed. **R9 may begin**, with
session-view ownership and controller-local retirement preserved.

### Implementation record — R10

**Accepted by the integration lead on 2026-09-16.** Owner:
`01a0ab39-942c-779f-b7a5-490b56e98c59`, verified OMP
`openai-codex/gpt-6-astra`, High. Reviewed source:
`86e7d24ebb5aaf83bd0de9186c39590e98c0d276`.

**Delivered:** browser model/thinking/rename mutations accept the captured
endpoint and identity explicitly. Per-mutation session-API construction and
ignored-host substitution are removed; controls retain selection ownership,
latest-operation ordering and original-session patching.
[Evidence](r10-evidence.json) and [review record](r10-review.json) retain the
caller/export/type-fixture cutover and preserved credential/base checks.

Parent audited all three exact-model/High/OMP finals, nine primary bodies,
twelve named caller windows and source-byte recovery of preexisting control
characters. This is not a claim to have reviewed all unchanged app/server code.
Historical partial decisions, quota history and protocol deviations remain.
Actual full browser and desktop/mobile/multi-host mutation scenarios and the
exact corrected-main gates above passed.

### Implementation record — C1 native-canary checkpoint

**Native-canary checkpoint accepted by the integration lead on 2026-09-16;
C1 remains open.** Owner: `01a0aacf-378b-7454-a8ed-c7c5422991b6`,
verified OMP `openai-codex/gpt-6-astra`, High. Reviewed source:
`24e444ceb81be9d796bac324962d376a6dc912d6`.

The actual `test/native-extensions.smoke.ts` body is checked in the existing
Node-only strict tools program, with sibling generated JS/declarations,
executable/shebang preservation and exact source/output/mode policy coverage.
Type-only edge declaration consumption does not add edge runtime emission.
[Evidence](c1-native-canary-evidence.json) and
[review record](c1-native-canary-review.json) distinguish this bounded checkpoint
from the remaining behavioral tests, fixtures, tools and browser-evaluated code.

Parent verified the two existing exact-model finals and the required new
Kimi/High/OMP reviewer, all seven source/output/config bodies and every byte of
the captured 198,218-byte validation log. The earlier sampled-log claim remains
superseded; Python JSON archive framing is not mislabeled JavaScript/JCS.
All three reviewers closed successfully and resolved inactive. Parent actual
isolated Pi mood and OMP share canaries passed, as did corrected-main CI.
Stable-contract C1 families could continue independently; this checkpoint did
not release the then-held R1/R11 or unfinished R4/R7/R9 families wholesale.
No full C1/C2 completion is claimed.

### Implementation record — R1

**Complete revised-source reviews and local integration verified; exact
pushed-main CI pending.** Reviewed source:
`5d1728abb1d35afb361ef400952da4a174a826b7`, branch `migration/r1-read-export`.
Its product source remains `453c409ab1d63eb269382bc38b33a930be466c6b`; the
genuine settings-lock correction is the one already delivered in `272a338`.
[Evidence](r1-evidence.json) and [review record](r1-review.json) keep historical
453, private 5d and integrated-main evidence distinct.

The same original OMP/High reviewers independently accepted the complete
15-path revised candidate: `zai/glm-5.3` final 260, transcripts 261 messages;
`opencode-go/deepseek-v4.1-flash` final 256, 257 messages; and `kimi-code/k3`
final 274, 275 messages. Parent verified actual whole primary bodies, seven
complete consumer files and the native SDK export unit. Finite continuations
closed diff-only test reads, missing dossier bytes, unchanged server-test
sections and JSON-escaped-only capture-helper evidence. Earlier premature
complete-scope claims remain superseded, not erased. All three final reviews
read the decoded executable helper; all three semantic closures succeeded and
resolved inactive. Private raw archives remain private.

Combined R1/R11 integration passed check (265 compiler-owned sources), all
1,044 backend tests with zero failures/skips, all 291 browser cases, eight
isolated scenarios and full desktop/mobile/terminal/multi-host UI. The serial
gate chain took 332.41 seconds; this is not an isolated UI duration. Complete
200,361-byte output is retained in
`/tmp/pi-dish-parent-r1-r11-full-gates.log`, SHA256
`33c9115596da34ff29da7475931afb39ecf260e822482b4d043634d5466352c5`.
Parent result: `/tmp/pi-dish-parent-r1-r11-local-gates.json`.
Formal acceptance and R4's final dependent release await exact pushed-main CI.

### Implementation record — R11

**Complete corrected-source reviews and local integration verified; exact
pushed-main CI pending.** Reviewed source:
`55ba88e50adf871d9b66e2264d6235499bea2610`, branch
`migration/r11-canonical-refs`. Both `e694d894` and its correcting `55ba88e`
were applied atomically; the rejected intermediate source was not delivered
alone. [Evidence](r11-evidence.json) and [review record](r11-review.json)
preserve the wrong-target counterexample and renewed decisions.

Canonical portable references are authored once in `src/core/helper-refs.ts`
and bundled into the standalone skill client. Shared/shadowed aliases are
rejected before prefix selection, preserving resolver stages, exact identity,
host capability policy and old-host fallback. No handwritten CLI copy or
runtime dependency on server modules remains.

All three exact-model OMP/High reviewers accepted the same complete corrected
16-path source: GLM final 378 (379 messages), DeepSeek final 286 (287 messages),
and the same user-resumed Kimi final 370 (371 messages). Parent audited actual
whole-file and decoded-proof coverage. Both generated ETX-containing lines
were verified bytewise: 68 bytes including newline, not empty strings.
Earlier rejected/partial decisions and quota failures remain historical.
All three reviewers were archived, audited and semantically closed.

Parent independently exercised seven first-party-discovered fixture identities
through the installed/symlink CLI (14 product/fallback resolutions), real HTTP
(seven emitted-reference roundtrips) and actual production browser copy-ref
menus (seven roundtrips). Shared native/UUID aliases and shorter/longer alias
pairs retained their requested identities; ordinary UUID shortening stayed
unchanged. The smoke used no application globals, live agents or lifecycle
requests. No native clipboard, harness-launch or macOS claim is made.
Proof: `/tmp/pi-dish-parent-r11-main-smoke-proof.json`; screenshot:
`/tmp/omp-sshots-1582a2f7c863a7cb.webp`. The browser, owned server, temporary
home and throwaway smoke script were removed. The complete combined local
gates above passed; exact pushed-source CI and formal acceptance remain pending.
