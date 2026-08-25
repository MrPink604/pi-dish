# Session refs

A ref is a short, pasteable handle for a session, usable anywhere the
pi-dish-sessions CLI takes a session id. Refs replace passing raw JSONL paths
between sessions: they survive host boundaries, don't leak filesystem layout,
and resolve to the parsed transcript the server serves rather than raw JSONL.

## Grammar

```
8f3ab2c1              id prefix, session on this host
tycho/8f3ab2c1        host-qualified: session on host "tycho"
self/8f3ab2c1         explicit local
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

## Where refs come from

- The pi-dish UI: right-click (long-press on a phone) a session in the
  sidebar and copy its ref, or copy it from the session stats modal.
- `spawn --json` output: the returned `sessionId` (plus `host` when spawned
  cross-host) is a valid ref.
- Advisory launch provenance (`related`, the provenance sidecar) records
  callers as `hostId:sessionId`.

## Resolution mechanics

`resolve <ref>` prints what a ref points at without touching the session.
Every other command resolves refs the same way before acting: the CLI asks
the owning host's `GET /api/sessions/resolve?id=<prefix>`; on hosts too old
to serve it (no `resolve` capability), the CLI falls back to fetching the
session list and prefix-matching client-side, so refs work across a
mixed-version fleet.

## Caveats

- Host names are per-server configuration. `tycho/8f3ab2c1` copied on one
  machine resolves on another only if that machine's fleet map also names
  the host `tycho`. Keep fleet names consistent across hosts, or use the
  `hostId:sessionId` form, which is name-independent.
- Session ids are host-local. Never strip the host part off a cross-host
  ref: the bare prefix may match a different session locally.
