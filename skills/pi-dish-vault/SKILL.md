---
name: pi-dish-vault
description: Get one credential from the operator's Bitwarden vault, approved by the operator in pi-dish, injected into a single command's environment. Use when a task needs a password, API key, token, TOTP code or sudo password the operator keeps in Bitwarden.
---

# Bitwarden items, approved in pi-dish

The operator approves each request on their phone (pi-dish push + card). On
approval, Bitwarden Agent Access (`aac`) injects the requested fields into
**one** command's environment. The value never appears in your output, the
transcript, or the model context — keep it that way.

Find the item first (names, ids and URIs only; no approval needed), then
request it by id:

```bash
VAULT=~/.pi/agent/skills/pi-dish-vault/scripts/pi-dish-vault.js
node "$VAULT" search github          # id <tab> kind <tab> name <tab> URIs
node "$VAULT" run --item <id> --env GH_TOKEN=password \
  --reason "push the release tag" -- gh release create v1.2.0
```

sudo with the operator's password:

```bash
node "$VAULT" run --item fleet-sudo-desktop --env PW=password \
  --reason "install rocprofiler" \
  -- sh -c 'printf "%s\n" "$PW" | sudo -S pacman -S --needed rocprofiler'
```

- `--item`: Bitwarden item id (from `search`) or exact, unique name. `--env VAR=field` with field one
  of `username`, `password`, `totp`, `uri`, `notes` (secure-note bodies live
  in `notes`); repeat for several fields of the same item.
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
