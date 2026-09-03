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
by the target's own TUI. There is no inbox: a message to an inactive session
means `resume <ref>` first, then `follow-up`.

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
  [--prompt "..."]` — spawns an ordinary, durable agent process (not a
  subagent). The harness defaults to the one the calling session runs on, so
  an OMP session spawns OMP and a Pi session spawns Pi; `--harness` crosses
  over, and the target host is checked for that harness before launching.
  `--no-wait` returns the spawn id immediately. Launch provenance is recorded
  in an advisory sidecar so the UI can navigate between related sessions; it
  grants no ownership or lifecycle authority.
- `interrupt <ref>` — abort the current turn; the session stays live.
- `resume <ref>` — bring an inactive JSONL session back as a live process.
- `close <ref>` — graceful shutdown (SIGTERM; extension cleanup runs). There
  is no force-kill: a hung session is for the user to inspect.
- `related <ref>` — parents/children from native Pi lineage plus advisory
  pi-dish launch provenance.

## Capability degradation

- A live session with the pi-dish bridge is fully controllable.
- A pi-dish-owned RPC session is controllable through the common server
  surface.
- An inactive JSONL is readable and resumable.
- A session created by another launcher with no bridge may be
  historical-only.
- Native Pi `parentSession` and pi-dish launch provenance improve navigation
  but do not imply ownership.
