/**
 * Unit tests for lib/stt.js — the "bring your own endpoint" speech-to-text
 * relay. `transcribe` takes its fetch, so the multipart parts, the bearer
 * header and every error mapping are asserted without a network.
 */
const test = require('node:test');
const assert = require('node:assert');

const { resolveSttConfig, sttFilename, upstreamErrorMessage, transcribe } = require('../lib/stt');

const NO_ENV = {};

test('resolveSttConfig reads the settings block and defaults the model', () => {
  assert.equal(resolveSttConfig({}, NO_ENV), null);
  assert.equal(resolveSttConfig({ stt: {} }, NO_ENV), null);
  assert.equal(resolveSttConfig(null, NO_ENV), null);

  assert.deepEqual(resolveSttConfig({ stt: { url: 'https://api.example/v1/audio/transcriptions' } }, NO_ENV), {
    url: 'https://api.example/v1/audio/transcriptions',
    apiKey: null,
    model: 'whisper-1',
    language: null,
  });

  assert.deepEqual(resolveSttConfig({
    stt: { url: '  http://box.local:8000/v1/audio/transcriptions  ', apiKey: ' sk-abc ', model: ' whisper-large-v3-turbo ', language: 'en' },
  }, NO_ENV), {
    url: 'http://box.local:8000/v1/audio/transcriptions',
    apiKey: 'sk-abc',
    model: 'whisper-large-v3-turbo',
    language: 'en',
  });
});

test('resolveSttConfig rejects non-http urls and bad languages, and takes env overrides per field', () => {
  for (const url of ['not a url', 'ftp://x/y', 'file:///etc/passwd', '/relative/path', '']) {
    assert.equal(resolveSttConfig({ stt: { url } }, NO_ENV), null, url);
  }

  // Language must look like a BCP-47 code; anything else is dropped rather
  // than forwarded (an upstream 400 for a typo is a worse failure mode).
  for (const language of ['english', 'e', 'en_US', 'en-', '1234']) {
    assert.equal(resolveSttConfig({ stt: { url: 'https://api.example/t', language } }, NO_ENV).language, null, language);
  }
  for (const language of ['en', 'fr', 'yue', 'pt-BR', 'zh-Hans']) {
    assert.equal(resolveSttConfig({ stt: { url: 'https://api.example/t', language } }, NO_ENV).language, language);
  }

  const settings = { stt: { url: 'https://file.example/t', apiKey: 'file-key', model: 'file-model', language: 'de' } };
  assert.deepEqual(resolveSttConfig(settings, {
    PI_DISH_STT_URL: 'https://env.example/t',
    PI_DISH_STT_API_KEY: 'env-key',
    PI_DISH_STT_MODEL: 'env-model',
    PI_DISH_STT_LANGUAGE: 'fr',
  }), { url: 'https://env.example/t', apiKey: 'env-key', model: 'env-model', language: 'fr' });

  // Per field: only the key comes from the environment here.
  assert.deepEqual(resolveSttConfig(settings, { PI_DISH_STT_API_KEY: 'env-key' }), {
    url: 'https://file.example/t', apiKey: 'env-key', model: 'file-model', language: 'de',
  });

  // An env URL alone is enough to configure a host with no settings block.
  assert.deepEqual(resolveSttConfig({}, { PI_DISH_STT_URL: 'https://env.example/t' }), {
    url: 'https://env.example/t', apiKey: null, model: 'whisper-1', language: null,
  });
});

test('sttFilename maps the containers browsers actually record', () => {
  assert.equal(sttFilename('audio/webm;codecs=opus'), 'audio.webm');
  assert.equal(sttFilename('audio/webm'), 'audio.webm');
  assert.equal(sttFilename('VIDEO/WEBM'), 'audio.webm');       // Chrome labels opus takes this way
  assert.equal(sttFilename('audio/mp4'), 'audio.mp4');         // iOS Safari
  assert.equal(sttFilename('audio/x-m4a'), 'audio.m4a');
  assert.equal(sttFilename('audio/m4a'), 'audio.m4a');
  assert.equal(sttFilename('audio/aac'), 'audio.aac');
  assert.equal(sttFilename('audio/ogg; codecs=opus'), 'audio.ogg');
  assert.equal(sttFilename('audio/wav'), 'audio.wav');
  assert.equal(sttFilename('audio/x-wav'), 'audio.wav');
  assert.equal(sttFilename('audio/wave'), 'audio.wav');
  assert.equal(sttFilename('audio/mpeg'), 'audio.mp3');
  assert.equal(sttFilename('audio/flac'), 'audio.flac');
  assert.equal(sttFilename('audio/x-flac'), 'audio.flac');

  for (const bad of ['', null, undefined, 'text/plain', 'application/json', 'audio/amr', 'image/png']) {
    assert.equal(sttFilename(bad), null, String(bad));
  }
});

test('upstreamErrorMessage digs the message out of the common envelopes', () => {
  assert.equal(upstreamErrorMessage(401, JSON.stringify({ error: { message: 'bad key' } })), 'bad key');
  assert.equal(upstreamErrorMessage(400, JSON.stringify({ error: 'model not found' })), 'model not found');
  assert.equal(upstreamErrorMessage(500, JSON.stringify({ message: 'boom' })), 'boom');
  assert.equal(upstreamErrorMessage(502, 'plain gateway text'), 'plain gateway text');
  assert.equal(upstreamErrorMessage(500, '   '), '');
  assert.equal(upstreamErrorMessage(500, ''), '');
  assert.equal(upstreamErrorMessage(500, undefined), '');
  assert.equal(upstreamErrorMessage(500, JSON.stringify({ unrelated: 1 })), '{"unrelated":1}');
  // Control characters would corrupt the line this is rendered into.
  assert.equal(upstreamErrorMessage(500, 'one\u0000two\nthree'), 'one two three');
  assert.equal(upstreamErrorMessage(500, 'x'.repeat(400)).length, 300);
});

const AUDIO = Buffer.alloc(4096, 7);

function stubFetch(handler) {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  impl.calls = calls;
  return impl;
}

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

test('transcribe builds the OpenAI-shaped multipart request', async () => {
  const fetchImpl = stubFetch(() => jsonResponse(200, { text: '  hello world  ' }));
  const out = await transcribe(
    { url: 'https://api.example/v1/audio/transcriptions', apiKey: 'sk-secret', model: 'whisper-large-v3-turbo', language: 'en' },
    { bytes: AUDIO, contentType: 'audio/webm;codecs=opus', fetchImpl },
  );
  assert.deepEqual(out, { text: 'hello world' });

  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.example/v1/audio/transcriptions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer sk-secret');
  const file = init.body.get('file');
  assert.equal(file.name, 'audio.webm');
  assert.equal(file.type, 'audio/webm');   // the ;codecs= parameter is stripped
  assert.equal(file.size, AUDIO.length);
  assert.equal(init.body.get('model'), 'whisper-large-v3-turbo');
  assert.equal(init.body.get('response_format'), 'json');
  assert.equal(init.body.get('language'), 'en');
});

test('transcribe omits the bearer and the language when unset', async () => {
  const fetchImpl = stubFetch(() => jsonResponse(200, { text: 'ok' }));
  await transcribe({ url: 'http://box.local/inference', apiKey: null, model: 'whisper-1', language: null },
    { bytes: AUDIO, contentType: 'audio/wav', fetchImpl });
  const { init } = fetchImpl.calls[0];
  assert.equal('Authorization' in init.headers, false);
  assert.equal(init.body.get('language'), null);
  assert.equal(init.body.get('file').name, 'audio.wav');
});

test('transcribe rejects an unsupported audio type before dialling out', async () => {
  const fetchImpl = stubFetch(() => jsonResponse(200, { text: 'never' }));
  await assert.rejects(
    transcribe({ url: 'https://api.example/t', model: 'whisper-1' }, { bytes: AUDIO, contentType: 'text/plain', fetchImpl }),
    (e) => e.status === 415 && /unsupported audio type text\/plain/.test(e.message));
  assert.equal(fetchImpl.calls.length, 0);
});

test('transcribe maps an upstream failure to a 502 naming the status and reason', async () => {
  const fetchImpl = stubFetch(() => jsonResponse(401, { error: { message: 'bad key' } }));
  await assert.rejects(
    transcribe({ url: 'https://api.example/t', apiKey: 'k', model: 'whisper-1' }, { bytes: AUDIO, contentType: 'audio/webm', fetchImpl }),
    (e) => e.status === 502 && e.message === 'Transcription endpoint answered 401: bad key');

  // No usable body: the status alone, without a dangling colon.
  const bare = stubFetch(() => new Response('', { status: 503 }));
  await assert.rejects(
    transcribe({ url: 'https://api.example/t', model: 'whisper-1' }, { bytes: AUDIO, contentType: 'audio/webm', fetchImpl: bare }),
    (e) => e.message === 'Transcription endpoint answered 503');
});

test('transcribe classifies transport failures instead of leaking the error', async () => {
  const cases = [
    [Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), 'refused'],
    [Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }), 'dns'],
    [Object.assign(new Error('fetch failed'), { cause: { message: 'unable to verify the first certificate' } }), 'tls'],
    [Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'timeout'],
    [new Error('something else entirely'), 'network'],
  ];
  for (const [err, reason] of cases) {
    const fetchImpl = stubFetch(() => { throw err; });
    await assert.rejects(
      transcribe({ url: 'https://api.example/secret-path?key=leak', model: 'whisper-1' },
        { bytes: AUDIO, contentType: 'audio/webm', fetchImpl }),
      (e) => e.status === 502 && e.message === `Transcription endpoint unreachable: ${reason}`, reason);
  }
});

test('transcribe requires a text field, and accepts a text/plain body as the transcript', async () => {
  for (const body of [{ }, { text: 42 }, { text: null }]) {
    const fetchImpl = stubFetch(() => jsonResponse(200, body));
    await assert.rejects(
      transcribe({ url: 'https://api.example/t', model: 'whisper-1' }, { bytes: AUDIO, contentType: 'audio/webm', fetchImpl }),
      (e) => e.status === 502 && /no text in response/.test(e.message), JSON.stringify(body));
  }

  const plain = stubFetch(() => new Response(' spoken words \n', { status: 200, headers: { 'content-type': 'text/plain' } }));
  assert.deepEqual(
    await transcribe({ url: 'https://api.example/t', model: 'whisper-1' }, { bytes: AUDIO, contentType: 'audio/webm', fetchImpl: plain }),
    { text: 'spoken words' });
});
