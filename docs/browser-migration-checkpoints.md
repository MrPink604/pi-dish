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
