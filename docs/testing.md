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
It also retains strict `checkJs` without emission for `lib/cron.js`; JSDoc covers
parser inputs, parsed fields, matching, and next-run results. Most application
and remaining JavaScript modules are not yet type checked.
The browser modules in `src/browser/` compile strictly, including session state,
the API adapter and the model selector. See
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
