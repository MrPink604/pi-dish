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
