# Browser composition cleanup

This stage replaces the classic-script application facade after the session
catalog migration. It preserves the existing feature controllers, session
writers, host ownership guards, lazy vendor assets and startup ordering.

## Boundary

- Bundle `src/browser/app.ts` with ordinary imports from its feature modules and
  shared helpers. The production page loads one application bundle, with no
  application namespace or mutable forwarding functions on the global scope.
- Wire features directly to their owning controllers. Keep lazy callbacks where
  initialization order or current state requires them; retain actual composition
  logic instead of moving it into a second forwarding layer.
- Move browser tests from classic-script bindings to their actual feature
  controllers and injected ports. Instrumentation belongs exclusively to the
  test fixture build, never the production bundle or an application debug API.
  Preserve delayed-response, same-id peer, selection, disposal and endpoint races.
- Keep the helper CommonJS exports and isolated factory test bundle compatible.
  They are independent build entrypoints, not production app dependencies.

This does not restructure feature controllers, migrate backend lifecycle code,
adopt a framework, or change deployment.

## Verification and review

Run type/drift checks, the full backend suite, browser scenarios, independent UI
scenarios and desktop/mobile smoke. Check the uninstrumented app's startup and
absence of application globals. Review the committed implementation externally,
resolve findings, then push and check CI for the exact commit.

## Implementation record

`app.ts` imports factories and helpers from their owning modules and calls
controller methods directly. It no longer declares `PiDishBrowser`, ambient
helper bindings, or the 365 forwarding functions removed in this stage. Unused
private aliases are also gone. Lazy callbacks preserve the existing startup
ordering and resolve the current controller method when invoked. The small
`app-models.ts` coordinator carries the existing session/takeover catalog
ownership rules with explicit inputs; it introduces no new catalog state.

The page loads the bundled app after the local marked vendor. The independent
factory and CommonJS helper entrypoints remain generated and compatible, but
are no longer fetched by the app. Vendor assets still load locally on demand.
The changed application payload totals 862,873 source bytes, versus 975,002 for
the former app/factory/helper scripts together (gzip estimates: 191,203 versus
220,974 bytes). These are artifact sizes, not a browser timing benchmark.

The fixture builder under `test/fixtures/` observes top-level feature construction
in an in-memory test bundle. It records the real instances and their supplied
options; it does not export private functions, evaluate expressions inside the
app, or add an instrumentation switch to production. Tests now call feature
methods, delay HTTP routes, or replace the applicable feature/browser I/O port.
Clipboard tests stub the browser API so even controllers that capture their
copy callback at construction observe the intended delay. The sidebar create
stub is scoped to its create-port assertion and restored afterwards.

`production-composition.spec.js` runs the unmodified app at desktop and mobile
widths. It verifies peer selection and restoration, static new-session actions,
no application/probe globals, and no requests for `browser.js` or `helpers.js`.
The build regression verifies local runtime imports, private bindings and the
existing all-output validation/drift rules.

## Local verification

- `npm run check` passed, including strict types and generated-output checks.
- The full backend/module suite passed: 974 tests, no skips.
- The full browser run passed 280 of 282 scenarios. Its two failures identified
  fixture migrations: readiness was read from the wrong feature port, and the
  stats-copy stub targeted an options property captured before replacement.
  After correcting those probes, all four host-discovery scenarios and all 19
  clipboard/file/rich-text/session-info scenarios passed. Both uninstrumented
  production scenarios passed in the full run.
- All eight independent UI scenarios passed across the full run and corrected
  sidebar rerun. The final full desktop/mobile smoke suite passed.
- Real harness canaries were not run: this stage changes browser composition
  and test instrumentation, not harness protocol or lifecycle operations.

External review and exact-commit CI results are recorded after completion.
