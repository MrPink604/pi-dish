# pi-dish roadmap and migration status

Updated 2026-09-11. **The TypeScript migration is in progress. The shared
foundation is complete; browser migration is the current stage. Most application
code still lives in JavaScript.**

The browser-completion goal is active. Host identity and fleet discovery is
checkpoint 1; host catalog state/editing is checkpoint 2. Both are pushed after
Fable review. Host settings UI and add-host request owners are checkpoint 3,
also pushed after review. Checkpoint 4 completes host color state/presentation and is pushed after review.
Checkpoint 5 migrates directory lookup, autocomplete and the lazy tree.
Checkpoint 6 migrates the tmux target catalog and picker.
Checkpoint 7 migrates shared model catalog state and request ownership.
Checkpoint 8 converts the standalone published-page comments entrypoint.
Checkpoint 9 migrates new-session model/thinking preferences and defaults preview.
Checkpoint 10 migrates the shared harness settings editor. See
[the checkpoint log](docs/browser-migration-checkpoints.md) for implementation
verification and the complete browser entrypoint inventory. The last confirmed
CI checkpoint is recorded below; final CI must pass before the goal is complete.

## Status at a glance

| Area | Status | What that means |
| --- | --- | --- |
| Maintenance and test baseline | Complete | Ownership regressions, isolated browser/UI fixtures, lint, type/build checks and a Node CI matrix are in place. |
| Shared TypeScript foundation | Complete within its defined scope | Identity, harness contracts, capability policy, wire decoding, RPC/bridge session classes and shared transport helpers are typed. This does not include the whole backend. |
| Browser migration | In progress — current stage | Twenty-two implementation modules are typed. Most controllers and rendering remain in `public/app.js`. |
| Remaining server application and feature modules | Later — not yet migrated | Express routes, application/lifecycle orchestration and feature stores still need separate bounded stages. |
| Harness extensions and Electron shell | Outside the current browser stage | Most extension sources are already TypeScript outside the `src/` build. Remaining extension/shell conversion and checking need a separate audit and plan. |
| UI framework adoption | Deferred | Vanilla TypeScript and ordinary DOM rendering remain the chosen approach. Preact/Svelte adoption is not a scheduled migration stage. |

The foundations and several browser boundaries have
shipped; substantial application migration remains. At `53b5ae0`, `public/app.js`
still has about 13,800 lines and `server.js` about 7,400. These are scope indicators,
not a completion percentage. The remaining work is not divided into equal-sized
units, so a percentage or completion date would imply precision we do not have.

## What is already in TypeScript

The foundation lives in `src/core/`, with generated CommonJS and declarations
in `lib/`. Its full module inventory is in [the migration guide](docs/typescript.md).
Most JavaScript callers of these modules are not yet type checked; `lib/cron.js`
is an explicitly checked exception.

These twenty-two browser implementation modules compile strictly into local
`public/browser.js` and `public/artifact-comments.js` scripts; `index.ts` is the
main bundle entrypoint and `artifact-comments.ts` is the standalone page entry:

| Completed browser module | Responsibility now owned by TypeScript |
| --- | --- |
| `api-client.ts` | Host/auth resolution, JSON requests, decoded session/model reads and selected mutations |
| `session-state.ts` | Session lists, selected session, state writers and immutable selection ownership tokens |
| `model-selector.ts` | Model-selector DOM, actions and disposal |
| `thinking-selector.ts` | Thinking-selector DOM, actions and disposal |
| `host-connections.ts` | Connection observations, retry/backoff and poll eligibility |
| `host-session-loader.ts` | Per-host shared requests, cached rows and request retirement |
| `host-catalog.ts` | Host URL normalization, stored catalog projection and source merging |
| `harness-discovery.ts` | Harness-picker requests, ownership and the per-host settings-badge cache |
| `host-discovery.ts` | Self/fleet request sequences, descriptor ownership and refresh timing |
| `host-directory.ts` | Catalog/fleet/self state, effective lookups and owned source writers |
| `host-settings.ts` | Host settings DOM, catalog actions and add-host request/view ownership |
| `host-presentation.ts` | Device color state, palette order, host chips/dots and native color resolution |
| `directory-catalog.ts` | Host-owned known paths and directory response decoding |
| `cwd-autocomplete.ts` | Shared cwd suggestions, request/query ownership and listener/timer cleanup |
| `directory-tree.ts` | Lazy directory DOM, captured host actions and tree disposal |
| `spawn-targets.ts` | Host-owned tmux target choices, resume/spawn descriptors and run-in picker DOM |
| `model-catalog.ts` | Shared model catalog, request/view owners, cache scope and enabled-model writers |
| `artifact-comment-data.ts` | Narrowed published-page comment/index payloads and error messages |
| `artifact-comments.ts` | Standalone comment composer, page anchors, edits/deletes and refresh ownership |
| `new-session-options.ts` | Per-harness model/thinking preferences, select rendering and owned defaults preview |
| `harness-settings-data.ts` | Harness defaults, agent settings and custom-role wire decoding |
| `harness-settings.ts` | Shared settings editor, captured view/endpoint reads and serialized save ownership |

The checkpoint log distinguishes local implementation from completed review and push.
A completed module means that boundary has moved, been reviewed and verified.
It does **not** mean its entire feature is migrated: for example, model-selector
DOM, catalog and new-session preferences are typed; session menu orchestration
still has JavaScript in the app. Selection ownership guards are already used throughout the browser,
but many guarded feature implementations themselves remain JavaScript.

## Next implementation steps

This is the intended order. Each row may require several independently reviewed
commits; it is not a promise that one row equals one change.

| Order | Work | Completion criterion |
| --- | --- | --- |
| 1 — implemented | Host identity and fleet discovery: `loadHostIdentity`, `loadHostFleet`, `identifyHosts` and their request state | Typed controller owns descriptor requests and their captured host/source identities; catalog persistence and UI callbacks remain explicit. Old-server fallback, refresh timing and stale-response behavior are verified. |
| 2 — implemented | Host catalog editing and settings UI: persistence, add/remove/token actions and host-section rendering | Storage and network boundaries are typed; each action retains its intended host, and view listeners have explicit cleanup. |
| 3 | Remaining new-session request controllers: workspace/directory lookup, spawn targets, model/config discovery and spawn coordination | Requests retain host, harness, cwd and operation ownership; delayed results cannot change a newer configuration or retarget a spawn. |
| 4 | Remaining browser features, extracted one feature at a time | Composer/queue, dialogs, search/usage, shares/pages/comments, tree and other feature state, requests and UI move behind typed contracts. Each feature gets its own scope before implementation. |
| 5 | Transcript/streaming, file/diff and terminal surfaces, then the remaining app shell | Rendering and transport ownership move without losing streaming coalescing, retained transcript DOM, pagination, scroll state or terminal cleanup. |

**Browser-stage finish line:** first-party browser application logic is authored
in TypeScript, with typed state, request and view boundaries. `public/app.js` no
longer contains the remaining feature implementations. JavaScript generated for
runtime delivery and vendored libraries are expected to remain.

**After the browser stage:** plan the remaining server application/lifecycle and
feature-store migrations separately. Existing typed RPC/bridge internals do not
make the Express server, session index/recovery, routines, shares or other stores
fully typed. Audit extensions and the Electron shell before declaring a whole-
application migration complete. These later areas are not yet a commit-by-commit
plan.

## Review and verification

For each implementation chunk: define the boundary, migrate it, run the relevant checks,
commit locally, get Fable 5.1 review of the commit(s), resolve findings and
re-review any fixes before pushing. Preserve
host/session ownership, local browser assets and existing deployment paths.
Follow [AGENTS.md](AGENTS.md) and [the test matrix](docs/testing.md) for required
checks. Documentation-only changes need content and link checks. After a chunk
ships, update this page's checkpoint, completed inventory and next step so the
status stays current.

Last confirmed CI checkpoint, `338addd` (newer local work is in the checkpoint log):

- Fable 5.1 cleared the standalone artifact-comment commit before push.
  New-session options commit `5e983d6` is also reviewed and pushed.
- 886 backend tests and 92 browser regressions passed, along with independent UI
  scenarios and desktop/mobile smoke. OMP/Prime fake-provider canaries last passed
  at `53b5ae0`; they will run again for the final browser audit.
- [All five CI jobs passed](https://github.com/MrPink604/pi-dish/actions/runs/34594283525):
  backend Node 22.19.0/22.x/24.x/26.x and browser/UI on Node 24.

These results establish a verified checkpoint, not exhaustive application coverage
or completion of the remaining migration.

## Completed work before the current stage

- Baseline maintenance and test isolation/CI: completed 2026-09-09, including
  SSH-forward cleanup and host-aware session/composer/family ownership fixes.
- Mobile session chrome and composer redesign: completed 2026-09-10;
  [design and mock](docs/design/mobile-chrome-composer.md).
- Typed session/model API contracts, browser build and model-selector baseline:
  completed 2026-09-10; [baseline evidence](docs/model-selector-baseline.md).
- Session-store migration: completed 2026-09-10. Host connections, per-host session
  loading, thinking selector, host catalog and harness discovery: completed
  2026-09-11. Their current responsibilities are listed above.
- CI synchronization fixes: completed in `ac0d272`, before harness discovery.

The [framework assessment](docs/browser-framework-assessment.md) records the
vanilla TypeScript decision and retains criteria for a possible future experiment.
Historical plans in `TASKS/` and `docs/history/`, including the
[original RPC gap audit](docs/history/2026-07-rpc-gap-audit.md), are not the current
work queue. Check current code and tests before treating an old gap as open work.

## Product limitations outside the migration

- OMP/Prime do not expose the bridge queue-list/cancellation capabilities.
- General terminal component factories and custom tool/message renderers have
  no browser serialization path; see [the historical scoping](EXTENSION_WEB_UI_SCOPING.md).
- Additional OMP host commands need individual evaluation; a command that opens
  a TUI-only interaction must not strand a web user.

Current supported behavior comes from the harness wrappers and server capability
projection; [README.md](README.md) summarizes it. A TypeScript conversion alone
does not add harness capabilities.
