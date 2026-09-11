const { test, expect } = require('./fixtures');
test.use({ liveSessions: true });
async function setup(page, fleet) {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    hostDirectory.setSelf({ ...hostDirectory.self, capabilities: { stt: true } }); updateMicButton();
    window.micTracks = []; window.micRecorders = []; window.micPermissions = [];
    navigator.mediaDevices.getUserMedia = () => new Promise((resolve, reject) => { window.micPermissions.push({ resolve, reject }); });
    window.resolveMic = index => {
      const track = { stops: 0, stop() { this.stops++; } }; window.micTracks[index] = track;
      window.micPermissions[index].resolve({ getTracks: () => [track] });
    };
    window.MediaRecorder = class extends EventTarget {
      static isTypeSupported() { return true; }
      constructor(stream, options) { super(); this.stream = stream; this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive'; window.micRecorders.push(this); }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; }
      finish(text = 'x'.repeat(1500)) { this.dispatchEvent(new BlobEvent('dataavailable', { data: new Blob([text], { type: this.mimeType }) })); this.dispatchEvent(new Event('stop')); }
    };
  });
}

test('cancelled microphone permission stops its late tracks and never starts a recorder', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { window.pendingMic = startRecording(); cancelRecording(); window.resolveMic(0); }); await page.evaluate(() => window.pendingMic);
  expect(await page.evaluate(() => ({ stops: window.micTracks[0].stops, recorders: window.micRecorders.length, active: isRecording() }))).toEqual({ stops: 1, recorders: 0, active: false });
});

test('touch release before permission resolves retires the held take', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    const button = document.getElementById('btnMic'); button.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 7 }));
    button.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 7 })); window.resolveMic(0);
  });
  await expect.poll(() => page.evaluate(() => window.micTracks[0].stops)).toBe(1); expect(await page.evaluate(() => window.micRecorders.length)).toBe(0);
});

test('a late cancelled recorder stop cannot release a new recording or transcribe old chunks', async ({ page, fleet }) => {
  await setup(page, fleet); let writes = 0;
  await page.route('**/api/stt', route => { writes++; return route.fulfill({ json: { text: 'stale' } }); });
  await page.evaluate(async () => { const first = startRecording(); window.resolveMic(0); await first; cancelRecording(); const second = startRecording(); window.resolveMic(1); await second; window.micRecorders[0].finish(); });
  expect(await page.evaluate(() => ({ oldStops: window.micTracks[0].stops, newStops: window.micTracks[1].stops, active: isRecording() }))).toEqual({ oldStops: 1, newStops: 0, active: true }); expect(writes).toBe(0);
  await page.evaluate(() => cancelRecording());
});

test('late transcription results cannot enter a same-id peer composer or clear a newer take', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    const request = apiFetch;
    apiFetch = (host, path, options) => path === '/api/stt' ? new Promise(resolve => { window.resolveTranscript = () => resolve(new Response(JSON.stringify({ text: 'Old dictation' }), { status: 200 })); }) : request(host, path, options);
    window.oldTranscription = transcribeRecording(new Blob(['audio']), 'audio/webm');
  });
  await fleet.select(fleet.peer); await page.locator('#promptInput').fill('Peer draft');
  await page.evaluate(async () => { const start = startRecording(); window.resolveMic(0); await start; window.resolveTranscript(); await window.oldTranscription; });
  await expect(page.locator('#promptInput')).toHaveValue('Peer draft'); expect(await page.evaluate(() => isRecording())).toBe(true);
  await page.evaluate(() => cancelRecording());
});

test('transcription is inserted at the caret without submitting and non-string wire text is rejected', async ({ page, fleet }) => {
  await setup(page, fleet); let calls = 0, prompts = 0;
  await page.route('**/api/stt', route => { calls++; return route.fulfill({ json: { text: calls === 1 ? 'dictated words' : { command: 'send' } } }); });
  await page.route('**/api/sessions/*/prompt', route => { prompts++; return route.fulfill({ json: { success: true } }); });
  await page.locator('#promptInput').fill('before after');
  await page.evaluate(async () => { document.getElementById('promptInput').setSelectionRange(7, 7); await transcribeRecording(new Blob(['audio']), 'audio/webm'); });
  await expect(page.locator('#promptInput')).toHaveValue('before dictated words after'); expect(prompts).toBe(0);
  await page.evaluate(() => transcribeRecording(new Blob(['audio']), 'audio/webm')); await expect(page.locator('#composerNote')).toContainText('No speech detected');
  await expect(page.locator('#promptInput')).toHaveValue('before dictated words after');
});

test('replaced composer note buttons cannot dismiss a new note', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => { showComposerNote('First'); window.oldDismiss = document.querySelector('.composer-note-dismiss'); showComposerNote('<strong>Second</strong>'); window.oldDismiss.click(); });
  await expect(page.locator('#composerNote')).toContainText('<strong>Second</strong>'); await expect(page.locator('#composerNote strong')).toHaveCount(0);
  await page.locator('.composer-note-dismiss').click(); await expect(page.locator('#composerNote')).toBeHidden();
});

test('speech disposal releases active tracks and prevents further microphone actions', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(async () => { const start = startRecording(); window.resolveMic(0); await start; composerSpeech.dispose(); composerNotes.dispose(); await startRecording(); document.getElementById('btnMic').click(); showComposerNote('retired'); });
  expect(await page.evaluate(() => ({ stops: window.micTracks[0].stops, permissions: window.micPermissions.length, active: isRecording() }))).toEqual({ stops: 1, permissions: 1, active: false });
  await expect(page.locator('#composerNote')).toBeHidden();
});
