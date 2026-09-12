# Session catalog and metadata migration

Status: **planned, not implemented**. Assessed 2026-09-11 after browser source
completion. This is the next stage of the [roadmap](../BACKLOG.md), not a claim
that the current store or server already enforces these contracts.

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

Task 1 must settle exact declarations and compatibility cases before workers
change producers and consumers independently. Names below describe the intended
boundaries; reuse existing symbols where possible rather than introduce aliases.

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
