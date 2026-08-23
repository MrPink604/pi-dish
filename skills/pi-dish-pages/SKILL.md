---
name: pi-dish-pages
description: Publish an HTML file or directory as a hosted, shareable web page via the pi-dish server. Use when asked to publish, host, or share a plan, report, dashboard, or any HTML artifact as a web page, or when the user should get a clickable link to view generated HTML in a browser.
---

# Publish a page via pi-dish

pi-dish (the web UI the user drives this session from) hosts static pages.
You create the file(s) on disk, register the path once, and hand the user a
link. The content is served **live from disk** — after edits, the user just
refreshes; do not re-register.

## Steps

1. Write the artifact to disk. Prefer a single self-contained `.html` file
   (inline CSS/JS). If you need multiple files, put them in a directory with
   an `index.html` at its root and reference assets by relative path.

2. Register the **absolute** path with the pi-dish server:

   ```bash
   node ~/.pi/agent/skills/pi-dish-pages/scripts/pi-dish-pages.js publish \
     "$PWD/plan.html" --title "Refactor plan"
   ```

   The CLI discovers this session (via the comments skill, when installed) so
   comments left on the page route back to this agent, and prints the link to
   give the user. Add `--json` for the raw response. Equivalent curl:

   ```bash
   curl -s -X POST "${PI_DISH_URL:-http://localhost:3333}/api/pages" \
     -H 'Content-Type: application/json' \
     -d "{\"path\": \"$PWD/plan.html\", \"title\": \"Refactor plan\"}"
   ```

   (`PI_DISH_URL` is set in sessions spawned by pi-dish; the default port is
   3333. For a directory page, pass the directory path instead.)

3. The response looks like:

   ```json
   { "token": "…", "path": "/page/<token>", "url": null }
   ```

   Give the user a markdown link to `url` if it is non-null, otherwise to the
   relative `path` (e.g. `[Refactor plan](/page/<token>)`). The relative form
   is correct — it resolves against whatever address the user browses
   pi-dish at; do not prefix it with localhost.

## Publishing through a fleet hub

In a multi-host fleet one host is the public front door (a hub). A page still
lives on *this* host's disk; the hub only fronts it:

```bash
node ~/.pi/agent/skills/pi-dish-pages/scripts/pi-dish-pages.js publish \
  "$PWD/plan.html" --title "Refactor plan" --via <hub>
```

`<hub>` is a remote name from this host's `remotes` (see `GET /api/hosts`);
`PI_DISH_PUBLIC_VIA` sets a default so plain `publish` uses it. The call goes
out through this server's own `/hosts/<hub>` proxy — never talk to a hub
directly — and the CLI prints the hub link alongside the local one. Use the
hub link when the user is reaching pi-dish from outside this host.

If the hub is unreachable, is not in this host's fleet map, does not list this
host in its own, or runs a pi-dish too old for fleet artifacts, the CLI says
so and the local link still stands.

## Notes

- Re-registering the same path returns the same token — the link is stable
  across your edits.
- Passing the discovered session id lets comments left on the hosted page
  route back to this agent. If the comments skill is not installed, page
  publishing still works but artifact comments cannot wake the originating
  session automatically.
- Unpublish with `curl -X DELETE "$PI_DISH_URL/api/pages/<token>"`. That kills
  the page everywhere, including through any hub. Removing only the hub's
  mapping (`DELETE /api/fleet-artifacts/<token>` on the hub) ends public
  reachability while the page stays live on this host.
- Anyone who can reach the pi-dish server (and, if configured, its public
  share listener or a hub fronting it) can view the page. Don't publish
  secrets.
