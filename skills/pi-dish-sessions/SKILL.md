---
name: pi-dish-sessions
description: Spawn and control ordinary peer Pi sessions through the pi-dish server. Use when work should run in a separate durable Pi process or when another visible session needs a prompt, steer, follow-up, interrupt, resume, or graceful termination.
---

# Pi-dish peer sessions

Use the bundled CLI. It talks only to pi-dish's semantic HTTP routes; it never writes Pi JSONL or signals processes itself.

```bash
CLI=~/.pi/agent/skills/pi-dish-sessions/scripts/pi-dish-sessions.js
node "$CLI" list
```

`PI_DISH_URL` is inherited by sessions spawned through pi-dish and otherwise defaults to `http://127.0.0.1:3333`. The CLI identifies the current session from `PI_DISH_SESSION_ID`, process ancestry against the bridge registry, or an unambiguous live cwd. Use `--session <id>` when discovery is ambiguous.

## Spawn an ordinary peer

```bash
node "$CLI" spawn --cwd "$PWD" --name "investigation" \
  --prompt "Investigate the cache issue and report your findings" --json
```

Optional flags: `--model provider/id`, `--no-wait`, `--url URL`, `--session ID`. A spawned session is a normal Pi process. Pi-dish records only advisory launch provenance in its own sidecar so the UI can navigate between related sessions.

## Inspect and interact

```bash
node "$CLI" list --active
node "$CLI" show <session-id> --limit 20
node "$CLI" related <session-id>
node "$CLI" send <session-id> "Run the tests"
node "$CLI" steer <session-id> "Check the nested-session case first"
node "$CLI" follow-up <session-id> "Then summarize the result"
node "$CLI" interrupt <session-id>
node "$CLI" resume <session-id>
node "$CLI" close <session-id>
```

Use `--json` for machine-readable output. Destructive commands require an explicit target ID.

## Capability degradation

- A live session with the pi-dish bridge is fully controllable.
- A pi-dish-owned RPC session is controllable through the common server surface.
- An inactive JSONL is readable and resumable.
- A session created by another launcher with no bridge may be historical-only.
- Native Pi `parentSession` and pi-dish launch provenance improve navigation but do not imply ownership.
