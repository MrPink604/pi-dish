import type { Route } from '@playwright/test';
import { zstdCompressSync } from 'node:zlib';
import { test, expect, ROOT } from './fixtures.js';

/**
 * Build a minimal spec-compliant 4×4 RGBA8 + zstd KTX2 texture (VK_FORMAT_R8G8B8A8_SRGB,
 * KHR_SUPERCOMPRESSION_ZSTD, 3 mip levels: 4×4, 2×2, 1×1) matching OSBG's material textures.
 */
function buildZstdRgba8Ktx2(rgba: readonly [number, number, number, number]): Buffer {
  const levels = [4, 2, 1].map(dim => {
    const raw = Buffer.alloc(dim * dim * 4);
    for (let i = 0; i < dim * dim; i++) {
      raw[i * 4] = rgba[0];
      raw[i * 4 + 1] = rgba[1];
      raw[i * 4 + 2] = rgba[2];
      raw[i * 4 + 3] = rgba[3];
    }
    const compressed = zstdCompressSync(raw);
    return { rawLen: raw.length, compressed };
  });

  // Standard 92-byte KTX2 Data Format Descriptor for VK_FORMAT_R8G8B8A8_SRGB (BT709 + sRGB).
  const dfd = Buffer.from(
    '5c00000000000000020058000101020000000000040000000000000000000700'
    + '0000000000000000ff000000080007010000000000000000ff00000010000702'
    + '0000000000000000ff0000001800071f0000000000000000ff000000',
    'hex',
  );
  const headerSize = 80;
  const levelIndexSize = levels.length * 24;
  const dfdOffset = headerSize + levelIndexSize;
  let dataOffset = dfdOffset + dfd.length;
  // Store smallest mip first (KTX2 §3.6), while level index 0..N-1 runs largest to smallest.
  const storedOrder = [...levels].reverse();
  const offsets = new Map<typeof levels[number], number>();
  for (const level of storedOrder) {
    offsets.set(level, dataOffset);
    dataOffset += level.compressed.length;
  }

  const out = Buffer.alloc(dataOffset);
  Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0);
  out.writeUInt32LE(43, 12); // VK_FORMAT_R8G8B8A8_SRGB
  out.writeUInt32LE(1, 16);  // typeSize
  out.writeUInt32LE(4, 20);  // pixelWidth
  out.writeUInt32LE(4, 24);  // pixelHeight
  out.writeUInt32LE(0, 28);  // pixelDepth
  out.writeUInt32LE(0, 32);  // layerCount
  out.writeUInt32LE(1, 36);  // faceCount
  out.writeUInt32LE(levels.length, 40); // levelCount
  out.writeUInt32LE(2, 44);  // KHR_SUPERCOMPRESSION_ZSTD
  out.writeUInt32LE(dfdOffset, 48);
  out.writeUInt32LE(dfd.length, 52);
  out.writeUInt32LE(0, 56);  // kvdByteOffset
  out.writeUInt32LE(0, 60);  // kvdByteLength
  out.writeBigUInt64LE(0n, 64); // sgdByteOffset
  out.writeBigUInt64LE(0n, 72); // sgdByteLength

  levels.forEach((level, idx) => {
    const base = headerSize + idx * 24;
    out.writeBigUInt64LE(BigInt(offsets.get(level) ?? 0), base);
    out.writeBigUInt64LE(BigInt(level.compressed.length), base + 8);
    out.writeBigUInt64LE(BigInt(level.rawLen), base + 16);
  });
  dfd.copy(out, dfdOffset);
  for (const level of storedOrder) {
    level.compressed.copy(out, offsets.get(level) ?? 0);
  }
  return out;
}

/**
 * Build a minimal valid GLB 2.0 containing a textured box (12 tris, 1 mesh, 1 mat)
 * referencing `textureUri` by plain image URI (matching OSBG weapon GLBs), or an
 * empty mesh-less GLB when `empty` is true.
 */
function buildFixtureGlb(options: { textureUri?: string; extraBlockedUri?: string; empty?: boolean }): Buffer {
  const pad4 = (buf: Buffer, byte: number) => {
    const rem = buf.length % 4;
    return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, byte)]);
  };

  if (options.empty) {
    const jsonChunk = pad4(Buffer.from(JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'root_only' }],
    }), 'utf8'), 0x20);
    const header = Buffer.alloc(12);
    header.write('glTF', 0, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonChunk.length, 8);
    const chunkHdr = Buffer.alloc(8);
    chunkHdr.writeUInt32LE(jsonChunk.length, 0);
    chunkHdr.write('JSON', 4, 'ascii');
    return Buffer.concat([header, chunkHdr, jsonChunk]);
  }

  // Unit-ish box (0.16 × 0.24 × 0.64 m — weapon proportions along -Z).
  const hx = 0.08, hy = 0.12, hz = 0.32;
  const positions = new Float32Array([
    // +Z, -Z, +X, -X, +Y, -Y (4 verts per face = 24 verts)
    -hx, -hy,  hz,   hx, -hy,  hz,   hx,  hy,  hz,  -hx,  hy,  hz,
     hx, -hy, -hz,  -hx, -hy, -hz,  -hx,  hy, -hz,   hx,  hy, -hz,
     hx, -hy,  hz,   hx, -hy, -hz,   hx,  hy, -hz,   hx,  hy,  hz,
    -hx, -hy, -hz,  -hx, -hy,  hz,  -hx,  hy,  hz,  -hx,  hy, -hz,
    -hx,  hy,  hz,   hx,  hy,  hz,   hx,  hy, -hz,  -hx,  hy, -hz,
    -hx, -hy, -hz,   hx, -hy, -hz,   hx, -hy,  hz,  -hx, -hy,  hz,
  ]);
  const normals = new Float32Array([
     0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,
     0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,
     1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,
    -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0,
     0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,
     0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);
  const indices = new Uint16Array([
     0,  1,  2,  0,  2,  3,
     4,  5,  6,  4,  6,  7,
     8,  9, 10,  8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
  ]);

  const posBuf = Buffer.from(positions.buffer);
  const normBuf = Buffer.from(normals.buffer);
  const uvBuf = Buffer.from(uvs.buffer);
  const idxBuf = Buffer.from(indices.buffer);
  const binChunk = pad4(Buffer.concat([posBuf, normBuf, uvBuf, idxBuf]), 0x00);

  const images: Array<{ uri: string }> = [];
  const textures: Array<{ source: number }> = [];
  const pbr: Record<string, unknown> = { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.2, roughnessFactor: 0.5 };
  const material: Record<string, unknown> = { name: 'fixture_mat', pbrMetallicRoughness: pbr };
  if (options.textureUri) {
    images.push({ uri: options.textureUri });
    textures.push({ source: 0 });
    pbr.baseColorTexture = { index: 0 };
  }
  if (options.extraBlockedUri) {
    const imgIdx = images.length;
    images.push({ uri: options.extraBlockedUri });
    textures.push({ source: imgIdx });
    material.emissiveFactor = [1, 1, 1];
    material.emissiveTexture = { index: textures.length - 1 };
  }

  const gltf: Record<string, unknown> = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'fixture_body', mesh: 0 }],
    meshes: [{
      name: 'fixture_box',
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }],
    }],
    materials: [material],
    ...(images.length ? { images, textures } : {}),
    buffers: [{ byteLength: binChunk.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length, byteLength: normBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length + normBuf.length, byteLength: uvBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length + normBuf.length + uvBuf.length, byteLength: idxBuf.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-hx, -hy, -hz], max: [hx, hy, hz] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 24, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };

  const jsonChunk = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHdr = Buffer.alloc(8);
  jsonHdr.writeUInt32LE(jsonChunk.length, 0);
  jsonHdr.write('JSON', 4, 'ascii');
  const binHdr = Buffer.alloc(8);
  binHdr.writeUInt32LE(binChunk.length, 0);
  binHdr.write('BIN\0', 4, 'ascii');
  return Buffer.concat([header, jsonHdr, jsonChunk, binHdr, binChunk]);
}

const FIXTURE_KTX2 = buildZstdRgba8Ktx2([240, 96, 32, 255]);
const FIXTURE_GLB = buildFixtureGlb({ textureUri: '../../textures/material/fixture_base.ktx2' });
const BLOCKED_URI_GLB = buildFixtureGlb({
  textureUri: '../../textures/material/fixture_base.ktx2',
  extraBlockedUri: 'https://blocked.invalid/leak.png',
});
const EMPTY_GLB = buildFixtureGlb({ empty: true });

test('GLB viewer lazy-loads versioned vendor bundle, decodes external zstd KTX2 over bearer-authed peer, renders at 390×844 with views, themes and clean disposal', async ({ page, fleet }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const vendorRequests: string[] = [];
  const authedContentRequests: Array<{ path: string; auth: string | undefined }> = [];
  const blockedNetworkRequests: string[] = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('vendor/three-gltf.js')) vendorRequests.push(url);
    if (url.includes('blocked.invalid')) blockedNetworkRequests.push(url);
  });

  // Select peer host (cross-origin + bearer token required) — vendor bundle must NOT load yet.
  await fleet.select(fleet.peer);
  expect(vendorRequests).toHaveLength(0);

  const modelAbsPath = '/fixture/assets/weapons/meshes/fixture_box.glb';
  const ktxAbsPath = '/fixture/assets/textures/material/fixture_base.ktx2';

  await page.route('**/api/sessions/*/file?*', (route: Route) => {
    const reqPath = new URL(route.request().url()).searchParams.get('path') ?? '';
    if (reqPath === 'fixture_box.glb') {
      return route.fulfill({
        json: {
          path: modelAbsPath,
          relPath: 'assets/weapons/meshes/fixture_box.glb',
          size: FIXTURE_GLB.length,
          mtime: 100,
          model: { url: `/api/sessions/${ROOT}/file/content?path=fixture_box.glb&v=100-${FIXTURE_GLB.length}`, mimeType: 'model/gltf-binary' },
        },
      });
    }
    if (reqPath === 'blocked_uri.glb') {
      return route.fulfill({
        json: {
          path: '/fixture/assets/weapons/meshes/blocked_uri.glb',
          relPath: 'assets/weapons/meshes/blocked_uri.glb',
          size: BLOCKED_URI_GLB.length,
          mtime: 101,
          model: { url: `/api/sessions/${ROOT}/file/content?path=blocked_uri.glb&v=101-${BLOCKED_URI_GLB.length}`, mimeType: 'model/gltf-binary' },
        },
      });
    }
    if (reqPath === 'empty_clip.glb') {
      return route.fulfill({
        json: {
          path: '/fixture/assets/weapons/fp_clips/empty_clip.glb',
          relPath: 'assets/weapons/fp_clips/empty_clip.glb',
          size: EMPTY_GLB.length,
          mtime: 102,
          model: { url: `/api/sessions/${ROOT}/file/content?path=empty_clip.glb&v=102-${EMPTY_GLB.length}`, mimeType: 'model/gltf-binary' },
        },
      });
    }
    if (reqPath === 'huge_env.glb') {
      return route.fulfill({
        json: {
          path: '/fixture/assets/environments/huge_env.glb',
          relPath: 'assets/environments/huge_env.glb',
          size: 26 * 1024 * 1024,
          mtime: 103,
          model: { url: `/api/sessions/${ROOT}/file/content?path=huge_env.glb&v=103-27262976`, mimeType: 'model/gltf-binary' },
        },
      });
    }
    return route.continue();
  });

  await page.route('**/api/sessions/*/file/content?*', (route: Route) => {
    const url = new URL(route.request().url());
    const reqPath = url.searchParams.get('path') ?? '';
    const auth = route.request().headers().authorization;
    const corsHeaders = {
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': fleet.self.base,
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    };
    authedContentRequests.push({ path: reqPath, auth });
    if (reqPath === modelAbsPath || reqPath.endsWith('huge_env.glb')) {
      return route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'model/gltf-binary' },
        body: FIXTURE_GLB,
      });
    }
    if (reqPath.endsWith('blocked_uri.glb')) {
      return route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'model/gltf-binary' },
        body: BLOCKED_URI_GLB,
      });
    }
    if (reqPath.endsWith('empty_clip.glb')) {
      return route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'model/gltf-binary' },
        body: EMPTY_GLB,
      });
    }
    if (reqPath === ktxAbsPath) {
      return route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'image/ktx2' },
        body: FIXTURE_KTX2,
      });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  // 1. Large files (>25 MB) gate before loading the vendor bundle or model bytes.
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('huge_env.glb'));
  const gatedViewer = page.locator('#fileViewBody .model-viewer');
  await expect(gatedViewer).toHaveAttribute('data-model-state', 'gated');
  await expect(gatedViewer.locator('.model-load-btn')).toContainText('Load (26.0 MB)');
  expect(vendorRequests).toHaveLength(0);
  expect(authedContentRequests).toHaveLength(0);

  // 2. Open the fixture GLB with external RGBA8+zstd KTX2 texture on the peer host.
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('fixture_box.glb'));
  const viewer = page.locator('#fileViewBody .model-viewer');
  await expect(viewer).toHaveAttribute('data-model-state', 'ready', { timeout: 15000 });

  // Vendor script loaded lazily with a 16-hex content hash query string.
  expect(vendorRequests).toHaveLength(1);
  expect(vendorRequests[0]).toMatch(/\/vendor\/three-gltf\.js\?v=[0-9a-f]{16}$/);

  // Both the GLB and the resolved relative KTX2 texture carried the peer bearer token.
  expect(authedContentRequests.some(r => r.path === modelAbsPath && r.auth === `Bearer ${fleet.peer.token}`)).toBe(true);
  expect(authedContentRequests.some(r => r.path === ktxAbsPath && r.auth === `Bearer ${fleet.peer.token}`)).toBe(true);

  // Stats line shows tris, meshes, materials, bounds in mm, and size.
  const stats = viewer.locator('.model-stats-text');
  await expect(stats).toContainText('12 tris · 1 mesh · 1 mat · 160×240×640 mm');
  await expect(viewer.locator('.model-stats-warn')).toBeHidden();

  // Canvas has touch-action: none (toolbar does not) and zero horizontal overflow at 390×844.
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#fileViewBody .model-canvas');
    const toolbar = document.querySelector<HTMLElement>('#fileViewBody .model-toolbar');
    const rect = canvas?.getBoundingClientRect();
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      canvasTouchAction: canvas ? getComputedStyle(canvas).touchAction : '',
      toolbarTouchAction: toolbar ? getComputedStyle(toolbar).touchAction : '',
      canvasW: rect?.width ?? 0,
      canvasH: rect?.height ?? 0,
      copyHidden: (document.getElementById('fileViewCopy') as HTMLElement).style.display === 'none',
    };
  });
  expect(layout.docScrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  expect(layout.canvasTouchAction).toBe('none');
  expect(layout.toolbarTouchAction).not.toBe('none');
  expect(layout.canvasW).toBeGreaterThan(300);
  expect(layout.canvasH).toBeGreaterThan(200);
  expect(layout.copyHidden).toBe(true);

  // Verify the canvas actually rendered distinct colored pixels from the decoded KTX2 texture
  // (not a flat clear color) by sampling the rendered PNG via Snapshot's synchronous render path.
  const sampleStats = await page.evaluate(() => {
    // Click Q34 to force a fresh synchronous render right before reading the canvas.
    document.querySelector<HTMLButtonElement>('[data-model-view-btn="q34"]')?.click();
    const canvas = document.querySelector<HTMLCanvasElement>('#fileViewBody .model-canvas')!;
    const out = document.createElement('canvas');
    out.width = 64;
    out.height = 64;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    const bgR = data[0], bgG = data[1], bgB = data[2];
    let warmForeground = 0;
    for (let i = 0; i < data.length; i += 4) {
      const dr = Math.abs(data[i] - bgR);
      const dg = Math.abs(data[i + 1] - bgG);
      const db = Math.abs(data[i + 2] - bgB);
      if (dr + dg + db > 25 && data[i] > data[i + 2] + 15) warmForeground++;
    }
    return { warmForeground };
  });
  expect(sampleStats.warmForeground).toBeGreaterThan(30);

  // View chips move the camera and update active state.
  const q34Cam = await viewer.getAttribute('data-model-camera');
  await viewer.locator('[data-model-view-btn="left"]').click();
  await expect(viewer).toHaveAttribute('data-model-view', 'left');
  await expect(viewer.locator('[data-model-view-btn="left"]')).toHaveAttribute('aria-pressed', 'true');
  const leftCam = await viewer.getAttribute('data-model-camera');
  expect(leftCam).not.toBe(q34Cam);

  await viewer.locator('[data-model-view-btn="top"]').click();
  await expect(viewer).toHaveAttribute('data-model-view', 'top');
  const topCam = await viewer.getAttribute('data-model-camera');
  expect(topCam).not.toBe(leftCam);

  // Snapshot triggers a PNG download named after the model & view.
  const downloadPromise = page.waitForEvent('download');
  await viewer.locator('[data-model-action="snapshot"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('fixture_box_top.png');

  // Reset returns to Q34.
  await viewer.locator('[data-model-action="reset"]').click();
  await expect(viewer).toHaveAttribute('data-model-view', 'q34');

  // Switching theme from Solarized Dark to Graphite updates BOTH CSS stage and rendered WebGL canvas background.
  const sampleCornerRgb = () => page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-model-view-btn="q34"]')?.click();
    const canvas = document.querySelector<HTMLCanvasElement>('#fileViewBody .model-canvas')!;
    const out = document.createElement('canvas');
    out.width = 16; out.height = 16;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  const solarizedBg = await viewer.locator('.model-stage').evaluate(el => getComputedStyle(el).backgroundColor);
  const solarizedCanvasBg = await sampleCornerRgb();
  expect(solarizedCanvasBg[0] + solarizedCanvasBg[1] + solarizedCanvasBg[2]).toBeGreaterThan(20);
  await page.evaluate(() => fixtureApp.features.themesController.apply('graphite'));
  const graphiteBg = await viewer.locator('.model-stage').evaluate(el => getComputedStyle(el).backgroundColor);
  const graphiteCanvasBg = await sampleCornerRgb();
  expect(graphiteBg).not.toBe(solarizedBg);
  expect(graphiteCanvasBg).not.toEqual(solarizedCanvasBg);
  expect(graphiteCanvasBg[0] + graphiteCanvasBg[1] + graphiteCanvasBg[2]).toBeGreaterThan(20);
  await page.evaluate(() => fixtureApp.features.themesController.apply('solarized'));

  // 3. External http(s) URIs inside a GLB are refused without issuing any network fetch.
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('blocked_uri.glb'));
  await expect(viewer).toHaveAttribute('data-model-state', 'ready', { timeout: 15000 });
  expect(blockedNetworkRequests).toHaveLength(0);
  await expect(viewer.locator('.model-stats-warn')).toContainText('1 external URI blocked');

  // 4. Mesh-less GLB shows a clean empty-mesh message without crashing.
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('empty_clip.glb'));
  await expect(viewer).toHaveAttribute('data-model-state', 'empty', { timeout: 15000 });
  await expect(viewer.locator('.model-overlay')).toContainText('No renderable meshes');

  // 5. Closing the file panel disposes WebGL canvas and restores header copy button.
  await page.evaluate(() => fixtureApp.features.fileViews.closeFile());
  await expect(page.locator('#fileViewBody canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (document.getElementById('fileViewCopy') as HTMLElement).style.display)).toBe('');
});

test('GLB viewer refuses a version-skewed lazy vendor bundle and prompts reload', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route('**/vendor/three-gltf.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'globalThis.PiDishThreeGltf = Object.freeze({ apiVersion: 999, threeVersion: "9.9.9" });',
  }));
  await page.route('**/api/sessions/*/file?*', route => route.fulfill({
    json: {
      path: '/fixture/skew.glb',
      relPath: 'skew.glb',
      size: 64,
      mtime: 1,
      model: { url: `/api/sessions/${ROOT}/file/content?path=skew.glb&v=1-64`, mimeType: 'model/gltf-binary' },
    },
  }));
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('skew.glb'));
  const viewer = page.locator('#fileViewBody .model-viewer');
  await expect(viewer).toHaveAttribute('data-model-state', 'error');
  await expect(viewer.locator('.model-overlay')).toContainText('reload the page');
  await expect(viewer.locator('.model-reload-btn')).toBeVisible();
});

test('small root GLB with large external companions pauses for consent before buffering companions and aborts cleanly on decline', async ({ page, fleet }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fleet.select(fleet.self);

  const multiTexGlb = buildFixtureGlb({
    textureUri: '../../textures/material/big_base.ktx2',
    extraBlockedUri: '../../textures/material/big_emissive.ktx2',
  });
  const bigBasePath = '/fixture/assets/textures/material/big_base.ktx2';
  const bigEmissivePath = '/fixture/assets/textures/material/big_emissive.ktx2';
  const companionGets: string[] = [];
  const companionHeads: string[] = [];

  await page.route('**/api/sessions/*/file?*', route => route.fulfill({
    json: {
      path: '/fixture/assets/environments/berth/small_root.glb',
      relPath: 'assets/environments/berth/small_root.glb',
      size: multiTexGlb.length,
      mtime: 200,
      model: { url: `/api/sessions/${ROOT}/file/content?path=small_root.glb&v=200-${multiTexGlb.length}`, mimeType: 'model/gltf-binary' },
    },
  }));

  await page.route('**/api/sessions/*/file/content?*', route => {
    const reqPath = new URL(route.request().url()).searchParams.get('path') ?? '';
    const method = route.request().method();
    if (reqPath.endsWith('small_root.glb')) {
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'model/gltf-binary' }, body: multiTexGlb });
    }
    if (reqPath === bigBasePath || reqPath === bigEmissivePath) {
      if (method === 'HEAD') {
        companionHeads.push(reqPath);
        // Report 20 MiB each (40 MiB total > 25 MiB gate) without transferring bytes.
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'image/ktx2', 'Content-Length': String(20 * 1024 * 1024) },
          body: Buffer.alloc(0),
        });
      }
      companionGets.push(reqPath);
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'image/ktx2' }, body: FIXTURE_KTX2 });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  // 1. Opening pauses at consent with the combined ~40.0 MB total BEFORE any companion GET.
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('small_root.glb'));
  const viewer = page.locator('#fileViewBody .model-viewer');
  await expect(viewer).toHaveAttribute('data-model-state', 'gated', { timeout: 10000 });
  await expect(viewer.locator('.model-load-btn')).toContainText('Load ~40.0 MB');
  expect(companionHeads.sort()).toEqual([bigBasePath, bigEmissivePath]);
  expect(companionGets).toHaveLength(0);
  await expect(page.locator('#fileViewBody canvas')).toHaveCount(0);

  // Declining aborts cleanly with zero companion GETs and zero WebGL context.
  await viewer.locator('.model-cancel-btn').click();
  await expect(viewer).toHaveAttribute('data-model-state', 'cancelled');
  expect(companionGets).toHaveLength(0);
  await expect(page.locator('#fileViewBody canvas')).toHaveCount(0);

  // 2. Reopening and accepting proceeds to download the companions and render.
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('small_root.glb'));
  await expect(viewer).toHaveAttribute('data-model-state', 'gated', { timeout: 10000 });
  await viewer.locator('.model-load-btn').click();
  await expect(viewer).toHaveAttribute('data-model-state', 'ready', { timeout: 15000 });
  expect(companionGets.sort()).toEqual([bigBasePath, bigEmissivePath]);
  await expect(page.locator('#fileViewBody canvas')).toHaveCount(1);
});

test('small transfer KTX2 companions exceeding the 256 MiB decoded budget pause before WASM decode', async ({ page, fleet }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fleet.select(fleet.self);

  // Clone the valid 4×4 KTX2 header but declare 150 MiB uncompressed mip 0 on each
  // of two companions (300 MiB > 256 MiB decoded limit) while keeping transfer tiny (< 1 KB).
  const hugeHeaderKtx2 = Buffer.from(FIXTURE_KTX2);
  hugeHeaderKtx2.writeBigUInt64LE(BigInt(150 * 1024 * 1024), 80 + 16);

  const twoTexGlb = buildFixtureGlb({
    textureUri: '../../textures/material/dense_a.ktx2',
    extraBlockedUri: '../../textures/material/dense_b.ktx2',
  });
  const denseA = '/fixture/assets/textures/material/dense_a.ktx2';
  const denseB = '/fixture/assets/textures/material/dense_b.ktx2';

  await page.route('**/api/sessions/*/file?*', route => route.fulfill({
    json: {
      path: '/fixture/assets/environments/berth/dense_ktx.glb',
      relPath: 'assets/environments/berth/dense_ktx.glb',
      size: twoTexGlb.length,
      mtime: 201,
      model: { url: `/api/sessions/${ROOT}/file/content?path=dense_ktx.glb&v=201-${twoTexGlb.length}`, mimeType: 'model/gltf-binary' },
    },
  }));
  await page.route('**/api/sessions/*/file/content?*', route => {
    const reqPath = new URL(route.request().url()).searchParams.get('path') ?? '';
    if (reqPath.endsWith('dense_ktx.glb')) {
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'model/gltf-binary' }, body: twoTexGlb });
    }
    if (reqPath === denseA || reqPath === denseB) {
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'image/ktx2' }, body: hugeHeaderKtx2 });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  await page.evaluate(() => fixtureApp.features.fileViews.openFile('dense_ktx.glb'));
  const viewer = page.locator('#fileViewBody .model-viewer');
  await expect(viewer).toHaveAttribute('data-model-state', 'gated', { timeout: 10000 });
  await expect(viewer.locator('.model-load-btn')).toContainText('Decode ~300.0 MB');
  // WebGL renderer has not been created yet (and WASM decode has not run).
  await expect(page.locator('#fileViewBody canvas')).toHaveCount(0);

  await viewer.locator('.model-cancel-btn').click();
  await expect(viewer).toHaveAttribute('data-model-state', 'cancelled');
  await expect(page.locator('#fileViewBody canvas')).toHaveCount(0);
});

export {};
