# The fleet

A pi-dish server may know about peer hosts (its fleet). The CLI only ever
talks to its *own* server; cross-host reach is a path prefix the server
proxies (`/hosts/<name>/api/...`). There are no merged server-side views —
any aggregation (like `search --all-hosts`) happens in the client, and
partial results render as partial.

```bash
hosts
# (self)    reachable            hub     sessions,search,spawns,comments,pages
# tycho     reachable            tycho   sessions,search,spawns,comments,pages,terminal
# work      unreachable:ssh_auth_failed  work  -
```

- `--host <name>` puts any session command on that host; everything else
  about the command is unchanged. Only names `hosts` lists work.
- Host-qualified refs (`tycho/8f3ab2c1`) imply the host — no `--host`
  needed. Giving both with different hosts is an error.
- One token (`PI_DISH_TOKEN`) authenticates to the local server only; the
  server attaches each peer's own credential when proxying. The CLI never
  holds per-host tokens.

## Capability skew

Fleets run mixed versions as the steady state. `hosts` shows each host's
capabilities; **absent means unsupported** — never assume a peer serves what
this host serves. The CLI degrades where it can (e.g. ref resolution falls
back to client-side prefix matching on hosts without the `resolve`
capability; `docs` says so when a host can't serve docs).

## Cross-host spawns

A cross-host spawn is an ordinary spawn on that host. The caller is recorded
host-qualified (`hostId:sessionId`) in the target's advisory provenance
sidecar — attribution for navigation, never authority. Session ids are
host-local: keep the host with the id you got back (the CLI's `--json`
output includes it).

## Failure vocabulary

Unreachable hosts carry a classified reason (`ssh_auth_failed`,
`connect_timeout`, …). A sleeping host can black-hole connections; the
server backs off and answers instantly from cache, so a down host makes
commands fail fast, not hang. Reachability recovers on its own — don't
retry in a tight loop.
