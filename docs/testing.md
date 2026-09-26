# Testing baseline

The maintenance testing stage prepares the existing Express/CommonJS and plain
browser scripts for small refactoring changes. Keep the integration paths green
as boundaries move; extend the focused regressions when a defect exposes a gap.

## Supported tooling and automated checks

The [Tests workflow](../.github/workflows/tests.yml) runs on pushes to `main`,
pull requests, and manual dispatch. All jobs use Ubuntu 24.04 x64 and `npm ci`.

| Tool / environment | Checked scope |
| --- | --- |
| Node 22.19.0 | Exact minimum from `package.json`; lint, types, full backend |
| Latest Node 22, 24, 26 patches | Lint, types, full backend on each major |
| Node 24 + Playwright 1.63.0 managed Chromium | Focused browser tests, eight independent smoke features, full desktop/mobile smoke |
| Bun 1.3.14 | OMP bridge fixture execution in backend jobs |
| Bundled Pi from the lockfile | Real Pi bridge canary in every backend job |
| OMP 18.1.16 | Opt-in real CLI canary, verified locally on 2026-09-09 |
| Prime Agent 0.9.4 | Opt-in real CLI canary, including owned-root close/resume and idle/busy same-pane restart, verified locally on 2026-09-10; see [prime-agent.md](prime-agent.md) |

Linux is the automated baseline. Other operating systems and Electron packaging
are outside this matrix. Node's `>=22.19.0` engine declaration does not imply
that every intervening or future major has been tested. Native `node-pty`
installation requires a compiler and Python; terminal/lifecycle tests require
tmux and zsh. Install Bun on PATH before running the full backend suite.

CI sets `PI_DISH_PI_COMMAND` to the lockfile's Pi executable and runs it against
a local fake provider. Local runs instead resolve the host Pi and check its
version against the bundled SDK. Missing Pi can skip that canary; inspect the
test summary and report skips. Loopback alias tests also report a skip on
platforms without `127.0.0.2`. Real OMP/Prime canaries remain explicit commands
documented in [README](../README.md#development); neither uses paid providers.

## Commands

```sh
npm ci
npm run test:browser:install
npm run check
npm test
npm run test:browser
npm run test:ui:scenarios
npm run test:ui
```

On a fresh supported Linux image, `npx playwright install --with-deps chromium`
also installs browser OS dependencies. `CHROME_BIN` overrides the managed browser
for local debugging. The browser workflow retains focused-test traces and
screenshots from `test-results/` for seven days on failure; all suite output is
available in the job log. Failure excerpts are also published as check
annotations, so they can be inspected without downloading authenticated logs.

`npm run lint` applies correctness rules to repository JavaScript, including
undefined names, duplicate arguments/keys/cases, unreachable code, unsafe
finally blocks, and invalid `typeof` comparisons. Browser script globals are
derived from the actual helpers and app declarations. Generated/vendor assets,
historical docs, and agent working directories are excluded. This deliberately
does not introduce formatting rules or a repository-wide style rewrite.

`npm run typecheck` compiles the strict TypeScript foundation in `src/core/`
into a temporary directory and compares its JavaScript and declarations with
the checked-in `lib/` output. Stale or orphaned generated files fail the check;
check mode never repairs them. Tests and deployments execute those same checked-in
CommonJS files. Run `npm run build:core` to regenerate after source edits.

The same command checks compile-only consumers in `test/types/core.ts`, including
negative cases for mixed identity types and unvalidated response/store payloads.
It also checks every compiler-owned build/tool/test implementation and its
checked-in runtime output. `npm run build:tools -- --check` covers build and
development tools; `npm run build:tests -- --check` covers pure Node tests and
support, browser-capable VM/Playwright tests, and UI smoke/scenarios through
separate strict programs. Missing, stale, orphaned and wrong-mode outputs fail
without being repaired. Build mode removes obsolete test declarations after a
source moves to a no-declaration program.

`npm run typecheck` also runs `npm run build:vendor -- --check`. The vendor
builder recreates its 29 pinned outputs in a temporary directory and compares
bytes and modes without repairing the checkout; obsolete files in its owned
KaTeX font directory fail as orphans.

The Node-test program's actual compiler membership excludes `lib.dom.d.ts` and
all `src/browser/` producers. Node-run tests of the browser bundle live in the
browser-capable program with their exact source projections while retaining
their generated `.test.js` discovery paths. Six native fake-host, boundary and
recovery fixtures executed directly by Bun are strict no-emit members of
`tsconfig.extensions.json`. Subprocess drivers are checked fixture files rather
than hidden `-e` implementations. The source policy accounts for all 928
existing JS/JSX/MJS/CJS/TS/TSX/MTS/CTS paths and five shell paths, including
paths outside its historical authored roots and any executable path tracked
under `.amp`. Untracked `.amp` remains untouched. Declared shell paths are
unioned with discovered executable additions, then checked independently for
Git tracking and index mode `100755`. Non-following worktree metadata must show
a regular file at mode `0755`; a symlink, other object kind, missing body or
mode-only change is a gate failure. The policy rejects unclassified additions
and stale exceptions, validates all 469 generated mappings, and asks Git for
the effective `linguist-generated` value of every repository path, so
bare, unset, false and nested overrides cannot bypass the gate. Exact fixture,
vendor, historical-document and shell inventories live in
[`c2-source-coverage.json`](c2-source-coverage.json); actual membership for all
12 compiler programs lives in [`c2-compiler-coverage.json`](c2-compiler-coverage.json).

`tsconfig.configs.json` strictly checks the actual `eslint.config.js` body and
`playwright.config.ts`; the latter uses Playwright's existing host transform.
No TypeScript runtime loader or Node minimum change is required.

`npm test`, Playwright and the UI runners continue to execute generated `.js`
paths except for the intentionally Bun-executed native `.ts` fixtures.
Playwright's `testMatch` is generated-JS-only; source `.spec.ts` files are
compiler inputs, not a second discovery surface. Browser fixture contracts live
in a checked test-owned `.ts` module; production desktop/mobile scenarios
explicitly run without fixture instrumentation. Regenerate emitted test outputs
with `npm run build:tests`.
All browser implementation in `src/browser/` compiles strictly, including the
application entrypoint, static bindings, state, transport and feature controllers. See
[TypeScript migration guide](typescript.md) for the exact migrated scope.

Browser API and state unit tests execute the checked-in `public/browser.js`.
After editing `src/browser/`, run `npm run build:browser` before `npm test`;
`npm run check` catches stale output without regenerating it.

## Coverage map for refactoring

| Boundary / behavior | Regression entrypoint |
| --- | --- |
| Browser build drift/type failures, request routing and malformed responses | `test/browser-build.test.js`, `test/browser-api.test.js`, `test/browser/api-boundary.spec.js`, `test/types/browser-api.ts` |
| Session/model API projection, malformed rows and mutation contracts | `test/session-api.test.js`, `test/types/core.ts`, existing server model/list tests |
| Core compilation, stale output/declarations, failed builds, orphan detection | `test/core-build.test.js`, `npm run typecheck` |
| Identity types, request payload boundaries, harness and process shapes | `test/types/core.ts` (compile-only) |
| Core route canonicalization, byte framing, request correlation/cleanup, host stores and process proofs | `test/core-contracts.test.js` plus existing bridge/API/lifecycle suites |
| Wire envelope validation, malformed responses, unknown events and transport survival | `test/transport-frames.test.js` plus existing bridge/RPC protocol suites |
| Typed RPC startup validation, failed-child cleanup, delta snapshots and recovery ownership | `test/rpc-session.test.js`, `test/transport-frames.test.js`, `test/session-recovery.test.js` |
| Typed bridge registry validation, pre-hello claim protection and session-switch replay ordering | `test/bridge-session.test.js` |
| Lifecycle advice/report versus authority, observer/control separation and uncertain outcome types | `test/types/core.ts` through generated declarations |
| Canonical resume flights, close intent/rollback, restart exclusion, cleanup quarantine and real placement | `test/tmux.test.js`, `test/server.test.js`, `test/rpc-session.test.js`, `test/routines.test.js`, `test/routines-api.test.js` |
| Recovery bounded inspection, malformed evidence, handshake rechecks and no uncertain-delivery replay | `test/recovery-runner.test.js`, `test/session-recovery.test.js`, real Pi bridge integration |
| Production Bounce activity races, final guards, stopped replacement outcomes and proved reload completion | `test/session-bounces.test.js`, browser Bounce scenarios and desktop/mobile smoke |
| Sidebar query/scopes, list polling and unread ownership | `test/types/browser-sidebar-lists.ts`, `test/browser/sidebar-lists.spec.js` |
| Sidebar row controls, close endpoints, menus and drag lifetime | `test/types/browser-sidebar-controls.ts`, `test/browser/sidebar-controls.spec.js` |
| Sidebar metadata, host collapse and search authority | `test/browser-sidebar-render.test.js`, `test/types/browser-sidebar-render.ts`, family/search/multi-host UI smoke |
| Composer autocomplete query/menu ownership and session references | `test/browser-composer-autocomplete.test.js`, `test/types/browser-composer-autocomplete.ts`, `test/browser/composer-autocomplete.spec.js` |
| Composer drafts/history, spawn migration and image batch ownership | `test/browser-composer-drafts.test.js`, `test/types/browser-composer-drafts.ts`, `test/browser/composer-drafts.spec.js` |
| Dictation permission/take/transcription and persistent-note lifetimes | `test/types/browser-composer-speech.ts`, `test/browser/composer-speech.spec.js`, synthetic-microphone UI smoke |
| Header menu attempts, rename/mutation ordering, preference debounce and export lifetimes | `test/types/browser-session-controls.ts`, `test/browser/session-controls.spec.js`, existing selector/identity specs |
| Anchored comment decoding, refresh/editor races, selection and mark lifetimes | `test/browser-anchored-comments.test.js`, `test/types/browser-anchored-comments.ts`, `test/browser/anchored-comments.spec.js` |
| File/diff decoding, publication races and lazy patch ownership | `test/browser-file-views.test.js`, `test/types/browser-file-views.ts`, `test/browser/file-views.spec.js` |
| Extension request decoding, dialog stashing/response ownership and timed displays | `test/browser-extension-ui.test.js`, `test/types/browser-extension-ui.ts`, `test/browser/extension-ui.spec.js` |
| Markdown escaping, local assets, diagram races/retention and copy lifetimes | `test/browser/rich-text.spec.js`, `test/types/browser-rich-text.ts`, `test/ui-smoke.js` |
| Transcript tree filters/branches, retained controls and reopened views | `test/browser-transcript-tree.test.js`, `test/browser/transcript-tree.spec.js`, `test/types/browser-transcript-tree.ts`, `test/browser/menu-ownership.spec.js` |
| Session stats/share/process/artifact ownership and mutation errors | `test/browser-session-info.test.js`, `test/browser/session-info.spec.js`, `test/types/browser-session-info.ts` |
| Routine form/catalog/mutation/ledger ownership and draft retention | `test/browser-routines.test.js`, `test/browser/routines.spec.js`, `test/types/browser-routines.ts`, `test/ui-scenarios/routines.js` |
| Terminal wire contracts, pending opens, sockets/tickets and input disposal | `test/browser-terminal.test.js`, `test/browser/terminal-ownership.spec.js`, `test/types/browser-terminal.ts`, `test/ui-scenarios/mobile.js`, `test/ui-smoke.js` |
| Display settings races, theme startup and pointer disposal | `test/browser-display.test.js`, `test/browser/display.spec.js`, `test/types/browser-display.ts`, `test/browser-build.test.js`, `test/ui-smoke.js` |
| Usage decoding, late limits, partial fleet navigation and disposal | `test/browser-usage-view.test.js`, `test/browser/usage-view.spec.js`, `test/types/browser-usage-view.ts`, `test/ui-scenarios/usage.js` |
| Advanced-search decoding, query races and retained controls | `test/browser-search-view.test.js`, `test/browser/search-view.spec.js`, `test/types/browser-search-view.ts` |
| Skills payloads, detail/refine ownership and host-scoped activation | `test/browser-skills.test.js`, `test/browser/skills.spec.js`, `test/types/browser-skills.ts`, `test/ui-scenarios/skills.js` |
| Related-session controls and in-session query/paging ownership | `test/browser-session-navigation.test.js`, `test/browser/session-navigation.spec.js`, `test/browser/feature-ownership.spec.js`, `test/types/browser-session-navigation.ts` |
| Bounce wire data, queued snapshots, polling and retired controls | `test/browser-bounce.test.js`, `test/browser/bounce.spec.js`, `test/types/browser-bounce.ts`, `test/ui-scenarios/bounce.js` |
| Recovery wire data, settings/report owners and retired actions | `test/browser-recovery.test.js`, `test/browser/recovery.spec.js`, `test/types/browser-recovery.ts` |
| New-session form lifecycle, workspace action owners and disposal | `test/browser/new-session-shell.spec.js`, `test/types/browser-new-session.ts` |
| Shared helper CommonJS/browser delivery, generic row types and narrowed content | `test/helpers.test.js`, `test/browser-shared-helpers.test.js`, `test/types/browser-shared-helpers.ts`, `test/browser-build.test.js` |
| Spawn acceptance/status decoding, provisional keys and retained launch owners | `test/browser-session-spawns.test.js`, `test/browser/session-spawns.spec.js`, `test/types/browser-session-spawns.ts`, async-spawn UI smoke |
| Harness settings decoding, modal replacement and captured save endpoints | `test/browser-harness-settings.test.js`, `test/browser/harness-settings.spec.js`, `test/types/browser-harness-settings.ts`, models UI scenario |
| New-session model/thinking preferences, defaults owners and blur/pointer layout | `test/browser-new-session-options.test.js`, `test/browser/new-session-options.spec.js`, `test/types/browser-new-session-options.ts`, models UI scenario |
| Published-page comment decoding, cross-node anchors, mobile drafts and delayed refresh/delete ownership | `test/browser/artifact-comments.spec.js`, `test/types/browser-artifact-comments.ts`, `test/browser-build.test.js` |
| Model catalog request/view/cache ownership, enabled-row snapshots and select markup | `test/browser-model-catalog.test.js`, `test/browser/model-catalog.spec.js`, `test/types/browser-model-catalog.ts`, model UI scenario |
| Tmux target decoding, request/host ownership, saved resume routing and run-in keyboard/lifecycle | `test/browser-spawn-targets.test.js`, `test/browser/spawn-targets.spec.js`, `test/types/browser-targets.ts`, desktop/mobile smoke |
| Directory payloads, host-owned catalogs, debounce retirement and tree lifecycle | `test/browser-directory-catalog.test.js`, `test/browser/directories.spec.js`, existing new-session/routine smoke |
| Host-directory writers, exact/fallback lookup, source ownership and catalog persistence | `test/browser-host-directory.test.js`, `test/types/browser-directory.ts`, existing host discovery/browser and multi-host smoke |
| Host descriptor/fleet request ownership, source replacement and credential changes | `test/browser-host-discovery.test.js`, `test/types/browser-discovery.ts`, `test/browser/host-discovery.spec.js` |
| Host color state, preference failure, inherited keys and settings integration | `test/browser-host-presentation.test.js`, `test/helpers.test.js`, `test/types/browser-presentation.ts`, multi-host color smoke |
| Host settings add validation, supersession, edits and close/reopen ownership | `test/browser/host-settings.spec.js`, multi-host color smoke |
| Host URL normalization, persisted catalog projection and source precedence | `test/helpers.test.js`, `test/types/browser-hosts.ts`, existing multi-host smoke |
| Thinking dropdown literal levels, owned actions, keyboard input and disposal | `test/browser/thinking-selector.spec.js`, `test/types/browser-selectors.ts`, existing delayed menu and desktop/mobile smoke |
| Per-host shared requests, retired responses, endpoint capture, cached rows and live children | `test/browser-host-session-loader.test.js`, `test/types/browser-hosts.ts`, `test/browser/host-polls.spec.js`, existing browser API and multi-host scenarios |
| Host connection retry policy, fleet seeding, visible notifications and pruning | `test/helpers.test.js`, `test/browser-host-connections.test.js`, `test/types/browser-hosts.ts`, existing multi-host smoke |
| Browser state writers, detached metadata, host lookup and selection generation | `test/browser-session-state.test.js`, `test/types/browser-state.ts` |
| Captured transcript/stream ownership, delayed stream tickets and host-qualified related navigation | `test/browser/selection-ownership.spec.js` |
| Late tree/branch responses, draft routing and model/thinking menus across hosts | `test/browser/menu-ownership.spec.js` plus forced transcript-reload smoke |
| Retired terminal callbacks after reconnect or host switch | `test/browser/terminal-ownership.spec.js` plus desktop/mobile terminal smoke |
| Late resume, share creation, search, navigation and comment callbacks across hosts | `test/browser/feature-ownership.spec.js` plus stats/file/comment smoke |
| Same session id on two hosts; stale metadata completion | `test/browser/session-identity.spec.js` |
| Family pinning, expansion, ancestor lookup, drag ordering | `test/browser/session-families.spec.js` |
| Composer drafts, attachments, delayed preparation and send | `test/browser/composer-ownership.spec.js` |
| Queue edit/cancel/send and abort ownership | `test/browser/queue-ownership.spec.js` |
| Reused extension dialog ids, responses and replay | `test/browser/extension-dialogs.spec.js` |
| Harness discovery order, host ownership, background cache races and malformed rows | `test/browser-harness-discovery.test.js`, `test/types/browser-harnesses.ts`, `test/browser/harness-discovery.spec.js` |
| Prime owned-root close/restart, replacement-failure guards, legacy detach labels, unowned controls and host-bound requests | `test/browser/prime-close.spec.js`, `test/tmux.test.js`, `npm run test:lineage -- prime` |
| Listener startup, bind retry, delayed/failed aliases, advertised URLs, signal release | `test/listener-lifecycle.test.js` |
| Bridge, lifecycle, capabilities and API behavior | `npm test` (`test/*.test.js`) |
| Extracted selector DOM/actions/disposal and repeatable timing baseline | `test/browser/model-selector.spec.js` |
| Models, drafts, sidebar, usage, skills, routines, bounce, mobile | `test/ui-scenarios/` |
| Streaming, retained transcripts, terminal and desktop/mobile integration | `test/ui-smoke.js` |

`test/terminal.test.ts` intentionally passes a short `node -e` expression as
the command argv to `terminal.attachClient`. That expression is the input under
test: it proves command execution, environment overlay/removal and attach
metadata. It is not a subprocess bootstrap hidden from the compiler. Server,
tmux, skill-client and canary infrastructure children use checked fixture
entrypoints instead.

List extracted smoke features with `npm run test:ui -- --list`. Run one with
`npm run test:ui -- --scenario models`; the all-features runner launches each in
a separate process with a fresh HOME, server, browser, and fixture sessions.
The complete smoke invokes the same modules within its longer integration flow.
Mobile explicitly builds a routine fixture before checking its phone layout.
Remaining integration sections stay in the full smoke to preserve their shared
streaming and lifecycle sequence.

Focused Playwright tests use fresh browser contexts and isolated local hosts.
Delay routes or emit fixture bridge events to reproduce asynchronous ownership
bugs deterministically; never borrow a live agent session. Preserve sanitization
in `test/test-env.js`, temporary socket/tmux ownership, and cleanup on failure.

Before extracting state or transport, identify the relevant rows above and run
those checks while developing. Run `npm run check` and the full backend suite
before committing code changes, plus the focused browser and desktop/mobile
smoke for UI behavior. Avoid mixing formatting or framework adoption into the
boundary change. Passing this baseline establishes regression protection, not
complete application coverage.

`message-render.spec.js` covers message projection, retained telemetry identity, grouping and disposal.

`live-transcript.spec.js` covers coalesced frame ownership, cumulative tools, retained panels and disposal.

`transcript.spec.js` covers tail/older/catch-up races, retained cache bounds, endpoint identity and disposal.

`session-activity.spec.js` covers activity/abort gates, replacement questions and panel disposal.

`prompt-delivery.spec.js` covers queue row and submit ownership, including replacement and disposal.

`message-stream.spec.js` covers ticket/source ownership, reconnects, completion deduplication and switch ordering.

`session-view.spec.js` covers resume/selection ownership, header narrowing and cached tool adoption.

`app-shell.spec.js` covers delayed startup restoration, mobile panel lifetimes,
viewport/focus disposal and static binding ownership. The build regression checks
all five emitted scripts, private application bindings, bundled local runtime
imports and rejection of runtime imports outside `src/`. The static action inventory test rejects executable
HTML handlers and unregistered or unused action names.

`production-composition.spec.js` loads the unmodified production bundle on desktop
and mobile. It checks peer selection/restoration, static actions, local selection
and keyboard submission while a peer list is held, and the absence
of app globals or factory/helper script requests. Other browser and UI fixtures
use `test/fixtures/browser-app.js` to observe actual controller construction and
the supplied ports in a test-only bundle. Tests call those controllers, replace
specific ports, or delay routes; they never depend on global forwarding functions.
The fixture contains no private-binding evaluator or app-function export list.

## Interactivity performance audit

Measure production `public/app.js`, not only controller fixtures. Use sanitized
temporary homes and synthetic sessions; hold peer lists or model responses to
distinguish request latency from browser work. Do not benchmark alongside the
parallel test suites: CPU contention materially distorts these timings.

The search/readiness/selector audit measured these local before/after probes
(not CI timing thresholds or production latency guarantees):

| Probe | Before | After |
| --- | --- | --- |
| Warm index scan, 341 Pi/OMP sessions | 9.2 ms | 1.8 ms |
| Fully indexed warm catalog, existing 257-file / 14 MB baseline | 50.7 ms | 33.6 ms |
| Warm in-session search, 72 MB / 7,406 messages | 12.6 ms | 3.8 ms |
| Model filter, 250 rows, median narrowing render | 9.4 ms | 0.7 ms |
| Warm model/effort menu, injected 800 ms model response | ~815 ms each open | ~16 ms to next frame; no menu-triggered request |
| Retention-settings stats per 1,200-row catalog | 1,200 | 1 |
| Real OMP registration appearance to proved readiness, four launches | 114–511 ms | 53–77 ms |

The catalog row is reproducible with `node scripts/session-catalog-baseline.js`
on Node 22.22.1/Linux. Cold initial-list time stayed essentially unchanged
(130.4 → 131.3 ms); ordinary append inspection still read only the appended
130 bytes, not the full transcript.

API response comparisons retained search ranking, scope, snippets and match
counts. `session-files.test.js` covers memo invalidation and message/text snapshot
alignment; `session-index.test.js` preserves identity rejection despite memoization.
`session-controls.spec.js` and `menu-ownership.spec.js` cover warm reuse, cold-menu
cancellation and stale owners. `browser-model-catalog.test.js` checks scope,
retirement, seeded-cache and expiry boundaries. `session-spawns.spec.js` holds a
peer while the owning host becomes ready; `tmux.test.js` checks asynchronous
validation failure without a launch and uses a controlled clock for final-scan
deadline acceptance. `transcript.spec.js` checks that concurrent
older-page consumers join the same pending page instead of outrunning it.

### Follow-up: retained rows, direct search windows and cold readers

The follow-up used separate isolated before/after probes. The 257-file cold-index
fixture below contains 13.75 MB and forces the complete index build; it is not
the bounded initial-list fixture above. Timings are local observations, not CI
thresholds.

| Probe | Before | After |
| --- | --- | --- |
| One changed card in 1,200 ranked sidebar rows, median including layout | 388.1 ms | 19.45 ms |
| Markup parsed for that card update | 1,317,320 characters | 1,096 characters |
| Warm 1,200-row sidebar projection, median | 19.65 ms | 12.60 ms |
| Search hit at index 10 in 6,000 messages | 119 requests / 15.59 s | 1 request / 50.9 ms |
| Mounted messages after that search | 6,000 | 100 |
| Full cold 257-file / 13.75 MB index | 290.5 ms | 198.3 ms |
| Cold 72.6 MB / 19,000-message search projection | 1,242.4 ms | 465.7 ms |
| Pricing/config stats during that projection | 19,004 | 5 |
| Stats immediately after that message read | 811.4 ms | 15.6 ms |
| Index metadata immediately after that message read | 834.9 ms | 115.3 ms |
| Redundant OMP thinking-ladder discovery | ~1.5–1.65 s CLI | ~0.6–1.1 ms native normalization; no CLI |
| Two concurrent SDK command-discovery calls, after import | 105.0 ms / 2 model runtimes | 34.6 ms / no model runtime |

The sidebar retains host-qualified card nodes, reconciles ranked membership and
order, and parses only changed cards when the structure is stable. Composition
coalesces paints once per animation frame; session-state publications and unread
title updates remain immediate. All matching rows remain in the DOM: there is
no virtualization, row cap or CSS containment. Keyboard focus, family expansion,
pinning, drag order and same-ID cross-host ownership remain intact.

An integrated production-asset probe with 1,200 historical sessions measured
warm broad-query input dispatch at 28.7 → 0.5 ms and completion at
565.6 → 508.9 ms, including debounce. First broad-query completion was
1,009.5 → 699.2 ms, but the new first layout still produced a 453 ms long task:
moving projection out of the input handler is not proof of a good INP score.

Search loads one bounded hit window through the existing messages endpoint,
without paging through intervening history or imposing the old 200-page limit.
Explicit gap controls load omitted history in either direction. Retained tail
nodes and the live cursor remain independent of the search window; stale query,
selection and endpoint owners cannot commit a late window.
Final deep-search samples were 33.7/35.6/46.8 ms, with one 975.9 ms outlier;
all retained the one-window work bound. This is not a fixed latency guarantee.

The integrated 12,000-message JSONL fixture reached index 10 in 71 ms with one
window request and 100 mounted messages. The previous build was still searching
after two minutes with 9,300 messages mounted; that run was stopped, not reported
as a completed latency. Actual gap-button paging, session switch/return and a
JSONL append preserved the original hit/tail nodes and caught up with
`after=11999`, leaving the historical gap intact.

Pricing captures one rate-card snapshot per synchronous operation, rather than
statting configuration and scanning the model catalog per message. Metadata,
messages, stats and indexing opportunistically share the last raw parse through
a weak reference; garbage collection can discard it without changing results.
File freshness includes mtime, size, ctime, device and inode. Profile, pricing and
settings projections remain separate. Stamp-less persisted index entries take
the normal bounded rebuild once.

Queued indexing now restats before reading, avoiding both duplicate demand work
and double-counting an append that arrived after enqueueing. Index logs serialize
each payload once. Discovery shares parent-header observations within one scan,
not across scans. `session-catalog-baseline.js` reports actual corpus IO; its old
exported-parser hook was removed because it cannot observe the shared internal
parse path reliably.

The unchanged 257-file / 14 MB production baseline command measured initial
bounded lists at 137.7 → 114.8 ms and fully indexed warm lists at
35.3 → 29.0 ms. Cold route+transcript IO fell from two full reads to one;
ordinary append inspection still read exactly the appended 130 bytes.

OMP live catalogs now preserve native `thinking.efforts`; all 83 OpenAI/Anthropic
fixture rows matched the official CLI ladders. Interactive discovery and pricing
share one genuine on-demand CLI for the same cwd/config/environment scope.
The final shared native run took 1,423 ms; unchanged subsequent calls took
12.1 ms and 2.0 ms without another subprocess. Input fingerprints are captured
before the run; changed configuration cannot relabel an older flight as fresh.
Native DB fingerprints ignore only SQLite checkpoint counters, not credential
or model payloads. Explicit force bypasses settled reuse but joins an in-flight
discovery. Arbitrary extension-owned inputs and remote provider state retain the
existing 60-second freshness bound. A real native DB payload refresh can cause a
conservative subsequent cache miss.
Legacy live registries that omit both reasoning and ladder metadata still use
catalog enrichment in the session's cwd. Unknown reasoning metadata remains
absent instead of becoming `false`; explicit non-reasoning rows need no ladder.

SDK command discovery now loads extension/skill/prompt resources directly,
joining concurrent loads without creating undisposed AgentSessions/model
runtimes. Later requests observe resource edits rather than retaining a permanent
server-side list. Cold SDK import still measured 1.4–1.8 seconds. Pi's eager model
warm remains because it supplies context-window data before a picker is opened.

Remaining costs are explicit. Initial creation and large structural transitions
of a 1,200-row sidebar still incur substantial native parsing/layout work; the
isolated controller probe did not improve first-broad-query completion. The
300 ms search debounce remains. The first 72.6 MB parse is still synchronous:
the follow-up attributed about 220 ms to read/UTF-8 decoding and 132 ms to native
JSON parsing. Weak sharing removes subsequent duplicate work, not this first
read or a hard event-loop stall bound. Native cold OMP startup/catalog work and
mandatory process/socket ownership proofs remain. Whole-transcript rich-text
finalization previously measured 2/7/16 ms at 200/1,000/2,000 nodes and is not
invoked for every streaming delta, so it was left unchanged.

### Slow-host startup and sidebar isolation

Startup no longer awaits every peer descriptor or the entire session-list batch.
Self identity still precedes client-key migration and publication; remote discovery
continues independently. Saved-session restoration fetches only the owning host,
including history when necessary, without overriding a newer user selection.
Explicit fleet refreshes retain their descriptor-completion contract for
capability-sensitive settings and recovery views; startup does not await them.
Hosts without an identity cannot publish rows under the local host.

Sidebar searches name each pending host instead of keeping the global filter
spinner active until the slowest response. Healthy-host results remain usable,
late responses still publish, and retired query completions cannot clear current
progress. Existing request deadlines and cached-row fallback remain unchanged.

`test/browser/host-polls.spec.js` covers local restoration with peer identity and
lists held, peer restoration with local lists held, and progressive search while
a peer remains pending. A production-asset browser smoke also displayed and
searched the local transcript with peer requests deliberately unresolved, no
global busy indicator and no page errors.
