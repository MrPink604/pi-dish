---
name: pi-dish-sessions
description: Spawn and control ordinary peer Pi sessions through the pi-dish server, and search every past session transcript. Use when work should run in a separate durable Pi process, when another visible session needs a prompt, steer, follow-up, interrupt, resume, or graceful termination, or when prior sessions may already hold the answer (how something was fixed or built before, where a file was touched, what a past investigation concluded).
---

# Pi-dish peer sessions

Use the bundled CLI. It talks only to pi-dish's semantic HTTP routes; it never writes Pi JSONL or signals processes itself.

```bash
CLI=~/.pi/agent/skills/pi-dish-sessions/scripts/pi-dish-sessions.js
node "$CLI" list
```

`PI_DISH_URL` is inherited by sessions spawned through pi-dish and otherwise defaults to `http://127.0.0.1:3333`. Set `PI_DISH_TOKEN` when the server requires a bearer token; the CLI sends it on every request. The CLI identifies the current session from `PI_DISH_SESSION_ID`, process ancestry against the bridge registry, or an unambiguous live cwd. Use `--session <id>` when discovery is ambiguous.

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

## Other hosts in the fleet

If this server knows about peer hosts, it re-serves them and `hosts` lists the
fleet — name (`(self)` for this one), reachability (with the failure code when
a host is down), label, and the capabilities worth acting on.

```bash
node "$CLI" hosts
# (self)    reachable            hub     sessions,search,spawns,comments,pages
# tycho     reachable            tycho   sessions,search,spawns,comments,pages,terminal
# work      unreachable:ssh_auth_failed  work  -
```

`--host <name>` puts any session command on that host — everything else about
the command is unchanged, and without it you stay local. Only names `hosts`
lists work; an unknown one fails with the fleet's known names.

```bash
node "$CLI" list --active --host tycho
node "$CLI" spawn --host tycho --cwd /home/me/api --name "reindex" \
  --prompt "Reindex the corpus and report the timings" --json
node "$CLI" follow-up --host tycho <session-id> "Then post the numbers here"
```

A cross-host spawn is still an ordinary spawn on that host; pi-dish records the
calling session host-qualified in the target's advisory provenance sidecar.
Session ids are host-local, so keep the `--host` with the id you got back.

## Search past sessions (memory recall)

Every past session's transcript is indexed — prose, tool-call file paths, and
bash command lines. Treat the corpus as long-term memory: before re-deriving
something (a fix, a config, an investigation), check whether a prior session
already did it.

```bash
node "$CLI" search "jsonl torn tail recovery" 
node "$CLI" search "compaction cwd:~/work/api since:30d"
node "$CLI" search '"exact phrase" -vendored model:opus' --limit 5 --json
```

Results are relevance-ranked (name hits ≫ metadata ≫ content occurrences;
recency breaks ties), one session per line with matched-content snippets
underneath. Query grammar: plain terms match content and metadata; `"quoted
phrases"`; `-term` negation (metadata-only); `name:`/`cwd:`/`model:`/`id:`
field terms; `since:`/`before:` on last activity (`7d`, `12h`, `2w`, or ISO
dates); `is:active` for live sessions only.

Indexes are host-local, so `--host <name>` searches that host's own corpus.

Search finds the session; `show <id>` reads it. Distinct keywords beat
repeating one keyword; if a first query misses, reformulate with other terms
you'd expect in the transcript (an error string, a file path, a command).

## Capability degradation

- A live session with the pi-dish bridge is fully controllable.
- A pi-dish-owned RPC session is controllable through the common server surface.
- An inactive JSONL is readable and resumable.
- A session created by another launcher with no bridge may be historical-only.
- Native Pi `parentSession` and pi-dish launch provenance improve navigation but do not imply ownership.
