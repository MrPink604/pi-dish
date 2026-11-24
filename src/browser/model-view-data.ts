/**
 * Pure, DOM-free helpers for the inline 3D model viewer: camera view presets
 * (OSBG glTF Y-up, barrel -Z), safe relative resource/texture path resolution,
 * size gating, and stats formatting.
 */
import { formatMediaSize } from '../core/helper-media';

export const MODEL_VENDOR_API_VERSION = 1;
export const MODEL_LARGE_FILE_BYTES = 25 * 1024 * 1024;
export const MODEL_MAX_DECODED_BYTES = 256 * 1024 * 1024;
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

export function shouldGateDecodedKtx2(decodedBytes: number): boolean {
  return Number.isFinite(decodedBytes) && decodedBytes > MODEL_MAX_DECODED_BYTES;
}

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON' little-endian
const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * Extract unique external resource URIs (`images[*].uri`, `buffers[*].uri`)
 * from a GLB 2.0 binary container or UTF-8 `.gltf` JSON buffer before parsing
 * so companion transfer sizes can be checked up front.
 */
export function extractGltfExternalUris(buffer: ArrayBuffer): string[] {
  if (!buffer || buffer.byteLength === 0) return [];
  let jsonBytes: Uint8Array;
  const view = new DataView(buffer);
  if (buffer.byteLength >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
    const chunkLength = view.getUint32(12, true);
    const chunkType = view.getUint32(16, true);
    if (chunkType !== GLB_JSON_CHUNK_TYPE || 20 + chunkLength > buffer.byteLength) return [];
    jsonBytes = new Uint8Array(buffer, 20, chunkLength);
  } else {
    jsonBytes = new Uint8Array(buffer);
  }
  let parsed: unknown;
  try {
    let text: string;
    if (typeof TextDecoder !== 'undefined') {
      text = new TextDecoder('utf-8').decode(jsonBytes);
    } else {
      let raw = '';
      for (let i = 0; i < jsonBytes.length; i++) raw += String.fromCharCode(jsonBytes[i]);
      text = decodeURIComponent(escape(raw));
    }
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const doc = parsed as Record<string, unknown>;
  const seen = new Set<string>();
  const collect = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const uri = (item as Record<string, unknown>).uri;
        if (typeof uri === 'string' && uri.trim()) seen.add(uri);
      }
    }
  };
  collect(doc.images);
  collect(doc.buffers);
  return [...seen];
}

/**
 * Sum the uncompressed mip-level byte lengths declared in a KTX2 file's binary
 * header + level index without invoking the zstd WASM decoder.
 * Returns `null` when the buffer does not start with a valid KTX2 header.
 */
export function parseKtx2DecodedBytes(buffer: ArrayBuffer): number | null {
  if (!buffer || buffer.byteLength < 80) return null;
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 12));
  for (let i = 0; i < KTX2_IDENTIFIER.length; i++) {
    if (bytes[i] !== KTX2_IDENTIFIER[i]) return null;
  }
  const view = new DataView(buffer);
  const pixelWidth = view.getUint32(20, true);
  const pixelHeight = view.getUint32(24, true);
  const pixelDepth = view.getUint32(28, true);
  const layerCount = view.getUint32(32, true);
  const faceCount = view.getUint32(36, true);
  const levelCount = view.getUint32(40, true);
  const storedLevels = Math.max(1, levelCount);
  if (80 + storedLevels * 24 > buffer.byteLength) return null;

  let total = 0;
  for (let i = 0; i < storedLevels; i++) {
    const entryOffset = 80 + i * 24 + 16; // uncompressedByteLength (uint64 LE)
    const lo = view.getUint32(entryOffset, true);
    const hi = view.getUint32(entryOffset + 4, true);
    const levelBytes = lo + hi * 4294967296;
    if (!Number.isFinite(levelBytes) || levelBytes < 0) return null;
    total += levelBytes;
  }
  if (total === 0 && pixelWidth > 0) {
    // Fallback when uncompressedByteLength is zero (e.g. Basis/unlisted mip 0): estimate RGBA8.
    total = pixelWidth * Math.max(1, pixelHeight) * Math.max(1, pixelDepth)
      * Math.max(1, layerCount) * Math.max(1, faceCount) * 4;
  }
  return total;
}

/** Parse declared response byte length from `Content-Range` (total) or `Content-Length`. */
export function parseResponseByteLength(headers: Pick<Headers, 'get'>): number | null {
  const range = headers.get('content-range');
  if (range) {
    const match = /\/(\d+)\s*$/.exec(range);
    if (match) {
      const total = Number(match[1]);
      if (Number.isSafeInteger(total) && total >= 0) return total;
    }
  }
  const length = headers.get('content-length');
  if (length && /^\s*\d+\s*$/.test(length)) {
    const total = Number(length);
    if (Number.isSafeInteger(total) && total >= 0) return total;
  }
  return null;
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
