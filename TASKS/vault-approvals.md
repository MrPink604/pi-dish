# Vault approvals — Bitwarden Agent Access with approval in pi-dish

Status: implemented (2026-10-19).

Agents get individual Bitwarden items without the operator unlocking the vault for each
task. Every release is approved from pi-dish on the operator's phone (Web Push + card).
Secrets never enter the browser, the transcript, or the model context: they are injected
into one command's environment by Bitwarden's `aac run`.

## Threat model

Cooperative, not containment. Every fleet host gives the agent UID root-equivalent
authority (desktop: `docker`, `libvirt`; beelink: `lxd`, `libvirt`, `sudo` group), so a
deliberately malicious agent can bypass any same-host gate. The feature prevents
accidental use, gives the operator a per-item decision with context, keeps values out of
transcripts, and limits a well-behaved agent to the items it was granted.

## Components

```
agent host                              hub (beelink)
pi-dish-vault run --item X ...  ──►  aac run --domain <envelope>  ──(E2E Noise, Bitwarden relay)──►
                                                                   pi-dish-vault-listener
                                                                     │  holds unlocked `bw` session
                                                                     │  POST/GET loopback bridge
                                                                     ▼
                                                                   pi-dish server ──► Web Push + card
                                                                     ▲                    │
                                                                     └── decision ◄───────┘ phone
```

- **Listener** (`vault-listener/`, Rust, binary `pi-dish-vault-listener`): an Agent
  Access `UserClient` built on `ap-client` (Apache-2.0, pinned git revision). Runs in a
  tmux window on the hub; the operator unlocks `bw` there once (master password on the
  tty, never through pi-dish or Cloudflare). Stdin commands: `pair <name>`, `status`,
  `sync`, `lock`, `unlock`, `quit`. Persistent identity and paired connections live in
  `~/.pi/dish/vault/` (0700).
- **pi-dish server** (`src/core/vault-approvals.ts`): in-memory pending requests,
  decisions, time-boxed grants and listener status; push notification kind `vault`;
  bridge routes for the listener; UI routes for the browser.
- **Browser** (`src/browser/vault-approvals.ts`): a host-level approval card visible
  regardless of the selected session, opened by the push notification.
- **Agent side** (`skills/pi-dish-vault/`): wrapper CLI that builds the envelope from the
  calling session's identity and execs `aac run`; `pair` for one-time host pairing.

## Contracts

### Envelope (wrapper → listener, carried as the aac `Domain` query)

`pidish-vault:v1:<base64url(JSON)>`, JSON:

```json
{ "item": "fleet-sudo-desktop", "fields": ["password"], "reason": "install rocprofiler",
  "session": { "ref": "desktop/01a0a845", "name": "Htpc provision", "host": "desktop" },
  "timeoutSec": 300 }
```

`item` is a Bitwarden item id or exact name (`bw get item`). `fields` ⊆ `username`,
`password`, `totp`, `uri`, `notes`. The listener releases only the requested fields.
A query without the prefix (stock `aac`) is treated as `{ item: <value>, fields: all
login fields }` with no session/reason. Session and reason are requester-claimed; the
device name comes from the verified pairing.

`pidish-vault:pair` is the pairing probe: aac v0.11.0 pairs non-interactively only
together with a request, so `pi-dish-vault pair <token>` sends this query once and the
listener answers it with an empty credential without involving pi-dish.

`pidish-vault:search:` + base64url(text) is the search probe. The listener answers it
itself, without approval, with JSON `{ results: [{ id, name, kind, uris }], truncated }`
(at most 100, from `bw list items --search`) in the credential's `notes`: metadata only,
never values or usernames. Before any request reaches pi-dish the listener looks the
item up (`bw get item`): items in the deny folder (`--deny-folder`, default `no-agents`)
are refused and never listed, and the card shows the item's Bitwarden name.

`pidish-vault:sync` is the sync probe (`pi-dish-vault sync`). The listener answers it
itself, without approval: while unlocked it runs `bw sync` and replies with an empty
credential; while locked, or when the sync fails, it refuses the request.

The wrapper runs `aac --output json run …`: aac otherwise logs INFO status lines to
stdout, into the command's own output.

### Listener ↔ pi-dish bridge (loopback only)

Mounted before the `/api` bearer gate; rejects any non-loopback peer and any request
without header `X-Pi-Dish-Vault-Bridge: <token>`. The token is
`~/.pi/dish/vault/bridge.token` (0600), created by pi-dish on first use; the listener
reads it.

| Method | Path | Body / result |
| --- | --- | --- |
| `POST` | `/api/vault/bridge/status` | `{ state: "locked"\|"ready", account?: string, devices: [{ name, fingerprint }] }` → 204. Heartbeat every 15 s; stale after 45 s. |
| `POST` | `/api/vault/bridge/requests` | `{ id, device: { name, fingerprint }, item, fields, reason?, session?, expiresAt }` → `201 { status }` (`approved` immediately when a grant matches). |
| `GET` | `/api/vault/bridge/requests/:id` | → `{ status: "pending"\|"approved"\|"denied"\|"expired" }`. Listener polls each second. |
| `DELETE` | `/api/vault/bridge/requests/:id` | Listener abandoned the request → 204; pending becomes `expired`. |

### Browser routes (ordinary `/api`)

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/api/vault` | `{ listener: { state, account, devices, updatedAt, stale } \| null, pending: Request[], recent: Request[] (last 20 decided), grants: Grant[] }` |
| `POST` | `/api/vault/requests/:id/decision` | `{ decision: "approve"\|"approve-window"\|"deny" }` → `{ request }`; `409` when no longer pending. |
| `DELETE` | `/api/vault/grants/:id` | Revoke a window → 204. |

`approve-window` approves and creates a 15-minute grant keyed by device fingerprint +
item + field set (+ session ref when present). Grants live in memory only.

### Push

Kind `vault`, title `Vault request`, body `<session name or device> wants <item>` plus
the reason; tag `<hostId>:vault:<id>`; click opens the app with the approval card.

## Decisions

- Bitwarden's relay (`wss://ap.lesspassword.dev`, aac default) carries the E2E-encrypted
  traffic; no self-hosted relay.
- Unlock only on the hub's tty (ssh/tmux over the tailnet).
- Pending requests expire at `expiresAt` (wrapper default 300 s; `aac run --timeout`).
- No persistence of pending requests or grants across pi-dish restarts.
- aac v0.11.0 is the protocol pin; the listener's `ap-client` dependency uses the same
  tag. Upgrading either side means upgrading both.
- Agents may list item metadata without approval (operator decision, 2026-10-19): names
  and URIs reveal which services exist, which the operator accepts for discoverability;
  the deny folder hides anything that should not be visible at all.
- Agents may request `bw sync` without approval: it releases nothing and only refreshes
  the listener's local copy of the vault.
