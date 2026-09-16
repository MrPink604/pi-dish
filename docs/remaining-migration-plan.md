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
