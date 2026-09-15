# Shared runtime helper cutover

Status: **Implemented, locally verified and approved by Fable**
(2026-09-15). Stage 2 follows [browser contract cleanup](browser-contract-cleanup.md)
and precedes [session lifecycle migration](session-lifecycle-migration.md). Current delivery
rules and completed boundaries remain in the [roadmap](../BACKLOG.md) and
[TypeScript guide](typescript.md).

Plan review: **APPROVED** by Anthropic Fable 5.1 at high effort for the clarified
plan at `9dee6d3`; [signoff and observation resolutions](../BACKLOG.md#next-stage-plan-review).
Implementation uses the readonly browser contracts reviewed at `811d473`.

## Frozen implementation boundary

- Move `helper-values`, `helper-content`, `helper-models`, `helper-query` and
  `helper-refs` intact from `src/browser/` to identically named `src/core/` owners.
- Split only `escapeHtml`/`truncate` into core `helper-format`, `sessionMetaText`
  into core `helper-identity`, and the math tokenizer/renderer factory into core
  `helper-markdown`. Other formatting, host presentation, markdown/path/diff,
  session grouping and usage helpers remain browser-owned.
- Core `createMathExtensions` requires an explicit renderer provider. The existing
  browser factory adapts its optional renderer with lazy global lookup; the Node
  file-page consumer supplies its imported KaTeX through the provider.
- Core `helper-types` owns `Timestamp`, `HelperSession`, `HelperHost`, `ModelRef`,
  `ImageBlock`, `SessionQueryTerm`, `SessionQuery`, `RefContextEntry`,
  `KatexRenderer`, `MathToken` and `MathExtension`. `HelperSession` retains its
  readonly derivation from existing `SessionFields`; browser-only types stay put.
  No old internal module or type re-export aliases remain.
- The Node consumer table below is exhaustive at freeze. Its JS implementations
  remain unchecked; `session-metadata.ts` gains actual typed source imports.
  The helper compatibility entrypoint, ESLint global derivation and standalone
  skill reference parity remain intentional consumers.
- Baseline at `811d473`: the Node and browser-global bundles expose the same
  **121 exports**. `public/app.js` is **875,260 bytes** and `public/helpers.js` is
  **84,023 bytes**. Text, escaping, truncation, model, query and math-fallback
  samples agree across Node and a browser-global VM; these are not timing claims.
- Verify the portable closure in core NodeNext, browser Bundler/DOM with
  `types: []`, and a narrow Node-only `lib: ["ES2022"]` compile. Keep the current
  Buffer/atob behavior and exclude browser/public/vendor/Node-only runtime imports
  from that closure.

## Delivered cutover and evidence

The frozen source move and split are implemented. Browser controllers import the
actual core owners; the five vacated browser modules and moved type declarations
are gone. All eight Node consumers below import narrow generated core modules.
`session-metadata.ts` imports actual source exports and no longer declares helper
returns `unknown` or rechecks their already-established string/object results.
Unused `truncate`/`splitSessionRefContext` imports in `session-files.js` were deleted.
Node consumer implementations other than metadata remain JavaScript and unchecked.

Core `createMathExtensions` takes a required renderer provider. Its browser adapter
preserves the optional explicit renderer and render-time global lookup; it contains
no tokenizer/fallback copy. `file-page.js` supplies imported KaTeX explicitly and
retains its different HTML escaping and markdown policy.
The 121 compatibility exports are unchanged, in both CommonJS and browser globals.
The standalone skill CLI remains independent; `test/skills-core.test.js` keeps
parity for its duplicated portable reference grammar, key decoding and alias rules.

The core/browser builds and `npm run check` passed. Portability is established
jointly by core NodeNext, browser Bundler/DOM with `types: []`, and the Node-only
`tsconfig.helpers.json` compile without DOM libraries—not by that last probe alone.
Browser build metadata rejects runtime edges out of the portable core-helper closure
before replacing any output.
The existing isolated build regression verifies rejection preserves all prior
outputs. Existing helper type/behavior/compatibility fixtures now use the real owners.
Full backend suite: **984 passed, zero skipped**. Browser suite: **286 passed**.
All eight independent UI scenarios and the complete desktop/mobile smoke passed.

Actual uninstrumented app smoke at 1280px and 390px rendered text/tool output,
two math expressions and a highlighted code block without horizontal overflow.
Query and exact-reference HTTP routes returned the expected session. The app
requested KaTeX and highlighting locally, one transcript page, and no helper
compatibility bundle. Publishing a real markdown file through the isolated API
rendered math through the Node consumer and displayed on mobile.
An independent browser document loaded the standalone helper output: a retained
math factory first emitted fallback, then rendered successfully after the real
local KaTeX bundle arrived. Text/tool/ref/query values and the complete export
inventory matched the pre-cutover Node/browser baseline.

`public/app.js` is **875,407 bytes** and `public/helpers.js` is **84,170 bytes**:
each is 147 bytes larger than baseline. The smoke observed no additional vendor
payload or runtime request. These are size/request observations, not a timing
claim. Temporary server/home/browser
smoke scaffolds were removed after verification.

## Implementation review

Fable 5.1 at high effort **APPROVED `1cbd826`**, with no blocking findings.
The [complete report](shared-runtime-review-2026-09-15.json) records scope and limits:
Read/Grep/Glob inspection only, no execution or baseline git diff; local verification
above remains the execution evidence. Concurrent lifecycle work was excluded.

Nonblocking observations were addressed by correcting architecture and historical
source references, making the joint portability checks explicit, adding a retained
math-factory late-renderer regression, and exercising readonly query/reference
inputs and returned row fields in the compile fixture.
The export-manifest suggestion is intentionally not a count-only assertion:
the complete pre/post manifest comparison above establishes cutover compatibility,
while existing consumer behavior tests and Node/browser parity remain the durable
checks. No runtime implementation changed in response to this review.

The inventory and task definitions below retain the pre-cutover evidence and
approved acceptance criteria; current ownership is the frozen/delivered graph above.

## Mission and simplification outcome

Make genuinely shared logic a checked source dependency of the browser and the
backend, not a browser-generated artifact the backend treats as untyped input.
A change to text extraction, model vocabulary or reference grammar should have
one implementation and compiler-visible consumers in both runtimes.

This is a dependency cutover, not another helper framework. The immediate gain is
removing handwritten interfaces and redundant checks around already-typed local
functions. The later gain is that lifecycle, transcript, search and SDK migrations
can import real contracts without rebuilding the same compatibility boundary.

Stage 1 establishes readonly browser views and decoded message ports. This stage
must carry those contracts through relocated helper inputs; do not widen them
back to mutable records or `unknown` just to finish a move.

## Current evidence and bounded scope

The helper implementations already live in [src/browser](../src/browser/).
[shared-helpers.ts](../src/browser/shared-helpers.ts) exports a compatibility
surface, and [build-browser.js](../scripts/build-browser.js) emits it as both
CommonJS exports and browser globals in `public/helpers.js`.

The remaining dependency direction is backwards:

```text
src/core/session-metadata.ts -> handwritten require -> public/helpers.js
server.js / authored lib/*.js -----------------------> public/helpers.js
public/helpers.js <- generated from src/browser/helper-*.ts
```

The following inventory is the starting map, not permission to omit a new caller
found during implementation. Generated `lib/session-metadata.js` is an output,
not another source to edit.

| Current Node consumer | Shared behavior consumed |
| --- | --- |
| `src/core/session-metadata.ts` | Text extraction, reference-context splitting, truncation; return values are declared `unknown` and checked again. |
| `server.js` | Model selection/vocabulary, text extraction, session query/filter/scoring/snippets, automation filtering and session reference resolution. |
| `lib/session-files.js` | Text extraction, truncation and reference-context splitting for transcript/search projections. |
| `lib/pi-sdk.js` | Text extraction and tool summaries. |
| `lib/file-search.js` | Fuzzy matching and scoring. |
| `lib/session-refs.js` | Reference grammar, alias resolution and prompt context construction. |
| `lib/skill-mining.js` | Text extraction. |
| `lib/file-page.js` | Markdown math extensions with an explicitly supplied KaTeX renderer. |

### Non-goals

- No full migration of the JavaScript consumers, general JSONL parser, pricing,
  skill mining, lifecycle, SDK adapters or CLI implementation.
- No new `src/shared/` output tree, workspace package, loader, ESM transition or
  change to deployed startup. Use the existing flat `src/core/` -> `lib/` build.
- No wholesale relocation of every helper because it is pure. Browser-only
  formatting, usage presentation, workspace/family views and timing stay browser
  owned unless the audited shared dependency closure actually requires them.
- No new universal session/message/model interface. Preserve existing structural
  inputs, generics and the distinction between display identity and authority.
- No deletion of supported `public/helpers.js` exports or the isolated browser
  factory bundle. These remain deliberate consumer entrypoints, not internal
  migration shims.
- No eager vendor loading, CDN dependency, duplicated KaTeX runtime or persistence
  format changes. Do not combine different escaping functions merely by name.

## Contract and destination decisions

### Source ownership and build direction

Use flat `src/core/helper-*.ts` modules for the audited shared implementation
closure, generating matching `lib/helper-*.js` and declarations. These names are
proposed destinations, not files already present. Keep the existing descriptive
module names where a whole module is shared; split only genuinely mixed owners.

The shared closure starts with values/text primitives, content extraction,
model rules, query/reference logic and the math factory. `helper-query` currently
also uses session metadata text and escaping; `helper-refs` uses fuzzy matching.
Move those dependencies with their implementation rather than importing back into
`src/browser/`. Place their structural types alongside their new owners or in a
small shared helper types module. Browser-only types stay in
`src/browser/shared-helper-types.ts`; migrate its consumers instead of leaving a
re-export layer for former internal import paths.

The target graph is:

```text
server.js / lib consumers -> generated lib/helper-*.js
src/core consumers -------> source helper modules
src/browser consumers ----> source ../core/helper-*.ts
public/helpers.js --------> compatibility bundle of the same source exports
```

Shared modules must not import `public/`, browser controllers, Node-only modules,
or vendored runtimes. The core project contains Node-specific modules too; the
portable helper subset, not all of `src/core/`, must be safe to bundle in a
browser. A shared module can use standard cross-runtime APIs already supported by
the Node/browser matrix. Do not add Node polyfills to make an import succeed.

Task 1 must record both compiler environments: core uses NodeNext with Node types;
browser uses Bundler resolution, DOM libraries and no ambient package types.
The current core config does not explicitly restrict `lib`, so portability must
not be inferred from a core-project pass alone. Compile the moved closure in both
programs and a Node-only `lib: ["ES2022"]` probe. Preserve module-scoped ambient
declarations that work in both; use a narrow runtime lookup only when needed,
not a speculative polyfill or a new global declaration to hide an actual error.

### Runtime-specific behavior is an explicit boundary

- `helper-refs.decodeBase64Url` currently supports Node `Buffer` and browser
  `atob`. Preserve malformed-key refusal, byte interpretation and alias order in
  both runtimes. Do not replace this permissive display/ref decoder with the
  stricter server authority decoder just because both mention session IDs.
- `helper-markdown.createMathExtensions` currently reads an optional global
  KaTeX renderer lazily, at render time. Put the shared tokenizer/renderer logic
  behind an explicit renderer-provider input. The browser compatibility adapter
  supplies the existing lazy global lookup; the Node caller supplies its imported
  renderer. Do not capture a missing renderer at construction and thereby break
  later lazy vendor loading. The adapter owns only that runtime lookup, not a
  second tokenizer or a second fallback implementation.
- Unknown content blocks remain unknown at text-extraction input. The function's
  established output is a string; consumers must not revalidate it merely because
  it arrived through a formerly untyped local require.
- Keep `Date | string | number` timestamp tolerance, nullable metadata, generic
  row identity and Stage 1 readonly input compatibility. Do not reinterpret
  unknown pricing as zero or strip extra fields from generic helper results.

### Compatibility is not permission for internal forwarding

`src/browser/shared-helpers.ts` remains the owner of the supported global/CommonJS
export surface. Its re-exports may point to new core sources and to retained
browser-only helpers. Internal production callers use the owning modules, not a
new mega-barrel or a chain of alias modules. Delete relocated browser-only import
paths when their implementation has moved completely.

Tests specifically exercising the supported compatibility entrypoint should keep
using it. Other tests should exercise the real production entrypoint relevant to
the behavior; do not keep an obsolete internal import alive solely for a probe.
Include [`eslint.config.js`](../eslint.config.js), which loads the helper bundle
to derive lint globals, and the CommonJS/VM consumers in `test/helpers.test.js`,
`test/browser-shared-helpers.test.js` and `test/skills-core.test.js` in the export
manifest. These compatibility/tooling consumers are distinct from the production
backend edges being removed.

## Implementation tasks

Tasks are work packages, not promises of one commit each. A checkpoint must be
buildable and contain both ends of any breaking import change.

### Task 1 — Freeze the shared dependency and compatibility inventory

**Owner:** integration lead. **Depends on:** Stage 1 contract decisions; source
inventory can begin before Stage 1 is delivered.

**Targets:** `shared-helpers.ts`, `shared-helper-types.ts`, helper imports, the
Node consumers above, build scripts/configs and compatibility tests.

- Enumerate actual exported symbols and runtime/type-only dependencies. Use
  language-server references for source symbols and check generated/CommonJS,
  JavaScript, VM and dynamic consumers separately; one project cannot see all of
  those usages automatically.
- Record each moved symbol's source, destination, consumers, return contract and
  whether its behavior depends on a runtime/global or mutable shared object.
- Freeze the minimal dependency closure and the type ownership map before any
  independent moves. Explicitly classify constants, regex state and timers; a
  second bundled copy must not become a competing state owner.
- Capture the public export manifest and representative observable behavior in
  Node and a browser VM. Record application/helper bundle sizes as a comparison,
  not a performance target or proof of runtime speed.

**Contract gained:** every destination and retained adapter has a named owner.
**Complexity to remove:** undocumented cross-runtime edges and duplicate type
owners. **Acceptance:** all current Node consumers are assigned, each retained
compatibility export has a reason, and no source implementation is yet claimed
migrated. This inventory becomes the final deletion checklist.

### Task 2 — Move the shared implementation and structural types

**Owner:** shared-source worker. **Depends on:** Task 1.

**Targets:** audited `src/browser/helper-*.ts` symbols, their structural types and
proposed flat `src/core/helper-*.ts` destinations.

- Move implementations, not copied equivalents. Use language-server file moves
  and reference-aware refactors where available. Keep non-shared functionality
  with its browser owner rather than extracting a function per file.
- Update shared-to-shared imports and eliminate every reverse dependency on
  browser source. Preserve generic row types and readonly input contracts.
- Make the base64 and math runtime boundaries explicit as specified above.
- Keep existing parsing, escaping, truncation, ordering and fallback behavior.
  Changes to those algorithms require a separate defect/behavior decision.

**Contract gained:** source imports check both helper inputs and outputs across
runtimes. **Deletion:** old implementation bodies and duplicated moved types.
**Acceptance:** the shared closure compiles without browser-controller/vendor
imports, and no handwritten declaration substitutes for a moved implementation.
The integration owner owns consumers and generated outputs in Tasks 3–5 so an
intermediate source move is not shipped alone.

### Task 3 — Cut over core and Node production consumers

**Owner:** integration lead or assigned Node integration worker. **Depends on:**
Task 2's agreed exports; may proceed concurrently with Task 4.

**Targets:** the complete Node consumer table, especially
`src/core/session-metadata.ts`; generated output remains integration-owned.

- Replace `public/helpers` requires with the narrow owning `lib/` modules in JS
  callers and direct source imports in typed core callers.
- Remove the handwritten helper require signature from `session-metadata.ts` and
  only the checks compensating for that signature. Keep actual JSONL/persisted
  data validation and missing/null display semantics.
- Preserve runtime-relative paths from generated `lib/`, not from `src/core/`.
  Do not execute core TypeScript directly to make an import work.
- Adapt `file-page.js` to pass its actual renderer through the agreed math port.
  Do not import browser globals or change its separate escaping policy.

**Contract gained:** typed core no longer asserts helper interfaces; JS consumers
use the same generated implementation without becoming falsely counted as typed.
**Deletion:** all production backend helper-bundle dependencies and redundant
local-helper result narrowing. **Acceptance:** Node production loading no longer
requires `public/helpers.js`; external-data decoders still reject their existing
malformed cases. This prepares lifecycle and parser modules for direct migration.

### Task 4 — Cut over browser consumers and compatibility delivery

**Owner:** browser integration worker. **Depends on:** Task 2's agreed exports.

**Targets:** browser source import sites, `shared-helpers.ts`, `index.ts`, the
math runtime adapter and affected type/runtime fixtures.

- Migrate internal imports to owning modules and remove vacated alias modules.
- Keep the supported helper export names and behavior stable. Regenerate the
  global/CommonJS helper entrypoint from the new source graph, not by patching
  emitted JavaScript or introducing another runtime loader.
- Preserve lazy math renderer lookup and the production app's private bindings.
  The main page must still avoid fetching `browser.js` or `helpers.js`.
- Adapt fixtures to genuine consumer ports; keep cross-runtime compatibility
  cases that defend different global/Node execution behavior.

**Contract gained:** browser and core share source contracts, not parallel
interfaces over artifacts. **Deletion:** moved internal helper paths, unnecessary
barrel dependencies and duplicated implementations. **Acceptance:** all five
browser outputs remain self-contained local scripts and supported compatibility
consumers observe the same results.

### Task 5 — Integrate build boundaries and prove the cutover

**Owner:** integration lead. **Depends on:** Tasks 3 and 4.

**Targets:** generated `lib/` and `public/` outputs, build fixtures, type fixtures,
roadmap/guide and the Task 1 deletion inventory.

- Generate core outputs first, then browser outputs; retain atomic validation,
  no-write check mode and orphan detection. The flat core layout is unchanged.
- Ensure a browser helper cannot acquire a Node-only or public-artifact runtime
  dependency. Use the existing build/import checks and a narrow portability
  compile/build check where needed; merely being under `src/` is not sufficient.
- Add compile-only negative cases for genuinely uncertain contracts, such as
  readonly rows crossing query/ref helpers, and adapt existing behavior coverage.
  Do not add tests that only assert an import string or forwarding call.
- Reconcile the export manifest, delete obsolete internal aliases and remove
  temporary probes. Update the stage record with delivered contracts, deletion
  evidence, actual checks and explicitly remaining JS callers.

**Acceptance:** the complete validation below passes, every production backend
helper-bundle edge is gone, and the declaration-only helper boundary is removed.
Do not describe the remaining JavaScript consumer implementations as migrated.

## Dependency waves and integration ownership

```text
Task 1: inventory / contract freeze
  -> Task 2: shared implementation closure
     -> Task 3: Node consumers --------+
     -> Task 4: browser consumers -----+-> Task 5: integration / delivery
```

Stages 1 and 2 are ordered for delivery because readonly/message contracts and
helper types overlap. Inventory can overlap; shared type/helper file edits must
be serialized. Lifecycle inventory may begin independently; its helper import
cutover waits for this stage's final export paths. One owner writes generated
outputs, shared build inputs and any irreducibly shared caller edits. Parallel
workers do not run builds or project suites on each other's incomplete edits.

## Verification and delivery requirements

These are future implementation requirements, not checks claimed by this plan.

- Reuse [helper behavior coverage](../test/helpers.test.js),
  [cross-runtime helper coverage](../test/browser-shared-helpers.test.js),
  [helper type fixtures](../test/types/browser-shared-helpers.ts),
  [core build coverage](../test/core-build.test.js) and
  [browser build coverage](../test/browser-build.test.js).
- Exercise metadata/text/ref consumers through `test/session-files.test.js`,
  `test/session-index.test.js`, `test/session-refs.test.js`,
  `test/skill-mining.test.js` and the file/search/model/publication scenarios in
  `test/server.test.js`. Math behavior is also covered by `test/helpers.test.js`.
- Run `npm run build:core`, `npm run build:browser`, `npm run check`, `npm test`,
  `npm run test:browser`, `npm run test:ui:scenarios` and `npm run test:ui` at the
  integrated checkpoint, following [test isolation requirements](testing.md).
- Smoke the actual isolated server and uninstrumented desktop/mobile application:
  query/reference resolution, a text/tool transcript, lazy math before and after
  renderer availability, and a published file page. Exercise the standalone
  helper bundle in both Node and a browser context. No live sessions/credentials.
- Compare artifact sizes and relevant observed request/render work to Task 1.
  Investigate added vendor payload or repeated decoding rather than setting an
  arbitrary line-count/byte target. No timing claim without a measurement.
- Follow the roadmap's commit, authorized external review, push and exact-commit
  CI process. Record unavailable runtime checks and skips, not implied passes.

## Completion and successor handoff

The stage is done when one source implementation serves every migrated runtime,
core has real typed helper imports, production backend code no longer consumes
the browser helper bundle, and supported compatibility delivery still works.

Handoff to lifecycle: stable model/ref/text imports and their readonly contracts;
no need to reproduce helper declarations in each extracted operation module.
Handoff to transcript/search/usage: established shared primitives so parser and
projection implementations can migrate without importing browser artifacts.

The skill CLI has a separate zero-dependency/no-server-import contract and its
own reference implementations, documented in
[pi-dish-client.js](../skills/lib/pi-dish-client.js) and
[parity coverage](../test/skills-core.test.js). Do not silently change that delivery
contract in this stage. Record the portable reference subset and duplicate rules
for the later CLI stage, which can decide how to share source while preserving
its standalone dependency behavior. A lower TypeScript file count or a source
move alone is not the simplification outcome.
