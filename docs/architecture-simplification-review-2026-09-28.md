# Architecture simplification proposal: Opus review receipt

Date: 2026-09-28.

Status: **AGREED. Opus 5.5/high issued APPROVE for the exact final proposal,
with no remaining conditions for plan approval. This is not implementation approval.**

Proposal: [architecture-simplification-proposal.md](architecture-simplification-proposal.md).
Source baseline: `b985b5db18a236835b5f5a47565d21e8d40d1224`.

## Reviewer identity and method

- Requested and configured model: `anthropic/claude-opus-5-5`.
- Reasoning: `high`. Before the first prompt, the maintainer set the session's
  thinking level through the semantic API; it returned
  `{ "success": true, "level": "high" }`. Session resolution independently
  reported the same model and `thinkingLevel: "high"`.
- Harness: OMP. Durable reviewer ref: `01a0ea40`.
- Native session id:
  `2026-09-28T23-01-36-443Z_01a0ea40-963b-7530-a5d2-0c4e823f0440`.
- The reviewer identified the Opus model from its context, but could not directly
  observe its effort setting; high effort is verified by the maintainer's server
  observation, not inferred from the review prose.
- The reviewer was instructed to read the whole proposal, independently inspect
  the corresponding source, challenge ownership/consumer claims and unnecessary
  abstraction, distinguish mandatory findings from suggestions, and make no edits.
  No delegation, implementation, builds, lint, tests or live-session operations
  were authorized for the reviewer.
- The maintainer did not request a rubber stamp. A second prompt explicitly
  explains where the chosen resolution differs from a suggested design and asks
  whether the reviewer accepts those choices.

The durable transcript can be read through the supported CLI:

```sh
node skills/pi-dish-sessions/scripts/pi-dish-sessions.js read 01a0ea40 --limit 10
```

Review reports are transcript message indexes 124 (round 1), 146 (round 2) and
152 (final confirmation). Page backward through the CLI to inspect the preceding
source reads. The transcript retains the complete findings and review prompts;
this receipt records their disposition and the exact approved document hash.

## Round 1

Reviewed proposal: 590 lines.

SHA-256:
`f76c4d868250729e26695068263945a915a29b22f32f436ba431bc72e1c95fbf`.

Verdict: **CHANGES_REQUESTED**.

The reviewer agreed with the overall direction but rejected the initial catalog
ownership description, incomplete usage consumers, underspecified tree differences,
and over-broad command consolidation. The maintainer verified the relevant source
before revising; the initial verdict has not been relabeled as approval.

### Mandatory findings and revised decisions

| ID | Independent finding | Resolution submitted in round 2 |
| --- | --- | --- |
| M1 | New-session and the session header already share the same modelCatalog object; splitting it changes behavior. | S7 explicitly retains that instance, clear/retire/seed behavior and request interactions. Reuse the existing model API for routine reads; no new catalog owner. |
| M2 | Harness decoders, failure caching and key/credential policies differ. | S7 adds complete decision tables and preserves both harness projections/loaders. Routine model API errors are caught back into the existing empty-result/cache policy. Tokens remain in existing memory-only keys, not new logs/storage. |
| M3 | New in-flight reuse has no named compatible concurrent consumer pair. | Removed. The takeovers are mutually exclusive and header reads are session-scoped. |
| M4 | S2 omitted usage-view, weekly and scalar daily-model consumers; a shared finalizer could add a server field. | Name portable helper-usage-math.ts, enumerate all arithmetic consumers, retain local finalization and exact wire fields. Server totals gain no priced key; weekly nested model rows gain no absent components. |
| M5 | Live OMP and Pi SDK tree routes/projections are not interchangeable. | S3 names actual route consumers and every field difference. Share only worthwhile topology; preserve host display dialects. A cycle-safe parent walk is an explicit defensive correction, not claimed existing behavior. |
| M6 | The Pi TUI list is an upstream mirror, not pi-dish-owned emulation metadata; list/execute gates differ. | Keep the TUI mirror separate and unchanged. Share bridge/RPC emulation facts only. A bridge-local table records listing/execution predicates without silently replacing runtime capabilities with descriptor capabilities. Thinking hints derive actual host vocabulary. |
| M7 | HTTP and slash paths differ in side effects, validation, resolution, delivery, error status and compaction lifetime; routines/recovery were omitted. | S6 includes the complete preservation matrix. Routines/recovery are explicit non-HTTP consumers in the reference/regression audit, not moved into HTTP admission. |
| M8 | One method-shape mismatch does not justify a new command facade. | S6a first normalizes BridgeSession.setModel to the existing RPC signature. Further extraction is conditional and must use create*Handlers(ports), or be declined. |

### Nonblocking observations

| ID | Decision |
| --- | --- |
| N1 | Keep selection capture local because quote truncation/admission differs; include existing index exports/fixtures; measure card size after max-size styles; optional returned marks must preserve supported exports. |
| N2 | S4 is explicitly a small patch for two expressions, not a rendering subsystem. No independent stringification optimization is bundled. |
| N3 | Corrected the claim about addMergedUsage/compareUsageBuckets: they are not part of the 121-export facade. |
| N4 | Recursive tree stack-depth risk remains unmeasured inference; iterative traversal is deferred rather than justified as an observed failure. |
| N5 | S7 requires before/after request-count observations with the same fixtures. |
| N6 | S8 names the actual candidate policies: search/usage captured-token equality versus routine captured-base/current-token dispatch. |

### Deliberate choices presented for agreement

- Preserve differing tree preview/tool/model/nullish behavior rather than making
  OMP adopt Pi's display dialect to obtain one projector.
- Preserve explicit listing-versus-execution capability sources in S5. Any proven
  erroneous discrepancy needs a separately approved behavior correction; shared
  metadata is not authority.
- Keep the upstream Pi TUI mirror instead of adding a private import or expanding
  historical command autocomplete in this program.
- Reuse the already-existing model API instead of introducing a catalog service,
  shared harness decoder, split catalog instance or new single-flight cache.
- Keep routine/recovery delivery policies outside HTTP handlers while retaining
  them in the affected-consumer audit and behavioral verification.

## Round 2: agreement with optional clarifications

Reviewed proposal: 712 lines.

SHA-256:
`9220597d4ed360f5c9e41bf590bab9bd42a8a5f3de99a149922b449ea3e5377f`.

Verdict: **APPROVE_WITH_NITS**, plan only. All M1–M8 and N1–N6 were resolved.
The reviewer explicitly accepted the conservative decisions listed above, including
the disagreement over whether consolidation should unify admission authority:

> I accept it. My round-1 point about the listing gate reading runtime
> capabilities while execution reads descriptor capabilities was evidence of
> drift, not a request to change who is allowed to do what. Making one gate the
> authority should be a separately approved fix.

It also accepted keeping one catalog object, two harness decoders, separate tree
display dialects, no new in-flight cache, the two enumerated behavior corrections,
and the revised stage order.

Six optional clarifications were applied before final confirmation:

| ID | Final clarification |
| --- | --- |
| N7 | The one-owner outcome covers model URL selection/decoding, not all specialized catalog request/cache/failure policies. |
| N8 | Weekly buckets and model rows use smaller math helpers; whole-bucket addition must not add measured/duration/slowest fields. |
| N9 | Explicitly migrate the obsolete type-fixture mismatch assertion, without accidentally retaining a passing expect-error for the wrong reason. |
| N10 | Keep the socket-operation capability map separate and preserve omitted args in bridge command-list rows. |
| N11 | Cycle-safe parent walking is required even if common node-order extraction is declined. |
| N12 | Re-baseline each stage against current HEAD/worktree. Preserve concurrent model-picker work and repeat the S1 export/S7 catalog audits. |

The reviewer observed HEAD advancing to `aa12aeb` and concurrent browser edits.
These are not proposal implementation or maintainer-owned changes. The proposal
records its original baseline and requires implementation-start revalidation.

## Round 3: exact final approval

Approved proposal SHA-256:
`ad1d1c2e052fec84db4a0c5775ce54a2a37c98e95464403143e792637d5a1564`.

Verdict: **APPROVE (plan only)**. All N7–N12 were resolved. The reviewer independently
checked the final and round-2 hashes and confirmed that the 73-line unified diff
contained only those six clarifications. It did not re-read unchanged sections.

Exact disposition:

> I agree with the proposal at SHA `ad1d1c2e…` as written. No conditions remain
> for plan approval.
>
> This is **plan approval only**. Each stage still needs its own implementation
> review, its runtime acceptance evidence and proof of a complete cutover. The
> conditional steps (S3 extraction, S6b and S8) still have to clear their entry
> gates before any code is written.

**Maintainer agreement:** the exact proposal above is accepted with those
implementation gates. No mandatory finding, optional wording correction or
unresolved design disagreement remains. The proposal bytes are left unchanged
after approval; this receipt is the separate review-status record.

## Verification scope and limits

- Round 1 was source-only plan review. The reviewer ran no builds/tests or runtime
  scenarios. It inspected the entire proposal and source across comment anchors,
  usage math, tree builders/routes, renderers, command tables/dispatch, catalogs,
  credential checks, build imports and production script tags.
- Its stated round-1 omissions were transcript S8 bodies, harness adapter wrappers,
  bridge/RPC event-handler bodies and docs/testing.md. It did not delegate.
- The maintainer's earlier isolated session-catalog runtime observations remain
  recorded in the proposal; they do not validate future implementation stages.
- Local documentation checks passed for all 46 proposal links and the receipt's
  proposal link, plus the two new backlog entrypoint links. The earlier missing
  receipt target was resolved by creating this record. The proposal parsed with
  installed marked: 24 headings and 11 tables, including the behavior matrices.
- The architecture Mermaid diagram was parsed and rendered with the vendored
  runtime in managed Chromium: 19 nodes, 28 edges. The maintainer inspected the
  rendered diagram and closed the tab. No application session UI was driven.
- A Node-only Mermaid attempt lacked DOMPurify's browser environment; verification
  moved to Chromium rather than treating that environment failure as a diagram
  failure. A dropped review-observer SSE connection was reattached without
  resubmitting the first prompt; it did not restart or replace the reviewer.

This receipt concerns **plan agreement only**. It does not claim implementation,
product-suite success for new code, performance gains, or cleared implementation
review. No production source or generated runtime output is changed by the proposal.
