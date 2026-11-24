/**
 * Inline 3D glTF/GLB model viewer for the file panel.
 *
 * Lazy-loads the pinned `public/vendor/three-gltf.js` bundle on first model
 * open, fetches the model and every external texture/buffer (including plain
 * URI RGBA8+zstd `.ktx2` files) through the owning host's authenticated
 * `/file/content` route, and disposes the WebGL context and GPU resources on
 * close or session switch.
 */
import type * as THREE from 'three';
import type { GLTF, GLTFLoader, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { createBrowserAssets } from './browser-assets';
import { errorMessage } from './api-client';
import { resolveColorToHex } from './host-presentation';
import { escapeHtml } from '../core/helper-format';
import { formatMediaSize } from '../core/helper-media';
import {
  formatModelStats,
  MODEL_VENDOR_API_VERSION,
  MODEL_VIEWS,
  modelSnapshotFilename,
  modelVendorUrl,
  modelViewById,
  parseCssColorToHex,
  resolveModelResourcePath,
  shouldGateModelLoad,
  type ModelStats,
  type ModelViewId,
  type ModelViewPreset,
} from './model-view-data';

export interface ThreeGltfRuntime {
  readonly apiVersion: number;
  readonly threeVersion: string;
  readonly AgXToneMapping: typeof THREE.AgXToneMapping;
  readonly Box3: typeof THREE.Box3;
  readonly Color: typeof THREE.Color;
  readonly LoadingManager: typeof THREE.LoadingManager;
  readonly OrthographicCamera: typeof THREE.OrthographicCamera;
  readonly PerspectiveCamera: typeof THREE.PerspectiveCamera;
  readonly PMREMGenerator: typeof THREE.PMREMGenerator;
  readonly Scene: typeof THREE.Scene;
  readonly Sphere: typeof THREE.Sphere;
  readonly SRGBColorSpace: typeof THREE.SRGBColorSpace;
  readonly Texture: typeof THREE.Texture;
  readonly TOUCH: typeof THREE.TOUCH;
  readonly Vector3: typeof THREE.Vector3;
  readonly WebGLRenderer: typeof THREE.WebGLRenderer;
  readonly GLTFLoader: typeof GLTFLoader;
  readonly KTX2Loader: typeof KTX2Loader;
  readonly OrbitControls: typeof OrbitControls;
  readonly RoomEnvironment: typeof RoomEnvironment;
}

class ModelVersionSkewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelVersionSkewError';
  }
}

export interface ModelMountOptions {
  readonly container: HTMLElement;
  readonly modelPath: string;
  readonly sizeBytes: number;
  readonly mtime: number;
  readonly fetchFile: (absPath: string, signal: AbortSignal, cacheKey?: string) => Promise<ArrayBuffer>;
  readonly status: (message: string, type?: string) => void;
}

export interface MountedModelView {
  refreshTheme(): void;
  dispose(): void;
}

const MATERIAL_TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'alphaMap', 'bumpMap', 'displacementMap', 'envMap', 'lightMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'specularColorMap', 'specularIntensityMap',
  'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap',
  'anisotropyMap',
] as const;

/** Full-frame 35mm sensor height in millimetres (matches Blender's 36×24mm gate). */
const SENSOR_HEIGHT_MM = 24;
const FRAME_PADDING = 1.15;
const DAMPING_EPSILON = 1e-5;

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return 'isMesh' in object && (object as { isMesh?: unknown }).isMesh === true;
}

function isTexture(value: unknown): value is THREE.Texture {
  return typeof value === 'object' && value !== null && 'isTexture' in value && (value as { isTexture?: unknown }).isTexture === true;
}

function isImageBitmapValue(value: unknown): value is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
}

function decodeImageBuffer(
  runtime: ThreeGltfRuntime,
  buffer: ArrayBuffer,
  doc: Document,
): Promise<{ texture: THREE.Texture; bitmap: ImageBitmap | null }> {
  const blob = new Blob([buffer]);
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob).then(bitmap => {
      const texture = new runtime.Texture(bitmap);
      texture.needsUpdate = true;
      return { texture, bitmap };
    });
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = doc.createElement('img');
    img.onload = () => {
      URL.revokeObjectURL(url);
      const texture = new runtime.Texture(img);
      texture.needsUpdate = true;
      resolve({ texture, bitmap: null });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode texture image'));
    };
    img.src = url;
  });
}

function measureModel(
  runtime: ThreeGltfRuntime,
  root: THREE.Object3D,
  sizeBytes: number,
  animationCount: number,
): { stats: ModelStats; box: THREE.Box3; center: THREE.Vector3; radius: number; hasGeometry: boolean } {
  root.updateMatrixWorld(true);
  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  const materials = new Set<THREE.Material>();

  root.traverse(object => {
    if (!isMesh(object)) return;
    meshes++;
    const geom = object.geometry;
    const pos = geom.getAttribute('position');
    if (pos) {
      vertices += pos.count;
      const index = geom.getIndex();
      triangles += index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    }
    if (Array.isArray(object.material)) {
      for (const mat of object.material) materials.add(mat);
    } else if (object.material) {
      materials.add(object.material);
    }
  });

  const box = new runtime.Box3().setFromObject(root);
  const hasGeometry = meshes > 0 && !box.isEmpty();
  const center = new runtime.Vector3();
  const size = new runtime.Vector3();
  let radius = 0.5;
  let dimensions: readonly [number, number, number] | null = null;

  if (hasGeometry) {
    box.getCenter(center);
    box.getSize(size);
    const sphere = new runtime.Sphere();
    box.getBoundingSphere(sphere);
    radius = Math.max(sphere.radius, 1e-4);
    dimensions = [size.x, size.y, size.z];
  }

  return {
    stats: { triangles, vertices, meshes, materials: materials.size, sizeBytes, dimensions, animationCount },
    box,
    center,
    radius,
    hasGeometry,
  };
}

function disposeObjectTree(root: THREE.Object3D, ownedBitmaps: readonly ImageBitmap[]): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse(object => {
    if (!isMesh(object)) return;
    geometries.add(object.geometry);
    const matList = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const mat of matList) {
      materials.add(mat);
      const recordMat = mat as unknown as Record<string, unknown>;
      for (const slot of MATERIAL_TEXTURE_SLOTS) {
        const candidate = recordMat[slot];
        if (isTexture(candidate)) textures.add(candidate);
      }
    }
  });

  for (const texture of textures) {
    if (isImageBitmapValue(texture.image)) {
      try { texture.image.close(); } catch {}
    }
    texture.dispose();
  }
  for (const bitmap of ownedBitmaps) {
    try { bitmap.close(); } catch {}
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export function createModelViewer(options: {
  document: Document;
  assets: ReturnType<typeof createBrowserAssets>;
  runtime: () => ThreeGltfRuntime | null;
}) {
  const { document } = options;
  const win = document.defaultView!;
  let disposed = false;
  let runtimePromise: Promise<ThreeGltfRuntime> | null = null;

  function loadRuntime(): Promise<ThreeGltfRuntime> {
    if (disposed) return Promise.reject(new Error('Model viewer disposed'));
    const existing = options.runtime();
    if (existing) {
      if (existing.apiVersion !== MODEL_VENDOR_API_VERSION) {
        return Promise.reject(new ModelVersionSkewError('Pi-dish was updated — reload the page to view 3D models.'));
      }
      return Promise.resolve(existing);
    }
    if (runtimePromise) return runtimePromise;
    const src = modelVendorUrl(document);
    runtimePromise = options.assets.load('script', { src }).then(() => {
      if (disposed) throw new Error('Model viewer disposed');
      const loaded = options.runtime();
      if (!loaded) throw new Error('3D viewer bundle did not initialize');
      if (loaded.apiVersion !== MODEL_VENDOR_API_VERSION) {
        throw new ModelVersionSkewError('Pi-dish was updated — reload the page to view 3D models.');
      }
      return loaded;
    }).catch(err => {
      runtimePromise = null;
      throw err;
    });
    return runtimePromise;
  }

  function mount(mountOptions: ModelMountOptions): MountedModelView {
    const { container, modelPath, sizeBytes, mtime, fetchFile, status } = mountOptions;
    let instanceDisposed = false;
    const events = new AbortController();
    const { signal } = events;

    const viewChipsHtml = MODEL_VIEWS.map(view =>
      `<button type="button" class="model-chip" data-model-view-btn="${escapeHtml(view.id)}" title="${escapeHtml(view.title)}" aria-pressed="false" disabled>${escapeHtml(view.label)}</button>`,
    ).join('');

    container.innerHTML = `<div class="model-viewer" data-model-state="loading" data-model-view="q34">`
      + `<div class="model-toolbar">`
      + `<div class="model-views" role="group" aria-label="Camera views">${viewChipsHtml}</div>`
      + `<div class="model-actions">`
      + `<button type="button" class="model-chip model-action-btn" data-model-action="reset" title="Reset view" disabled>Reset</button>`
      + `<button type="button" class="model-chip model-action-btn" data-model-action="snapshot" title="Save snapshot as PNG" disabled>Snapshot</button>`
      + `</div></div>`
      + `<div class="model-stage">`
      + `<div class="model-overlay" role="status"></div>`
      + `</div>`
      + `<div class="model-stats"><span class="model-stats-text">${escapeHtml(formatMediaSize(sizeBytes))}</span><span class="model-stats-warn" hidden></span></div>`
      + `</div>`;

    const rootEl = container.querySelector<HTMLElement>('.model-viewer')!;
    const stageEl = rootEl.querySelector<HTMLElement>('.model-stage')!;
    const overlayEl = rootEl.querySelector<HTMLElement>('.model-overlay')!;
    const statsTextEl = rootEl.querySelector<HTMLElement>('.model-stats-text')!;
    const statsWarnEl = rootEl.querySelector<HTMLElement>('.model-stats-warn')!;
    const viewButtons = Array.from(rootEl.querySelectorAll<HTMLButtonElement>('[data-model-view-btn]'));
    const actionButtons = Array.from(rootEl.querySelectorAll<HTMLButtonElement>('[data-model-action]'));

    let runtime: ThreeGltfRuntime | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let perspCamera: THREE.PerspectiveCamera | null = null;
    let orthoCamera: THREE.OrthographicCamera | null = null;
    let activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null;
    let controls: OrbitControls | null = null;
    let envScene: RoomEnvironment | null = null;
    let pmrem: THREE.PMREMGenerator | null = null;
    let envTarget: THREE.WebGLRenderTarget | null = null;
    let ktx2Loader: KTX2Loader | null = null;
    let loadedRoot: THREE.Object3D | null = null;
    const ownedBitmaps: ImageBitmap[] = [];
    let resizeObserver: ResizeObserver | null = null;
    let rafId = 0;
    let interacting = false;
    let currentView: ModelViewId | 'custom' = 'q34';
    let modelBox: THREE.Box3 | null = null;
    let modelCenter: THREE.Vector3 | null = null;
    let modelRadius = 0.5;
    let orthoHalfHeight = 0.5;

    const isAlive = () => !disposed && !instanceDisposed && !signal.aborted && rootEl.isConnected;

    function setControlsEnabled(enabled: boolean): void {
      for (const btn of viewButtons) btn.disabled = !enabled;
      for (const btn of actionButtons) btn.disabled = !enabled;
    }

    function setActiveViewChip(view: ModelViewId | 'custom'): void {
      currentView = view;
      rootEl.dataset.modelView = view;
      for (const btn of viewButtons) {
        const active = btn.dataset.modelViewBtn === view;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    }

    function showOverlay(html: string, state: 'loading' | 'gated' | 'empty' | 'error'): void {
      rootEl.dataset.modelState = state;
      overlayEl.innerHTML = html;
      overlayEl.hidden = false;
    }

    function hideOverlay(state: 'ready'): void {
      rootEl.dataset.modelState = state;
      overlayEl.hidden = true;
      overlayEl.innerHTML = '';
    }

    function syncBackground(): void {
      if (!runtime || !scene) return;
      const computed = win.getComputedStyle(stageEl).backgroundColor;
      const hex = parseCssColorToHex(computed) || resolveColorToHex(computed, document);
      if (hex) scene.background = new runtime.Color(hex);
    }

    function updateCameraAttribute(): void {
      if (!activeCamera) return;
      const p = activeCamera.position;
      rootEl.dataset.modelCamera = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
    }

    function renderFrame(): void {
      if (!isAlive() || !renderer || !scene || !activeCamera) return;
      renderer.render(scene, activeCamera);
      updateCameraAttribute();
    }

    function scheduleRender(): void {
      if (!isAlive() || rafId !== 0) return;
      rafId = win.requestAnimationFrame(() => {
        rafId = 0;
        if (!isAlive() || !renderer || !scene || !activeCamera) return;
        let keepRunning = false;
        if (controls) {
          const prevX = activeCamera.position.x;
          const prevY = activeCamera.position.y;
          const prevZ = activeCamera.position.z;
          const prevTx = controls.target.x;
          const prevTy = controls.target.y;
          const prevTz = controls.target.z;
          const prevZoom = activeCamera.zoom;
          controls.update();
          const moved = Math.abs(activeCamera.position.x - prevX)
            + Math.abs(activeCamera.position.y - prevY)
            + Math.abs(activeCamera.position.z - prevZ)
            + Math.abs(controls.target.x - prevTx)
            + Math.abs(controls.target.y - prevTy)
            + Math.abs(controls.target.z - prevTz)
            + Math.abs(activeCamera.zoom - prevZoom);
          keepRunning = interacting || moved > DAMPING_EPSILON;
        }
        renderFrame();
        if (keepRunning) scheduleRender();
      });
    }

    function stageSize(): { width: number; height: number } {
      const rect = stageEl.getBoundingClientRect();
      return {
        width: Math.max(1, Math.round(rect.width || stageEl.clientWidth || 320)),
        height: Math.max(1, Math.round(rect.height || stageEl.clientHeight || 240)),
      };
    }

    function updateRendererSize(): void {
      if (!renderer || !perspCamera || !orthoCamera) return;
      const { width, height } = stageSize();
      const aspect = width / height;
      renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      perspCamera.aspect = aspect;
      perspCamera.updateProjectionMatrix();
      orthoCamera.left = -orthoHalfHeight * aspect;
      orthoCamera.right = orthoHalfHeight * aspect;
      orthoCamera.top = orthoHalfHeight;
      orthoCamera.bottom = -orthoHalfHeight;
      orthoCamera.updateProjectionMatrix();
    }

    function boxCorners(box: THREE.Box3, rt: ThreeGltfRuntime): THREE.Vector3[] {
      const { min, max } = box;
      return [
        new rt.Vector3(min.x, min.y, min.z),
        new rt.Vector3(min.x, min.y, max.z),
        new rt.Vector3(min.x, max.y, min.z),
        new rt.Vector3(min.x, max.y, max.z),
        new rt.Vector3(max.x, min.y, min.z),
        new rt.Vector3(max.x, min.y, max.z),
        new rt.Vector3(max.x, max.y, min.z),
        new rt.Vector3(max.x, max.y, max.z),
      ];
    }

    function applyView(preset: ModelViewPreset): void {
      if (!runtime || !perspCamera || !orthoCamera || !controls || !modelBox || !modelCenter) return;
      const { width, height } = stageSize();
      const aspect = width / height;
      const span = Math.max(modelRadius * 2, 1e-3);
      const target = modelCenter.clone().add(new runtime.Vector3(
        preset.targetOffset[0] * span,
        preset.targetOffset[1] * span,
        preset.targetOffset[2] * span,
      ));
      const dir = new runtime.Vector3(preset.dir[0], preset.dir[1], preset.dir[2]).normalize();
      const worldUp = new runtime.Vector3(0, 1, 0);
      const forward = dir.clone().negate();
      const right = new runtime.Vector3().crossVectors(forward, worldUp);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      else right.normalize();
      const camUp = new runtime.Vector3().crossVectors(right, forward).normalize();

      // Project the bounding box onto the camera basis so both narrow phone
      // screens (390×844) and wide desktop viewports frame the full model.
      let maxAbsX = 0;
      let maxAbsY = 0;
      let maxAbsZ = 0;
      for (const corner of boxCorners(modelBox, runtime)) {
        const rel = corner.sub(target);
        maxAbsX = Math.max(maxAbsX, Math.abs(rel.dot(right)));
        maxAbsY = Math.max(maxAbsY, Math.abs(rel.dot(camUp)));
        maxAbsZ = Math.max(maxAbsZ, Math.abs(rel.dot(dir)));
      }
      const halfX = Math.max(maxAbsX, 1e-4) * FRAME_PADDING;
      const halfY = Math.max(maxAbsY, 1e-4) * FRAME_PADDING;

      if (preset.ortho) {
        orthoHalfHeight = Math.max(halfY, halfX / aspect);
        orthoCamera.left = -orthoHalfHeight * aspect;
        orthoCamera.right = orthoHalfHeight * aspect;
        orthoCamera.top = orthoHalfHeight;
        orthoCamera.bottom = -orthoHalfHeight;
        orthoCamera.zoom = 1;
        const dist = Math.max(modelRadius * 4, maxAbsZ * 2 + modelRadius);
        orthoCamera.near = Math.max(modelRadius * 0.002, 0.001);
        orthoCamera.far = Math.max(dist * 6, modelRadius * 40, 100);
        orthoCamera.up.set(0, 1, 0);
        orthoCamera.position.copy(target).addScaledVector(dir, dist);
        orthoCamera.lookAt(target);
        orthoCamera.updateProjectionMatrix();
        activeCamera = orthoCamera;
      } else {
        const lensMm = preset.lensMm || 50;
        const vfovRad = 2 * Math.atan((SENSOR_HEIGHT_MM / 2) / lensMm);
        const tanHalfV = Math.tan(vfovRad / 2);
        const tanHalfH = tanHalfV * aspect;
        const dist = Math.max(halfY / tanHalfV, halfX / tanHalfH) + maxAbsZ;
        perspCamera.fov = (vfovRad * 180) / Math.PI;
        perspCamera.aspect = aspect;
        perspCamera.near = Math.max(modelRadius * 0.004, 0.001);
        perspCamera.far = Math.max(dist * 20, modelRadius * 100, 100);
        perspCamera.up.set(0, 1, 0);
        perspCamera.position.copy(target).addScaledVector(dir, dist);
        perspCamera.lookAt(target);
        perspCamera.updateProjectionMatrix();
        activeCamera = perspCamera;
      }

      controls.object = activeCamera;
      controls.target.copy(target);
      controls.minDistance = Math.max(modelRadius * 0.12, 0.01);
      controls.maxDistance = Math.max(modelRadius * 30, 50);
      controls.update();
      setActiveViewChip(preset.id);
      renderFrame();
    }

    function takeSnapshot(): void {
      if (!isAlive() || !renderer || !scene || !activeCamera) return;
      renderFrame();
      const canvas = renderer.domElement;
      const filename = modelSnapshotFilename(modelPath, currentView);
      const triggerDownload = (href: string, revoke: boolean) => {
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        link.style.display = 'none';
        document.body.append(link);
        link.click();
        link.remove();
        if (revoke) win.setTimeout(() => URL.revokeObjectURL(href), 1500);
        status(`Saved ${filename}`);
      };
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(blob => {
          if (!isAlive()) return;
          if (blob) triggerDownload(URL.createObjectURL(blob), true);
          else triggerDownload(canvas.toDataURL('image/png'), false);
        }, 'image/png');
      } else {
        triggerDownload(canvas.toDataURL('image/png'), false);
      }
    }

    for (const btn of viewButtons) {
      btn.addEventListener('click', () => {
        const preset = modelViewById(btn.dataset.modelViewBtn || '');
        if (isAlive() && preset) applyView(preset);
      }, { signal });
    }
    for (const btn of actionButtons) {
      btn.addEventListener('click', () => {
        if (!isAlive()) return;
        const action = btn.dataset.modelAction;
        if (action === 'reset') {
          const q34 = modelViewById('q34');
          if (q34) applyView(q34);
        } else if (action === 'snapshot') {
          takeSnapshot();
        }
      }, { signal });
    }

    async function loadAndRender(): Promise<void> {
      if (!isAlive()) return;
      showOverlay('<div class="model-overlay-msg">Loading 3D viewer…</div>', 'loading');
      try {
        const rt = await loadRuntime();
        if (!isAlive()) return;
        runtime = rt;

        showOverlay('<div class="model-overlay-msg">Loading model…</div>', 'loading');
        const modelBuffer = await fetchFile(modelPath, signal, `${mtime}-${sizeBytes}`);
        if (!isAlive()) return;

        // Create the WebGL renderer after bytes arrive so failed/aborted loads
        // never claim a mobile WebGL context slot.
        let webglRenderer: THREE.WebGLRenderer;
        try {
          webglRenderer = new rt.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        } catch {
          showOverlay('<div class="model-overlay-msg model-overlay-error">WebGL is unavailable in this browser.</div>', 'error');
          return;
        }
        renderer = webglRenderer;
        webglRenderer.outputColorSpace = rt.SRGBColorSpace;
        webglRenderer.toneMapping = rt.AgXToneMapping;
        webglRenderer.toneMappingExposure = 1.15;

        const canvas = webglRenderer.domElement;
        canvas.className = 'model-canvas';
        canvas.setAttribute('aria-label', `3D model preview: ${modelPath.split('/').pop() || 'model'}`);
        canvas.addEventListener('webglcontextlost', event => {
          event.preventDefault();
          if (isAlive()) {
            setControlsEnabled(false);
            showOverlay('<div class="model-overlay-msg model-overlay-error">WebGL context lost — close and reopen to retry.</div>', 'error');
          }
        }, { signal });
        stageEl.prepend(canvas);

        scene = new rt.Scene();
        syncBackground();

        envScene = new rt.RoomEnvironment();
        pmrem = new rt.PMREMGenerator(webglRenderer);
        envTarget = pmrem.fromScene(envScene, 0.04);
        scene.environment = envTarget.texture;
        // Release the helper geometry/materials immediately after baking PMREM.
        envScene.dispose();
        envScene = null;
        pmrem.dispose();
        pmrem = null;

        perspCamera = new rt.PerspectiveCamera(25, 1, 0.005, 100);
        orthoCamera = new rt.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.005, 100);
        activeCamera = perspCamera;
        updateRendererSize();

        controls = new rt.OrbitControls(activeCamera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = true;
        controls.enableZoom = true;
        controls.enableRotate = true;
        controls.touches = { ONE: rt.TOUCH.ROTATE, TWO: rt.TOUCH.DOLLY_PAN };
        controls.addEventListener('start', () => {
          interacting = true;
          if (currentView !== 'custom') setActiveViewChip('custom');
          scheduleRender();
        });
        controls.addEventListener('change', () => {
          scheduleRender();
        });
        controls.addEventListener('end', () => {
          interacting = false;
          scheduleRender();
        });

        let failedTextures = 0;
        let blockedResources = 0;
        const manager = new rt.LoadingManager();
        const ktx2 = new rt.KTX2Loader(manager);
        ktx2.detectSupport(webglRenderer);
        // RGBA8+zstd KTX2 decodes via the inlined zstddec WASM; refuse Basis
        // transcoder fetches so no unbundled asset request ever escapes.
        ktx2.init = () => Promise.reject(new Error('Basis-compressed KTX2 textures are not supported'));
        ktx2Loader = ktx2;

        const ktx2Handler: THREE.Loader<THREE.Texture, string> = {
          load(url, onLoad, _onProgress, onError) {
            const resolved = resolveModelResourcePath(modelPath, url);
            if (resolved.kind === 'blocked') {
              blockedResources++;
              onError?.(new Error(resolved.reason));
              return;
            }
            if (resolved.kind === 'inline') {
              void fetch(resolved.uri, { signal }).then(r => r.arrayBuffer()).then(buf => {
                if (!isAlive()) return;
                ktx2.parse(buf, tex => { if (isAlive()) onLoad(tex); }, err => { failedTextures++; onError?.(err); });
              }, err => { failedTextures++; onError?.(err); });
              return;
            }
            void fetchFile(resolved.absPath, signal).then(buf => {
              if (!isAlive()) return;
              ktx2.parse(
                buf,
                tex => { if (isAlive()) onLoad(tex); },
                err => { failedTextures++; onError?.(err); },
              );
            }, err => {
              failedTextures++;
              onError?.(err);
            });
          },
        } as THREE.Loader<THREE.Texture, string>;

        const externalImageHandler: THREE.Loader<THREE.Texture, string> = {
          load(url, onLoad, _onProgress, onError) {
            const resolved = resolveModelResourcePath(modelPath, url);
            if (resolved.kind === 'blocked') {
              blockedResources++;
              onError?.(new Error(resolved.reason));
              return;
            }
            if (resolved.kind === 'inline') {
              void fetch(resolved.uri, { signal }).then(r => r.arrayBuffer()).then(buf => decodeImageBuffer(rt, buf, document)).then(({ texture, bitmap }) => {
                if (!isAlive()) { texture.dispose(); bitmap?.close(); return; }
                if (bitmap) ownedBitmaps.push(bitmap);
                onLoad(texture);
              }, err => { failedTextures++; onError?.(err); });
              return;
            }
            void fetchFile(resolved.absPath, signal).then(buf => decodeImageBuffer(rt, buf, document)).then(({ texture, bitmap }) => {
              if (!isAlive()) { texture.dispose(); bitmap?.close(); return; }
              if (bitmap) ownedBitmaps.push(bitmap);
              onLoad(texture);
            }, err => {
              failedTextures++;
              onError?.(err);
            });
          },
        } as THREE.Loader<THREE.Texture, string>;

        // Match external .ktx2 first, then any remaining non-blob/data image URI
        // so embedded bufferView (blob:) and inline data: URIs stay native while
        // relative files go through authenticated /file/content and external
        // schemes (http/https/file) are refused.
        ktx2.load = (url, onLoad, onProgress, onError) => {
          ktx2Handler.load(url, onLoad as (data: THREE.Texture) => void, onProgress, onError);
        };
        manager.addHandler(/^(?!blob:|data:).*\.ktx2(?:$|[?#])/i, ktx2Handler);
        manager.addHandler(/^(?!blob:|data:)/i, externalImageHandler);

        const gltfLoader = new rt.GLTFLoader(manager);
        gltfLoader.setKTX2Loader(ktx2);
        gltfLoader.register((parser: GLTFParser) => {
          const origLoad = parser.fileLoader.load.bind(parser.fileLoader);
          parser.fileLoader.load = (url, onLoad, onProgress, onError) => {
            const resolved = resolveModelResourcePath(modelPath, url);
            if (resolved.kind === 'inline') return origLoad(url, onLoad, onProgress, onError);
            if (resolved.kind === 'blocked') {
              blockedResources++;
              onError?.(new Error(resolved.reason));
              return;
            }
            void fetchFile(resolved.absPath, signal).then(
              buf => { if (isAlive()) onLoad?.(buf); },
              err => { onError?.(err); },
            );
          };
          return { name: 'PI_DISH_LOCAL_BUFFERS' };
        });

        const gltf = await new Promise<GLTF>((resolve, reject) => {
          gltfLoader.parse(modelBuffer, '', resolve, reject);
        });
        if (!isAlive()) {
          disposeObjectTree(gltf.scene, ownedBitmaps);
          return;
        }

        loadedRoot = gltf.scene;
        scene.add(loadedRoot);

        const measured = measureModel(rt, loadedRoot, sizeBytes, gltf.animations.length);
        statsTextEl.textContent = formatModelStats(measured.stats);
        modelBox = measured.box;
        modelCenter = measured.center;
        modelRadius = measured.radius;

        const warnings: string[] = [];
        if (failedTextures > 0) {
          warnings.push(`${failedTextures} ${failedTextures === 1 ? 'texture' : 'textures'} unavailable`);
        }
        if (blockedResources > 0) {
          warnings.push(`${blockedResources} external ${blockedResources === 1 ? 'URI' : 'URIs'} blocked`);
        }
        if (warnings.length) {
          statsWarnEl.textContent = warnings.join(' · ');
          statsWarnEl.hidden = false;
        }

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (!isAlive()) return;
            updateRendererSize();
            if (currentView !== 'custom') {
              const preset = modelViewById(currentView);
              if (preset) { applyView(preset); return; }
            }
            scheduleRender();
          });
          resizeObserver.observe(stageEl);
        }

        if (!measured.hasGeometry) {
          setControlsEnabled(false);
          const animNote = measured.stats.animationCount > 0
            ? ` (${measured.stats.animationCount} animation ${measured.stats.animationCount === 1 ? 'clip' : 'clips'})`
            : '';
          showOverlay(`<div class="model-overlay-msg">No renderable meshes in this model${escapeHtml(animNote)}.</div>`, 'empty');
          renderFrame();
          return;
        }

        setControlsEnabled(true);
        hideOverlay('ready');
        applyView(MODEL_VIEWS[0]);
      } catch (err) {
        if (!isAlive()) return;
        setControlsEnabled(false);
        if (err instanceof ModelVersionSkewError) {
          showOverlay(
            `<div class="model-overlay-card">`
              + `<div class="model-overlay-msg">${escapeHtml(err.message)}</div>`
              + `<button type="button" class="btn-small model-reload-btn">Reload</button>`
              + `</div>`,
            'error',
          );
          overlayEl.querySelector<HTMLButtonElement>('.model-reload-btn')?.addEventListener('click', () => {
            win.location.reload();
          }, { signal });
          return;
        }
        showOverlay(`<div class="model-overlay-msg model-overlay-error">Could not load 3D model: ${escapeHtml(errorMessage(err))}</div>`, 'error');
      }
    }

    if (shouldGateModelLoad(sizeBytes)) {
      const label = formatMediaSize(sizeBytes);
      showOverlay(
        `<div class="model-overlay-card">`
          + `<div class="model-overlay-title">Large 3D model (${escapeHtml(label)})</div>`
          + `<div class="model-overlay-sub">Tap below to download and render in WebGL.</div>`
          + `<button type="button" class="btn-small model-load-btn">Load (${escapeHtml(label)})</button>`
          + `</div>`,
        'gated',
      );
      overlayEl.querySelector<HTMLButtonElement>('.model-load-btn')?.addEventListener('click', () => {
        if (isAlive()) void loadAndRender();
      }, { once: true, signal });
    } else {
      void loadAndRender();
    }

    return {
      refreshTheme() {
        if (!isAlive()) return;
        syncBackground();
        scheduleRender();
      },
      dispose() {
        if (instanceDisposed) return;
        instanceDisposed = true;
        events.abort();
        if (rafId !== 0) {
          win.cancelAnimationFrame(rafId);
          rafId = 0;
        }
        resizeObserver?.disconnect();
        resizeObserver = null;
        controls?.dispose();
        controls = null;
        if (loadedRoot) {
          scene?.remove(loadedRoot);
          disposeObjectTree(loadedRoot, ownedBitmaps);
          loadedRoot = null;
        } else {
          for (const bitmap of ownedBitmaps) {
            try { bitmap.close(); } catch {}
          }
        }
        ownedBitmaps.length = 0;
        envTarget?.dispose();
        envTarget = null;
        envScene?.dispose();
        envScene = null;
        pmrem?.dispose();
        pmrem = null;
        ktx2Loader?.dispose();
        ktx2Loader = null;
        if (renderer) {
          renderer.dispose();
          try { renderer.forceContextLoss(); } catch {}
          renderer.domElement.remove();
          renderer = null;
        }
        scene = null;
        perspCamera = null;
        orthoCamera = null;
        activeCamera = null;
      },
    };
  }

  return {
    mount,
    dispose() {
      disposed = true;
      runtimePromise = null;
    },
  };
}
