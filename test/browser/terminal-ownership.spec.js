const { test, expect } = require('./fixtures');

test('retired terminal sockets cannot write after reconnect or a host switch', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const reconnected = await page.evaluate(() => {
    const WebSocketClass = window.WebSocket;
    window.WebSocket = class {
      closeCalls = 0;
      close() { this.closeCalls += 1; this.onclose?.(); }
    };
    try {
      const writes = [];
      const state = {
        sessionId: sessionState.currentSession.id, owner: sessionState.captureSelection(),
        attempts: 0, closedByUser: false, exited: false, mode: 'shell', ws: null,
        term: { write: text => writes.push(text), reset() {}, dispose() {} },
      };
      termState = state;
      openTerminalWS(state, 'ws://fixture/first');
      const retired = state.ws;
      openTerminalWS(state, 'ws://fixture/reconnected');
      retired.onmessage({ data: JSON.stringify({ type: 'output', data: 'retired output' }) });
      retired.onclose();
      state.ws.onmessage({ data: JSON.stringify({ type: 'output', data: 'current output' }) });
      window.terminalProbe = { retired, current: state.ws, state, writes };
      return { writes, reconnectAttempts: state.attempts, retiredCloseCalls: retired.closeCalls };
    } finally { window.WebSocket = WebSocketClass; }
  });
  expect(reconnected).toEqual({ writes: ['current output'], reconnectAttempts: 0, retiredCloseCalls: 1 });

  await fleet.select(fleet.peer);
  const switched = await page.evaluate(() => {
    document.getElementById('terminalCwd').textContent = 'new host';
    for (const socket of [window.terminalProbe.retired, window.terminalProbe.current]) {
      socket.onmessage({ data: JSON.stringify({ type: 'attach', replay: 'stale replay', cwd: 'old host' }) });
      socket.onmessage({ data: JSON.stringify({ type: 'output', data: 'stale output' }) });
      socket.onclose();
    }
    return { writes: window.terminalProbe.writes, cwd: document.getElementById('terminalCwd').textContent,
      closed: termState === null };
  });
  expect(switched).toEqual({ writes: ['current output'], cwd: 'new host', closed: true });

  const staleOwner = await page.evaluate(() => {
    // Restore the state/active socket to isolate the owner check from the
    // ordinary close-on-selection path exercised above.
    const { state, current, writes } = window.terminalProbe;
    termState = state;
    state.closedByUser = false;
    try {
      current.onmessage({ data: JSON.stringify({ type: 'attach', replay: 'stale replay', cwd: 'old host' }) });
      current.onmessage({ data: JSON.stringify({ type: 'output', data: 'stale output' }) });
      current.onclose();
      return { writes, cwd: document.getElementById('terminalCwd').textContent, reconnectAttempts: state.attempts };
    } finally {
      clearTimeout(state.reconnectTimer);
      state.closedByUser = true;
      termState = null;
    }
  });
  expect(staleOwner).toEqual({ writes: ['current output'], cwd: 'new host', reconnectAttempts: 0 });
});
