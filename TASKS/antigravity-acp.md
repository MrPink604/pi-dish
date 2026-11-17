# Spike: Antigravity CLI (`agy`) through ACP

**Priority:** P2
**Status:** Spike complete (2026-11-17). Not implemented. Feasible; the
binding constraint is Google's terms, not the protocol.
**Affects (if built):** new `src/core/acp-session.ts`, `contracts.ts`,
`harnesses.ts`, `session-capabilities.ts`, `session-ownership.ts`,
`session-catalog-runtime.ts`, `session-launch.ts`, `session-operations.ts`,
`session-hibernation.ts`, prompt-origin gates in `routine-runner.ts`,
`recovery-runner.ts` and `session-command-handlers.ts`, generated `lib/`, tests.

## Goal

Use an Antigravity subscription from pi-dish without the pattern Google bans:
a third-party harness reusing Antigravity OAuth tokens. The candidate is to
drive Google's own, unmodified `agy acp` binary as an
[Agent Client Protocol](https://agentclientprotocol.com) server, with pi-dish
acting as an ACP client the same way Zed or JetBrains do. `agy` keeps its own
sign-in, tools, settings and transcript store.

## Verdict

ACP is the correct mechanism, and pi-dish can stay on the permitted side
**only as an interactive client**. With consumer sign-in (`oauth-personal`, the
Pro/Ultra subscription), every prompt sent to an `agy` session must come
from the user typing in pi-dish. Anything pi-dish or another agent generates
programmatically must be refused for `agy` sessions.

### Terms boundary (primary sources)

- [Additional Terms §6](https://antigravity.google/terms): "Using third party
  software, tools, or services to access the Service (e.g. using OpenClaw
  with Antigravity OAuth) is a breach of this Agreement."
- [FAQ](https://antigravity.google/docs/faq): "Wrapping `agy` inside
  third-party coding agents or applications … is not supported under consumer
  plans"; violations "can result in suspension or termination".
- A Google maintainer clarified the line in
  [antigravity-cli#1493](https://github.com/google-antigravity/antigravity-cli/issues/1493)
  (2026-11-12):
  - Permitted: "Any interactive ACP v1 client, including … custom or
    non-editor interactive ACP UIs, may launch the unmodified `agy acp`
    binary when a human user is directly driving the session." The
    accept-edits and auto modes are fine "within a session you initiate and
    supervise yourself".
  - Not permitted on `oauth-personal`: "using `agy acp` as a backend worker
    inside a third-party coding agent, autonomous agent harness, or background
    orchestrator"; "another agent, autonomous loop, or background task queue
    generat[ing] prompts"; "overriding Antigravity's system identity
    instructions"; and "automating account rotation". There is "no carve-out
    for single-account or personal use", and such traffic "is subject to
    automated abuse enforcement".
  - Unrestricted alternatives: `gemini-api-key` (`GEMINI_API_KEY`) and
    `agent-platform` (GCP ADC), which fall under the API and Cloud terms.
- The reporter's follow-up asked whether a framework injecting a system
  prompt and history counts as a harness. **That question is unanswered.**
  pi-dish should not inject any prompt text into `agy` sessions.

Automated enforcement can only classify traffic it sees. This spike cannot
verify how Google detects it. `agy` sends ACP `clientInfo` upstream in its own
client metadata **[INFERENCE: from `ClientInfo` protobuf symbols in the binary,
not observed on the wire]**, so pi-dish must identify itself honestly.

### Hard rules for any implementation

1. Launch the unmodified `agy acp`. Never use `--override_user_agent_name`
   (present in `agy acp --help`). Never send a `clientInfo` that impersonates
   another client. t3code sent `{name:"zed"}` to `agy` below 1.5.1 to unlock
   non-Gemini models; do not copy this.
2. Never read, copy or refresh `agy`'s token files (`acp_token.json`, keyring
   entries). t3code's usage-limit probe does this; do not copy it.
3. Do not use `_meta.antigravity.systemPrompt.append`, even though `initialize`
   advertises it. Do not inject preambles, skills text or history into prompts.
4. On `oauth-personal`, accept only prompts typed by a human: browser prompt,
   steer, follow-up and permission/question answers. Refuse these sources
   with a 409 that explains the restriction: routines, recovery
   auto-continue, the `pi-dish-sessions` peer-control CLI, peer message holds,
   `#ref` delegation and agent spawns. With `gemini-api-key` or
   `agent-platform`, the gate can be lifted.
5. One account per pi-dish host. Never rotate accounts.

## Alternatives considered

| Option | ToS risk on subscription | Phone UX | Work |
|---|---|---|---|
| A. Google's [Remote Control](https://antigravity.google/docs/remote-control) (`agy --remote-control`, `agy remote-control start`, web UI at antigravity.google.com) | None: first-party | Google's web UI, push notifications | None |
| B. `agy` TUI as a tmux-only harness: pi-dish launches `agy --remote-control` in a managed pane and exposes the terminal view plus Google's remote link | None: pi-dish starts the official TUI and a human types into it | pi-dish terminal view, not the transcript UI | S |
| C. pi-dish ACP client for `agy acp` (this spike) | Low if rule 4 holds; undefined at the edges | Native pi-dish transcript, tools, approvals | L |
| D. Reuse Antigravity OAuth in Pi/OMP/opencode | Explicit §6 breach | — | Rejected |

A is the zero-risk baseline and already gives phone control. C is what
"agy inside pi-dish" means.

## Executable spike results (2026-11-17)

Environment: `agy` 1.5.10 installed with the official `install.sh --dir` into
`/tmp/agy-spike/bin` with `HOME=/tmp/agy-spike/home`. No sign-in. No model
request was sent. A Node probe sent `initialize`, then `session/new`, then
`session/list` over stdio.

`initialize` with `clientInfo {name:"pi-dish"}` and no `fs`/`terminal` client
capabilities returned:

```json
{
  "protocolVersion": 1,
  "agentInfo": { "name": "Antigravity ACP Server", "version": "1.5.10" },
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": { "image": true, "audio": false, "embeddedContext": true },
    "sessionCapabilities": { "resume": {}, "close": {}, "load": {}, "list": {}, "additionalDirectories": {} },
    "auth": { "logout": {} },
    "_meta": { "antigravity": { "tier": true, "systemPrompt": { "append": true } } }
  },
  "authMethods": ["oauth-personal", "oauth-business", "gemini-api-key", "agent-platform"]
}
```

(`authMethods` is abbreviated to ids. The binary also sends snake_case
duplicates of the capability keys.)

- Without credentials, `session/new` and `session/list` both fail with
  `{"code":-32000,"message":"Authentication required"}`. The log records
  "Silent sign-in failed; session requests fail with auth_required until the
  client signs in." `terminal-login` is not offered when the client does not
  advertise terminal auth.
- Startup takes about 90 ms (`initialized server successfully in 88ms`). One
  idle, unauthenticated `agy acp` process has about 170 MB RSS. Memory with an
  authenticated session is unmeasured.
- On first run `agy` creates `~/.gemini/config/` and
  `~/.gemini/antigravity-cli/{conversations/,brain/,implicit/*.pb,conversation_summaries.db,builtin/,installation_id}`.
  Conversations are protobuf/SQLite, not JSONL. The ACP backend also tries to
  read `~/.gemini/antigravity/conversations`.
- In this SSH session `agy` chose file-based token storage ("Using file-based
  token storage because SSH session detected").
- The default CCPA endpoint in `--help` is `daily-cloudcode-pa.googleapis.com`.

Not verified (blocked on sign-in, which this spike deliberately avoided):
`session/update` shapes, permission option ids, model and mode option ids,
whether `session/list` includes conversations started in the TUI, and
steering behavior.

## Documented `agy acp` behavior

From the [ACP guide](https://antigravity.google/docs/ide/extensions/acp):

- It uses ACP v1 over stdio, with the project directory as cwd.
- Session options are **Model** and **Thinking level**
  (`Low`/`Medium`/`High`/`Extra`/`Max`). "Gemini models are available in every
  client. Third-party models are only offered to JetBrains IDEs …, Android
  Studio, …, Zed, and Xcode." pi-dish should therefore expect Gemini models
  only.
- "Sending a prompt while a turn runs steers that turn." This maps directly to
  pi-dish steer. ACP has no follow-up queue.
- Cancel ends open tool calls and abandons pending permission requests.
- Permission requests offer Allow and Deny. Rules in `agy`'s own settings still
  apply. `--dangerously-skip-permissions` exists.
- `agy` supports load, resume (no history replay), list and close for
  sessions.
- Agent questions use ACP elicitation forms when the client supports them,
  otherwise they appear as chat text.
- Useful flags: `--add-dir`, `--agent`, `--sandbox`, `--process-per-session`,
  `--log-file`, `--disable-telemetry`. Logs go to
  `~/.gemini/antigravity-cli/log/acp-*.log`.
- Over SSH, sign in once with `agy acp --login` (paste-a-code flow).

## Reference implementation: t3code

[pingdotgg/t3code](https://github.com/pingdotgg/t3code) (PR
[#9348](https://github.com/pingdotgg/t3code/pull/9348), docs
[providers-antigravity](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-antigravity.md),
[providers-acp](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-acp.md))
is a real ACP client. Worth copying:

- One `agy acp` child per thread, with cwd set to the project. Generic client:
  `packages/provider-acp/src/server/AcpSessionRuntime.ts`; agy layer:
  `apps/server/src/provider/acp/AntigravityAcpSupport.ts`.
- Client capabilities: `fs.readTextFile` limited to cwd and attachments,
  `fs.writeTextFile:false`, `terminal:false`. Edits arrive as tool-call diffs.
- Prefers `session/resume` over `session/load` because load replays tool calls.
- Model and thinking are set with `session/set_config_option`; the lists come
  from `session/new` `configOptions` (fallback `models`).
- Modes in 1.5.4+: `default`, `accept-edits`, `auto`, `plan`.
- Cancel waits for the in-flight `session/prompt` to settle before the next
  prompt is sent. If cancel times out, the process is retired.
- Requests with `interaction_*` tool-call ids are questions, not permissions.
  "Allow always" wording comes from `_meta["agy.security.warning"]`.
- `agy` cannot rewind, so t3code's "edit from here" starts a new session and
  resends the kept turns. pi-dish must not copy this on `oauth-personal`
  (rules 3 and 4).
- Sign-in: the stdout line `Open the following link to authenticate the ACP
  server: <url>`, then the remote `127.0.0.1` callback paste.

Avoid copying the version-gated `clientInfo:"zed"` spoof, the
`acp_token.json` usage probe, and the default of `oauth-personal` with no
terms warning. t3code's docs never mention §6.

## Proposed pi-dish design (option C)

pi-dish already supports three transports behind one structural `LiveSession`
union (`src/core/session-ownership.ts`): Pi bridge, Pi RPC child
(`rpc-session.ts`) and the Prime daemon (`prime-daemon.ts`). The RPC and Prime
transports extend `TransportSession` (`src/core/transport-session.ts`), which
already owns `turnInProgress`, `runningToolCalls`, `extUIState`, and the
delta-to-full-message `assistantFrame()`. An ACP transport is a fourth sibling
of the same kind and needs no new abstraction.

### Descriptor and process model

- Add `HarnessId` `agy` with `liveTransport:'acp'`, `command:'agy'`
  (overridable with `PI_DISH_AGY_COMMAND`), no `argv.new/resume` (no tmux),
  and `closeMode` set to an owned process.
- Run one `agy acp --disable-telemetry --log-file <dish log dir>` child per
  live session, with cwd set to the session cwd. This matches RPC ownership:
  close means `session/close` then SIGTERM, and a hung turn affects only its
  own process. Memory is the cost (≥170 MB each). Revisit
  `--process-per-session` with one shared front if that becomes a problem.
- Do not set `GEMINI_HOME`/`--gemini-dir`. pi-dish uses the user's normal
  `agy` profile, so the TUI and pi-dish share one sign-in and one account.
  Strip ambient `GEMINI_API_KEY`/`GOOGLE_*` unless the configured auth method
  needs them, so the auth method is never chosen by accident.

### Handshake

`initialize` sends `{protocolVersion:1, clientInfo:{name:"pi-dish",
title:"pi-dish", version}, clientCapabilities:{fs:{readTextFile:false,
writeTextFile:false}, terminal:false}}`. Fail closed unless
`agentInfo.name === "Antigravity ACP Server"`, `loadSession` is true and
`sessionCapabilities.resume` is present.

If a request returns `-32000`, report "agy is not signed in; run `agy` or
`agy acp --login` on <host>". pi-dish does not run OAuth itself in phase 1.

### Event mapping

| ACP | pi-dish |
|---|---|
| `session/prompt` sent | `turn_start` + user `message_end` |
| `session/prompt` while turn running | steer (same request; agy steers) |
| `agent_message_chunk` / `agent_thought_chunk` | `assistantFrame()` → coalesced `message_update` (text / thinking blocks) |
| `tool_call` | `tool_execution_start` (`toolCallId`, `title` → toolName, `kind`, `rawInput` → args, `locations`) |
| `tool_call_update` (`in_progress`, content/diff) | `tool_execution_update` (latest-wins, existing 50 ms lane) |
| `tool_call_update` `completed`/`failed` | `tool_execution_end` (`isError` on failed) |
| `plan` | `extension_ui_request` `setWidget` (read-only plan list) |
| `available_commands_update` | `getCommands()` cache for the slash picker |
| `current_mode_update`, `config_option_update` | state for model/thinking/mode pickers |
| `session_info_update` (title) | session name |
| `session/prompt` result `stopReason` | `message_end` (assistant) + `turn_end` + `agent_end`; `cancelled` = aborted; `refusal` surfaced like OMP classifier refusals |
| inbound `session/request_permission` | `extension_ui_request` `select` (options from ACP `options[]`, kinds `allow_once`/`allow_always`/`reject_once`/`reject_always`); `respondExtensionUI` → `{outcome:{outcome:"selected", optionId}}`; dismissed → `cancelled` |
| `interaction_*` permission / elicitation | `ask`/`form` dialog |
| child exit | `session_ended` |

Commands: `abort` → `session/cancel` (notification) followed by awaiting the
prompt response. `setModel`/`setThinkingLevel` →
`session/set_config_option`. Mode → `session/set_mode`. `setName`, compact,
tree, queue cancel and follow-up queueing are unsupported (capability false).
Slash commands are sent as prompt text, as Zed does.

### History

ACP exposes no transcript file. Every pi-dish history surface (messages,
search, usage, comments, export, shares) reads Pi-format JSONL through
`session-files`/`session-index`.

- **Recommended:** pi-dish writes a derived Pi-format JSONL mirror
  (`~/.pi/dish/agy/sessions/<agySessionId>.jsonl`, with a header containing
  cwd and the agy id) from the same events it streams. The descriptor's
  `rootPath` points at the mirror, so the existing discovery and readers work
  unchanged. This would be the first pi-dish-owned transcript writer, which is
  a real architectural change; the mirror is a cache, and agy's own store
  stays authoritative.
- Sessions started outside pi-dish come from `session/list`. They are
  imported into the mirror on first open with `session/load`, whose
  history-replay `session/update`s go through the same writer. Later live use
  goes through `session/resume`.
- Rejected: replaying history through `session/load` on every view. That
  spawns an authenticated process per read, breaks search and usage, and adds
  backend traffic that is not driven by a human.

### Restart behavior

Owned children die when pi-dish restarts, as RPC sessions do today (no spawn
record; `closeResources` does not adopt them). Phase 1 accepts this. After a
restart a session shows as inactive, and the next human prompt respawns
`agy acp` and runs `session/resume`. A turn running during a pi-dish update is
lost. A later phase can add a small detached relay that owns `agy`'s stdio
behind a Unix socket (the bridge-socket pattern) so turns survive updates.
Hibernation must skip `agy` sessions mid-turn.

### Prompt-origin gate (rule 4)

`session-command-handlers.ts` serves both the browser and the peer-control
CLI, and its provenance is advisory, so there is nothing to enforce against
today. The gate needs a positive browser-origin signal: a per-page token
issued with the app shell and required on prompt/steer/follow-up for a
`liveTransport:'acp'` session whose auth method is `oauth-personal`.
`routine-runner.ts:309-311`, `recovery-runner.ts:345` and
`message-hold.ts:109` (it delivers batched messages from peer agents, keyed by
`PeerSender`) refuse `agy` targets outright, and routine creation rejects them
up front. New-session spawns for `agy` follow the same rule: the browser can
create one, agents cannot.

### Capability matrix (planned)

| Capability | agy via ACP |
|---|---|
| Prompt / steer | yes (steer = prompt during a turn) |
| Follow-up queue, queue read/cancel | no |
| Abort | yes (`session/cancel`) |
| Streaming text, thinking, tools, diffs | yes |
| Approvals / questions | yes (`request_permission`, elicitation) |
| Model / thinking / mode | yes (config options; Gemini only) |
| Commands | yes (`available_commands_update`, sent as text) |
| Rename | no ACP method; title is read-only from `session_info_update` |
| Compact, tree, branch | no |
| History / search / usage | through the pi-dish mirror |
| Live list, resume | yes (`session/list`, `session/resume`) |
| Close / restart owned | yes (`session/close` + SIGTERM; respawn + resume) |
| Terminal view | no (no tmux pane) |
| Routines, peer control, recovery auto-continue | **refused on `oauth-personal`** |
| Usage limits | no (would need the token file; rule 2) |

## Phased plan

| Phase | Scope | Size | Main uncertainty |
|---|---|---|---|
| 0 | Option B: `agy` tmux harness with `--remote-control`, terminal view only | S | Pane lifecycle for a TUI that has no bridge |
| 1 | `AcpSession` transport, descriptor, live new/prompt/steer/abort/approvals, mirror writer, prompt-origin gate, fake ACP agent fixture for `npm test` | L | Real `session/update` shapes (needs one signed-in capture) |
| 2 | `session/list` import, resume after restart, model/mode pickers, commands | M | Whether `session/list` includes TUI conversations |
| 3 | Detached relay so turns survive pi-dish updates | M | Ownership record and relay authentication |

Phase 1 needs one signed-in, human-driven capture of a real turn (text,
thinking, a read, an edit with permission, a question, a cancel) to pin event
shapes for the fake-agent fixture. Do the capture with a `GEMINI_API_KEY` to
keep the subscription out of development traffic, and repeat it on
`oauth-personal` only to confirm model and option ids. Pin the canary to an
exact `agy` version, because `agy` updates itself in the background.

## Open questions for the owner

1. Is the phase-0 terminal and Remote Control route enough, or is the native
   transcript UI (phase 1) worth an L-sized change?
2. Should `agy` sessions be allowed on `oauth-personal` at all, given the
   unanswered "framework-injected context" question and automated
   enforcement, or only with `GEMINI_API_KEY`/`agent-platform`?
3. Is the first pi-dish-owned transcript writer (the JSONL mirror) acceptable,
   or should `agy` history stay outside pi-dish's search and usage?
