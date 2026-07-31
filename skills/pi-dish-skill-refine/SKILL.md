---
name: pi-dish-skill-refine
description: Refine an existing agent skill using pi-dish's observed usage and read-coverage evidence. Use when asked to improve, trim, tighten, or restructure a SKILL.md based on how it is actually being read in real sessions.
---

# Refine a skill from usage evidence

pi-dish's Skills view drafts a session pointed at one skill, carrying evidence
mined from the session corpus: which sections of the `SKILL.md` were actually
read into context, which were never touched, how often the skill activates,
and where. Your job is to turn that evidence into a concrete, modest revision
— **with the user**, not unilaterally.

The evidence is observational and estimated:

- Token counts are `chars / 4` estimates, never provider counts.
- "Read coverage" is mined from `read`/`bash` tool calls, mapped to the
  **current** file version only. It shows what entered context — **not**
  whether the agent followed it. A never-read section is a strong hint, not a
  verdict.

## Method (keep it modest)

1. **Read the evidence, then the skill.** The draft names the skill path and
   links its coverage (`/api/skills/coverage?skill=…`) and raw activations
   (`/api/skills/activations?skill=…`). Fetch them if you want the detail.
   Then read the whole `SKILL.md`.

2. **Ground-truth the cold sections.** For each section flagged "never read
   since the last edit", open one recent activating transcript (the coverage
   payload names the latest one) and check whether the task simply never
   needed it, or whether the agent needed it and worked around its absence.
   Only the first case justifies a trim.

3. **Propose, don't rewrite blind.** Suggest specific trims, merges, or
   restructures — shorter description, tighter triggers, moving rarely-read
   detail into a bundled `references/` file the model loads on demand. Show
   the diff and the rationale.

4. **Apply with the user.** Make the edits they approve. Leave the frontmatter
   `name`/`description` accurate — the description is the whole advertised
   trigger surface.

5. **Note the limits.** Read-coverage ≠ adherence, and estimates ≠ billed
   tokens. Say so when you present results, and prefer reversible changes.

Do not run evals or benchmarks here — this skill is the observational
refinement loop, not a measurement harness.
