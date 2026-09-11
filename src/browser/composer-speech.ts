import type { ApiRequest } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import type { EffectiveHost } from './host-catalog';
import { sttUnavailableReason, formatDuration, insertAtCaret } from './helper-format';
import { record } from './helper-values';
export function createComposerSpeech(options: {
  document: Document; sessionState: SessionState; composerKey: () => string | null; hosts: () => readonly EffectiveHost[];
  config: () => Readonly<Record<string, unknown>>; request: ApiRequest;
  status: (message: string) => void; showNote: (text: string) => void; hideNote: () => void;
}) {
  const { document, sessionState } = options, window = document.defaultView!, navigator = window.navigator;
  const button = () => document.getElementById('btnMic');
  interface ComposerOwner { key: string; selection: SelectionOwner | null }
  interface Take { owner: ComposerOwner; stream: MediaStream | null; recorder: MediaRecorder | null; chunks: Blob[]; started: number; timer: ReturnType<typeof setInterval> | null; events: AbortController }
  interface Transcription { owner: ComposerOwner; host: Readonly<EffectiveHost>; events: AbortController }
  let disposed = false, mounted = false, take: Take | null = null, transcription: Transcription | null = null, pointerType = '';
  const lifetime = new AbortController();
  const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
  const errorName = (e: unknown) => record(e) && typeof e.name === 'string' ? e.name : 'unknown';
  function capture(): ComposerOwner | null { const key = options.composerKey(); return !disposed && key ? { key, selection: sessionState.captureSelection() } : null; }
  function owns(owner: ComposerOwner) { return !disposed && options.composerKey() === owner.key && (!owner.selection || sessionState.ownsSelection(owner.selection)); }
  function host() { return options.hosts().find(entry => record(entry.capabilities) ? entry.capabilities.stt === true : (entry.self === true || entry.base === '') && !!options.config().stt) || null; }
  function reason() { return sttUnavailableReason({ isSecureContext: !!window.isSecureContext, hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia, hasMediaRecorder: typeof window.MediaRecorder === 'function', origin: window.location.origin }); }
  // Pending permission is cancellable by the same Escape/session-switch path.
  function isRecording() { return !!take; }
  function updateButton() {
    const btn = button(); if (!btn || disposed) return;
    if (!host()) { btn.style.display = 'none'; return; }
    const unavailable = reason(); btn.style.display = 'inline-flex'; btn.classList.toggle('unavailable', !!unavailable);
    if (unavailable) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
    btn.classList.toggle('recording', !!take?.recorder); btn.classList.toggle('busy', !!transcription);
    btn.title = unavailable ? unavailable.message : take ? 'Stop recording' : transcription ? 'Transcribing…' : 'Dictate (speech to text)';
  }
  function stopTracks(stream: MediaStream | null) { if (stream) for (const track of stream.getTracks()) { try { track.stop(); } catch {} } }
  function retire(entry: Take, stopRecorder = false) {
    entry.events.abort(); if (entry.timer !== null) clearInterval(entry.timer); entry.timer = null;
    if (take === entry) take = null;
    if (stopRecorder && entry.recorder && entry.recorder.state !== 'inactive') { try { entry.recorder.stop(); } catch {} }
    stopTracks(entry.stream); entry.stream = null; entry.chunks = [];
  }
  function release() { if (take) retire(take, true); updateButton(); }
  function cancel() {
    const active = !!take || !!transcription;
    if (take) retire(take, true);
    if (transcription) { transcription.events.abort(); transcription = null; }
    if (active) options.status(''); updateButton();
  }
  function updateStatus() {
    const entry = take; if (!entry?.recorder) return;
    if (!owns(entry.owner)) { retire(entry, true); updateButton(); return; }
    const elapsed = Date.now() - entry.started; if (elapsed >= 5 * 60 * 1000) { stop(); return; }
    options.status(`Recording ${formatDuration(elapsed)}`);
  }
  async function start() {
    if (disposed || take || transcription) return;
    const owner = capture(); if (!owner || !host()) return;
    const unavailable = reason(); if (unavailable) { options.showNote(unavailable.message); return; }
    options.hideNote();
    const entry: Take = { owner, stream: null, recorder: null, chunks: [], started: 0, timer: null, events: new AbortController() }; take = entry;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (error) {
      if (take !== entry) return;
      retire(entry); if (!owns(owner)) { updateButton(); return; } const name = errorName(error);
      options.showNote(name === 'NotAllowedError' ? "Microphone access was denied. Allow the microphone for this site in the browser's site settings and try again." : name === 'NotFoundError' ? 'No microphone found.' : `Microphone error: ${name}`); updateButton(); return;
    }
    if (take !== entry || !owns(owner)) { stopTracks(stream); if (take === entry) retire(entry); updateButton(); return; }
    entry.stream = stream;
    const mime = MIME_TYPES.find(type => typeof window.MediaRecorder.isTypeSupported === 'function' && window.MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try { recorder = mime ? new window.MediaRecorder(stream, { mimeType: mime }) : new window.MediaRecorder(stream); }
    catch {
      try { recorder = new window.MediaRecorder(stream); }
      catch (error) { retire(entry); if (owns(owner)) options.showNote(`Microphone error: ${errorName(error)}`); updateButton(); return; }
    }
    entry.recorder = recorder; entry.started = Date.now();
    recorder.addEventListener('dataavailable', event => { if (take === entry && owns(owner) && event.data?.size) entry.chunks.push(event.data); }, { signal: entry.events.signal });
    recorder.addEventListener('stop', () => finish(recorder), { signal: entry.events.signal });
    recorder.addEventListener('error', event => {
      if (take !== entry) return; retire(entry); if (owns(owner)) options.showNote(`Microphone error: ${'error' in event ? errorName(event.error) : 'unknown'}`); updateButton();
    }, { signal: entry.events.signal });
    try { recorder.start(); }
    catch (error) { retire(entry); if (owns(owner)) options.showNote(`Microphone error: ${errorName(error)}`); updateButton(); return; }
    if (take !== entry) return;
    entry.timer = setInterval(updateStatus, 1000); updateStatus(); updateButton();
  }
  function stop() {
    const entry = take; if (!entry) return;
    if (!entry.recorder) { cancel(); return; }
    try { if (entry.recorder.state !== 'inactive') entry.recorder.stop(); }
    catch { retire(entry); updateButton(); }
  }
  function finish(recorder: MediaRecorder) {
    const entry = take; if (!entry || entry.recorder !== recorder) return;
    const chunks = [...entry.chunks], owner = entry.owner, mime = recorder.mimeType || 'audio/webm'; retire(entry); updateButton();
    if (!owns(owner)) return;
    const blob = new Blob(chunks, { type: mime }); if (blob.size < 1024) { options.status(''); options.showNote('Nothing was recorded.'); return; }
    void transcribe(blob, mime, owner);
  }
  async function transcribe(blob: Blob, mime: string, owner = capture()) {
    if (!owner || !owns(owner) || transcription) return;
    const endpoint = host(); if (!endpoint) { options.status(''); return; }
    const entry: Transcription = { owner, host: Object.freeze({ ...endpoint }), events: new AbortController() }; transcription = entry;
    const current = () => transcription === entry && owns(owner) && options.hosts().some(host => host.hostId === entry.host.hostId && host.base === entry.host.base);
    updateButton(); options.status('Transcribing…');
    try {
      const response = await options.request(entry.host, '/api/stt', { method: 'POST', headers: { 'Content-Type': mime }, body: blob, signal: entry.events.signal });
      const value: unknown = await response.json().catch(() => null); if (!current()) return;
      if (!response.ok) throw new Error(record(value) && typeof value.error === 'string' ? value.error : `Transcription failed (HTTP ${response.status})`);
      const text = record(value) && typeof value.text === 'string' ? value.text.trim() : '';
      if (!text) { options.showNote('No speech detected.'); return; }
      insert(text);
    } catch (error) { if (current()) options.showNote(error instanceof Error ? error.message : 'Transcription failed'); }
    finally {
      if (transcription === entry) { transcription = null; if (owns(owner)) options.status(''); updateButton(); }
    }
  }
  function insert(text: string) {
    if (disposed) return; const input = document.getElementById('promptInput') as HTMLTextAreaElement | null; if (!input) return;
    const result = insertAtCaret(input.value, input.selectionStart, input.selectionEnd, text); input.value = result.value;
    try { input.setSelectionRange(result.caret, result.caret); } catch {} input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
  }
  function mount() {
    const btn = button(); if (!btn || disposed || mounted) return; mounted = true; const signal = lifetime.signal;
    btn.addEventListener('pointerdown', event => {
      pointerType = event.pointerType || 'mouse'; const unavailable = reason(); if (unavailable) { options.showNote(unavailable.message); return; }
      if (pointerType === 'touch') { event.preventDefault(); try { btn.setPointerCapture(event.pointerId); } catch {} void start(); }
    }, { signal });
    const releaseHold = (event: PointerEvent) => { if ((event.pointerType || pointerType) === 'touch') stop(); };
    btn.addEventListener('pointerup', releaseHold, { signal }); btn.addEventListener('pointercancel', releaseHold, { signal }); btn.addEventListener('pointerleave', releaseHold, { signal });
    btn.addEventListener('click', event => {
      event.preventDefault(); const held = pointerType === 'touch'; pointerType = ''; if (held) return;
      const unavailable = reason(); if (unavailable) { options.showNote(unavailable.message); return; }
      if (transcription) return; if (take) stop(); else void start();
    }, { signal });
  }
  return { host, reason, isRecording, updateButton, mount, updateStatus, start, stop, cancel, release, finish, transcribe, insert,
    dispose() { cancel(); lifetime.abort(); disposed = true; },
  };
}
