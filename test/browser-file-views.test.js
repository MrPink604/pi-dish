// Generated test/tool from test/browser-file-views.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeFilePreview, decodeDiffView, renderDiffViewHtml, renderVideoPlayerHtml, MODEL_LARGE_FILE_BYTES, MODEL_MAX_DECODED_BYTES, MODEL_VIEWS, resolveModelResourcePath, modelContentApiPath, shouldGateModelLoad, shouldGateDecodedKtx2, extractGltfExternalUris, parseKtx2DecodedBytes, parseResponseByteLength, formatModelBounds, formatModelStats, modelSnapshotFilename, parseCssColorToHex, } = (0, browser_vm_js_1.loadBrowser)();
test('file and diff wire decoding rejects missing file paths and narrows nested fields', () => {
    assert.throws(() => decodeFilePreview({ content: 'text' }), /Invalid file preview/);
    const file = decodeFilePreview({
        path: '/tmp/a', content: {}, size: Infinity,
        image: { url: '/image', data: {} },
        video: { url: '/video', mimeType: 'video/mp4' },
        model: { url: '/model', mimeType: 'model/gltf-binary' },
    });
    assert.equal(file.content, '');
    assert.equal(file.size, 0);
    assert.ok(file.image);
    assert.equal(file.image.data, '');
    assert.ok(file.video);
    assert.equal(file.video.url, '/video');
    assert.equal(file.video.mimeType, 'video/mp4');
    assert.ok(file.model);
    assert.equal(file.model.url, '/model');
    assert.equal(file.model.mimeType, 'model/gltf-binary');
    const wire = { root: '/tmp', gitAvailable: true, repos: [null, { path: 'repo', files: [null, { path: 'a', patch: {}, additions: '3' }] }] };
    const diff = decodeDiffView(wire);
    const repo = diff.repos[0];
    assert.ok(repo);
    const changed = repo.files[0];
    assert.ok(changed);
    assert.equal(diff.repos.length, 1);
    assert.equal(repo.files.length, 1);
    assert.equal(changed.patch, '');
    assert.equal(changed.additions, 0);
    const wireRepo = wire.repos[1];
    assert.ok(wireRepo);
    const wireFile = wireRepo.files[1];
    assert.ok(wireFile);
    assert.equal(wireFile.additions, '3');
});
test('video player markup uses preload=metadata, never autoplays, and escapes untrusted metadata', () => {
    const html = renderVideoPlayerHtml({
        src: '/api/sessions/s1/file/content?path=clip.mp4',
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        variant: 'inline',
        filePath: 'dir/a<b>"clip.mp4',
    });
    assert.match(html, /<video[^>]+controls[^>]+playsinline[^>]+preload="metadata"/);
    assert.doesNotMatch(html, /\bautoplay\b/i);
    assert.match(html, /<details class="video-disclosure" open><summary class="video-summary">/);
    assert.match(html, /<span class="video-filename" title="a&lt;b&gt;&quot;clip\.mp4">a&lt;b&gt;&quot;clip\.mp4<\/span>/);
    assert.equal(html.includes('<b>'), false);
    assert.match(html, /video-step-back/);
    assert.match(html, /video-step-fwd/);
    assert.match(html, /video-speed/);
    assert.match(html, /video-fallback/);
    assert.match(html, /data-file-path="dir\/a&lt;b&gt;&quot;clip\.mp4"/);
    const unsafe = renderVideoPlayerHtml({ src: 'javascript:alert(1)', variant: 'viewer' });
    assert.match(unsafe, /src="#"/);
});
test('diff render escapes repository and file attributes while preserving deferred snapshot identity', () => {
    const html = renderDiffViewHtml(decodeDiffView({ gitAvailable: true, snapshotId: '"snapshot', repos: [{ path: '"><img>', branch: '<script>', files: [{ path: 'a"b', patchDeferred: true, status: '<M>' }] }] }));
    assert.equal(html.includes('<img>'), false);
    assert.equal(html.includes('<script>'), false);
    assert.match(html, /data-path="a&quot;b"/);
    assert.match(html, /data-snapshot="&quot;snapshot"/);
    assert.match(html, /data-deferred="1"/);
});
test('model resource path resolution resolves relative textures and blocks external/file URIs', () => {
    const glb = '/home/user/OSBG/assets/weapons/meshes/auto_rifle_adaptive.glb';
    const ktx = resolveModelResourcePath(glb, '../../textures/material/kit_auto_rifle_relic_base.ktx2');
    assert.deepEqual({ ...ktx }, { kind: 'local', absPath: '/home/user/OSBG/assets/textures/material/kit_auto_rifle_relic_base.ktx2' });
    const encoded = resolveModelResourcePath(glb, './sub%20dir/../albedo.png?v=1#hash');
    assert.deepEqual({ ...encoded }, { kind: 'local', absPath: '/home/user/OSBG/assets/weapons/meshes/albedo.png' });
    const bin = resolveModelResourcePath(glb, 'mesh.bin');
    assert.deepEqual({ ...bin }, { kind: 'local', absPath: '/home/user/OSBG/assets/weapons/meshes/mesh.bin' });
    const dataUri = resolveModelResourcePath(glb, 'data:image/png;base64,iVBORw0KGgo=');
    assert.deepEqual({ ...dataUri }, { kind: 'inline', uri: 'data:image/png;base64,iVBORw0KGgo=' });
    const blobUri = resolveModelResourcePath(glb, 'blob:https://dish.example/abc-123');
    assert.deepEqual({ ...blobUri }, { kind: 'inline', uri: 'blob:https://dish.example/abc-123' });
    for (const blocked of [
        '',
        '   ',
        'https://evil.example/tex.png',
        'HTTP://evil.example/tex.ktx2',
        'file:///etc/passwd',
        '//cdn.example/tex.png',
        'javascript:alert(1)',
        'bad%ZZname.ktx2',
        'win\\path.ktx2',
        'nul\0byte.ktx2',
    ]) {
        assert.equal(resolveModelResourcePath(glb, blocked).kind, 'blocked', `expected blocked: ${JSON.stringify(blocked)}`);
    }
    assert.equal(resolveModelResourcePath('relative/model.glb', 'tex.ktx2').kind, 'blocked');
    assert.equal(modelContentApiPath('s/1', '/home/user/OSBG/assets/textures/a b.ktx2'), '/api/sessions/s%2F1/file/content?path=%2Fhome%2Fuser%2FOSBG%2Fassets%2Ftextures%2Fa%20b.ktx2');
    assert.equal(modelContentApiPath('s1', '/a/b.glb', '12-34'), '/api/sessions/s1/file/content?path=%2Fa%2Fb.glb&v=12-34');
});
test('model viewer size gate, camera presets, stats and snapshot filename formatting', () => {
    assert.equal(shouldGateModelLoad(MODEL_LARGE_FILE_BYTES), false);
    assert.equal(shouldGateModelLoad(MODEL_LARGE_FILE_BYTES + 1), true);
    assert.deepEqual(Array.from(MODEL_VIEWS, v => v.id), ['q34', 'left', 'right', 'top', 'rear']);
    assert.equal(MODEL_VIEWS.find(v => v.id === 'left')?.ortho, true);
    assert.equal(MODEL_VIEWS.find(v => v.id === 'top')?.ortho, true);
    assert.equal(MODEL_VIEWS.find(v => v.id === 'q34')?.ortho, false);
    assert.equal(formatModelBounds([0.074, 0.215, 0.682]), '74×215×682 mm');
    assert.equal(formatModelBounds([42.34, 12.1, 88.95]), '42.3×12.1×89.0 m');
    assert.equal(formatModelBounds(null), '');
    assert.equal(formatModelStats({ triangles: 7248, vertices: 4100, meshes: 12, materials: 3, sizeBytes: 448560, dimensions: [0.074, 0.215, 0.682], animationCount: 1 }), '7,248 tris · 12 meshes · 3 mats · 74×215×682 mm · 438 KB');
    assert.equal(formatModelStats({ triangles: 0, vertices: 0, meshes: 0, materials: 0, sizeBytes: 1500000, dimensions: null, animationCount: 2 }), '0 tris · 0 meshes · 0 mats · 1.4 MB');
    assert.equal(modelSnapshotFilename('/a/b/auto_rifle_adaptive.glb', 'left'), 'auto_rifle_adaptive_left.png');
    assert.equal(modelSnapshotFilename('/a/b/my model (v2).gltf', 'q34'), 'my_model_v2_q34.png');
    assert.equal(parseCssColorToHex('#073642'), '#073642');
    assert.equal(parseCssColorToHex('rgb(30, 35, 41)'), '#1e2329');
    assert.equal(parseCssColorToHex('color(srgb 0.190588 0.215686 0.242353)'), '#31373e');
    assert.equal(parseCssColorToHex('transparent'), null);
});
test('model companion URI extraction, KTX2 decoded-byte header parsing, and response length parsing', () => {
    assert.equal(shouldGateDecodedKtx2(MODEL_MAX_DECODED_BYTES), false);
    assert.equal(shouldGateDecodedKtx2(MODEL_MAX_DECODED_BYTES + 1), true);
    // Plain .gltf JSON extraction + deduplication across images and buffers.
    const gltfBytes = new TextEncoder().encode(JSON.stringify({
        images: [{ uri: '../../textures/a.ktx2' }, { uri: '../../textures/a.ktx2' }, { uri: 'b.png' }],
        buffers: [{ uri: 'mesh.bin' }],
    }));
    const gltfBuf = gltfBytes.buffer.slice(gltfBytes.byteOffset, gltfBytes.byteOffset + gltfBytes.byteLength);
    assert.deepEqual(Array.from(extractGltfExternalUris(gltfBuf)), ['../../textures/a.ktx2', 'b.png', 'mesh.bin']);
    // GLB 2.0 binary container JSON chunk extraction.
    const rawJson = Buffer.from(JSON.stringify({ images: [{ uri: 'albedo.ktx2' }] }), 'utf8');
    const padLen = (4 - (rawJson.length % 4)) % 4;
    const jsonChunk = Buffer.concat([rawJson, Buffer.alloc(padLen, 0x20)]);
    const glb = Buffer.alloc(12 + 8 + jsonChunk.length);
    glb.write('glTF', 0, 'ascii');
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(jsonChunk.length, 12);
    glb.write('JSON', 16, 'ascii');
    jsonChunk.copy(glb, 20);
    const glbAb = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
    assert.deepEqual(Array.from(extractGltfExternalUris(glbAb)), ['albedo.ktx2']);
    assert.deepEqual(Array.from(extractGltfExternalUris(new ArrayBuffer(4))), []);
    // KTX2 header level index uncompressedByteLength sum (3 mip levels: 16M + 4M + 1M).
    const ktx = Buffer.alloc(80 + 3 * 24);
    Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(ktx, 0);
    ktx.writeUInt32LE(2048, 20);
    ktx.writeUInt32LE(2048, 24);
    ktx.writeUInt32LE(1, 36);
    ktx.writeUInt32LE(3, 40);
    ktx.writeBigUInt64LE(16777216n, 80 + 16);
    ktx.writeBigUInt64LE(4194304n, 80 + 24 + 16);
    ktx.writeBigUInt64LE(1048576n, 80 + 48 + 16);
    const ktxAb = ktx.buffer.slice(ktx.byteOffset, ktx.byteOffset + ktx.byteLength);
    assert.equal(parseKtx2DecodedBytes(ktxAb), 16_777_216 + 4_194_304 + 1_048_576);
    assert.equal(parseKtx2DecodedBytes(new ArrayBuffer(128)), null);
    // Content-Range total wins over Content-Length; missing/malformed returns null.
    const headersOf = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });
    assert.equal(parseResponseByteLength(headersOf({ 'content-length': '12345' })), 12345);
    assert.equal(parseResponseByteLength(headersOf({ 'content-range': 'bytes 0-15/987654', 'content-length': '16' })), 987654);
    assert.equal(parseResponseByteLength(headersOf({})), null);
    assert.equal(parseResponseByteLength(headersOf({ 'content-length': 'NaN' })), null);
});
