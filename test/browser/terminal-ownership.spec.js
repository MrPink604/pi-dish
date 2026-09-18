// Generated test/tool from test/browser/terminal-ownership.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
async function probe(page, fleet, mode = 'normal') {
    await fleet.select(fleet.self);
    if (!await page.evaluate(() => typeof Terminal === 'function')) {
        await page.addScriptTag({ url: `${fleet.self.base}/vendor/xterm.js` });
    }
    await page.evaluate(async (mode) => {
        window.termProbe = { writes: [], sockets: [], terminals: [], tickets: [] };
        const probe = window.termProbe;
        const resolvedHost = fixtureApp.ports.appModels.host(null);
        if (!resolvedHost)
            throw new Error('Terminal fixture host is unavailable');
        probe.host = Object.freeze({ ...resolvedHost, token: mode === 'tickets' ? 'fixture-only' : null });
        class FixtureWebSocket extends EventTarget {
            url;
            CONNECTING = WebSocket.CONNECTING;
            OPEN = WebSocket.OPEN;
            CLOSING = WebSocket.CLOSING;
            CLOSED = WebSocket.CLOSED;
            binaryType = 'blob';
            bufferedAmount = 0;
            extensions = '';
            protocol = '';
            readyState = WebSocket.OPEN;
            closeCalls = 0;
            sent = [];
            onclose = null;
            onerror = null;
            onmessage = null;
            onopen = null;
            constructor(url) {
                super();
                this.url = url;
            }
            send(data) {
                if (typeof data !== 'string')
                    throw new Error('Terminal fixture expects JSON text');
                this.sent.push(JSON.parse(data));
            }
            close() { this.closeCalls++; this.onclose?.call(this, new CloseEvent('close')); }
        }
        const controller = PiDishBrowser.createTerminalController({
            document, storage: localStorage, sessionState: fixtureApp.features.sessionState,
            host: () => probe.host || null, supportsTerminal: () => true, supportsTmux: () => true,
            asset: async () => {
                if (mode === 'assets')
                    await new Promise(resolve => { probe.finishAssets = resolve; });
            },
            createTerminal: options => {
                const terminal = new Terminal(options);
                const dispose = terminal.dispose.bind(terminal);
                let retired = false;
                const observed = Object.assign(terminal, {
                    disposed: false,
                    emitData: (value) => { if (!retired)
                        terminal.input(value, true); },
                    emitResize: (size) => {
                        if (!retired)
                            terminal.resize(size.cols, size.rows);
                    },
                    setApplicationCursorKeys: async (enabled) => {
                        Object.defineProperty(terminal, 'modes', {
                            configurable: true,
                            value: { ...terminal.modes, applicationCursorKeysMode: enabled },
                        });
                    },
                });
                observed.write = (text) => { probe.writes.push(text); };
                observed.dispose = () => { retired = true; observed.disposed = true; dispose(); };
                probe.terminals.push(observed);
                return terminal;
            },
            createFitAddon: () => null,
            socket: url => { const socket = new FixtureWebSocket(url); probe.sockets.push(socket); return socket; },
            socketUrl: (_host, path) => 'ws://fixture' + path,
            ticket: () => new Promise(resolve => probe.tickets.push(resolve)),
            theme: () => ({}), applySize: () => { }, confirm: () => true,
        });
        probe.controller = controller;
    }, mode);
}
(0, fixtures_js_1.test)('retired terminal sockets and input callbacks cannot write after reconnect or host switch', async ({ page, fleet }) => {
    await probe(page, fleet);
    const result = await page.evaluate(async () => {
        const p = fixtureTerminalProbe();
        await p.controller.open();
        const retired = p.sockets[0];
        p.controller.connect();
        retired.onmessage?.call(retired, new MessageEvent('message', { data: JSON.stringify({ type: 'output', data: 'retired' }) }));
        retired.onclose?.call(retired, new CloseEvent('close'));
        const current = p.sockets[1];
        current.onmessage?.call(current, new MessageEvent('message', { data: JSON.stringify({ type: 'output', data: 'current' }) }));
        const state = p.controller.state;
        if (!state)
            throw new Error('Terminal state is unavailable');
        return { writes: p.writes, attempts: state.attempts, closed: retired.closeCalls };
    });
    (0, fixtures_js_1.expect)(result).toEqual({ writes: ['current'], attempts: 0, closed: 1 });
    await fleet.select(fleet.peer);
    const switched = await page.evaluate(() => {
        const p = fixtureTerminalProbe();
        fixtureElement(document.getElementById('terminalCwd'), "document.getElementById('terminalCwd')").textContent = 'new host';
        for (const socket of p.sockets) {
            socket.onmessage?.call(socket, new MessageEvent('message', { data: JSON.stringify({ type: 'attach', replay: 'stale', cwd: 'old host' }) }));
            socket.onclose?.call(socket, new CloseEvent('close'));
        }
        p.terminals[0].emitData('stale input');
        p.terminals[0].emitResize({ cols: 100, rows: 50 });
        const state = p.controller.state;
        if (!state)
            throw new Error('Terminal state is unavailable');
        const result = { writes: p.writes, cwd: fixtureElement(document.getElementById('terminalCwd'), "document.getElementById('terminalCwd')").textContent, sent: p.sockets.flatMap((socket) => socket.sent), attempts: state.attempts };
        p.controller.dispose();
        return result;
    });
    (0, fixtures_js_1.expect)(switched).toEqual({ writes: ['current'], cwd: 'new host', sent: [], attempts: 0 });
});
(0, fixtures_js_1.test)('closing pending terminal opens retires asset and font continuations', async ({ page, fleet }) => {
    await probe(page, fleet, 'assets');
    await page.evaluate(() => { fixtureTerminalProbe().pending = fixtureTerminalProbe().controller.open(); });
    await page.evaluate(async () => {
        const p = fixtureTerminalProbe();
        p.controller.close();
        await p.pending;
        p.controller.dispose();
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureTerminalProbe().terminals.length)).toBe(0);
    await probe(page, fleet);
    await page.evaluate(() => {
        const p = fixtureTerminalProbe();
        p.originalFont = document.fonts.load;
        document.fonts.load = () => new Promise(resolve => { p.finishFont = resolve; });
        p.pending = p.controller.open();
    });
    await fixtures_js_1.expect.poll(() => page.evaluate(() => !!fixtureTerminalProbe().finishFont)).toBe(true);
    await page.evaluate(async () => {
        const p = fixtureTerminalProbe();
        p.controller.close();
        await p.pending;
        const finishFont = p.finishFont, originalFont = p.originalFont;
        if (!finishFont || !originalFont)
            throw new Error('Font fixture did not initialize');
        finishFont([]);
        document.fonts.load = originalFont;
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureTerminalProbe().terminals.length)).toBe(0);
});
(0, fixtures_js_1.test)('latest terminal ticket owns its socket and disposal stops reconnect timers', async ({ page, fleet }) => {
    await page.clock.install();
    await probe(page, fleet, 'tickets');
    await page.evaluate(() => fixtureTerminalProbe().controller.open());
    await page.evaluate(() => fixtureTerminalProbe().controller.connect());
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureTerminalProbe().tickets.length)).toBe(2);
    await page.evaluate(() => fixtureTerminalProbe().tickets[1]('new'));
    await fixtures_js_1.expect.poll(() => page.evaluate(() => fixtureTerminalProbe().sockets.length)).toBe(1);
    await page.evaluate(() => fixtureTerminalProbe().tickets[0]('old'));
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureTerminalProbe().sockets.map((socket) => socket.url))).toEqual([fixtures_js_1.expect.stringContaining('ticket=new')]);
    await page.evaluate(() => { const p = fixtureTerminalProbe(); const socket = p.sockets[0]; socket.onclose?.call(socket, new CloseEvent('close')); p.controller.dispose(); });
    await page.clock.runFor(9000);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureTerminalProbe().tickets.length)).toBe(2);
});
(0, fixtures_js_1.test)('mobile terminal keybar uses captured input handlers and retires on disposal', async ({ page, fleet }) => {
    await probe(page, fleet);
    const sent = await page.evaluate(async () => {
        const p = fixtureTerminalProbe();
        await p.controller.open();
        p.controller.mountKeybar();
        p.controller.key('ctrl');
        p.terminals[0].emitData('c');
        await p.terminals[0].setApplicationCursorKeys(true);
        p.controller.key('up');
        const oldData = p.terminals[0].emitData, oldResize = p.terminals[0].emitResize;
        p.controller.close();
        await p.controller.open();
        oldData('stale');
        oldResize({ cols: 100, rows: 50 });
        p.controller.dispose();
        fixtureElement(document.querySelector('[data-termkey="ctrl-c"]'), 'document.querySelector(\'[data-termkey="ctrl-c"]\')').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        return p.sockets.map((socket) => socket.sent);
    });
    (0, fixtures_js_1.expect)(sent).toEqual([[{ type: 'input', data: '\x03' }, { type: 'input', data: '\x1bOA' }], []]);
});
(0, fixtures_js_1.test)('removing the terminal host retires socket and input work without throwing', async ({ page, fleet }) => {
    await probe(page, fleet);
    const result = await page.evaluate(async () => {
        const p = fixtureTerminalProbe();
        await p.controller.open();
        p.host = null;
        const socket = p.sockets[0];
        socket.onmessage?.call(socket, new MessageEvent('message', { data: JSON.stringify({ type: 'output', data: 'removed host' }) }));
        socket.onclose?.call(socket, new CloseEvent('close'));
        p.controller.fit();
        p.controller.key('ctrl-c');
        p.terminals[0].emitData('retired');
        p.terminals[0].emitResize({ cols: 80, rows: 24 });
        p.controller.close();
        await p.controller.open();
        const result = { writes: p.writes, sent: p.sockets[0].sent, terminals: p.terminals.length, state: p.controller.state };
        p.controller.dispose();
        return result;
    });
    (0, fixtures_js_1.expect)(result).toEqual({ writes: [], sent: [], terminals: 1, state: null });
});
