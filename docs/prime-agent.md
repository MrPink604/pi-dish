# Prime Agent support status

Prime Agent (`prime-agent`, Prime Intellect's Pi-lineage CLI) is supported
through the shared public-extension bridge. This page records what coverage
was verified against real releases and which gaps remain. For the harness
architecture and capability matrix, see
[TASKS/pi-lineage-harness-support.md](../TASKS/pi-lineage-harness-support.md)
and the [alternative-harness section](../README.md#oh-my-pi-and-prime-agent)
of the README.

## Verified against real releases

Live coverage was exercised end-to-end (spawn → stream → control → resume)
against Prime 0.9.4 on 2026-09-09, and the lineage canary
(`npm run test:lineage -- prime`) additionally proves registration, command
and model discovery, streamed turns, token-wrapper claims, the
worker/client PID split, isolated-daemon cleanup, managed resume with a second
persisted turn, and discovery registration from a manually started TUI.
Close coverage on 2026-09-10 additionally verifies idle/busy root shutdown,
another root surviving and answering on the same daemon, close after the
client pane exits, and refusal to close a manual session.
Restart coverage on the same release verifies idle and busy worker replacement
in the original tmux pane, fresh wrapper ownership, preserved history,
post-restart streamed turns, and another root surviving and answering.

What works today, live:

- Managed launch in tmux with a generated token wrapper; manual TUIs
  discovery-load the installer-linked bridge.
- Prompts, steering, follow-ups, abort (partial message persists with an
  abort marker), rename, model switch, thinking level.
- SSE streaming: `turn_start`, incremental `message_update`, `message_end`,
  `tool_execution_*`, `queue_update`, `turn_end`, `agent_end`.
- Flat-layout history under `~/.prime/agent/sessions/` with Prime's
  bookkeeping entries (`service_tier_change`, `session_state`, …) ignored.
- Close pi-dish-owned root agents and their children through the supervisor,
  then remove the verified client pane without stopping other roots or the
  shared daemon. A missing client pane does not prevent owned-worker close.
  The transcript stays resumable; manual sessions remain uncloseable.
- Restart a pi-dish-owned root in the same live client pane. Stop the root and
  its children, wait for worker exit, then resume the root with a fresh wrapper
  token. Other roots keep running; child agents are not automatically resumed.
- ipython tool calls and `BashResult(...)` results render as code/command
  output in the web transcript and the CLI read path.

## Outstanding gaps

Roughly in experiential impact order:

1. **Bulk Bounce remains unavailable.** Direct Restart works for owned roots
   with a live client pane; Prime remains excluded from bulk maintenance's
   idle-safety checks.
2. **Resume is refused while the worker lives** (`alreadyActive`). A session
   whose client pane died keeps accepting prompts headless, but pi-dish
   cannot attach a fresh client TUI to that worker; `prime-agent --resume`
   in a terminal remains the attach path. Owned workers can instead be closed
   and resumed from Dish.
3. **Manual discovery depends on how the daemon was born.** Prime snapshots
   extension configuration from the client that starts a daemon. A daemon
   born from a plain interactive launch discovery-loads the bridge for every
   session (verified); one born from a pi-dish managed launch does not give
   later manually started sessions the discovered bridge — those sessions
   stay unregistered (verified on 0.9.4; a manual client can still attach to
   the already-registered resident session). Isolating pi-dish launches on a
   dedicated `--daemon-socket` would keep user daemons pristine at the cost
   of cross-daemon attachment; a candidate follow-up, not implemented.
4. **No estimated pricing for Prime.** `modelCatalog` is `null` for the
   harness, so there is no catalog cost estimate, no usage-limits/budget
   coverage, and `GET /api/models?harness=prime` is a 501 (the new-session and
   routines model pickers are empty). Recorded spend does render: Prime writes
   a populated `usage.cost` per assistant message, which the shared parser
   consumes for `/stats` and the usage view.
5. **Capabilities disabled by the descriptor, not by upstream.** Compaction
   (`ctx.compact`), tree read (`sessionManager.getTree`) and tree navigation
   (`ExtensionCommandContext.navigateTree`) exist in Prime 0.9.4's public
   extension API; reload (`ctx.reload`) does too. Queue read/cancel is the one
   genuine public-API gap, but Prime's captured `AgentSession` exposes
   read/mutate. HTML export/sharing is blocked by server gates although Prime
   ships its own exporter. Prime's `session-artifacts/` store has no pi-dish
   surface either.
6. **Agent skills are not linked into Prime.** `install.sh` links the bundled
   skills into Pi and OMP only, so a Prime session has no pi-dish CLI.
7. **Prime's own product surface has no pi-dish UI.** ~37 TUI slash commands
   and ~17 CLI subcommands (goal, autonomous, schedule, heartbeat, refine,
   MCP, package, scoped-models, fork/clone, `/context`'s agent tree, …) are
   unreachable from the web.
8. **First-run kernel bootstrap.** Prime's only built-in tool (`ipython`)
   needs a uv-managed Python runtime. `install.sh` now installs uv when the
   Prime CLI is present, but the kernel still downloads Python packages on
   first tool use — an offline fresh host will fail tool calls with Prime's
   own setup error until bootstrap succeeds once with network access.
9. **Minor UI corners.** Tool-call ordering in the CLI markdown can interleave
   a mid-turn steer after the tool result it preceded.

[prime-agent-gaps.md](prime-agent-gaps.md) carries the full
TUI-vs-pi-dish catalogue behind items 4–8 — every gap with its evidence and
the concrete fix path.

## Version pin

The compatibility canary is pinned to Prime 0.9.4 (see
[docs/testing.md](testing.md)). Close and Restart use daemon protocol 7 and Linux process
birth identities. The server reads only the worker's non-secret internal
supervisor-socket and root-id environment fields, then checks the live roster
against its launch token and socket-proved bridge claim. Missing metadata,
unknown protocols, mismatched roots and replaced panes fail closed. No daemon
shutdown, raw worker signal, or retry after an indeterminate stop is used.
Recovery keeps closed intent after a stop was sent, even if acknowledgement
or client cleanup fails. Restart preserves open intent and never launches a
replacement after an indeterminate stop. A failed replacement registration
leaves the client pane for inspection and quarantines automatic resume retries
in the running Dish server, even if the client subsequently exits: a missing
client alone cannot prove a detached worker stopped. Run new Prime releases through
`npm run test:lineage -- prime` before trusting these version-specific fields.
