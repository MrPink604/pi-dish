# Browser component framework assessment

Assessed 2026-09-10 after the typed capability/transport work and browser
selection-ownership migration. The [ordinary DOM selector baseline](model-selector-baseline.md)
now implements the preparation boundary and records repeatable measurements.

## Decision

Continue with vanilla TypeScript as the implementation base and migrate the
remaining browser modules into `src/browser/`. Keep ordinary DOM rendering and
explicit ownership boundaries. No framework has demonstrated a maintenance or
runtime benefit in this repository, and a framework pilot is not the next stage.

Preact remains a possible later experiment for leaf UI if extraction exposes a
specific maintenance problem. Svelte is not an intended destination either.
The pilot criteria below are retained for that future decision; they do not
schedule or authorize framework adoption. The model-selector baseline is
already implemented in ordinary TypeScript.

The state extraction addressed a concrete source of defects: asynchronous
callbacks carrying the wrong host/session or applying after navigation.
Framework lifecycle hooks would still need the same captured owners. Production
adoption should depend on simpler feature code and acceptable runtime costs.

## What the code now supports

- `src/browser/session-state.ts` owns lists, detached selection, the four writers,
  and immutable `SelectionOwner` tokens. Its strict TypeScript interface and unit/type
  tests provide a usable integration boundary. Metadata remains `unknown`;
  feature adapters must narrow fields they consume.
- `public/app.js` still owns requests, rendering and feature interaction state.
  The store has initialization callbacks, not a general subscription API.
  A component therefore needs an explicit update adapter; it cannot assume a
  reactive store or mutate snapshots directly.
- `src/browser/model-selector.ts` now owns selector DOM; `toggleModelDropdown`,
  `renderModelDropdown`, `toggleModelEnabled` and `selectModel` in the app form
  its adapter for catalog, query/edit state, selection and API actions. This is enough interaction to evaluate
  component value without touching transcript ownership.
- `stashCurrentTranscript`/`restoreCachedTranscript` and the streaming renderer
  preserve DOM nodes, open details, pagination and scroll state. They should
  retain sole ownership of transcript DOM during any pilot.
- `public/index.html` uses local plain scripts; `scripts/build-vendor.js` emits
  local vendor assets. Direct server startup and Electron package `public/`.
  A pilot must account for these delivery paths explicitly.

These are architectural observations, not performance measurements.

## Options

| Option | Fit for this code | Cost to evaluate |
| --- | --- | --- |
| Extracted vanilla TypeScript model-selector module | Preserves current script delivery, DOM and CSS conventions; establishes the comparison baseline | Requires explicit render/update/dispose and action interfaces, with manual DOM interaction code |
| Preact in one dedicated DOM root | Its renderer accepts a container node, so the selector can own one subtree using the existing light-DOM styles | Requires local dependency delivery, lifecycle cleanup and a choice of template syntax; existing imperative writes inside that subtree must be removed |
| Lit custom element | Provides a component render root and template/lifecycle model | Shadow DOM defaults would change existing selector CSS and document queries; light DOM is possible but gives up that scoping, and module delivery still needs handling |

Preact's [render API](https://preactjs.com/guide/v10/api-reference/#render)
supports rendering into a container. Its [getting-started guide](https://preactjs.com/guide/v10/getting-started/)
describes browser-native usage and explains that JSX requires compilation,
while `h` calls or HTM offer alternatives. The guide's CDN examples are not a
pi-dish deployment option: dependencies must be pinned and served locally.

Lit documents its default shadow root and optional light-DOM override in
[Working with Shadow DOM](https://lit.dev/docs/components/shadow-dom/), and
module resolution/build considerations in [Building for production](https://lit.dev/docs/tools/production/).
The preference for Preact here is an inference from this repository's existing
CSS/query conventions, not a claim of measured speed or general superiority.

## Contained pilot contract

The ordinary DOM implementation now follows this boundary; use it as the
comparison baseline. Use only the model dropdown. Keep its header trigger and the thinking menu in
the existing shell. The current implementation exposes an interface
that a future component version can implement unchanged:

- `mount(root, actions)`, `update(viewModel)` and `dispose()` give one module
  exclusive ownership of the root's children. The shell owns visibility,
  anchoring, outside-click/Escape policy and selection-change dismissal. The
  module invokes `actions.requestClose()` on Escape from its inputs; the shell
  performs dismissal. Both implementations replace the current inline global
  handlers with module-owned listeners.
- A copied, narrowed view model carries the owner, model rows, current model,
  query, edit mode and pending/error state. The experiment must state which
  layer owns each field; neither implementation may duplicate session selection.
- Actions receive the captured owner and model selector. Existing adapters own
  API routing, catalog persistence and the store writers. They retain ownership
  checks before subsequent requests and current-view updates. A successful
  metadata mutation may still update its originating host after navigation.
  Enabled-model preferences retain their current server-local scope and
  edit-time snapshots; changing selection must not discard an already queued
  preference write or redirect it to a peer host.
- The shell explicitly publishes updates after catalog/metadata changes and
  invalidates the feature on selection change. Component cleanup releases its
  listeners and effects; cleanup does not replace asynchronous owner checks.

Use local assets, without a whole-app router, global reactive-store replacement,
CDN, or production JSX transform. Choose and document the pilot's local module
or bundle delivery before implementation. Preserve the current server startup
and packaged Electron asset paths. There must be one rendering implementation
per root, with a simple revert removing the pilot and its dependency assets.

## Evidence needed before adoption

Run the same behavior scenarios against both implementations: search and current
model display, enabled-model editing (including provider groups and All/None),
keyboard/focus behavior, desktop/mobile
placement, errors, delayed catalog loads, and delayed mutation responses across
same-id hosts. Retain the existing browser ownership regressions and full UI
smoke; add feature assertions only where the experiment changes behavior.

Record the production asset byte delta, cold and warm dropdown-open timings,
filter input responsiveness with the same catalog, and cleanup after repeated
open/close and session switches. Compare repeated runs on the same browser and
hardware, reporting the baseline and variability before choosing tolerances.
Check startup and Electron asset delivery and verify all requests stay local.

Review source and adapter complexity together: count removed manual DOM/event
handling, new state/effect code, duplicated state, and tooling changes. A shorter
component alone is insufficient if its adapter absorbs the complexity. Keep the
pilot only if reviewers can identify a concrete simplification, required
behaviors pass, and measured costs fit the agreed baseline tolerances. Otherwise
retain the extracted vanilla TypeScript module and remove the experiment.

Transcript rendering, streaming coalescing, retained DOM, pagination, file/diff
views and terminal integration remain separate work. Passing a model-selector
pilot would not authorize migrating those surfaces.
