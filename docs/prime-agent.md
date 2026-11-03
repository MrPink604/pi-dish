# Prime Agent support status

Prime Agent (`prime-agent`, Prime Intellect's Pi-lineage CLI) is supported
through Prime's resident daemon. Prime 0.10 is a native Rust binary with no
TypeScript extension loader, so pi-dish no longer installs a Prime bridge:
it is one more client of the same daemon that `prime-agent attach` talks to.
This page records the design, verified coverage, and remaining gaps. For the
harness architecture and capability matrix, see
[TASKS/pi-lineage-harness-support.md](../TASKS/pi-lineage-harness-support.md)
and the [alternative-harness section](../README.md#oh-my-pi-and-prime-agent)
of the README.

## Root cause

Prime 0.9.4 loaded pi-compatible TypeScript extensions. pi-dish shipped
`extensions/pi-dish-bridge-prime/`, linked it into
`~/.prime/agent/extensions/`, and managed launches passed a generated token
wrapper via `--extension`. Prime 0.10 removed the extension loader entirely:

- `prime-agent --extension …` exits with "Unknown option".
- `~/.prime/agent/extensions/*.ts` are never loaded, by clients or workers.
- The bridge's registry claims, spawn tokens, `/proc/<worker>/environ`
  supervisor discovery, and extension UI surface all disappear with it.

The observable failure was `POST /api/sessions/new {harness:'prime'}`:
"Prime Agent did not register within 30s — the tmux window was closed",
because the pane's `prime-agent --extension …` exited immediately.

## Chosen design: daemon client

Prime keeps a per-user resident daemon and every client — the TUI, `attach`,
`list`, `send` — is a thin client of it. pi-dish does the same.

- Transport: `prime-agent.daemon` protocol 7 over the daemon Unix socket:
  a `daemon_hello` on connect, then LF-delimited JSON
  `{type:'command', id, protocol, clientId, command}` requests and
  `{type:'response', id, command, success, data|error}` replies.
- Socket resolution (`primeDaemonSocket()`): `--daemon-socket` in
  `PI_DISH_PRIME_COMMAND`, then `PRIME_AGENT_DAEMON_SOCKET` (command
  assignment, then server env), then the Rust launcher default
  `${TMPDIR:-/tmp}/prime-agent-rust-<uid>/daemon.sock`.
- Discovery: the supervisor `list` roster is the live truth. Root agents are
  rows with no parent/RLM depth; each carries the agent id (`activeSessionId`,
  stable across `/new`), the JSONL header id (`sessionId`, the pi-dish native
  session id), `sessionFile`, `cwd`, lifecycle, model, thinking level, queue
  state, and usage timestamps. The roster is refreshed on a poll and each new
  root is `attach`ed so its Pi-shaped agent events stream to pi-dish.
- Control: session commands use Pi-RPC names over the daemon (`prompt`,
  `steer`, `follow_up`, `abort`, `compact`, `set_model`, `set_thinking_level`,
  `set_session_name`, `get_state`, `get_commands`, `get_available_models`,
  `get_model_catalog`, `get_session_stats`, `get_queue`,
  `mutate_queued_message`, `resume_queue`, `get_messages`, `get_session_tree`,
  `navigate_tree`, `reload`, `export_html`, `get_system_prompt`). A prompt
  sent while busy is a `steer` (as with Pi's RPC session); an explicit
  follow-up goes to Prime's follow-up queue.
- Managed launches still run the Prime TUI in a pi-dish tmux pane with
  `--daemon-socket <socket>`, so the terminal view is unchanged and Prime's
  own `list`/`attach` see every agent. New-session ownership snapshots the
  roster's agent ids before launch and accepts exactly one new root in the
  launch cwd; more than one fails the launch (409) and closes the new pane,
  so pi-dish never guesses an owner. Resume identifies the root whose
  `sessionFile` realpath matches the resumed transcript.
  Ownership is recorded as `{daemonSocket, activeSessionId,
  workerInstanceId, sessionFile}` plus the pane process; close and restart
  require that record to still match the live roster row and the pane.
- Close calls the daemon `kill` for the owned agent (the operation behind
  `prime-agent stop`), waits for the roster to drop it, then removes the
  verified pane. The daemon and every other root keep running. Restart does
  the same but keeps the pane, relaunches `--resume <file>` in it, and never
  starts a second writer while the old transcript is still listed.

### Why not the other modes

- **`--mode rpc`** is Pi-RPC compatible and looks tempting, but it runs the
  agent in-process with fewer commands (no queue, tree, or bash control),
  is invisible to `prime-agent list`/`attach`, and dies with its parent.
  It cannot represent a resident agent or support ownership by daemon
  identity.
- **ACP** is aimed at editor integrations and does not expose sessions
  started anywhere else; pi-dish would lose every manually started TUI.
- **CLI-only** (`prime-agent send`/`stop` per operation) would spawn a process
  per request, has no event stream, and cannot read the queue, tree, or
  model catalog. It also leaves ownership to text matching instead of the
  daemon's agent ids.
- **The daemon `create` command** exists but is undocumented and rewrites the
  user's default model in `settings.json`; pi-dish launches the real TUI and
  adopts the agent it creates instead.

## Capability matrix (Prime 0.10.2)

| Capability | Prime Agent 0.10 |
|---|---|
| Prompt, steer, follow-up, abort | Yes, over the daemon |
| Streaming (`turn_start`, `message_update`, `message_end`, tool events, `turn_end`, `agent_end`) | Yes, from `attach`ed events |
| Compaction | Yes (`compact`, with optional instructions) |
| Model change, available models, model catalog, session stats | Yes |
| Thinking level (Prime's ladder includes `max`) | Yes |
| Rename | Yes (`session_info_changed` refreshes the roster) |
| Commands / skills | Yes (`get_commands`; TUI-only commands are not executable remotely) |
| Queue read and cancel | Yes (`get_queue`, `mutate_queued_message`; a cancel Prime rejects because the entry already moved fails visibly) |
| Abort with queued messages | Prime restores them to the queue and pauses delivery (its TUI behavior); a new prompt is refused with an explanation until one queued entry is cancelled, which resumes delivery |
| `/reload` | Yes (daemon `reload`, no pane keystrokes) |
| Tool calls | Prime 0.10's one tool is `python_repl` (`{code}` args, plain-text results); rendered like 0.9's `ipython` (code block, first-line/`bash(...)` summary) |
| Tree read and navigate | Yes (`get_session_tree`, `navigate_tree`) |
| Live session list, history, resume | Yes; route id is the JSONL session id |
| Close / restart owned root | Yes, from the verified spawn record |
| Extension UI (`setWidget`, dialogs, …) | No: Prime no longer loads extensions |
| Fast mode / provider sign-in / side chats | No upstream equivalent |
| Read-only HTML export and sharing | Prime has an exporter but pi-dish has no route for it yet |
| Private sessions | No; RLM artifacts live in the backed-up `session-artifacts/` |

## Verification

Directly observed against Prime 0.10.2 (Rust, `0.10.2`) on 2026-11-03, each
in an isolated HOME and daemon socket:

- `daemon_hello` reports `prime-agent.daemon` v7, `appVersion` `0.10.2`, and a
  `schemaId`/`schemaRevision`; `list` returns the roster and the v7 `shutdown`
  supervisor command replies `{success:true}` then `daemon_closing`.
- `--mode rpc` `get_commands` discovers user skills from
  `~/.prime/agent/skills/<name>/SKILL.md` (`skill:<name>`, user scope,
  `sourceInfo.path` under the isolated HOME), which is why `install.sh` links
  the bundled skills into Prime's agent directory.
- `prime-agent list --json` honours `PRIME_AGENT_DAEMON_SOCKET`, so the
  canary can prove a closed agent left the isolated roster.
- Session commands and `attach` event shapes are the ones recorded in the
  transport contract and exercised by the canary below.

The opt-in canary (`npm run test:lineage -- prime`) covers: managed launch
through `POST /api/sessions/new`, the active row's capabilities
(`close`/`restart`/`compact`/`tree`/`queueCancel`), rename, thinking, model
listing, a streamed turn whose assistant message persists, a held turn with a
queued follow-up visible in SSE `queue_update` and cancelled through
`/queue/cancel`, abort, a tree read, same-pane restart (new agent, same
transcript, another turn), a peer session surviving restart and close, close
proven against the daemon roster and the removed pane, resume plus a
post-resume turn, and a manually started TUI on the same socket appearing as
an unowned row whose close is refused (409) and whose prompt works.

## Remaining gaps

- **Model catalog for the new-session picker.** `modelCatalog` is still
  `null`, so `GET /api/models?harness=prime` has no catalog, routines and the
  new-session picker offer no Prime model list, and there is no price
  estimate. A live session's model list and the daemon's model catalog are
  available; wiring them into the catalog surface is follow-up work.
- **Prime TUI slash commands.** ~37 TUI commands and the `goal`, `schedule`,
  `heartbeat`, `refine`, MCP, and package subcommands have no pi-dish UI.
  Daemon `get_commands` exposes their names, but executing a TUI-only command
  remotely is not supported.
- **Schedule/heartbeat/goal UI.** Prime's own scheduling and goal state are
  not surfaced; only the session transcript and stats are.
- **Extension UI.** None. Prime 0.10 cannot load extensions, so widgets,
  status chips, and dialog races no longer exist for Prime.
- **First-run onboarding overlay.** A fresh HOME's first TUI shows Prime's
  "Share agent traces?" overlay. The agent is usable meanwhile, but a managed
  pane shows the overlay until a human dismisses it.
- **Ambiguous manual launch race.** Ownership snapshots the roster before a
  managed launch and requires exactly one new root in the launch cwd. A human
  starting a manual Prime TUI in the same cwd at the same moment makes that
  ambiguous; the managed launch then fails and its pane is closed. The
  agents themselves stay in the daemon and appear as unowned rows.
- **No bulk Bounce.** Prime root agents are excluded from bulk maintenance's
  idle-safety path; direct Close/Restart still work for owned roots.
- **First-run kernel bootstrap.** Prime's only built-in tool (`python_repl`)
  needs a uv-managed Python runtime. `install.sh` installs uv when the Prime
  CLI is present, but the kernel still downloads packages on first tool use.

## Upstream asks

1. **Document the daemon protocol.** `prime-agent.daemon` v7 and its command
   set are only discoverable from the binary. A versioned schema (as the
   handshake's `schemaId`/`schemaRevision` hints) plus a documented
   compatibility policy would let clients stop reverse-engineering it.
2. **Document (or stabilise) `create`.** An official way to create a session
   with an explicit `{cwd, model}` without rewriting the user's default model
   would remove pi-dish's launch-and-adopt dance.
3. **A deterministic launch identity.** A flag to name/tag a new agent, or to
   print its `activeSessionId` on stdout at launch, would replace cwd-based
   race-prone adoption.
4. **A stable machine-readable `list --json` contract.** Field names and
   presence (`activeSessionId`, `sessionFile`, `workerInstanceId`, queue
   lanes) currently have to be inferred; a documented schema is needed for
   ownership checks that fail closed.

## Version pin

The compatibility canary is pinned to Prime 0.10.2 (see
[docs/testing.md](testing.md)). Close and Restart use daemon protocol 7 agent
ids, worker instance ids, transcript paths, and Linux process birth
identities. Missing metadata, unknown protocols, mismatched roots, and
replaced panes fail closed. No daemon-wide shutdown, raw worker signal, or
retry after an indeterminate stop is used; the canary's own teardown uses the
protocol `shutdown` command on its isolated socket. Run new Prime releases
through `npm run test:lineage -- prime` before trusting these
version-specific fields.
