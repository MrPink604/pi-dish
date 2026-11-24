/**
 * Pure, DOM-free helpers for the inline 3D model viewer: camera view presets
 * (OSBG glTF Y-up, barrel -Z), safe relative resource/texture path resolution,
 * size gating, and stats formatting.
 */
import { formatMediaSize } from '../core/helper-media';

export const MODEL_VENDOR_API_VERSION = 1;
export const MODEL_LARGE_FILE_BYTES = 25 * 1024 * 1024;
export const MODEL_VENDOR_META_NAME = 'pi-dish-asset-three-gltf';
export const DEFAULT_MODEL_VENDOR_URL = 'vendor/three-gltf.js';

export type ModelViewId = 'q34' | 'left' | 'right' | 'top' | 'rear';

export interface ModelViewPreset {
  readonly id: ModelViewId;
  readonly label: string;
  readonly title: string;
  /** Direction from target to camera in glTF space (Y-up, barrel -Z). */
  readonly dir: readonly [number, number, number];
  /** Target offset scaled by model framing span (from render.py VIEWS). */
  readonly targetOffset: readonly [number, number, number];
  readonly ortho: boolean;
  /** Full-frame 35mm focal length for perspective views; null for orthographic. */
  readonly lensMm: number | null;
}

/**
 * Camera views from OSBG `tools/blender/weapons/weapon_kit/render.py` VIEWS
 * (glTF coordinates: Y-up, barrel along -Z).
 */
export const MODEL_VIEWS: readonly ModelViewPreset[] = [
  { id: 'q34', label: 'Q34', title: 'Front 3/4 view', dir: [-0.72, 0.38, -0.60], targetOffset: [0, 0, 0], ortho: false, lensMm: 62 },
  { id: 'left', label: 'Left', title: 'Left orthographic view', dir: [-1, 0, 0], targetOffset: [0, 0, 0], ortho: true, lensMm: null },
  { id: 'right', label: 'Right', title: 'Right orthographic view', dir: [1, 0, 0], targetOffset: [0, 0, 0], ortho: true, lensMm: null },
  { id: 'top', label: 'Top', title: 'Top orthographic view', dir: [-0.08, 1, 0], targetOffset: [0, 0, 0], ortho: true, lensMm: null },
  { id: 'rear', label: 'Rear', title: 'Rear view', dir: [-0.50, 0.40, 0.77], targetOffset: [0, -0.028, 0.057], ortho: false, lensMm: 50 },
];

export function modelViewById(id: string): ModelViewPreset | undefined {
  return MODEL_VIEWS.find(view => view.id === id);
}

export type ModelResourceResolution =
  | { readonly kind: 'inline'; readonly uri: string }
  | { readonly kind: 'local'; readonly absPath: string }
  | { readonly kind: 'blocked'; readonly reason: string };

/** Normalize a POSIX path lexically, collapsing `.` and `..` segments cleanly. */
export function resolvePosixPath(baseFilePath: string, rel: string): string {
  const dir = baseFilePath.includes('/') ? baseFilePath.slice(0, baseFilePath.lastIndexOf('/')) : '';
  const combined = rel.startsWith('/') ? rel : `${dir}/${rel}`;
  const out: string[] = [];
  for (const part of combined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

/**
 * Resolve a glTF/GLB external resource URI (texture or `.bin` buffer) against
 * the opened model's absolute POSIX path. Blocks `http(s)://`, `file://`,
 * protocol-relative URLs, and other schemes so model parsing can never issue
 * external network requests.
 */
export function resolveModelResourcePath(modelAbsPath: string, rawUri: string): ModelResourceResolution {
  const trimmed = String(rawUri || '').trim();
  if (!trimmed) return { kind: 'blocked', reason: 'Empty resource URI' };
  const compact = trimmed.replace(/[\u0000-\u0020]+/g, '');
  if (/^(?:data|blob):/i.test(compact)) {
    return { kind: 'inline', uri: trimmed };
  }
  if (compact.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(compact)) {
    return { kind: 'blocked', reason: `Blocked external URI: ${trimmed}` };
  }
  const clean = trimmed.split(/[?#]/)[0];
  if (!clean) return { kind: 'blocked', reason: 'Empty resource path' };
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return { kind: 'blocked', reason: `Malformed resource URI: ${trimmed}` };
  }
  if (/[\u0000-\u001f]/.test(decoded) || decoded.includes('\\')) {
    return { kind: 'blocked', reason: `Invalid resource path: ${trimmed}` };
  }
  if (!modelAbsPath || !modelAbsPath.startsWith('/')) {
    return { kind: 'blocked', reason: 'Model path is not absolute' };
  }
  return { kind: 'local', absPath: resolvePosixPath(modelAbsPath, decoded) };
}

/** Build the session-scoped `/file/content` API path for a model or companion asset. */
export function modelContentApiPath(sessionId: string, absPath: string, cacheKey?: string): string {
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/file/content?path=${encodeURIComponent(absPath)}`;
  return cacheKey ? `${base}&v=${encodeURIComponent(cacheKey)}` : base;
}

/** Read the content-versioned lazy vendor URL stamped into `index.html`. */
export function modelVendorUrl(doc: Pick<Document, 'querySelector'>): string {
  const meta = doc.querySelector(`meta[name="${MODEL_VENDOR_META_NAME}"]`);
  const value = meta?.getAttribute('content')?.trim() || '';
  return value || DEFAULT_MODEL_VENDOR_URL;
}

export function shouldGateModelLoad(sizeBytes: number): boolean {
  return Number.isFinite(sizeBytes) && sizeBytes > MODEL_LARGE_FILE_BYTES;
}

export interface ModelStats {
  readonly triangles: number;
  readonly vertices: number;
  readonly meshes: number;
  readonly materials: number;
  readonly sizeBytes: number;
  readonly dimensions: readonly [number, number, number] | null;
  readonly animationCount: number;
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

export function formatModelBounds(dims: readonly [number, number, number] | null): string {
  if (!dims) return '';
  const [x, y, z] = dims;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return '';
  const maxDim = Math.max(x, y, z);
  if (maxDim < 10) {
    return `${Math.round(x * 1000)}×${Math.round(y * 1000)}×${Math.round(z * 1000)} mm`;
  }
  return `${x.toFixed(1)}×${y.toFixed(1)}×${z.toFixed(1)} m`;
}

export function formatModelStats(stats: ModelStats): string {
  const parts: string[] = [
    `${formatInteger(stats.triangles)} ${stats.triangles === 1 ? 'tri' : 'tris'}`,
    `${formatInteger(stats.meshes)} ${stats.meshes === 1 ? 'mesh' : 'meshes'}`,
    `${formatInteger(stats.materials)} ${stats.materials === 1 ? 'mat' : 'mats'}`,
  ];
  const bounds = formatModelBounds(stats.dimensions);
  if (bounds) parts.push(bounds);
  parts.push(formatMediaSize(stats.sizeBytes));
  return parts.join(' · ');
}

export function modelSnapshotFilename(modelPath: string, viewId?: string): string {
  const base = (modelPath.split('/').pop() || 'model').replace(/\.(?:glb|gltf)$/i, '');
  const safeStem = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'model';
  const safeView = (viewId || '').replace(/[^A-Za-z0-9_-]+/g, '');
  return safeView ? `${safeStem}_${safeView}.png` : `${safeStem}.png`;
}

/**
 * Parse `#rrggbb`, `rgb(...)`/`rgba(...)`, and CSS Color 4 `color(srgb r g b)`
 * strings (emitted by `getComputedStyle` for `color-mix(in srgb, ...)`) to hex.
 */
export function parseCssColorToHex(value: string): string | null {
  const trimmed = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(trimmed);
  if (rgb) {
    const channel = (s: string) => Math.max(0, Math.min(255, Math.round(Number(s)))).toString(16).padStart(2, '0');
    return '#' + channel(rgb[1]) + channel(rgb[2]) + channel(rgb[3]);
  }
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(trimmed);
  if (srgb) {
    const channel = (s: string) => Math.max(0, Math.min(255, Math.round(Number(s) * 255))).toString(16).padStart(2, '0');
    return '#' + channel(srgb[1]) + channel(srgb[2]) + channel(srgb[3]);
  }
  return null;
}
