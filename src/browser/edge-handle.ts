import { record } from '../core/helper-values';

export const EDGE_HANDLE_STORAGE_KEY = 'pi-dish-edge-handle';

export interface EdgeHandleSettings {
  /** Vertical position along the safe-area track, 0 (top) to 100 (bottom) percent. */
  readonly position: number;
  /** Handle length as a percentage of usable viewport height, 10 to 100 percent. */
  readonly length: number;
  /** Horizontal touch zone from the left edge, 12 to 64 px. */
  readonly touchWidth: number;
  /** Whether the slim visual pill is shown when the drawer is closed. */
  readonly visible: boolean;
  /** Visual pill opacity when visible, 0.1 to 1. */
  readonly opacity: number;
}

export interface EdgeHandleZone {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export const EDGE_HANDLE_LIMITS = Object.freeze({
  position: Object.freeze({ min: 0, max: 100, step: 1 }),
  length: Object.freeze({ min: 10, max: 100, step: 1 }),
  touchWidth: Object.freeze({ min: 12, max: 64, step: 2 }),
  opacity: Object.freeze({ min: 0.1, max: 1, step: 0.05 }),
});

export const DEFAULT_EDGE_HANDLE_SETTINGS: EdgeHandleSettings = Object.freeze({
  position: 50,
  length: 100,
  touchWidth: 24,
  visible: false,
  opacity: 0.5,
});

const DRAWER_MEDIA = '(max-width: 768px)';
const CLICK_SUPPRESS_MS = 400;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(clamp(value, min, max));
}

function clampOpacity(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = clamp(value, EDGE_HANDLE_LIMITS.opacity.min, EDGE_HANDLE_LIMITS.opacity.max);
  return Math.round(clamped * 100) / 100;
}

export function decodeEdgeHandleSettings(value: unknown): EdgeHandleSettings {
  if (!record(value)) return { ...DEFAULT_EDGE_HANDLE_SETTINGS };
  return {
    position: clampInt(value.position, DEFAULT_EDGE_HANDLE_SETTINGS.position, EDGE_HANDLE_LIMITS.position.min, EDGE_HANDLE_LIMITS.position.max),
    length: clampInt(value.length, DEFAULT_EDGE_HANDLE_SETTINGS.length, EDGE_HANDLE_LIMITS.length.min, EDGE_HANDLE_LIMITS.length.max),
    touchWidth: clampInt(value.touchWidth, DEFAULT_EDGE_HANDLE_SETTINGS.touchWidth, EDGE_HANDLE_LIMITS.touchWidth.min, EDGE_HANDLE_LIMITS.touchWidth.max),
    visible: typeof value.visible === 'boolean' ? value.visible : DEFAULT_EDGE_HANDLE_SETTINGS.visible,
    opacity: clampOpacity(value.opacity, DEFAULT_EDGE_HANDLE_SETTINGS.opacity),
  };
}

export function readEdgeHandleSettings(storage: Pick<Storage, 'getItem'>): EdgeHandleSettings {
  try {
    const raw = storage.getItem(EDGE_HANDLE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EDGE_HANDLE_SETTINGS };
    return decodeEdgeHandleSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EDGE_HANDLE_SETTINGS };
  }
}

export function writeEdgeHandleSettings(storage: Pick<Storage, 'setItem'>, value: EdgeHandleSettings): EdgeHandleSettings {
  const clean = decodeEdgeHandleSettings(value);
  try {
    storage.setItem(EDGE_HANDLE_STORAGE_KEY, JSON.stringify(clean));
  } catch {}
  return clean;
}

export function isDefaultEdgeHandleSettings(settings: EdgeHandleSettings): boolean {
  return settings.position === DEFAULT_EDGE_HANDLE_SETTINGS.position
    && settings.length === DEFAULT_EDGE_HANDLE_SETTINGS.length
    && settings.touchWidth === DEFAULT_EDGE_HANDLE_SETTINGS.touchWidth
    && settings.visible === DEFAULT_EDGE_HANDLE_SETTINGS.visible
    && settings.opacity === DEFAULT_EDGE_HANDLE_SETTINGS.opacity;
}

export function computeEdgeHandleZone(
  settings: EdgeHandleSettings,
  viewport: { readonly left: number; readonly top: number; readonly height: number },
): EdgeHandleZone {
  const left = Math.max(0, viewport.left);
  const topOrigin = Math.max(0, viewport.top);
  const usableHeight = Math.max(0, viewport.height);
  const height = usableHeight * (settings.length / 100);
  const top = topOrigin + (usableHeight - height) * (settings.position / 100);
  return {
    left,
    right: left + settings.touchWidth,
    top,
    bottom: top + height,
  };
}

export interface EdgeHandleOptions {
  document: Document;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  open: () => void;
  canOpen?: () => boolean;
  now?: () => number;
}

export interface EdgeHandleController {
  mount(): void;
  dispose(): void;
  readonly settings: EdgeHandleSettings;
  readonly previewing: boolean;
  update(patch: Partial<EdgeHandleSettings>): EdgeHandleSettings;
  reset(): EdgeHandleSettings;
  setPreview(active: boolean): void;
  suppressClick(): void;
  zone(): EdgeHandleZone | null;
  sync(): void;
  renderSettings(container: HTMLElement, signal: AbortSignal): void;
}

/**
 * Configurable mobile sidebar edge grab handle (like Samsung's Edge panel).
 * Owns device-local settings, the JS-created edge pill + preview overlay,
 * tap-to-open on the visible pill, and the live-preview Settings UI.
 */
export function createEdgeHandle(options: EdgeHandleOptions): EdgeHandleController {
  const { document, storage } = options;
  const win = document.defaultView;
  const now = options.now ?? (() => (win?.performance ? win.performance.now() : Date.now()));
  const lifetime = new AbortController();

  let settings: EdgeHandleSettings = readEdgeHandleSettings(storage);
  let mounted = false;
  let disposed = false;
  let previewing = false;
  let clickSuppressedUntil = 0;
  let handleEl: HTMLDivElement | null = null;
  let pillEl: HTMLButtonElement | null = null;
  let bodyObserver: MutationObserver | null = null;
  let refreshSettingsControls: (() => void) | null = null;

  function clearClickSuppression(): void {
    clickSuppressedUntil = 0;
  }

  function isDrawerLayout(): boolean {
    if (!win) return false;
    if (typeof win.matchMedia === 'function') return win.matchMedia(DRAWER_MEDIA).matches;
    return win.innerWidth <= 768;
  }

  function isDrawerOpen(): boolean {
    if (document.body?.classList.contains('sidebar-open')) return true;
    const sidebar = document.getElementById('sidebar');
    return !!sidebar && (sidebar.classList.contains('open') || sidebar.classList.contains('drawer-dragging'));
  }

  function ensureElements(): boolean {
    if (disposed) return false;
    if (handleEl && pillEl && handleEl.isConnected) return true;
    if (!handleEl) {
      const container = document.createElement('div');
      container.id = 'edgeHandle';
      container.className = 'edge-handle';
      container.setAttribute('aria-hidden', 'true');
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.id = 'edgeHandlePill';
      pill.className = 'edge-handle-pill';
      pill.setAttribute('aria-label', 'Open sidebar');
      pill.addEventListener('click', onPillClick, { signal: lifetime.signal });
      pill.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') clearClickSuppression();
      }, { signal: lifetime.signal });
      container.append(pill);
      handleEl = container;
      pillEl = pill;
    }
    const host = document.querySelector('.app') || document.body;
    if (!host) return false;
    host.append(handleEl);
    return true;
  }

  function onPillClick(event: MouseEvent): void {
    if (disposed || previewing || !settings.visible || !isDrawerLayout()) return;
    // Never suppress keyboard activation (Enter/Space on <button> dispatches detail === 0).
    if (event.detail !== 0 && now() < clickSuppressedUntil) {
      clickSuppressedUntil = 0;
      event.preventDefault();
      return;
    }
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || sidebar.classList.contains('open')) return;
    if (options.canOpen && !options.canOpen()) return;
    options.open();
  }

  function sync(): void {
    if (disposed || !mounted) return;
    if (!ensureElements() || !handleEl || !pillEl) return;

    const drawerLayout = isDrawerLayout();
    if (!drawerLayout) {
      handleEl.hidden = true;
      handleEl.inert = true;
      handleEl.style.display = 'none';
      handleEl.style.visibility = 'hidden';
      handleEl.style.pointerEvents = 'none';
      handleEl.classList.remove('edge-handle-preview', 'edge-handle-visible');
      handleEl.setAttribute('aria-hidden', 'true');
      pillEl.hidden = true;
      pillEl.style.display = 'none';
      pillEl.style.pointerEvents = 'none';
      return;
    }

    const lenFrac = settings.length / 100;
    const topFrac = (1 - lenFrac) * (settings.position / 100);
    const usableHeight = '(100% - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))';
    const topCss = `calc(env(safe-area-inset-top, 0px) + ${usableHeight} * ${topFrac.toFixed(6)})`;
    const heightCss = `calc(${usableHeight} * ${lenFrac.toFixed(6)})`;

    const drawerOpen = isDrawerOpen();
    const showPreview = previewing;
    const showPill = settings.visible && (showPreview || !drawerOpen);
    const showContainer = showPreview || showPill;
    const interactivePill = showPill && !showPreview;

    // Inline structural styles guarantee safe version skew even with old cached CSS.
    handleEl.hidden = false;
    handleEl.inert = !interactivePill;
    handleEl.style.display = 'block';
    handleEl.style.position = 'fixed';
    handleEl.style.left = 'env(safe-area-inset-left, 0px)';
    handleEl.style.top = topCss;
    handleEl.style.height = heightCss;
    handleEl.style.width = `${settings.touchWidth}px`;
    handleEl.style.pointerEvents = 'none';
    handleEl.style.visibility = showContainer ? 'visible' : 'hidden';
    handleEl.style.zIndex = showPreview ? '150' : '80';
    handleEl.style.background = showPreview
      ? 'var(--edge-handle-preview-bg, color-mix(in srgb, var(--accent) 16%, transparent))'
      : '';
    handleEl.style.borderRight = showPreview
      ? '1px dashed var(--edge-handle-preview-border, color-mix(in srgb, var(--accent) 65%, transparent))'
      : '';
    handleEl.classList.toggle('edge-handle-preview', showPreview);
    handleEl.classList.toggle('edge-handle-visible', showPill);
    handleEl.setAttribute('aria-hidden', interactivePill ? 'false' : 'true');

    pillEl.hidden = !showPill;
    pillEl.style.display = showPill ? 'block' : 'none';
    pillEl.style.position = 'absolute';
    pillEl.style.left = '0';
    pillEl.style.top = '0';
    pillEl.style.bottom = '0';
    pillEl.style.width = 'var(--edge-handle-pill-width, 6px)';
    pillEl.style.padding = '0';
    pillEl.style.margin = '0';
    pillEl.style.border = '0';
    pillEl.style.borderRadius = 'var(--edge-handle-radius, 0 5px 5px 0)';
    pillEl.style.background = 'var(--edge-handle-bg, var(--accent))';
    pillEl.style.opacity = String(settings.opacity);
    pillEl.style.pointerEvents = interactivePill ? 'auto' : 'none';
  }

  function zone(): EdgeHandleZone | null {
    if (disposed || !win || !isDrawerLayout()) return null;
    if (mounted) sync();
    if (handleEl && handleEl.isConnected) {
      const rect = handleEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const left = Math.max(0, rect.left);
        return {
          left,
          right: left + rect.width,
          top: rect.top,
          bottom: rect.bottom,
        };
      }
    }
    const appRect = document.querySelector('.app')?.getBoundingClientRect();
    const left = appRect ? Math.max(0, appRect.left) : 0;
    const top = appRect ? Math.max(0, appRect.top) : 0;
    const height = appRect && appRect.height > 0 ? appRect.height : (win.innerHeight || 0);
    if (height <= 0) return null;
    return computeEdgeHandleZone(settings, { left, top, height });
  }

  function update(patch: Partial<EdgeHandleSettings>): EdgeHandleSettings {
    if (disposed) return settings;
    settings = writeEdgeHandleSettings(storage, { ...settings, ...patch });
    sync();
    return settings;
  }

  function reset(): EdgeHandleSettings {
    if (disposed) return settings;
    settings = { ...DEFAULT_EDGE_HANDLE_SETTINGS };
    try {
      storage.removeItem(EDGE_HANDLE_STORAGE_KEY);
    } catch {}
    sync();
    return settings;
  }

  function setPreview(active: boolean): void {
    if (disposed) return;
    const next = !!active;
    if (previewing === next) return;
    previewing = next;
    sync();
  }

  function suppressClick(): void {
    clickSuppressedUntil = now() + CLICK_SUPPRESS_MS;
  }

  function onStorage(event: StorageEvent): void {
    if (disposed) return;
    if (event.key !== null && event.key !== EDGE_HANDLE_STORAGE_KEY) return;
    settings = readEdgeHandleSettings(storage);
    sync();
    refreshSettingsControls?.();
  }

  function mount(): void {
    if (disposed || mounted || !win) return;
    mounted = true;
    settings = readEdgeHandleSettings(storage);
    const { signal } = lifetime;
    ensureElements();
    sync();
    // Clear trailing-click suppression on any fresh press so a deliberate next tap is never eaten.
    document.addEventListener('pointerdown', clearClickSuppression, { capture: true, passive: true, signal });
    document.addEventListener('touchstart', clearClickSuppression, { capture: true, passive: true, signal });
    win.addEventListener('resize', sync, { passive: true, signal });
    win.visualViewport?.addEventListener('resize', sync, { passive: true, signal });
    win.addEventListener('storage', onStorage, { signal });
    if (typeof win.matchMedia === 'function') {
      const media = win.matchMedia(DRAWER_MEDIA);
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', sync, { signal });
      }
    }
    if (typeof MutationObserver === 'function' && document.body) {
      bodyObserver = new MutationObserver(() => sync());
      bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function renderSettings(container: HTMLElement, signal: AbortSignal): void {
    if (disposed || signal.aborted) return;
    settings = readEdgeHandleSettings(storage);
    sync();

    container.innerHTML = `<div class="preference-row edge-handle-settings" id="edgeHandleSettings">
      <div class="edge-handle-settings-head">
        <label>
          <strong>Sidebar edge handle</strong>
          <small>Stored on this device. Configures the left-edge swipe zone on mobile screens; adjustments preview live on the left edge.</small>
        </label>
        <button type="button" class="btn-small" id="edgeHandleReset">Reset to default</button>
      </div>
      <div class="edge-handle-controls">
        <label class="edge-handle-toggle" for="edgeHandleVisible">
          <input type="checkbox" id="edgeHandleVisible">
          <span>Show visible handle</span>
        </label>
        <div class="edge-handle-slider-row" id="edgeHandleOpacityRow">
          <div class="edge-handle-slider-head">
            <label for="edgeHandleOpacity">Handle opacity</label>
            <span class="edge-handle-value" id="edgeHandleOpacityValue"></span>
          </div>
          <input type="range" id="edgeHandleOpacity" min="${Math.round(EDGE_HANDLE_LIMITS.opacity.min * 100)}" max="${Math.round(EDGE_HANDLE_LIMITS.opacity.max * 100)}" step="${Math.round(EDGE_HANDLE_LIMITS.opacity.step * 100)}">
        </div>
        <div class="edge-handle-slider-row">
          <div class="edge-handle-slider-head">
            <label for="edgeHandlePosition">Vertical position</label>
            <span class="edge-handle-value" id="edgeHandlePositionValue"></span>
          </div>
          <input type="range" id="edgeHandlePosition" min="${EDGE_HANDLE_LIMITS.position.min}" max="${EDGE_HANDLE_LIMITS.position.max}" step="${EDGE_HANDLE_LIMITS.position.step}">
        </div>
        <div class="edge-handle-slider-row">
          <div class="edge-handle-slider-head">
            <label for="edgeHandleLength">Handle length</label>
            <span class="edge-handle-value" id="edgeHandleLengthValue"></span>
          </div>
          <input type="range" id="edgeHandleLength" min="${EDGE_HANDLE_LIMITS.length.min}" max="${EDGE_HANDLE_LIMITS.length.max}" step="${EDGE_HANDLE_LIMITS.length.step}">
        </div>
        <div class="edge-handle-slider-row">
          <div class="edge-handle-slider-head">
            <label for="edgeHandleTouchWidth">Touch width</label>
            <span class="edge-handle-value" id="edgeHandleTouchWidthValue"></span>
          </div>
          <input type="range" id="edgeHandleTouchWidth" min="${EDGE_HANDLE_LIMITS.touchWidth.min}" max="${EDGE_HANDLE_LIMITS.touchWidth.max}" step="${EDGE_HANDLE_LIMITS.touchWidth.step}">
        </div>
      </div>
    </div>`;

    const visibleInput = container.querySelector<HTMLInputElement>('#edgeHandleVisible')!;
    const opacityRow = container.querySelector<HTMLElement>('#edgeHandleOpacityRow')!;
    const opacityInput = container.querySelector<HTMLInputElement>('#edgeHandleOpacity')!;
    const opacityValue = container.querySelector<HTMLElement>('#edgeHandleOpacityValue')!;
    const positionInput = container.querySelector<HTMLInputElement>('#edgeHandlePosition')!;
    const positionValue = container.querySelector<HTMLElement>('#edgeHandlePositionValue')!;
    const lengthInput = container.querySelector<HTMLInputElement>('#edgeHandleLength')!;
    const lengthValue = container.querySelector<HTMLElement>('#edgeHandleLengthValue')!;
    const touchWidthInput = container.querySelector<HTMLInputElement>('#edgeHandleTouchWidth')!;
    const touchWidthValue = container.querySelector<HTMLElement>('#edgeHandleTouchWidthValue')!;
    const resetButton = container.querySelector<HTMLButtonElement>('#edgeHandleReset')!;

    function syncControls(): void {
      const opacityPct = Math.round(settings.opacity * 100);
      visibleInput.checked = settings.visible;
      opacityRow.hidden = !settings.visible;
      opacityRow.style.display = settings.visible ? '' : 'none';
      opacityInput.value = String(opacityPct);
      opacityValue.textContent = `${opacityPct}%`;
      positionInput.value = String(settings.position);
      positionValue.textContent = settings.length >= 100 ? `${settings.position}% (full height)` : `${settings.position}%`;
      lengthInput.value = String(settings.length);
      lengthValue.textContent = `${settings.length}%`;
      touchWidthInput.value = String(settings.touchWidth);
      touchWidthValue.textContent = `${settings.touchWidth} px`;
      resetButton.disabled = isDefaultEdgeHandleSettings(settings);
    }

    const listener = { signal };
    const startPreview = (): void => {
      if (disposed || signal.aborted) return;
      setPreview(true);
    };

    for (const control of [visibleInput, opacityInput, positionInput, lengthInput, touchWidthInput]) {
      control.addEventListener('pointerdown', startPreview, listener);
    }

    visibleInput.addEventListener('change', () => {
      if (disposed || signal.aborted) return;
      setPreview(true);
      update({ visible: visibleInput.checked });
      syncControls();
    }, listener);

    opacityInput.addEventListener('input', () => {
      if (disposed || signal.aborted) return;
      setPreview(true);
      update({ opacity: Number(opacityInput.value) / 100 });
      syncControls();
    }, listener);

    positionInput.addEventListener('input', () => {
      if (disposed || signal.aborted) return;
      setPreview(true);
      update({ position: Number(positionInput.value) });
      syncControls();
    }, listener);

    lengthInput.addEventListener('input', () => {
      if (disposed || signal.aborted) return;
      setPreview(true);
      update({ length: Number(lengthInput.value) });
      syncControls();
    }, listener);

    touchWidthInput.addEventListener('input', () => {
      if (disposed || signal.aborted) return;
      setPreview(true);
      update({ touchWidth: Number(touchWidthInput.value) });
      syncControls();
    }, listener);

    resetButton.addEventListener('click', () => {
      if (disposed || signal.aborted) return;
      setPreview(true);
      reset();
      syncControls();
    }, listener);

    const syncOpenControls = (): void => {
      if (disposed || signal.aborted || !visibleInput.isConnected) return;
      syncControls();
    };
    refreshSettingsControls = syncOpenControls;

    signal.addEventListener('abort', () => {
      if (refreshSettingsControls === syncOpenControls) refreshSettingsControls = null;
      setPreview(false);
    }, { once: true });

    syncControls();
  }

  function dispose(): void {
    if (disposed) return;
    previewing = false;
    refreshSettingsControls = null;
    disposed = true;
    lifetime.abort();
    bodyObserver?.disconnect();
    bodyObserver = null;
    handleEl?.remove();
    handleEl = null;
    pillEl = null;
  }

  return {
    mount,
    dispose,
    get settings(): EdgeHandleSettings { return settings; },
    get previewing(): boolean { return previewing; },
    update,
    reset,
    setPreview,
    suppressClick,
    zone,
    sync,
    renderSettings,
  };
}
