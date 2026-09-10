# Working on pi-dish

pi-dish is a personal web/phone controller for Pi-lineage agents. The backend
uses Express and CommonJS (`server.js`, `lib/`); the browser uses plain scripts
(`public/`); harness extensions live in `extensions/`.

The typed foundation lives in `src/core/`. Its generated CommonJS and `.d.ts`
files are checked in at the existing `lib/` paths. Edit the TypeScript source,
run `npm run build:core`, and include both source and generated output in the
commit. `npm run check` rejects stale output. See [docs/typescript.md](docs/typescript.md)
for the exact boundary; the application and feature modules remain JavaScript.

## Start here

- [README.md](README.md): setup, supported behavior, development commands.
- [BACKLOG.md](BACKLOG.md): current priorities and the staged maintenance plan.
- [CLAUDE.md](CLAUDE.md): detailed architecture and implementation invariants;
  read the sections relevant to the code you change.
- `TASKS/` and `docs/history/` contain design and implementation history.
  Check current code and tests before treating a historical gap as open work.

## Scope and changes

- Keep maintenance changes small and independently reviewable. Major module
  extraction, test-suite restructuring, and framework adoption are separate
  stages in the backlog; do not bundle them into a bug fix.
- Preserve unrelated local files. Stage only the files belonging to the change.
- After verification, commit and push completed work unless the user asks
  otherwise. Follow the user's branch choice.

## Verification

```sh
npm run check                         # correctness lint + incremental types
npm run build:core                    # regenerate lib/ after changing src/core/
npm test                              # unit, API, bridge and lifecycle suites
npm test -- test/remote-hosts.test.js   # example focused suite
npm run test:browser                   # isolated browser scenarios
npm run test:ui:scenarios              # each extracted feature with fresh fixtures
npm run test:ui                        # desktop/mobile browser smoke
npm run build:vendor                   # only after changing vendor inputs
```

Run the relevant checks while developing and the full backend suite before
committing behavior changes. UI behavior changes also need the browser smoke
suite. Add focused regressions for defects; defer broad coverage work to its
own change. Run `npm run check` before committing code changes.
Documentation-only edits need link/content checks. The supported matrix and
coverage map live in [docs/testing.md](docs/testing.md).

Install the pinned browser tooling with `npm ci` and
`npm run test:browser:install`. `CHROME_BIN` optionally overrides the managed
Chromium binary. Run one focused scenario with
`npm run test:browser -- session-identity.spec.js --grep "delayed rename"`.
`npm run test:lineage -- omp` (or `prime`) is an opt-in real harness canary
with explicit executable paths; omit the selector to run both; see README. Report skips or unavailable checks.

## Invariants

- Use the existing test environment sanitization and temporary homes, sockets,
  and tmux servers. Tests must not use live agent sessions or provider credentials.
- A browser session identity includes its owning host. Capture identity before
  an asynchronous operation; a response must not retarget whichever session is
  selected when it finishes. Use the existing state writers and selection guards.
- Session JSONL belongs to the harness. Read through `lib/session-files.js`
  and `lib/session-index.js`; preserve capability gates and process/launch-token
  ownership checks before lifecycle operations.
- Keep browser assets local, with no CDN dependencies. Preserve streaming
  coalescing, pagination, and retained transcript behavior when touching rendering.
- Keep credentials and machine configuration out of Git. Follow the fleet's
  access and configuration ownership rules for any host administration.
