# Session lifecycle migration

Status: **Implemented and locally verified; implementation review pending** (2026-09-15).
Stage 3 follows [browser contract cleanup](browser-contract-cleanup.md)
and [shared runtime helpers](shared-runtime-helpers.md).

Plan review: **APPROVED** by Anthropic Fable 5.1 at high effort for the clarified
plan at `9dee6d3`; [signoff and observation resolutions](../BACKLOG.md#next-stage-plan-review).
Plan approval is separate from the implementation review and delivery record below.

Planning baseline includes `6e8df16` and `e816d36`: recursive family discovery,
Prime RLM artifacts and subagent trace/signaling are existing consumers to preserve.

## Implementation freeze

The helper destinations are fixed at `src/core/helper-{content,format,identity,models,query,refs,markdown,types,values}.ts`.
The dependency wave keeps existing CommonJS exports and persistence versions.
`session-recovery.ts` owns `RecoveryRecord`, `RecoveryControl`, `RecoveryAttempt`,
`RecoverySnapshot` and `RecoveryObserver`; observation writers cannot write controls.
Record harness/native IDs remain persisted strings until the existing route decoder
validates them. Arbitrary legacy attempt fields survive round trips; consumed launch/
delivery uncertainty must be narrowed without turning malformed evidence into permission.
`tmux.ts` owns `SpawnPlacement`, `PaneProcessState` and exact-process cleanup errors;
`prime-lifecycle.ts` owns the proved supervisor target and stop-dispatched errors.
Both consume the existing `ProcessIdentity`, never a replacement identity brand.
Runtime errors preserve `remainingProcesses` and `stopRequested` for the subsequent
checked launch/operation outcome conversion. The integration owner handled server
composition, RPC, shared contracts and generated files after each settled wave.

The checked owners are `session-ownership.ts`, `session-launch.ts` and
`session-operations.ts`. Ownership separates exact RPC objects, logical Pi claim/
birth proof, owned-pane proof, and Prime worker/roster proof from weak runtime
location. Launch owns descriptor-based wrappers, registration and bounded cleanup;
operations own route close/restart flights, canonical-file resume flights and
quarantines. Recovery/Bounce runners retain their distinct report/reservation state.
Source lookup uses the existing `SessionSourceResolver` and captured live source
observations; registry/descriptor/process lookups are checked dependencies.
Catalog/subsession/model/settings inputs are read observations, not callbacks
allowed to choose fallback, destructive mode, admission or recovery safety.
Async preparation returns a synchronous final checker where the current action
requires it; it is not a permanently reusable authorization.
`harnesses.ts` resolves from generated `lib/` and remains the sole owner of wrapper/
bridge paths and literal host-package imports.

### Frozen arrival-order matrix

`C` = fresh create, `R` = resume, `L` = explicit close, `T` = restart,
`V` = recovery, `B` = Bounce, `U` = routine invocation. Rows describe both orders
on the same target, not a proposed symmetric mutex. Different new-session files
do not acquire a historical-file lock. Runner-to-operation rows inherit the
corresponding core row at the moment the runner actually invokes that operation.

| Pair | Left arrives first | Right arrives first |
| --- | --- | --- |
| C / C | Independent new files; hidden target creation alone serializes. | Same. |
| C / R | No file reservation before create registers; resume uses observed active/file state. | Create still allocates a new session, not a second resume of R's file. |
| C / L | Close can act only after a runtime becomes discoverable; it does not cancel provisional creation. | Closing an old identity does not block fresh creation. |
| C / T | Restart needs an existing RPC or owned placement; provisional creation is not authority. | Fresh creation is independent of restart's historical file. |
| R / R | Canonical real file joins the first promise/target; joiner rechecks active runtime. | Same, with the other caller becoming leader. |
| R / L | Close has no resume-map admission check; resume checks close immediately before launch. A close that finishes during validation does not reserve the future launch. | Resume may return already-active while close is running; if inactive, its final launch check refuses a still-running close. |
| R / T | Restart refuses a resume flight only when its currently observed active file identifies that flight; otherwise existing active/proof checks decide. | Resume checks restart before source lookup and again before launch. |
| L / L | Canonical route joins the first close promise. | Same. |
| L / T | Restart refuses the close flight. | Close refuses the restart flight. |
| T / T | Second restart refuses; it does not join. | Same. |
| C / V | Recovery probes live identity/file, otherwise uses guarded R; fresh C is not a recovery reservation. | C remains a fresh-file operation; V owns only its saved target. |
| R / V | V's restore joins R by canonical file and rechecks observation/control/live state before any continuation. | Ordinary R may join V's restore; V's route flight is not a general operation lock. |
| L / V | V observes persisted closed intent and cannot launch/deliver while excluded/closed. | L persists closed intent; V rechecks controls after handshake and before continuation. |
| T / V | V's R inherits restart refusal; live probing must match the saved file. | T inherits the R/T rules if V is restoring; no runner-wide restart mutex is invented. |
| V / V | Per-route recovery flight joins; startup snapshot starts once. | Same; explicit retry remains restore-only. |
| C / B | Waiting B reserves only its captured target; C creates a different identity. | C does not consume B's waiting reservation. |
| R / B | B captures/inspects current ownership; its eventual restart inherits R/T. | Waiting B does not block R; executing B excludes non-GET HTTP actions, while direct callers retain existing operation rules. |
| L / B | A stopped/replaced captured target is skipped/refused at B's fresh checks. | Waiting B does not block L; executing HTTP exclusion and direct-call L/T rules remain distinct. |
| T / B | Captured identity changes or existing T refusal prevents B from acting on its replacement. | Waiting B does not block T; B execution delegates T or guarded reload with final checks. |
| V / B | V's live/restore and B's captures retain their own checks; no shared runner mutex. | Waiting B does not exclude V; executing live lookup/action rules and control/identity rechecks remain in force. |
| B / B | Waiting target reservation refuses duplicate queued targets; execution flight deduplicates runner work. | Same; cancel affects waiting targets only. |
| C / U | U chooses existing live/resume/fresh behavior; its fresh C is independent. | C does not consult the routine ledger's busy policy. |
| R / U | U's R joins by canonical file; failed resume retains its existing fresh-create fallback. | External R can join U's R but does not consume a routine invocation slot. |
| L / U | U inherits close/resume behavior and its one-shot close records refusal without escalation. | External L uses the same guarded close; U's observation/ledger policy stays in the runner. |
| T / U | U's R inherits restart refusal and existing fresh fallback; external T does not acquire routine busy state. | T uses the same active/proof checks against U's runtime. |
| V / U | Startup awaits recovery, then reconciles invocations, then starts routine scheduling. | A direct running invocation is not globally locked by V; ordinary operation and control guards apply. |
| B / U | U's HTTP actions respect executing B; direct lifecycle calls retain their operation rules. | Waiting B does not reserve the routine ledger; activity/identity changes block B at inspection/action. |
| U / U | Same-routine busy skip/steer/follow-up and ledger policy remain unchanged; different routines are independent. | Same. |

Acquisition/release: R installs its file promise before asynchronous quarantine,
model validation and launch; releases only its own promise in `finally`. L installs
its route promise before persisting closed intent and proving/stopping; rollback
restores prior intent unless stop dispatch is uncertain. T installs its route set
entry after admission and removes it in `finally`, preserving open intent across
stop/replacement. Hidden spawning has its own promise chain and server-lifetime
broken flag. Failed cleanup/explicit or detached-worker uncertainty outlive flight
release; only the existing matching active-file or proved-cleanup rules clear them.
V writes launch/delivery intent before effects, with boot identity and saved-byte
checkpoint checks. B's execution lock spans its async inspection and final action;
report DTOs never expose executable authority.

Public results stay unchanged: close/restart return status/body with `stopped` and
replacement-readiness distinctions; resume/create throw status-bearing errors.
Checked internal outcomes must distinguish no action, stopped, stop uncertain,
cleanup failed and replacement-not-ready before HTTP mapping. Registry refresh,
live hello, process birth/pane checks and optional synchronous final checks remain
adjacent to the actual destructive action, not just to initial capture.

Baseline evidence before lifecycle edits: isolated real OMP 18.1.21 passed streamed
persisted turn, tree capability, owned close, same-route resume and ephemeral BTW
(2 fake-provider requests). Prime 0.9.4 passed worker/client separation, same-pane
and busy restart, busy/idle close, same-route resume, peer-root survival, manual
close refusal and close after client exit (8 requests). Commands used the explicit
absolute binaries named in the verification section, temporary HOME/tmux/socket
roots and a private Prime supervisor. No live provider/session credentials.
Full backend suite at the shared-helper checkpoint: 984 passed, zero skipped.
Per-poll registry/proof counts and recovery-read byte counts were not instrumented;
existing bounded algorithms and focused suites are the baseline for those paths.
No unexplored arrival-order race is claimed fixed by this extraction.


## Implementation and verification record

All eight implementation tasks are complete. The frozen matrix above remains the
behavioral contract; the migration does not introduce a global lifecycle mutex.

| Checked owner | Implemented responsibility and removed owner |
| --- | --- |
| `session-recovery.ts` | Actual observation/control persistence, checkpointing and observer transitions replace authored `lib/session-recovery.js`; RPC imports the real observer contract instead of a handwritten require signature. |
| `tmux.ts`, `prime-lifecycle.ts` | Actual placement/process-tree operations and supervisor protocol replace their authored JS implementations. |
| `session-ownership.ts` | Live transport/source lookup, weak runtime location, claim/process captures, action-time revalidation, saved recovery validation and switch adoption replace server-owned proof/read helpers. |
| `session-launch.ts` | Descriptor-owned argv/env/wrappers, token registration and hello proof, final deadline check, cleanup, hidden spawn chain/broken state and backend dispatch replace the server launch machinery. |
| `session-operations.ts` | Create/naming, async spawn status/provenance, canonical-file resume, close intent, restart transitions, distinct flights and quarantine replace server lifecycle closures and maps. |
| `recovery-runner.ts` | The actual runner and `createRecoveryRuntime` own restore/process-proof persistence and continuation delivery; no server recovery-safety callbacks remain. |
| `session-bounces.ts` | The actual queue and `createSessionBounceRuntime` own idle/activity/descendant checks, execution exclusion and guarded-reload completion; no server Bounce inspection/execution callbacks remain. |

`server.js` constructs one ownership/launch/operation set and supplies only raw
catalog/model/settings/transcript observations or presentation/persistence hooks.
HTTP handlers decode requests and map results. Routines receive the coordinator's
create/resume/close methods directly; routine scheduling, prompt composition,
ledger logic and its JS source remain outside this stage. Its generated-contract
JSDoc documents that boundary, not compiler coverage of the runner.

The existing isolated runner/queue factories remain real checked algorithms.
Their production factories implement the former server policy and compose those
algorithms; they are not declaration adapters or optional compatibility branches.
Generated CommonJS and declarations preserve the original five runtime module paths
and add the three ownership/launch/operation paths. Extension imports continue to
resolve `../../lib/session-recovery.js`.

Launch outcomes explicitly distinguish ready, fallback-permitted,
fallback-forbidden, cleanup-incomplete, explicit-pane uncertainty, detached-worker
uncertainty and interruption. Operations retain no-action, stopped,
stop-uncertain, cleanup-failed and replacement-not-ready before HTTP mapping.
`LifecycleInterruption` retains its exact instance across action layers.
Required-file descriptor calls return string-only argv without scanning/copying
arguments; the legacy empty-options builder still returns its original shape.
Negative declaration fixtures reject advice/report-as-authority, missing cleanup
or stop evidence, observer/control mixing and assumed validated legacy evidence.

### Local verification

| Check | Observed result |
| --- | --- |
| `npm run build:core` and `npm run check` | Passed; core/browser output drift and all type fixtures checked. |
| Focused lifecycle suites | 304 passed, zero skipped, including the new malformed-evidence and production Bounce race/reload cases. Routine suites also ran in the full backend gate below. |
| `npm test` | 995 passed, zero skipped, including real Pi bridge integration and routine/API coverage. |
| `npm run test:browser` | 286 passed. |
| `npm run test:ui:scenarios` | All eight independent scenarios passed. |
| `npm run test:ui` | Complete desktop/mobile, multi-host, routine/Bounce, restart/close and retained-transcript smoke passed. |
| `npm run test:lineage -- omp` | OMP 18.1.21: streamed persisted turn, live/inactive tree gates, owned close, same-route resume, history read and BTW; two fake-provider requests. |
| `npm run test:lineage -- prime` | Prime 0.9.4: retained wrapper token, worker/client separation, busy/idle root close, same-pane and busy restart, persisted replacement/resume turns, peer-root survival, client-exit close and manual-close refusal; eight fake-provider requests. |
| Extension-relative observer gate | Isolated Node `createRequire` anchored at the bridge loaded all eight exports and exercised store/observer controls; the narrow generated-declaration consumer compiled, including its negative control patch. |
| Independent implementation reviews | Dependency, ownership, launch, coordinator, recovery and Bounce reviews completed; introduced dependency/legacy-PID regressions were fixed and their reproductions passed. Final four launch/operation/runner reviews reported no findings. |

The real harness commands used `/home/jyarwood/.local/bin/omp`,
`/home/jyarwood/.local/bin/prime-agent` and OMP's
`PI_DISH_REAL_BUN_BIN_DIR=/home/jyarwood/.bun/bin`. Fixtures isolated HOME,
provider configuration, sockets, tmux and Prime's supervisor; no live sessions or
provider credentials were borrowed. Temporary observer/import smoke files and
homes were removed; maintained fixture scripts own their teardown.

### Preserved limits and delivery

The matrix was reviewed against the original implementation and exercised through
the existing overlap/ownership suites, new race regressions and real runtime
canaries. It is not a claim of 56 independently instrumented whole-program races.
Registry/proof call counts and recovery-read bytes were not instrumented, so no
numeric performance improvement or stronger race guarantee is claimed.

Legacy unclassified Pi launch errors still permit headless RPC fallback.
Quarantine remains context-specific: explicit resume/restart retains placement
uncertainty, while hidden resume retains incomplete cleanup. Existing action-time
limits remain: owned-pane/logical close do not consume an optional Bounce guard,
and low-level pane lookup/birth checks do not make all intervening awaits atomic.
This is an ownership/type migration, not an unreviewed change to those policies.

The implementation's Fable 5.1 high-effort review and exact pushed-commit CI
result are recorded after their respective delivery gates.

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

- [x] Five authored JS modules have checked implementations and generated compatible
  `lib/` outputs; RPC's recovery adapter/local interface are gone. Runtime extension
  imports still resolve and retained Prime wrapper paths remain usable.
- [x] Server proof predicates, launch/fallback/registration loops, operation flights,
  quarantines and recovery/Bounce policies are removed in favor of their typed
  owners; retained HTTP glue is named explicitly. Multiple necessary keyed maps
  inside the owner are not an unfinished migration.
- [x] Every API, routine, recovery, Bounce and runtime-location consumer uses the new
  contracts. No obsolete alias, duplicate policy or unchecked helper require
  signature survives; Stage 2's supported `public/helpers.js` compatibility export
  remains supported, not imported back into internal lifecycle code.
- [x] Public status/error bodies, capabilities, persistence versions, prompt behavior,
  close-intent semantics and runtime placement remain compatible. Unproved races
  are reported separately, never advertised as fixes or hidden in extraction.
- [x] Verification evidence and skip reasons are recorded; actual uncertainty cases
  retain appropriate regression coverage. Update existing architecture/testing
  docs after smoke succeeds and remove throwaway verification scaffolding.

**Handoff:** provide the final conflict/authority matrix, typed entrypoints, exact
removed owners, compatibility exceptions and runtime evidence. Routines, backend
route and extension stages inherit a complete lifecycle service, not a deferred
implementation behind declarations. Parser and other feature stores remain
explicitly unchecked work for later stages.
