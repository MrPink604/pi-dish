# Browser contract cleanup

Status: **Implemented, locally verified and implementation-reviewed**
(2026-09-15). This is Stage 1 of the three-stage sequence.
Stage 2 is [shared runtime helpers](shared-runtime-helpers.md); Stage 3 is
[session lifecycle migration](session-lifecycle-migration.md).

Plan review: **APPROVED** by Anthropic Fable 5.1 at high effort for the clarified
plan at `9dee6d3`; [signoff and observation resolutions](../BACKLOG.md#next-stage-plan-review).
Implementation commit `811d473129c50df9b93dfb1a2f3ceb843b50400c` received
**APPROVED** from Fable 5.1 at high effort with no blocking findings.
The [implementation report](browser-contract-review-2026-09-15.json) records
the six nonblocking observations and the reviewer's verification limitations.

Planning baseline includes the recursive family/subagents changes in `6e8df16`
and `e816d36`; the trace-peek renderer is an affected consumer, not deferred work.

## Implementation record

- Session getters, lookup/selection returns, lists, fields and capabilities expose
  readonly views. `MutableSessionEntry` and `MutableSessionLists` are private;
  `publishSession` uses the private `publishedRows` WeakMap to detach external
  rows and capability maps once and recognize store-owned rows. Opaque extras
  remain borrowed. Selection remains a separate row.
- `setSessionLists` returns ordered published host lists. The sidebar rebinds each
  loader cache with `retainPublished`; failed/partial fan-out reuses store-owned
  rows without rolling back acknowledged patches or adding a metadata writer.
- `TranscriptPage` carries readonly `RenderMessage` rows through rendering, mood,
  streaming and response details. HTTP, SSE and independent trace-peek ingress
  decode once; nine downstream decoder calls and impossible guards are deleted.
  First-party nested fields are readonly, and ingress detaches mutable `Date`
  timestamps. This is not recursive runtime freezing.
- `createAppModels.load` requires a session id. The unused takeover dependency
  and no-session branch are deleted; cwd races exercise the real new-session
  controller and input/blur events.
- Both browser `noUnusedLocals` and `noUnusedParameters` gates are enabled after
  removing six bounded unused declarations/parameters. No helper relocation,
  lifecycle policy change or new controller abstraction belongs to this stage.

### Local behavioral evidence

`npm run build:browser` and `npm run check` passed, including both unused-code
gates. The full backend suite passed 984 tests with no skips; the complete browser
suite passed 286 cases. All eight independent UI scenarios and the full
desktop/mobile integration smoke passed. The first browser run exposed an
inactive-fixture precondition in the renewal probe; its writer-based fixture
correction passed the focused file and then the full suite.

An isolated, uninstrumented production page was visually checked at 1280px and
390px: host-qualified selection/restoration, independent child trace peeking,
cumulative SSE frames, completion and response telemetry. The mobile page had
no horizontal overflow and loaded neither compatibility bundle nor application
globals. No live sessions or credentials were used.

A throwaway projection-only app bundle observed eight received HTTP rows and
eight projections across tail, older-page, catch-up and child-trace responses.
SSE counters advanced from 1 to 2 to 3 for one initial row, one update and one
completion; rendering and telemetry added no projections. All throwaway scripts,
instrumented bundles and isolated processes were removed after these checks.

## Mission and outcome

Finish the browser contracts already established by the
[session catalog migration](session-catalog-migration.md#mission-and-outcome).
Delete repeated decoding and a test-only ownership branch before moving shared
runtime helpers or backend lifecycle code. Keep vanilla TypeScript controllers.

A new message field should need its ingress definition/decoder and its actual
consumer, not another projection at each transcript, renderer and telemetry port.
A new session mutation should name its permitted writer and patch once; readers
must not acquire an unofficial mutation path merely by receiving a row.
This stage closes compiler contract gaps, not a demonstrated application defect.

## Grounded starting point

| Seam | Current source and observed contract | Bounded change |
| --- | --- | --- |
| HTTP transcript ingress | [`decodeTranscriptPage`](../src/browser/transcript-data.ts) maps `decodeRenderMessage` already. [`createTranscript`](../src/browser/transcript.ts) then declares `renderMessage`, `render` and `updateMood` using `unknown`. | Preserve decoded message types through page, render, catch-up and mood ports. |
| SSE ingress | [`createMessageStream`](../src/browser/message-stream.ts) parses external event JSON and decodes messages before dispatch. | Keep decoding there; pass the result without another projection. |
| Subagent trace ingress | [`createSubagentsView.loadPeek`](../src/browser/subagents-view.ts) loads another session's message tail/catch-up and passes raw rows to its own message renderer. | Decode message rows at this HTTP ingress before calling the narrowed render port; preserve the independent target/view owner. |
| Rendering and telemetry | [`createMessageRenderer`](../src/browser/message-render.ts) exposes unknown-taking message/user/assistant/custom/upsert ports; [`createStreamingRenderer`](../src/browser/streaming-render.ts), [`createResponseDetails`](../src/browser/response-details.ts) and [`createMood`](../src/browser/mood.ts) decode again. | Internal ports consume `RenderMessage`; decoder remains the external boundary. |
| Session reads/writes | [`SessionEntry`, `SessionLists`, `createSessionState`](../src/browser/session-state.ts) expose mutable metadata/host fields and arrays through getters, lookup and selection return. `SelectionOwner` is already readonly and frozen. | Readonly first-party public views; private mutable state and existing named writers. |
| Input aliases | `setSessionLists` stamps the caller's row objects; [`createHostSessionLoader`](../src/browser/host-session-loader.ts) caches those observations and reuses rows in partial merges. `setCurrentSession` makes a shallow detached row. | Decide ownership at publication and detach only where a mutable alias otherwise crosses it. |
| Model request ownership | [`createAppModels.load`](../src/browser/app-models.ts) handles session and no-session requests. Production [`app.ts`](../src/browser/app.ts) calls it with a session id from session view/controls. [`createNewSession.refresh`](../src/browser/new-session.ts) already loads the takeover catalog directly. | Make `app-models` session-only; retain the takeover's real owner. |
| Race coverage | The cwd-body case in [`model-catalog.spec.js`](../test/browser/model-catalog.spec.js) invokes `appModels.load(undefined, ...)`; production does not. | Exercise that race through `newSessionController` and its input events. |

The reviewed state probe accepted direct model/host/list mutations. The existing
[`browser-state.ts`](../test/types/browser-state.ts) rejects replacing the
`currentSession` getter and invalid patches, but does not close those nested
writes. Treat this as missing static enforcement, not evidence that production
currently corrupts state. Likewise repeated decoder calls are established source
work, not a measured rendering slowdown. Record measurements before claiming one.

## Scope, compatibility and invariants

- Keep external HTTP/SSE/storage values `unknown` until their existing decoder.
  Keep tolerant message projection, missing/empty distinctions, unknown custom
  types, nullable pricing, valid timestamps and opaque tool arguments compatible.
  No universal schema for harness events or tool payloads.
- Keep [`message-data.ts`](../src/browser/message-data.ts) as the browser message
  owner. A proposed named transcript-page type may live in `transcript-data.ts`;
  do not add a second message DTO, nominal validation brand or wrapper hierarchy.
- Expose readonly session fields, host/label, list containers/arrays, lookup and
  selection results, including the first-party `capabilities` map. Keep mutable
  builders and host stamping private. Existing public writer methods stay public;
  no direct mutation escape hatch or exported mutable representation is added.
- Apply explicit readonly types to decoded message fields and first-party nested
  content blocks, usage/cost, advisor notes/jobs and session references where they
  are borrowed by render/telemetry consumers. Opaque extras and tool arguments
  remain opaque; readonly does not mean recursive runtime immutability.
- Audit retained references at ingress/publication, not on every read. No generic
  deep-readonly framework, proxy store, deep freeze, JSON round trip or per-render
  clone. Preserve the existing frozen `SelectionOwner` and endpoint snapshots.
  TypeScript readonly is not a security boundary against untyped JavaScript.
  A readonly view is not necessarily an immutable snapshot: it may observe later
  writes by its declared owner. Preserve acknowledged metadata when cached rows
  are replayed after a failed/partial poll; detaching aliases must not introduce
  a stale-cache rollback or a second metadata synchronization owner.
- Preserve host-qualified lookup, generation invalidation before view reset,
  explicit-host mutation completion and transcript-only metadata authority. A
  filtered list may omit a selected session without deleting that selection.
  Preserve absent/null/empty/zero/false semantics and render callback ordering.
- Preserve cumulative-frame coalescing, incremental block DOM/open tool details,
  finalization in place, indexed catch-up deduplication, custom-message upserts,
  older-page anchor/scroll behavior and bounded retained DOM/cache lifetimes.
  Do not add sorting, corpus scans, extra requests or content-sized copying.
- Preserve factory names and standalone [`index.ts`](../src/browser/index.ts)
  / `public/browser.js` entrypoint for tests. Its message consumers adopt the
  checked contract; malformed-input tests call the exported decoder explicitly.
  Do not keep unknown-taking aliases solely to satisfy old probes.
- Preserve the private production app IIFE: no application globals, debug facade,
  new script tag or production factory-bundle dependency. Keep all five existing
  generated browser paths and `public/helpers.js` supported CommonJS/global
  exports. Factory availability is not a promise of unchecked internal arguments.
- No helper relocation here; Stage 2 owns that cutover. No server/API/store/wire
  redesign, lifecycle work, UI framework, takeover coordinator redesign or broad
  composition rewrite. Record simpler future composition seams; do not build them.

## Dependency graph and ownership

```text
Task 1: freeze contracts and alias/consumer map (integration owner)
   +-- Task 2: readonly session ownership (state owner) --------+
   +-- Task 3: decoded message continuity (message owner) ------+--> Task 5
   +-- Task 4: session-only model adapter (model owner) ---------+    integrate,
                                                                  verify, hand off
```

These are work packages, not promised commits. Task 1 lands before parallel
workers. Tasks 2–4 own disjoint implementation/test slices. The integration owner
alone edits `app.ts`, `index.ts`, `tsconfig.browser.json`, shared type definitions,
`test/browser/fixtures.js`, `test/fixtures/browser-app.js`, build plumbing,
generated assets and shared documentation. Tasks 2–4 share the fixture surfaces;
needed changes go to the lead rather than racing edits or regenerating output.

**Wave A checkpoint:** frozen signatures, input ownership and negative cases
agreed. **Wave B checkpoint:** each slice hands over implementation, migrated
callers and a deletion list; no worker runs build/lint/tests while peers write.
**Wave C checkpoint:** the integration owner closes shared callsites and runs the
verification matrix against one coherent source/generated-output cutover.

## Task 1 — Freeze the public read and decoded-message contracts

**Owner:** integration lead. **Depends on:** no implementation prerequisite.
**Targets:** `SessionEntry`, `SessionLists`, `HostSessionLists`, `SessionState`,
`RenderMessage` and its nested types, transcript callback types, `createAppModels`
options/load, and their type probes. Source owners are linked above.

1. Inventory exported factory consumers and every state writer/read return.
   Record whether each input is an owned builder, cached observation, borrowed
   readonly view, external unknown or opaque extension value. Include the loader
   `beforePublish`/`getCache` ports and fixture list replacement helper.
2. Freeze explicit readonly view signatures and private writable representations.
   Prefer deriving browser metadata from `SessionFields` with a narrow readonly
   capability override, not copying every core field or changing backend writers.
   Freeze readonly list input signatures and the single-host/fan-out overload
   behavior before consumers move. Proposed internal type names are not existing
   APIs; record their final names in the implementation checkpoint.
3. Freeze `RenderMessage` continuity for renderer, streaming, telemetry and mood;
   list known nested fields that require readonly borrowing. Leave unknown tool
   argument decoding at the tool/mood boundary. Check `Date` timestamp aliases
   explicitly; do not quietly replace accepted timestamp formats.
4. Decide where publication detaches a caller-owned mutable row/capability map.
   The loader currently retains row aliases, so simply annotating getters is
   insufficient. Permit reuse only with an explicit readonly ownership contract;
   copy known mutable data at that boundary if it cannot otherwise be owned.
5. Freeze a required-session `appModels.load` signature using only production
   arguments (session id and optional harness); remove takeover/cwd/explicit-host
   no-session parameters. Keep captured selection and resolved endpoint checks.

**Compiler invariant gained:** every consumer/writer agrees on the same closed
read surface and decoded message input; no worker invents a compatibility DTO.
**Complexity deleted:** repeated contract definitions and ambiguity over who may
stamp or patch borrowed objects. **Acceptance:** complete caller/alias matrix,
compatibility decisions and positive/negative compile cases ready before Wave B;
no implementation is considered complete merely because types were declared.
**Future enabled:** Stage 2 can type shared helpers against honest readonly
structural inputs rather than accommodate accidental mutability.

## Task 2 — Make session views readonly and preserve writer ownership

**Owner:** state worker. **Depends on:** Task 1.
**Targets:** [`session-state.ts`](../src/browser/session-state.ts),
[`host-session-loader.ts`](../src/browser/host-session-loader.ts),
[`sidebar-lists.ts`](../src/browser/sidebar-lists.ts), state/loader type and unit
probes, and read signatures in sidebar/session consumers. Shared files go to lead.

- Keep `stampSessionHost`, list assembly and patch application private. Public
  `sessions`, `currentSession`, `findSession` and `setCurrentSession` return only
  readonly views; `active`/`previous` cannot be reassigned or mutated via arrays.
  Preserve detached selection rather than merging list/header authority.
- Accept readonly list observations at `setSessionLists`, `mergeLiveSubagents`,
  `mergeActiveHints` and loader publication/cache ports. Separate private builder
  arrays from public lists. Follow Task 1's alias decision when stamping rows;
  do not repeatedly clone cached transcripts or opaque extras to satisfy types.
- Migrate [`sidebar-render.ts`](../src/browser/sidebar-render.ts),
  [`sidebar-activity.ts`](../src/browser/sidebar-activity.ts),
  [`session-view.ts`](../src/browser/session-view.ts), new-session workspace reads
  and other affected readers to readonly structural inputs, not writable casts.
  Preserve existing mutation consumers: `session-controls` uses `patchSession`,
  `session-activity` uses `patchSessionActivity`, `transcript` uses owned merges,
  and `session-view` owns selection reset/generation. No generic patch method.
- Have the integration lead adapt [`fixtures.js`](../test/browser/fixtures.js)
  through its existing `fixtureSessionListPatch` list writer, including
  capabilities/list facts; neither mutation nor transcript patches may become
  broad fixture backdoors.
- Extend `test/types/browser-state.ts`: reject field writes to `model`, `host`,
  `hostLabel`, nested capabilities, list property replacement, push/splice/sort,
  lookup results and the return from `setCurrentSession`. Keep legitimate writer
  calls and readonly lists as positive cases; retain wrong-field/type negatives.

**Compiler invariant gained:** a reader cannot bypass host stamping, publication
callbacks or patch authority. **Complexity deleted:** mutable public views and
reader-side ownership conventions that the compiler previously could not enforce.
**Acceptance:** existing state/loader/API/identity regressions retain host collision,
partial-poll, omitted-field and stale-owner behavior. Add a permanent alias case
only for the uncertain publication boundary: prevent another mutable owner's
writes from silently changing authoritative state, and preserve acknowledged
metadata during cache replay. Assert values/authority under the chosen borrowed-
view or owned-snapshot contract, not copying or reference identity. Opaque extras
retain supported behavior without deep freezing. **Future enabled:**
a session field remains a read-only field until explicitly admitted to a writer.

## Task 3 — Carry decoded messages through rendering and telemetry

**Owner:** message worker. **Depends on:** Task 1.
**Targets:** message/transcript sources in the starting table, `mood.ts`,
[`composer-submit.ts`](../src/browser/composer-submit.ts), message/live/transcript
compile probes and regression files; lead owns `app.ts` wiring and shared types.

- Type transcript render/update-mood callbacks and `render` with readonly decoded
  messages. Keep `page` decoding HTTP JSON once, including older/catch-up pages.
  Preserve cursor validation and owned response-body checks.
- Include `subagents-view.ts` trace-tail/catch-up ingress and its private renderer.
  Decode its rows with the existing tolerant message decoder before rendering.
  Do not silently substitute stricter whole-page failures for its current
  empty-page/cursor behavior. Preserve captured target host/model/endpoint,
  peek-sequence retirement and the parent selection; peeking must never merge
  the target's metadata into the selected session. Signal-completion ownership
  and the explicit open-target action remain separate from trace rendering.
- Change renderer `message`, `user`, `assistant`, `custom`, `upsertCustom`,
  streaming `queue`/`render`, response-detail `button` and mood `fromMessages` to
  decoded inputs. Delete their redundant `decodeRenderMessage` imports/calls.
  Do not move decoding to a generic wrapper around every render.
- Keep `message-stream` decoding `message_update`/`message_end` at SSE ingress;
  remove guards made impossible by the decoder's non-null return, not event
  role/ownership checks. Internal optimistic user construction in
  `composer-submit` supplies a checked `RenderMessage`, not a fake wire round trip.
- Carry readonly content/usage/details/reference fields through projections.
  Keep tool execution and arbitrary tool arguments as their own unknown boundary;
  do not redesign shared helper contracts or require all helpers to accept a
  whole `RenderMessage`. Eliminate only narrowing made redundant by established
  named types; retain display fallbacks and opaque-content interpretation.
- Migrate JS factory tests: wire/malformed fixtures go through decoder exports;
  ordinary render fixtures satisfy the decoded shape. In existing type probes,
  reject raw `unknown` and malformed telemetry at each affected port and reject
  nested first-party mutation; demonstrate decoder output and optimistic typed
  input flow without casts. Retain meaningful wrong-type checks as construction
  checks if readonly assignment would otherwise mask their purpose.

**Compiler invariant gained:** HTTP/SSE decoding cannot be erased between feature
ports, and consumers cannot mutate borrowed first-party message data.
**Complexity deleted:** repeated full-message projections in render, streaming,
telemetry and mood; consumer-side validation of already-established named fields.
**Acceptance:** existing decoder/render/live/transcript tests preserve malformed
wire handling, images, hidden/custom/advisor messages, metadata, deduplication,
empty assistants, tool grouping and retained-host ownership. Use a throwaway
instrumented fixture to count projections for HTTP and SSE messages and observe
unchanged DOM/telemetry; avoid permanent tests that assert decoder call wiring.
**Future enabled:** adding a message field no longer requires teaching multiple
internal boundary decoders to carry it to the one renderer/detail that needs it.

## Task 4 — Remove the unused takeover branch from app models

**Owner:** model worker. **Depends on:** Task 1; does not change state contracts.
**Targets:** `app-models.ts`, `test/browser/model-catalog.spec.js`, app-model type
acceptance in an existing browser probe; lead updates `app.ts` construction.

- Remove `createNewSession` dependency, lazy `takeover` option and all no-session
  generation/open/host/harness/cwd ownership branches from `createAppModels`.
  Require a session id; retain selection/endpoint ownership, harness fallback,
  catalog clear on missing endpoint and session-scoped model loading.
- Leave `new-session.ts` as the takeover load owner (`refresh`, `scheduleRefresh`,
  `changeHost`, `changeHarness`, `open`, `close`). Do not invent a common takeover
  coordinator or route its loads back through the session adapter.
- Move the delayed cwd-body probe off `appModels.load(undefined, ...)` onto the
  real controller refresh and cwd input event. Hold response-body completion,
  type the new cwd before debounce, then release; cached rows stay visible and
  stale results cannot publish. Preserve existing host switch, close-to-session,
  cached peer-key and enabled-model renewal cases; use real controller actions
  for any affected reopen/harness cases rather than duplicate owner predicates.

**Compiler invariant gained:** no-session model calls cannot enter the session
adapter; the takeover dependency disappears from its construction type.
**Complexity deleted:** duplicate model-view ownership branch and artificial test
entrypoint. **Acceptance:** production session view/controls compile unchanged in
behavior; no undefined/null session call remains; takeover model DOM/cache races
are exercised through `newSessionController`. Add runtime coverage only for a
plausible unprotected transition, not every permutation. **Future enabled:** later
composition simplification can remove construction-order coupling rather than
coordinate two supposedly authoritative takeover owners.

## Task 5 — Integrate, verify and record the deletion boundary

**Owner:** integration lead. **Depends on:** Tasks 2–4.
**Targets:** shared files and generated assets named in the ownership section,
existing docs describing affected contracts, all affected callers/type probes.

Integrate ports and remove unused declarations/imports exposed by these changes.
Evaluate `noUnusedLocals`/`noUnusedParameters` in `tsconfig.browser.json` only after
inventory: enable useful gates if cleanup remains bounded to dead declarations.
Do not broaden this stage into repo-wide rewrites or suppress errors with dummy
reads. Record deferred gates and their actual blockers if scope is not clean.
Update stale state/runtime prose to match the production/factory separation.

**Compiler invariant gained:** integrated implementations, tests and checked
bundles use the same contracts. **Complexity deleted:** stale declarations,
fixture-only compatibility branches and obsolete migration prose.
**Acceptance/verification:** after workers finish, regenerate with
`npm run build:browser`, then run `npm run check`, full `npm test`,
`npm run test:browser`, `npm run test:ui:scenarios` and `npm run test:ui`.
Use the [supported tooling](testing.md#supported-tooling-and-automated-checks).
Core generation is needed only if the agreed shared source actually changes.
**Future enabled:** the successor stages consume checked boundaries, not adapters
whose implementation or supported callers remain unverified.

### Required observable proof

- Focus existing unit paths: `browser-session-state`, `browser-host-session-loader`,
  `browser-message-render`, `browser-transcript`, `browser-model-catalog`, API and
  browser-build tests. Preserve their behavioral assertions, adapting changed
  contracts rather than pinning casts, object identities or incidental wording.
- Focus browser paths: `api-boundary`, `session-identity`, `selection-ownership`,
  `message-render`, `live-transcript`, `message-stream`, `transcript`,
  `model-catalog`, `new-session-shell`, `session-navigation` and
  `production-composition` specs.
- Run the actual production page, not only instrumented feature factories, at
  desktop 1280px and mobile 390px. Select colliding-id peer/self rows; rename and
  switch model/thinking; stream a complete turn through SSE then JSONL catch-up;
  inspect response details, images and custom/tool messages. Load older history,
  retain/restore an open tool group and scroll position, and switch hosts during
  held transcript/model bodies. Open/close/reopen new session, change host/harness
  and cwd, and confirm cached rows never acquire the wrong request's results.
  Open the subagents takeover, peek and catch up a different target's trace,
  inspect its response metadata/images, switch targets while a body is held and
  close back to the unchanged parent selection. Preserve signal target ownership.
- Capture DOM outcomes and screenshots plus unexpected console/page errors.
  Verify production still loads neither `/browser.js` nor `/helpers.js`, exposes
  no application globals, and mobile drawer/controls remain usable. Existing
  `production-composition.spec.js` supplies the uninstrumented entrypoint;
  `test/ui-smoke.js` supplies actual server/bridge/SSE integration fixtures.
- Do not claim a performance win from fewer source calls alone. The throwaway
  projection observation must show decoding is confined to ingress without
  introducing content-sized copy work; preserve frame coalescing and retained
  nodes in the live smoke. Remove throwaway instrumentation after recording it.
- Install pinned browser tooling first; use sanitized temporary HOME, fixture
  sockets and isolated processes, never live user sessions or credentials. If
  runtime prerequisites are missing, record exact command, missing executable or
  dependency and skipped scenario; partial coverage is not full verification.
  Review-required real Pi/OMP/Prime canaries follow the explicit-path/local fake
  provider policy in [testing guidance](testing.md#supported-tooling-and-automated-checks)
  and [development commands](../README.md#development). Record versions/outcomes
  or explicit skips; unrelated lifecycle canaries are not invented for this stage.

### Definition of done and deletion ledger

| Must be absent | Must remain |
| --- | --- |
| Mutable first-party session/list/find/selection public paths | Named writers, host/generation guards, detached selection and patch authority |
| Unknown message erasure at internal render/telemetry/mood ports | Real ingress decoding and opaque tool payload boundaries |
| Redundant full-message renderer/detail/streaming/mood decoding | One message contract, incremental rendering and bounded retained state |
| No-session `app-models` branch and lazy takeover dependency | Session adapter plus takeover-owned catalog requests |
| Race probe calling the deleted branch or new compatibility alias | Real-controller race coverage and existing factory exports |
| Dead declarations and throwaway measurement instrumentation | Useful compiler gates and honest supported public helper/bundle paths |

All source/internal/test callers migrate together; generated output is produced
from source, never edited by hand. The final record includes changed signatures,
alias/copy decisions, deleted responsibilities, exact executed checks, observable
smoke results and skips. Planned status changes only with implementation evidence.

## Successor handoff

[Stage 2](shared-runtime-helpers.md) receives readonly session/message consumers,
remaining external unknown boundaries and the complete helper import inventory
encountered here. It owns relocation to flat `src/core` modules and generated
`lib` paths while preserving `public/helpers.js`; Stage 1 creates no new shared
build stage. [Stage 3](session-lifecycle-migration.md) consumes that typed helper
work and existing source/identity/process/capability contracts, without extending
browser read views into lifecycle authority. The removed lazy takeover dependency
and explicit controller ownership are groundwork for a separately justified
composition simplification, not authorization to redesign takeovers now.
