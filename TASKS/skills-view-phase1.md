# Task: Skills View — Phase 1 Contract

**Priority:** P1
**Status:** Agreed shape (2026-07-31) — buildable contract
**Affects:** `lib/session-index.js`, new `lib/skills.js`, `server.js`,
`public/app.js`, `public/style.css`, `skills/pi-dish-skill-refine/`
**Mockup:** `pd-scratch/skills-mockup/` (index.html directory, detail.html
detail page — approved shape). **Supersedes** the Phase 1 UX/API sections of
`skills-view.md`; that file remains the reference for Pi catalog semantics
(frontmatter ≠ startup cost, discovered/advertised/activated) and for the
deferred tokenization/eval research. `skills-maintenance-research.md` is the
rationale (this view is "Layer 3").

## Scope

Observational only. Everything on screen derives from (a) Pi's own skill
discovery and (b) activation records mined from the session JSONL corpus via
the session index. No provider token counting (chars/4 + bytes only, all
badged `est`), no evals, no adherence judging, no per-workspace breakdown
charts, no frontmatter taxonomy. The view's convergence point is a "Refine
with an agent" button that starts a prefilled session; the refinement
methodology itself is pluggable and lives outside the view.

## Verified Pi mechanics this contract stands on (pi 0.80.x)

- `read` tool: optional `offset` (1-indexed) / `limit` args
  (`dist/core/tools/read.js`); defaults truncate at 2000 lines / 50KB
  (`truncate.js`) and the truncation notice ("[Truncated: showing N of M
  lines…]") is embedded in the tool result text. Tool-call args and results
  are in the JSONL.
- Explicit `/skill:name` expands the user message to
  `<skill name="…" location="…">…body…</skill>` (`agent-session.js`
  `expandSkillCommand`); pi's own `parseSkillBlock` regex
  (`agent-session.js` top) is the format to match. Expansion reads the whole
  body → counts as a full-content read for coverage.
- Catalog: `formatSkillsForPrompt` (`core/skills.js`) — shared preamble +
  `<available_skills>` of escaped name/description/location;
  `disable-model-invocation` skills excluded (manual only).

Re-verify these three on every pi bump (the integration test pins the
package version to the host's, so a bump is always a deliberate event).

## Data: activation mining (session-index build pass)

A third persisted index stream, `~/.pi/dish/session-index/skills.ndjson`
(same rules as meta/text: append-only, buffered, tombstones, torn-tail skip,
compaction). Mined during the existing per-file index parse — never a
separate corpus walk.

Detection, per JSONL entry:

- **read**: `read` tool call whose resolved `path` is `SKILL.md` under a
  known skill root or any file under a skill directory. Record
  `ranges` from offset/limit; when absent, `ranges: "all"` plus
  `truncatedTo` parsed from the result's truncation notice if present.
- **targeted**: bash tool call whose command references a skill-path token
  (reuse the `lib/file-mention.js` bash-path mining). `cat`/`sed -n` ranges
  are parsed when trivially parseable; grep-style access records **no
  ranges** — it is a touch, never fake line data.
- **explicit**: user message matching pi's skill-block format; `location`
  attribute identifies the skill. Full-body read.

Record shape (the primitive's unit):

```json
{ "skill": "/abs/path/to/SKILL.md", "file": "references/foo.md",
  "kind": "read|targeted|explicit", "ranges": [[1,250]] ,
  "ts": 1753912841000, "sessionId": "…", "entryId": "…",
  "cwd": "/home/…", "model": "provider/id" }
```

"Which files count as skill files" comes from the inventory scan (below) at
mining time, plus any path whose basename is `SKILL.md`. A skill deleted
later keeps its historical records (the directory can show orphans under a
"removed" note; don't prune data).

## Inventory (`lib/skills.js`)

Discovery calls **Pi's own loader** through the SDK runtime in
`lib/pi-sdk.js` (resourceLoader / skills API) — never a reimplementation of
discovery/collision rules. For a live selected session the bridge is
authoritative when available (skill fields only — don't forward whole
system-prompt options); the SDK scan is the offline/default path. Scope
default is **all workspaces** (global + every known project root from the
session lists); the scope chip filters.

Per skill: name, description, source kind, filePath, advertised flag,
diagnostics, body bytes + chars/4 estimate, exact catalog fragment + its
estimate, bundled file list with sizes. Shared preamble estimate reported
once at the summary level.

## API

- `GET /api/skills` — inventory + per-skill usage rollups (30d count,
  last-used ts, 12-week buckets, kind split, session count, distinct cwd
  count + top cwd). One request renders the directory.
- `GET /api/skills/activations` — the **primitive**: NDJSON stream of raw
  records, filters `skill`, `since`, `cwd`, `kind`. No pagination; it's a
  pipe for user scripts (work/home domain tooling builds on this).
- `GET /api/skills/coverage?skill=<path>` — current-version rollup: file
  mtime + content hash, per-file (bundle) touch counts, and for each
  markdown section of SKILL.md (heading split) lines + read fraction over
  the ranged reads with `ts >= mtime`. Also: mapped-read count,
  targeted-touch count (unmapped), and the headline "~N tok (est) never
  entered context". Reads with `ts < mtime` are excluded from the map but
  present in totals — the response says so.

Skill identity in the API is the absolute `SKILL.md` path (stable, matches
pi's `location`). All estimates carry `"precision": "estimate"`; there is no
other precision in Phase 1.

## UI (main-pane takeover, `.main.skills-open`)

Mutually exclusive with the other `<main>`-level takeovers; header row,
Escape/✕/session-switch close; opened from a sidebar-header button.

- **Directory** (mockup index.html): summary strip (discovered, advertised +
  catalog est, 30d activations, quiet>60d; one `inferred from tool calls`
  badge), filter input, sort (recent/most/least/largest/name), rows =
  name+description, source, ~tok est, 12-week single-hue sparkline
  (`--chart-1`, zero-weeks as `--chart-other` stubs), 30d, last-used
  (stale = warm-muted, never alarm-colored).
- **Detail** (mockup detail.html): in-takeover navigation (‹ back), not a
  modal. Coverage map is the centerpiece: headline unread-tokens estimate,
  caption with mapped/targeted split and since-last-edit anchor, section
  rows with read-fraction bars + `never read` tags, expandable line-level
  shading (text keeps text tokens; heat is gutter + low-alpha background).
  A short skill always read in full renders a single sentence, not a flat
  map. Side column: 26-week sparkline, kind split, one muted workspace
  sentence, single "latest activation →" transcript deep link, primitive
  snippet. No activation list.

## Refine launcher

Header button **"✎ Refine with an agent"** on the detail page. It opens the
existing new-session takeover prefilled: cwd = the skill's directory, draft =
an evidence bundle (skill path, usage stats, cold sections, coverage
endpoint URL) followed by the refine methodology reference. It never
auto-spawns; the user reviews the draft and sends.

The methodology is **pluggable at pi-dish launch**:

- `PI_DISH_REFINE=<value>` env (or `refine` in `~/.pi/dish/settings.json`,
  env wins): a value containing a path separator is a **markdown file path**
  — the draft tells the agent to read that file and follow it; a bare token
  is a **pi skill name** — the draft leads with `/skill:<name>`.
- Unset → the **vended default**: `skills/pi-dish-skill-refine/` ships in
  the repo (symlink into `~/.pi/agent/skills/` like the pages/comments
  skills, README-documented). If the vended skill isn't discovered at draft
  time, fall back to referencing its markdown by absolute path inside the
  repo — the button must work on a fresh checkout.

The default skill's methodology (kept modest): read the evidence + the
skill, ground-truth cold sections against a recent transcript, propose
trims/restructures, apply with the user, note that read-coverage ≠
adherence.

## Out of scope (deliberate)

Provider token counting and the count-endpoint adapter stack; eval/benchmark
execution; adherence judging; invocation telemetry beyond the mined records;
per-workspace charts; skill editing in the UI. The primitive is the
extension point for all of these.

## Acceptance

- Directory and detail match the approved mockups at desktop and phone
  widths; all counts badged `est`/`inferred`; no alarm styling for quiet
  skills.
- Mining is index-integrated: no full-corpus reparse per request
  (`PI_DISH_INDEX_SYNC_BUDGET=0` persistence test pattern extends to
  skills.ndjson).
- Coverage maps only ranged reads since the file's mtime; targeted accesses
  surface as counts, never line data; the flat case renders as prose.
- Explicit invocations are detected via pi's skill-block format, not
  heuristics; a `/skill:name` in a fixture JSONL shows as kind `explicit`.
- `GET /api/skills/activations` streams NDJSON and honors all four filters.
- The refine button drafts (never sends) a session; `PI_DISH_REFINE` as a
  path and as a skill name both change the draft; unset uses the vended
  default and works on a fresh checkout.
- Inventory comes from pi's loader/bridge — no second discovery
  implementation; `disable-model-invocation` shows `manual`, adds zero
  advertised cost.
- Tests: miner units (ranges, truncation-notice parse, skill-block parse,
  bash-path classification) in helpers/lib tests; endpoint coverage in
  server.test.js with fixture JSONL; ui-smoke extended for
  open-takeover → detail → refine-draft flow.
