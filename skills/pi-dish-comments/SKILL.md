---
name: pi-dish-comments
description: Discover, inspect, and acknowledge anchored review comments created in pi-dish on files, git diff lines, or published HTML artifacts. Use when the user asks to review, address, check, read, or continue pi-dish comments or feedback.
---

# Review pi-dish comments

Use the bundled CLI to inventory comments, infer useful groups, and fetch the
chosen groups after the user asks to read comments. Comments are either open
or acknowledged; do not reply to them or invent additional states. Never
start or queue a turn merely because comments exist—the user's request is the
authorization to read and act on them.

## Workflow

1. Enumerate every open comment as a lightweight index:

   ```bash
   node ~/.pi/agent/skills/pi-dish-comments/scripts/pi-dish-comments.js list --json
   ```

   The CLI discovers this pi session from the bridge registry and process
   ancestry. Use `--session <id>` only if discovery reports ambiguity.

2. Infer coherent groups from the index. Prefer comments that share a file,
   artifact, subsystem, dependency, or requested outcome. Do not assume
   creation order is implementation order.

3. Fetch the full comments for one chosen group:

   ```bash
   node ~/.pi/agent/skills/pi-dish-comments/scripts/pi-dish-comments.js get <id> [<id> ...] --json
   ```

   Listing and fetching do not change comment state. Fetch any other group at
   any time; acknowledgment is never required for navigation.

4. Read each anchor before acting:

   - `file`: inspect the current file around `startLine`/`endLine` or `quote`.
   - `diff`: inspect the current diff at the old/new line range; the saved
     quote is context, not a patch to apply literally.
   - `page`: inspect the artifact source at `root` and use the selected prose
     quote plus prefix/suffix to find the intended passage.

5. Address the coherent group. Validate changes in proportion to their risk.

6. Acknowledge only comments actually handled:

   ```bash
   node ~/.pi/agent/skills/pi-dish-comments/scripts/pi-dish-comments.js ack <id> [<id> ...]
   ```

7. Select another relevant group from the existing index or run `list` again
   to refresh it. Do not load every full comment merely because it exists.

If a comment is unclear, stale, or cannot be handled, leave it open and tell
the user what blocks it. It remains available through `list` and `get` until
acknowledged.

## Commands

```bash
# Compact inventory of every open comment
node ~/.pi/agent/skills/pi-dish-comments/scripts/pi-dish-comments.js list

# Full contents for an agent-selected group
node ~/.pi/agent/skills/pi-dish-comments/scripts/pi-dish-comments.js get <id> [<id> ...]

# Count open comments without loading their contents
node ~/.pi/agent/skills/pi-dish-comments/scripts/pi-dish-comments.js count

# Print the auto-discovered session id
node ~/.pi/agent/skills/pi-dish-comments/scripts/pi-dish-comments.js session
```

Set `PI_DISH_URL` to override the server URL. It defaults to
`http://127.0.0.1:3333`.
