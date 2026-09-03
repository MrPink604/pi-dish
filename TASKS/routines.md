# Routines — cadence + invokable prompts with an invocation ledger

Status: contract (2026-09-03). Implementation follows this document; where the
code and this document disagree, fix one of them in the same pass.

## Why this is pi-dish's

Pi has no daemon: a cadence needs a long-lived process, and pi-dish is the only
process in the stack that owns spawning, tmux placement, launch provenance and
the whole-corpus vantage. Cron and invoke are both "spawn (or reuse) a session
with a known prompt", which `POST /api/sessions/new` + `/prompt` nearly do
today. The gap is three things: a **named, reusable launch spec**, a
**trigger** that fires it, and a **ledger** linking spec to runs.

What is *not* pi-dish's: scripts. The event listener, the conditional glue,
"if the review finds X then Y" — that is agent-loop territory and stays
outside (a systemd timer, a webhook relay, a git hook, an agent using the
peer-sessions CLI). pi-dish is an agent launcher with a ledger, not an
automation engine.

The framing that keeps this small: **a routine is a session template and an
invocation is a session.** Each run stamps its session with routine
provenance, so transcript, cost, duration and outcome come from the existing
session index and views. There is no second history system.

"Loop engineering" = trigger → run → outcome → tune the prompt → repeat. The
one affordance the existing views cannot give is *which prompt version
produced which run*, so the prompt is versioned (cheaply: an append-only list)
and each invocation stamps the version it ran.

## Scope

In (phase one):
- `lib/routines.js` store (definitions + invocation ledger), `lib/cron.js`
  (hand-rolled 5-field parser — no dependency), `lib/routine-runner.js`
  (trigger → spawn/deliver → observe → close, with injected deps).
- Routes under `/api/routines` and `/api/routine-invocations`.
- Provenance stamping on session list rows + a `routine:` grammar field.
- A Routines main-pane takeover (list / editor / versions / invocations).
- Host capability `routines`; fleet-aware client (fan-out per host).
- `docs/agent/routines.md`; tests; CLAUDE.md section.

Out (deliberately):
- Any DAG/chaining between routines. Routine A wanting B runs the
  peer-sessions CLI from inside its own session.
- Outcome classification beyond the status enum below. "Did the review find
  anything" is prompt design, not a pi-dish field.
- Schedule syntax beyond cron + `@hourly/@daily/@weekly/@monthly` + UI presets.
- Callbacks/webhooks *out* of pi-dish (notification machinery — calm-design
  rule). Callers poll the invocation or watch the session stream.
- Per-routine invoke tokens (phase two if a relay must not hold the host
  token). Phase one: the existing bearer, when configured.
- Copy-to-host / any server-side sync (phase two, and only ever as a client
  action — the fleet invariant: client is the aggregator).
- Usage-view grouping by routine (phase two; `routine:` search + the
  invocations table cover it for now).
- Skills CLI verbs for routines (phase two).

## Data model

All harnesses in `lib/harnesses.js` are supported (pi, omp, prime). Nothing
here may branch on `harness === 'pi'`; go through descriptors and live-session
capabilities exactly as the spawn/prompt routes do.

### Routine

```
{
  id:            uuid (server-assigned)
  name:          ^[a-z0-9][a-z0-9-]{0,47}$, unique per host (case-insensitive)
  description:   string ≤ 500 (optional, '' default)
  harness:       a getHarness() id (default 'pi')
  cwd:           string, absolute or ~-prefixed, required
  model:         string | undefined (canonical provider/id ref, as /new takes)
  thinking:      one of the /new levels | undefined
  prompt:        string, 1..100_000 chars
  promptVersion: integer ≥ 1
  versions:      [{ version, prompt, savedAt }]   // append-only, see below
  schedule:      null | { cron: string }          // local time
  enabled:       boolean (default true) — arms the *schedule* only; invoke
                 always works
  mode:          'oneShot' | 'continue'           // default 'oneShot'
  onBusy:        'skip' | 'steer' | 'followUp'    // default 'skip'
  minIntervalSec: integer ≥ 0 (default 0)         // invoke rate guard
  createdAt, updatedAt: ms epoch
}
```

Versioning: `versions` starts as `[{ version: 1, prompt, savedAt }]`. A PUT
whose `prompt` differs from the current one appends
`{ version: promptVersion + 1, ... }` and bumps `promptVersion`. Any other
edit does not. Cap the list at 50 entries, trimming the oldest, but the
current version is always present. No named versions, no diff UI.

`mode`:
- `oneShot` — every run spawns a fresh session, delivers the prompt, and
  closes the session after the turn ends (grace period below).
- `continue` — the routine keeps one session: a run reuses the routine's
  last invocation's session if it is live (send as a new prompt when idle) or
  resumable (resume it headlessly via the same dispatch `/resume` uses, then
  prompt); otherwise spawns fresh. Never auto-closes.

`onBusy` applies to **invoke** only when the routine is *busy* (definition
below): `skip` → 409; `steer`/`followUp` → deliver the composed text into the
running session via the live session's `steer` / `prompt(…, { deliverAs:
'followUp' })`, exactly as the `/steer` and `/follow-up` routes do (same
capability checks; a session that lacks the capability → 409 with that
error). Scheduled ticks always skip when busy.

Busy := the routine has an invocation in status `starting` or `running`.

### Invocation

```
{
  id:           uuid
  routineId, routineName (denormalized: the ledger outlives deletion)
  version:      the promptVersion that ran
  trigger:      'schedule' | 'invoke'
  source:       string ≤ 100 | null      // caller label from the invoke body
  delivery:     'prompt' | 'steer' | 'followUp'
  status:       'starting' | 'running' | 'completed' | 'errored'
                | 'interrupted' | 'skipped'
  skipReason:   'busy' | 'disabled' | null   (status skipped only)
  sessionId:    route session id | null
  startedAt:    ms epoch
  endedAt:      ms epoch | null
  durationMs:   endedAt - startedAt | null
  error:        string | null
  input:        the invoke `input` JSON | null  (≤ 32 KB serialized; larger
                is rejected 413 at the route)
  summary:      last assistant text of the observed turn, trimmed to 500
                chars | null
  closed:       boolean  (oneShot: the auto-close succeeded)
  closeError:   string | null
}
```

Status transitions: `starting` (spawn/resume in flight) → `running` (prompt
delivered) → one of `completed` (`turn_end` observed) / `interrupted`
(`agent_end` without a paired `turn_end`, session ended, socket closed, or
server restart) / `errored` (spawn, resume or delivery failed). `skipped` is
terminal and created directly.

For `steer`/`followUp` deliveries the invocation completes at the **next**
`turn_end` after delivery. That is an approximation (a follow-up may run as a
later turn); document it, don't try to be cleverer.

Rate guard: an invoke whose routine's most recent non-skipped invocation
`startedAt` is less than `minIntervalSec` ago → 429 `{ error, retryAfterSec,
lastInvocation }`. Not recorded as an invocation (a storm would fill the
ledger with its own rejections).

## Storage

`~/.pi/dish/routines.json` — `{ version: 1, routines: { [id]: Routine } }`
via `lib/dish-store.js` (re-read per call, temp-file + rename).

`~/.pi/dish/routine-invocations.json` — `{ version: 1, invocations:
[Invocation…] }`, newest first, capped at 5000 (oldest trimmed), same store
rules. Writes happen on every status change; the file stays small enough for
whole-file rewrites (the session-provenance sidecar has the same shape and
cap). No NDJSON/compaction machinery.

Neither file is control authority: losing them loses definitions and the
ledger, never a running session.

## Prompt composition

```
<routine.prompt>

<invocation-input source="<source or omitted>" invocation="<id>">
<JSON.stringify(input, null, 2)>
</invocation-input>
```

The block is appended only when `input` is present; it is *appended, never
substituted* (the `<session-refs>` rule) — no templating language. Then the
text goes through `expandSessionRefs(text, [], sessionRefDeps())` so `#ref`
tokens in a routine prompt resolve like they would from the composer.

## Runner (`lib/routine-runner.js`)

A factory `createRoutineRunner(deps)` with injected deps so tests can drive it
without booting spawn paths:

```
deps = {
  store,                                 // lib/routines.js
  createSession({ harness, model, thinking, cwd }) → sessionId,
  resumeSession(sessionId) → { id }      // the headless dispatch /resume uses
  getLiveSession(id) → sess | null,
  closeSession(id) → { status, body },   // extracted from the /close route
  composePrompt(routine, invocation) → string,
  isTurnInProgress(sess) → boolean,
  now: () => Date.now(),
  log: console,
}
```

`runner.invoke(routine, { trigger, source, input })` → Invocation (already
persisted, status `starting` or `skipped`, or throws a coded error for the
409/413/429 cases). The async body:

1. Busy check (per `onBusy` for invokes; skip for schedule).
2. Resolve the session: `continue` mode tries the last invocation's session
   (live → reuse; not live → `resumeSession`; failure → fall through to a
   fresh spawn and note it in `error`-free `summary`? No — keep the record
   clean: just spawn fresh). `oneShot` always spawns. Spawn uses the routine's
   harness/model/thinking/cwd through `createSession` with **no name**; then
   best-effort `sess.setName('<name> <YYYY-MM-DD HH:mm>')` only when the live
   session advertises `rename` (never fail the run on naming).
3. Attach observers *before* delivery: `turn_end`, `agent_end`, `message_end`
   (assistant role → summary text), session end/close (`exit`/`close`/
   `session_ended` — use whatever both BridgeSession and RPCSession emit;
   check `lib/bridge-session.js` and `lib/rpc-session.js`).
4. Deliver: `prompt` (fresh/idle) or `steer`/`followUp` (busy). Status →
   `running`, `sessionId` set.
5. On terminal event: status + `endedAt` + `summary`. Then in `oneShot` mode
   wait `ROUTINE_CLOSE_GRACE_MS` (10s, `PI_DISH_ROUTINE_CLOSE_GRACE_MS`
   override for tests) and call `closeSession`; record `closed`/`closeError`.
   A harness whose close is unsupported/refused (Prime's `client-only`, an
   OMP pane pi-dish can't prove) leaves the session live with `closeError`
   set — never escalate.

Watchdog: an invocation `starting` for more than 2 minutes (spawn hung) →
`errored`. No watchdog on `running` — a long turn is a long turn.

Restart handling: at boot, every `starting` invocation → `errored` ("pi-dish
restarted"). Every `running` one: if `getLiveSession` resolves and the turn is
in progress, re-attach the observers and continue; if live and idle, treat as
`completed` now (no summary) and run the oneShot close path; if not live →
`interrupted` ("pi-dish restarted").

Scheduler: a 30s `unref`'d tick. For each enabled routine with a schedule,
evaluate the **current minute** only against the cron expression (local
time); fire at most once per minute per routine, persisting
`lastScheduledMinute` (ms epoch of that minute) on the routine so a restart
inside the same minute cannot double-fire. Minutes missed while the server
was down are **not** caught up. Expose `runner.tick(now)` for tests. Expose
`nextRunAt(routine, now)` (search forward ≤ 366 days, null when never/no
schedule) for the list.

Cron (`lib/cron.js`): standard five fields (min hour dom month dow), `*`,
lists, ranges, steps (`*/15`, `1-5/2`), 3-letter month/day names, `7` == `0`
for Sunday, the four `@` aliases. dom/dow combine with the standard rule
(either matches when both restricted). `parseCron(str)` throws a message the
route returns as 400; `cronMatches(parsed, date)`; `nextCronMatch(parsed,
fromDate)`.

## API

All under the existing auth/CORS rules (bearer when configured). Route ids for
routines accept the uuid **or the name**; invocation ids are uuids only.

| Route | Purpose |
|---|---|
| `GET /api/routines` | `{ routines: [RoutineSummary] }` — the record minus `versions`, plus `stats: { invocations, running, lastInvocation: Invocation\|null, nextRunAt }` |
| `POST /api/routines` | create → 201 `{ routine }`; 400 validation (cron errors included, `validateHarnessPilotSelection` for model/thinking/cwd); 409 duplicate name |
| `GET /api/routines/:id` | full record incl. `versions` |
| `PUT /api/routines/:id` | partial update; same validation; prompt change bumps version; `name` change allowed (uniqueness re-checked); 200 `{ routine }` |
| `DELETE /api/routines/:id` | 200 `{ success, invocations: N }` — ledger entries retained, sessions untouched |
| `POST /api/routines/:id/invoke` | body `{ input?, source? }` → 202 `{ invocation }` (status `starting`); `?wait=1` blocks until status leaves `starting` (≤ 60s, then returns whatever it is) → 200. 409 busy `{ error, invocation: <the running one> }`, 413 input too large, 429 rate-limited, 404 |
| `GET /api/routines/:id/invocations` | `?limit=` (default 50, max 200) `&before=<startedAt>` cursor, newest first → `{ invocations, nextBefore }` |
| `GET /api/routine-invocations/:id` | one invocation |

`hostCapabilities()` gains `routines: true`. `/api/config` unchanged.

### Session list stamping + grammar

`lib/routines.js` exports `invocationsBySessionId()` (latest invocation per
session). A sibling of `annotateSessionParents` — `annotateSessionRoutines(list)`
— stamps `session.routine = routineName`, `session.routineId`,
`session.routineInvocationId` on `/api/sessions` and `/api/sessions/resolve`
rows (`/api/search` results too, if they don't already flow through the same
list). Presentation only, like parent hints.

`QUERY_FIELDS` in `public/helpers.js` gains `'routine'`; the generic
`session[term.field]` substring path then makes `routine:nightly` and
`-routine:nightly` work in the sidebar, the advanced search, the CLI search
and saved scopes with no further code. `sessionMetaText` does **not** gain the
routine name (plain terms should not match it).

## Client (`public/app.js`, `index.html`, `style.css`)

Fifth sidebar-header icon (a clock outline SVG in the same 16px stroke style)
→ `openRoutinesView()`; `.main.routines-open` takeover following the usage/
search/new-session/skills pattern exactly: header row (title, ⟳, ✕), Escape
closes, session switch closes, mutually exclusive with the other four (add
`closeRoutinesView()` to each of their open functions and vice versa), hides
`.empty-state`/`.session-view` via `!important`. The button is hidden when no
effective host advertises `routines` (fleet rule: absent = unsupported).

Layout: desktop two columns — routine list (~280px, scrolls) | detail pane.
Mobile: the list, tapping a row swaps in the detail with a ← back control.

List rows: name, host chip (only when >1 host), schedule line (cron text +
"next in 3h" / "manual only" / "paused"), mode + onBusy in muted text, last
run status dot + relative time, invocation count. "+ New routine" at the top.
Status dots reuse the sidebar vocabulary: running = pulsing green, completed
= static green, errored/interrupted = `--danger`-ish token, skipped = muted.

Detail pane, top to bottom:
1. Editor form — name, description, host select (only when >1 capable host,
   create only; default self), harness select (from `/api/harnesses`), cwd
   (text input with the same `/api/dirs` fuzzy suggestions the new-session
   takeover uses — reuse that code, don't fork it), model select (reuse the
   new-session takeover's per-harness model rendering; "(default)" omits),
   thinking select, schedule (cron input + a presets `<select>` writing into
   it: every hour / daily 09:00 / weekdays 09:00 / weekly Monday 09:00 /
   none) with the server's 400 shown inline, enabled toggle, mode radio
   (One-shot / Continue) with one-line explanations, onBusy select, min
   interval (seconds), prompt textarea (mono, min 12 rows, grows). Buttons:
   Save, Run now, Delete (two-tap arm like session close). Unsaved-changes
   guard: switching routine with dirty form asks via `confirm`.
2. Invoke box — the curl for this routine's invoke route against the owning
   host (`host.base + '/api/routines/<id>/invoke'`, or the `/hosts/<name>`
   proxied form when the routine's host is a fleet peer reached through this
   hub), with a copy button (`copyTextToClipboard`). Mention `-d '{"input":…}'`.
3. Prompt versions — collapsed `<details>` "Prompt versions (N)", rows of
   version + saved time, "view" (read-only text below the row) and "restore"
   (writes the text into the textarea; saving then creates a new version —
   say so inline). Clicking a version row filters the invocations table to
   that version (toggle).
4. Invocations table — columns: version, trigger (+source), delivery, status,
   started (relative, title = absolute), duration, session (link →
   `selectSession` after a full unfiltered list reload if the sidebar lists
   don't hold it — the advanced-search click-through pattern), and a final
   cell for skipReason / error / closeError. "Load more" uses `nextBefore`.
   While the view is open, poll the selected routine's invocations every 10s
   (single-flight, stop on close).

Fleet: `/api/routines` fans out per capable host with `Promise.allSettled`
and per-host timeouts (20s), rendering progressively; every routine carries
`host` and all its calls go through `apiFetch(routine.host, …)`. Unreachable
hosts get the same quiet notice the usage view uses. On one host nothing of
this shows.

Sidebar rows: a session carrying `routine` shows a small `⏱ <name>` chip in
the third row beside the harness badge (one more chip, same styling family).

## Tests

- `test/cron.test.js` — parser/matcher/next: fields, lists, ranges, steps,
  names, Sunday 7, aliases, dom/dow either-rule, invalid inputs, next-match
  across day/month boundaries and a never-matching expression (Feb 30) → null.
- `test/routines.test.js` — store: validation, name uniqueness, version bump
  only on prompt change and the 50 cap keeping current, ledger cap + newest
  first, `invocationsBySessionId`. Runner with fake deps: invoke → starting →
  running → completed → close called after grace (grace pinned to ~0 via env),
  busy skip/steer/followUp branches, schedule tick fires once per minute and
  not twice, disabled routines don't fire, restart recovery, starting
  watchdog.
- `test/routines-api.test.js` — boots `server.js` with `PI_DISH_HEADLESS=rpc`
  and the `fake-rpc-pi.js` fixture (see `test/rpc-session.test.js` for the
  scaffolding): CRUD + 400/409 shapes; invoke → the fixture logs the prompt
  (with the `<invocation-input>` block); the invocation reaches `completed`
  with a summary and, in oneShot, `closed: true` with the RPC child gone;
  `/api/sessions?q=routine:<name>` finds the session while it exists; a
  `slow:` prompt holds a turn so a second invoke hits 409 (`onBusy: skip`)
  and, after switching to `steer`, delivers a steer the fixture logs;
  `continue` mode's second run prompts the same session; 429 with
  `minIntervalSec`; `?wait=1` returns a sessionId; DELETE keeps the ledger.
- `test/helpers.test.js` — `routine:` / `-routine:` terms.
- `test/ui-smoke.js` — open the takeover, create a routine, see it in the
  list, edit the prompt and see version 2, run now and see an invocation row
  land (configure the smoke server with the fake RPC pi if that is what it
  takes to spawn), and the sidebar chip on the resulting session.

## Docs

- `docs/agent/routines.md` — the invoke contract for scripts and agents:
  when to use a routine vs `sessions spawn`, the input block, status
  polling, `wait=1`, busy/rate-limit semantics, `routine:` search.
- CLAUDE.md section "Routines" (written by the integrator at the end).
- README: one short subsection under features.
