# Browser TypeScript migration checkpoints

Goal started 2026-09-11: finish the browser portion of the migration, checkpoint
bounded changes, get Fable 5.1 review of local commit(s) before each push, and
confirm CI passes on the final implementation before declaring completion.

## Completion criteria

- First-party browser application logic has TypeScript sources under strict
  checking, including the main app, pure helpers, published-page comments and
  startup logic. Generated runtime JavaScript and third-party vendor assets
  remain supported delivery formats.
- State, request and view boundaries carry the identities they act on. Preserve
  host/session ownership, streaming coalescing, retained DOM, pagination, scroll
  state, desktop/mobile behavior and cleanup of listeners/timers/connections.
- Moving files alone, disabling type checks, or replacing contracts with blanket
  `any` declarations does not complete the migration. Unknown wire payloads are
  narrowed at the feature boundary that consumes them.
- Every pushed implementation checkpoint has Fable review and the relevant
  verification from [AGENTS.md](../AGENTS.md). Findings are resolved before push.
- The final audit accounts for all first-party browser entrypoints, and the final
  pushed implementation has passing CI. Backend migration and framework adoption
  remain outside this goal.

## Starting inventory

Snapshot at `95e6fd5` (latest implementation `53b5ae0`):

| Source | Starting state |
| --- | --- |
| `src/browser/` | Eight typed implementation modules plus the bundle entrypoint |
| `public/app.js` | 13,812 lines of authored JavaScript; most feature controllers and rendering |
| `public/helpers.js` | 2,574 lines of shared browser/test helpers |
| `public/artifact-comments.js` | 387 lines for comments on published pages |
| `public/index.html` | Early theme initialization and inline action bindings to audit during shell migration |
| `public/vendor/` | Third-party assets, excluded from conversion |

The [roadmap](../BACKLOG.md) records the current work order. This log records
verification and remaining scope at each implementation checkpoint; line counts
are not completion percentages.

## Checkpoint 1 — host discovery

- Boundary: self identity, runtime fleet refresh and direct-host descriptor reads.
- Typed request owners capture the endpoint and originating catalog object;
  replacing/removing a source or changing its route/token retires old responses.
- Follow-up review fixes preserve fleet readiness across overlapping loads and
  unchanged source owners across catalog saves. A later failed refresh cannot
  suppress the UI notification owed by the current published fleet.
- Source mutation, persistence, connection observations and rendering remain
  explicit callbacks until their own modules migrate.
- Verification: strict build/lint/type checks, 856 backend tests, 66 browser
  regressions, all independent UI scenarios and desktop/mobile smoke passed.
- Commits `fdf1402` and `54c5a66` passed Fable 5.1 review before push. The
  follow-up review cleared the readiness/source-ownership fixes.
- [All five CI jobs passed](https://github.com/MrPink604/pi-dish/actions/runs/34585526645)
  on `54c5a66`.
- Next: host catalog state/editing and settings UI, then remaining new-session
  request controllers.


## Checkpoint 2 — host directory

- Boundary: self/fleet/catalog state, effective host caching and lookup, and
  catalog add/remove/token/discovery writers.
- Public views are readonly, and descriptor updates require an owned source.
  Saves retain unrelated source owners; explicit catalog replacement retires
  old requests. Fleet payloads are copied before becoming mutable source rows.
- The app uses directory writers and retains storage/connection/render callbacks.
  Existing smoke fixtures use the same accessors instead of old global variables.
- Verification: strict build/lint/type checks, 862 backend tests, 66 browser
  regressions, all independent UI scenarios and desktop/mobile smoke passed.
- Commit `69cccb7` passed Fable 5.1 review with no blocking findings before push.
  [All five CI jobs passed](https://github.com/MrPink604/pi-dish/actions/runs/34586840814)
  on that commit.
- Next: host settings DOM and add-host request/view ownership.

## Checkpoint 3 — host settings

- Boundary: settings markup, row/form listeners, catalog UI actions and add-host
  validation with captured endpoint/view/attempt ownership.
- Edits, repeated submissions and closing/reopening settings retire old replies,
  including delayed body reads, before descriptor/catalog/status publication.
- Form and row listeners are disposed; live color input retains the picker row.
  Color state and shared formatting still enter through explicit typed callbacks.
- Verification: strict build/lint/type checks, 862 backend tests, 71 browser
  regressions, all independent UI scenarios and desktop/mobile smoke passed.
- Commit `b1cc60d` passed Fable 5.1 review with no blocking findings before push.
  [All five CI jobs passed](https://github.com/MrPink604/pi-dish/actions/runs/34587819581)
  on that commit.
- Next: host color state, then remaining new-session request controllers.

## Checkpoint 4 — host colors and presentation

- Boundary: device color state, first-seen palette order, chip/dot markup and
  native color resolution. Shared pure color helpers retain their CommonJS API.
- Readonly persistence contracts and focused tests cover runtime updates after
  storage failure, self identity fallback and own override keys. Prototype names
  such as `constructor` can no longer resolve to inherited functions as colors.
- Verification: strict build/lint/type checks, 868 backend tests, 71 browser
  regressions, all independent UI scenarios and desktop/mobile smoke passed.
- Fable reviewed `4487019` with no blocking findings. A follow-up makes
  persistence snapshots stable after color reset; strict checks, all backend and
  browser tests and desktop/mobile smoke pass again. Fable confirmed the snapshot
  fix in `6831418` and cleared both commits before push.
- Next: remaining new-session directory, target, model/config and spawn controllers.

## Checkpoint 5 — directory controllers

- Boundary: known cwd catalog, shared new-session/routine autocomplete and the
  new-session lazy directory tree. Wire path/name fields are decoded before use.
- Catalog reads retain host route/token and request ownership. Suggestions retire
  at the keystroke, including during debounce; host switches and closed views
  retire delayed bodies. Tree rows retain their originating host and tree.
- Autocomplete owns input/row listeners and debounce/blur timers. Replacing a
  routine detail disposes its old controller; hiding a retained form retires reads.
  Tree reset/close aborts listeners and pending directory requests.
- Focused verification: five catalog unit tests and four browser regressions pass,
  including overlapping host loads, delayed bodies and retired tree actions.
- Full verification: strict build/lint/type checks, 873 backend tests, 75 browser
  regressions, all independent UI scenarios and desktop/mobile smoke passed.
  Fable review of the local commit is required before push.
- Next: new-session target, model/config and spawn controllers.

- Fable review of `f787f81` found dropdown continuity and host-route renewal
  issues. The follow-up separates pending-read retirement from rendered-row
  ownership, preserving visible suggestions and keyboard actions while typing.
  Catalog/token changes and late self identity renew open directories. Four
  additional browser regressions cover these triggers. Strict checks, all 873
  backend tests, 79 browser regressions, independent UI scenarios and full
  desktop/mobile smoke pass. Fable confirmed both findings resolved in `f3f9399`
  and cleared both directory commits before push.

## Checkpoint 6 — tmux targets

- Boundary: tmux target payload decoding, current choice, saved resume target
  resolution and run-in combobox DOM/listeners. Rows and descriptors are readonly.
- Refresh immediately clears old choices; delayed responses retain their host
  id/route/token and request generation. Failed or unsupported reads leave only
  headless operation. Resume requires the selected session's explicit host.
- Picker rows retain their catalog identity. Refresh and close retire row
  listeners and blur timers; keyboard/fuzzy/pinned-row behavior is preserved.
- Six unit tests and four browser regressions cover request replacement, delayed
  bodies, host-aware resume, unavailable targets, retained rows and keyboard picks.
- Verification: strict build/lint/type checks, all 879 backend tests, 83 browser
  regressions, all independent UI scenarios and desktop/mobile smoke passed.
  Fable review of the local commit is required before push.
- Next: shared model catalog and new-session model/config/spawn controllers.

- Fable 5.1 cleared tmux commit `0428252` with no blocking findings before
  push. Its suggested improvement to the readonly compile assertion is included
  in checkpoint 7. All five CI jobs passed on directory follow-up `f3f9399`.

## Checkpoint 7 — shared model catalog

- Boundary: model rows, cache scope, filter/enabled-model writers and shared
  select-option markup. Rows and captured scope are readonly; edits replace rows
  so saved snapshots remain stable. Prototype-like provider names group safely.
- Request ownership includes host endpoint, harness/session and request sequence.
  New-session loads also capture takeover generation and cwd, retiring on pick/blur
  before refresh debounce or on close. Cwd equality guards reject replies while
  typing. Cached rows have separate host/harness/view ownership
  so valid interim choices remain visible until the refreshed cwd catalog arrives.
- Six unit tests, four browser regressions and compile contracts cover delayed
  bodies, view closure, host-specific cache keys and stable edit snapshots.
- Verification: strict build/lint/type checks, all 885 backend tests, 87 browser
  regressions, all independent UI scenarios and desktop/mobile smoke passed.
  Fable review of the local commit is required before push.
- Next: published-page comment entrypoint, new-session preferences/config/spawn
  controllers and the remaining application rendering/features.

- Fable reviewed `5b8b45f` and identified a retired-catalog save edge case. The
  follow-up returns no edit snapshot for retired rows and skips that save, so a
  host renewal cannot clear server-local model scoping. Malformed cache decoding
  leaves no partial scope, and docs now distinguish cwd equality guards from
  pick/blur refresh scheduling. Added unit/browser regressions pass along with
  strict checks, all 886 backend tests, 88 browser regressions, independent UI
  scenarios and full desktop/mobile smoke. Fable confirmed the findings resolved
  in `36cc348` and cleared both model-catalog commits before push.

## Checkpoint 8 — published-page comments

- The standalone comment entrypoint now compiles strictly from TypeScript; the
  injected script path stays `public/artifact-comments.js`. It has no dependency
  on the main app or its bundle. Wire comment/index/error fields are narrowed.
- Selection ranges and submitted drafts are typed. Out-of-order list refreshes
  cannot restore old marks; an old delete cannot enable a newer pending action.
  The closed shadow root, cross-node anchors, mobile positioning and page-token
  routing remain supported.
- Browser build checks validate both outputs before writing either, and the
  build regression verifies stale output and failure preservation for both.
- Four browser regressions cover cross-node edit/delete, replacement drafts and
  mobile bounds, out-of-order mark refreshes and overlapping delete completion.
- Verification: strict build/lint/type checks, all 886 backend tests, 92 browser
  regressions, all independent UI scenarios and desktop/mobile smoke passed.
  Fable review of the local commit is required before push.
- Next: new-session preferences/config/spawn controllers, followed by remaining
  application features, shared helpers and startup shell.

- Fable 5.1 cleared artifact-comment commit `338addd` with no blocking findings
  before push. All five CI jobs also passed on model follow-up `36cc348`.

## Checkpoint 9 — new-session options

- Boundary: saved model/thinking preferences by harness, model/thinking select
  rendering and the OMP defaults readout. Inputs and decoded preview data are typed.
- Defaults requests capture endpoint, harness, cwd, takeover generation and read
  sequence. Stale success/failure bodies cannot restore an old configuration.
  Edit actions use the current cwd when the last preview no longer owns it.
- Retirement clears config ownership while retaining readout geometry until the
  actual refresh begins. A focused pointer/blur regression protects spawn-button
  clicks from layout movement between pointer-down and pointer-up.
- Four unit tests and four browser regressions cover decoder ownership, delayed
  cwd/host replies, preference keys, supported thinking levels and pointer stability.
- Verification: strict build/lint/type checks, all 890 backend tests, 96 browser
  regressions, all independent UI scenarios and desktop/mobile smoke passed.
  Fable review of the local commit is required before push.
- Next: harness settings editor and new-session spawn coordination, followed by
  the remaining application features, shared helpers and startup shell.

- Fable 5.1 cleared new-session options commit `5e983d6` with no blocking
  findings before push. All five CI jobs passed on artifact commit `338addd`.

## Checkpoint 10 — harness settings

- Boundary: shared session/new-session harness editor, config/agent decoding,
  role and agent form rendering, changed-field patches and save lifecycle.
- Read owners capture the host endpoint, harness, cwd and editor instance.
  Late reads cannot paint a replacement modal, and fallback model rows must
  belong to the same host and harness. Custom role/agent names remain literal
  record keys, including names inherited by ordinary JavaScript objects.
- Save captures both patches and its endpoint before the first write. Closing
  and reopening the modal does not retarget the second write or let an old
  completion close, re-enable or report errors in the new editor. A failed
  first patch stops the second and leaves the current form editable.
- Two decoder units, strict type contracts and four focused browser regressions
  cover these boundaries. Strict build/lint/type checks, all 892 backend tests,
  100 browser regressions, independent UI scenarios and desktop/mobile smoke
  passed. Fable review of the local commit is required before push.
- Next: new-session spawn coordination, then remaining application features,
  shared helpers and startup shell.

- Fable reviewed `3d56bdd` and noted that closing the editor during a successful
  save suppressed its matching new-session preview refresh. The follow-up calls
  the captured-scope notification after all successful writes, while modal
  completion still requires the owning view. A fifth browser regression covers
  closing during save. Strict checks, 892 backend tests, 101 browser regressions,
  independent UI scenarios and desktop/mobile smoke passed again. Fable cleared
  `3d56bdd` and follow-up `1d50e5d` together before both commits were pushed.

## Checkpoint 11 — session spawn operations

- Boundary: async kickoff payloads, response/status decoding, provisional row
  storage, captured-host status polling and composer-state reconciliation.
- Submitted operations retain endpoint, target, cwd, harness and refine draft.
  A late POST cannot consume a replacement draft, open over a new takeover or
  restore an old error/button state. Direct workspace launches also retain their
  endpoint through lazy target/harness discovery.
- Provisional keys include the owning host, keeping equal wire operation ids on
  two hosts separate. Polling continues on the submitted endpoint and reconciles
  only against the authoritative session row on that host. Completion transfers
  draft/attachments and selects only the still-selected provisional operation.
- Four unit tests, strict contracts and four browser regressions cover malformed
  replies, replaced views, captured drafts, failed kickoff/button ownership and
  same-id multi-host readiness. UI smoke now reads the captured provisional key.
- Verification: strict build/lint/type checks, all 896 backend tests, 105 browser
  regressions, independent UI scenarios and desktop/mobile smoke passed. Fable
  review of the local commit is required before push.
- Next: shared helpers, remaining new-session shell, other feature controllers
  and transcript/streaming/startup ownership.

- Fable cleared spawn implementation `454ce1c` and identified two stale references.
  The follow-up names the typed polling owner in CLAUDE.md and captures the
  failed provisional composer key before test cleanup switches sessions. Strict
  checks and desktop/mobile smoke passed again; follow-up review precedes push.

## Checkpoint 12 — shared helpers (verified locally; review pending)

- The authored `public/helpers.js` implementation moves to ten strict helper
  modules, structural helper input/result types and a compatibility export entry.
  Generic grouping/reference functions preserve caller row types; content/tool
  helpers narrow unknown blocks. Custom role/harness names remain literal keys.
- The generated `public/helpers.js` keeps both delivery contracts: CommonJS
  exports for server/test consumers and ordinary browser globals before app.js.
  The browser build validates all three entrypoints before writing any output;
  lint derives helper globals from the actual generated export surface.
- Existing helper tests continue through the shipped CommonJS path. New tests
  compare the browser-global surface, exercise browser/Node route decoding and
  math rendering, and cover malformed content/prototype-like names. Compile
  contracts verify generic row preservation and image/result types.
- Strict checks, 899 backend tests, 105 browser regressions, independent UI
  scenarios and complete desktop/mobile smoke passed. Fable review is required
  before push.
- Next: remaining new-session form orchestration and other application features,
  followed by transcript/streaming and startup ownership.

Spawn checkpoint commits `454ce1c` and `e3f30b1` were cleared by Fable 5.1 and pushed.

## Checkpoint 13 — new-session form (verified locally; review pending)

- `new-session.ts` owns the takeover's host/harness selection, generation, refine
  draft, form controls, workspace buttons and its directory, target, harness,
  preference and config-preview controllers. The app retains small integration
  callbacks and the separate shared harness settings editor.
- Workspace actions capture their rendered host and view. Re-render/close
  retires listeners; disposal retires timers and autocomplete/picker handlers,
  drops late harness callbacks and invalidates submitted view guards.
- Existing discovery, model, preference and spawn regressions now use owned
  controller readers/writers instead of mutable application globals. New browser
  cases cover retained workspace buttons and disposal during held harness reads;
  strict contracts reject external generation/draft writes and malformed launch
  values.
- Strict checks, 899 backend tests, 108 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed. Fable review is required before push.
- Next: recovery/bounce controls, then remaining feature controllers and rendering.

Fable 5.1 cleared shared-helper commit `861d799`, which is pushed. Its newer CI
run superseded the spawn run before that run finished its browser job.

## Checkpoint 14 — recovery controls (verified locally; review pending)

- `recovery.ts` owns host recovery preferences and the recovery-report takeover,
  including mode/report decoding, selected endpoint snapshots and view listeners.
- Settings rendering retains its mount across fleet readiness and response bodies.
  Fleet refresh preserves unsaved mode edits unless the selected host or its
  endpoint changes. Submitted saves retain their original endpoint; later results
  cannot write a replacement settings view.
- Report requests and row actions verify host identity, route/token and view
  before acting. Refresh/close retires old controls; duplicate row actions are
  ignored while one is pending. Existing continue/restore confirmations remain.
- Five browser regressions cover held bodies, old saves, retained controls,
  host-scoped exclusions and token changes. Unit/strict contracts cover narrowed
  wire rows and immutable host/report inputs.
- Strict checks, 900 backend tests, 113 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed. Fable review is required before push.
- Next: bounce operations, then remaining browser feature and rendering owners.

Fable 5.1 cleared new-session form commit `9538411`, which is pushed. Shared-helper
commit `861d799` passed all five CI jobs (run `34598941974`).

## Checkpoint 15 — bounce operations (verified locally; review pending)

- `bounce.ts` owns each host's mode/endpoint/target snapshot, selected rows,
  queued/cancelled operations, polling and restart reconciliation. `bounce-data.ts`
  narrows preview/operation/result payloads before state or rendering uses them.
- Controls retain their rendered host/view and operation. Refresh/close retires
  listeners and timers. Status reads cannot overwrite a newer accepted operation;
  endpoint changes invalidate old controls. Accepted mutations retain their host
  and do not retry when response/acceptance is uncertain.
- Host-qualified restart tracking and selected-transcript reconciliation preserve
  the bounce status surface. Disposal prevents late status results from restarting
  polling, writing the view or repopulating pending restart tracking.
- Four browser regressions cover stale previews, retained controls, submitted
  snapshots, old status reads and disposal. Decoder units and strict contracts
  check malformed rows, mode values and readonly host/operation inputs.
- Strict checks, 902 backend tests, 117 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed. The integrated runtime, config
  and test files match that verified draft byte for byte; strict checks passed
  again after integration. Fable review is required before push.
- Next: session navigation/search, then remaining browser feature controllers.

Fable 5.1 cleared recovery commit `b8faac4`, which is pushed.

## Checkpoint 16 — session navigation (verified locally; review pending)

- `session-relations.ts` owns decoded relations, header fitting, the overflow
  modal, indexing/resize timers and navigation. Rendered chips/rows retain their
  originating selection and endpoint; refresh/close/disposal retires listeners.
  An empty refreshed relation list closes its old modal and retires row actions.
- `session-search.ts` owns query/results/position and marks. Requests retain
  selection, endpoint and query sequence; a late same-session query cannot
  replace newer results or revive a closed bar. Paging remains serialized when
  the bar closes/reopens; an old jump retires its highlight before a new query
  resumes against the loaded transcript. Selection changes reset navigation.
- Existing ownership tests use actual search requests instead of assigning
  mutable state. Four new browser cases cover retained relation controls,
  timer disposal, competing queries and closed-bar requests. Decoder units and
  strict contracts narrow identities/indices and reject external state writes.
- Strict checks, 904 backend tests, 121 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
  Fable review is required before push.
- Next: skills and advanced search, then remaining feature/rendering controllers.

Fable 5.1 cleared bounce commit `2e46f5d`, which is pushed.

## Checkpoint 17 — skills view (verified locally; review pending)

- `skills.ts` owns directory/detail state, filtering/sorting, indexing timers,
  coverage presentation and refinement drafts. `skills-data.ts` narrows skill,
  coverage, activation and refinement fields into explicit contracts.
- All rendered actions use owned listeners, including header controls and latest
  activation links. Close/re-render/disposal retires old actions and timers.
  Detail requests cannot replace a newer skill or the directory; Refine stays
  disabled until coverage belongs to the selected skill.
- Activation navigation targets the entry host that supplied the skill data,
  checks ownership through lazy session lookup and guards delayed entry focus.
  Refinement initializes the new-session form on that same host with its path
  and evidence draft; it still never sends the draft automatically.
- Five browser regressions cover old coverage/refine state, retained controls,
  same-id cross-host activation links, indexing disposal and delayed navigation.
  Decoder/strict contracts cover malformed payloads and readonly identities.
- Strict checks, 906 backend tests, 126 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
  Fable review is required before push.
- Next: advanced search and usage, then remaining features and rendering.

Fable 5.1 cleared session-navigation commit `fa5316a`, which is pushed.

## Checkpoint 18 — advanced search

- `search-view.ts` owns query/debounce/indexing state, fan-out results, facet
  listeners and result navigation. `search-data.ts` narrows wire payloads,
  applies the shared host grammar and stamps results with their actual host.
- Typing retires the preceding query before the next debounce runs. Progressive
  host results remain supported; late failures cannot replace newer input.
  Captured endpoints and query/view checks guard navigation and fan-out renders.
- Facet, card and input listeners and timers retire on replacement/close/dispose.
  Three browser regressions cover retained actions, old failures and disposal;
  unit/strict contracts cover malformed results, host stamping and host pruning.
- Strict checks, 908 backend tests, 129 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed on the verified draft. The
  integrated runtime/config/test files match it byte for byte; strict checks
  passed again. Fable review is required before push.
- Fable 5.1 cleared skills commit `3893e90`, which is pushed.
- Next: usage, then remaining features and rendering.

## Checkpoint 19 — usage dashboard

- `usage-view.ts` owns range/sort/filter state, progressive summary fan-out,
  subscription-limit reads, indexing/resize timers, charts and their controls.
  `usage-data.ts` narrows usage/pricing/limit payloads and qualifies workspace
  and session rows before merging, including when just one peer has answered.
- Each limit request accumulates its own results; an old response body cannot
  enter a newer range. A current quota response only re-renders summary data
  belonging to that same fetch. Summary coalescers are explicitly disposable.
- Rendered model/session/day controls and chart pointer/keyboard listeners
  retire with their view or render. Session rows retain their endpoint and host.
  Four browser regressions cover late limits, peer-only partial navigation,
  retained controls, indexing and disposal; decoder/strict contracts cover
  unavailable prices, malformed limits, readonly endpoints and queue disposal.
- Strict checks, 911 backend tests, 133 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
  Fable review is required before push.
- Fable 5.1 cleared advanced-search commit `99b7373`, which is pushed.
- Next: display preferences and panel resizing, then remaining features/rendering.

## Checkpoint 20 — display preferences, themes and resizing

- `display-preferences.ts` owns the preferences modal, device metadata/context
  choices, budget requests and rendered filter controls. Closing or rebuilding
  the modal retires its controls and request responses, including late saves.
- `themes.ts` decodes theme/token payloads, sequences catalog refreshes and
  applies cached/selected themes. `theme-prepaint.ts` produces a small local
  synchronous script before the stylesheet, preserving pre-paint restoration
  while handling unavailable storage. Its output joins the build/staleness tests.
- `panel-resize.ts` owns sidebar and terminal size preferences, pointer captures
  and drag listeners. Disposal releases captures and retires in-progress drags;
  repeated initialization is idempotent and zero-height terminal drags are ignored.
- Four browser regressions cover retained settings controls, late reads/saves,
  overlapping/disposed theme refreshes and pointer disposal. Unit/strict contracts
  cover payload narrowing, unavailable storage, size clamps and readonly settings.
  Existing smoke exercises actual preference controls instead of writing globals.
- Strict checks, 913 backend tests, 137 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
  Fable review is required before push.
- Fable 5.1 cleared usage commit `07e4505`, which is pushed.
- Next: terminal lifecycle, then remaining features/rendering and shell.

## Checkpoint 21 — terminal lifecycle

- `terminal.ts` owns terminal instances, pending opens, captured session/endpoint
  identity, ticket requests, socket replacement, reconnect timers and key input.
  Xterm and the fit addon use their vendor TypeScript contracts without adding
  a runtime dependency to the local browser bundle.
- Close cancels opens waiting for assets/fonts, even before a terminal exists.
  Font deadlines are cleared when readiness or cancellation wins. Overlapping
  ticket requests admit only the latest connection; retired socket and terminal
  input callbacks cannot act on a replacement or different selected host.
- Keybar and viewport listeners follow controller/terminal lifetimes. Disposal
  clears reconnects, instances and pending opens. Socket payloads are narrowed
  before output/attach/error handling; per-host mode storage remains qualified.
- Five focused browser scenarios replace the old mutable-global probe and cover
  reconnect/host switches, asset/font cancellation, ticket races, reconnect
  disposal and mobile input callbacks. Unit/strict tests cover wire contracts.
- Strict checks, 914 backend tests, 141 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
  Fable review is required before push.
- Fable 5.1 cleared display commit `dbdb6fe`, which is pushed. The generated-file
  guidance in AGENTS.md now names all four browser outputs.
- Next: routine form/invocation ownership, then remaining features and shell.

Fable's terminal review identified a removed-host lookup returning null. The
terminal host contract is now nullable; open and all ownership checks retire
safely when that host disappears. A fifth browser regression covers removed-host
socket messages, close/resize/key callbacks and reopening. Full local checks
passed again after the fix. AGENTS.md now includes the pre-paint output.

## Checkpoint 22 — routine forms and invocation history

- `routines-view.ts` owns routine list fan-out, selected host/id, form baselines,
  catalog requests, saves/invokes/deletes, version controls and invocation polling.
  `routines-data.ts` narrows definitions, prompt versions, ledger rows and cursors.
- Form requests and controls retain their view, form and endpoint. A response for
  the same id on another host cannot replace the current form. A new form can
  load its runs while an old ledger request remains in flight. Old mutation
  finalizers cannot release another form's busy state.
- Catalog caches include endpoints; host/harness/cwd changes retire prior option
  renders. Close/reopen preserves current field values and the dirty baseline,
  and edits made during a save survive the saved version's response.
- List/form/version/invocation controls have owned listeners. Close/disposal
  retires autocomplete, render coalescers, ledger polling and delete-arm timers.
  Removed hosts disable actions without throwing. Run navigation keeps its
  answering host and checks selection through any lazy session-list lookup.
- Eleven browser regressions cover late detail/ledger/save/invoke/delete responses,
  catalog host changes, retained controls, draft preservation, host removal and
  session navigation. Decoder/strict contracts cover versions, cursors and owners.
- Strict checks, 916 backend tests, 152 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
  Fable review is required before push.
- Fable 5.1 cleared amended terminal commit `0e5aef8`, including the removed-host
  fix and corrected AGENTS.md output inventory, before its push.
- Usage checkpoint `07e4505` passed all five CI jobs in run `34604387530`.
- Next: session statistics, sharing and artifacts, then remaining features/shell.

- Fable's routines review found that a rotated host token left retained form
  controls inert. Requests now retain host/base identity while reading the
  current token at dispatch. A changed base can be recovered through the live
  back control and same-row reload; reopening shows a disabled state and a
  recovery message while preserving the draft. Two new regressions cover both.
  All required checks passed again after the fix; follow-up review precedes push.

## Checkpoint 23 — session statistics, sharing and artifacts

- `session-info.ts` owns the stats overlay, process actions, share/page controls,
  artifact discovery and message share copies. `session-info-data.ts` narrows
  statistics, costs (including unavailable prices), runtime, share and page data.
- Stats renders and share/page/process sections retain separate request and
  listener generations, selection owners and answering endpoints. Retained
  controls cannot act on a newly opened modal or a same-id peer session.
- Artifact discovery and revoke actions retain their answering host. Message
  link copies guard both the share lookup and the clipboard effect, including
  existing-share responses that settle after navigation. Close/disposal retires
  controls and feedback timers.
- Failed share/page mutations report server errors and restore usable controls
  without claiming success. Process actions preserve capability gates and close
  selection behavior; duplicate close/restart actions stay disabled in flight.
- Five browser regressions cover retained controls, delayed share copies,
  mutation errors, same-token artifacts and disposal. Decoder/strict contracts
  cover unavailable costs and readonly artifact identities.
- Strict checks, 918 backend tests and 157 browser regressions passed, as did
  independent UI scenarios and full desktop/mobile smoke. The skills scenario's
  assertions passed on its first run, but temporary-directory cleanup raced;
  its targeted rerun passed. Integrated runtime/config/test files match the
  verified draft byte for byte; strict checks passed again before commit.
- Fable 5.1 cleared the routines host-rotation fix in `61c5691` before push.
  Terminal checkpoint `0e5aef8` has a successful CI workflow in run `34607561015`.
- Next: transcript tree navigation, rich text rendering and remaining shell.

## Checkpoint 24 — transcript tree and branch navigation

- `transcript-tree.ts` owns tree loads, filters, node rendering, branch controls,
  request generations and view disposal. `transcript-tree-data.ts` narrows tree
  nodes, active paths and tool summaries, bounding indentation for malformed data.
- Filter and row/branch controls use owned listeners. Retained rows and branch
  buttons cannot act on a newly rendered tree. Node ids and unknown roles render
  as escaped text instead of inline handlers or raw markup.
- Branch replies save editor text only to the originating host-qualified empty
  draft. A branch may still reload or report an error after simple dismissal on
  that same selection, preserving existing behavior. Reopening the tree retires
  older completion effects so they cannot close the new tree or enable controls.
- Five new browser regressions cover filter/retained-control ownership, late
  success/failure after reopen, unusual ids/roles and disposal. Eight existing
  menu ownership cases also pass, including both dismissed-branch completions.
- Strict checks, 919 backend tests, 162 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
- Fable 5.1 cleared session information commit `6ddf1ab` before push.
- Next: rich text/diagram rendering, extension UI and remaining shell.

## Checkpoint 25 — Markdown, diagrams and local assets

- `rich-text.ts` owns Markdown setup, safe HTML/link handling, literal tilde
  semantics, math extensions, final highlighting, file-path links and code-copy
  controls. `rich-text-vendors.ts` declares the supported vendored runtime surface.
- `browser-assets.ts` deduplicates local script/stylesheet loads, removes failed
  elements for retry and rejects pending loads on disposal. `clipboard.ts`
  preserves native clipboard delivery and the insecure-context textarea fallback.
- `diagrams.ts` owns deferred renders, per-block source/theme generations and
  zoom overlays. Late renders cannot overwrite a newer theme; retained detached
  transcripts still render without scrolling the currently selected feed.
- A still-pinned feed is measured before inserting a taller SVG, then carried
  down after insertion. An initial post-insertion check incorrectly treated the
  diagram's growth as user scrolling, leaving the jump button over a mobile
  terminal key. The corrected ordering and a focused regression both pass.
- Disposal cancels deferred diagram tasks, copy feedback timers and owned
  listeners. Replaced lightbox controls cannot act on the current overlay.
- Seven browser regressions cover escaping, load deduplication/retry/disposal,
  theme races, detached rendering, lightbox and copy lifetimes, and pinned growth.
- Final strict checks, 919 backend tests, 169 browser regressions, every independent
  UI scenario and full desktop/mobile smoke passed after the scroll correction.
  Integrated runtime/config/test files match the verified draft byte for byte;
  strict checks passed again before commit.
- Fable 5.1 cleared tree commit `54264af` before push.
- Next: extension widgets/status/dialogs, file/comment surfaces and remaining shell.

## Checkpoint 26 — Extension display and dialogs

- `extension-ui-data.ts` narrows extension requests/questions/options and strips
  display ANSI without modifying wire objects. `extension-ui.ts` routes only the
  captured host/session and composes display and interactive surfaces.
- `extension-display.ts` owns widget/status entries, collapsed preferences,
  removal grace/fade timers, toasts, listeners and resize observation. Reprojection
  cancels both removal phases; disposal retires every owned resource.
- `extension-dialogs.ts` keys cards by host/session/request. Stashed cards retain
  edits and selections; redocking captures a new selection owner. Replaced or
  detached controls cannot answer a later card with the same request id.
- Responses retain their endpoint base and resolve current credentials at dispatch.
  Authoritative dialog reconciliation prunes only the named host/session; malformed
  state does not prune. Dialog retirement aborts card listeners.
- Two decoder/type regressions and six browser cases cover stashing, duplicate
  request ids, ask answers, host-scoped reconciliation, display timers and disposal.
- Strict checks, 921 backend tests, 175 browser regressions, every independent UI
  scenario and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
- Fable 5.1 cleared renderer commit `b15c5a5` before push.
- Next: file/diff views, anchored comments and remaining transcript/shell logic.

## Checkpoint 27 — File previews and lazy diffs

- `file-views.ts` owns mutually exclusive file/diff views, captured host endpoints,
  read-only view snapshots, request generations and per-render listener lifetimes.
  `file-view-data.ts` narrows wire data and `file-view-render.ts` renders escaped
  repository/file metadata while preserving deferred patch snapshots.
- Publication lookup cannot overwrite a newer publish or unpublish. Duplicate
  publishes are suppressed, HTTP revoke errors keep the link, and failed publishes
  restore existing row controls. Replaced rows and clipboard completions retire.
- Lazy patches carry row/request ownership plus repository/path/snapshot identity.
  Closed/refreshed rows cannot fetch or publish a late response. Stale snapshots
  refresh the current diff; failed patches remain retryable.
- Endpoint bases stay captured while credentials refresh at dispatch. Disposal
  retires view listeners, rows and clipboard feedback timers.
- Two decoder/render tests and seven browser cases cover overlapping views,
  publication races/errors, retained controls, patch refresh/retry and disposal.
  The existing delayed-comment focus case now opens a real fixture diff instead
  of assigning private view state.
- Strict checks, 923 backend tests, 182 browser regressions, every independent UI
  scenario and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
- Fable 5.1 cleared extension UI commit `0c1e3a0` before push.
- Next: anchored comments, transcript/composer orchestration and shell wiring.

## Checkpoint 28 — Anchored comment selection and editors

- `anchored-comment-data.ts` narrows comment/index targets and positive line
  coordinates. `comment-anchors.ts` owns exact quote extents, context-based
  disambiguation and marks spanning multiple rendered text nodes.
- `anchored-comments.ts` captures the file/diff view and endpoint for every
  selection, editor, list and request. Overlapping index/body refreshes publish
  only the newest marks; comments from another session or file are filtered.
- Save/delete share an editor busy state. Closing/reopening resets both controls;
  old completion effects cannot disable or close a newer editor. Successful
  mutations still refresh their current originating view.
- Pointer/keyboard selection callbacks, delete confirmation and reposition timers
  are owned and cancelled. Replaced/closed list rows abort their listeners;
  disposal retires listeners, marks, timers and resize observation.
- Two decoder/quote tests and seven browser regressions cover refresh overlap,
  same-id host changes, busy/delete recovery, retained rows, delayed selection,
  split-node anchors and disposal. Existing UI create/edit/delete flows pass.
- Strict checks, 925 backend tests, 189 browser regressions, every independent UI
  scenario and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
- Fable 5.1 cleared file/diff commit `63f9893` before push.
- Next: session header controls, transcript/composer orchestration and shell wiring.

## Checkpoint 29 — Session header controls and export

- `session-controls.ts` owns model/thinking menu attempts, outside listeners,
  selector instances, inline rename ownership, preference debounce and exports.
  Closing a pending menu retires its catalog completion on the same selection.
- Rename captures its owner on editor open. Mutations retain their endpoint and
  update their originating host after navigation; per-session/field generations
  keep an older response from overwriting a newer requested value.
- Enabled-model edits snapshot the serving Pi instance's preference before the
  debounce, preserving that scope when the menu closes or selection changes.
- Exports preserve tokenless navigation and authenticated blob delivery without
  a deadline. Captured bytes/names can finish after navigation, status remains
  selection-owned, and download URLs/timers retire on disposal.
- The initial selector test caught legacy click-property assignments duplicating
  newly owned listeners. Those assignments are removed; all 19 existing header
  ownership/selector regressions and baseline measurements pass.
- Eight new browser cases cover pending close, rename retargeting, mutation order,
  preference debounce, export origin/cleanup and disposal. The export fixture
  confirms the originating-name fallback when CORS hides Content-Disposition.
- Strict checks, 925 backend tests, 197 browser regressions, every independent UI
  scenario and full desktop/mobile smoke passed. Integrated runtime/config/test
  files match the verified draft byte for byte; strict checks passed again.
- Fable 5.1 cleared anchored comments commit `ab4559b` before push. All five CI
  jobs passed for renderer checkpoint `b15c5a5` (run `34612052395`).
- Fable found that one global export sequence suppressed an earlier requested
  download after another export. Downloads now each deliver captured bytes;
  only feedback uses that sequence. An overlapping-export regression and the
  repeated full checks pass. Tokenless navigation retains the original arguments.
- Next: dictation/media, composer and transcript orchestration, and shell wiring.

## Checkpoint 30 — Dictation and composer notes

- `composer-speech.ts` owns microphone permission, recording tracks/chunks,
  recorder listeners, duration timers and transcription requests. Each take and
  request retains its composer key and selection; late results cannot retarget.
- Cancellation includes pending permission. A late stream is stopped without
  creating a recorder; releasing touch before permission cancels the held take.
  Retired recorder events cannot release a newer take or transcribe old chunks.
- Track/timer/listener cleanup covers cancellation, recording errors and disposal.
  Transcription remains batch-based and inserts at the caret for review without
  sending. Host capability and secure-origin gating retain their existing behavior.
- `composer-notes.ts` keeps text-only error notes and retires replaced dismiss
  buttons. Seven browser cases use fake media objects to cover these lifetimes.
- Strict checks, 925 backend tests, 204 browser regressions, every independent UI
  scenario and full desktop/mobile smoke passed on the corrected header baseline.
  An earlier rename smoke timeout did not recur in a complete diagnostic run or
  the repeated full suite. Synthetic-microphone smoke exercises actual encoding
  and the fake STT endpoint. Integrated runtime/config/test files match the draft;
  strict checks passed again.
- Fable 5.1 cleared amended header commit `102375e` before push.
- Next: drafts/attachments, autocomplete, transcript/composer and shell wiring.

## Checkpoint 31 — composer drafts and images

Moved drafts, bounded history, attachment preparation, clipboard file reads and
image lightboxes into two strict TypeScript controllers. Host-qualified composer
keys own timers and batches; spawn migration carries pending images and dirty text.
Discard retires pending additions, and replaced image buttons cannot remove a
new owner’s attachment. Foreign history/clear operations preserve current drafts.

Verification: strict checks, 927 backend tests, 210 browser tests, every isolated
UI scenario and full desktop/mobile smoke passed. Added two pure regressions,
strict contracts and six browser ownership cases. The actual worktree matches
the verified runtime and test files byte for byte. Fable review is required before push.

## Checkpoint 32 — composer autocomplete and session references

Moved command/file/session completion and reference resolution into three strict
TypeScript modules. File queries capture composer, selection, text/caret and host
endpoint before debounce; menus retire row and blur callbacks. Directory drilling
retains focus, and file acceptance emits input for draft/autosize persistence.
Reference grammar and cross-host prefix widening preserve existing behavior.

Verification: strict checks, 929 backend tests, 218 browser tests, all isolated
UI scenarios and full desktop/mobile smoke passed. Two pure checks, strict
contracts and eight ownership regressions cover stale debounce/catalog results,
retained rows, directory drilling, malformed wire data, drafts and disposal.
Actual runtime/tests match the verified draft byte for byte. Fable reviews before push.

Fable also noted that caret movement retired acceptance without hiding a painted
menu. Selection/select listeners now hide it immediately; an eighth regression
and the complete suite passed after this correction.

## Checkpoint 33 — sidebar projection

Moved session rows, family blocks, pending launches, workspace/host/date groups,
search ranking and hidden-row notes into a strict TypeScript projection. Narrowed
metadata remains separate from the authoritative session store. Read-only snapshots
carry pin/expansion/collapse state; unchanged HTML still avoids sidebar DOM churn.

Verification: strict checks, 932 backend tests, all browser/UI scenarios and full
desktop/mobile smoke passed. Three pure regressions cover malformed metadata,
independent host collapse/families and server-search/scoping authority. The later
sidebar-control draft also passed 225 browser tests on the corrected autocomplete
baseline. Actual runtime and test files match the verified projection draft.
Latest confirmed CI: `fc174c6`, all four Node jobs and the browser job passed.

## Checkpoint 34 — sidebar controls

Moved family pin/expansion and collapse preferences, host-key migration, row close
confirmation, context menus, delegated row actions and pointer reordering into a
strict controller. Close confirmation retains the target endpoint; changed bases
require a fresh confirmation and same-base dispatch refreshes credentials.
Clipboard completion cannot relabel or close a replacement menu. Only the owning
pointer completes a drag; disposal retires timers/listeners and pending effects.

A read-only selection generation covers actions begun with no selected session.
Such a close still refreshes lists after later navigation without stale feedback.
The previous projection’s unused canonical-family wrapper is removed, and its
CI checkpoint description/count is corrected to the verified draft/image result.

Verification: strict checks, 932 backend tests, 225 browser tests, all independent
UI scenarios and full desktop/mobile smoke passed. Seven new ownership cases and
strict contracts cover menus, endpoint changes, empty/peer selection, family
preferences, pointer identity and disposal. Actual runtime/tests match the verified
draft byte for byte. Fable review remains required before push.

## Checkpoint 35 — sidebar queries, polling and activity

Moved tab/view/query state, saved scopes, search debounce, device unread tracking,
list fan-out and indexing/poll timers into three strict controllers. Input retires
old host observations before debounce; disposal stops polls and indexed refreshes.
Saved settings use request generations and captured serving endpoints. Scope
buttons retire with the projection, and seen migration/pruning stays host-local.

Corrected the existing search-navigation race test to open search first. Previously
it invoked a closed view and passed only when a background poll exercised its
mocked loader. The corrected test now reaches the intended delayed navigation.

Verification: strict checks, 932 backend tests, 233 browser tests, all independent
UI scenarios and full desktop/mobile smoke passed. Eight new ownership cases and
strict contracts cover debounce, saved scopes, host observations, indexing and
disposal. Actual runtime/tests match the verified draft; Fable reviews before push.

Fable caught a stale inline search-button reference. The magnifier now uses the
query controller’s owned listener, with an actual-button regression. Full backend,
browser and smoke checks passed again before re-review.
Fable’s re-review also restored empty-filter reopen semantics (`undefined` keeps
the prior full-search query). The extended button regression and strict checks
passed; the reviewer approved that exact correction without another full review.

## Checkpoint 36 — message rendering and response details

Moved static transcript projection, custom-message upserts, response telemetry and
tool grouping into four strict modules. Wire inputs are narrowed explicitly,
including legacy content strings, indexed empty assistant entries and tool data.
Timestamp attributes are escaped. Response-detail entries retain their host/session
identity across cached transcript restoration and keep only bounded render data.
Tool group merging preserves the later paging anchor and expanded DOM state.

Verification: strict checks, 934 backend tests, 237 browser tests, all independent
UI scenarios and full desktop/mobile smoke passed on the draft. Two pure tests,
five browser cases and strict contracts cover narrowing, telemetry identity,
metadata disposal, custom upserts and idempotent grouping. The inherited sidebar
button correction passed its extended focused regression and strict check.
Fable review is required before push.

## Checkpoint 37 — live transcript rendering

Moved coalesced assistant frames, live tool panels and mood projection into three
strict modules. Frames capture selection before the 80ms coalescing timer. Tool
panels retain their selected host/session owner, reuse cumulative start updates,
replace image output on partial updates and do not invent completion-only duration.
Tool signatures include the name and arguments, preserving expanded DOM details.
Disposal retires pending frames, live panels and subsequent mutations.

Verification: strict checks, 934 backend tests, 244 browser tests, all independent
UI scenarios and full desktop/mobile smoke passed. Seven focused browser cases
and strict contracts cover frame replacement, host ownership, cumulative panels,
renamed tools, mood text and disposal. Later combined pagination and activity drafts
passed 252/257 browser cases plus all UI checks. Fable reviews before push.
