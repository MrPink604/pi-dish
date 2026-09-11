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
- Source mutation, persistence, connection observations and rendering remain
  explicit callbacks until their own modules migrate.
- Verification: strict build/lint/type checks, 853 backend tests, 64 browser
  regressions, all independent UI scenarios and desktop/mobile smoke passed.
  Fable 5.1 commit review is required before pushing, as specified above.
- Next: host catalog state/editing and settings UI, then remaining new-session
  request controllers.
