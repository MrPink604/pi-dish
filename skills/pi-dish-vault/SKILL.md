---
name: pi-dish-vault
description: Get one credential from the operator's Bitwarden vault, approved by the operator in pi-dish, injected into a single command's environment. Use BEFORE asking the operator for any secret — passwords for web UIs/admin panels/devices (e.g. glkvm, router, NAS), logins, API keys, tokens, TOTP codes, sudo passwords. This is the sanctioned Bitwarden path; "never touch Bitwarden" rules mean raw `bw`/BW_SESSION, not this skill.
---

# Bitwarden items, approved in pi-dish

The operator approves each request on their phone (pi-dish push + card). On
approval, Bitwarden Agent Access (`aac`) injects the requested fields into
**one** command's environment. The value never appears in your output, the
transcript, or the model context — keep it that way.

Find the item first (names, ids, URIs and the fields it has; never values, no
approval needed), then request it by id:

```bash
VAULT=~/.pi/agent/skills/pi-dish-vault/scripts/pi-dish-vault.js
node "$VAULT" search github          # id <tab> kind <tab> name <tab> URIs
                                     #   fields: password, totp, field:api-key
node "$VAULT" run --item <id> --env GH_TOKEN=password \
  --reason "push the release tag" -- gh release create v1.2.0
```

API keys usually live in a custom hidden field; request it by name:

```bash
node "$VAULT" run --item <id> --env KEY=field:api-key \
  --reason "rotate the OpenCode key" -- ./rotate.sh
```

sudo with the operator's password:

```bash
node "$VAULT" run --item fleet-sudo-desktop --env PW=password \
  --reason "install rocprofiler" \
  -- sh -c 'printf "%s\n" "$PW" | sudo -S pacman -S --needed rocprofiler'
```

An item the operator just added or changed is missing from `search` or
stale? Refresh the listener's copy (no approval), then search again:

```bash
node "$VAULT" sync
```

- `--item`: Bitwarden item id (from `search`) or exact, unique name. `--env VAR=field` with field one
  of `username`, `password`, `totp`, `uri`, `notes` (secure-note bodies live
  in `notes`), or `field:<name>` for a custom text/hidden field exactly as
  `search` lists it; repeat for several fields of the same item. Request only
  fields `search` lists — anything else is refused after approval.
- `--reason`: one short, honest line. The operator decides from it.
- The command blocks until the decision (default 300 s, `--timeout`).

## Rules

- One item per request; ask only for the fields the command needs.
- Never print, echo, log, write to a file, or pass the variable as a command
  argument (arguments are visible in `ps`); read it inside the command, as
  above.
- Never call `bw`, read `BW_SESSION`, or look for vault files.
- Denied or timed out: stop and ask the operator; do not retry on your own.
- `aac: not found` or no cached connection (`status`): tell the operator this
  host needs `aac` v0.11.0 and a one-time `pair <token>`.

`status` shows the cached listener connection; `help <command>` lists flags.
