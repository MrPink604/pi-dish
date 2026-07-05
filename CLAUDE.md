# pi-dish

Web/phone remote control for pi coding-agent sessions. Express server (`server.js`)
+ vanilla JS frontend (`public/`), plus an Electron shell (`electron/`) that loads
the same server. Sessions are discovered two ways: live sessions via the
pi-dish-bridge extension registry (`~/.pi/dish/sessions/*.json`, one Unix socket
per session), historical sessions by scanning JSONL files under
`~/.pi/agent/sessions/`.

## Run

```bash
npm start          # server on http://localhost:3333 (PORT env to override)
```

## UI testing (browser, CDP)

There is no test suite; UI changes are validated by driving real Chrome over CDP
with the globally installed playwright (`NODE_PATH=/usr/lib/node_modules`):

- Launch via `chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true })`.
  Note: spawning `google-chrome-stable --remote-debugging-port=...` by hand does
  not work on this machine (the CachyOS wrapper never opens the debug port) —
  let playwright launch the binary itself.
- To get a live session in the list without a real pi session, register a fake
  bridge entry: create a Unix socket server plus a JSON file in
  `~/.pi/dish/sessions/` with `{ sessionId, socketPath, pid, cwd, name, model,
  contextUsage }`. The registry prunes entries whose pid is dead or socket is
  missing, so keep the fake process running for the duration of the test and
  delete the JSON on exit.
- Assert against the DOM (`.session-item`, `.workspace-group-header`, tab state)
  and capture screenshots; also watch `pageerror`/console errors. Chrome
  occasionally logs a flaky favicon 404 — ignore it.

Example scripts from the sidebar-filter work: fake session registration and a
full CDP walkthrough (default Active filter, All view merge, search, selecting
a historical session) lived in the session scratchpad as `fake-session.js` /
`cdp-test.js` — recreate that pattern for future UI validation.

## Sidebar behavior (public/app.js)

The session list defaults to the **Active** filter (live sessions only, count
badge in the tab). The **All** tab merges active + historical sessions, grouped
by workspace cwd; live sessions get a green `.live-dot` and historical ones the
`.session-item.inactive` dimming. Search in All mode is server-side
(`/api/sessions?q=` — matches metadata and message content); filtering in
Active mode is local.
