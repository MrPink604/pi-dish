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

`npm run typecheck` uses strict `checkJs` without emission for `lib/cron.js`.
JSDoc covers parser inputs, parsed fields, matching, and next-run results.
Add files to `tsconfig.check.json` as subsequent refactors establish contracts;
the rest of the application is not yet type checked.

## Coverage map for refactoring

| Boundary / behavior | Regression entrypoint |
| --- | --- |
| Same session id on two hosts; stale metadata completion | `test/browser/session-identity.spec.js` |
| Family pinning, expansion, ancestor lookup, drag ordering | `test/browser/session-families.spec.js` |
| Composer drafts, attachments, delayed preparation and send | `test/browser/composer-ownership.spec.js` |
| Queue edit/cancel/send and abort ownership | `test/browser/queue-ownership.spec.js` |
| Reused extension dialog ids, responses and replay | `test/browser/extension-dialogs.spec.js` |
| New-session harness discovery order and host ownership | `test/browser/harness-discovery.spec.js` |
| Prime owned-root close/restart, replacement-failure guards, legacy detach labels, unowned controls and host-bound requests | `test/browser/prime-close.spec.js`, `test/tmux.test.js`, `npm run test:lineage -- prime` |
| Listener startup, bind retry, delayed/failed aliases, advertised URLs, signal release | `test/listener-lifecycle.test.js` |
| Bridge, lifecycle, capabilities and API behavior | `npm test` (`test/*.test.js`) |
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
