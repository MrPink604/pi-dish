# pi-dish roadmap and migration status

Updated 2026-09-11. **Browser application source migration is complete and
independently reviewed. Architectural simplification is not complete.**

All first-party browser application logic is authored in `src/browser/`, including
the application entrypoint and static control bindings. The five scripts shipped
under `public/` are generated and checked against strict TypeScript source.
That milestone established checked modules and explicit request/view ownership;
it did not eliminate the browser's classic-script forwarding layer or make the
session metadata pipeline strongly typed end to end.

**Session catalog and metadata are implemented**, connecting discovery, explicit
source resolution, indexed metadata, catalog composition and browser state through
checked contracts. The [implementation record](docs/session-catalog-migration.md)
records verification and both Fable review clearances. Browser composition cleanup is the next
separate stage. Vanilla DOM rendering, local assets and existing server/Electron
delivery remain supported.

Browser work was divided into 43 checkpoints. See
[the checkpoint log](docs/browser-migration-checkpoints.md) for contemporaneous
scope, verification and review notes; some historical entries retain pending
labels and are not a complete clearance ledger. Kimi K3 through OMP cleared the
final implementation range recorded below. Final delivery evidence is separate
from individual review notes and from the next stage's planned work.

## Renewed mission: simplify through checked boundaries

The migration exists to reduce the amount of application context needed to make
a correct change, not to maximize TypeScript line count. The original maintenance
discussion asked whether modules, types or a framework would reduce spaghetti.
The browser stage deliberately narrowed that question to source conversion with
behavior preservation. Its completion is real, but it is not proof that the
original simplification goal has been met.

The next stages must use types to replace repeated responsibility: establish who
owns an identity, a field, a state transition and a cache; validate external input
at that boundary; then carry the established contract to its consumers.
Moving defensive code into more files, adding declarations over unchecked
implementations, or retaining the old architecture behind typed forwarding
wrappers is not sufficient.

Each stage must identify:

- **The contract strengthened:** invalid combinations, misspelled fields or
  unsafe writes the compiler will reject, and external data still requiring
  runtime validation.
- **The complexity removed:** duplicate normalization, competing state/cache
  owners, obsolete adapters or compatibility layers deleted across the whole
  producer/consumer path, not merely a shorter entrypoint.
- **The behavior preserved:** authority, missing/null/fallback semantics,
  identity, request retirement and the performance properties exercised by
  relevant regression and smoke checks.
- **The remaining boundary:** unchecked implementations and deliberately opaque
  extension data, stated honestly rather than counted as migrated.

Keep source coverage, architectural simplification and verified delivery as
separate status measures. File counts, checkpoint counts and test totals are
inventory, not evidence of reduced complexity. A source increase can still be
worthwhile when it removes a competing owner or an invalid state; a source
decrease is not a win when complexity moves into adapters or tests.

The session metadata stage closes `SessionEntry` and its mutation, activity and
transcript writers. Numeric models, misspelled fields and identity writes now
fail compilation. The source resolver replaces the server's path side map and
route cache; catalog composition replaces independent row builders and annotations.
Sidebar/header consumers retain display fallbacks without re-decoding established
fields. The browser's classic-script forwarding facade remains a separate debt.

## Status at a glance

| Area | Status | What that means |
| --- | --- | --- |
| Maintenance and test baseline | Complete | Ownership regressions, isolated browser/UI fixtures, lint, type/build checks and a Node CI matrix are in place. |
| Shared TypeScript foundation | Complete within its defined scope | Identity, harness contracts, capability policy, wire decoding, RPC/bridge session classes and shared transport helpers are typed. This does not include the whole backend. |
| Browser migration | Source implementation complete and reviewed | All first-party application logic and bindings are typed. Local strict, backend, browser and UI checks pass; each push must also pass the CI matrix. |
| Session catalog and metadata | Tasks 1–7 implemented, verified and reviewed | Checked discovery/source/index/catalog and closed browser state replace competing adapters and render-time normalization. Strict checks, 974 backend tests, browser/UI coverage and Fable review are recorded in the stage plan. |
| Remaining server application and feature modules | Later — outside the next bounded stage | Lifecycle redesign, general routes, recovery and feature stores still need separate stages. |
| Harness extensions and Electron shell | Outside the current browser stage | Most extension sources are already TypeScript outside the `src/` build. Remaining extension/shell conversion and checking need a separate audit and plan. |
| UI framework adoption | Deferred | Vanilla TypeScript and ordinary DOM rendering remain the chosen approach. Preact/Svelte adoption is not a scheduled migration stage. |

The completed browser source migration does not imply a whole-application
conversion or complete domain contracts. Session catalog/metadata now establishes
its bounded read path. Browser composition cleanup follows as a separate simplification
candidate; lifecycle, other stores, extension checking and Electron shell scope
remain to be assessed independently.

## What is already in TypeScript

The foundation lives in `src/core/`, with generated CommonJS and declarations
in `lib/`. Its full module inventory is in [the migration guide](docs/typescript.md).
Most JavaScript callers of these modules are not yet type checked; `lib/cron.js`
is an explicitly checked exception.

Browser source compiles strictly into five committed local scripts:
`public/app.js`, `public/browser.js`, `public/helpers.js`,
`public/artifact-comments.js` and `public/theme-prepaint.js`.
`app.ts` composes the controllers; `index.ts` and `shared-helpers.ts` are export
surfaces. `shared-helper-types.ts` and `rich-text-vendors.ts` describe helper and
vendor contracts. The table lists authored implementations; review/push status is
tracked separately in the checkpoint log.

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
| `session-spawns.ts` | Submitted spawn snapshots, provisional rows, polling and composer reconciliation |
| `new-session.ts` | Form state, host/harness controls, discovery coordination, workspace actions and submitted view ownership |
| `recovery.ts` | Host recovery settings/report wire data, view lifecycle and captured mutations |
| `bounce-data.ts` | Narrowed bounce previews and operation/target result contracts |
| `bounce.ts` | Host snapshots, selected bounce targets, operation polling and restart reconciliation |
| `session-relations.ts` | Related-session wire rows, header/modal controls, indexing refresh and navigation |
| `session-search.ts` | Query/match state, request sequencing, marks and serialized paging jumps |
| `browser-assets.ts` | Local vendor load deduplication, retries and disposal |
| `extension-ui.ts`, `extension-ui-data.ts`, `extension-display.ts`, `extension-dialogs.ts` | Typed extension requests, widgets/status, dialog cards and response ownership |
| `file-views.ts`, `file-view-data.ts`, `file-view-render.ts` | File/diff ownership, publication controls, narrowed wire data and diff rendering |
| `anchored-comments.ts`, `anchored-comment-data.ts`, `comment-anchors.ts` | Comment selection/editing, refresh ownership and durable quote/line marks |
| `session-controls.ts` | Header menu lifetimes, owned rename/model/thinking mutations and export resources |
| `composer-speech.ts`, `composer-notes.ts` | Dictation permission/recording/transcription ownership and persistent composer notes |
| `composer-drafts.ts`, `composer-images.ts` | Host-qualified drafts/history, spawn migration and asynchronous image batches |
| `composer-autocomplete.ts`, `composer-autocomplete-data.ts`, `session-references.ts` | Composer query/menu ownership and typed session references |
| `sidebar-render.ts` | Explicit row metadata and sidebar family, host, workspace and date projection |
| `sidebar-controls.ts` | Preferences, family pins, captured close endpoints, clipboard menus and pointer drag ownership |
| `sidebar-query.ts`, `sidebar-lists.ts`, `sidebar-activity.ts` | Query/scopes, list fan-out/indexing/polls and host-qualified seen tracking |
| `message-data.ts`, `message-render.ts`, `response-details.ts`, `message-groups.ts` | Narrowed message projection, retained response telemetry and deterministic tool groups |
| `live-tools.ts`, `streaming-render.ts`, `mood.ts` | Live tool lifecycle, coalesced owned frames and mood projection |
| `transcript.ts`, `transcript-data.ts`, `transcript-cache.ts` | Tail/older/catch-up request ownership, pagination cursors and retained DOM |
| `session-activity.ts`, `btw-panel.ts` | Turn/compaction timers, abort gate ownership and ephemeral side-question views |
| `composer-submit.ts`, `prompt-delivery.ts` | Captured prompt/command/abort requests, optimistic ledger and owned queue rows |
| `message-stream.ts` | Captured stream tickets, event ownership, deduplication and reconnect timing |
| `session-view.ts`, `session-resume.ts`, `session-header.ts` | Selection/provisional view ownership, resume requests and narrowed header metadata |
| `app.ts`, `app-chrome.ts`, `app-bindings.ts`, `host-view.ts` | Typed composition/startup, page chrome ownership, registered static actions and host presentation |
| `rich-text.ts` | Markdown configuration, final highlighting, file links and copy controls |
| `diagrams.ts` | Diagram rendering/theme generations and lightbox controls |
| `clipboard.ts` | Native clipboard and insecure-context textarea fallback |
| `transcript-tree-data.ts` | Transcript tree nodes, tool calls and active paths |
| `transcript-tree.ts` | Tree loading/filtering/rendering and branch request ownership |
| `session-info-data.ts` | Session statistics, share and published page payloads |
| `session-info.ts` | Stats/process/share controls and artifact discovery ownership |
| `routines-data.ts` | Routine definitions, prompt versions and invocation payloads |
| `routines-view.ts` | Routine forms, catalogs, mutation/ledger ownership and polling |
| `terminal.ts` | Terminal lifecycle, pending opens, ticket/socket ownership and input |
| `display-preferences.ts` | Settings lifecycle, budget requests and device readouts |
| `themes.ts` / `theme-prepaint.ts` | Theme decoding, catalog refresh and synchronous cache restoration |
| `panel-resize.ts` | Sidebar/terminal size preferences and owned pointer drags |
| `usage-data.ts` | Explicit usage/limit payloads and host-qualified grouping |
| `usage-view.ts` | Range/filter requests, progressive summaries, charts and quota ownership |
| `search-data.ts` | Explicit search payloads, host pruning and result merging |
| `search-view.ts` | Fleet query lifecycle, facets and host-scoped result navigation |
| `skills-data.ts` | Narrowed directory, coverage, usage and refinement payloads |
| `skills.ts` | Skill directory/detail lifecycle, coverage controls, refine drafts and activation navigation |
| `helper-values.ts` | Unknown-value guards and compatible timestamp conversion |
| `helper-format.ts` | Labels, durations, metadata, input insertion and download filenames |
| `helper-content.ts` | Narrowed content blocks and tool summaries/results |
| `helper-identity.ts` | Host/session display identity and capability presentation |
| `helper-sessions.ts` | Workspace/date grouping, family trees, pinned rows and relation ordering |
| `helper-query.ts` | Shared filter grammar, scoring, fuzzy matching and snippets |
| `helper-refs.ts` | Session-reference grammar, aliases, resolution and prompt context blocks |
| `helper-usage.ts` | Cross-host usage merging, chart calculations and quota presentation |
| `helper-models.ts` | Model refs, thinking levels, scope patterns and role values |
| `helper-markdown.ts` | Markdown URLs, math/diagram detection, file mentions and diff markup |

## Browser delivery

The final implementation passed strict checks, 938 backend tests, 277 browser
regressions, all independent UI scenarios and full desktop/mobile smoke. Kimi K3
through OMP (`kimi-code/k3`) cleared the five-commit implementation range
`fab8947..28627d1` without blocking findings.

The browser stage was delivered at `8ac580d617b5d3461ca4601a690b08ac839c23d1`.
[All five CI jobs passed on that exact commit](https://github.com/MrPink604/pi-dish/actions/runs/34633082275):
backend on Node 22.19.0, 22.x, 24.x and 26.x, plus the Node 24 browser job,
including regressions, independent UI scenarios and desktop/mobile smoke.
This records the completed browser milestone, not verification of future
catalog/metadata implementation. Later changes require their own checks.

The source finish line is met: first-party browser application logic is authored
in TypeScript with explicit state, request and view owners. `public/app.js` is
generated; edit `src/browser/app.ts` and rebuild. Static HTML contains action
names instead of executable event handlers.

## Ordered next work

1. **Browser composition cleanup.** Replace the broad classic-script forwarding
   facade with ordinary bundled dependencies and explicit composition. Migrate
   test instrumentation without losing ownership-race coverage; do not recreate
   the facade as an equally broad permanent debug object. This is a separate
   stage, not bundled into the metadata cutover.
2. **Remaining backend boundaries.** Evaluate lifecycle orchestration next on
   safety and simplification grounds; migrate feature stores when their consumer
   contracts justify it, not simply because they are easy JavaScript files.
   Audit extension checking and Electron before claiming whole-application coverage.

There is no scheduled framework adoption or blanket `server.ts` conversion.
Reconsider a leaf renderer only against a concrete maintenance problem and the
existing framework-assessment criteria. Source migration alone does not justify
a new framework or a rewrite of persistence and deployment.

## Review and verification

For each implementation chunk: define the boundary, migrate it, run the relevant checks,
commit locally, get the authorized external review of the commit(s), resolve
findings and re-review any fixes before pushing. Preserve
host/session ownership, local browser assets and existing deployment paths.
Follow [AGENTS.md](AGENTS.md) and [the test matrix](docs/testing.md) for required
checks. Documentation-only changes need content and link checks. After a chunk
ships, update this page's checkpoint, completed inventory and next step so the
status stays current.

Earlier CI baseline: `fab8947` (transcript pagination).

- Fable 5.1 cleared the checkpoint before push.
- Strict checks, 936 backend tests, 252 browser regressions, independent UI
  scenarios and full desktop/mobile smoke passed locally.
- [All five CI jobs passed](https://github.com/MrPink604/pi-dish/actions/runs/34626615561):
  backend on Node 22.19.0, 22.x, 24.x and 26.x, plus the Node 24 browser job.
- This is checkpoint 38 evidence only. Use the CI run for the exact final commit
  to verify the completed browser delivery.

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
