---
name: pi-dish-sessions
description: Spawn, message, and read ordinary peer Pi sessions through the pi-dish server, and search every past session transcript — locally or across the whole host fleet. Use when work should run in a separate durable Pi process, when another session needs a prompt, steer, follow-up, interrupt, resume, or graceful termination, when a prompt carries a session ref or a `#ref` mention (like "#tycho/8f3ab2c1") or a `<session-refs>` block and you need to read or talk to that session, or when prior sessions may already hold the answer (how something was fixed or built before, where a file was touched, what a past investigation concluded).
---

# Pi-dish peer sessions

Use the bundled CLI; never write Pi JSONL or signal processes yourself.

```bash
CLI=~/.pi/agent/skills/pi-dish-sessions/scripts/pi-dish-sessions.js
node "$CLI" search "jsonl torn tail recovery" --limit 5   # find prior work
node "$CLI" search "index compaction" --all-hosts          # whole fleet
node "$CLI" list --active                                  # live sessions
node "$CLI" read tycho/8f3ab2c1                            # transcript as markdown
node "$CLI" send <ref> "Run the tests"                     # prompt (queues mid-turn)
node "$CLI" steer <ref> "Check the nested case first"      # redirect current turn
node "$CLI" follow-up <ref> "Then summarize here"          # queue for after the turn
node "$CLI" spawn --cwd "$PWD" --name "investigation" \
  --prompt "Investigate the cache issue and report" --json # durable peer process
node "$CLI" resume <ref>                                   # revive an inactive session
```

Also: `resolve`, `show` (raw JSON window), `related`, `interrupt`, `close`
(graceful), `share <ref>` (public link), `hosts` (the fleet; `--host <name>`
puts any command on that host), `host` (this server's identity and
capabilities; the "is pi-dish up?" check), `load` (how busy a host is — check
before heavy builds or fanning out peers), `config`, `usage`, `models`,
`attach`, `session`. Use these instead of `curl`. `--json` works everywhere.
`help <command>` has every flag and an example; `docs` has the server's own
topics (`refs`, `search` grammar, `fleet`, `sessions`) and beats this file
in a mixed-version fleet.

Output is bounded by default: `list` 50 rows, `search` 20 results, text
about 12,000 chars, `--json` rows a compact field set. A `#` notice says
when something was cut. Raise with `--limit N`, `--max-chars N` (`0` = no
cap), `--fields A,B|all`, or `--full` for everything; page `read`/`show`
with `--before INDEX`. Don't pipe through `head`.

## Refs

Anywhere a command takes a session id it takes a **ref**: a full id, its
uuid tail, a unique ≥4-char prefix of either (`01a070d2`), or a
host-qualified form (`tycho/01a070d2`, no `--host` needed). `list`, `search`
and `resolve` print the shortest ref in their first column; pass that along.
Never retype an encoded `~sk1_…` route id: a one-character slip still
decodes and the server can only say `Session not found`.

A `#ref` mention or `<session-refs>` block in a prompt is a live handle, not
a citation: `read` the session before reasoning about what it did, and
`send`/`steer`/`follow-up` to talk to it.

## Behavior you cannot infer

- **Search is long-term memory.** Check for prior work before re-deriving a
  fix or investigation. On a miss, retry with terms you'd expect *in the
  transcript*: an error string, a file path, a command line.
- **Held messages.** `send` and `follow-up` carry this session as sender. A
  target host with a message hold window answers `held`/`until` instead of
  interrupting; a held message to an inactive session waits for an explicit
  `resume`. `steer` is always immediate.
- **Hibernation.** A host under memory pressure may hibernate a long-idle
  peer. `send` and `follow-up` resume it first; `steer` does not.
- **Harness.** A spawned peer runs the same harness as you; pass
  `--harness pi|omp|prime` to cross over.
- **Private spawn.** `spawn --private` keeps the transcript out of the fleet
  backup and hides the session from every command until the user enters the
  PIN, so it takes `--name` but not `--prompt` and is not yours to follow up
  (Pi and OMP only).
- **Connection.** `PI_DISH_URL` defaults to `http://127.0.0.1:3333`; set
  `PI_DISH_TOKEN` if the server needs a bearer. Pass `--session <id>` only
  if the CLI reports it cannot identify the calling session.
