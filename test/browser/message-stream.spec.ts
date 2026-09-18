import type { Page, Route } from '@playwright/test';
import type { FleetFixture } from './fixtures.js';
import { test, expect, ROOT, CHILD } from './fixtures.js';
async function setup(page: Page, fleet: FleetFixture) {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    fixtureApp.features.messageStreamController.stop();
    window.streamSources = []; window.streamTickets = []; window.streamLoads = []; window.streamSelections = []; window.streamStatus = [];
    window.streamEndpoint = { base: 'http://original', token: 'fixture-token' };
    window.ownedStream = PiDishBrowser.createMessageStream({ document, sessionState: fixtureApp.features.sessionState, endpoint: () => window.streamEndpoint,
      ticket: () => new Promise<string>((resolve, reject) => window.streamTickets.push({ resolve, reject })),
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
      activity: fixtureApp.features.sessionActivity, renderer: fixtureApp.features.messageRenderer, streaming: fixtureApp.features.streamingRenderer, tools: fixtureApp.features.liveToolsController, delivery: fixtureApp.features.promptDelivery, extensionUI: fixtureApp.features.extensionUI,
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

export {};
