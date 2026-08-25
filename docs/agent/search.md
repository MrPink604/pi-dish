# Searching past sessions

Every session's transcript is indexed host-locally: prose, tool-call file
paths and command lines, and metadata. Treat the corpus as long-term memory —
before re-deriving a fix, config, or investigation, check whether a prior
session already did it.

```bash
search "jsonl torn tail recovery"
search "compaction cwd:~/work/api since:30d"
search '"exact phrase" -vendored model:opus' --limit 5 --json
search "session index compaction" --all-hosts
```

## Query grammar

One dialect everywhere (CLI, sidebar, advanced search):

- Plain terms match content and metadata. Distinct keywords beat repeating
  one keyword.
- `"quoted phrases"` match exactly.
- `-term` negation — metadata-only by design, so a negation can never hide a
  session whose transcript merely mentions the word.
- Field terms (metadata-only): `name:`, `cwd:`, `model:`, `id:`.
- `since:` / `before:` on last activity: `7d`, `12h`, `2w`, or ISO dates.
- `is:active` — live sessions only.
- Unknown prefixes stay literal text.

## Ranking

Relevance-ranked: name hits ≫ other metadata ≫ content occurrences (content
contribution grows logarithmically and caps, so coverage of distinct terms
beats repetition). Recency only breaks ties. Field/date-only queries are
purely recency-ordered. Content matches carry snippets showing *why* the
session matched.

## Fleet-wide search

Indexes are host-local. `--host <name>` searches one named host's corpus;
`--all-hosts` fans out to every reachable host advertising the `search`
capability and merges results client-side on the shared relevance score,
prefixing each row with its host. Hosts that fail or time out are reported
at the end — a partial result set is still a result set, but don't treat it
as exhaustive when hosts are listed as unanswered.

## Strategy

- Search finds the session; `read <ref>` reads it.
- If a first query misses, reformulate with terms you'd expect *in the
  transcript*: an error string, a file path, a command line. Tool args are
  indexed and are the recall keys coding sessions are usually found by.
- `# Session index is still building` means results are partial — retry
  shortly.
