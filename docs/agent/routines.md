# Routines and invocations

A routine is a named, reusable session template; invoking one spawns (or
reuses) a session, delivers the routine's prompt, and records the run. Cron
schedules and HTTP invokes are the two triggers.

## Routine or `sessions spawn`?

Use `sessions spawn` for one-off work: you already know the prompt, you want
the session now, and nothing will run it again.

Reach for a routine when the *same* prompt runs repeatedly and you want the
runs linked: a nightly review, a health check a relay fires on a webhook, a
"triage this PR" entry point some other system calls. Three things a routine
gives that a spawn does not — a stable name to invoke, a cadence pi-dish
actually keeps (nothing else in the stack is a daemon), and a ledger tying
each run to the prompt version that produced it.

What a routine is *not* is an automation engine. There is no chaining, no
conditional glue, no "if the review finds X then Y". A routine that wants
another routine's work runs the peer-sessions CLI from inside its own session.

## Invoking

```
POST /api/routines/<id-or-name>/invoke
{ "input": { … }, "source": "github-webhook" }
```

`<id-or-name>` is the routine's uuid or its name. `source` is a free label
(≤100 chars) for who fired it. Both fields are optional.

The reply is `202 { invocation }` with `status: "starting"` — the spawn is
still in flight. Add `?wait=1` to block until the record leaves `starting`
(up to 60s, then it returns whatever it is) and get `200 { invocation }` back,
which is the usual way to learn the `sessionId`.

Other outcomes:

| Status | Meaning |
|---|---|
| 404 | no routine by that id or name |
| 409 | the routine is busy and its `onBusy` is `skip`; the body carries the running `invocation` |
| 413 | `input` serializes to more than 32 KB |
| 429 | `minIntervalSec` has not elapsed; the body carries `retryAfterSec` and `lastInvocation` |

A 429 is not recorded — an invoke storm would otherwise fill the ledger with
nothing but its own rejections.

## The input block

`input` is appended to the routine's prompt, never substituted into it (the
same rule `<session-refs>` follows — there is no templating language here):

```
<the routine's prompt>

<invocation-input source="github-webhook" invocation="<uuid>">
{
  "pr": 42
}
</invocation-input>
```

The `source` attribute is omitted when the caller sent none. `#ref` tokens in
a routine's prompt expand exactly as they would from the composer, so a
routine can hand its session a handle to another one.

## Watching a run

```
GET /api/routine-invocations/<id>
GET /api/routines/<id-or-name>/invocations?limit=50&before=<startedAt>
```

Invocations are newest first; `nextBefore` in the list response is the cursor
for the next page. Statuses:

- `starting` — spawn or resume in flight (a run stuck here for two minutes
  becomes `errored`)
- `running` — the prompt was delivered
- `completed` — the observed turn ended
- `interrupted` — the turn ended without completing, the session went away, or
  pi-dish restarted mid-run
- `errored` — the spawn, resume or delivery failed; see `error`
- `skipped` — never started; see `skipReason` (`busy` or `disabled`)

`summary` is the last assistant text of the observed turn, trimmed to 500
characters. It is a receipt, not a verdict: pi-dish does not classify
outcomes, so "did the review find anything" is something the prompt has to
make the agent say.

There are no callbacks out of pi-dish. Poll the invocation, or watch the
session's own event stream once you have its `sessionId`.

## Modes and busy behavior

`mode: "oneShot"` (the default) spawns a fresh session per run and closes it
about ten seconds after the turn ends. A harness that cannot prove it may
close the session leaves it live and records `closeError` — pi-dish never
escalates.

`mode: "continue"` keeps one session across runs: live and idle means a new
prompt, gone means a headless resume, and only a failure of both spawns fresh.
It never auto-closes.

A routine is *busy* while it has an invocation in `starting` or `running`.
`onBusy` decides what an invoke does then: `skip` (409), `steer` (delivered
into the running turn), or `followUp` (queued for after it). Scheduled ticks
always skip a busy routine — a cadence is a cadence, not a backlog.

Note the approximation for `steer`/`followUp`: the invocation completes at the
*next* `turn_end` after delivery, which for a follow-up may be a later turn
than the one it belongs to.

## Schedules

`schedule: { cron: "0 9 * * 1-5" }`, evaluated in the host's local time.
Standard five fields with lists, ranges, steps (`*/15`, `1-5/2`), three-letter
month/day names, `7` for Sunday, and the `@hourly` / `@daily` / `@weekly` /
`@monthly` aliases. A bad expression is a 400 with the parse error.

`enabled: false` arms only the schedule off — invoke still works. Minutes
missed while pi-dish was down are **not** caught up.

## Finding a routine's sessions

Every session a routine produced is stamped with its name, so the ordinary
query grammar reaches them:

```
routine:nightly-review          # sessions this routine produced
routine:nightly-review is:active
-routine:nightly-review         # everything else
```

That works in `sessions search`, the sidebar, advanced search, and saved
scopes. Plain terms deliberately do *not* match a routine name — searching
`nightly-review` finds transcripts that mention it, not runs of it.

Transcript, cost, duration and model usage all come from the ordinary session
views: a routine is a session template and an invocation is a session, so
there is no second history to consult.

## Defining one

```
POST /api/routines
{ "name": "nightly-review", "cwd": "~/work/pi-dish", "prompt": "…",
  "harness": "pi", "model": "anthropic/claude-…", "thinking": "medium",
  "schedule": { "cron": "0 22 * * *" }, "mode": "oneShot",
  "onBusy": "skip", "minIntervalSec": 300 }
```

`name` is lowercase letters, digits and dashes (≤48 chars) and unique on the
host; `cwd` is required and absolute or `~`-relative. `PUT` takes a partial
update. Saving a *changed* prompt appends a version and bumps `promptVersion`;
every invocation records the version it ran, which is the whole point of
keeping them. `DELETE` removes the definition and keeps the ledger — the
sessions it produced are untouched.

The host advertises `routines` in `GET /api/host` capabilities. On another
fleet host, prefix any of these with `/hosts/<name>`.
