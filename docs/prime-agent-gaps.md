# Prime Agent: native TUI/CLI vs pi-dish — gap report

Fact-finding pass over Prime Agent support, 2026-09-10, against **Prime 0.9.4**
and pi-dish `957c6b3`. Companion pages: [prime-agent.md](prime-agent.md)
(verified status) and [TASKS/pi-lineage-harness-support.md](../TASKS/pi-lineage-harness-support.md)
(harness architecture/capability matrix). This page is the detailed
"what Prime can do that pi-dish cannot show or drive" catalogue, with the
evidence and the fix path for each item.

## Method

Three independent evidence sources, cross-checked:

1. **Live lab** (primary, this pass). Isolated HOME (`/tmp/pidish-prime-lab/home`)
   with symlinked prime `auth.json`/`bin`/`extensions`, its own
   `~/.pi/dish` (sessions/sockets/settings with `recoveryMode: off`), a pi-dish
   server from the current checkout on `:3399`, and a fake OpenAI **Responses**
   SSE provider on `:4319`. A Prime session was spawned through
   `POST /api/sessions/new {harness:'prime', model:'openai/gpt-4o-mini'}` into
   the hidden `pi-dish` tmux server, then driven from real Chrome over CDP and
   from the raw HTTP/SSE surface. The Prime TUI itself was driven through
   `tmux send-keys` on the spawned pane. Teardown: session closed through
   pi-dish (pane gone, worker stopped), daemon shut down, lab processes stopped.
2. **Upstream source**: the installed 0.9.4 package
   (`~/.local/lib/node_modules/prime-agent`) — `dist/core/extensions/types.d.ts`,
   `dist/core/agent-session.{d.ts,js}`, `dist/core/session-manager.d.ts`,
   `dist/cli/command-registry.js`, `dist/core/slash-commands.js`, `docs/*.md`.
3. **pi-dish source** at `957c6b3` (file:line refs below), plus the real-binary
   canary `scripts/test-real-lineage-harnesses.js` (its `testPrime()` is
   executable ground truth for spawn/turn/restart/close/resume).

Tags: **[live]** = observed in this pass · **[code]** = traced in source ·
**[INFER]** = reasoned from source, not observed.

---

## 1. Executive summary

Prime is *functionally* attached (prompt/steer/follow-up/abort/rename/model/
thinking/commands/extension-UI/streaming/history/close/restart all work), but
large parts of Prime's product surface are invisible or blocked, and several
"unsupported" flags are **conservative descriptor choices rather than upstream
limits** — Prime 0.9.4's public extension API already exposes compaction, tree
read, tree navigation, reload, queue read/mutate, and the session manager.

Ranked by user impact:

| # | Gap | Class |
|---|---|---|
| 1 | Compaction (`/compact`, badge, send-gate) unavailable though `ctx.compact()` exists | flag flip + events |
| 2 | Session tree read/navigation unavailable though `sessionManager.getTree`/`navigateTree` exist | flag flip + server gate |
| 3 | Queue is invisible/uneditable: `queue_update` always empty, no cancel | capture + server work |
| 4 | New-session + routines model picker cannot list Prime models (`/api/models?harness=prime` 501) | server work |
| 5 | Export/share/deep-links blocked although Prime has an HTML exporter | server gate |
| 6 | Prime's ~37 TUI commands and ~17 CLI subcommands have no pi-dish surface (goal, autonomous, schedule, heartbeat, refine, MCP, package, scoped-models, fork/clone, btw, traces, login, logs, hotkeys…) | product gap |
| 7 | RLM subagents (`session-artifacts/<root>/sub-*`) and the whole artifacts store are invisible | discovery gap |
| 8 | Prime sessions get **no** pi-dish agent skills (`install.sh` links Pi+OMP only) | one-line install fix |
| 9 | `/reload` always 409s though `ctx.reload()` and a reachable pane both exist | server gate |
| 10 | Thinking level `max` unreachable from header dropdown and API | vocabulary fix |
| 11 | Manual/externally launched sessions: no attach to a live worker, uncloseable, tmux-pane view/`Running in` degrade | lifecycle gap |
| 12 | Bulk bounce excludes Prime by construction | server work |
| 13 | Transcript fidelity: `child_usage_attributed`, `bashExecution`, `session_state`/`agent_status`/`label` entries dropped | parser work |
| 14 | UX defects: typed `/tree` opens a modal that 409s; queue strip never renders; terminal button says "pi tmux"; a logged-out Prime client registers as fully controllable | polish |

---

## 2. Corrections to the current docs

Three claims in [prime-agent.md](prime-agent.md) / the README matrix are wrong
or stale as of 0.9.4:

1. **"Spend insights are blind to Prime" — false in practice.** Prime persists a
   fully-populated `usage.cost` per assistant message (pi-ai `calculateCost`).
   [live] A one-turn lab session's JSONL carried
   `{"input":110,"output":34,"cacheRead":10,"cost":{...,"total":3.765e-5}}`;
   `GET /stats` rendered `~$0.000038` with per-component costs, and
   `/api/usage-summary` included the model group and total. `modelCatalog: null`
   means *no catalog estimate and no usage-limits/budget pricing*, not "no
   spend". The doc sentence should be rewritten to "no estimated pricing;
   recorded spend still renders".
2. **"Capability gaps that are upstream-unavailable today" is too strong.**
   Compaction, tree read and tree navigation are *available* in Prime's public
   extension API (`ctx.compact`, `ctx.sessionManager.getTree/getEntries/
   getLeafId/getEntry`, command-context `navigateTree`); the bridge's `false`
   flags are conservative, not forced. Reload likewise (`ctx.reload()`).
   Queue read/cancel are the one genuine public-API gap, but Prime's captured
   `AgentSession` exposes read/mutate and emits `session_action_update`.
3. **"Prime's bridge runs in a daemon worker that does not forward client
   environment" is only true for a pre-existing daemon.** [live] In the managed
   spawn the worker's `/proc/<pid>/environ` carried `PI_DISH_SPAWN_TOKEN`,
   `TMUX`/`TMUX_PANE` and `PI_DISH_URL`, because the daemon was born from
   pi-dish's client. Later clients attaching to that daemon do not re-export
   their env — which is exactly why the token must still ride the wrapper module
   (`wrapperTokenRequired: true`) and why the registry's `$TMUX` stamp is
   reliable only for the daemon's birthing client.

---

## 3. What Prime offers, and what pi-dish exposes

### 3.1 CLI subcommands (`prime-agent --help`, `dist/cli/command-registry.js`)

| Prime CLI | What it does | pi-dish analogue |
|---|---|---|
| `agents` | interactive roster of resident + saved agents, search/open/reply | sidebar session list (partial; no daemon roster semantics) |
| `list [-a] [--json]` | active/idle agent table (`name id status age model messages clients`) | sidebar Active list |
| `attach <agent>` | attach a TUI to a **running** agent | **none** (documented gap 2) |
| `stop <agent>` | daemon-side stop of one root | Close session (owned roots only) |
| `rename <agent> <name>` | stable agent name | rename (live) |
| `send [--from …] [--steer\|--follow-up]` | cross-agent message delivery | prompt/steer/follow-up; peer-session CLI targets pi-dish-known sessions |
| `schedule list\|add\|cancel` | per-agent one-shot/cron prompts | Routines (pi-dish's own scheduler; does not see/author Prime's jobs) |
| `status`, `doctor [--fix]`, `shutdown [--force]` | daemon supervision/repair | Recovery report (different model) |
| `mcp add\|list\|get\|remove` | user MCP servers | **none** |
| `package install\|remove\|list\|update` | capability packages (extensions+skills+prompts+themes) | Skills view covers Pi's catalog only |
| `model list [search]` | human table of models | live session model list via bridge; **no catalog for spawn** |
| `session export <file> [out]` | standalone HTML export | **blocked** (409 for Prime) |
| `update`, `config` | self-update; TUI resource toggles | **none** |

Run flags with no pi-dish surface: `--goal`/`--goal-token-budget`,
`--autonomous*` (gates, retries, max turns/tokens/timeout), `--fork`,
`--no-session`, `--session-dir`, `--tools`/`--no-builtin-tools`, `--skill`,
`--prompt-template`, `--theme`, `--system-prompt`, `--models` cycling,
`--daemon-socket`.

### 3.2 TUI slash commands (37 + 5 aliases, `dist/core/slash-commands.js`)

Prime's built-in interactive commands are deliberately **not** returned by
`pi.getCommands()` (`docs/extensions.md`: "would not execute if sent via
`prompt`"), and are not reachable through any pi-dish route. Live composer
palette for a Prime session [live] = `/abort`, `/thinking`, `/name`, `/model`,
`/dish-push`, plus `skill:*` entries — 4 emulated built-ins out of 37.

| Prime `/cmd` | pi-dish today | Notes |
|---|---|---|
| `/settings` | none | pi-dish has its own settings modal |
| `/model`, `/effort`, `/name` | yes (header badges) | working parity |
| `/compact [instructions]` | **none** | `ctx.compact()` exists; see gap A1 |
| `/tree` | **none** (typed `/tree` errors) | see gap A2/D1 |
| `/reload` | **none** (409) | `ctx.reload()` + reachable pane; gap A5 |
| `/context`, `/session` | partial (stats modal) | TUI shows *agent + subagent* tree |
| `/goal [objective]` | none | OMP has a `goal` hostBuiltin; Prime has none |
| `/autonomous [status\|on\|off]` | none | bare form toggles the mode [live] |
| `/heartbeat`, `/heartbeats`, `/refine`, `/rlm-max-depth` | none | long-running-agent machinery |
| `/schedule` (CLI) | none | parallel to Routines |
| `/mcp …`, `/login`, `/logout` | none | provider/MCP auth |
| `/scoped-models`, `/fast` | none | `/fast` reports in place [live] |
| `/export`, `/import`, `/share` (gist), `/fork`, `/clone`, `/btw` | none | export is 409-blocked |
| `/session`, `/system-prompt`, `/logs`, `/changelog`, `/hotkeys`, `/fullscreen`, `/traces` | none | mostly informational, pane-typable |
| `/new`, `/resume`, `/quit` | yes (new-session takeover / sidebar resume / close) | lifecycle parity |
| `/copy` | partial (message copy) | — |

### 3.3 Live parity (already works — not one-sided)

[live] confirmed end to end on 0.9.4 unless noted: managed spawn in hidden tmux
with token wrapper; registration + socket; SSE streaming
(`turn_start`/`message_update`/`message_end`/`turn_end`/`agent_end`,
`tool_execution_*`, `extension_ui_state`, `queue_update`); prompt/steer/
follow-up; abort; rename; model switch; thinking (6 levels); command discovery;
extension UI (dialogs/widgets/statuses); transcript rendering incl.
`ipython`/`BashResult`; history discovery/index/search/usage-summary/stats;
cost & token readouts from Prime's own JSONL; context %; diff view; file viewer
and 🌐 publish; pages/comments plumbing; terminal shell **and** tmux pane view
(grouped `dish-view-*` session attached to the Prime pane); artifacts button;
Close (**Supervisor stop + pane removal**, other roots survive — canary);
Restart in the same pane (canary, idle and mid-turn); Resume; routines spawn/
auto-close; session-refs/provenance.

---

## 4. Gap catalogue

### A. Capabilities Prime supports but the descriptor disables

**A1 — Compaction.** `extensions/pi-dish-bridge-prime/index.ts` declares
`compact: false`; core gates the handler at `core.ts:1606-1609`, filters the
emulated built-in at `core.ts:2141-2166`, and re-validates at session start
(`core.ts:2339-2341`). Prime has `ctx.compact(options?: {customInstructions,…})`
(`dist/core/extensions/types.d.ts:233-234`) and publishes
`session_before_compact`/`session_compact` (`:409-447`). The bridge has the
generic machinery (`publicCompactionEvents`, `core.ts:2488-2527`) unused for
Prime. [live] `POST /command /compact` → "This session does not support
compaction."; the "Compacting context…" badge and the composer's
hold-while-compacting path can never fire.
*Fix*: add `publicCompactionEvents: true` and `compact: true` to the Prime
descriptor; no `compactArgument` needed (Prime takes `{customInstructions}`).
Client/route work: none beyond the flag (`server.js:3774-3777` already routes).

**A2 — Tree read.** Declared `treeRead: false`, but Prime's
`ctx.sessionManager` is the `ReadonlySessionManager` with
`getTree/getEntries/getLeafId/getEntry` (`dist/core/session-manager.d.ts:154,
206-269`) — exactly the probe at `core.ts:2349-2356`. Server also hard-blocks:
`sessionCapabilities.tree` only grants pi/omp (`server.js:798-802`) and
`GET /tree` 409s (`server.js:3931-3933`).
*Fix*: descriptor flag + widen `server.js:798-802`/`3931` **and** the
OMP-only live-leaf read at `server.js:2656-2661`, or a navigated Prime session
re-renders the abandoned branch after a reload. Transcript leaf selection
starts working with it.

**A3 — Tree navigation.** `navigateTree` exists on Prime's
`ExtensionCommandContext` (`types.d.ts:261-268`) with the same shape the bridge
passes (`core.ts:2289-2293`); `ctx.branch` genuinely does **not** exist on
Prime, so re-edit/branch-summary needs `fork()`/`switchSession()` semantics.
Getting a command context without the user typing requires either
(a) self-priming `s.prompt('/dish-prime')` through the captured AgentSession —
Prime's `prompt()` executes extension commands (`dist/core/agent-session.js:3412-3416,
3990`) — or (b) the server's existing pane fallback. `POST /branch` 409s for
Prime (`server.js:4058-4062`).
*Fix*: wire the `pi-private` capture into the Prime wrapper (it imports the
aliased host `AgentSession`), widen the branch route, keep `branch` documented
as unavailable.

**A4 — Queue read/cancel.** Prime's public extension API exposes only
`hasPendingMessages()` (`types.d.ts:228`) — no queue read, no cancel, no queue
event. The bridge's cancel implementation targets Pi internals that Prime does
not have (`_steeringMessages`/`_followUpMessages`, `core.ts:2034-2100`).
Prime's captured `AgentSession` does expose `getSteeringMessages()`,
`getFollowUpMessages()`, `getSessionActionSnapshot()`,
`mutateQueuedMessage()`, `clearQueuedUserMessagesMatching()` and emits
`session_action_update` (`dist/core/agent-session.d.ts:63,887-904`;
`.js:776-782`).
[live] `queue_update` for Prime is always `{"steering":[],"followUp":[]}`; a
follow-up sent through `/follow-up` during a held turn returned `{queued:false}`
and delivered, and the pi-dish queue strip stayed empty while the TUI footer
showed "Follow-up: … ╰─ Alt+↑ to browse and edit queued messages".
*Fix*: Prime branch in `ensureSessionSubscription`/`mergedQueue`/`cancel_queued`
on the captured session + `session_action_update`. Host-private and
version-sensitive — same risk class as Pi's queue editing.

**A5 — Reload.** `reload` is false in the descriptor (and `selfPrime` is what
gates the `/reload` emulation, `core.ts:1722-1725`), and the server hard-gates
non-pi/omp (`server.js:3671-3674`). Prime has `ctx.reload()` (`types.d.ts:276`)
and a TUI `/reload`; `locatePiPane()` reaches the Prime pane (proven by the
terminal tmux mode in this pass; the registry entry even carries a `tmux`
stamp on managed launches).
*Fix*: widen the server gate for Prime and use the pane path (`/reload` typed
into the TUI) or the capture/self-prime path; mind the draft-append trade-off.

**A6 — `shareSnapshot`.** Unadvertised, though Prime provides
`getSystemPrompt()` + `getActiveTools()`/`getAllTools()` (`types.d.ts:236,
860-866`), i.e. everything the response-details popup needs
(`server.js:3009-3013`).

**A7 — Thinking `max`.** Prime's vocabulary is
`off|minimal|low|medium|high|xhigh|max`; the bridge validates against
`THINKING_LEVELS` (`core.ts:165,1713,2208`), and the client's
`thinkingLevelsFor` returns pi's 6 levels for non-OMP (`helpers.js:1924-1928`),
though `OMP_THINKING_LEVEL_NAMES` at `helpers.js:1915` already includes `max`.
[live] `POST /thinking {level:'max'}` → 400 "level must be one of: off, minimal,
low, medium, high, xhigh"; the new-session select *does* offer Max (a
consistency bug on its own). Also `resume --thinking` is refused for Prime
(`server.js:6035-6036`).

### B. Missing product surfaces

**B1 — Model catalog for spawn.** `modelCatalog: null` ⇒
`GET /api/models?harness=prime` → 501 (`server.js:4585`) [live]; the takeover's
model select stays at `(default)` with no explanation [live], and the routines
editor's model list is empty. `argv.models = ['model','list']` is unusable as-is:
`runHarnessJsonCommand` needs JSON and Prime prints a human table.
*Fix options*: parse `prime-agent model list`'s table; read
`~/.prime/agent/models.json` + registry store; or source the catalog from a
live session's bridge `get_available_models` and cache it. Prime's
`settings.json` also holds `defaultModel`/`defaultThinkingLevel`.

**B2 — Export / share / deep links.** `export: pi || harnessId === 'omp'`
(`server.js:803`); `/export` 409 (`server.js:3038`); `POST /share` 409
(`server.js:3142`); the header Export button, the stats-modal share section and
per-message 🔗 are all hidden. Prime ships `prime-agent session export <file>`
and RPC `export_html`. Prime JSONL is Pi-v3 shaped, so a profile-driven export
is plausible.
*Fix*: harness export adapter (CLI export or the bundled SDK) + capability
flag; verify the produced HTML keeps pi-dish's comment/deep-link injection.

**B3 — Prime TUI commands via the host-builtin path.** The mechanism is
descriptor-driven and already generic (`hostBuiltins` in `lib/harnesses.js:83+`,
`appendHostBuiltins` `server.js:4651-4678`, `parseHostBuiltin`/
`runHostBuiltin` `server.js:3688-3755`), gated on a *reachable* pane. Prime's
descriptor has no `hostBuiltins`. [live] probed candidates in a real 0.9.4 TUI:
in-place/non-interactive — `/context`, `/session`, `/system-prompt`, `/fast`,
`/mcp list`, `/heartbeat status`, `/autonomous status|on|off`; overlay-opening
(do not list without an arg model) — `/model`, `/settings`, `/tree`,
`/scoped-models`, `/resume`; **hazards** — bare `/goal` left text in the
composer (next keystrokes concatenate, the same class as the documented
`/reload` trade-off, `server.js:3728-3732`), and while a turn is running any
typed command became a **steering message to the model** ("Steering: /goal
status") rather than executing. Any Prime `hostBuiltins` must therefore be
allowlisted to the verified in-place forms and ideally refused while
`turnInProgress`.
*Fix*: add a curated `hostBuiltins` array to the Prime descriptor mirroring
OMP's (`allowedArgs`/`requireArgs`/`blockedArgs`) and reject when busy.

**B4 — Settings / model roles / scoped models.** `/api/harnesses/prime/config`
and model-roles are 501/Pi-only (`server.js:4365-4376,4394-4396`); the harness
badge is correctly non-clickable (`pilotConfig: false`). Nothing reads
`~/.prime/agent/settings.json` (`defaultModel`, `defaultThinkingLevel`,
`enabledModels`, `theme`, `steeringMode`, compaction/retry knobs) or
`keybindings.json`.
*Fix*: a Prime "harness settings" surface reading/writing that file (careful:
`prime-agent config` is interactive, so pi-dish would edit JSON directly).

**B5 — RLM subagents + session-artifacts.** Prime stores children under
`session-artifacts/<parentSessionId>/sub-<id8>/<sessionId>.jsonl` and folds
their usage into `child_usage_attributed`; discovery is `layout: 'flat'`
(`lib/harnesses.js:163`) so only `sessions/*.jsonl` is read, and
`liveSubsessionCandidates` needs `nestedSubsessions` + an exit marker Prime
does not have (`server.js:1511-1521`). [live] the artifacts dir exists per
session. Result: a Prime fan-out is invisible in the sidebar/related chips;
`/context`'s child tree has no equivalent.

**B6 — Scheduler / heartbeat / goal / autonomous / refine / traces.**
pi-dish's Routines are a separate subsystem (`lib/routines.js`) that never
reads Prime's `session-artifacts/<id>/scheduled-jobs.json`; Prime's
`/goal`, `/autonomous`, `/heartbeat`, `/refine`, `/rlm-max-depth`, `/traces`
have no surface at all (OMP at least has `goal`/`guided-goal` hostBuiltins).

**B7 — MCP / packages.** `prime-agent mcp …` and `package …` (extensions,
skills, prompts, themes, global/project scope) have no pi-dish UI; Prime's MCP
servers are exposed to the model as Python-backed skills, so they are also
invisible in the Skills view.

**B8 — Bulk bounce.** `captureBounceAuthority` returns null for
`owned-agent`/`unsupported` (`server.js:6510-6516`), so Prime rows render but
can never be selected. Restart already proves the supervisor path, so a bounce
implementation is an extension of existing code, not a new capability.

**B9 — Recovery continuation.** Restore/observation work for Prime; the
continuation path refuses anything outside pi/omp
(`lib/recovery-runner.js:148`, `server.js:6291-6295`), and recovery
model/thinking overrides are suppressed (`server.js:6281-6282`). So
`recoveryMode: 'continue'` silently degrades to restore for Prime. Related:
the bridge advertises `waitsForSettled: false` (Prime has no `agent_settled`),
so completion stays heuristic.

**B10 — Agent skills are not installed into Prime.** `install.sh:85-93` links
`skills/*` into the Pi and OMP agent dirs only. Prime's user skill dir is
`~/.prime/agent/skills` (empty here). Inside a Prime session there is therefore
no `pi-dish-sessions`/`pi-dish-pages`/`pi-dish-comments` CLI — pi-dish's own
agent-facing features are dead in Prime sessions (the *skills view* also only
inventories Pi's catalog).

### C. Transcript / data fidelity

**C1 — `child_usage_attributed` ignored.** Prime folds RLM child usage into
this entry; pi-dish's parsers sum only assistant messages
(`lib/session-files.js:612-660,701-757`), so any Prime session with children
under-reports tokens and dollars with no child row.
**C2 — `bashExecution` messages dropped.** User `!`/`!!` shell entries
(`{role:'bashExecution',command,output,exitCode,…}`) are persisted by Prime but
fall through the client's role dispatch to `return ''`
(`public/app.js:7049-7050`) and are not in search text
(`searchTextFromEntries`) — invisible and unfindable. Affects the whole Pi
lineage, not just Prime.
**C3 — Bookkeeping entries have no surface.** `session_state`
(active/archived/crash), `agent_status` (Prime's agents-view recap/needs-input),
`git_state`, `label`, `thinking_level_change` history, `service_tier_change`
and Prime's `custom_message` types (`session_slash_command*`,
`heartbeat_prompt`, `rlm_child_*`, `compaction_outcome`, `refinement_outcome`)
are ignored or rendered with generic labels.
**C4 — `prime-v1` is never branched on.** Correct today (Prime is Pi-v3
shaped: `model_change{provider,modelId}`, pi-ai messages, `usage.cost`), but
worth an explicit profile hook if any of C1-C3 are fixed, so drift is caught by
profile rather than by accident.

### D. UX defects and hazards (observed live)

**D1 — Typed `/tree` is a broken affordance.** `sendPrompt` intercepts `/tree`
unconditionally (`public/app.js:8763`) and the modal fetches without a
capability check; a Prime user gets the Session Tree modal plus a raw
`Failed to load tree: {"error":"Session tree reads are not supported for this
harness."}` in the status bar [live]. The mobile tree row is correctly hidden.
*Fix*: gate the interception on `sessionSupports(session,'tree')`, or decode
the 409 into a capability message.

**D2 — Queue strip is permanently empty** (A4) while the TUI shows queued
messages; no way to cancel a follow-up sent from pi-dish except in the TUI.

**D3 — Terminal mode button says "⇆ pi tmux"** for a Prime session
(`public/app.js` label) and, for a session launched outside pi-dish, pane
lookup can fail (the registry pid is the daemon worker). With a pi-dish-managed
spawn it works [live: grouped `dish-view-*` attached to the Prime pane].

**D4 — A logged-out Prime client registers as fully controllable.** [live] A
model-less spawn sat at Prime's "Press Enter to login with Prime Intellect"
screen; the bridge registered a live row with `prompt:true`, then its socket
disappeared, and Close answered 409 "no single unambiguous live bridge instance
to close" while the pane remained (manual `tmux kill-session` needed). pi-dish
should either surface "not signed in / bridge gone" or refuse the row.

**D5 — Slash-palette/`supported` asymmetry (latent).** The server pre-filters
`filterBridgeCommands` (`server.js:4643-4650`) but the client autocomplete
ignores `cmd.supported` — any future host passthrough would offer commands that
fail at `/command`.

**D6 — `resume --model` is refused for Prime** (`server.js:6124-6127`) even
though the descriptor's resume argv accepts `--model` and Restart already passes
one (`server.js:6470`).

---

## 5. Suggested closing plan

**P0 — flag flips that unlock whole features (in-bridge; small):**
A1 compact (+`publicCompactionEvents`), A2 treeRead, A6 shareSnapshot, A7
thinking `max` (`thinkingLevels` on the descriptor + `helpers.js:1924`), and
the server gates they need (A2/A3 tree, A5 reload, B2 export). Verify against
the real canary afterwards (`npm run test:lineage -- prime`).

**P1 — server/one-liners with immediate user value:**
B10 install skills into `~/.prime/agent/skills` (biggest win per line);
B1 model catalog for spawn/routines; B3 curated Prime `hostBuiltins` (verified
in-place forms only, refuse while busy); D1 `/tree` gate; D6 resume
model/thinking allowlist; D3 terminal label; D4 logged-out/unregistered row
handling; B9 document recovery-continuation limits.

**P2 — real work, needs design:**
A4 queue read/cancel via the captured AgentSession; A3 navigateTree/branch;
B5 RLM child discovery + `child_usage_attributed`; B4 Prime settings/model
scoping surface; B6 schedule/heartbeat/goal/autonomous/refine surfacing (decide
whether pi-dish mirrors Prime's scheduler or exposes Prime's own);
B8 bounce; C1-C3 transcript fidelity.

**Deliberately not worth doing without upstream movement:** Prime RPC as a
second transport (`rpcFallback: false` is a lifecycle choice; the daemon's
session lease rejects a second opener of the same JSONL), and native
todos/plan-mode projections (no public extension surface at all).

---

## 6. Evidence appendix

Lab (all cleaned up after the pass):

```
HOME=/tmp/pidish-prime-lab/home        # prime auth/extensions symlinked, own sessions+sockets
node server.js                         # current checkout, PORT=3399, PI_DISH_TERMINAL=1
node fake-openai.js                    # Responses SSE on :4319 (text + optional hold)
POST /api/sessions/new {harness:'prime', model:'openai/gpt-4o-mini', cwd:…}
```

Representative live observations:

| Probe | Result |
|---|---|
| `GET /api/sessions?active=1` (prime row) | `prompt/steer/followUp/abort/models/setModel/setThinking/rename/commands=true`, `compact/queueCancel/tree/export=false`, `close/restart=true` |
| `GET /api/models?harness=prime` | 501 "New-session model discovery is not supported for Prime Agent." |
| `GET /api/models?sessionId=<prime>` | 200, the full openai catalog (bridge `get_available_models`) |
| `GET /api/commands?sessionId=<prime>` | 4 emulated builtins + `/dish-push` + `skill:*` (11 Prime skills); no TUI commands |
| `POST /command` `/compact` `/goal …` `/settings` `/login` `/agents` `/schedule` | "does not support compaction" / "unknown or unsupported command" |
| `GET /tree` and typed `/tree` | 409 → modal + raw JSON error string |
| `POST /thinking {max}` | 400 listing only off…xhigh |
| `GET /stats` after one turn | tokens in/out 110/34, cache 10, `cost ~$0.000038` from Prime's JSONL |
| SSE during a held turn | single `queue_update` with `{"steering":[],"followUp":[]}`; follow-up → `{queued:false}`, strip empty |
| `POST /close` (owned root) | `{"success":true}`; pane removed; `prime-agent list` → "No active agents." |
| Worker `/proc/<pid>/environ` (managed launch) | `PI_DISH_SPAWN_TOKEN`, `TMUX`, `TMUX_PANE`, `PI_DISH_URL` present |
| Pane-typed commands (idle) | `/context`, `/session`, `/system-prompt`, `/fast`, `/mcp list`, `/heartbeat status`, `/autonomous …` execute in place; while busy they queue as **steering to the model**; bare `/goal` leaves composer text |
