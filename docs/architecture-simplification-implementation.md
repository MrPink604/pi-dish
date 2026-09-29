# Architecture simplification implementation

Date: 2026-09-28. Execution baseline: `6be676f1401a62d294c1be54adcc133d5102a2f1`.

This is the implementation record for the eight stages in the
[approved proposal](architecture-simplification-proposal.md). The
[Opus 5.5/high plan review](architecture-simplification-review-2026-09-28.md)
remains historical plan evidence, not implementation approval. Execution was
rebaselined against the subsequent model-picker work; its shared catalog and
new-session combobox remain intact.

## Stage outcomes

| Stage | Single implementation owner and removed duplication | Deliberately separate boundary |
| --- | --- | --- |
| S1 | `src/browser/comment-anchors.ts` owns structural quote matching, DOM mark application/clearing and constrained viewport placement for application and standalone-page comments. | Selection capture, exclusion/decorating policy, page/file/diff routing, drafts and editor mutation lifetimes remain local. Marks use the root's owner document. The page does not import the application entrypoint. |
| S2 | `src/core/helper-usage-math.ts` owns shared in-place accumulation, displayed-token totals and stable rankings. Server aggregation, browser helper aggregation and weekly view aggregation use the appropriate full or sparse primitives. | Response construction, host/day grouping, truncation, partial pricing and timing ownership remain local. Server totals gain no `priced`; weekly buckets gain no timings; nested weekly model unknown cost remains total-only. |
| S4 | `src/browser/helper-format.ts` owns thinking-preview formatting and ipython-versus-JSON tool-argument formatting. | Final and streaming DOM algorithms remain separate. Streaming checks its change signature before formatting; no per-delta full-message projection is introduced. |
| S5 | `src/core/helper-command-metadata.ts` owns pi-dish emulated command facts shared by bridge and RPC catalogs. Bridge listing and execution gates are explicitly associated with that inventory. Thinking hints use the actual harness vocabulary. | Runtime versus descriptor admission remains distinct, including compact/reload/btw exceptions. Native command shadowing, socket capabilities and the upstream Pi TUI mirror remain separate. |
| S6 | `BridgeSession.setModel(provider, modelId)` now matches the existing RPC method, removing HTTP's argument-shape branch without changing the socket frame. `src/core/session-command-handlers.ts` removes repeated HTTP prompt/steer/follow-up admission, attachment and reference-expansion policy. | Composition supplies existing live-resolution, capability and reference ports. Explicit steer still calls `steer`; prompt delivery modes and follow-up call `prompt`. Slash commands, routine/recovery delivery and destructive lifecycle authority retain their owners. |
| S7 | Routine model loading calls `createSessionApi(...).models(...)`, removing its parallel model URL construction, response decoding and direct HTTP handling. | Routine cache keys, cached-empty failure policy, sequence/base guards and refreshed credentials remain routine-owned. The existing shared application/new-session catalog instance and harness decoders remain unchanged. |
| S3 | `src/core/helper-tree.ts` owns cycle-safe active ancestry and common preorder/depth walking for Pi and OMP. Repeated parent IDs terminate with a finite unique path. | Each harness retains acquisition guards, recognized node types, summary/truncation dialect, labels, tool names, timestamp handling and output projection. The walker borrows children rather than copying trees. |
| S8 | `sameCapturedHost` in `src/browser/api-client.ts` owns the exact search/usage comparison: host ID, base and normalized captured token (`token || ''`). | Search and usage keep feature generations, disposal, partial-result rendering and their existing render queue. Directory comparisons use raw token equality; routines refresh credentials. Neither was forced onto the shared predicate. |

### Conditional extraction decisions

- **S3 entered:** ancestry termination and preorder/depth traversal are genuinely
  common. The callbacks retain materially different Pi/OMP display projections
  and OMP's unknown-node guards; no unified tree dialect was created.
- **S6b entered:** the three HTTP delivery routes repeated substantive admission,
  image filtering and lazy reference-expansion policy. The extracted handlers use
  existing ports rather than creating a command facade or lifecycle coordinator.
  Dedicated steer/follow-up routes continue to ignore an unrelated `deliverAs`
  field; `/prompt` validates it. Existing native property-access behavior is not
  replaced with a new request decoder.
- **S8 limited to the exact search/usage predicate:** shared generation, cancellation
  or fleet-state machinery would combine different invalidation and credential
  policies. Those owners were intentionally not consolidated.

The full usage accumulator preserves its direct unavailable-count arithmetic;
sparse weekly arithmetic preserves its defaulting behavior. The separate headline
cost loop was not replaced with a subtotal-reset primitive: finite-source addition
and overflow behavior differ. Stable comparator ties still retain input order.

The 121 shared-helper compatibility exports are unchanged. New internal modules
are imported directly; no additional compatibility facade was introduced.

## Observed runtime behavior

All fixtures used isolated homes, sockets and deterministic model data; no live
agent session or provider credentials were used.

### Model catalog and transport

The actual production browser bundle was exercised before and after the changes.
The cumulative model-request counts were identical:

| Interaction | Before | After |
| --- | ---: | ---: |
| Select initial session | 1 | 1 |
| Open new-session form | 2 | 2 |
| Return and open session model menu | 3 | 3 |
| Reopen session model menu | 3 | 3 |
| Open routine with failing model catalog (HTTP 503) | 4 | 4 |
| Revisit the cached routine failure | 4 | 4 |

The saved unavailable routine model remained `test/saved-missing` in both runs.
Selecting `test/second` through the UI produced the existing bridge frame
`{id: 4, command: 'set_model', model: 'test/second'}`.

Actual HTTP-to-bridge delivery exercised `/prompt` with steer mode, explicit
`/steer`, `/follow-up` and image-only delivery. Explicit steer remained a steer
command; follow-up remained prompt delivery with `followUp`. Mixed attachments
retained only the valid image. Invalid prompt mode, all-invalid image-only steer
and missing model provider returned 400; a missing session returned 404. Dedicated
steer/follow-up still accepted an irrelevant invalid `deliverAs` field.

The backend RPC fixture also exercised HTTP prompt delivery through stdio, SSE
and JSONL, mid-turn steering, follow-up, slash model/thinking commands and the
compaction-in-progress gate. The isolated bundled-Pi integration exercised actual
Pi reference expansion, SSE/JSONL, compaction guards, reload and navigation.

### Tree termination

Before the change, production `getSessionTree` entered a two-node parent cycle
and had to be killed after seven seconds. After rebuilding, the same fixture
returned `{nodes: [], leafId: 'b', activePathIds: ['b', 'a']}` and exited normally.
The valid-tree fixture's output was unchanged. Permanent Pi and OMP regressions
cover cycles and their distinct display projections.

### Extension import paths

Installed-symlink and staged-package imports passed under Bun for all three
Pi/OMP/Prime wrappers: six combinations. The installed smoke invoked the real
`install.sh --links-only`; staged imports used the packaged `lib` and wrapper
layout. This proves importability, not a real OMP/Prime TUI canary.

### Usage and streaming surfaces

An uninstrumented production-browser smoke used two isolated real servers behind
a same-origin fixture proxy, with deterministic usage responses and real assets,
session APIs, SSE and JSONL. It observed:

- Partial pricing markers, omitted-call counts and component-less cost displayed
  as unattributed; merged totals of ~$5.25, five calls and 4.1k displayed tokens.
- Reasoning tokens excluded from both totals and day/week charts; stable model
  ranking, host-qualified workspace/session rows and model-filter requests.
- One hundred daily rows becoming fifteen weekly buckets, with correct partial
  boundary weeks and matching tooltip/detail totals.
- Thinking preview and ipython/JSON tool formatting through real bridge events,
  unchanged DOM identity/open details on incremental updates, and tolerated
  missing fields.
- Finalization, error styling, empty-message removal and authoritative JSONL
  catch-up; no stream leakage while a historical session was selected; retained
  DOM restoration and streaming with focus mode enabled.

This smoke did not cover direct cross-origin peer requests or subscription-limit
rendering. Its fixture did not filter the daily series on model selection, so it
proved request parameters and filtered rows, not server-side daily filtering.

The smoke also exposed an existing cosmetic chart edge: floating-point residue
can add an invisible zero-height `other` segment and legend item. The unchanged
`total - known > 0` chart policy predates this work (`07e45058`); unlike the separate
unattributed-cost path, it has no epsilon. No arithmetic or chart-policy change
was added outside the proposal's two authorized behavior corrections.

### Page, file and diff comments

An isolated real server served the uninstrumented production bundles, published
page injection, comment store and a real Git diff. Desktop and Chromium mobile
emulation exercised cross-node selection, exact quote/context storage, save,
mark-based reopen, editing and two-step deletion. File comments with no surviving
quote remained editable from the list. Two repeated quotes among eighty copies
were marked at their context-selected occurrences; diff comments marked the two
selected added lines.

Scroll and live resize repositioned editors. At 390px the card was 374px wide;
the published-page editor at 320×180 used its 304×164 constraint and internal
scrolling. Delayed real saves and deletes could finish without altering a newer
page draft or a draft opened on another application file. The closed page shadow
root was driven with mouse/keyboard and inspected through CDP plus screenshots.

No consumer-visible failure was found. Real handsets, pinch-zoom viewport panning
and a different-session stale-comment variant were not part of this manual smoke;
the existing browser ownership scenarios cover same-ID host replacement.

## Implementation review

Independent read-only reviews approved both slices with no actionable findings:

- Browser review: S1, S4, S7 and S8, including editor ownership, constrained
  placement, streaming formatting cost and catalog/credential lifetimes.
- Core/extension review: S2, S3, S5 and S6, including sparse arithmetic shapes,
  projections, listing/execution gates, socket model framing and HTTP delivery.

These reviews did not rerun tests; runtime evidence is recorded separately.

## Integrated verification

| Check | Observed result |
| --- | --- |
| `npm run build:core && npm run build:browser && npm run build:tests` | Passed; checked-in runtimes/declarations regenerated. |
| `npm run check` after the final test correction | Passed: source policy, lint, type programs and all generated-output/mode checks. |
| `PI_DISH_PI_COMMAND="$PWD/node_modules/.bin/pi" npm test -- --test-concurrency=4` | 1,123 passed; zero failures, cancellations or skips. |
| `npm run test:ui` | Desktop and mobile smoke passed. |
| `npm run test:browser` with a 1,800-second command deadline | All 329 scenarios passed using the configured two workers (16.7 minutes). |
| Installed-symlink / staged-package wrapper imports | All six Pi/OMP/Prime combinations passed under Bun. |
| Documentation links and approved proposal hash | 74 local links resolved; proposal SHA-256 remains `ad1d1c2e052fec84db4a0c5775ce54a2a37c98e95464403143e792637d5a1564`. |

Core, browser and checked test outputs were regenerated in that order. New core
modules and the isolated Pi tree fixture are enrolled in generated-file/source
policy. Strict checks cover source classification, lint, types, portable helper
imports, generated drift and output modes.

Verification exposed two test-assertion issues, both corrected without changing
production behavior:

- The new page-comment exclusion regression used Playwright's rendered-text
  matcher on script/style elements, which deliberately excludes those contents.
  Reading raw `textContent` verifies that anchoring leaves those payloads intact.
  All five artifact-comment scenarios passed after that correction.
- The existing OMP launch catalog-reuse assertion counted every fixture log
  record, including an independently timed CLI `finish` record. It now counts
  actual `start` records, using the same convention as the catalog test, so the
  assertion checks discovery reuse rather than child-exit timing.

An initial unrestricted backend run used a host Pi version different from the
bundled SDK and also failed listener readiness under concurrent load. The
bundled-Pi, single-worker listener/Pi integration rerun passed all 26 tests.
The first full browser invocation exceeded its 900-second command deadline;
the final complete run used a longer command deadline without changing test
timeouts, retries or worker configuration.

Throwaway fixtures, scripts, isolated homes and owned smoke services were removed
or stopped after verification. Screenshots remain outside the repository.

## Verification limits

The real OMP/Prime lineage command was attempted with explicit installed OMP,
Prime and Bun paths. It failed before starting a harness:
`ENOENT: chmod '/tmp/pd-lineage-real-0v7JV0/sockets'`. The existing runner calls
`chmod` before creating that directory (`scripts/test-real-lineage-harnesses.ts`,
line 88). This unrelated runner defect was not folded into the simplification.
Real OMP/Prime TUI behavior is therefore not newly verified by this record.

No latency, code-size or performance improvement is claimed. Request counts,
cycle termination and observed behavior are the measured results.
