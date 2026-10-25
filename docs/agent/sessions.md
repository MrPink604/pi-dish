# Controlling peer sessions

The pi-dish-sessions CLI talks only to pi-dish's semantic HTTP routes; it
never writes Pi JSONL or signals processes itself. Every command that takes a
session id also takes a ref (see the `refs` topic). Run the CLI with
`--help`, or `help <command>`, for flags.

## Messaging a session

Three delivery semantics, all queue-safe:

- `send <ref> "..."` — a normal prompt. If the target is mid-turn, pi queues
  it; otherwise it starts a turn.
- `steer <ref> "..."` — delivered *into* the current turn, redirecting work
  in progress. Use when the target is actively working and should change
  course now.
- `follow-up <ref> "..."` — queued for after the current turn completes.
  Use for "then also do X" while a turn runs.

A queued message can be seen and cancelled by the user in the pi-dish UI, and
by the target's own TUI. Without a hold (the default) there is no inbox: a
message to an inactive session means `resume <ref>` first, then `follow-up`.
The exception is a session the host *hibernated* under memory pressure: `send`
and `follow-up` resume it and then deliver (the call takes a few seconds
longer). `steer` never resumes one.

### Peer-message hold (opt-in)

By default a peer message is delivered immediately. A host may set an integer
`messageHoldWindowMs` (milliseconds, default `0` = off) in
`~/.pi/dish/settings.json`; with a positive window the *target's* owning host
holds incoming peer messages for that window instead of interrupting a busy
session:

- `send` and `follow-up` carry their sender, so the owning host can hold them.
  `steer` is an explicit interruption: it carries no sender and always
  delivers now.
- A message with no sender (a caller the CLI cannot identify, or any non-peer
  surface) is delivered immediately — the unheld behavior.
- A held delivery answers `{success: true, held: true, until: <iso>}`
  instead of the usual `{success, result}`; `until` is when the batch flushes.
- Held messages to the same session and delivery mode coalesce into one batch,
  each entry keeping its sender as a header (`[<ref> · <name> · <sentAt>]`).
- A held message to an inactive target waits for an explicit `resume <ref>`.
  The hold never resumes a session by itself, and an explicit resume does not
  shorten an open window — an overdue batch is only retried. A *hibernated*
  target is resumed when its batch is delivered.
- The inbox is durable (`~/.pi/dish/message-holds.json`) and refuses to
  discard pending state it cannot parse. Delivery is best-effort, not
  exactly-once: a batch is retired only after the target's harness
  acknowledges it, so a crash in between can redeliver the batch.

The setting is also exposed through the owning host's `GET /api/settings` and
`PUT /api/settings` (partial update); valid values are integers from `0` through
`86400000` milliseconds.

## Reading a session (memory recall)

`read <ref>` renders the transcript as markdown: turn headers, prose in
full, tool calls as one-line summaries, tool results truncated. Newest
messages come last; `--limit N` widens the window and `--before <index>`
pages older history (when older messages exist, `read` prints the exact
command to page back). `show <ref>` returns the same window as raw JSON when
you need message ids or metadata rather than a readable transcript.

Prefer `search` to find the right session first, then `read` it. Reading raw
JSONL files under `~/.pi/agent/sessions/` is almost never the right move —
the parsed routes handle branch navigation, image externalization, and
harness-specific formats that raw JSONL reads get wrong.

## Lifecycle

- `spawn --cwd DIR [--name N] [--harness ID] [--model provider/id]
  [--prompt "..."] [--private]` — spawns an ordinary, durable agent process
  (not a subagent). The harness defaults to the one the calling session runs
  on, so an OMP session spawns OMP and a Pi session spawns Pi; `--harness`
  crosses over, and the target host is checked for that harness before
  launching. `--private` keeps the transcript outside the fleet session backup
  (Pi/OMP only; the session still lists and resumes normally and reports
  `private: true`). `--no-wait` returns the spawn id immediately. Launch
  provenance is recorded in an advisory sidecar so the UI can navigate between
  related sessions; it grants no ownership or lifecycle authority.
- `interrupt <ref>` — abort the current turn; the session stays live.
- `resume <ref>` — bring an inactive JSONL session back as a live process.
- `close <ref>` — graceful shutdown (SIGTERM; extension cleanup runs). There
  is no force-kill: a hung session is for the user to inspect.
- `related <ref>` — parents/children from native Pi lineage plus advisory
  pi-dish launch provenance.
- Hibernation: under memory pressure the owning host stops the longest-idle
  live session that is provably doing nothing (no turn, queued input, dialog,
  background job, live subagent, supervised service, viewer, warm prompt
  cache, or `eval` use in the last 8 hours; idle at least 2 hours). The
  transcript stays resumable and the next `send`/`follow-up` resumes it.
  Live eval kernel state and browser tabs are discarded and named in the
  session's `hibernation` field. Hosts opt out with `"hibernation": "off"`.

### Bulk maintenance

Settings → **Bounce agents** queues a snapshot of owned runtimes. Each host
advertises `capabilities.sessionBounces`; clients aggregate capable hosts,
not the server.

- `GET /api/session-bounces/preview?mode=reload|restart` returns active
  targets with eligibility, reasons, and current safety blockers.
- `POST /api/session-bounces` with `{mode, sessionIds}` returns
  `202 {operation}`. Only explicit IDs are considered; unknown/unowned or
  already-queued targets are skipped.
- `GET /api/session-bounces` returns `{operations}` with per-target
  `waiting`, `executing`, `completed`, `skipped`, `failed`, or `cancelled`
  status and a reason. Successful restarts include `replacementId`.
- `DELETE /api/session-bounces/:id` cancels waiting targets only.

Use Reload for Pi extension changes; use Restart for runtime upgrades or
OMP bridge changes. Bulk Reload requires the Pi bridge's guarded command:
there is no typed-command fallback and no implicit switch to Restart.

Working/compacting parents, queued messages, open input dialogs, and OMP
background jobs or pending deliveries block execution. **Every OMP child
must exit, including idle kept-alive children.** Unknown safety state or
incomplete descendant discovery also blocks. Old bridges lacking safety
reporting require a manual upgrade/restart first.

Runtime identity and safety are rechecked before execution, using the
existing restart ownership proofs. Restart cannot atomically lock external
TUI input: do not start a new turn there while maintenance is executing.
The individual Restart agent control remains an immediate manual action;
it does not implicitly enqueue a safe bulk operation.

Requests survive browser closure, not server restart; operation history is
bounded and process-local. There is no force mode or automatic retry after
an ambiguous failure. Inspect the runtime before submitting again.

## Capability degradation

- A live session with the pi-dish bridge is fully controllable.
- A pi-dish-owned RPC session is controllable through the common server
  surface.
- An inactive JSONL is readable and resumable.
- A session created by another launcher with no bridge may be
  historical-only.
- Native Pi `parentSession` and pi-dish launch provenance improve navigation
  but do not imply ownership.
