# Session catalog and metadata migration

Status: **Task 1 implemented; verification and delivery in progress** (2026-09-11).
The contracts, authority audit and isolated pre-migration baseline are recorded
[below](#task-1-record). Tasks 2–7 remain unimplemented. This is the next stage
of the [roadmap](../BACKLOG.md), not a claim that the current store or server
already enforces the new contracts.

## Mission and outcome

Use TypeScript to simplify the complete session read path, not just transpose its
JavaScript. A contributor changing a first-party metadata field should find its
producer, validation policy, permitted writers and consumers without recovering
implicit contracts from `server.js`, several renderers and browser globals.

The intended outcome is:

- One owner for source resolution and cache consistency, with explicit identity
  and provenance rather than path/string/candidate reconstruction at callers.
- Checked implementations of discovery, metadata accumulation, the index boundary
  and catalog composition; not declarations asserting unchecked implementations.
- Named first-party metadata carried from ingress through browser state and
  restricted patches. Invalid known values and misspelled patch fields fail
  compilation; renderers no longer repeat validation of already-established data.
- Existing API/store formats, lookup behavior, host/request ownership and bounded
  read performance preserved. Provenance and capability advice never become
  permission to control a process.

Success is measured across source, adapters, callers and tests together. Inventory
removed responsibilities and invalid writes prevented alongside source coverage
and verification; do not equate fewer lines in `server.js` with less complexity.

## Current seams and scope

| Boundary | Current implementation | Work in this stage |
| --- | --- | --- |
| Discovery and source identity | `lib/session-discovery.js`; `server.js` functions `sourceForIdentity`, `sourceForRead`, `resolveSessionCandidate`, `findSessionSource`, `refreshSessionFileCache` | Migrate discovery and consolidate source resolution/cache ownership. |
| Indexed metadata | `lib/session-files.js` functions `sessionInfoFromEntries`, `extendSessionInfoFromEntries`, `accumulateSessionInfo`; `lib/session-index.js` | Extract actual metadata accumulation into TS and migrate the index implementation without redesigning persistence. |
| Catalog and public projection | `server.js` active/historical/subsession builders, `buildSessionCatalog`, parent/routine annotations, list/search/client projection; `src/core/session-api.ts` | Checked catalog composition and explicit server/public metadata boundaries. |
| Browser ingress and state | `api-client.ts`, `host-session-loader.ts`, `sidebar-lists.ts`, `session-state.ts`, transcript/search decoding, activity and mutation writers | Decode incoming metadata, preserve the contract in state and restrict patches. |
| Browser consumers | Sidebar/header/view, session helpers and other metadata readers | Remove repeated type narrowing; retain display derivation and ownership checks. |

The current `SessionEntry` is identity plus `Record<string, unknown>`.
`patchSession('session', { model: 123, modle: 'typo' }, 'host')` passes strict
checking. `SessionMetadata` names only a subset of fields, and transcript metadata
is copied as a broad partial record. This is the concrete contract gap to close.

There are useful abstractions to extend, not replace: `activeSessionEntry`
already unifies bridge/RPC summary construction; capability policy already lives
in `session-capabilities.ts`; session state already owns selection generations.

### Explicit non-goals

- No whole-file `server.ts` conversion, framework adoption, global browser facade
  cleanup, general router framework or new repository/service abstraction layer.
- No close/resume/restart/recovery policy redesign, harness capability additions,
  extension migration or Electron/build/deployment change.
- No JSONL, index schema or external API format redesign. No universal schema for
  every harness event, tool argument, transcript block or extension payload.
- No wholesale transcript/parser migration. Keep the general JSONL parser,
  tree/message/stat/search/usage projections in `lib/session-files.js` where they
  are outside metadata accumulation. Adapt their source inputs and imports where
  the cutover requires it; do not claim those implementations are checked.
- No conversion of routine/provenance stores merely to read their annotations.
  Validate consumed snapshots at the catalog boundary; store authority stays put.

The index migration necessarily touches metadata/text/skills persistence code in
one module. Preserve its algorithms and narrowly describe/check the auxiliary
values it actually uses. This is not authorization to redesign search, usage,
pricing or skill mining. Remaining JS helper results enter as unknown and are
narrowed where consumed, not asserted to be validated by a handwritten signature.

## Shared contract decisions

Task 1's concrete declarations and compatibility decisions are recorded below.
Implementation workers must use these owners before changing producers and
consumers independently. Any discovered contract change returns to the integration
owner; do not invent a second schema or a peer-specific compatibility alias.

### Identity and source

- Reuse server `HarnessId`, `NativeSessionId` and `SessionId` distinctions. A
  `SessionSource` carries file, harness/profile, native identity, route identity
  and advisory provenance. Discovery candidates additionally carry traversal and
  identity-origin data. A path alone does not establish that identity.
- Distinguish discovered history from registered/RPC source observations without
  treating either a cached source or a type brand as a live ownership proof.
- Preserve raw Pi route bytes, encoded non-Pi identities, exact lookup for encoded
  IDs, legacy partial lookup only where currently allowed, ambiguous-header
  refusal and revalidation of generic `session.jsonl` identities.
- File/profile and route lookup indexes may remain separate. One component owns
  their consistency and invalidation; the objective is not one universal cache.
- The migrated index accepts explicit source descriptors, not bare file strings
  that silently default to Pi. Task 3 removes that legacy index input; Task 7
  converts every caller, including RPC fallback and search hits. Standalone
  low-level JS file readers may retain their existing path input, but catalog
  callers pass the resolved descriptor and never recover identity from that path
  or the removed side map.
- Keep the browser's host-qualified identity and `SelectionOwner` generation.
  Server brands do not magically validate strings received from remote peers.

### Metadata and field authority

| Category | Authority and representation |
| --- | --- |
| Server source/provenance | File, native id, session key, profile and process metadata belong to the server source/catalog, not browser mutation payloads. Preserve the default API and existing `view=client` omissions. |
| First-party session metadata | Name/model/cwd/thinking, harness identity/label, activity time, message/context counts and other consumed fields have explicit types and per-field absent/null rules. |
| Live/list facts | Registry/RPC observations and existing capability policy determine active/conflicted/subagent state and advisory controls. Live context usage keeps its existing precedence over history. A live nested child remains non-resumable. |
| Relationship/routine hints | Parent/source/family and routine/invocation fields are named, display-only annotations. Missing family hints differ from explicit null. They never grant cascade or process ownership. |
| Transcript refresh | A dedicated decoded patch contains the metadata the messages endpoint is allowed to refresh. Wire identity cannot retarget selection; registry-only list facts are not overwritten by historical metadata. Preserve current behavior, documenting any discrepancy before changing policy. |
| Local mutations/activity | Named patch types for acknowledged name/model/thinking changes and activity updates. No open index signature; identity is supplied as owner, not mutable fields. Stale reads and completed mutations retain their different publication rules. |
| Browser presentation | Host stamping/labels and query result annotations are explicit additions. Pins, unread state, collapse state, connection observations and provisional spawns keep their existing separate owners. |
| Opaque extras | Preserve compatible external extras, but keep them separate from authoritative named fields internally. They cannot enter a patch through a broad spread or shadow named metadata. |

Do not normalize every missing field to a default. Build a field matrix recording
producer, consumers, missing/null/empty/zero/false behavior and patch precedence.
Full rows and partial patches require different decoders: an omitted patch field
must not clear a value. Retain existing historical/live naming fallbacks, date
serialization and capability fallback policy. Browser peers may run older code;
server-generated complete capabilities do not justify requiring all flags on
incoming legacy responses.

Normalize once per external ingress, then store and pass the result. Revalidation
at a real trust boundary is necessary; repeating it in every renderer is not.
Display formatting and filtering still derive views. Avoid gratuitous object
copies, per-render normalization and new whole-file/corpus reads.

## Higher-level tasks

Tasks are implementation work packages, not seven promised commits. A package
may need several bounded review checkpoints; dependent source changes must ship
together when an intermediate commit would otherwise break the contract.

### Task 1 — Freeze contracts, authority and compatibility cases

**Owner:** integration lead. **Depends on:** nothing.

Audit the producer/writer/reader graph and existing tests. Record the field matrix
above, including search, transcript, stream/activity, resume and provisional
selection paths. Define the source/index/catalog interfaces and shared metadata
DTO/patch decoders. Extend `src/core/session-api.ts` and existing identity types;
place source/metadata-specific contracts with their intended implementation
modules rather than grow an unrelated omnibus contract file.

Agree the input snapshots and outputs needed by discovery, indexed reads and
catalog projection before parallel work starts. Document which snapshot fields
are validated and which lifecycle decisions are supplied by existing policy.
Inventory references with language-server support before modifying exports.

The integration lead captures the isolated representative-corpus performance
baseline in this task, before wave 2 changes implementations. Record fixture
construction, cold/warm list and route timings, active-only scan behavior and
ordinary append read/parse work so Task 7 can repeat the same measurements.
The field matrix must explicitly cover `lastActivity`: server Date values,
serialized wire strings and the existing browser numeric-timestamp tolerance.

**Acceptance:** contracts are reviewable, compile-time negative cases cover wrong
known types, misspelled patch fields and identity writes, and runtime compatibility
cases distinguish omitted/null/false/zero. Shared definitions have one owner.
No implementation is declared migrated because its interface now exists.

### Task 2 — Migrate discovery and source resolution

**Owner:** source-resolution worker. **Depends on:** Task 1.

Migrate `lib/session-discovery.js` to `src/core/session-discovery.ts` under the
existing generated CommonJS path. Implement the source-resolution/cache owner
(proposed `src/core/session-source.ts`) using the frozen interface. Move server
source reconstruction and historical route lookup into it, receiving current
registered/RPC observations through explicit inputs. Preserve bounded traversal,
header provenance, duplicate preference/ambiguity, nested discovery and strict
subsession-exit inspection used by lifecycle callers.

This worker also replaces the handwritten discovery `require` signature in
`src/core/rpc-session.ts` with a checked import from the migrated module. Task 7
regenerates `lib/rpc-session.js` and declarations along with the other outputs.

**Acceptance:** source callers no longer recover profile/identity via a hidden
path side map. Route/list refresh and generic-file revalidation share one owner;
existing cache purposes and lookup modes remain. No new permission follows from
a source result. Prepare the implementation and integration handoff; the lead
owns edits to `server.js` in Task 7.

**Existing coverage:** `test/session-discovery.test.js`,
`test/session-foundation.test.js`, source-resolution cases in `test/server.test.js`.

### Task 3 — Migrate metadata accumulation and indexed reads

**Owner:** metadata/index worker. **Depends on:** Task 1; consumes Task 2's agreed
source contract, not its implementation while developing independently.

Extract `sessionInfoFromEntries`, `extendSessionInfoFromEntries` and their actual
accumulation logic from `lib/session-files.js` into TS (proposed
`src/core/session-metadata.ts`). Move consumers to that implementation; remove the
obsolete implementation/exports rather than retain forwarding aliases. Preserve
the parser's physical-first-line marker and profile-specific name/model rules.
The remaining JS parser can supply unknown entries plus framing metadata; narrow
consumed fields inside the typed accumulator without reparsing or copying all
entries. Keep unrelated transcript readers and parser algorithms in place.

Migrate `lib/session-index.js` to `src/core/session-index.ts`. Type metadata cache
entries and source inputs, validate persisted metadata when it enters the typed
path, and retain existing invalid/stale-record rebuild behavior. Keep NDJSON
formats, schema/pricing freshness, append batching, truncation/rotation detection,
background budgets and the O(appended-bytes) update path unchanged. Preserve
copy-versus-borrowed cache semantics; context-window/percent derivation remains
read-time because the model catalog can warm after indexing.
Remove bare-string inputs from the migrated index; callers supply the agreed
source descriptor rather than receive an implicit Pi profile. Invalid persisted
metadata is stale and rebuilt through the existing bounded backlog. Do not bump
metadata/text/skills schema versions for a type-only migration or reject valid
legacy values merely because their internal representation differs.

**Acceptance:** catalog metadata comes from checked accumulation/index code;
remaining JS projections are explicitly unchecked boundaries. There is one
metadata accumulator for full and incremental reads, no added corpus pass, no
whole-file work on an ordinary append and no silent cache mutation by consumers.
This worker alone edits the metadata sections/imports of `lib/session-files.js`.

**Existing coverage:** `test/session-files.test.js`, `test/session-index.test.js`.

### Task 4 — Type browser metadata ingress, state and writers

**Owner:** browser-state worker. **Depends on:** Task 1. **Parallel with:** Tasks
2 and 3; uses shared decoders while the backend still serves compatible wire data.

Replace the open authoritative `SessionEntry`/patch boundary in
`src/browser/session-state.ts`. Update `api-client.ts`, `host-session-loader.ts`,
`sidebar-lists.ts`, `transcript-data.ts`, `search-data.ts` and the state-writing
paths in `transcript.ts`, `session-controls.ts`, `session-activity.ts`,
`message-stream.ts`, `session-view.ts` and resume/spawn reconciliation as needed.
Audit every writer, not only `patchSession`: list replacement, selection creation,
current-only transcript merges and partial fanout/hint retention all matter.

Do not promote search results or provisional spawns to full authoritative list
rows merely to satisfy a type. Preserve their separate shapes and explicit
conversion/navigation paths. Keep host stamping and captured endpoint/generation
checks, including after response-body reads. Separate external extras internally
without changing their wire representation or losing required feature data.

**Acceptance:** known metadata remains typed after entering state; mutation and
transcript patches cannot change identity or arbitrary fields. Omitted poll/patch
fields retain existing values where required; explicit null behaves distinctly.
Consumers receive the agreed typed interface, not an `as SessionEntry` escape.
Tasks 4 and 6 form one browser cutover and must not be shipped with broken readers.

**Existing coverage:** `test/browser-session-state.test.js`,
`test/browser-api.test.js`, `test/browser-host-session-loader.test.js`,
`test/browser-transcript.test.js`, `test/browser-search-view.test.js`,
`test/types/browser-state.ts` and browser ownership scenarios.

### Task 5 — Consolidate checked catalog composition

**Owner:** catalog worker. **Depends on:** Tasks 1, 2 and 3. **Parallel with:**
Task 6; the backend and browser share the already-agreed DTO, not mutable files.

Implement typed catalog composition (proposed `src/core/session-catalog.ts`)
using the source owner and indexed metadata. Migrate active/historical/live-child
builders, context overlay and parent/routine annotations from `server.js`;
extend the existing common active projection instead of introducing a second
one. Expose consistent list/lookup inputs for list, related/resolve and search
consumers. Reuse metadata projection for transcript responses where applicable;
do not route every read through a full catalog scan.

Receive validated live observations and precomputed capability/ownership advice
from existing lifecycle code. Leave process/tmux proofs there. Keep conflicting
bridge visibility versus controllability, RPC fallback, stable activity ordering,
active-only scan avoidance, historical indexing flags and live-child resume gates.
Preserve query-specific enrichment and default API versus client projection.
The existing `getActiveSessions` computes some advice inline. Task 7 separates
those existing policy calls from row construction and supplies their results;
the catalog worker must not move the process/tmux proofs into the read model.

**Acceptance:** source and metadata assembly have one checked owner; server route
handlers no longer independently construct divergent first-party session shapes.
No broad data-store or lifecycle migration is hidden inside catalog dependencies.
Prepare exact removals/callsite changes for the integration lead, not concurrent
edits to the large server file.

**Existing coverage:** `test/server.test.js`, `test/session-api.test.js`,
`test/session-provenance.test.js`, relevant bridge/RPC and lifecycle suites.

### Task 6 — Remove redundant browser metadata normalization

**Owner:** browser-consumer worker. **Depends on:** Task 4's implemented store and
writer contract. **Parallel with:** Task 5 (or unfinished Tasks 2/3).

Update `sidebar-render.ts`, `session-header.ts`, `shared-helper-types.ts` and the
metadata consumers in session/query/ref helpers, rendering and feature controls.
Audit remaining references; this list is a starting map, not permission to leave
other consumers on a broad record. Remove repeated record/string/number narrowing
of established first-party fields. Retain distinct search/helper/provisional row
shapes where they serve genuinely different contracts; use narrow typed inputs
rather than make all of them one enormous session interface.

**Acceptance:** header/sidebar share established field types, render-time work is
presentation rather than re-decoding, and no existing authority/request guard was
removed as 'duplication'. Keep the classic app/global facade unchanged in this
stage except for necessary typed wiring; its removal is separate roadmap work.

**Existing coverage:** `test/browser-sidebar-render.test.js`, helper/type fixtures,
`test/browser/session-identity.spec.js`, `test/browser/session-controls.spec.js`,
`test/browser/sidebar-lists.spec.js` and family/search/multi-host UI scenarios.

### Task 7 — Integrate the cutover and prove the simplification

**Owner:** integration lead. **Depends on:** Tasks 2–6.

Own all shared `server.js` edits: replace source adapters, catalog builders and
cache coordination with the new owners; migrate read consumers including
messages/stats/export/search/usage/skills and lifecycle source lookups. A lifecycle
caller may use the new read source but must still independently prove ownership.
Do not turn every read into catalog construction or change its tree-leaf behavior.
Convert every bare-path index call, including active RPC fallback and search-hit
reads, to the agreed source descriptor. Adapt remaining JS reader calls without
changing their standalone path API or recreating a hidden source lookup.

Own shared exports/build inputs, generated `lib/*.js`/`.d.ts` and `public/` assets,
and any unavoidable `app.ts` wiring. Update all in-repo callers of removed exports;
remove obsolete implementations, side-map adapters and compatibility aliases.
Preserve supported external API/helper entrypoints that are not obsolete internal
migration scaffolding. Resolve shared type/test changes here rather than having
parallel workers overwrite generated files or shared fixtures.

**Acceptance:** the whole path works against real generated output, all mandatory
invariants below are exercised, and the delivery record names deleted competing
owners/adapters and remaining unchecked boundaries. No stubs or temporary shims
remain. Update roadmap/guide status only for delivered scope; seek the authorized
external review, resolve findings, then push and check the exact commit's CI.

## Dependency and parallelization plan

```text
Task 1: contracts + authority + compatibility cases
  |
  +-- Task 2: discovery/source ------+
  |                                 +-- Task 5: catalog -------+
  +-- Task 3: metadata/index --------+                          |
  |                                                            +-- Task 7
  +-- Task 4: browser ingress/state ---- Task 6: consumers ------+
```

- **First wave:** Task 1 is serial. Do not let separate workers invent competing
  DTOs, normalization defaults or source/cache interfaces.
- **Second wave:** Tasks 2, 3 and 4 can run concurrently after contract freeze.
  They own separate implementation files. Task 3 owns the limited
  `lib/session-files.js` edits; Task 4 owns browser state and writer files.
- **Third wave:** Task 5 starts once source/index implementations are available;
  Task 6 starts once browser state/writers are ready. Neither waits on the other.
  These are dependency edges, not a requirement to wait for the entire second
  wave before any ready task proceeds.
- **Integration:** Task 7 alone edits shared server wiring, exports, generated
  assets and shared fixtures. Contract changes discovered mid-flight return to
  the lead for one coordinated update, not peer-specific aliases or casts.
- Workers skip builds, lint and tests while overlapping changes are in flight.
  The lead assembles coherent checkpoints, regenerates output and runs the
  applicable checks once per integrated checkpoint, then reviews and delivers.
  Tasks are not independently deployable when their contract consumers are still
  being migrated. Do not ship an intermediate build requiring missing modules.

## Verification and delivery gates

Use [the testing matrix](testing.md), existing isolated fixtures and temporary
homes/sockets/tmux servers. Do not test against live agent sessions or provider
credentials. Extend focused regressions only for plausible gaps; adapt behavioral
assertions rather than pinning implementation wiring or adding redundant tests.

Required evidence for this stage:

1. **Type boundaries:** wrong known metadata types, misspelled patches and identity
   writes fail compile-only checks. Valid omitted/null patches remain expressible;
   genuine unknown extension data is still representable outside those patches.
2. **Source correctness:** Pi/non-Pi collisions, encoded exact versus legacy
   partial routes, ambiguous generic/nested identities, deleted/replaced files,
   discovery truncation and list-to-route cache refresh retain behavior.
3. **Data precedence:** registry/RPC versus history, live children, family/routine
   hints, client omissions and default responses, and transcript-only updates
   preserve their documented authorities and absent/null/zero/false semantics.
4. **Browser ownership:** same native/session id on two hosts, delayed metadata
   responses, repeated selection, credential/endpoint changes and completed
   mutations cannot retarget state. Search/provisional rows and malformed peers
   do not bypass ingress or overwrite authoritative fields through extras.
5. **Read/index performance:** existing append/restart/truncation tests plus an
   isolated representative-corpus smoke show no added full scans for active-only
   polls or full-file parsing on ordinary append. Compare cold/warm list reads and
   route resolution to a pre-change baseline; record corpus and measurement method,
   not a promised speedup. Preserve borrowed/copy cache semantics and tree readers.
6. **Integrated delivery:** regenerate with `npm run build:core` and
   `npm run build:browser`; run `npm run check`, full `npm test`, browser
   regressions, independent UI scenarios and desktop/mobile smoke against those
   outputs. Observe actual browser behavior in the changed list/header path.
   Report skips; use lifecycle canaries when their supported execution path is
   affected. Follow existing review requirements and verify CI for the exact push.

The final record must state which source reconstruction/normalization paths were
deleted, which module owns each formerly competing responsibility, and what is
still JavaScript or opaque. If it only reports converted files and green tests,
the expanded simplification mission has not yet been demonstrated.

## Task 1 record

The beelink planning session ended with a Task-1-only handoff. This checkpoint
implements that foundation, following a pull/rebase onto `7938ac5`; it does not
cut over state, index or catalog consumers. The original dependency graph stands.
This document is the maintained plan; the remote transcript is not a second work
queue. All references below were audited in the current source, using repository
reference searches (no language-server reference tool was available).

### Concrete interfaces and handoff

| Owner | Delivered declarations / implementation | Next consumer |
| --- | --- | --- |
| `src/core/session-api.ts` | Closed `SessionFields<Timestamp>`, `SessionRow`, mutation/activity/transcript patch types; real `decodeSessionRow` and three patch decoders | Task 4 ingress/state and Task 6 consumers |
| Existing `SessionMetadata`, `decodeSessionMetadata`, `decodeSessionList` | Existing open wire compatibility boundary retained until the browser cutover; capability validation now has one implementation shared with the closed decoder | Current server/browser; remove the open internal dependency in Task 4 |
| Existing `sessionForClient` | Same eight private-field omissions; typed `CatalogSession` overload preserves pre-JSON `Date` values | Task 5 projection; Task 7 server wiring |
| `src/core/session-source-contracts.ts` | `SessionSource`, `DiscoveryCandidate`, `DiscoveryResult`, `DiscoveryOptions`, `LiveSourceObservation`, `SourceLookup`, `SessionSourceResolver` | Task 2 implementation; Task 3 explicit index arguments |
| `src/core/session-metadata-contracts.ts` | `SessionInfo`, physically framed `SessionEntries` with unknown entries | Task 3 accumulator; parser remains an unchecked ingress |
| `src/core/session-index-contracts.ts` | `SessionMetadataIndex`: catalog-only scan, single-info and search-text port | Task 3 index; Task 5 catalog |
| `src/core/session-catalog-contracts.ts` | `CatalogAdvice`, live/history snapshots, routine annotations, `SessionCatalogInput`/`SessionCatalogOptions`, `CatalogSession`, `SessionCatalog` | Task 5 composition; Task 7 validated ingress/lifecycle advice |

The `*-contracts.ts` modules declare **future implementation ports**, not checked
signatures for today's JS. They intentionally do not occupy `session-index.ts`,
`session-discovery.ts` or `session-files.ts`: the flat core build would overwrite
those live CommonJS files with empty output. Generated declarations and the small
type-only module outputs are committed normally. Move ownership only when the
real implementations migrate; do not install forwarding stubs.

`SessionFields` has no index signature. `SessionRow` keeps `id`, `fields` and
`extras` separate; host identity belongs to the answering browser endpoint.
The existing open `SessionMetadata` derives its already-validated subset from
`SessionFields`, avoiding a second definition of those field types. The browser
store remains open for now: the new negative tests prove the **new contract**,
not a completed store cutover.

Source callers supply file, harness, parser profile/version, native id, encoded
session key, canonical route id and nullable structural parent path. Native and
route roles reuse existing brands; Pi's route id remains raw while its
`sessionKey` is encoded. Discovery adds workspace directory, depth and identity
origin. Discovery options retain default Pi/optional descriptor or harness-id
selection, set/array exclusions and optional parser profile/version overrides;
they do not establish identity or relax header validation. Live
observations may lack a file; only the resolver produces a usable source.
The registry adapter supplies the currently selected unambiguous claim,
then the Pi RPC fallback. Conflicted observations remain visible to catalog
composition with precomputed control flags disabled.

`SourceLookup.route` retains the original bytes even for encoded Pi aliases:
canonicalizing too early would incorrectly enable legacy substring lookup.
`discover: false` checks only live inputs. The future resolver owns all route
aliases and profile/file consistency; refresh replaces discovered route entries,
including on partial enumeration. Invalidation retires aliases for the file.
It must revalidate generic-header identities against discovery before returning
cached paths. A deleted/replaced file or changed live source cannot stay reachable
through an old side map. Bounded caches may remain separate under this owner.

`SessionMetadataIndex.scanSessions` returns borrowed readonly metadata. Its
observations can change after another index operation; copy before retaining a
catalog snapshot. `getSessionInfo` returns a new shallow copy, throws for an
unreadable file and strips usage/internal identity; `getSearchText` retains the
current empty/cached-text error policy. These methods require `SessionSource`,
never a path string. Auxiliary indexed usage/skills/text records remain Task 3's
implementation-owned contracts; this catalog port does not falsely type them.
Task 3 must validate their consumed fields without adding a second JSON pass.

`SessionCatalogInput` receives captured live/history observations, launch-parent
and routine maps, and the indexing/truncation flags. History observations retain discovery directory
metadata for Pi's cwd fallback. Task 5 owns naming, context overlays, native vs
launch ancestry and routine projection; Task 7 gathers filesystem/store inputs
and computes `CatalogAdvice` through existing policy. The live observation's
explicit harness/native identity remains available even without a source file.
Its separate `claimedFile` preserves the registry/RPC path even before the file
exists: live `sessionFile` comes from this claim, while structural parent fallback
still requires a resolved source. A missing source must not erase the claimed path.
Live metadata and indexed info are separate inputs so their precedence belongs
to the catalog, not an adapter. Options supply descriptor labels/layout, read-only
canonical-path/directory-existence probes, and the existing read-time model-window
lookup policy; its results never enter persistence. Probes keep path derivation
inside composition rather than duplicating it in a preparatory server adapter.
Catalog maps/arrays are readonly; their data is not lifecycle authority.
The related route's off-catalog lookup uses local copies/overlays of `byId` and
`byPath`; it must not mutate the catalog snapshot. `list` supplies the ref resolver's
flattened active-first view (then previous and any active-only children, once each).

### Producer → writer → consumer inventory

| Boundary / current functions | Authority and next change |
| --- | --- |
| `session-discovery.js`: candidate decoration, harness/subsession walks, header cache | Descriptor selects parser/layout; basename or validated header identifies history. Task 2 migrates actual traversal and resolution. |
| `server.js`: `sourceForIdentity`, `sourceForRead`, `resolveSessionCandidate`, `findSessionSource`, `refreshSessionFileCache` | Registry → Pi RPC → historical lookup precedence; file side map and route cache currently compete. Task 2 owns consistency, Task 7 deletes server adapters and converts every caller. |
| `session-files.js`: full/incremental metadata accumulator; `session-index.js`: scan/get/append/load | Physical-first-line header identity; shared metadata/usage/text/skills read; borrowed scan versus copied single-info result. Task 3 migrates actual code and persisted ingress validation. |
| `server.js`: `activeSessionEntry`, `getActiveSessions`, `getPreviousSessions`, `subsessionSessionRows` | Live bridge/RPC precedence, historical naming/cwd and bounded live-child reads. Task 5 supplies shared checked row construction. |
| `server.js`: `annotateSessionParents`, `annotateSessionRoutines`, `buildSessionCatalog`, list/resolve/related/search | Canonical existing path lineage outranks launch hints; routine ledger supplies display annotations. Query enrichment remains query-specific. Task 5 owns projection, Task 7 wires routes. |
| `sessionForClient` → `/api/sessions?view=client` → `api-client.ts` | Default API preserves provenance; client projection removes eight private fields before JSON. Existing decoder validates a subset; Task 4 installs the closed row decoder after serialization. |
| `host-session-loader.ts`, `sidebar-lists.ts` → `setSessionLists` | Endpoint/query generation owns fanout/cache publication; active-only child merging and family-hint retention happen per host. Omitted hosts retain their cached lists. |
| `session-state.ts`: list replacement, selection creation, detached selection refresh | Host stamping and selection generations remain the owners. Lists replace rows; selected metadata merges only the new row's present fields. Task 4 must update every writer. |
| `/messages` → `transcript-data.ts` → `transcript.ts` → `mergeCurrentSession` | File metadata plus live context overlays refresh selected header only. Request and selection guards survive body reads. List facts stay registry-aware. |
| `session-controls.ts` acknowledged rename/model/thinking mutations | Host/session/field mutation sequence controls publication even after navigation; selected-view feedback additionally requires selection ownership. Task 4 narrows mutation patches. |
| `message-stream.ts` → `session-activity.ts` → `patchSession` | Owned stream/turn events write `turnInProgress`/`compacting`; they do not acquire registry or capability authority. |
| `search-data.ts`, `search-view.ts`, `session-view.ts`, `session-resume.ts` | Search result navigation and resume are captured host/view operations; they refresh/find authoritative lists before selecting/hydrating. Search rows are not full list rows. |
| `session-spawns.ts`, provisional views and composer reconciliation | `PendingSessionSpawn` is a separate host/operation-keyed shape. Ready status still waits for the owning host's authoritative list before transferring drafts/selection. |
| `sidebar-render.ts`, `session-header.ts`, helper session/query/ref modules | Today independently narrow common metadata. Task 6 removes that validation after Task 4 retains the closed fields. Presentation defaults, family grouping and capability fallback remain. |

### First-party field authority and compatibility matrix

The table is exhaustive for `SessionFields`; all fields are optional at legacy
wire ingress. Unless specified, malformed optional presentation values are
omitted by the new decoder, **not defaulted into a patch**. `undefined` means
absent. Strings preserve `''`; finite numbers preserve `0`; booleans preserve
`false`. A listed nullable string/timestamp preserves explicit `null`; other
nulls are malformed. Existing live/history producers still apply their own
fallbacks before ingress. No decoder invents live status, identity or capabilities.

| Fields | Producer / precedence | Representation and presence | Consumers / permitted writers |
| --- | --- | --- | --- |
| `name` | Bridge name → metadata name → `New Session`; RPC state name → `New Session` (not file-name fallback); history/live child handle → metadata → native-id prefix | string/null; accumulator explicit later names win over first-user fallback; empty live names fall back; wire empty/null preserved | Sidebar/header/refs/query; list, acknowledged name mutation, selected transcript |
| `model` | Bridge model → metadata; RPC formatted state/model (not metadata); history metadata; final row fallback `unknown` | string/null at wire; OMP combined ref versus Pi `modelId` retained | Header/selectors/query; list, acknowledged model mutation, selected transcript |
| `thinkingLevel` | Registry/RPC state; historical rows normally omit it | string/null; active empty becomes null; omission does not clear selected metadata | Thinking control; list and acknowledged thinking mutation only |
| `harnessId` | Server descriptor/route identity | nonempty string at wire, including future peer harness names; known server harness union internally | Badge/capability/settings routing; authoritative list only, never metadata patches |
| `harnessLabel` | Descriptor label | string; empty preserved at ingress, presentation has its fallback | Badge/sidebar; list only |
| `capabilities` | Existing capability policy plus live conflict/close/restart advice; live nested children force resume false | Partial boolean map at peer ingress, including future flags; absent flags stay absent; invalid entries reject the row | Controls retain existing missing-flag fallback; list only, never transcript/activity/mutation |
| `closeMode` | Harness descriptor (RPC common default `logical`) | string permits existing/future peer modes; empty preserved | Close UI; list only; actual close policy remains server-owned |
| `conflicted` | More than one live bridge instance | boolean, active projection defaults false | Controls/debug consumers; list only |
| `liveInstanceCount` | Grouped registry count; RPC/common fallback 1 | finite number; wire zero retained even though producer's fallback uses `|| 1` | Control metadata; list only |
| `contextTokens` | Live usage nullish-preferred over indexed tokens for bridge and transcript; RPC usage; history index | finite number, zero meaningful; compaction resets indexed tokens | Header/sidebar; list and selected transcript |
| `contextPercent` | Live usage if present (rounded), else read-time tokens/window; bounded historical derivation | finite number, zero meaningful | Header/sidebar; list and selected transcript |
| `contextWindow` | Truthy live window → current model catalog/fallback; historical builder currently omits despite deriving it | finite number, zero retained at ingress; never persist read-time model derivation | Context display; list and selected transcript |
| `messageCount` | Indexed user-message count for bridge/history; RPC state count | finite number; zero preserved (no new integer/coercion requirement) | Metadata readers; list and selected transcript |
| `lastActivity` | Accumulator max of file mtime and valid entry timestamps; bridge metadata → stable registry update → epoch; RPC last-activity clock | Server Date/string/number; wire string/number/null, including numeric 0 and empty string; no Date asserted to be a serialized value | Sorting/unread/labels; list and selected transcript |
| `cwd` | Bridge cwd → metadata; RPC cwd; historical metadata → existing decoded Pi workspace dir; transcript file metadata | string/null; live empty becomes null; wire empty/null preserved | Grouping, header, file actions; list and selected transcript |
| `isActive` | Registry/RPC list composition; transcript route's current registered/RPC observation | boolean; false meaningful; missing capabilities do not imply active | Header/selection/controls; list and selected transcript only (selected scope preserves current behavior) |
| `turnInProgress`, `compacting` | Registry/RPC booleans and owned stream/activity events | booleans, false clears; omission does not clear | Status/unread/abort; list and activity patches |
| `subagentLive` | Bounded live-parent subtree plus terminal exit inspection | boolean; true does not imply working or independently controllable; active-only merge clears missing children to false | Sidebar/family/resume; list/child reconciliation only |
| `parentId` | Canonical existing native/layout parent → launch provenance, self-parent suppressed | string/null; missing and explicit null remain distinct in decoded data; see active-only exception below | Family/refs; list/hint reconciliation only |
| `parentSource` | Native/layout source or `pi-dish-launch` | string/null; travels with retained parent hint | Family presentation; list/hint reconciliation only |
| `familyParentId` | Resolved parent only when parent/child cwd group matches | string/null; missing/null retained distinctly by decoder | Family grouping/pins; list/hint reconciliation only |
| `routine`, `routineId`, `routineInvocationId` | Invocation ledger annotation; rows without a matching invocation omit them | strings, empty retained; absent does not manufacture a null clearing patch | Routine chip/filter/refs; list only |
| `searchSnippet`, `searchScore` | Query-specific server metadata/content matching and ranking | string and finite number respectively; empty/zero preserved | Sidebar query display/order; enriched list only |

Identity/private fields are intentionally outside `SessionFields`:

| Field | Authority / representation / handling |
| --- | --- |
| `id` | Server canonical route, nonempty peer wire string; required own property for closed row ingress. Never a metadata patch. |
| `host`, `hostLabel` | Answering endpoint and local host directory, not a peer row. Closed ingress discards forged values; Task 4 stamps them in state. |
| `sessionKey`, `nativeSessionId` | Explicit source identity/brands in server catalog. Default API exposes them; client projection omits them. |
| `profileId`, `profileVersion` | Harness descriptor/source; string/number; historical rows include them, active rows may omit. Client projection omits both. |
| `sessionFile` | Live registry/RPC-claimed path, even before the file exists; discovered file for history; otherwise null. Never identity or ownership by itself. Default API includes, client projection omits. |
| `parentSession`, `parentSessionSource` | Accumulator's native header lineage then structural OMP fallback; string/null. Client projection omits. Catalog annotations derive public parent hints. |
| `pid` | Live registry/process observation; number/null, absent in history. Client projection omits; process control still requires independent birth/token proofs. |
| `sessionId` inside file metadata | Nonempty native **header hint**, string/null; never a route id or overwrite of selected identity. The index's legacy generic-path conversion is removed only with explicit-source caller cutover. |
| Unknown extension fields | Default/client flat wire extras remain compatible through the existing projection. Closed ingress stores extras separately; known malformed fields cannot re-enter through extras, and nested opaque fields cannot write metadata. |

### Explicit policies and discrepancies found by review

- **Full row vs patch:** full closed ingress requires an id and preserves the
  old fatal checks for name/model/thinking, harness, active status and capability
  maps. Newly named malformed presentation fields are omitted. Restricted patch
  decoders ignore out-of-authority fields, reject malformed permitted fields,
  and preserve omitted/null/empty/zero/false semantics. Compile-only callers also
  reject misspelled fields. JSON patches cannot write id, host, family, capability
  or extension data through these writers.
- **No universal merge policy:** list arrays replace rows; the detached selection
  merges present fresh fields. A transcript patch updates only that selection.
  Completed mutation publication uses captured host/session/field order and
  current endpoint checks, while UI feedback uses selection generation too.
  Rename/model/thinking all follow that same policy; do not add a blanket
  selected-view gate to a completed mutation's list update.
- **Family-hint exception:** `mergeActiveHints` currently tests falsiness, so an
  active-only poll retains old parent/family hints on omission, null **or empty
  string**. Preserve that explicit callsite policy in Task 4; the shared decoder
  itself must not erase the distinction. Full-history refresh still replaces
  authoritative hints.
- **Malformed peers:** current sidebar/header narrow fields differently (for
  example truthiness for some activity flags, exact booleans elsewhere). The new
  contract chooses exact booleans and finite numeric presentation fields, with
  invalid optional values absent. This does not change today's UI: the decoder
  is not wired into state until Task 4. That cutover must test these documented
  malformed-peer differences instead of claiming every invalid value is unchanged.
- **Transcript authority:** current broad merging admits unused header/provenance
  extras. The new transcript contract keeps the actual selected display fields
  and selected `isActive`, but excludes harness identity, family/routine hints
  and capability advice. Task 4 removes that broad write boundary; Task 6 must
  not reintroduce access by spreading extras into a row.
- **Cache revalidation gap:** current `findSessionSource` rediscovery is special
  cased to basename `session.jsonl`. OMP header-identified nested files have other
  basenames. Task 2 must review that case with the existing ambiguity tests;
  list identity and route identity must agree for **all header-derived sources**.
  Add a focused changed/ambiguous nested-source regression if current coverage
  does not exercise route-cache reuse. This is a required source-owner correction,
  not a license to change legacy basename partial lookup.
- **Persisted metadata:** JS accumulation currently trusts several truthy raw
  entry values. Task 3 narrows those fields in the actual accumulator and treats
  invalid persisted output as stale. It must preserve valid legacy Date revival,
  profile naming, counters and usage availability. No metadata/text/skills schema
  bump is justified by this type migration alone.

### Reproducible pre-migration baseline

Run `node scripts/session-catalog-baseline.js` from the repo root. The retained
[measurement artifact](session-catalog-baseline.json) was captured on Linux x64,
Node v26.7.0, before any source/index/catalog implementation changes. The utility
uses separate temporary server processes for routes, active polling and lists.
It uses the existing environment sanitizer plus a strict environment allowlist,
temporary HOME/XDG/tmux directories, ephemeral loopback ports, and synthetic
registry/process observations. It never opens a live harness session. Model
enumeration is held at an empty offline catalog; model-window fallback code still
runs. Cleanup closes the server and removes fixture homes, including normal
process-exit failures.

Each process creates the same **257 files / 14,046,770 bytes**: 80 sessions each
for Pi and OMP across four workspace directories, 80 flat Prime sessions, eight
generic nested Pi sessions, eight OMP children under one synthetic registered
parent, and one 6,000-message Pi transcript. Ordinary files contain 24 alternating
user/assistant messages. The append adds one parent-linked user entry of 130 bytes.
The sync index budget is the unchanged default 20.

Server startup currently scans known workspaces to seed skill mining. To keep
that startup work from prewarming or overlapping request measurements, each
server boots against its empty temporary home before the fixture corpus appears.
Thus these are cold **request/index** measurements, not cold process startup or
cold OS page-cache benchmarks. Fixture writes leave the filesystem page cache warm.

| Experiment | ms (one observation) | History directory opens / live directory reads | Full reads / range reads | Corpus bytes read | Index parse calls / bytes | Returned state |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Cold encoded Prime route + transcript tail | 28.954 | 1 / 0 | 2 / 0 | 55,472 | 1 / 27,736 | 24 messages; one-message page |
| Warm same route + transcript tail | 3.090 | 0 / 0 | 0 / 0 | 0 | 0 / 0 | Same result |
| Cold active-only list | 26.376 | 0 / 1 | 9 / 17 | 619,533 | 9 / 249,925 | 1 active, 8 children, no history |
| Warm active-only list | 4.674 | 0 / 1 | 0 / 0 | 0 | 0 / 0 | Same result; 33 corpus stats |
| Cold bounded full list | 32.348 | 20 / 1 | 23 / 25 | 1,139,453 | 23 / 638,773 | 1 active, 20 previous, indexing true |
| Fully indexed warm list | 9.088 | 20 / 1 | 0 / 0 | 0 | 0 / 0 | 1 active, 256 previous, indexing false |
| Persisted-index reload list | 18.240 | 20 / 1 | 0 / 0 | 0 | 0 / 0 | Same full result; 305 corpus stats |
| Ordinary append, index metadata read | 0.360 | 0 / 0 | 0 / 1 | 130 | 1 / 130 | User-message count 3,001 |

Counters wrap real synchronous filesystem methods for fixture corpus paths;
index parse counts wrap the real `parseSessionEntries` export before the index
captures it. They do not count index-log/module reads or the general transcript
parser's internal calls. Byte reads include discovery headers and tail reads;
full reads are not double-counted as range reads. HTTP counters stop at response
finish so background work during client JSON draining is excluded. Timing includes
the local HTTP roundtrip and JSON decoding. The cold-list total can exceed the
historical budget because live metadata and work before response finish are also
counted; the returned initial partial list is recorded separately from completion.

The persisted test flushes logs and resets index memory in the same process;
it does not reset every discovery/parser/model cache or simulate a host reboot.
Route timing deliberately includes lookup plus transcript projection, since that
is a supported server endpoint; it is not a microbenchmark of `findSessionSource`.
No timing is a pass/fail threshold or promised speedup. The structural baselines
are: no historical traversal for active-only requests, no corpus read on warm
list/route reads, and exactly appended-byte work for an ordinary index append.
Task 7 repeats this exact utility, records environment/corpus and compares those
structures before interpreting timing. After parser extraction, move only the
instrumented parser reference if its real ownership/export changes; keep the
experiment and the remaining general transcript read distinct.

### Verification and implementation readiness

- Compile-only negatives in `test/types/core.ts` are included by the existing
  `tsconfig.check.json` and exercise generated declarations: wrong metadata type,
  typo/identity/capability patches, native/route role confusion, bare-path index
  input and mutation of borrowed scan metadata. Server Date and wire-only
  timestamp distinctions are checked separately.
- `test/session-api.test.js` adds runtime cases for partial/future capabilities,
  malformed rows, own identity, null/empty/zero/false, patch filtering and opaque
  keys that could otherwise shadow known fields or object prototypes.
- Core and browser assets regenerated; `npm run check` and focused contract tests
  pass. Full `npm test`: **942 passed, zero skipped**. Focused browser API suite:
  **3 passed**. All 22 local links across the three migration documents resolve;
  `git diff --check` passes. The baseline was rerun after cleanup improvements.
- Fable 5.1 reviewed `74237c2` and found one missing handoff input: a live row's
  claimed file path when history has not been created. The correction adds
  `claimedFile` separately from resolved source and a compile-only pending-history
  case. Review also clarified filesystem probes, readonly related-route overlays,
  flattened ref-list output and discovery profile overrides. Correction re-review
  is pending.
- This checkpoint does not change UI/state behavior. Independent UI scenarios,
  full desktop/mobile smoke and opt-in OMP/Prime lifecycle canaries were not run;
  they remain gates for the actual cutover. External review/push/CI results will
  be recorded here after completion.

Tasks 2/3/4 now have concrete shared inputs; they may proceed independently after
this checkpoint clears delivery review. Task 5 consumes Tasks 2/3; Task 6 follows
the implemented Task 4 writer contract. One integration owner still owns shared
server wiring, generated assets and the coherent browser cutover. The source
resolver, discovery, index, accumulator, catalog builders and browser store are
**not migrated** by this checkpoint. The only runtime deduplication so far is
shared capability-map validation; the large competing owners and renderer
normalization remain explicit deletion work in Tasks 2–7.
