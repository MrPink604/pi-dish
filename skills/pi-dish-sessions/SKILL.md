---
name: pi-dish-sessions
description: Spawn, message, and read ordinary peer Pi sessions through the pi-dish server, and search every past session transcript — locally or across the whole host fleet. Use when work should run in a separate durable Pi process, when another session needs a prompt, steer, follow-up, interrupt, resume, or graceful termination, when the user hands you a session ref (like "tycho/8f3ab2c1" or a short id) and says to read or talk to that session, or when prior sessions may already hold the answer (how something was fixed or built before, where a file was touched, what a past investigation concluded).
---

# Pi-dish peer sessions

Use the bundled CLI. It talks only to pi-dish's semantic HTTP routes; it
never writes Pi JSONL or signals processes itself.

```bash
CLI=~/.pi/agent/skills/pi-dish-sessions/scripts/pi-dish-sessions.js
node "$CLI" list --active
```

`PI_DISH_URL` is inherited by sessions spawned through pi-dish and otherwise
defaults to `http://127.0.0.1:3333`; set `PI_DISH_TOKEN` when the server
requires a bearer. The CLI identifies the current session automatically; use
`--session <id>` only if it reports ambiguity. `--json` everywhere for
machine-readable output.

## Session refs

Anywhere a command takes a session id, it takes a **ref**: a full id, a
unique id prefix (≥4 chars, e.g. `8f3ab2c1`), or a host-qualified form
(`tycho/8f3ab2c1` — no `--host` needed). Users copy refs from the pi-dish
UI; treat a pasted short id as a ref, and `resolve <ref>` to see what it
points at.

## Hot path

```bash
node "$CLI" search "jsonl torn tail recovery" --limit 5   # find prior work
node "$CLI" search "index compaction" --all-hosts          # whole fleet
node "$CLI" read tycho/8f3ab2c1                            # transcript as markdown
node "$CLI" send <ref> "Run the tests"                     # prompt (queues mid-turn)
node "$CLI" steer <ref> "Check the nested case first"      # redirect current turn
node "$CLI" follow-up <ref> "Then summarize here"          # queue for after the turn
node "$CLI" spawn --cwd "$PWD" --name "investigation" \
  --prompt "Investigate the cache issue and report" --json # durable peer process
node "$CLI" resume <ref>                                   # revive an inactive session
```

Search treats the session corpus as long-term memory: before re-deriving a
fix, config, or investigation, check whether a prior session already did it.
If a first query misses, reformulate with terms you'd expect *in the
transcript* — an error string, a file path, a command line. Search finds the
session; `read` reads it.

Also available: `show` (raw JSON window), `related`, `interrupt`, `close`
(graceful, no force-kill), `hosts` (the fleet; `--host <name>` puts any
command on that host), `attach` (join a live session's tmux pane from this
terminal — local only), `resolve`, `session`.

## Going deeper

- `node "$CLI" --help` and `help <command>` — full flags and examples.
- `node "$CLI" docs` — server-versioned topics (`refs`, `search` grammar,
  `fleet` semantics, `sessions` control details). In a mixed-version fleet
  the server's own docs beat this file; `docs --host <name>` reads a peer's.
