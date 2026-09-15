# Session lifecycle migration

Status: **Planned** (2026-09-15). No implementation or runtime verification is
claimed by this document. Stage 3 follows [browser contract cleanup](browser-contract-cleanup.md)
and [shared runtime helpers](shared-runtime-helpers.md).

Plan review: **APPROVED** by Anthropic Fable 5.1 at high effort for the clarified
plan at `9dee6d3`; [signoff and observation resolutions](../BACKLOG.md#next-stage-plan-review).
No implementation or lifecycle runtime approval is implied.

Planning baseline includes `6e8df16` and `e816d36`: recursive family discovery,
Prime RLM artifacts and subagent trace/signaling are existing consumers to preserve.

## Mission and outcome

Move actual lifecycle implementations into strict TypeScript, deleting duplicated
ownership policy and distributed operation bookkeeping. Callers invoke established
operations rather than reconstruct registry/process/tmux/recovery rules.
`server.js` remains JavaScript HTTP composition; checked implementations, removed
policy copies and preserved refusal behavior—not fewer server lines—are success.

Use the existing [task-package convention](session-catalog-migration.md#higher-level-tasks),
[typed foundation](typescript.md), [contributor rules](../AGENTS.md#invariants),
and architecture guidance for [recovery](../CLAUDE.md#session-recovery-libsession-recoveryjs-librecovery-runnerjs),
[tmux](../CLAUDE.md#tmux-spawning-libtmuxjs) and
[routines](../CLAUDE.md#routines-libroutinesjs-libcronjs-libroutine-runnerjs-apiroutines).

## Boundaries and non-goals

| Existing owner | Stage 3 responsibility |
| --- | --- |
| [lib/session-recovery.js](../lib/session-recovery.js) | Migrate durable observation/control reads and writes, checkpoints and `createSessionObserver`, not just its declarations. |
| [lib/tmux.js](../lib/tmux.js), [lib/prime-lifecycle.js](../lib/prime-lifecycle.js) | Migrate placement persistence, exact-process/pane operations and Prime supervisor stop implementation. |
| [server.js](../server.js) ownership, spawn and lifecycle functions | Extract live capture/revalidation, launch/registration and coordinated create/resume/close/restart implementations. |
| [lib/recovery-runner.js](../lib/recovery-runner.js), [lib/session-bounces.js](../lib/session-bounces.js) and their server callbacks | Migrate both runners and their real recovery/bounce policy, including execution and authority capture. |
| [lib/routine-runner.js](../lib/routine-runner.js), HTTP/startup consumers | Migrate every lifecycle callsite to the new operations; leave routine definitions, scheduling and ledger implementation in JS. |

All new authored modules stay flat in `src/core/`, compiling to their existing
or corresponding flat `lib/*.js` and `.d.ts` paths. Proposed extraction names
below are design targets, not existing APIs; Task 1 freezes them before workers
split ownership. No new build/deployment stage or `src/shared/` directory.

No API/store/wire-format redesign, added capability, universal operation framework,
blanket `server.ts` rename, browser framework or helper relocation in this stage.
The complete JSONL parser, general routes/auth/proxy, routine schema/scheduler and
extension SDK typing remain outside scope. Narrow their consumed values at actual
ingress; do not pretend handwritten signatures have checked those implementations.

## Contracts and safety baseline

Reuse [SessionSource](../src/core/session-source-contracts.ts), branded native/route
identity and `ProcessIdentity` from [contracts.ts](../src/core/contracts.ts),
[process proofs](../src/core/process-identity.ts), descriptor/capability policy,
and [registry claim APIs](../src/core/bridge-session.ts): `sameRegistryClaim`,
`getBridgeSession` (aliased as `getBridgeSessionForClaim` in the server),
`pruneRegisteredSession` and `invalidateRegistryCache`.
Do not add parallel identity brands or registry implementations. A cached source,
placement record, catalog capability or ancestry hint is not destructive authority.

### Operation matrix to freeze before edits

Task 1 records every operation pair in both arrival orders, canonical route/file
key, acquisition point, awaits, action point, release, response and persistent
side effect. This is a seed map of existing mechanisms, not a new conflict policy:

| Mechanism | Existing behavior to capture and preserve |
| --- | --- |
| `resumeFlights` | Canonical real JSONL path; overlapping explicit tmux, hidden tmux and RPC resumes share the first launch/target. Install before async validation/cleanup; joiners verify the resulting runtime remains active. Route aliases cannot create another file writer. |
| `closeFlights` / `restartFlights` | Close joins another close by canonical route; close refuses an active restart. Restart refuses close/restart and a detected canonical-file resume. Resume checks restart before lookup and launch, and close immediately before launch. Do not assume this is symmetric exclusion at every intermediate await. |
| `headlessSpawnChain` / `headlessTmuxBroken` | Hidden-target creation serialization is separate from per-session operations; a failed eligible Pi launch disables that path for this server lifetime under the existing fallback rules. |
| `failedResumeCleanups` / `uncertainExplicitResumes` | Canonical-file quarantines outlive requests. Known process birth identities survive pane loss; Prime detached-worker uncertainty cannot clear merely because its client disappeared. Preserve existing active-registration clearing rules. |
| Recovery `flights` / `startPromise` / controls | Per-route runner deduplication and one startup snapshot are distinct from canonical-file launch single-flight. Durable launch/delivery intent must precede effects; historical boot identity limits saved process evidence. |
| Bounce `reserved` / `flight` / `bounceActionLocks` | Waiting reservation prevents duplicate queued targets, not all live work. Execution excludes non-GET session routes; cancellation affects waiting only. `bounceExecuting` also participates in live-session lookup. Preserve direct-caller versus HTTP distinctions. |
| Create / async spawn status | New-session creation has no historical file lock to invent; `sessionSpawnOperations` tracks provisional acceptance/readiness, not durable ownership. Naming or registration failure must not be reported as an unstarted process. |
| Routine consumers | `run`, `scheduleClose`, failure cleanup and `recoverAfterRestart` consume the same guarded lifecycle operations, with invocation policy left in the runner. Recovery finishes before routine reconciliation/scheduling begins. |

One owner may retain multiple keyed structures; never flatten them into a generic
mutex, global queue or busy bit. Investigate close/resume during validation or
cleanup, replacement during awaited proofs, Bounce activity before action, and
source/control changes before delivery. Unproved races are investigation cases,
not regressions or permission to change policy. Report discrepancies; behavioral
fixes need demonstrated cases and explicit approval, not silent extraction changes.

### Authority, compatibility and bounded work

| Runtime or boundary | Invariant |
| --- | --- |
| Owned RPC | Capture the exact child object/process and transcript; child exit, not PID-zero probing of a zombie, confirms close. Restart remains RPC against the same JSONL. |
| Bridge Pi, including legacy | Logical close remains available to externally launched Pi only with the current claim/process proof. Legacy PID-only claims require their live hello and locally captured birth identity; no PID-only signal or SIGKILL escalation. External Pi gains no pane-restart authority. |
| Owned-pane OMP / tmux restart | Match launch token, bridge claim, pane-root birth identity and complete ancestry where required; recapture after awaits and immediately before action. Preserve exact pane/window/session/socket on restart and issue new launch authority. |
| Prime owned-agent | Use the exact worker's non-secret `/proc` routing fields and protocol-7 supervisor roster/root/PID/file proof. Stop only its owned root/children; never kill the shared daemon or client descendant tree. Missing client permits proved close, not restart; replaced pane refuses. A sent but unacknowledged stop launches nothing and retains closed intent. |
| Recovery | Observations are bridge-owned; controls are server-owned; neither is the disposable registry. Preserve boot-id, run/observation identity, saved-byte checkpoint and corrupt-control fail-closed behavior. No HOME fallback, parent-owned subagent resurrection or automatic repeat of ambiguous delivery. |
| Launch uncertainty | Preserve final deadline registration check, hidden cleanup before eligible RPC fallback, explicit Pi pane inspection and alternate-harness no-RPC behavior. Prime replacement must prove a new worker for the original identity/file; failed readiness stays inspectable/quarantined. |
| Nested children / Bounce | Use `inspectSubsessionExits`, including grandchildren beneath exited children and incomplete traversal refusal. Unknown safety state, tools/dialogs/queues/compaction/background work block execution. Prime remains excluded; Pi guarded reload never types into drafts. |
| Prime RLM artifact discovery | Preserve descriptor-owned `subagentArtifacts`, recursive header identity/parent edges and bounded artifact traversal. `rlm-subagent.json` display/liveness data is not a worker/pane proof. Do not make these children independently resumable/restartable through a source or family-tree row. |
| Runtime compatibility | Keep CommonJS paths and extension `../../lib/session-recovery.js` imports working. Preserve wrapper entrypoint paths, literal host-package imports, OMP realpath discovery matching and Prime's retained generated wrapper files. Source movement must not reinterpret `__dirname` or remove files needed after client exit. |

Retain bounded registry polling, tmux argv-only `execFile` calls/socket allowlisting
and timeouts. Preserve recovery streaming limits and no-op write suppression;
never replace saved-byte checkpoints with streamed text or add corpus reads to
ordinary capability/runtime queries. Do not deep-clone session transports, parse
JSONL twice or add per-poll authority allocations for display-only advice. Runtime
location (`describeRuntime`, `resolveRuntime`, `locatePiPane`) remains explicitly
weaker than process/pane authority; terminal and reload consumers keep that distinction.

## Higher-level tasks

Every package includes its source, callers and deletion obligations. Workers skip
formatters, builds, lint and tests while siblings write. The integration lead owns
all shared-file edits, generated output and checkpoint validation; modules do not
ship as declaration-only adapters awaiting a later implementation.

### Task 1 — Freeze contracts, conflict matrix and baseline

**Owner:** integration lead. **Depends on:** Stage 2's final helper contracts for
the implementation freeze. Inventory and isolated baseline work may start earlier;
Stage 1 precedes this stage in delivery order, not as a backend runtime dependency.
**Targets:** matrix above; named server functions; existing lifecycle suites;
proposed contracts beside `session-ownership.ts`, `session-launch.ts` and
`session-operations.ts`, not an omnibus framework module.

Inventory callers, low-level/runtime imports and error fields. Freeze capture
variants, launch targets/results/failures, recovery records/controls/attempts,
operation results and async preparation/synchronous final-check contracts.
Distinguish no action, stopped, stop uncertain, cleanup failed and replacement
readiness failure without changing public bodies. Record legacy missing/null/
coercion behavior. Capture isolated launch counts, registry/proof work, bounded
recovery reads and startup ordering; mark uncovered cases rather than invent data.
Classify each injected dependency as a data observation, a checked lookup or an
operation/policy. In particular, source resolution, active-session catalog reads
and subsession candidates must expose their existing read contracts without
smuggling fallback, admission or destructive-mode decisions through a JS callback.
Name `src/core/harnesses.ts` in the runtime-path map: its `__dirname` resolves from
generated `lib/`, and its descriptors own the wrapper/bridge entrypoint paths.

**Invariant/deletion:** consumers cannot pass a `SessionSource` as live authority
or collapse uncertain launch into safe fallback; replace competing contract sketches.
**Acceptance:** reviewed matrix names both arrival orders and final proof points;
negative type cases reject wrong identity/authority variants and incomplete outcomes.
**Enables:** independent implementation workers with frozen interfaces, not guessed ports.

### Task 2 — Migrate real recovery evidence and controls

**Owner:** recovery-store worker. **Depends on:** Task 1.
**Targets:** authored `lib/session-recovery.js` → `src/core/session-recovery.ts`;
`recordSession`, `patchControl`, `transcriptCheckpoint`, `createSessionObserver`;
lead integrates [rpc-session.ts](../src/core/rpc-session.ts) and the bridge consumer.

Type and implement store decoding, private fsync/rename writes and observer
transitions. Preserve observation/control separation, corrupt-control refusal,
no-op suppression, delayed post-append checkpoints, `agent_settled` versus
`turn_end`, retries/compaction uncertainty and timer retirement on identity switch.
Keep initialization/disposal from overwriting prior interrupted evidence. Decode
only consumed legacy attempt fields conservatively; a malformed uncertainty
marker must not become permission to relaunch. Preserve serialized data/version.

**Invariant/deletion:** typed observation writers cannot patch server controls;
remove RPC's handwritten `createSessionObserver` require signature, local
`RecoveryObserver` interface and unchecked-port comment; import the actual source
contract in core. External extension/Node consumers retain generated `lib/` paths.
**Acceptance:** adapt [session-recovery tests](../test/session-recovery.test.js),
including bridge-less RPC permanently yielding observation ownership to its bridge.
After regeneration, a minimum non-canary gate must resolve and load the real
`../../lib/session-recovery.js` exports with Node's `createRequire` anchored at
the bridge module, and compile a narrow extension-relative consumer against the
generated declaration without requiring the whole harness SDK. Use an isolated
HOME and no live registry. This checks the module/type path, not the host's TS
loader; the real Pi/OMP/Prime canaries remain separate required evidence, with
explicit skips and residual risk when unavailable.
**Enables:** checked recovery control and extension-facing observer seams without SDK migration.

### Task 3 — Migrate tmux and Prime lifecycle dependencies

**Owner:** runtime-dependency worker. **Depends on:** Task 1; parallel with Task 2.
**Targets:** `lib/tmux.js` → `src/core/tmux.ts`; `lib/prime-lifecycle.js` →
`src/core/prime-lifecycle.ts`; `respawnPane`, `killPaneAndWait`, `paneProcessState`,
spawn persistence/rekey/pruning, `primeWorkerTarget` and `stopPrimeWorker`.

Move actual process-tree capture, placement I/O and protocol exchange, narrowing
external records/responses rather than declaring arbitrary JSON safe. Preserve
compare-before-remove/rekey and reread-before-prune behavior across awaits;
separate absent panes from unidentified/replaced processes and detached workers.
Keep Prime no reconnect/retry, stop-dispatched error evidence and worker-exit wait.

**Invariant/deletion:** process proof and placement shapes are checked at destructive
calls; errors retain remaining exact processes or indeterminate stop evidence.
Delete authored JS implementations in favor of generated modules, not forwarding stubs.
**Acceptance:** adapt [tmux tests](../test/tmux.test.js) for cleanup, PID reuse,
Prime roster/peer isolation and same-pane restart; preserved argv and socket restrictions
are exercised against the isolated real tmux fixture, not source-text assertions.
**Enables:** ownership and launch modules depend on checked side effects.

### Task 4 — Capture live ownership and revalidate at action time

**Owner:** ownership worker. **Depends on:** Tasks 1–3.
**Targets:** proposed `src/core/session-ownership.ts`; server `spawnMatchesRegistryClaim`,
`proveBridgeRegistryClaim`, `spawnAllowsOwnedPaneClose`, `spawnAllowsManagedClose`,
`spawnAllowsRestart`, `validateRecoveryRecord`, runtime-location helpers and advice.
Include the authority-sensitive branches of `getLiveSession`, `liveSessionSupports`
and session-switch handling in the caller inventory. Feature-only extension UI
tracking may remain server-owned; live ownership/fallback policy may not hide in
an unchecked callback passed back to the extracted operation.

Extract implementations using existing registry/process APIs. Give RPC, logical
Pi close, owned-pane and Prime captures distinct shapes; keep weak display location
separate. Preserve expected-claim pruning and bridge-session-switch placement
adoption (`adoptBridgeSessionSwitch`) through the same placement owner. Expose
capture plus operation-specific revalidation, not an indefinitely reusable
`authorized: true`. Preserve checks after socket/pane awaits and synchronous final
checks at the destructive boundary; a type cannot make an await race atomic.
Move saved recovery source/root/cwd/boot checks here using Task 2's record type;
the validated source remains read input, not live authority. Do not import runners.

**Invariant/deletion:** advice/read identity cannot satisfy a destructive operation's
input. Delete duplicated server proof predicates while preserving every actual check.
**Acceptance:** existing [bridge tests](../test/bridge-session.test.js),
[server close tests](../test/server.test.js) and tmux cases demonstrate stale claims,
legacy hello mismatch, process birth changes and replaced panes never inherit authority.
**Enables:** operations and Bounce share ownership mechanisms without sharing policies.

### Task 5 — Type launch placement, registration and quarantine

**Owner:** launch worker. **Depends on:** Tasks 1, 3 and 4.
**Targets:** proposed `src/core/session-launch.ts`; server `spawnHarnessInTmux`,
`spawnHarnessHeadlessTmux`, `materializeLaunchWrapper`, token lookup/socket validation,
headless chain/broken flag and `launchResumedSession` backend dispatch.

Move argv/env/wrapper construction, placement selection, registration/hello proof,
deadline check and cleanup implementation. Use Stage 2 typed helpers directly.
Consume the descriptor-owned paths from `harnesses.ts`; do not recompute the
repository root or wrapper/bridge paths inside the extracted launch module.
Consume the frozen failure variants: fallback permitted, cleanup incomplete,
explicit pane uncertainty and detached replacement uncertainty. Report them to the
operation coordinator, which owns canonical-file quarantine; never release that
exclusion merely because a request or pane ended. Keep RPC launch/startup readiness
in its existing typed implementation and preserve model/thinking selection behavior.

**Invariant/deletion:** exhaustive launch outcomes make unsafe fallback non-default;
remove ad-hoc error-property probing and duplicate backend dispatch from server.
**Acceptance:** tmux/RPC tests cover shared targets, final-sleep registration, bad
socket config, incomplete/conflicting claims, failed hidden cleanup and explicit/
Prime uncertainty; real launch smoke confirms retained wrapper imports and placement.
**Enables:** create/resume/restart express transitions without rebuilding spawn machinery.

### Task 6 — Consolidate create, resume, close and restart operations

**Owner:** operation-coordinator worker. **Depends on:** Tasks 2, 4 and 5.
**Targets:** proposed `src/core/session-operations.ts`; server `createSession`,
`resumeSessionById`, `closeSessionById`, `performSessionClose`, `restartSessionById`,
`assertNoConflictingWriter`, `probeRecoveryLive`, quarantine and async spawn status.

Implement the frozen matrix with one owner for distinct keyed flights, quarantine
and action exclusion; keep runner-specific waiting/report state separate. Consume
`SessionSource` for exact transcript lookup, then re-prove current writer absence,
parent ownership and process/boot evidence before launch. Move complete validation,
close-intent persistence/rollback and replacement state transitions, not callbacks
whose authoritative branches remain in JS. Preserve explicit-close rollback rules,
Prime `preserveCloseIntent`, restart's non-retiring close path, ordinary versus
recovery cwd behavior and `stopped`/uncertain/readiness distinctions. HTTP composition
may decode requests and map results but cannot choose fallback or destructive mode.

**Invariant/deletion:** operation results retain safety-significant state; remove
server flights, quarantine maps and raw lifecycle policy once all callers migrate.
**Acceptance:** exercise both orders from Task 1's matrix, canonical-file aliases,
shared resume, close persistence failure/rollback, restart conflicts and failed
replacement. Adapt existing RPC/tmux/API cases; add regressions only for uncertain
invariants or demonstrated defects, never for private map layout or error wording.
**Enables:** routine/recovery/API callers select an operation, not a lock protocol.

### Task 7 — Migrate recovery and Bounce implementations

**Owners:** recovery-runner worker and Bounce worker, disjoint modules;
lead owns server edits. **Depends on:** Tasks 2, 4 and 6; workers run in parallel.
**Targets:** authored runners → `src/core/recovery-runner.ts` and
`src/core/session-bounces.ts`; server recovery callbacks and
`captureBounceAuthority` through `executeBounce`.

Move recovery control/delivery policy and bounded `continuationSafety` with the
runner, consuming coordinated resume/live probing and Task 4's record validation.
Keep one visible inspection prompt, observation/checkpoint rechecks after live
handshake, and explicit retry as restore-only. Move Bounce
capture, idle inspection/activity revision, descendant blockers and final execution
checks alongside its runner; preserve waiting/cancel/executing transitions and
process-local authority omission from API views. Guarded reload requires a new
connected bridge claim on the same process/file; dispatch is not completion and
ambiguous timeout is never automatically retried. Wire action exclusion through
the coordinator without imposing new admission rules on waiting targets.

**Invariant/deletion:** recovery evidence is not authority; Bounce target/report
DTOs cannot carry executable ownership. Delete server callbacks that still decide
recovery safety or Bounce eligibility, not just their registration blocks.
**Acceptance:** adapt [recovery-runner tests](../test/recovery-runner.test.js) and
[session-bounces tests](../test/session-bounces.test.js); exercise exclusion during
handshake, lost acknowledgement, repeated idle restore, cancel during inspection,
revoked ownership, nested descendants and replacement-not-ready outcomes.
**Enables:** maintenance/report routes consume typed outcomes without hidden policies.

### Task 8 — Integrate every consumer and delete obsolete ownership

**Owner:** integration lead. **Depends on:** Tasks 1–7 implemented.
**Targets:** server lifecycle routes/composition/startup/shutdown; `routine-runner.js`
`run`, `scheduleClose`, failed-delivery cleanup and `recoverAfterRestart`; generated
`lib/` output, affected type fixtures, architecture/coverage documentation.

Wire one operation owner into HTTP, recovery, Bounce and every routine lifecycle
consumer. The routine runner stays JS: use the generated operation contract to
document its dependency boundary and update callers/tests rather than retain
server aliases. A JSDoc import alone does not make the runner type-checked.
Preserve fresh-spawn fallback after failed routine resume, close refusal as
`closeError` without escalation, and reconciliation of existing invocations after
recovery. Keep prompt composition, scheduling and ledger policy in their current
owners; migrate lifecycle admission calls without broad route conversion. Update
runtime/terminal/reload/capability consumers and remove unused lifecycle imports.

**Invariant/deletion:** callable operations and their internal composition are
checked in TypeScript; server/routine JS composition remains unchecked. Validate
consumed external/JS observations at that boundary, rather than asserting them
safe with handwritten signatures. Remove old server lifecycle closures.
**Acceptance:** complete the deletion ledger and verification matrix; record
actual results/skips and update ownership docs.
**Enables:** later routines focus on scheduling/store types, backend routes become
request/result adapters, and extensions use the real observer contract.

## Waves, checkpoints and verification

1. **Freeze:** Task 1 owns the full matrix, source/runtime import map and baseline.
2. **Dependencies:** Tasks 2 and 3 parallel; lead integrates RPC observer import and
   generated output, then validates the dependency cutover before continuing.
3. **Authority to operations:** Tasks 4, 5 and 6 are bounded dependent checkpoints;
   do not parallel-edit their shared contract or the server. Integrate complete
   source/caller slices, not a second temporarily authoritative implementation.
4. **Consumers:** Task 7's two runners parallel; Task 8 integrates routine/server
   consumers and final deletion. Lead alone regenerates and validates after each
   settled checkpoint; no worker builds while another writes shared inputs.

Implementation verification uses [the supported matrix](testing.md#supported-tooling-and-automated-checks)
and sanitized temporary HOME, sockets, tmux servers and fake providers. Run focused
`npm test -- test/session-recovery.test.js test/recovery-runner.test.js test/session-bounces.test.js`,
then the relevant `test/tmux.test.js`, `test/rpc-session.test.js`,
`test/bridge-session.test.js`, `test/server.test.js`, `test/routines.test.js` and
`test/routines-api.test.js` paths through `npm test --`. Negative type fixtures
must reject advice-as-authority, native/route confusion and unhandled uncertain
outcomes; existing tests adapt to behavior, not constructor wiring or source text.
Preserve Prime RLM discovery and recursive family cases in
`test/session-discovery.test.js` and `test/server.test.js`; the subagent takeover
and captured-target signaling cases remain in `test/browser/session-navigation.spec.js`.

At final integration regenerate core/browser outputs as needed, run `npm run check`
and the full `npm test`; run `npm run test:browser`, `npm run test:ui:scenarios`
and `npm run test:ui` for lifecycle controls, recovery/Bounce reports, async spawns,
routines and desktop/mobile integration. Also launch the actual isolated server:
create, close, resume and same-placement restart via HTTP; observe process birth,
registry, JSONL identity, placement and recovery intent, not merely status codes.
Compare Task 1's launch counts/bounded-work baseline; do not add telemetry machinery.

Real runtime canaries are review-required, not substituted by fake fixtures:
[Pi bridge integration](../test/pi-bridge.integration.test.js) needs a resolvable
real host Pi matching the installed SDK and its isolated fake provider;
[lineage canaries](../scripts/test-real-lineage-harnesses.js) need Linux `/proc`,
tmux, explicit absolute `PI_DISH_REAL_OMP_BIN`/`PI_DISH_REAL_PRIME_BIN` and, for OMP,
`PI_DISH_REAL_BUN_BIN_DIR`. Run `npm run test:lineage -- omp` and `-- prime` with
only the selected harness prerequisites. Record executable versions, commands,
isolation and actual cases exercised; unavailable prerequisites are explicit
skips with reason and remaining review risk, never success. Include real Prime
peer/root isolation and same-pane replacement; inspect readiness/import failures.
Never borrow live agent sessions, shared daemon authority or provider credentials.

## Definition of done and deletion ledger

- Five authored JS modules have checked implementations and generated compatible
  `lib/` outputs; RPC's recovery adapter/local interface are gone. Runtime extension
  imports still resolve and retained Prime wrapper paths remain usable.
- Server proof predicates, launch/fallback/registration loops, operation flights,
  quarantines and recovery/Bounce policies are removed in favor of their typed
  owners; retained HTTP glue is named explicitly. Multiple necessary keyed maps
  inside the owner are not an unfinished migration.
- Every API, routine, recovery, Bounce and runtime-location consumer uses the new
  contracts. No obsolete alias, duplicate policy or unchecked helper require
  signature survives; Stage 2's supported `public/helpers.js` compatibility export
  remains supported, not imported back into internal lifecycle code.
- Public status/error bodies, capabilities, persistence versions, prompt behavior,
  close-intent semantics and runtime placement remain compatible. Unproved races
  are reported separately, never advertised as fixes or hidden in extraction.
- Verification evidence and skip reasons are recorded; actual uncertainty cases
  retain appropriate regression coverage. Update existing architecture/testing
  docs after smoke succeeds and remove throwaway verification scaffolding.

**Handoff:** provide the final conflict/authority matrix, typed entrypoints, exact
removed owners, compatibility exceptions and runtime evidence. Routines, backend
route and extension stages inherit a complete lifecycle service, not a deferred
implementation behind declarations. Parser and other feature stores remain
explicitly unchecked work for later stages.
