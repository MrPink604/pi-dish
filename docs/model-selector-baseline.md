# Model-selector evaluation baseline

The framework preparation stages are implemented. This is the ordinary DOM
baseline for a future component-framework comparison; no framework is adopted.

## Implemented boundary

`src/browser/model-selector.ts` exports `mountModelSelector(root, actions,
formatTokens)`. The returned instance supports `update(view)`, `focusSearch()`
and `dispose()`. It owns the root's children and its input, keyboard and click
listeners. Disposal clears those children and removes all three listeners.

`ModelSelectorView` contains a captured selection owner, catalog rows, current
model, harness id, query and edit mode. `ModelSelectorActions` carries owner-bound
selection, query/edit, model/provider toggle, All/None and close requests.
The component copies catalog rows on update and does not read application state
or perform network requests. Text and action values use DOM properties rather
than interpolated inline JavaScript.

The adapter in `public/app.js` owns query/edit state, catalog changes, visibility,
placement and outside-click dismissal. `renderModelDropdown` publishes a view;
actions pass `ownsSelection` before invoking the existing catalog/request
writers. Selection change closes and disposes the instance. Model mutations
still use the typed API adapter and can update their originating host after
navigation; enabled-model preferences remain server-local with edit-time
snapshots. The rest of the app continues to share its existing model catalog.

## Behavior and repeatable measurement

`test/browser/model-selector.spec.js` covers exclusive DOM ownership, owner
propagation, inert disposed instances/remount without duplicate callbacks, unusual provider
names, filtering, request payloads and Escape. Existing model UI scenarios
cover scoped visibility, provider toggles, All, persistence and reopening;
existing delayed-response cases retain their host/selection assertions.

Run the measurement case with:

```sh
npm run test:browser -- model-selector.spec.js --grep "baseline measurements"
```

It serves a fixed 250-model catalog across five providers through an intercepted
local fixture request. It measures 21 opens and filters, reporting the first
open separately and median/p95 of the remaining 20. Open timing includes catalog
fetch/decode, catalog cache writes, pricing refresh, DOM update and focus; filter timing measures synchronous DOM
update. These are not frame-presentation times. There are no timing assertions.
Each iteration asserts that the dropdown opens with the expected 187 visible
rows and closes with zero children. Separate lifecycle
assertions check callback cleanup; this is not a heap-leak measurement.

Three development runs at commit `7785282` (2026-09-10), Chromium 153.0.8010.12, 1280×900,
Linux x64 on AMD Ryzen AI Max+ 395 (full-suite, focused-selector and standalone
measurement runs, all with the open/row-count assertions):

| Measurement | Result |
| --- | ---: |
| First open | 9.5–14.8 ms |
| Repeated open median / p95 | 5.6–6.1 / 7.9–9.2 ms |
| Filter update median / p95 | 1.5–1.6 / 2.1–2.2 ms |
| Root children after close | 0 |
| Complete `public/browser.js` raw / gzip | 16,213 / 4,622 bytes |

These local headless results are a starting observation, not an adoption budget
or evidence of phone performance. Repeat both implementations on the same
machine/browser and use multiple runs to establish variability. The full
browser bundle at that commit also contains the API adapter. Later TypeScript
extractions can move additional code into it, so use the same base commit when
comparing asset bytes for a future framework experiment.

## Evaluation checkpoint

Vanilla TypeScript migration is the current work; the framework experiment is
deferred. A later Preact pilot can implement this one boundary against the same
view/actions, keeping the current implementation as the comparator.
Before accepting it, run the behavior/ownership suites for both versions and
compare component plus adapter complexity, asset bytes, repeated measurements,
cleanup, desktop/mobile behavior and packaged local-asset delivery. Revisit
build input allowlisting explicitly if the pilot bundles a framework dependency.

Retain the ordinary DOM implementation if the experiment does not demonstrate
a concrete simplification at acceptable measured cost. Transcript rendering,
streaming coalescing, retention, pagination and terminal integration remain
outside this comparison. See the [framework assessment](browser-framework-assessment.md).
