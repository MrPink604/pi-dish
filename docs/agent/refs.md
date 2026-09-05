# Session refs

A ref is a short, pasteable handle for a session, usable anywhere the
pi-dish-sessions CLI takes a session id. Refs replace passing raw JSONL paths
between sessions: they survive host boundaries, don't leak filesystem layout,
and resolve to the parsed transcript the server serves rather than raw JSONL.

## Grammar

```
019f9834              a session on this host (see "What a ref may name")
tycho/019f9834        host-qualified: session on host "tycho"
self/019f9834         explicit local
<hostId>:<sessionId>  provenance form: full host uuid + full session id
```

- An id prefix must be at least 4 characters. An exact id always wins; a
  prefix must match exactly one session or resolution fails with the
  candidates listed.
- The host part resolves against this server's fleet (`hosts` in the CLI,
  `GET /api/hosts`): fleet remote name first, then host uuid, then label
  (case-insensitive). Only hosts in this server's fleet map are reachable —
  a ref naming an unknown host fails with the known names.
- The `hostId:sessionId` form is what launch provenance records for
  cross-host spawns; the part before the first `:` must be the full host
  uuid.

## What a ref may name

A session has more than one identifier, and a ref may use any of them:

| identifier | example |
| --- | --- |
| route id (what the HTTP routes speak) | `~sk1_WyJvbXAiLCIyMDI2LTA5…` (Pi: the native id) |
| harness-native id | `2026-09-05T09-07-03-291Z_01a070d2-43fb-7360-aaba-a4ddf8d1deb0` |
| uuid tail | `01a070d2-43fb-7360-aaba-a4ddf8d1deb0` |

Each resolves exactly, or by prefix (≥4 characters), in that order of
precedence. **Prefer the uuid tail** — `01a070d2` — which is what `list`,
`search` and `resolve` print. A non-Pi route id is a ~100-character base64
key whose first ~30 characters are identical for every session of that
harness on the host, so it is neither shortenable by prefix nor safe to
retype: a one-character slip still decodes to a well-formed id, and the only
answer the server can give is `Session not found`. Copy handles; never
retype a route id.

Hosts that predate this (no `refAliases` capability) resolve route-id
prefixes only. The CLI notices and resolves such a ref locally against that
host's session list instead, so short refs keep working across a
mixed-version fleet.

## `#ref` in a prompt

In the pi-dish composer, `#` opens a fuzzy picker over every session the
client can address and inserts that session's ref. The prompt keeps the short
`#ref` token you see; the server appends a `<session-refs>` block naming each
one it could resolve:

```
<session-refs>
…what a ref is and which verbs act on it…
- ref=tycho/8f3ab2c1 | name=jsonl torn tail recovery | host=tycho | active=yes | cwd=/w/pi-dish
</session-refs>
```

Treat every entry as a live handle, not a citation: `read <ref>` for the
transcript, `send`/`steer`/`follow-up <ref>` to message it. The block never
carries the referenced session's *content* — reading it is your call, and
guessing instead is the one thing the block exists to prevent.

A `#token` that resolves to nothing is left alone, so `#include` and
`#4` in prose stay prose.

## Where refs come from

- `list`, `search` and `resolve`: the first column (and `resolve`'s `ref:`
  line) is the shortest handle that host resolves — that is the string to
  pass to the next command.
- The composer's `#` picker (above), which writes the ref for you.
- The pi-dish UI: right-click (long-press on a phone) a session in the
  sidebar and copy its ref, or copy it from the session stats modal.
- `spawn --json` output: the returned `sessionId` (plus `host` when spawned
  cross-host) is a valid ref.
- Advisory launch provenance (`related`, the provenance sidecar) records
  callers as `hostId:sessionId`.

## Resolution mechanics

`resolve <ref>` prints what a ref points at without touching the session,
plus the short `ref:` to keep. Every other command resolves refs the same
way before acting: the CLI asks the owning host's `GET
/api/sessions/resolve?id=<ref>`; on hosts too old to serve it (no `resolve`
capability) — or too old to resolve aliases (no `refAliases`) — the CLI
fetches the session list and resolves client-side by the same rule, so refs
work across a mixed-version fleet.

## Caveats

- Host names are per-server configuration. `tycho/8f3ab2c1` copied on one
  machine resolves on another only if that machine's fleet map also names
  the host `tycho`. Keep fleet names consistent across hosts, or use the
  `hostId:sessionId` form, which is name-independent.
- Session ids are host-local. Never strip the host part off a cross-host
  ref: the bare prefix may match a different session locally.
- A ref is resolved by the server that owns the session you sent it to, so it
  has to read from *that* server's point of view. The `#` picker handles this:
  referencing a session on the same host writes a bare prefix, and referencing
  one on another host writes the name-independent `hostId:sessionId` form
  unless the prompt is going to the host whose fleet names the client knows.
