// Generated test/tool from test/browser/message-stream.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const fixtures_js_1 = require("./fixtures.js");
async function setup(page, fleet) {
    await fleet.select(fleet.self);
    await page.evaluate(() => {
        fixtureApp.features.messageStreamController.stop();
        window.streamSources = [];
        window.streamTickets = [];
        window.streamLoads = [];
        window.streamSelections = [];
        window.streamStatus = [];
        window.streamOriginFailures = [];
        window.streamProbes = [];
        window.streamEndpoint = { base: 'http://original', token: 'fixture-token' };
        window.ownedStream = PiDishBrowser.createMessageStream({ document, sessionState: fixtureApp.features.sessionState, endpoint: () => window.streamEndpoint,
            ticket: () => new Promise((resolve, reject) => window.streamTickets.push({ resolve, reject })),
            originFailure: failure => { window.streamOriginFailures.push(failure); },
            probeOrigin: () => new Promise(resolve => { window.streamProbes.push(resolve); }),
            source: url => {
                class FixtureSource extends EventTarget {
                    url;
                    CONNECTING = 0;
                    OPEN = 1;
                    CLOSED = 2;
                    onerror = null;
                    onmessage = null;
                    onopen = null;
                    readyState = this.CONNECTING;
                    withCredentials = false;
                    constructor(url) {
                        super();
                        this.url = url;
                    }
                    close() { this.readyState = this.CLOSED; }
                    addEventListener(type, listener, options) {
                        Reflect.apply(EventTarget.prototype.addEventListener, this, [type, listener, options]);
                    }
                    removeEventListener(type, listener, options) {
                        Reflect.apply(EventTarget.prototype.removeEventListener, this, [type, listener, options]);
                    }
                }
                const source = new FixtureSource(url);
                window.streamSources.push(source);
                return source;
            },
            activity: fixtureApp.features.sessionActivity, renderer: fixtureApp.features.messageRenderer, streaming: fixtureApp.features.streamingRenderer, tools: fixtureApp.features.liveToolsController, delivery: fixtureApp.features.promptDelivery, extensionUI: fixtureApp.features.extensionUI, sideChat: { apply() { } },
            status: (...args) => { window.streamStatus.push(args); }, catchup() { }, refresh() { }, artifacts() { }, pinned: () => false, follow: () => false, scroll() { }, jump() { }, highlight() { },
            select: (...args) => { window.streamSelections.push(args); }, deleteCached() { }, loadSessions: () => new Promise(resolve => { window.streamLoads.push(resolve); }),
        });
        window.emitOwnedStream = (index, type, value) => fixtureElement(window.streamSources[index], `stream source ${index}`).dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value) }));
    });
}
(0, fixtures_js_1.test)('only the newest ticket request may open a stream for the same selection', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.evaluate(() => { window.firstStreamStart = window.ownedStream.start(); window.secondStreamStart = window.ownedStream.start(); fixtureElement(window.streamTickets[1], 'second stream ticket').resolve('second'); });
    await page.evaluate(() => window.secondStreamStart);
    await page.evaluate(() => { fixtureElement(window.streamTickets[0], 'first stream ticket').resolve('first'); return window.firstStreamStart; });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamSources.map(source => source.url))).toEqual([`http://original/api/sessions/${fixtures_js_1.ROOT}/stream?ticket=second`]);
});
(0, fixtures_js_1.test)('endpoint changes and disposal retire pending stream tickets', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.evaluate(() => { window.oldEndpointStart = window.ownedStream.start(); window.streamEndpoint = { base: 'http://new', token: 'fixture-new' }; fixtureElement(window.streamTickets[0], 'old stream ticket').resolve('old'); });
    await page.evaluate(() => window.oldEndpointStart);
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamSources.length)).toBe(0);
    await page.evaluate(() => { window.disposedStreamStart = window.ownedStream.start(); window.ownedStream.dispose(); fixtureElement(window.streamTickets[1], 'disposed stream ticket').reject(new Error('late')); return window.disposedStreamStart; });
    (0, fixtures_js_1.expect)(await page.evaluate(() => ({ sources: window.streamSources.length, status: window.streamStatus }))).toEqual({ sources: 0, status: [] });
});
(0, fixtures_js_1.test)('retired stream events cannot change turn state or schedule a reconnect', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.clock.install();
    await page.evaluate(() => {
        window.streamEndpoint.token = null;
        window.ownedStream.start();
        window.ownedStream.stop();
        window.emitOwnedStream(0, 'turn_start', {});
        const source = fixtureElement(window.streamSources[0], 'retired stream');
        fixtureElement(source.onerror, 'retired stream error').call(source, new Event('error'));
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionActivity.turn)).toBe(false);
    await page.clock.runFor(3100);
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamSources.length)).toBe(1);
});
(0, fixtures_js_1.test)('duplicate closed-stream errors own only one reconnect timer', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.clock.install();
    await page.evaluate(() => {
        window.streamEndpoint.token = null;
        window.ownedStream.start();
        const source = fixtureElement(window.streamSources[0], 'stream source');
        source.close();
        const onerror = fixtureElement(source.onerror, 'stream error');
        onerror.call(source, new Event('error'));
        onerror.call(source, new Event('error'));
    });
    await page.clock.runFor(3100);
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamSources.length)).toBe(2);
    await page.evaluate(() => window.ownedStream.dispose());
});
(0, fixtures_js_1.test)('duplicate completed messages and late updates cannot resurrect a streaming bubble', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.evaluate(() => {
        window.streamEndpoint.token = null;
        window.ownedStream.start();
        const message = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'completed stream answer' }] };
        window.emitOwnedStream(0, 'message_end', { message });
        window.emitOwnedStream(0, 'message_end', { message: { ...message, usage: { input: 10 } } });
        window.emitOwnedStream(0, 'message_update', { message });
    });
    await (0, fixtures_js_1.expect)(page.locator('#messages .message.assistant')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('#messages [data-streaming="true"]')).toHaveCount(0);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.sessionActivity.turn)).toBe(false);
});
(0, fixtures_js_1.test)('the newest session-switch event owns delayed list navigation', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.evaluate(child => {
        const host = fixtureCurrentSession().host;
        const previous = [...fixtureApp.features.sessionState.sessions.previous, { id: 'newer-transcript', host }];
        fixtureApp.features.sessionState.setSessionLists([...new Set(previous.map(row => row.host))].map(hostId => ({
            hostId, previous: previous.filter(row => row.host === hostId),
        })));
        window.streamEndpoint.token = null;
        window.ownedStream.start();
        window.emitOwnedStream(0, 'session_switch', { sessionId: child });
        window.emitOwnedStream(0, 'session_switch', { sessionId: 'newer-transcript' });
        fixtureElement(window.streamLoads[1], 'newer stream load')();
    }, fixtures_js_1.CHILD);
    await page.evaluate(() => fixtureElement(window.streamLoads[0], 'older stream load')());
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamSelections.map(entry => entry[0]))).toEqual(['newer-transcript']);
});
(0, fixtures_js_1.test)('an established stream reconnects quietly once after a transient drop and pauses retries while hidden', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.clock.install();
    await page.evaluate(() => {
        window.streamEndpoint.token = null;
        window.ownedStream.start();
        const first = fixtureElement(window.streamSources[0], 'first stream');
        fixtureElement(first.onopen, 'stream open').call(first, new Event('open'));
        window.streamStatus.length = 0;
        fixtureElement(first.onerror, 'transient drop').call(first, new Event('error'));
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamStatus)).toEqual([]);
    await page.clock.runFor(1100);
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamSources.length)).toBe(2);
    // A second failure before the replacement opens surfaces the disconnect status and clears on stop().
    await page.evaluate(() => {
        const second = fixtureElement(window.streamSources[1], 'second stream');
        fixtureElement(second.onerror, 'reconnect failure').call(second, new Event('error'));
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamStatus)).toEqual([['Stream disconnected', 'error']]);
    await page.evaluate(() => window.ownedStream.stop());
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamStatus)).toEqual([['Stream disconnected', 'error'], ['']]);
    // Backgrounded tabs close a dropped stream without flashing an error or looping retries.
    await page.evaluate(() => {
        window.streamStatus.length = 0;
        window.ownedStream.start();
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        const third = fixtureElement(window.streamSources[2], 'third stream');
        fixtureElement(third.onerror, 'hidden drop').call(third, new Event('error'));
    });
    await page.clock.runFor(10_000);
    (0, fixtures_js_1.expect)(await page.evaluate(() => ({ sources: window.streamSources.length, status: window.streamStatus }))).toEqual({ sources: 3, status: [] });
    await page.evaluate(() => {
        Reflect.deleteProperty(document, 'hidden');
        window.ownedStream.dispose();
    });
});
(0, fixtures_js_1.test)('a slow origin probe landing after the stream reopens does not report a stale failure', async ({ page, fleet }) => {
    await setup(page, fleet);
    await page.clock.install();
    await page.evaluate(() => {
        window.streamEndpoint = { base: '', token: null };
        window.ownedStream.start();
        const first = fixtureElement(window.streamSources[0], 'first stream');
        fixtureElement(first.onerror, 'first failure').call(first, new Event('error'));
    });
    await page.clock.runFor(3_000);
    await page.evaluate(() => {
        const second = fixtureElement(window.streamSources[1], 'second stream');
        fixtureElement(second.onerror, 'second failure').call(second, new Event('error'));
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamProbes.length)).toBe(1);
    // Stream reconnects and opens before the slow probe settles.
    await page.clock.runFor(6_000);
    await page.evaluate(() => {
        const third = fixtureElement(window.streamSources[2], 'third stream');
        fixtureElement(third.onopen, 'stream reopen').call(third, new Event('open'));
        fixtureElement(window.streamProbes[0], 'slow probe')('auth');
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.streamOriginFailures)).toEqual([null]);
    await page.evaluate(() => window.ownedStream.dispose());
});
// Playwright normally forces focus, in which case Chromium acknowledges
// Page.setWebLifecycleState without actually freezing the renderer.
const wakeTest = fixtures_js_1.test.extend({
    page: async ({ playwright, launchOptions }, use) => {
        const server = await playwright.chromium.launchServer({ ...launchOptions, args: [...launchOptions.args ?? [], '--remote-debugging-port=0'] });
        try {
            const profile = server.process().spawnargs.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
            const port = (0, node_fs_1.readFileSync)((0, node_path_1.join)(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
            const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
            try {
                await use(await browser.contexts()[0].newPage());
            }
            finally {
                await browser.close();
            }
        }
        finally {
            await server.close();
        }
    },
});
wakeTest.describe('production wake recovery', () => {
    wakeTest.use({ instrumentApp: false, liveSessions: true });
    for (const signal of ['visibilitychange', 'pageshow', 'resume', 'online']) {
        wakeTest(`recovers missed and live messages on ${signal}`, async ({ page, fleet }) => {
            const host = signal === 'visibilitychange' ? fleet.peer : fleet.self;
            const path = `${host.base}/api/sessions/${fixtures_js_1.ROOT}`;
            const initial = page.waitForResponse(r => r.url().startsWith(`${path}/messages?after=`));
            await fleet.select(host);
            await initial;
            let opens = 0, catchups = 0, navigations = 0;
            page.on('request', r => {
                if (r.url().startsWith(`${path}/stream`))
                    opens++;
                if (r.url().startsWith(`${path}/messages?after=`))
                    catchups++;
            });
            page.on('framenavigated', f => { if (f === page.mainFrame())
                navigations++; });
            const cdp = await page.context().newCDPSession(page);
            if (signal === 'resume') {
                await page.evaluate(() => {
                    document.addEventListener('freeze', () => { document.documentElement.dataset.froze = 'yes'; }, { once: true });
                });
                // Model elapsed wall time without running background timers.
                await page.clock.setFixedTime(new Date(Date.now() + 120_000));
                await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
            }
            else {
                await page.evaluate(kind => {
                    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                    document.dispatchEvent(new Event('visibilitychange'));
                    if (kind === 'pageshow')
                        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
                    // Observe the app parking its native source, not just TCP close on the server.
                    const close = EventSource.prototype.close;
                    EventSource.prototype.close = function () { close.call(this); document.documentElement.dataset.parked = 'yes'; };
                }, signal);
            }
            (0, fixtures_js_1.expect)(await host.killStreams()).toBe(1);
            if (signal !== 'resume')
                await page.waitForFunction(() => document.documentElement.dataset.parked === 'yes');
            if (host === fleet.peer)
                host.emit('turn_start', {}); // catch up before this turn ends
            host.emit('', {}, { type: 'message', message: { role: 'user', content: 'written during sleep' } });
            if (signal === 'resume') {
                await cdp.send('Page.setWebLifecycleState', { state: 'active' });
                (0, fixtures_js_1.expect)(await page.evaluate(() => document.documentElement.dataset.froze)).toBe('yes');
            }
            else {
                await page.evaluate(kind => {
                    Reflect.deleteProperty(document, 'hidden');
                    if (kind === 'visibilitychange')
                        document.dispatchEvent(new Event(kind));
                    else if (kind === 'pageshow')
                        window.dispatchEvent(new PageTransitionEvent(kind, { persisted: true }));
                    else
                        window.dispatchEvent(new Event('online'));
                    if (kind === 'visibilitychange')
                        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
                }, signal);
            }
            await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('written during sleep');
            host.emit('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'streaming after wake' }] } });
            await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('streaming after wake');
            await (0, fixtures_js_1.expect)(fleet.row(host)).toHaveClass(/\bactive\b/);
            (0, fixtures_js_1.expect)({ opens, catchups, navigations }).toEqual({ opens: 1, catchups: 1, navigations: 0 });
            await cdp.detach();
        });
    }
});
(0, fixtures_js_1.test)('stop() preserves status written by other components and by terminal stream_error / session_ended events', async ({ page, fleet }) => {
    await setup(page, fleet);
    // 1. When status writes to #status and another component overwrites it, stop() must not wipe #status.
    await page.evaluate(() => {
        const statusEl = fixtureElement(document.getElementById('status'), '#status');
        window.streamStatus.length = 0;
        const domStream = PiDishBrowser.createMessageStream({
            document,
            sessionState: fixtureApp.features.sessionState,
            endpoint: () => ({ base: 'http://original', token: null }),
            ticket: () => Promise.resolve('t'),
            source: url => {
                const s = new EventTarget();
                Object.assign(s, { url, readyState: 0, close() { this.readyState = 2; } });
                window.streamSources.push(s);
                return s;
            },
            activity: fixtureApp.features.sessionActivity,
            renderer: fixtureApp.features.messageRenderer,
            streaming: fixtureApp.features.streamingRenderer,
            tools: fixtureApp.features.liveToolsController,
            delivery: fixtureApp.features.promptDelivery,
            extensionUI: fixtureApp.features.extensionUI,
            sideChat: { apply() { } },
            status: (msg, type) => {
                statusEl.textContent = msg;
                window.streamStatus.push([msg, type]);
            },
            catchup() { }, refresh() { }, artifacts() { }, pinned: () => false, follow: () => false,
            scroll() { }, jump() { }, highlight() { }, select() { }, deleteCached() { },
            loadSessions: () => Promise.resolve(),
        });
        domStream.start();
        const first = window.streamSources.at(-1);
        first.onerror?.call(first, new Event('error'));
        // Another component updates #status after the stream error.
        statusEl.textContent = 'Model changed';
        domStream.stop();
        // 2. stream_error and session_ended arriving while activeErrorStatus is set must not have their status wiped by stop().
        domStream.start();
        const errSource = window.streamSources.at(-1);
        errSource.onerror?.call(errSource, new Event('error'));
        // Re-starting on the same selection uses disconnect() (keeping activeErrorStatus set) until the replacement opens.
        domStream.start();
        const second = window.streamSources.at(-1);
        second.dispatchEvent(new MessageEvent('stream_error', { data: JSON.stringify({ error: 'Session not active' }) }));
        window.streamStatus.push(['after-stream-error', statusEl.textContent]);
        domStream.start();
        const errSource2 = window.streamSources.at(-1);
        errSource2.onerror?.call(errSource2, new Event('error'));
        domStream.start();
        const third = window.streamSources.at(-1);
        third.dispatchEvent(new MessageEvent('session_ended', { data: '{}' }));
        window.streamStatus.push(['after-session-ended', statusEl.textContent]);
        domStream.dispose();
    });
    const statusLog = await page.evaluate(() => window.streamStatus);
    (0, fixtures_js_1.expect)(await page.locator('#status').textContent()).toBe('Session ended');
    (0, fixtures_js_1.expect)(statusLog).toContainEqual(['after-stream-error', 'Session not active']);
    (0, fixtures_js_1.expect)(statusLog).toContainEqual(['after-session-ended', 'Session ended']);
    (0, fixtures_js_1.expect)(statusLog.filter(entry => entry[0] === '')).toEqual([]);
});
