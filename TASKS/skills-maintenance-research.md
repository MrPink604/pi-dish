# Research: Skill Curation & Maintenance Under Model Churn

**Status:** Research notes, 2026-07-31. Companion to `skills-view.md` (which
covers inventory/tokenization). This note covers the lifecycle question: how
do you keep skills effective as model releases churn, when you cannot capture
repo/machine state or run true A/B replays?

## The field's answer: you don't need full A/B — you need a ladder

Recent work converges on decomposing "is this skill still working?" into
questions that need progressively less captured state. Full counterfactual
replay sits at the top of the ladder and is only ever answerable for
self-contained tasks; everything below it is cheap and runs continuously.

### Layer 0 — Classify each skill first (its rot vector differs)

- **Capability-uplift skills** (teach the model to do something it's bad at)
  rot with *model releases* — the compensation becomes a distortion.
- **Knowledge/binding skills** (your conventions, infra, project facts the
  model can never know) rot with *environment changes*, not model changes.
- Corti's diagnostic: instructions written as *intent* ("match surrounding
  idiom") survive upgrades; instructions written as *workaround* ("CRITICAL:
  you MUST…") don't — newer models follow stale compensations *more*
  faithfully, so they over-trigger. Anthropic deleted ~80% of Claude Code's
  system prompt for Opus 5 and performance improved.

### Layer 1 — Contract linting (needs only the current machine, no replay)

"Skill Drift Is Contract Violation" (arXiv 2605.10990): extract the
environment-facing assumptions a skill's text encodes (pinned versions,
referenced commands/paths/APIs) and validate only those against the live
machine. Results: 0 false alarms across 599 negative cases (vs ~40% FP for
naive text-diff monitoring), 86% precision discovering live drift across 49
real skills, and contract localization lifted repair success 10%→78%.
This is the cheapest continuous staleness monitor that exists.

### Layer 2 — Trigger/selection evals (need only prompts, no repo state)

Whether the model *activates* the right skill on positive examples and skips
it on negatives depends only on the catalog text + a prompt — no environment.
This is also the layer model churn breaks first (description interpretation
shifts). Anthropic's skill-creator (eval/improve/benchmark modes) does
exactly this: golden prompts, blind comparator judges, description tuning for
under/over-triggering. "Skills in the wild" (2604.04323) found benefits
decline toward baseline as retrieval gets realistic — selection, not content,
is often the failing part.

### Layer 3 — Observational transcript mining (state already captured)

The trajectories already run *are* the captured state. Two signals:

- **Usage stats:** activation frequency, recency, per-project spread, and
  rough post-activation outcomes. The survey literature (2607.10113) calls
  this metadata decay: flag underused or historically problematic skills
  without rerunning anything.
- **Constraint adherence:** "Skill Coverage" (2606.20659) translates a
  skill's instructions into semi-structured constraints and LLM-judges
  whether past trajectories satisfied them. Finding: trajectories covered
  only ~39–46% of skill constraints on average — skills are routinely loaded
  and then substantially ignored, which frequency counts alone never reveal.

### Layer 4 — Self-contained golden tasks + the absorption probe

The practical A/B substitute: per skill, a handful of frozen, repo-independent
golden tasks. On each model release run two checks:

1. **Regression:** does the skill still pass its evals on the new model?
2. **Absorption:** does the new model pass *without* the skill loaded?
   Anthropic's explicit pruning rule: when the base model passes your evals
   skill-free, delete the capability-uplift skill.

Corti's migration order matters: baseline old model → swap model *only* and
measure (separates model regressions from scaffolding mismatch) → subtract
compensations first → re-add only what evals prove necessary.

### Forward provenance

"Verifier drift" — knowing *which* model change invalidated *which* skill —
is an open problem; exact history can't be reconstructed later. Record going
forward, at activation time: model ref, skill content hash, catalog hash.
Cheap now, enables absorption analysis across releases later.

## Sobering empirical context

- SWE-Skills-Bench (2603.15401): 39 of 49 skills gave zero pass-rate
  improvement (avg +1.2%); 7 specialized skills gained up to +30%; 3 skills
  *hurt* up to −10%, specifically via version-mismatched guidance conflicting
  with project context. Default posture: skills are a narrow intervention;
  curation > accumulation.
- "From Registry to Repository" (2607.00911), 23k personal-use skills: 53%
  never modified after adoption; maintenance is overwhelmingly additive, not
  refactoring. Nobody runs eval rigor voluntarily — passive/automatic
  staleness surfacing is the realistic intervention.

## Implications for pi / pi-dish (scope split)

- **pi-dish** owns Layer 3 (cross-session vantage over the JSONL corpus:
  frequency/recency/spread, sampled adherence judging) and the display of
  everything else. This strengthens the case that the skills view's durable
  core is the observational panel, not tokenization.
- **pi-side skill/extension** owns Layers 1–4 execution (contract linting,
  trigger evals, golden tasks, absorption probes) — agent-loop territory.
  A `/skill-checkup` style skill run after a model upgrade fits the existing
  handoff-skill pattern.
- Layer 0's taxonomy could be a frontmatter-adjacent annotation (uplift vs
  binding) so tooling knows which monitor applies to which skill.

## Sources

- Skill Drift Is Contract Violation — https://arxiv.org/abs/2605.10990
- Skill Coverage: A Test Adequacy Metric for Agent Skills — https://arxiv.org/abs/2606.20659
- From Registry to Repository (empirical maintenance study) — https://arxiv.org/abs/2607.00911
- Dynamic Agent Skills: Lifecycle Survey — https://arxiv.org/html/2607.10113v1
- SWE-Skills-Bench — https://arxiv.org/abs/2603.15401
- Skills in the wild — https://arxiv.org/abs/2604.04323
- Anthropic: Improving skill-creator (test/measure/refine) — https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills
- Corti: Your Prompts Are Technical Debt — https://corti.com/your-prompts-are-technical-debt-why-scaffolding-built-for-older-models-hinders-newer-ones/
- SkillWiki (runtime skill-health monitoring) — https://arxiv.org/pdf/2606.16523
- SkillsVote (lifecycle governance) — https://arxiv.org/pdf/2605.18401
