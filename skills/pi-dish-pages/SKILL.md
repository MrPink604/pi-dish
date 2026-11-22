---
name: pi-dish-pages
description: Publish an HTML file or directory as a hosted, shareable web page via the pi-dish server, optionally with an interactive form whose answers come back to this session. Use when asked to publish, host, or share a plan, report, dashboard, or any HTML artifact as a web page, when the user should get a clickable link to view generated HTML in a browser, or when you need the user to make many choices (image picks, approvals, yes/no, short answers).
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
lives on *this* host's disk; the hub only fronts it. Any hub that lists this
host as a remote finds a published page on its own at `/page/<token>` — `--via`
is not needed for reachability. Use it to get the hub's link back right away:

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

## Asking for answers: interactive forms

When you need many decisions from the user (gallery picks, approvals,
yes/no checks, notes), put **one** form block in the page instead of asking
for a reply in chat. The user answers it in pi-dish's own form view and
presses Submit; you receive one message in this session.

```html
<script type="application/pi-dish-form">
{
  "title": "Gallery picks",
  "intro": "One pick per row. Defaults are my predictions.",
  "fields": [
    { "id": "row4", "type": "grid", "label": "Row 4: interiors", "rows": [
      { "id": "4.1", "label": "Hero", "default": "A", "options": [
        { "value": "A", "image": "img/4.1-a.jpg" }, { "value": "B", "image": "img/4.1-b.jpg" } ] },
      { "id": "4.2", "label": "Kitchen", "default": "A", "options": [
        { "value": "A", "image": "img/4.2-a.jpg" }, { "value": "B", "image": "img/4.2-b.jpg" } ] }
    ] },
    { "id": "rule6", "type": "approve", "label": "Rule 6 still holds", "yes": "ok", "no": "not ok", "default": true },
    { "id": "names", "type": "yesno", "label": "File names ok?", "required": true },
    { "id": "notes", "type": "longtext", "label": "Anything else?" }
  ]
}
</script>
```

In the page, the block becomes a read-only preview of the form (with an
"Answer in pi-dish" link when the user opens the page from pi-dish). Format
(strict JSON; unknown keys are errors, so a typo is caught at publish):

- Top level: `fields` (required), optional `title`, `intro`, `submitLabel`.
- Every field: `id`, `type`, optional `label`, `help`, `required`, `default`.
  An `id` is 1-64 letters, digits, `.`, `_`, `:` or `-`, **starting with a
  letter or digit**, unique across the whole form (grid rows included); keep
  it stable, the answers are keyed by it.
- `choice` (one of `options`), `multi` (any of `options`; `default` is an
  array), `yesno` / `approve` (`default` true/false; optional `yes`/`no` labels,
  `approve` defaults to approve/reject), `text` (one line), `longtext`
  (paragraph); text fields accept `placeholder`.
- `grid`: a choice per row. `rows` is an array of `{ id, label?, help?,
  required?, default?, options? }`. **Defaults go on the rows**, never on the
  grid itself; `required` on the grid applies to every row. Give shared
  `options` on the grid or `options` per row (per-row options carry each
  row's images).
- `options`: strings, or `{ value, label?, image?, help? }`. `image` is a
  path relative to a directory page's `index.html`, an http(s) URL or a
  data:image URL.
- `default` is your predicted answer: it is preselected, and the reply
  reports only what the user changed.

Publish as usual. Invalid forms fail the publish with every problem listed
(for example `fields[2] ("4.2").default must be one of the option values (A, B)`);
fix them and publish again. The page must be published from this session (the
CLI identifies it) so answers know where to go; a private session cannot
publish a form.

For a form page the CLI's first line is the `/forms/<token>` path of
pi-dish's form view: give the user that link (relative, like `/page/` links).
The page itself and its public share link show the form read-only. With
`--via <hub>`, the CLI also prints the hub's answer path, but only when that
hub speaks this form protocol; otherwise it tells you to use this host's path.

Who can answer: whoever can drive this session. Behind an auth proxy (such as
Cloudflare Access) or `PI_DISH_TOKEN`, that means the signed-in user; on a
trusted network with neither, anyone who can reach pi-dish. No other website,
no script in your page and no public share link can submit. A host that uses
`PI_DISH_TOKEN` without an auth proxy cannot show the form view (it gets 401);
answers then have to go through a host behind an auth proxy. A private session
cannot publish a form. Publishing the same path from a different session gives
the page a new token: the old link and its answers end.

The answer arrives as a message like this, changed fields first:

```
[form response: Gallery picks (<token>), submitted 2026-11-22T14:03:05Z]
4.2: B (default A)
all other fields: default
names: yes
notes: Use the warmer crop on row 3.
full answer set: pi-dish-pages answers <token> --submission <id>
```

A resubmission arrives as `[form response revision 2: …]` and replaces the
earlier answers. Control characters in answers arrive escaped (`\x1b`); in an
OMP session, OMP prompt syntax in them (`^model`, `@file`, `+500k`, `ultrathink`
and the other magic keywords) arrives with a leading `\`, so it is text, not an instruction;
long answers or many fields are shortened
in the message. The footer names the exact answer set this message carries,
raw and complete; it is stored before the message is sent, so you can read it
at once with the CLI (a direct call to `/api/page-forms/<token>` must send
`X-Pi-Dish-Form-Client: cli`, or it is refused):

```bash
node ~/.pi/agent/skills/pi-dish-pages/scripts/pi-dish-pages.js answers <token> --submission <id>
node ~/.pi/agent/skills/pi-dish-pages/scripts/pi-dish-pages.js answers <token>   # latest delivered
```

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
  reachability through that hub — it is not rediscovered — while the page
  stays live on this host.
- Anyone who can reach the pi-dish server (and, if configured, its public
  share listener or a hub fronting it) can view the page. Don't publish
  secrets. Only pi-dish's own form view (`/forms/<token>`) can submit a form.
- Pages run sandboxed in an opaque origin. Scripts, forms, popups, relative
  assets and `fetch()` of files under the page work; `localStorage`,
  `sessionStorage`, IndexedDB and cookies throw, and the pi-dish API is not
  callable from the page. Keep page state in memory or the URL.
