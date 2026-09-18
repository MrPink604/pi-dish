import type { Page, Route } from '@playwright/test';
import type { FleetFixture } from './fixtures.js';
import { test, expect } from './fixtures.js';
test.use({ liveSessions: true });
async function setup(page: Page, fleet: FleetFixture) {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    const self = fixtureElement(fixtureApp.features.hostDirectory.self, 'self host');
    if (typeof self.hostId !== 'string') throw new Error('Self host lacks identity');
    fixtureApp.features.hostDirectory.setSelf({ hostId: self.hostId, label: self.label, version: self.version, capabilities: { stt: true } }); fixtureApp.features.composerSpeech.updateButton();
    window.micTracks = []; window.micTrackStops = []; window.micRecorders = []; window.micPermissions = [];
    navigator.mediaDevices.getUserMedia = () => new Promise<MediaStream>((resolve, reject) => { window.micPermissions.push({ resolve, reject }); });
    window.resolveMic = (index: number) => {
      const stream = document.createElement('canvas').captureStream();
      const track = fixtureElement(stream.getTracks()[0], `microphone track ${index}`);
      const stop = track.stop.bind(track); window.micTrackStops[index] = 0;
      Object.defineProperty(track, 'stop', { value() { window.micTrackStops[index]++; stop(); } });
      window.micTracks[index] = track; fixtureElement(window.micPermissions[index], `microphone permission ${index}`).resolve(stream);
    };
    class FixtureRecorder extends EventTarget implements MediaRecorder {
      static isTypeSupported() { return true; }
      readonly audioBitsPerSecond = 0; readonly videoBitsPerSecond = 0;
      readonly mimeType: string; state: RecordingState = 'inactive';
      ondataavailable: ((this: MediaRecorder, event: BlobEvent) => unknown) | null = null;
      onerror: ((this: MediaRecorder, event: Event) => unknown) | null = null;
      onpause: ((this: MediaRecorder, event: Event) => unknown) | null = null;
      onresume: ((this: MediaRecorder, event: Event) => unknown) | null = null;
      onstart: ((this: MediaRecorder, event: Event) => unknown) | null = null;
      onstop: ((this: MediaRecorder, event: Event) => unknown) | null = null;
      constructor(readonly stream: MediaStream, options: MediaRecorderOptions = {}) { super(); this.mimeType = options.mimeType ?? 'audio/webm'; window.micRecorders.push(this); }
      start() { this.state = 'recording'; } stop() { this.state = 'inactive'; }
      pause() { this.state = 'paused'; } resume() { this.state = 'recording'; } requestData() {}
      finish(text = 'x'.repeat(1500)) { this.dispatchEvent(new BlobEvent('dataavailable', { data: new Blob([text], { type: this.mimeType }) })); this.dispatchEvent(new Event('stop')); }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FixtureRecorder });
  });
}

test('cancelled microphone permission stops its late tracks and never starts a recorder', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { window.pendingMic = fixtureApp.features.composerSpeech.start(); fixtureApp.features.composerSpeech.cancel(); window.resolveMic(0); }); await page.evaluate(() => window.pendingMic);
  expect(await page.evaluate(() => ({ stops: window.micTrackStops[0], recorders: window.micRecorders.length, active: fixtureApp.features.composerSpeech.isRecording() }))).toEqual({ stops: 1, recorders: 0, active: false });
});

test('touch release before permission resolves retires the held take', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    const button = fixtureElement(document.getElementById('btnMic'), '#btnMic'); button.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 7 }));
    button.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 7 })); window.resolveMic(0);
  });
  await expect.poll(() => page.evaluate(() => window.micTrackStops[0])).toBe(1); expect(await page.evaluate(() => window.micRecorders.length)).toBe(0);
});

test('a late cancelled recorder stop cannot release a new recording or transcribe old chunks', async ({ page, fleet }) => {
  await setup(page, fleet); let writes = 0;
  await page.route('**/api/stt', route => { writes++; return route.fulfill({ json: { text: 'stale' } }); });
  await page.evaluate(async () => { const first = fixtureApp.features.composerSpeech.start(); window.resolveMic(0); await first; fixtureApp.features.composerSpeech.cancel(); const second = fixtureApp.features.composerSpeech.start(); window.resolveMic(1); await second; fixtureElement(window.micRecorders[0], 'old recorder').finish(); });
  expect(await page.evaluate(() => ({ oldStops: window.micTrackStops[0], newStops: window.micTrackStops[1], active: fixtureApp.features.composerSpeech.isRecording() }))).toEqual({ oldStops: 1, newStops: 0, active: true }); expect(writes).toBe(0);
  await page.evaluate(() => fixtureApp.features.composerSpeech.cancel());
});

test('late transcription results cannot enter a same-id peer composer or clear a newer take', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    const request = fixtureApp.features.apiTransport.request;
    fixtureApp.features.apiTransport.request = (host, path, options) => path === '/api/stt' ? new Promise(resolve => { window.resolveTranscript = () => resolve(new Response(JSON.stringify({ text: 'Old dictation' }), { status: 200 })); }) : request(host, path, options);
    window.oldTranscription = fixtureApp.features.composerSpeech.transcribe(new Blob(['audio']), 'audio/webm');
  });
  await fleet.select(fleet.peer); await page.locator('#promptInput').fill('Peer draft');
  await page.evaluate(async () => { const start = fixtureApp.features.composerSpeech.start(); window.resolveMic(0); await start; window.resolveTranscript(); await window.oldTranscription; });
  await expect(page.locator('#promptInput')).toHaveValue('Peer draft'); expect(await page.evaluate(() => fixtureApp.features.composerSpeech.isRecording())).toBe(true);
  await page.evaluate(() => fixtureApp.features.composerSpeech.cancel());
});

test('transcription is inserted at the caret without submitting and non-string wire text is rejected', async ({ page, fleet }) => {
  await setup(page, fleet); let calls = 0, prompts = 0;
  await page.route('**/api/stt', route => { calls++; return route.fulfill({ json: { text: calls === 1 ? 'dictated words' : { command: 'send' } } }); });
  await page.route('**/api/sessions/*/prompt', route => { prompts++; return route.fulfill({ json: { success: true } }); });
  await page.locator('#promptInput').fill('before after');
  await page.evaluate(async () => { fixtureElement(document.querySelector<HTMLTextAreaElement>('#promptInput'), '#promptInput').setSelectionRange(7, 7); await fixtureApp.features.composerSpeech.transcribe(new Blob(['audio']), 'audio/webm'); });
  await expect(page.locator('#promptInput')).toHaveValue('before dictated words after'); expect(prompts).toBe(0);
  await page.evaluate(() => fixtureApp.features.composerSpeech.transcribe(new Blob(['audio']), 'audio/webm')); await expect(page.locator('#composerNote')).toContainText('No speech detected');
  await expect(page.locator('#promptInput')).toHaveValue('before dictated words after');
});

test('replaced composer note buttons cannot dismiss a new note', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { fixtureApp.features.composerNotes.show('First'); window.oldDismiss = document.querySelector<HTMLElement>('.composer-note-dismiss'); fixtureApp.features.composerNotes.show('<strong>Second</strong>'); fixtureElement(window.oldDismiss, 'old note dismiss').click(); });
  await expect(page.locator('#composerNote')).toContainText('<strong>Second</strong>'); await expect(page.locator('#composerNote strong')).toHaveCount(0);
  await page.locator('.composer-note-dismiss').click(); await expect(page.locator('#composerNote')).toBeHidden();
});

test('speech disposal releases active tracks and prevents further microphone actions', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(async () => { const start = fixtureApp.features.composerSpeech.start(); window.resolveMic(0); await start; fixtureApp.features.composerSpeech.dispose(); fixtureApp.features.composerNotes.dispose(); await fixtureApp.features.composerSpeech.start(); fixtureElement(document.getElementById('btnMic'), "document.getElementById('btnMic')").click(); fixtureApp.features.composerNotes.show('retired'); });
  expect(await page.evaluate(() => ({ stops: window.micTrackStops[0], permissions: window.micPermissions.length, active: fixtureApp.features.composerSpeech.isRecording() }))).toEqual({ stops: 1, permissions: 1, active: false });
  await expect(page.locator('#composerNote')).toBeHidden();
});

export {};
