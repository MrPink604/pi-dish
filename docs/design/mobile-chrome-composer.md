# Session chrome and composer redesign

Status: **implemented** (2026-09-10). Mock:
[`mobile-composer-mock.html`](mobile-composer-mock.html) (static, self-contained;
open it directly or publish it with the pi-dish-pages skill).

Deviations from the spec below, as built:

- The chip row carries run state and a cwd chip. Extension status badges and
  relation chips kept their own rows under it rather than joining the
  scroller: the status strip owns an expand toggle and clip behaviour that a
  shared scroller would break. No artifacts chip — the ⚙ panel already has
  that row.
- `#sessionContext` is the surviving id (the in-field readout), and
  `#sessionContextBar` is gone. An inactive session hides the composer, so
  the resume bar's existing `#inactiveStatsBtn` is the stats entry there.
- `.session-info` now takes the header width it is given (`flex: 1 1 auto`).
  Removing badges from the meta row had shrunk the column, which starved the
  relation strip's one-row fit calculation.

## Why

On a phone the composer's `.input-actions` row carried 📎, 🎙, the context
badge, the working timer, ⚙ and up to three turn buttons. Mid-turn it
overflowed and Follow-up could not be tapped. Moving the two tools into the
field (2026-09-09) bought width but left the row structurally overloaded: any
future control pushes the turn buttons off screen again.

The fix is structural, not another squeeze: the composer keeps only the field,
and session metadata moves into the header, which grows a fixed row for the
four controls that always matter and a scrolling row for everything else.

## Layout

### Header (mobile, `.session-header`)

Three rows. Rows 1 and 2 never scroll; row 3 scrolls horizontally with no
visible scrollbar (`overflow-x:auto; scrollbar-width:none;
&::-webkit-scrollbar{display:none}`).

1. **Title row** — ☰ · session name (ellipsized, tap to rename) · 🔍 search ·
   ⚙ controls. The cog keeps the entire existing `#controlPanel` sheet; the
   panel itself is unchanged by this work.
2. **Primary row** — the four controls that are always worth a tap, left to
   right: host chip (`#sessionHost`, hidden on single-host as today), harness
   glyph (`#sessionHarness`, hexagon icon, opens harness settings), model
   dropdown (`#sessionModel`), reasoning/thinking level (`#sessionThinking`).
   Only the model chip is flexible (`flex: 0 1 auto; min-width: 0`); the other
   three are `flex: none`, so a long model name never squeezes them.
3. **Chip row** — everything else, scrolling: run state first, then cwd,
   artifacts count, extension status badges, relation chips. The first cell is
   always the run state — `idle` when nothing is running, `● 0:06 · bash`
   mid-turn — so the eye lands in the same place.

Desktop header is unchanged (single row).

### Composer (both mobile and desktop)

`.input-actions` is deleted. Everything lives in the field:

```
┌───────────────────────────────────────────────┐
│ textarea                                      │
│                                               │
│ 📎  🎙                        12%   ■     ↑   │   idle: ↑ = send
│                                     (hidden)  │
└───────────────────────────────────────────────┘
┌───────────────────────────────────────────────┐
│ textarea                                      │
│                                          ⊙    │   mid-turn: ⊙ = steer
│ 📎  🎙                        48%   ■    ↵    │              ↵ = follow-up
└───────────────────────────────────────────────┘
```

- Left: attach, dictate.
- Right of the tool row: the context readout (tap = stats modal), then stop.
- Far right column (`.act`, **fixed 40px wide in both states**): the round
  filled Send button when idle; mid-turn it becomes steer (steering wheel) over
  follow-up (↵), stacked vertically **inside** the field.
- The stop button occupies its slot in both states (`visibility: hidden` when
  idle). Together with the fixed `.act` width this pins the context readout to
  one x-position — it must not shift when a turn starts or ends.
- Steer and follow-up are plain muted glyphs, identical treatment to
  attach/dictate: no bubble, no border, no colour. Stop is the only coloured
  glyph (`--error`). Send is the only filled one (`--accent`).
- No hint/legend line under the field. Discoverability comes from `title`
  (desktop hover) and `aria-label`.
- The attachment strip, queue strip and composer note still stack above the
  field, unchanged.

Mid-turn the field is ~30px taller than idle (two stacked glyphs vs one Send).
Accepted: shrinking the glyphs to fit 38px total makes them thumb-hostile.

## Removals

Delete, do not hide:

- **Message count** — `#sessionMsgCount` (index.html), its writes in
  `resetSessionHeader`/`updateSessionHeader` (app.js), and its mobile
  `display:none !important` rule.
- **Estimated session spend badge and its setting** — `#sessionSpendBadge`,
  `.session-spend-badge` CSS, `refreshSessionSpend()`, `spendFetchSeq`, the
  three call sites (session select, provisional reset, `turn_end`),
  `SESSION_SPEND_KEY` / `showSessionSpend` / the `#showSessionSpend`
  preference row and its listener in the settings modal, and the CLAUDE.md
  sentence naming `pi-dish-show-session-spend`. Spend stays available in the
  stats modal and the usage view — this removes only the header badge and the
  device-local toggle that fed it.
- **`.input-actions`, `.input-actions-meta`, `.input-actions-main`** and the
  2026-09-09 `.composer-tools` rail, superseded by the field layout above.
- **`#sessionContextBar`** — the mobile duplicate of the context badge. The
  in-field readout replaces it; `#sessionContext` stays as the desktop header
  badge until the composer readout covers desktop too, at which point it goes
  as well (the stats modal is still reachable from the in-field readout, and
  `test/browser/prime-close.spec.js` + `ui-smoke.js` open stats via
  `#sessionContext` — retarget those to the new control).

## Context readout tiers

`contextClass(percent)` in `public/helpers.js` changes from `>80 critical /
>50 high` to:

| percent | class      | colour              |
|---------|------------|---------------------|
| 0–33    | *(none)*   | `--text-bright`     |
| 34–66   | `high`     | `--warning`         |
| 67–100  | `critical` | `--error`           |

One rule, applied everywhere it is used today (sidebar rows, header badge,
in-field readout) — two different thresholds for the same number would be
worse than either.

## Model chip degradation

The chip shows the most signal that fits, degrading in this order:

1. Full ref as given (`anthropic/claude-opus-4-5`).
2. Provider slug dropped (`claude-opus-4-5`) — the existing
   `shortModelName()` already strips everything before the last `/` plus
   bedrock vendor prefixes, wire-format suffixes and date stamps. Reuse it.
3. Ellipsized name (`claude-opus…`) via CSS `text-overflow: ellipsis` on the
   flexible chip.

Never truncate before dropping the provider: the provider is the least
informative part. The `title` attribute keeps the full ref, and the dropdown
always lists names in full.

## Glyphs

No emoji. Stroke SVG, `currentColor`, `stroke-width` 1.7–1.8, sized 16–21px in
34–40px targets, same family as the SVGs already in `.session-actions`.

| Action     | Glyph                                                |
|------------|------------------------------------------------------|
| attach     | paperclip                                            |
| dictate    | mic (capsule + arc + stem)                           |
| recording  | mic with a diagonal slash, `--error`                 |
| send       | arrow-up in a filled `--accent` circle               |
| steer      | steering wheel: circle, hub, three spokes (L, R, down) |
| follow-up  | corner-down-left return arrow                        |
| stop       | rounded square, `--error`                            |
| harness    | hexagon (outer + inner), doubles as harness settings |

The mock's `D · Glyphs` panel holds the exact paths.

## Verification expectations

- `test/ui-scenarios/mobile.js`: replace the current composer/`input-actions`
  assertions with (a) row 2 renders all four controls unclipped at 390px with
  the model chip the only one that shrank, (b) row 3 scrolls
  (`scrollWidth > clientWidth`) and its first cell is the run state, (c) the
  context readout's `getBoundingClientRect().right` is identical idle and
  mid-turn, (d) steer and follow-up are inside the field's bounds and are
  reachable (`overflowing.length === 0`).
- `test/ui-smoke.js`: `#btnSend`/`#btnSteer`/`#btnStop` selectors survive (keep
  the ids on the new glyph buttons); `#sessionContext` stats-modal opens
  retarget to the in-field readout; drop the spend-preference coverage.
- `test/browser/prime-close.spec.js` opens the stats modal via
  `#sessionContext` — retarget.
- Run `npm run check`, `npm test`, `npm run test:browser`, `npm run test:ui`,
  `npm run test:ui:scenarios`, and take mobile + desktop screenshots of both
  composer states as proof.
