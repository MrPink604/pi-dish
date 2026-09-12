const { test, expect } = require('./fixtures');

async function probe(page, fleet, mode = 'normal') {
  await fleet.select(fleet.self);
  await page.evaluate(mode => {
    window.termProbe = { writes: [], sockets: [], terminals: [], tickets: [] };
    const probe = window.termProbe;
    const host = Object.freeze({ ...fixtureApp.ports.appModels.host(null), token: mode === 'tickets' ? 'fixture-only' : null });
    probe.host = host;
    const controller = PiDishBrowser.createTerminalController({ document, storage: localStorage, sessionState: fixtureApp.features.sessionState,
      host: () => probe.host, supportsTerminal: () => true, supportsTmux: () => true,
      asset: async () => { if (mode === 'assets') await new Promise(resolve => { probe.finishAssets = resolve; }); },
      createTerminal: options => {
        const terminal = { options, modes: {}, cols: 80, rows: 24, open() {}, loadAddon() {}, reset() {}, focus() {},
          write: text => probe.writes.push(text), dispose() { this.disposed = true; },
          onData(fn) { this.data = fn; }, onResize(fn) { this.resize = fn; } };
        probe.terminals.push(terminal); return terminal;
      },
      createFitAddon: () => null, socket: url => {
        const socket = { url, closeCalls: 0, readyState: 1, sent: [], send(data) { this.sent.push(JSON.parse(data)); }, close() { this.closeCalls++; this.onclose?.(); } };
        probe.sockets.push(socket); return socket;
      }, socketUrl: (_host, path) => 'ws://fixture' + path,
      ticket: () => new Promise(resolve => probe.tickets.push(resolve)),
      theme: () => ({}), applySize: () => {}, confirm: () => true,
    });
    probe.controller = controller;
  }, mode);
}

test('retired terminal sockets and input callbacks cannot write after reconnect or host switch', async ({ page, fleet }) => {
  await probe(page, fleet);
  const result = await page.evaluate(async () => {
    const p = window.termProbe; await p.controller.open();
    const retired = p.sockets[0]; p.controller.connect();
    retired.onmessage({ data: JSON.stringify({ type: 'output', data: 'retired' }) }); retired.onclose();
    p.sockets[1].onmessage({ data: JSON.stringify({ type: 'output', data: 'current' }) });
    return { writes: p.writes, attempts: p.controller.state.attempts, closed: retired.closeCalls };
  });
  expect(result).toEqual({ writes: ['current'], attempts: 0, closed: 1 });
  await fleet.select(fleet.peer);
  const switched = await page.evaluate(() => {
    const p = window.termProbe; document.getElementById('terminalCwd').textContent = 'new host';
    for (const socket of p.sockets) {
      socket.onmessage({ data: JSON.stringify({ type: 'attach', replay: 'stale', cwd: 'old host' }) }); socket.onclose();
    }
    p.terminals[0].data('stale input'); p.terminals[0].resize({ cols: 100, rows: 50 });
    const result = { writes: p.writes, cwd: document.getElementById('terminalCwd').textContent, sent: p.sockets.flatMap(socket => socket.sent), attempts: p.controller.state.attempts };
    p.controller.dispose(); return result;
  });
  expect(switched).toEqual({ writes: ['current'], cwd: 'new host', sent: [], attempts: 0 });
});

test('closing pending terminal opens retires asset and font continuations', async ({ page, fleet }) => {
  await probe(page, fleet, 'assets');
  await page.evaluate(() => { window.termProbe.pending = window.termProbe.controller.open(); });
  await page.evaluate(async () => {
    const p = window.termProbe; p.controller.close(); await p.pending;
    p.controller.dispose();
  });
  expect(await page.evaluate(() => window.termProbe.terminals.length)).toBe(0);
  await probe(page, fleet);
  await page.evaluate(() => {
    const p = window.termProbe;
    p.originalFont = document.fonts.load;
    document.fonts.load = () => new Promise(resolve => { p.finishFont = resolve; });
    p.pending = p.controller.open();
  });
  await expect.poll(() => page.evaluate(() => !!window.termProbe.finishFont)).toBe(true);
  await page.evaluate(async () => {
    const p = window.termProbe; p.controller.close(); await p.pending; p.finishFont([]); document.fonts.load = p.originalFont;
  });
  expect(await page.evaluate(() => window.termProbe.terminals.length)).toBe(0);
});

test('latest terminal ticket owns its socket and disposal stops reconnect timers', async ({ page, fleet }) => {
  await page.clock.install();
  await probe(page, fleet, 'tickets');
  await page.evaluate(() => window.termProbe.controller.open());
  await page.evaluate(() => window.termProbe.controller.connect());
  expect(await page.evaluate(() => window.termProbe.tickets.length)).toBe(2);
  await page.evaluate(() => window.termProbe.tickets[1]('new'));
  await expect.poll(() => page.evaluate(() => window.termProbe.sockets.length)).toBe(1);
  await page.evaluate(() => window.termProbe.tickets[0]('old'));
  expect(await page.evaluate(() => window.termProbe.sockets.map(socket => socket.url))).toEqual([expect.stringContaining('ticket=new')]);
  await page.evaluate(() => { const p = window.termProbe; p.sockets[0].onclose(); p.controller.dispose(); });
  await page.clock.runFor(9000);
  expect(await page.evaluate(() => window.termProbe.tickets.length)).toBe(2);
});

test('mobile terminal keybar uses captured input handlers and retires on disposal', async ({ page, fleet }) => {
  await probe(page, fleet);
  const sent = await page.evaluate(async () => {
    const p = window.termProbe; await p.controller.open(); p.controller.mountKeybar();
    p.controller.key('ctrl'); p.terminals[0].data('c');
    p.terminals[0].modes.applicationCursorKeysMode = true; p.controller.key('up');
    const oldData = p.terminals[0].data, oldResize = p.terminals[0].resize;
    p.controller.close(); await p.controller.open();
    oldData('stale'); oldResize({ cols: 100, rows: 50 });
    p.controller.dispose();
    document.querySelector('[data-termkey="ctrl-c"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return p.sockets.map(socket => socket.sent);
  });
  expect(sent).toEqual([[{ type: 'input', data: '\x03' }, { type: 'input', data: '\x1bOA' }], []]);
});


test('removing the terminal host retires socket and input work without throwing', async ({ page, fleet }) => {
  await probe(page, fleet);
  const result = await page.evaluate(async () => {
    const p = window.termProbe; await p.controller.open();
    p.host = null;
    p.sockets[0].onmessage({ data: JSON.stringify({ type: 'output', data: 'removed host' }) });
    p.sockets[0].onclose(); p.controller.fit(); p.controller.key('ctrl-c');
    p.terminals[0].data('retired'); p.terminals[0].resize({ cols: 80, rows: 24 });
    p.controller.close(); await p.controller.open();
    const result = { writes: p.writes, sent: p.sockets[0].sent, terminals: p.terminals.length, state: p.controller.state };
    p.controller.dispose(); return result;
  });
  expect(result).toEqual({ writes: [], sent: [], terminals: 1, state: null });
});
