// Generated tool from test/stt.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for lib/stt.js — the "bring your own endpoint" speech-to-text
 * relay. `transcribe` takes its fetch, so the multipart parts, the bearer
 * header and every error mapping are asserted without a network.
 */
const test = require("node:test");
const assert = require("node:assert");
const stt_js_1 = require("../lib/stt.js");
const NO_ENV = {};
test('resolveSttConfig reads the settings block and defaults the model', () => {
    assert.equal((0, stt_js_1.resolveSttConfig)({}, NO_ENV), null);
    assert.equal((0, stt_js_1.resolveSttConfig)({ stt: {} }, NO_ENV), null);
    assert.equal((0, stt_js_1.resolveSttConfig)(null, NO_ENV), null);
    assert.deepEqual((0, stt_js_1.resolveSttConfig)({ stt: { url: 'https://api.example/v1/audio/transcriptions' } }, NO_ENV), {
        url: 'https://api.example/v1/audio/transcriptions',
        apiKey: null,
        model: 'whisper-1',
        language: null,
    });
    assert.deepEqual((0, stt_js_1.resolveSttConfig)({
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
        assert.equal((0, stt_js_1.resolveSttConfig)({ stt: { url } }, NO_ENV), null, url);
    }
    // Language must look like a BCP-47 code; anything else is dropped rather
    // than forwarded (an upstream 400 for a typo is a worse failure mode).
    for (const language of ['english', 'e', 'en_US', 'en-', '1234']) {
        const config = (0, stt_js_1.resolveSttConfig)({ stt: { url: 'https://api.example/t', language } }, NO_ENV);
        assert.ok(config);
        assert.equal(config.language, null, language);
    }
    for (const language of ['en', 'fr', 'yue', 'pt-BR', 'zh-Hans']) {
        const config = (0, stt_js_1.resolveSttConfig)({ stt: { url: 'https://api.example/t', language } }, NO_ENV);
        assert.ok(config);
        assert.equal(config.language, language);
    }
    const settings = { stt: { url: 'https://file.example/t', apiKey: 'file-key', model: 'file-model', language: 'de' } };
    assert.deepEqual((0, stt_js_1.resolveSttConfig)(settings, {
        PI_DISH_STT_URL: 'https://env.example/t',
        PI_DISH_STT_API_KEY: 'env-key',
        PI_DISH_STT_MODEL: 'env-model',
        PI_DISH_STT_LANGUAGE: 'fr',
    }), { url: 'https://env.example/t', apiKey: 'env-key', model: 'env-model', language: 'fr' });
    // Per field: only the key comes from the environment here.
    assert.deepEqual((0, stt_js_1.resolveSttConfig)(settings, { PI_DISH_STT_API_KEY: 'env-key' }), {
        url: 'https://file.example/t', apiKey: 'env-key', model: 'file-model', language: 'de',
    });
    // An env URL alone is enough to configure a host with no settings block.
    assert.deepEqual((0, stt_js_1.resolveSttConfig)({}, { PI_DISH_STT_URL: 'https://env.example/t' }), {
        url: 'https://env.example/t', apiKey: null, model: 'whisper-1', language: null,
    });
});
test('sttFilename maps the containers browsers actually record', () => {
    assert.equal((0, stt_js_1.sttFilename)('audio/webm;codecs=opus'), 'audio.webm');
    assert.equal((0, stt_js_1.sttFilename)('audio/webm'), 'audio.webm');
    assert.equal((0, stt_js_1.sttFilename)('VIDEO/WEBM'), 'audio.webm'); // Chrome labels opus takes this way
    assert.equal((0, stt_js_1.sttFilename)('audio/mp4'), 'audio.mp4'); // iOS Safari
    assert.equal((0, stt_js_1.sttFilename)('audio/x-m4a'), 'audio.m4a');
    assert.equal((0, stt_js_1.sttFilename)('audio/m4a'), 'audio.m4a');
    assert.equal((0, stt_js_1.sttFilename)('audio/aac'), 'audio.aac');
    assert.equal((0, stt_js_1.sttFilename)('audio/ogg; codecs=opus'), 'audio.ogg');
    assert.equal((0, stt_js_1.sttFilename)('audio/wav'), 'audio.wav');
    assert.equal((0, stt_js_1.sttFilename)('audio/x-wav'), 'audio.wav');
    assert.equal((0, stt_js_1.sttFilename)('audio/wave'), 'audio.wav');
    assert.equal((0, stt_js_1.sttFilename)('audio/mpeg'), 'audio.mp3');
    assert.equal((0, stt_js_1.sttFilename)('audio/flac'), 'audio.flac');
    assert.equal((0, stt_js_1.sttFilename)('audio/x-flac'), 'audio.flac');
    for (const bad of ['', null, undefined, 'text/plain', 'application/json', 'audio/amr', 'image/png']) {
        assert.equal((0, stt_js_1.sttFilename)(bad), null, String(bad));
    }
});
test('upstreamErrorMessage digs the message out of the common envelopes', () => {
    assert.equal((0, stt_js_1.upstreamErrorMessage)(401, JSON.stringify({ error: { message: 'bad key' } })), 'bad key');
    assert.equal((0, stt_js_1.upstreamErrorMessage)(400, JSON.stringify({ error: 'model not found' })), 'model not found');
    assert.equal((0, stt_js_1.upstreamErrorMessage)(500, JSON.stringify({ message: 'boom' })), 'boom');
    assert.equal((0, stt_js_1.upstreamErrorMessage)(502, 'plain gateway text'), 'plain gateway text');
    assert.equal((0, stt_js_1.upstreamErrorMessage)(500, '   '), '');
    assert.equal((0, stt_js_1.upstreamErrorMessage)(500, ''), '');
    assert.equal((0, stt_js_1.upstreamErrorMessage)(500, undefined), '');
    assert.equal((0, stt_js_1.upstreamErrorMessage)(500, JSON.stringify({ unrelated: 1 })), '{"unrelated":1}');
    // Control characters would corrupt the line this is rendered into.
    assert.equal((0, stt_js_1.upstreamErrorMessage)(500, 'one\u0000two\nthree'), 'one two three');
    assert.equal((0, stt_js_1.upstreamErrorMessage)(500, 'x'.repeat(400)).length, 300);
});
const AUDIO = Buffer.alloc(4096, 7);
function stubFetch(handler) {
    const calls = [];
    const impl = async (url, init) => {
        calls.push({ url, init });
        return handler(url, init);
    };
    impl.calls = calls;
    return impl;
}
const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
});
test('transcribe builds the OpenAI-shaped multipart request', async () => {
    const fetchImpl = stubFetch(async () => jsonResponse(200, { text: '  hello world  ' }));
    const out = await (0, stt_js_1.transcribe)({ url: 'https://api.example/v1/audio/transcriptions', apiKey: 'sk-secret', model: 'whisper-large-v3-turbo', language: 'en' }, { bytes: AUDIO, contentType: 'audio/webm;codecs=opus', fetchImpl });
    assert.deepEqual(out, { text: 'hello world' });
    const { url, init } = fetchImpl.calls[0];
    assert.equal(url, 'https://api.example/v1/audio/transcriptions');
    assert.ok(init);
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer sk-secret');
    assert.ok(init.body instanceof FormData);
    const file = init.body.get('file');
    assert.ok(file !== null && typeof file !== 'string');
    assert.equal(file.name, 'audio.webm');
    assert.equal(file.type, 'audio/webm'); // the ;codecs= parameter is stripped
    assert.equal(file.size, AUDIO.length);
    assert.equal(init.body.get('model'), 'whisper-large-v3-turbo');
    assert.equal(init.body.get('response_format'), 'json');
    assert.equal(init.body.get('language'), 'en');
});
test('transcribe omits the bearer and the language when unset', async () => {
    const fetchImpl = stubFetch(async () => jsonResponse(200, { text: 'ok' }));
    await (0, stt_js_1.transcribe)({ url: 'http://box.local/inference', apiKey: null, model: 'whisper-1', language: null }, { bytes: AUDIO, contentType: 'audio/wav', fetchImpl });
    const { init } = fetchImpl.calls[0];
    assert.ok(init);
    assert.equal(new Headers(init.headers).has('authorization'), false);
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('language'), null);
    const file = init.body.get('file');
    assert.ok(file !== null && typeof file !== 'string');
    assert.equal(file.name, 'audio.wav');
});
test('transcribe rejects an unsupported audio type before dialling out', async () => {
    const fetchImpl = stubFetch(async () => jsonResponse(200, { text: 'never' }));
    await assert.rejects((0, stt_js_1.transcribe)({ url: 'https://api.example/t', apiKey: null, model: 'whisper-1', language: null }, { bytes: AUDIO, contentType: 'text/plain', fetchImpl }), (error) => {
        assert.ok(error instanceof Error && 'status' in error);
        assert.equal(error.status, 415);
        assert.match(error.message, /text\/plain/);
        return true;
    });
    assert.equal(fetchImpl.calls.length, 0);
});
test('transcribe preserves upstream status and reason in a 502 failure', async () => {
    const fetchImpl = stubFetch(async () => jsonResponse(401, { error: { message: 'bad key' } }));
    await assert.rejects((0, stt_js_1.transcribe)({ url: 'https://api.example/t', apiKey: 'k', model: 'whisper-1', language: null }, { bytes: AUDIO, contentType: 'audio/webm', fetchImpl }), (error) => {
        assert.ok(error instanceof Error && 'status' in error);
        assert.equal(error.status, 502);
        assert.match(error.message, /\b401\b/);
        assert.ok(error.message.includes('bad key'));
        return true;
    });
    // No upstream body still preserves the upstream status.
    const bare = stubFetch(async () => new Response('', { status: 503 }));
    await assert.rejects((0, stt_js_1.transcribe)({ url: 'https://api.example/t', apiKey: null, model: 'whisper-1', language: null }, { bytes: AUDIO, contentType: 'audio/webm', fetchImpl: bare }), (error) => {
        assert.ok(error instanceof Error && 'status' in error);
        assert.equal(error.status, 502);
        assert.match(error.message, /\b503\b/);
        return true;
    });
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
        const fetchImpl = stubFetch(async () => { throw err; });
        await assert.rejects((0, stt_js_1.transcribe)({ url: 'https://api.example/secret-path?key=leak', apiKey: null, model: 'whisper-1', language: null }, { bytes: AUDIO, contentType: 'audio/webm', fetchImpl }), (error) => {
            assert.ok(error instanceof Error && 'status' in error);
            assert.equal(error.status, 502);
            assert.match(error.message, new RegExp(`\\b${reason}\\b`));
            assert.doesNotMatch(error.message, /api\.example|secret-path|key=leak/);
            assert.ok(!error.message.includes(err.message));
            if (err.cause && typeof err.cause === 'object') {
                for (const value of Object.values(err.cause)) {
                    if (typeof value === 'string')
                        assert.ok(!error.message.includes(value));
                }
            }
            return true;
        }, reason);
    }
});
test('transcribe requires a text field, and accepts a text/plain body as the transcript', async () => {
    for (const body of [{}, { text: 42 }, { text: null }]) {
        const fetchImpl = stubFetch(async () => jsonResponse(200, body));
        await assert.rejects((0, stt_js_1.transcribe)({ url: 'https://api.example/t', apiKey: null, model: 'whisper-1', language: null }, { bytes: AUDIO, contentType: 'audio/webm', fetchImpl }), (error) => {
            assert.ok(error instanceof Error && 'status' in error);
            assert.equal(error.status, 502);
            return true;
        }, JSON.stringify(body));
    }
    const plain = stubFetch(async () => new Response(' spoken words \n', { status: 200, headers: { 'content-type': 'text/plain' } }));
    assert.deepEqual(await (0, stt_js_1.transcribe)({ url: 'https://api.example/t', apiKey: null, model: 'whisper-1', language: null }, { bytes: AUDIO, contentType: 'audio/webm', fetchImpl: plain }), { text: 'spoken words' });
});
