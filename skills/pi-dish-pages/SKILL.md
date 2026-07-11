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

## Notes

- Re-registering the same path returns the same token — the link is stable
  across your edits.
- Unpublish with `curl -X DELETE "$PI_DISH_URL/api/pages/<token>"`.
- Anyone who can reach the pi-dish server (and, if configured, its public
  share listener) can view the page. Don't publish secrets.
