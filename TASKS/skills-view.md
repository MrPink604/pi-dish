# Task: Skills Informational View

**Priority:** P1
**Status:** Proposed — research and Phase 1 scope
**Affects:** `extensions/pi-dish-bridge/index.ts`, `server.js`, `public/app.js`, `public/style.css`

## Decision

Start with a read-only Skills takeover in pi-dish. It should answer:

1. Which skills did Pi discover for this workspace/session?
2. Which of those skills are advertised to the model?
3. What text does Pi actually put in context at discovery and activation time?
4. How large is that text for the user's scoped models?
5. Which counts are exact, provider-reported, or heuristic?

Do not add invocation analytics, editing, optimization, or eval execution in
Phase 1. Preserve the data model and UI seams needed for those features later.

Phase 1 model-aware tokenization is deliberately limited to OpenAI and
Anthropic model families, including both families when invoked through Amazon
Bedrock. Other families remain on the universal estimate and are not
prerequisites for this view.

## Important Pi Semantics

### "Frontmatter cost" is not the startup cost

Pi scans skill frontmatter at startup, but its system prompt does not contain
the raw frontmatter. For every model-invocable skill, Pi emits:

```xml
<skill>
  <name>...</name>
  <description>...</description>
  <location>/absolute/path/to/SKILL.md</location>
</skill>
```

The catalog also has one shared instruction preamble and one
`<available_skills>` wrapper. Optional frontmatter such as `license`,
`compatibility`, `metadata`, and `allowed-tools` is not advertised. A skill
with `disable-model-invocation: true` is discovered and available as a manual
command, but excluded from the catalog.

The UI therefore needs distinct measurements:

| Measurement | Text being measured | When it matters |
|---|---|---|
| Advertised entry | Pi's escaped XML for name, description, and location | Every model call whose system prompt includes skills |
| Shared catalog overhead | Pi's behavioral instructions and outer XML wrapper | Once when at least one skill is advertised |
| Raw frontmatter | The source YAML block | Authoring information; not itself a startup cost |
| Automatic activation | Full `SKILL.md` content read through Pi's `read` tool | When the model chooses to load a skill |
| Explicit activation | Frontmatter-stripped body plus Pi's `<skill>` wrapper | When the user invokes `/skill:name` |
| Referenced resources | Individual files under `references/`, `scripts/`, etc. | Only if the model reads them |

These are content-token measurements, not complete API-request token counts.
Provider message wrappers, tool schemas, system-added tokens, and the rest of
the conversation are outside this view.

### Three states, not one

- **Discovered:** Pi found and parsed the skill.
- **Advertised:** Pi included the skill in the model-visible catalog.
- **Activated:** the model read its `SKILL.md`, or the user explicitly invoked
  `/skill:name`.

Phase 1 can report the first two exactly. The third requires telemetry and is
deferred.

### Skill scope is workspace-dependent

Pi discovers global, project, package, settings, and CLI skills. Project skills
also depend on the trusted working directory. A global inventory without a
workspace is therefore misleading.

The takeover should default to the currently selected session's workspace.
When no session is selected, it may use the new-session working directory, but
must label the scope. A workspace selector can be added if the existing session
context does not provide enough control.

For a live Pi session, the authoritative source is Pi itself:

- `before_agent_start` exposes `event.systemPromptOptions.skills`.
- `ctx.getSystemPromptOptions()` exposes Pi's currently loaded skills without
  reimplementing discovery.

The bridge should expose that structured inventory to pi-dish. A fallback
scanner is acceptable for an offline workspace only if it calls Pi's own skill
loader and returns Pi's diagnostics; do not create a second implementation of
Pi's discovery and collision rules.

## Tokenization Findings

There is no single open-source tokenizer that exactly covers every model Pi
can route to. Tokenization belongs to the underlying model family, not the
gateway/provider name. OpenRouter, Bedrock, Vercel AI Gateway, and other
routers make provider-only mapping especially unreliable.

Pi's exported `estimateTokens()` does not solve this. It accepts agent
messages, not arbitrary strings, and currently uses `ceil(characters / 4)`.
Pi documents that heuristic as conservative. Pi's `Model` metadata has no
tokenizer or encoding identifier.

The practical Phase 1 design is a small tiered adapter registry:

| Model family | Best available method | Phase 1 status | Precision label |
|---|---|---|---|
| OpenAI models, including known Azure and Bedrock Mantle equivalents | OpenAI `tiktoken`; the `dqbd/tiktoken` repository supplies Node WASM and pure-JS ports | Supported when the model-to-encoding mapping is explicit | `exact · local` |
| Anthropic Claude through the direct Anthropic API | Anthropic `POST /v1/messages/count_tokens` for the selected model | Supported after explicit user opt-in; cache by model and content hash | `provider count` |
| Anthropic Claude through a Region-specific Amazon Bedrock Runtime model | Bedrock Runtime `CountTokens` using the same Converse request shape, model ID, Region, and AWS credentials as Pi | Supported | `provider count · Bedrock` |
| Anthropic Claude through a Bedrock cross-Region profile that Runtime cannot count | Claude-only `/anthropic/v1/messages/count_tokens` on `bedrock-mantle` | Supported with a Bedrock API key or SigV4-signed request | `provider count · Bedrock` |
| Anthropic through another gateway, or unavailable credentials | Pi-compatible `ceil(characters / 4)` | Supported fallback | `estimate · chars/4` |
| Other model families | Pi-compatible `ceil(characters / 4)` | Out of model-aware scope | `estimate · chars/4` |

An "exact" badge means exact tokenization of the displayed text for a known
local encoding. It must not imply exact billing or full-request tokens.

Do not use `@anthropic-ai/tokenizer`. Anthropic's repository now says that its
algorithm is for older models and has not been accurate since Claude 3. The
current official path is the model-specific count endpoint. Anthropic describes
that endpoint's result as an estimate that can differ slightly from message
creation and can include unbilled system-added tokens, so it must not receive
the `exact` badge.

### Generic Anthropic-shaped count transport

Direct Anthropic and Bedrock Mantle use nearly the same count request and both
normalize to an `input_tokens` result. Represent them behind one
Anthropic-shaped adapter, with separate transports for routing and
authentication:

```ts
type AnthropicCountRoute = "anthropic" | "bedrock-mantle";

type AnthropicCountTarget = {
  route: AnthropicCountRoute;
  modelId: string;
  region?: string;
};

type AnthropicCountResult = {
  inputTokens: number;
  route: AnthropicCountRoute;
  modelId: string;
};
```

An endpoint URL alone is not sufficient. The transport also needs the
route-specific model ID and auth strategy:

| Route | Default endpoint | Authentication |
|---|---|---|
| Direct Anthropic | `https://api.anthropic.com/v1/messages/count_tokens` | `x-api-key`, or a bearer credential accepted by Anthropic; include `anthropic-version` |
| Bedrock Mantle | `https://bedrock-mantle.<region>.api.aws/anthropic/v1/messages/count_tokens` | Bedrock API key in `x-api-key`, or SigV4 signed for `bedrock-mantle` |

The browser should supply only a selected Pi model reference and the
server-known content selector. The server derives the route, model ID, Region,
endpoint, and auth from Pi's model registry. Do not let the tokenization API
accept arbitrary base URLs or request headers: that would create an SSRF and
credential-forwarding surface. If custom provider endpoints are needed later,
configure and allowlist them server-side.

Reuse pi-dish's existing Pi credential runtime rather than adding a tokenization
secret store. `lib/pi-sdk.js` already caches Pi's `ModelRuntime` and
`ModelRegistry`, and its branch-summary path calls
`registry.getApiKeyAndHeaders(model)` before an authenticated model request.
The counting adapters should use the same resolver:

- a direct Anthropic API key can authenticate the public count endpoint;
- a compatible Anthropic bearer credential can be forwarded in the
  server-side request;
- a Bedrock API key can authenticate Mantle;
- an AWS profile, IAM keys, ECS task role, or IRSA can sign Runtime and Mantle
  requests without exposing the resolved credentials;
- Pi credentials that are valid for interactive inference but rejected by the
  public Anthropic count endpoint must surface `count auth unavailable` and
  fall back to `chars/4`, rather than prompting the browser for a secret.

This last case matters for Anthropic login/OAuth variants: do not assume every
credential that Pi can use for inference is accepted by the public
`/v1/messages/count_tokens` API. Capability-probe the count route and keep the
failure actionable. A user who wants provider counts can configure a direct
Anthropic API key through Pi's normal credential path.

Keep Bedrock Runtime `CountTokens` as a separate adapter. Its request uses
Bedrock's `input.converse` or `input.invokeModel` shape and returns
`inputTokens`, so only the normalized result belongs to the common registry;
it is not an Anthropic-shaped HTTP transport.

### Recommended Phase 1 tokenization boundary

Ship these paths together:

1. A universal Pi-compatible estimate, including as the fallback.
2. The maintained `dqbd/tiktoken` package server-side for known OpenAI
   encodings, including GPT models invoked through Bedrock Mantle.
3. Anthropic's count endpoint, enabled by an explicit control in the takeover
   and only when the server has a compatible direct Anthropic credential.
4. Bedrock Runtime `CountTokens` for supported Claude model IDs.
5. The Claude-only Bedrock Mantle count endpoint for cross-Region Claude
   profiles that Runtime cannot count.

Do not send skill contents to Anthropic merely to render the initial page.
Before the first count request, explain that local skill text will be sent to
the selected provider (Anthropic or the user's AWS Bedrock account). Remember
the preference locally, allow it to be turned off, and never expose the
credential to the browser.

Anthropic counts should be cached by model ID, content hash, and measurement
kind. The endpoint is free but rate-limited and does not offer a batch request,
so use bounded concurrency. Treat each count as a measurement of that exact
request shape: standalone entry/body counts are useful for comparison but may
not sum exactly to a count of the combined catalog.

### Amazon Bedrock routes

Bedrock counting follows the selected Pi model's actual provider route. It does
not require a direct Anthropic API key.

For supported Region-specific Claude models, use
`@aws-sdk/client-bedrock-runtime`'s `CountTokensCommand` with the same model ID,
Region, credentials, and Converse request shape that Pi uses for inference.
Pi's installed AWS SDK already exports this command. The caller needs the
`bedrock:CountTokens` IAM action. AWS says this count matches what the same
`InvokeModel` or `Converse` input would be charged.

Some Claude models are available only through cross-Region inference profiles
that Bedrock Runtime cannot target for counting. For those models, AWS exposes:

```text
POST https://bedrock-mantle.<region>.api.aws/anthropic/v1/messages/count_tokens
```

That endpoint accepts Anthropic's count-tokens request shape. It supports a
Bedrock API key in `x-api-key`, or SigV4 with service name `bedrock-mantle` and
the `bedrock-mantle:CountTokens` IAM action. AWS SDKs do not currently expose a
Mantle method, so SigV4 authentication needs a small signed HTTP adapter.

The Mantle count route above is Claude-specific. Mantle also serves OpenAI
Responses and Chat Completions for GPT inference, but the Anthropic
count-tokens path explicitly rejects non-Anthropic models and AWS does not
currently document a parallel GPT count endpoint. GPT skills on Mantle should
therefore use local `tiktoken` for explicitly mapped encodings, falling back to
`chars/4` when the encoding is unknown. This measures displayed content, not
Bedrock request-wrapper or billing tokens.

Reuse Pi's existing Amazon Bedrock configuration:

- stored Bedrock API key / `AWS_BEARER_TOKEN_BEDROCK`;
- `AWS_PROFILE` or the standard AWS credential chain;
- ECS task roles and IRSA;
- `AWS_REGION` and Regions embedded in inference-profile ARNs;
- Bedrock Runtime endpoint/proxy overrides on the Runtime path.

Keep credentials server-side. Cache provider counts by route, Region, model ID
or ARN, request-shape version, measurement kind, and content hash. Prefer
capability probing and actionable diagnostics over a hard-coded list of models
that will become stale.

The Anthropic endpoint has practical limitations:

- transmit local skill text externally;
- need provider credentials and network availability;
- create latency and rate-limit failure modes;
- return a count, not token boundary data suitable for visualization.

Mistral, Gemini, and Hugging Face tokenizer support are explicitly deferred.
They can use the same registry later without changing the takeover's data
model.

### Tokenizer registry shape

Keep model matching explicit and inspectable:

```js
{
  modelRef: "openai/gpt-4.1",
  family: "openai",
  method: "local",
  precision: "exact",
  tokenizerId: "o200k_base",
  count: 123,
  tokens: [/* optional byte-safe display segments */],
  warning: null
}
```

Unknown aliases must fall back to the estimate instead of guessing an
encoding. Include a registry version in responses so cached counts can be
invalidated when model mappings change.

Token visualization must be byte-safe. BPE tokens can split a UTF-8 character,
so decoded token bytes cannot always be rendered as independent Unicode spans.
Counts can ship before colored token boundaries; when boundaries are added,
represent undecodable fragments explicitly rather than silently corrupting
text.

## Scoped-Model Behavior

pi-dish already mirrors Pi's preferred model scope:

- `GET /api/models` returns accessible models annotated with `enabled`.
- The annotation resolves `settings.enabledModels` patterns using Pi-like
  full `provider/id`, bare id, glob, alias-prefix, and thinking-suffix rules.
- No `enabledModels` setting means all accessible models are enabled.

The Skills view should reuse this endpoint and not invent another preference.
The model control should offer:

1. **Scoped models** — default when the user has an explicit scope.
2. **Current model** — default when there is no explicit scope and a session is
   selected.
3. **Pi estimate only** — fastest and always available.
4. **All accessible models** — explicit expansion, not the default.

Within the selected set, Phase 1 provides model-aware counts only for OpenAI
and Anthropic, including `amazon-bedrock` models whose underlying model ID is
OpenAI GPT or Anthropic Claude. Other selected models remain grouped under the
estimate instead of triggering extra adapters.

Several scoped models will share a tokenizer. The results table should group
identical tokenizer results, for example `o200k_base · 4 scoped models`, while
an expanded detail lists the model IDs. This avoids repeating identical
columns and makes unsupported mappings obvious.

## Phase 1 User Experience

Follow pi-dish's established main-pane takeover pattern, alongside Usage and
Search. The view is global but scoped to a workspace/session, so it should be
a `<main>`-level sibling rather than a modal.

### Header

- `Skills`
- workspace/session scope label
- model-scope control
- refresh
- close

Refresh must re-read Pi's current inventory and `GET /api/models`; skill and
model settings can change outside pi-dish.

### Summary row

- discovered skills
- advertised skills
- total advertised catalog footprint
- total activation content
- warning/diagnostic count

Every token number carries a compact `exact`, `provider`, or `estimate` badge.
The total advertised footprint includes the shared preamble exactly once.

### Inventory table

Default columns:

- skill name and description
- state (`advertised` or `manual only`)
- source/scope (`project`, `global`, `package`, `settings`, `CLI`)
- advertised entry tokens
- automatic activation tokens
- explicit activation tokens
- diagnostics

Sorting should include advertised cost and activation cost. Search should
match name, description, and path. Do not add a usage-frequency column until
telemetry exists; a blank or inferred value would imply data pi-dish does not
have.

### Skill detail

Open in a split/detail area inside the takeover, not a modal:

- parsed frontmatter
- exact Pi catalog fragment
- raw `SKILL.md`
- explicit `/skill:name` expansion
- bundled file tree with byte/word/token estimates
- diagnostics and shadow/collision information
- tokenizer method and mapped model IDs

A `Text` / `Tokens` toggle can show colored token boundaries only for adapters
that return boundaries. In Phase 1 this means OpenAI/tiktoken. Anthropic shows
the provider count without pretending token boundaries are available.
Unsupported models still show counts and an honest estimate badge.

## Suggested API Surface

The exact route names can change during implementation, but keep inventory and
tokenization separable:

```text
GET /api/skills?sessionId=...
GET /api/skills/:skillId/content?sessionId=...
POST /api/tokenize
```

`GET /api/skills` should return:

- scope identity (`sessionId`, `cwd`, trust/live status);
- Pi version;
- discovery diagnostics;
- discovered skills with stable IDs, source info, and advertised state;
- the shared catalog text and each exact catalog fragment;
- the exact explicit-activation text;
- file sizes and word counts;
- no full skill body unless requested by the detail endpoint.

`POST /api/tokenize` should accept a content selector or server-known skill ID,
not an arbitrary filesystem path. It should return results grouped by
tokenizer plus the model IDs represented by each result. Avoid returning
credentials, settings contents, or unrelated system-prompt/context-file text.
It should also reject client-supplied provider endpoints and auth headers.
Given a Pi model reference, server code selects direct Anthropic, Bedrock
Runtime, Bedrock Mantle, local `tiktoken`, or the universal fallback.

The bridge response is authoritative for live sessions. Treat
`getSystemPromptOptions()` as sensitive: extract only the skill fields needed
for this view rather than forwarding the whole object.

## Acceptance Criteria

- The Skills button opens a full main-pane takeover and closes on Escape,
  close, or session switch.
- The view clearly labels the workspace/session whose skill inventory is shown.
- The discovered and advertised sets match Pi for a live session.
- `disable-model-invocation: true` skills appear as `manual only` and add zero
  advertised cost.
- Advertised totals reproduce Pi's current formatted catalog, including XML
  escaping and one shared preamble.
- Automatic and explicit activation counts use their distinct source texts.
- The default model selection follows the user's Pi scoped models.
- Every count states whether it is exact-local, provider-counted, or estimated.
- Unknown models fall back safely and visibly to `chars/4`.
- OpenAI counts are local and exact for explicitly mapped encodings.
- Initial page load makes no Anthropic request.
- Enabling Anthropic counting clearly discloses that skill text is sent to the
  provider, keeps credentials server-side, caches results, and degrades to the
  estimate on unavailable credentials/network errors.
- Direct Anthropic and Bedrock Mantle share one normalized count interface,
  while keeping their endpoint, model-ID, and auth handling separate.
- The browser supplies a Pi model reference, never a provider endpoint, API
  key, bearer token, SigV4 material, or arbitrary auth headers.
- Token counting reuses Pi's credential resolver and does not introduce a
  second credential store.
- A Pi Anthropic credential rejected by the public count endpoint yields an
  actionable auth diagnostic and a visible estimate fallback.
- Region-specific Bedrock Claude models use Runtime `CountTokens`; unsupported
  cross-Region profiles fall back to the Claude-only Bedrock Mantle endpoint.
- Bedrock credential and Region resolution matches Pi, and missing
  `bedrock:CountTokens` or `bedrock-mantle:CountTokens` permissions surface as
  actionable diagnostics.
- GPT models invoked through Bedrock Mantle use local `tiktoken`; the UI does
  not claim a Bedrock provider count because Mantle has no documented GPT
  count endpoint.
- The obsolete `@anthropic-ai/tokenizer` package is not used for current Claude
  models.
- The layout works at desktop and phone widths and does not use a modal.

## Deferred Telemetry and Eval Design

### Invocation telemetry

Future analytics should record:

- skill ID and a content/catalog hash;
- session, turn, workspace, model, and Pi version;
- activation kind: model-selected read vs explicit `/skill:name`;
- whether the advertised catalog contained the skill at that turn;
- activation token measurement and tokenizer method.

Pi's `tool_execution_start` exposes `read` arguments and pi-dish already
forwards the event, so automatic `SKILL.md` reads can be recognized against the
authoritative inventory. Explicit invocation should get a dedicated bridge
event or marker; inferring it later from expanded text is brittle.

Persist compact per-session summaries in `lib/session-index.js`. Do not rescan
all JSONL files on every analytics request. Exact historical catalog exposure
cannot be reconstructed after skills or settings change, so record a catalog
hash/snapshot going forward. Older sessions can at best provide inferred
activations.

### Optimization and evals

When this grows beyond the informational pane:

- compare the same task with and without the skill;
- evaluate trigger selection separately from task execution, including
  positive and negative trigger examples;
- run against the user's scoped model set because skill utility and tokenizer
  cost change by model;
- use repeated trials and a holdout set;
- track pass rate, deterministic assertions, tool behavior, latency, and token
  overhead together;
- distinguish capabilities the base model now has from stable workflow or
  preference encoding that the skill should retain;
- launch improvement sessions through Pi's own SDK/harness so results match the
  product being optimized.

Recent benchmarks reinforce the need for counterfactual measurement. One
preprint found 39 of 49 software-engineering skills produced no pass-rate
improvement, average gain was 1.2%, token overhead reached 451%, and three
skills hurt performance because their guidance mismatched the project. Another
found skill benefits declined toward no-skill baselines as retrieval became
more realistic. Token compression work reports that shorter descriptions and
bodies can preserve or improve quality, but those are research results to
validate in Pi rather than universal guarantees.

## Existing Tools Worth Borrowing From

- **Skilled** — local TUI that extracts invocation evidence from several coding
  agents and shows frequency, trends, projects, recency, and stale/rising
  heuristics. It does not currently list Pi as a provider.
- **Microsoft Waza** — skill creation/eval framework with token count, profile,
  compare, suggestion, model comparison, replay, and an HTTP results dashboard.
- **agent-skills-eval** — with-skill/without-skill runs, judge and deterministic
  assertions, token/timing/tool-call evidence, and static HTML reports.
- **Agent Skills reference tooling** — useful for spec validation and
  progressive-disclosure conventions.

These are useful references or future integrations. None is a drop-in Pi
inventory plus exact cross-provider tokenizer view.

## Sources

Local Pi behavior:

- `node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js`
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts`
- `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`
- `lib/pi-sdk.js`

External:

- Agent Skills specification: https://agentskills.io/specification
- Agent Skills client integration: https://agentskills.io/client-implementation/adding-skills-support
- OpenAI tiktoken: https://github.com/openai/tiktoken
- Node tiktoken ports: https://github.com/dqbd/tiktoken
- Obsolete Anthropic local tokenizer (do not use for Claude 3+): https://github.com/anthropics/anthropic-tokenizer-typescript
- Hugging Face tokenizers: https://github.com/huggingface/tokenizers
- Mistral common/tokenizers: https://github.com/mistralai/mistral-common
- Anthropic token counting: https://platform.claude.com/docs/en/build-with-claude/token-counting
- Anthropic API authentication: https://platform.claude.com/docs/en/api/overview
- Amazon Bedrock CountTokens API: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_CountTokens.html
- Amazon Bedrock token counting and Claude Mantle fallback: https://docs.aws.amazon.com/bedrock/latest/userguide/count-tokens.html
- Amazon Bedrock OpenAI-compatible Mantle API: https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html
- Gemini token counting: https://ai.google.dev/gemini-api/docs/tokens
- Skilled: https://github.com/av/skilled
- Microsoft Waza: https://github.com/microsoft/waza
- agent-skills-eval: https://github.com/darkrishabh/agent-skills-eval
- Anthropic skill-creator methodology: https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills
- SWE-Skills-Bench: https://arxiv.org/abs/2603.15401
- Skills in the wild benchmark: https://arxiv.org/abs/2604.04323
- SkillReducer: https://arxiv.org/abs/2603.29919
