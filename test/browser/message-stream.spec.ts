import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FleetFixture } from './fixtures.js';
import { test, expect, ROOT, CHILD } from './fixtures.js';
async function setup(page: Page, fleet: FleetFixture) {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    fixtureApp.features.messageStreamController.stop();
    window.streamSources = []; window.streamTickets = []; window.streamLoads = []; window.streamSelections = []; window.streamStatus = [];
    window.streamOriginFailures = []; window.streamProbes = [];
    window.streamEndpoint = { base: 'http://original', token: 'fixture-token' };
    window.ownedStream = PiDishBrowser.createMessageStream({ document, sessionState: fixtureApp.features.sessionState, endpoint: () => window.streamEndpoint,
      ticket: () => new Promise<string>((resolve, reject) => window.streamTickets.push({ resolve, reject })),
      originFailure: failure => { window.streamOriginFailures.push(failure); },
      probeOrigin: () => new Promise(resolve => { window.streamProbes.push(resolve); }),
      source: url => {
        class FixtureSource extends EventTarget implements EventSource {
          readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2;
          onerror: ((this: EventSource, event: Event) => unknown) | null = null;
          onmessage: ((this: EventSource, event: MessageEvent) => unknown) | null = null;
          onopen: ((this: EventSource, event: Event) => unknown) | null = null;
          readyState = this.CONNECTING; readonly withCredentials = false;
          constructor(readonly url: string) { super(); }
          close() { this.readyState = this.CLOSED; }
          addEventListener<K extends keyof EventSourceEventMap>(type: K, listener: (this: EventSource, event: EventSourceEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void;
          addEventListener(type: string, listener: (this: EventSource, event: MessageEvent) => unknown, options?: boolean | AddEventListenerOptions): void;
          addEventListener(type: string, listener: unknown, options?: boolean | AddEventListenerOptions): void {
            Reflect.apply(EventTarget.prototype.addEventListener, this, [type, listener, options]);
          }
          removeEventListener<K extends keyof EventSourceEventMap>(type: K, listener: (this: EventSource, event: EventSourceEventMap[K]) => unknown, options?: boolean | EventListenerOptions): void;
          removeEventListener(type: string, listener: (this: EventSource, event: MessageEvent) => unknown, options?: boolean | EventListenerOptions): void;
          removeEventListener(type: string, listener: unknown, options?: boolean | EventListenerOptions): void {
            Reflect.apply(EventTarget.prototype.removeEventListener, this, [type, listener, options]);
          }
        }
        const source = new FixtureSource(url); window.streamSources.push(source); return source;
      },
      activity: fixtureApp.features.sessionActivity, renderer: fixtureApp.features.messageRenderer, streaming: fixtureApp.features.streamingRenderer, tools: fixtureApp.features.liveToolsController, delivery: fixtureApp.features.promptDelivery, extensionUI: fixtureApp.features.extensionUI, sideChat: { apply() {} },
      status: (...args) => { window.streamStatus.push(args); }, catchup() {}, refresh() {}, artifacts() {}, pinned: () => false, follow: () => false, scroll() {}, jump() {}, highlight() {},
      select: (...args) => { window.streamSelections.push(args); }, deleteCached() {}, loadSessions: () => new Promise<void>(resolve => { window.streamLoads.push(resolve); }),
    });
    window.emitOwnedStream = (index: number, type: string, value: unknown) => fixtureElement(window.streamSources[index], `stream source ${index}`).dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value) }));
  });
}
test('only the newest ticket request may open a stream for the same selection', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { window.firstStreamStart = window.ownedStream.start(); window.secondStreamStart = window.ownedStream.start(); fixtureElement(window.streamTickets[1], 'second stream ticket').resolve('second'); });
  await page.evaluate(() => window.secondStreamStart);
  await page.evaluate(() => { fixtureElement(window.streamTickets[0], 'first stream ticket').resolve('first'); return window.firstStreamStart; });
  expect(await page.evaluate(() => window.streamSources.map(source => source.url))).toEqual([`http://original/api/sessions/${ROOT}/stream?ticket=second`]);
});
test('endpoint changes and disposal retire pending stream tickets', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { window.oldEndpointStart = window.ownedStream.start(); window.streamEndpoint = { base: 'http://new', token: 'fixture-new' }; fixtureElement(window.streamTickets[0], 'old stream ticket').resolve('old'); });
  await page.evaluate(() => window.oldEndpointStart);
  expect(await page.evaluate(() => window.streamSources.length)).toBe(0);
  await page.evaluate(() => { window.disposedStreamStart = window.ownedStream.start(); window.ownedStream.dispose(); fixtureElement(window.streamTickets[1], 'disposed stream ticket').reject(new Error('late')); return window.disposedStreamStart; });
  expect(await page.evaluate(() => ({ sources: window.streamSources.length, status: window.streamStatus }))).toEqual({ sources: 0, status: [] });
});
test('retired stream events cannot change turn state or schedule a reconnect', async ({ page, fleet }) => {
  await setup(page, fleet); await page.clock.install();
  await page.evaluate(() => {
    window.streamEndpoint.token = null; window.ownedStream.start(); window.ownedStream.stop(); window.emitOwnedStream(0, 'turn_start', {});
    const source = fixtureElement(window.streamSources[0], 'retired stream');
    fixtureElement(source.onerror, 'retired stream error').call(source, new Event('error'));
  });
  expect(await page.evaluate(() => fixtureApp.features.sessionActivity.turn)).toBe(false);
  await page.clock.runFor(3100);
  expect(await page.evaluate(() => window.streamSources.length)).toBe(1);
});
test('duplicate closed-stream errors own only one reconnect timer', async ({ page, fleet }) => {
  await setup(page, fleet); await page.clock.install();
  await page.evaluate(() => {
    window.streamEndpoint.token = null; window.ownedStream.start();
    const source = fixtureElement(window.streamSources[0], 'stream source'); source.close();
    const onerror = fixtureElement(source.onerror, 'stream error'); onerror.call(source, new Event('error')); onerror.call(source, new Event('error'));
  });
  await page.clock.runFor(3100);
  expect(await page.evaluate(() => window.streamSources.length)).toBe(2);
  await page.evaluate(() => window.ownedStream.dispose());
});
test('duplicate completed messages and late updates cannot resurrect a streaming bubble', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    window.streamEndpoint.token = null; window.ownedStream.start();
    const message = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'completed stream answer' }] };
    window.emitOwnedStream(0, 'message_end', { message }); window.emitOwnedStream(0, 'message_end', { message: { ...message, usage: { input: 10 } } }); window.emitOwnedStream(0, 'message_update', { message });
  });
  await expect(page.locator('#messages .message.assistant')).toHaveCount(1);
  await expect(page.locator('#messages [data-streaming="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => fixtureApp.features.sessionActivity.turn)).toBe(false);
});
test('the newest session-switch event owns delayed list navigation', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(child => {
    const host = fixtureCurrentSession().host;
    const previous = [...fixtureApp.features.sessionState.sessions.previous, { id: 'newer-transcript', host }];
    fixtureApp.features.sessionState.setSessionLists([...new Set(previous.map(row => row.host))].map(hostId => ({
      hostId, previous: previous.filter(row => row.host === hostId),
    })));
    window.streamEndpoint.token = null; window.ownedStream.start();
    window.emitOwnedStream(0, 'session_switch', { sessionId: child }); window.emitOwnedStream(0, 'session_switch', { sessionId: 'newer-transcript' });
    fixtureElement(window.streamLoads[1], 'newer stream load')();
  }, CHILD);
  await page.evaluate(() => fixtureElement(window.streamLoads[0], 'older stream load')());
  expect(await page.evaluate(() => window.streamSelections.map(entry => entry[0]))).toEqual(['newer-transcript']);
});
test('an established stream reconnects quietly once after a transient drop and pauses retries while hidden', async ({ page, fleet }) => {
  await setup(page, fleet); await page.clock.install();
  await page.evaluate(() => {
    window.streamEndpoint.token = null; window.ownedStream.start();
    const first = fixtureElement(window.streamSources[0], 'first stream');
    fixtureElement(first.onopen, 'stream open').call(first, new Event('open'));
    window.streamStatus.length = 0;
    fixtureElement(first.onerror, 'transient drop').call(first, new Event('error'));
  });
  expect(await page.evaluate(() => window.streamStatus)).toEqual([]);
  await page.clock.runFor(1100);
  expect(await page.evaluate(() => window.streamSources.length)).toBe(2);
  // A second failure before the replacement opens surfaces the disconnect status and clears on stop().
  await page.evaluate(() => {
    const second = fixtureElement(window.streamSources[1], 'second stream');
    fixtureElement(second.onerror, 'reconnect failure').call(second, new Event('error'));
  });
  expect(await page.evaluate(() => window.streamStatus)).toEqual([['Stream disconnected', 'error']]);
  await page.evaluate(() => window.ownedStream.stop());
  expect(await page.evaluate(() => window.streamStatus)).toEqual([['Stream disconnected', 'error'], ['']]);

  // Backgrounded tabs close a dropped stream without flashing an error or looping retries.
  await page.evaluate(() => {
    window.streamStatus.length = 0;
    window.ownedStream.start();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const third = fixtureElement(window.streamSources[2], 'third stream');
    fixtureElement(third.onerror, 'hidden drop').call(third, new Event('error'));
  });
  await page.clock.runFor(10_000);
  expect(await page.evaluate(() => ({ sources: window.streamSources.length, status: window.streamStatus }))).toEqual({ sources: 3, status: [] });
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    window.ownedStream.dispose();
  });
});

test('a slow origin probe landing after the stream reopens does not report a stale failure', async ({ page, fleet }) => {
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
  expect(await page.evaluate(() => window.streamProbes.length)).toBe(1);
  // Stream reconnects and opens before the slow probe settles.
  await page.clock.runFor(6_000);
  await page.evaluate(() => {
    const third = fixtureElement(window.streamSources[2], 'third stream');
    fixtureElement(third.onopen, 'stream reopen').call(third, new Event('open'));
    fixtureElement(window.streamProbes[0], 'slow probe')('auth');
  });
  expect(await page.evaluate(() => window.streamOriginFailures)).toEqual([null]);
  await page.evaluate(() => window.ownedStream.dispose());
});

// Playwright normally forces focus, in which case Chromium acknowledges
// Page.setWebLifecycleState without actually freezing the renderer.
const wakeTest = test.extend({
  page: async ({ playwright, launchOptions }, use) => {
    const server = await playwright.chromium.launchServer({ ...launchOptions, args: [...launchOptions.args ?? [], '--remote-debugging-port=0'] });
    try {
      const profile = server.process().spawnargs.find(arg => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
      const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
      try { await use(await browser.contexts()[0]!.newPage()); } finally { await browser.close(); }
    } finally { await server.close(); }
  },
});

wakeTest.describe('production wake recovery', () => {
  wakeTest.use({ instrumentApp: false, liveSessions: true });
  for (const signal of ['visibilitychange', 'pageshow', 'resume', 'online'] as const) {
    wakeTest(`recovers missed and live messages on ${signal}`, async ({ page, fleet }) => {
      const host = signal === 'visibilitychange' ? fleet.peer : fleet.self;
      const path = `${host.base}/api/sessions/${ROOT}`;
      const initial = page.waitForResponse(r => r.url().startsWith(`${path}/messages?after=`));
      await fleet.select(host);
      await initial;
      let opens = 0, catchups = 0, navigations = 0;
      page.on('request', r => {
        if (r.url().startsWith(`${path}/stream`)) opens++;
        if (r.url().startsWith(`${path}/messages?after=`)) catchups++;
      });
      page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });
      const cdp = await page.context().newCDPSession(page);
      if (signal === 'resume') {
        await page.evaluate(() => {
          document.addEventListener('freeze', () => { document.documentElement.dataset.froze = 'yes'; }, { once: true });
        });
        // Model elapsed wall time without running background timers.
        await page.clock.setFixedTime(new Date(Date.now() + 120_000));
        await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      } else {
        await page.evaluate(kind => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
          if (kind === 'pageshow') window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
          // Observe the app parking its native source, not just TCP close on the server.
          const close = EventSource.prototype.close;
          EventSource.prototype.close = function () { close.call(this); document.documentElement.dataset.parked = 'yes'; };
        }, signal);
      }
      expect(await host.killStreams()).toBe(1);
      if (signal !== 'resume') await page.waitForFunction(() => document.documentElement.dataset.parked === 'yes');
      if (host === fleet.peer) host.emit('turn_start', {}); // catch up before this turn ends
      host.emit('', {}, { type: 'message', message: { role: 'user', content: 'written during sleep' } });
      if (signal === 'resume') {
        await cdp.send('Page.setWebLifecycleState', { state: 'active' });
        expect(await page.evaluate(() => document.documentElement.dataset.froze)).toBe('yes');
      } else {
        await page.evaluate(kind => {
          Reflect.deleteProperty(document, 'hidden');
          if (kind === 'visibilitychange') document.dispatchEvent(new Event(kind));
          else if (kind === 'pageshow') window.dispatchEvent(new PageTransitionEvent(kind, { persisted: true }));
          else window.dispatchEvent(new Event('online'));
          if (kind === 'visibilitychange') window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        }, signal);
      }
      await expect(page.locator('#messages')).toContainText('written during sleep');
      host.emit('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'streaming after wake' }] } });
      await expect(page.locator('#messages')).toContainText('streaming after wake');
      await expect(fleet.row(host)).toHaveClass(/\bactive\b/);
      expect({ opens, catchups, navigations }).toEqual({ opens: 1, catchups: 1, navigations: 0 });
      await cdp.detach();
    });
  }
});

export {};
