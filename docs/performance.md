# Pane load performance

This note records the July 2026 performance audit for the chat transcript,
file/document viewer, and uncommitted-diff pane. Performance work in these
paths has a strict compatibility rule: rendered content, controls, streaming
latency, scroll behavior, comments, publishing, and small-diff defaults must
not regress.

## Baseline and findings

The functional baseline is green before optimization:

- `npm test`: 174 passing tests.
- `npm run test:ui`: full desktop/mobile smoke suite passing with no page or
  console errors.
- The transcript already fetches only the newest 50 display messages and
  pages older messages on demand. Streaming message updates are coalesced at
  50 ms on the server and incrementally rendered at 80 ms in the browser.
- Session metadata, messages, statistics, and corpus search already use
  mtime/size-revalidated caches.

The audit found these unprotected costs:

1. Static JavaScript and JSON/text API responses are sent without HTTP
   content encoding. Representative checked-in assets are 207,380 bytes for
   `app.js`, 352,131 bytes for `highlight.js`, and 488,663 bytes for
   `xterm.js`; gzip level 6 reduces those to 57,164, 94,740, and 121,074
   bytes respectively.
2. `xterm.js`, its addon, and its stylesheet are requested on every app load
   even when `/api/config` says the terminal feature is disabled.
3. Historical message images and file-viewer images are embedded as base64 in
   JSON. That adds roughly one-third encoding overhead, makes JSON parsing and
   string allocation carry binary data, and prevents the browser from
   deferring off-screen transcript images or caching them as resources.
4. A diff response includes every patch and the browser constructs every
   diff-line DOM node before showing the pane, even though changesets larger
   than six files start fully collapsed.
5. The head scripts for markdown and highlighting are parser-blocking even
   though the app does not render a transcript until after DOM readiness and
   an API round trip.

The existing suites cover the visible behaviors extensively, but did not
assert transfer encoding or size, SSE non-buffering, startup resource scope,
image resource behavior, or the large-diff path. Those gaps must be covered
before changing the implementation.

## Test-first contracts

The optimization tests enforce the following:

- Large static, chat JSON, and document JSON responses negotiate gzip, carry
  `Vary: Accept-Encoding`, round-trip byte-for-byte after decompression, and
  materially reduce wire bytes.
- `text/event-stream` is never compressed by the app middleware, preserving
  immediate SSE delivery without compressor buffering.
- Initial HTML does not reference terminal assets. The existing terminal-on
  browser suite must still open a working xterm, load its symbols font, resize,
  reconnect, and restart the shell.
- Historical transcript images and file-viewer images are resource URLs, not
  base64 JSON fields. The bytes and MIME type are preserved; transcript images
  use native lazy loading and still render successfully in the browser.
- Transcript pages intentionally loaded by scrolling or in-session search stay
  warm across brief session switches (five sessions, 15-minute TTL). Their
  finalized DOM is moved into a fragment and restored in place, avoiding a
  repeat tail download and markdown/highlighting pass; an incremental
  `after=` request still catches up newly appended messages.
- Diffs with at most six files retain inline patches and open-by-default
  behavior. Larger changesets omit collapsed patch bodies from the summary
  response; expanding a file fetches the same patch, after which line
  selection and anchored comments work as before.
- All pre-existing unit, API, integration, desktop, and mobile assertions
  continue to pass.

## Success measures

The implementation is considered successful when:

- compressible representative responses use no more than 50% of their prior
  identity-encoded wire bytes (the repeated-text fixtures should do much
  better);
- a terminal-disabled cold load transfers none of the approximately 497 KB of
  xterm JavaScript/CSS;
- chat and file image JSON contains metadata/URLs only, removing base64 binary
  payloads from pane bootstrap responses;
- a greater-than-six-file diff summary transfers no patch text and constructs
  no diff-line nodes until a file is expanded; the server uses status/numstat
  metadata and does not generate full patch text for that summary;
- the complete functional suites remain green.

## August 2026: long live OMP sessions and the Usage page

Opening a live OMP session with tens of MB of history, and the Usage page
while such a session streamed, had four unprotected O(whole-file) costs:

1. Every `/api/sessions/:id/messages` request for a live OMP session asked
   the bridge for the full serialized session tree (`tree_read`) when only
   the leaf id was needed, and `readSessionMessagesAtLeaf` re-read and
   re-parsed the entire JSONL per request — the initial tail page, every
   scroll-up page, and every catch-up each paid both costs.
2. A changed session file was JSON-parsed four separate times (metadata,
   usage, search text, skill mining) whenever the index refreshed it.
3. Any append — one streaming turn — invalidated the whole file, so every
   sidebar poll and usage refresh re-parsed all of it.
4. Per-poll session metadata (`getSessionInfo`) bypassed the persistent index
   entirely and re-parsed the file on every append.

The fixes, in the same compatibility frame (transcript rendering, pagination,
active-tree semantics, scroll behavior, streaming, and Usage output must not
change):

- `readSessionMessagesAtLeaf` now uses the mtime/size cache keyed by leaf id,
  so one parse serves all pages and catch-ups until the file or leaf changes.
- The bridge gained a `tree_leaf` RPC returning only the live leaf id; the
  messages route prefers it and falls back to `tree_read` once per connection
  for bridge extensions loaded before the command existed.
- The session index parses a changed file once and feeds all four derivations
  from the same entries array.
- A file that only grew extends all index tables from just the appended byte
  range (`tryExtendIndexEntry`), with continuity state (provider/model/cwd)
  persisted alongside usage and skill records. Anything else — branch jumps,
  rewrites, schema or pricing changes — still falls back to a full re-parse.
- Server-side `getSessionInfo` is index-backed, returning the same public
  shape (index-internal identity and usage fields are stripped).

Regression contracts: the append-extension must be observationally identical
to a full re-index for metadata, usage (totals, days, models, continuity),
search text, and skill records; a zero-sync-budget scan proves structurally
that an appended file was served by the extension; index-internal fields must
not leak from `getSessionInfo`.

Measured on a synthetic 28.1 MB / 15,002-entry OMP session: transcript
requests after the first parse dropped from ~200 ms to ~0.02 ms; a scan or
metadata poll after one appended turn dropped from ~240 ms (full four-way
re-parse) to ~0.5 ms.

Follow-up profiling with OMP's default snapcompact strategy found a separate
cold-load cost: every compaction record can retain many megabytes of base64
frame data in `preserveData`. Pi-dish does not display or index those frames,
but it still JSON-parsed and retained every archive while deriving the active
tree. Large OMP compaction records are now parsed through the last semantic
compaction field while omitting only the trailing archive, with a full-parse
fallback for nonstandard record ordering. Transcript loading also no longer
awaits OMP's optional model-pricing catalog refresh; a slow or timing-out
catalog command cannot hold the conversation pane behind pricing metadata.

## Research basis

The implementation follows the Express-maintained `compression` middleware
guidance and explicitly excludes SSE because compressor windows otherwise
buffer event delivery. HTTP content negotiation requires
`Vary: Accept-Encoding`. Git's machine-readable diff statistics and pathspec
support informed the diff split, although the first implementation keeps one
authoritative aggregate snapshot so patch metadata and content cannot drift
within an open pane. Browser script deferral is used only where execution
order and DOM-ready behavior remain deterministic.
