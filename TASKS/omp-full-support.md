# Task: Full OMP Support

**Priority:** P0
**Status:** Planned — baseline (Phases 1–4 of `pi-lineage-harness-support.md`) is
implemented and verified; this task closes the deliberately capability-degraded
OMP gaps and makes configured OMP sessions pilotable from the web.
**Depends on:** `TASKS/pi-lineage-harness-support.md` (landed)

## Context

pi-dish already attaches to, discovers, launches, and resumes OMP sessions via
the `pi-dish-bridge-omp` wrapper (public-API-only bridge core, namespaced
identity, tmux-only launch, no RPC). The baseline shipped capability-degraded:
`compact`, `queueRead`, `queueCancel`, `treeRead`, `treeNavigation`, and
`reload` are `false` in `extensions/pi-dish-bridge-omp/index.ts`.

Upstream OMP (`@oh-my-pi/pi-coding-agent`, CLI `omp`, Bun >= 1.3.14) has since
stabilized public APIs that unblock most of these. Verified against OMP
17.2.15 source (2026-08):

| Capability | Public OMP surface | Verdict |
|---|---|---|
| compact | `ctx.compact(instructionsOrOptions?)` with `CompactOptions.mode: "soft" \| "remote" \| "snapcompact"` (`packages/coding-agent/src/extensibility/extensions/types.ts`) | **Enable** |
| tree read | `ctx.sessionManager: ReadonlySessionManager` (read-only, public) | **Enable** |
| tree navigation / branch | `ExtensionCommandContext.branch(entryId)` and `navigateTree(targetId, { summarize? })` — command-context only | **Enable**, routed through a registered command context |
| queue read | `hasPendingMessages(): boolean` only; RPC state exposes only `queuedMessageCount` | Keep disabled — no public list API |
| queue cancel | none (abort is not queue cancellation) | Keep disabled |
| custom extension UI | `ctx.ui.custom()` explicitly does not serialize; dialog primitives (select/confirm/input/editor/notify) do | Keep dialog subset only |

Provider config: OMP stores credentials in `~/.omp/agent/agent.db` and reads
env from `<cwd>/.env`, `~/.omp/agent/.env`, `~/.omp/.env`, `~/.env`. Z.ai is a
first-class provider: id `zai`, env `ZAI_API_KEY`, models `zai/glm-4.5` …
`zai/glm-5.2` (verified live via `omp models --json`). Settings are YAML at
`~/.omp/agent/config.yml`, introspectable via `omp config list --json`,
`omp config get <key> --json`, `omp config path`.

Orb bootstrap: `.agents/setup` installs Bun >= 1.3.14 and
`@oh-my-pi/pi-coding-agent` globally. **Credentials are never committed**;
each orb/agent writes `ZAI_API_KEY=…` to `~/.omp/agent/.env` (chmod 600) at
runtime. A real one-turn canary
(`omp --model zai/glm-4.7-flash --thinking minimal -p "…"`) verified the
end-to-end path in the reference orb.

### In-pane session identity

OMP keeps the same extension runner for `/new`, `/resume`, fork, and handoff,
and emits `session_switch` instead of another `session_start`. pi-dish now
adopts that new identity in place: the instance-keyed bridge socket and
registry stay stable while history routing, pane ownership, SSE, and the web
selection follow the new session. WS-G deliberately excluded `/handoff` from
the curated web host commands because this identity gap made the originating
route lose the pane. With switch adoption in place a follow-up may re-evaluate
`/handoff`; adding it back to the web command allowlist is out of scope here.

## Workstreams

Each workstream is one feature branch (`omp-compact`, `omp-tree`,
`omp-web-pilot`). All three touch `server.js`; A and B both touch
`extensions/pi-dish-bridge/core.ts` and the OMP wrapper — keep changes
additive and narrowly scoped so integration merges cleanly. Do not refactor
shared aggregate/routing/identity code; that stays under one owner per the
lineage task's parallelism rule.

### WS-A: OMP compact (branch `omp-compact`)

1. Bridge core: implement a `compact` operation over the socket protocol using
   public `ctx.compact()`; forward `compaction_start`/`compaction_end` (the
   server's `compacting` flag already consumes these — see
   `test/bridge-session.test.js`).
2. Flip `compact: true` in `extensions/pi-dish-bridge-omp/index.ts` only after
   the operation works; leave Prime untouched.
3. Server: route the `/compact` slash command through the bridge when the live
   session advertises the capability (today it is RPC-only around the
   `builtinCommands` handling in `server.js`). Keep the
   double-compaction guard semantics.
4. UI: compact control appears for OMP sessions exactly when advertised.
5. Tests: bridge protocol unit tests + a fake-host canary; extend the lineage
   canary if cheap. Capability-gated: a host without `ctx.compact` must
   degrade to `compact: false`, not throw.

### WS-B: OMP session tree read + navigation (branch `omp-tree`)

The hardest slice: `branch`/`navigateTree` are only legal on an
`ExtensionCommandContext`. The wrapper must register a (hidden) extension
command to obtain that context and service queued navigation requests through
it; tree reads come from `ctx.sessionManager`.

1. Bridge core: `tree_read` (serialize the session tree from
   `ReadonlySessionManager`) and `tree_navigate`/`branch` operations that
   execute inside the registered command context. Timeouts and
   `{ cancelled: true }` results must map to precise errors, not hangs.
2. Flip `treeRead`/`treeNavigation` in the OMP wrapper.
3. Server: OMP tree routes must use the live bridge, never `lib/pi-sdk.js`
   (inactive OMP tree read stays unsupported unless done via profile-native
   JSONL parsing — acceptable follow-up, not required here).
4. UI: session tree view works for live OMP sessions, including the
   summarize-on-navigate flow if OMP's `{ summarize }` option proves usable;
   otherwise plain navigation with the summary control hidden.
5. Tests: fake-host protocol tests + real-host canary (one branch + one
   navigate on a scratch session with a real Z.ai turn).

### WS-C: Pilot configured OMP sessions from the web (branch `omp-web-pilot`)

Goal: from the browser, launch/resume OMP sessions with a chosen model,
thinking level, and a *curated* config surface — not a full settings editor.

1. Verify/polish the existing new-session harness picker for OMP: model list
   from `omp models --json` (already `modelCatalog: 'command'` in
   `lib/harnesses.js`), thinking levels from the selected model's catalog entry
   (e.g. `glm-5.2` supports only `high`/`max` — the picker must not offer
   invalid levels).
2. Provider readiness: surface which providers are usable (presence-only check
   of env/`.env` keys, e.g. `ZAI_API_KEY` — never display values). Gray out or
   annotate models whose provider has no credential.
3. Curated config: read `omp config list --json` / `omp config get --json`
   server-side and expose a small allowlisted subset relevant to piloting
   (default model, default thinking level). No arbitrary settings writes from
   the UI; launching with explicit `--model`/`--thinking` argv is the primary
   mechanism.
4. Resume flow: resuming an OMP session from history from the web must work
   with a model override.
5. Tests: server unit tests for the catalog/readiness endpoints; UI smoke for
   the picker states (no credential, invalid thinking level, live launch).

## Out of scope (unchanged from lineage task)

- OMP queue read/cancel (no public API — revisit when OMP ships one)
- OMP native RPC transport, RPC fallback
- OMP logical close (`closeMode: 'unsupported'` stands)
- Rendering `ctx.ui.custom()` components
- OMP marketplace/plugin management
- Full settings editor in the web UI

## Testing credentials

Real-model canaries use Z.ai. The key is provided out-of-band (thread prompt
or operator); write it to `~/.omp/agent/.env` as `ZAI_API_KEY=…`, chmod 600.
Never commit it, never echo it into logs. Prefer `zai/glm-4.7-flash` with
`--thinking minimal` for cheap canary turns.

## Definition of done

- OMP sessions support compact, tree read, and tree navigation from the web,
  capability-gated and verified against a pinned OMP/Bun pair with real turns.
- A user can open pi-dish, pick OMP + a Z.ai model + a valid thinking level,
  see provider readiness, launch, steer, compact, branch, and resume — all
  from the browser.
- Queue controls remain hidden for OMP with a precise capability story.
- `npm test` green; lineage canary extended or documented for the new
  capabilities.
