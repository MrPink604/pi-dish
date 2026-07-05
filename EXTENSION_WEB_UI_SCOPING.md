# Scoping: Extension UI Elements in a Web UI

> **Status (2026-07-04):** Partially implemented. Milestone 1 (fire-and-forget
> bridge: notify/setStatus/setWidget/setTitle/set_editor_text) and the dialog
> half of Milestone 3 (select/confirm/input/editor as interactive web modals,
> raced against the TUI dialog) are shipped via the `pi-dish-bridge` extension.
> Custom components, tool/message renderers, and the terminal-canvas fallback
> (Milestones 2 and 4) remain unimplemented and would need upstream pi changes.
> Note this doc predates the pi package rename to `@earendil-works/*`.
>
> **2026-07-05:** Milestone 1 hardened after a live test with `@aliou/pi-processes`
> on glm-5.2: widget/status/dialog strings are ANSI-stripped in the web client
> (extensions style them with `theme.fg`), and unchanged `setWidget`/`setStatus`
> re-emissions are deduped (bridge + per SSE connection). Line-array widgets now
> render and live-update cleanly; component-factory widgets (e.g. the
> pi-processes log dock) are still TUI-only by design — both the bridge and pi's
> own RPC mode forward only `string[]` content.

## Current State

Pi's extension UI system is tightly coupled to the terminal UI (TUI):

- **`ctx.ui.custom()`** — Returns `string[]` of ANSI-coded lines, receives raw terminal key sequences
- **`renderCall` / `renderResult`** — Return `@mariozechner/pi-tui` `Component` objects that emit ANSI escape codes via `theme.fg()`/`theme.bg()`
- **`registerMessageRenderer`** — Same: returns TUI `Component` instances
- **Overlays** — Positioned in terminal cells (anchors, margins, percentages of term size)
- **Input handling** — `handleInput(data: string)` receives raw escape sequences (e.g., `\x1b[A` for Up)

The **RPC mode** already has an **Extension UI Protocol** that bridges some of this to JSON:
- Dialog methods (`select`, `confirm`, `input`, `editor`) → `extension_ui_request` / `extension_ui_response`
- Fire-and-forget methods (`notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`) → `extension_ui_request` only
- **No-op in RPC:** `custom()`, `setFooter()`, `setHeader()`, `setEditorComponent()`, `setWorkingIndicator()`, `setWorkingMessage()`, `setToolsExpanded()`

So the problem is: **rich extension UI (custom components, overlays, tool renderers, message renderers, editors) has no serialization path for non-TUI consumers.**

---

## Goals

1. Allow a web UI (or any non-terminal client) to connect to a pi session and display extension-contributed UI
2. Preserve the existing TUI experience — extensions should not break in interactive mode
3. Avoid forcing extensions to write two renderers (TUI + web) unless necessary
4. Support interactive extension UI (dialogs, overlays, custom editors) in the browser, not just static display

---

## Option A: Terminal-in-Browser (Quickest, Least Native)

Run the full TUI inside a browser-based terminal emulator (e.g., `xterm.js`).

**How it works:**
- Pi runs in a headless PTY or pipes its stdout to a WebSocket
- Browser runs xterm.js connected via WebSocket
- Extension UI "just works" because it's native TUI rendered in a canvas/DOM terminal

**Pros:**
- Zero changes to pi core or extensions
- All TUI features work immediately (overlays, custom editors, colors, images via Kitty protocol)

**Cons:**
- Not a "web UI" — it's a terminal emulator in a browser
- No web-native interactions (can't use HTML inputs, CSS styling, responsive layouts)
- IME, copy/paste, and accessibility are terminal-level, not browser-level
- Mobile/unusual viewports are awkward

**Verdict:** Good for a quick remote-access solution, but doesn't answer the spirit of the question.

---

## Option B: Extend the RPC Extension UI Protocol (Incremental)

Build on the existing RPC mode by adding new `extension_ui_request` / `extension_ui_response` method types that map to the currently unsupported UI surface area.

### Phase 1: Static / Fire-and-Forget

Add JSON-serializable equivalents for no-op methods:

| TUI Method | RPC Extension UI Request |
|-----------|-------------------------|
| `ctx.ui.setFooter()` | `method: "setFooter"`, `footerLines: string[]` or `footerHtml: string` |
| `ctx.ui.setHeader()` | `method: "setHeader"`, `headerLines: string[]` |
| `ctx.ui.setWorkingIndicator()` | `method: "setWorkingIndicator"`, `frames: string[]`, `intervalMs: number` |
| `ctx.ui.setWorkingMessage()` | `method: "setWorkingMessage"`, `message: string` |
| `ctx.ui.setToolsExpanded()` | `method: "setToolsExpanded"`, `expanded: boolean` |

These are one-way broadcasts. The web UI decides how to render them.

### Phase 2: Interactive Custom Components

This is the hard part. `ctx.ui.custom()` currently takes a factory that returns a TUI `Component` with `render(width) -> string[]` and `handleInput(data) -> void`.

For RPC/web, introduce a **declarative component description protocol**:

```typescript
// Extension opts into web-compatible rendering
const result = await ctx.ui.custom<MyResult>(
  (tui, theme, keybindings, done) => new MyTuiComponent({ done }),
  {
    // NEW: optional web descriptor
    webDescriptor: (done) => ({
      type: "form",
      title: "Configure Deploy",
      fields: [
        { type: "select", name: "env", label: "Environment", options: ["dev", "prod"] },
        { type: "toggle", name: "dryRun", label: "Dry run" }
      ],
      onSubmit: (values) => done(values),
      onCancel: () => done(null),
    }),
  }
);
```

The web UI receives:

```json
{
  "type": "extension_ui_request",
  "id": "uuid-10",
  "method": "custom_component",
  "componentType": "form",
  "title": "Configure Deploy",
  "fields": [...],
  "actions": ["submit", "cancel"]
}
```

And responds with:

```json
{
  "type": "extension_ui_response",
  "id": "uuid-10",
  "action": "submit",
  "values": { "env": "prod", "dryRun": true }
}
```

**Problem:** This pushes complexity onto extensions. They must provide both a TUI component factory AND a web descriptor.

**Mitigation:** Provide a small set of built-in declarative component types that cover 90% of cases (form, select-list, markdown, image, progress). For the remaining 10%, fall back to a terminal canvas or disallow.

### Phase 3: Tool & Message Renderers

Tool renderers (`renderCall`, `renderResult`) and message renderers (`registerMessageRenderer`) return TUI `Component` objects. For web, we need an alternative.

**Approach: Dual Renderer Registration**

```typescript
pi.registerTool({
  name: "my_tool",
  // ... existing TUI renderers ...
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },

  // NEW: optional web renderers
  renderCallWeb(args) {
    return { type: "text", content: `Running **${args.action}**...` };
  },
  renderResultWeb(result, options) {
    return {
      type: "markdown",
      content: result.content[0].text,
      details: result.details,
      expanded: options.expanded,
    };
  },
});
```

If `render*Web` is absent, the web UI falls back to:
1. Rendering the raw `content` text
2. Or running the TUI renderer in a headless mode that strips ANSI and returns plain text

**Headless fallback idea:**
- Create a minimal `theme` object where `fg(color, text)` and `bg(color, text)` return plain text (no ANSI)
- Call `render(width)` with a sensible default width
- Return the `string[]` as preformatted text
- This gives readable but unstyled output

### Pros / Cons of Option B

**Pros:**
- Incremental: start with fire-and-forget, add interactivity later
- No breaking changes to TUI
- Web UI can be built as an RPC client (JSONL over WebSocket or SSE)

**Cons:**
- Rich custom components require extensions to opt in with web descriptors
- The protocol becomes a parallel UI framework
- Input handling is tricky: TUI uses raw escape sequences, web uses structured DOM events

---

## Option C: Structured Event Stream for Web (Cleanest, Most Work)

Instead of trying to serialize TUI components, change the architecture so the **web UI consumes the same event stream as the TUI, but renders it natively.**

### Core Insight

The TUI already consumes `AgentSessionEvent`s (`message_update`, `tool_execution_start`, etc.) and renders them. A web UI should do the same — but with HTML/CSS/JS instead of ANSI strings.

The missing link is: **extensions currently insert arbitrary UI at arbitrary points in the TUI layout** (widgets above editor, footer, overlays, custom editor). These aren't part of the agent event stream.

### New Abstraction: Extension UI Surface Descriptors

Define a set of UI "surfaces" where extensions can attach content. Emit these as **first-class events** in the agent event stream:

```typescript
// New event types emitted to ALL subscribers (TUI + web + RPC)
interface ExtensionUISurfaceEvent {
  type: "extension_ui_surface";
  surface: "message" | "tool_call" | "tool_result" | "widget_above" | "widget_below" | "footer" | "overlay" | "editor";
  extensionId: string;
  surfaceId: string;
  content: StructuredContent;
}

type StructuredContent =
  | { type: "text"; text: string }
  | { type: "markdown"; markdown: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "form"; fields: FormField[] }
  | { type: "select"; options: string[] }
  | { type: "image"; data: string; mimeType: string }
  | { type: "progress"; label: string; percent?: number }
  | { type: "children"; items: StructuredContent[] };
```

### Extension API Changes

Extensions would use a new API to emit structured content instead of (or in addition to) TUI components:

```typescript
// Current TUI way (preserved)
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);

// NEW: Structured way (works in both TUI and web)
ctx.ui.setSurface("widget_above", "my-widget", {
  type: "children",
  items: [
    { type: "text", text: "Line 1" },
    { type: "text", text: "Line 2" },
  ],
});

// For interactive surfaces
const result = await ctx.ui.surfacePrompt("overlay", "my-dialog", {
  type: "form",
  fields: [
    { name: "branch", type: "input", label: "Branch name" },
    { name: "env", type: "select", label: "Environment", options: ["dev", "prod"] },
  ],
});
```

### Rendering Resolution

The TUI renderer would receive `ExtensionUISurfaceEvent` and translate structured content into TUI `Component`s internally. The web UI would translate the same events into HTML/React/Vue components.

This inverts control: instead of extensions defining TUI components that the web must somehow display, extensions define **semantic content** and each UI layer renders it natively.

### Migration Path

1. Introduce `ctx.ui.setSurface()` and `ctx.ui.surfacePrompt()` alongside existing APIs
2. Built-in TUI translates surfaces to existing widget/footer/overlay system
3. RPC/web mode emits `extension_ui_surface` events (or includes them in the event stream)
4. Over time, encourage extensions to use surfaces for portable UI
5. Keep `ctx.ui.custom()` for complex TUI-only experiences (games, Doom, etc.)

### Pros / Cons of Option C

**Pros:**
- Web UI is a first-class citizen, not an afterthought
- Extensions write UI once, it works everywhere (that supports the structured types)
- No ANSI parsing or terminal emulation needed
- Natural fit for the existing event-driven architecture

**Cons:**
- Large change to pi core: need surface renderer in TUI, new events in agent stream, RPC protocol updates
- Limited expressiveness: a `form` is a form, but a custom Snake game can't be expressed as structured content
- Need to define and version the `StructuredContent` schema

---

## Option D: Hybrid — WebSocket RPC with Terminal Fallback

Combine B and C pragmatically:

1. **Fire-and-forget UI** (widgets, status, footer, working indicator): extend existing RPC protocol (Option B Phase 1)
2. **Messages and tool results**: web UI renders from the existing agent event stream using its own built-in renderers; extension tool renderers optionally provide a `renderWeb()` (Option B Phase 3)
3. **Interactive dialogs**: use a structured form protocol for common cases (Option C lite); for complex TUI-only components, render a terminal canvas in the browser (Option A fallback)

### Protocol Sketch

Web UI connects via WebSocket to a pi process running in a new `web` mode (or extends RPC mode):

```
WebSocket messages (bidirectional JSON):

Client -> Server:
  { "type": "prompt", "message": "..." }
  { "type": "abort" }
  { "type": "extension_ui_response", "id": "...", ... }
  { "type": "input_event", "target": "custom-component-id", "key": "enter" }

Server -> Client:
  { "type": "agent_start" }
  { "type": "message_update", ... }
  { "type": "extension_ui_request", "id": "...", "method": "select", ... }
  { "type": "extension_ui_request", "id": "...", "method": "setWidget", ... }
  { "type": "extension_ui_request", "id": "...", "method": "custom_component", "descriptor": {...} }
  { "type": "tool_execution_start", ... }
```

### Custom Component Fallback

When an extension uses `ctx.ui.custom()` with no web descriptor:

```json
{
  "type": "extension_ui_request",
  "id": "uuid-11",
  "method": "custom_component",
  "fallback": "terminal_canvas",
  "terminalOptions": { "width": 80, "height": 24 }
}
```

The web UI can either:
- Show a button "Open Terminal View" that launches xterm.js for this component
- Reject the request (return `cancelled: true`)
- The extension can check `ctx.uiCapabilities?.supportsTui` and adapt

---

## Recommendation

**Start with Option D (Hybrid) scoped tightly:**

### Milestone 1: Fire-and-Forget Bridge
- Extend RPC Extension UI Protocol to support `setFooter`, `setHeader`, `setWorkingIndicator`, `setWorkingMessage`
- Web UI connects via WebSocket and renders these as native HTML elements
- ~1 week, low risk

### Milestone 2: Message & Tool Renderer Fallback
- Add `renderResultWeb()` / `renderCallWeb()` optional hooks to tool definitions
- Add `registerMessageRendererWeb()` optional hook
- Default fallback: strip ANSI from TUI renderer output, display as preformatted text
- Web UI renders built-in tools natively (code blocks, diffs, file trees)
- ~2 weeks

### Milestone 3: Structured Interactive Components
- Define a small schema: `form`, `select`, `confirm`, `input`, `markdown`, `progress`
- Add `ctx.ui.surfacePrompt(surfaceType, descriptor)` API
- TUI translates to existing `SelectList`, `BorderedLoader`, etc.
- Web UI renders as native HTML forms, modals, etc.
- RPC protocol gains `method: "surface_prompt"` / `surface_response`
- ~3-4 weeks

### Milestone 4: Terminal Fallback for Complex UI
- For `ctx.ui.custom()` without web support, offer a terminal canvas mode
- Pi runs the component in a hidden PTY, streams ANSI over WebSocket as base64 or escape sequences
- Web UI uses xterm.js for just that component region
- ~2 weeks

### Total Scope
- **Core pi changes:** RPC protocol extensions, optional web renderer hooks, surface API
- **Web UI client:** WebSocket client, event stream processor, component library for structured content, terminal canvas fallback
- **Extension impact:** Optional opt-in for web renderers; existing extensions continue working in TUI

---

## Open Questions

1. **Should pi core own a web server mode?** Or should this be an extension that spawns an HTTP server and talks to the host session via the existing extension event bus / `pi.sendMessage()`?
   - *Lean toward extension-first:* an official `pi-webui` extension that uses `pi.events` and agent session subscription, so the core stays minimal.

2. **How do themes translate?** TUI themes are ANSI color maps. Web themes would be CSS variables. Should extensions/themes declare both?
   - *Lean toward:* web UI uses its own theme system; TUI theme only affects TUI output.

3. **Images:** TUI supports Kitty/iTerm2 image protocols. Web UI naturally supports `<img>`. The structured content type can handle this uniformly.

4. **Keyboard shortcuts:** TUI uses `matchesKey(data, Key.ctrl("c"))`. Web UI has its own keyboard model. Custom editors (vim mode) are the hardest problem — likely require terminal fallback.

5. **Session sharing:** If multiple browsers connect to the same pi session, how is input focus handled? Probably single-user model initially.
