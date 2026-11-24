---
name: pi-dish-review
description: Ask the user for design sign-off, visual picks or several decisions as a short deck of cards shown inline in this session's pi-dish transcript, one card at a time with your recommended answers preselected. Use instead of piling questions at the end of a document or message, or putting a form on a published page.
---

# Ask with a review deck

Use a deck whenever you need two or more decisions or any visual pick. Write
the deck as JSON and post it; by default the CLI waits and prints the answers:

```bash
node ~/.pi/agent/skills/pi-dish-review/scripts/pi-dish-review.js ask review.json
```

`--no-wait` posts and returns: end your turn; the answers arrive later in this
session as a `[review response: …]` message (also what happens if your wait is
cut off). Bots call the `request_review` tool instead. `--help` shows the
format; `answers <id>` prints a deck's answers as JSON (and looks across fleet
peers when the deck lives on another host; `--host <name>` or `<host>/<id>`
targets a host directly).

```json
{ "title": "Halden part looks", "companionPage": "/page/<token>",
  "cards": [{ "id": "mags", "title": "Magazines (2 of 4)",
    "context": "Pick one shape per magazine. Each shot shows the AR, Scout and standalone views.",
    "media": [{ "src": "renders/mag-tab.png", "label": "5.1 tab · 2.1k tris" }],
    "questions": [{ "id": "quick_mag", "type": "choice", "prompt": "Quick Magazine shape?",
      "options": [{ "value": "tab", "label": "5.1 tab", "description": "Steel box, side slot" }, "vial"],
      "default": "tab", "why": "Reads at a glance at ADS distance" }] }] }
```

Types: `choice`, `multi` (`default` is a list), `approve` (`default`
`"approve"`/`"revise"`), `text`. Hard limits, refused with a 400: 1-6 cards,
1-3 questions and 0-4 shots per card, `context` at most 500 characters. Shots
are image files this session can reach (its directory, files your tools
touched), `/page/<token>/…` paths or https URLs.

## Rules for readable reviews

1. **Pages show; cards ask.** Full turnarounds, proof runs and deep reference
   go on a `/page/<token>` (`companionPage`); every decision goes in a deck.
2. **One idea per card, at most 3 questions.** Group by one coherent slice
   ("Barrels", "Sight ADS"); never one list of unrelated questions.
3. **Lead with the decision and restate context on each card.** One short
   paragraph: what is decided and what changes in the build, with the
   constraint or trade-off, so the user never has to scroll back.
4. **Show, don't tell.** Attach the 1-4 crops the decision depends on, labelled.
   Never mention bare host paths in prose.
5. **Simplify the axis before asking.** Fix one example and vary one thing; if
   breadth costs little, build them all instead of asking to prune.
6. **Preselect your recommendation on every question** with a one-line `why`.
   Agreeing should take one tap.
7. **Label model comparisons by model, never blind** (`Astra 6.2 (omp high) · 8.9k tris`).
8. **No duplication or ceremony.** Do not repeat the cards in chat, do not
   re-ask unanswered questions in status messages, no ledgers or self-scores.
9. **Leave room to punt.** Keep `allowOther` (on by default); if an answer
   raises one quick ambiguity, follow up with a one-card deck.
