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

## Checkpoint 5 — directory controllers (local verification complete)

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
