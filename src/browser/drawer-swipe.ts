/**
 * Mobile sidebar drawer swipe gesture: right-swipe from the left screen edge
 * opens the closed drawer with finger-following translation, and left-swipe on
 * the open drawer or its backdrop closes it.
 *
 * Uses passive touchstart/touchend/touchcancel listeners and attaches a
 * per-gesture touchmove listener only while an eligible single-touch gesture
 * is in flight, so ordinary scrolling pays zero non-passive listener cost.
 *
 * iOS Safari tabs reserve the leftmost bezel (~0–15px) for browser back-swipe
 * and send touchcancel if Safari claims it; standalone PWAs do not. Keeping
 * touchstart passive preserves Safari's browser gesture while the 24px edge
 * zone remains reachable in both modes, and touchcancel always resets cleanly.
 */

import type { EdgeHandleController } from './edge-handle';

export interface DrawerSwipeOptions {
  document: Document;
  open: () => void;
  close: () => void;
  edgeHandle?: Pick<EdgeHandleController, 'zone' | 'suppressClick' | 'sync'>;
  now?: () => number;
}

export interface DrawerSwipeController {
  mount(): void;
  dispose(): void;
  readonly dragging: boolean;
}

const DRAWER_MEDIA = '(max-width: 768px)';
const REDUCED_MOTION_MEDIA = '(prefers-reduced-motion: reduce)';
const EDGE_ZONE_PX = 24;
const LOCK_PX = 10;
const LOCK_SLOPE = 1.5;
const COMMIT_DISTANCE_PX = 50;
const FLICK_MIN_PX = 24;
const FLICK_VELOCITY_PX_MS = 0.35;
const VELOCITY_WINDOW_MS = 100;
const VELOCITY_STALE_MS = 120;
const DRAGGING_CLASS = 'drawer-dragging';

const BLOCKING_OVERLAY_SELECTOR = [
  'dialog[open]',
  '.lightbox-overlay',
  '.modal-overlay',
  '.control-panel.open',
  '.model-dropdown.open',
  '#thinkingDropdown',
  '#commentBubble',
  '#commentListPopover',
  '.context-menu',
  '.vault-panel:not([hidden])',
].join(', ');

const OPEN_EXCLUDED_SELECTOR = [
  'textarea',
  'input',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '.input-area',
  '.composer-box',
  '.terminal-panel',
  '.model-viewer',
  '.file-view-img',
  '.file-view-video-player',
  'canvas',
  'video',
  'audio',
].join(', ');

const CLOSE_EXCLUDED_SELECTOR = [
  'textarea',
  'input',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '.session-drag-handle',
].join(', ');

interface Sample {
  x: number;
  t: number;
}

interface ActiveGesture {
  mode: 'open' | 'close';
  touchId: number;
  target: Element | null;
  startX: number;
  startY: number;
  drawerWidth: number;
  reducedMotion: boolean;
  locked: boolean;
  samples: Sample[];
  events: AbortController;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function isVisible(el: Element, win: Window): boolean {
  const style = win.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function hasBlockingOverlay(document: Document, win: Window): boolean {
  for (const el of Array.from(document.querySelectorAll(BLOCKING_OVERLAY_SELECTOR))) {
    if (isVisible(el, win)) return true;
  }
  return false;
}

function hasTextSelection(win: Window): boolean {
  const selection = win.getSelection?.();
  return !!selection && !selection.isCollapsed && selection.toString().length > 0;
}

export function isDrawerOpenBlocked(document: Document): boolean {
  const win = document.defaultView;
  if (!win) return true;
  return (win.visualViewport?.scale ?? 1) > 1.05 || hasTextSelection(win) || hasBlockingOverlay(document, win);
}

function hasTouchActionNone(target: Element, win: Window): boolean {
  const root = target.ownerDocument.documentElement;
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (win.getComputedStyle(el).touchAction === 'none') return true;
  }
  return false;
}

function canScrollHorizontally(target: Element, mode: 'open' | 'close', win: Window): boolean {
  const body = target.ownerDocument.body;
  const root = target.ownerDocument.documentElement;
  for (let el: Element | null = target; el && el !== body && el !== root; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const ox = win.getComputedStyle(el).overflowX;
    if (ox !== 'auto' && ox !== 'scroll') continue;
    // Dragging right ('open') scrolls left toward 0; dragging left ('close') scrolls right toward max.
    if (mode === 'open') {
      if (el.scrollLeft > 0) return true;
    } else if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) {
      return true;
    }
  }
  return false;
}

function findTouch(list: TouchList, id: number): Touch | null {
  for (let i = 0; i < list.length; i++) {
    const touch = list.item(i);
    if (touch && touch.identifier === id) return touch;
  }
  return null;
}

function computeVelocity(samples: readonly Sample[], endX: number, endT: number): number {
  const latest = samples[samples.length - 1];
  if (!latest || endT - latest.t > VELOCITY_STALE_MS) return 0;
  const refEnd: Sample = endX !== latest.x && endT > latest.t ? { x: endX, t: endT } : latest;
  let anchor = samples.length >= 2 ? samples[samples.length - 2] : samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (refEnd.t - samples[i].t > VELOCITY_WINDOW_MS) break;
    anchor = samples[i];
  }
  const dt = refEnd.t - anchor.t;
  if (dt <= 0) return 0;
  return (refEnd.x - anchor.x) / dt;
}

export function createDrawerSwipe(options: DrawerSwipeOptions): DrawerSwipeController {
  const { document } = options;
  const win = document.defaultView;
  const now = options.now ?? (() => (win?.performance ? win.performance.now() : Date.now()));
  const lifetime = new AbortController();
  let mounted = false;
  let disposed = false;
  let active: ActiveGesture | null = null;

  function isDrawerLayout(): boolean {
    if (!win) return false;
    if (typeof win.matchMedia === 'function') return win.matchMedia(DRAWER_MEDIA).matches;
    return win.innerWidth <= 768;
  }

  function prefersReducedMotion(): boolean {
    if (!win || typeof win.matchMedia !== 'function') return false;
    return win.matchMedia(REDUCED_MOTION_MEDIA).matches;
  }

  function isZoomed(): boolean {
    return (win?.visualViewport?.scale ?? 1) > 1.05;
  }

  function getSidebar(): HTMLElement | null {
    return document.getElementById('sidebar');
  }

  function getOverlay(): HTMLElement | null {
    return document.getElementById('sidebarOverlay');
  }

  function measureDrawerWidth(sidebar: HTMLElement): number {
    const rectWidth = sidebar.getBoundingClientRect().width;
    if (rectWidth > 0) return rectWidth;
    const vw = win?.innerWidth ?? 390;
    return Math.min(Math.max(240, vw * 0.88), 360);
  }

  function applyDragVisual(sidebar: HTMLElement, overlay: HTMLElement | null, progress: number, drawerWidth: number) {
    const clamped = clamp(progress, 0, 1);
    const offsetPx = -drawerWidth * (1 - clamped);
    sidebar.classList.add(DRAGGING_CLASS);
    sidebar.style.transition = 'none';
    sidebar.style.transform = `translateX(${offsetPx.toFixed(1)}px)`;
    if (overlay) {
      overlay.classList.add(DRAGGING_CLASS);
      overlay.style.display = 'block';
      overlay.style.zIndex = '190';
      overlay.style.transition = 'none';
      overlay.style.opacity = clamped.toFixed(3);
    }
    options.edgeHandle?.sync();
  }

  function clearDragVisual() {
    const sidebar = getSidebar();
    if (sidebar) {
      sidebar.classList.remove(DRAGGING_CLASS);
      sidebar.style.transition = '';
      sidebar.style.transform = '';
    }
    const overlay = getOverlay();
    if (overlay) {
      overlay.classList.remove(DRAGGING_CLASS);
      overlay.style.display = '';
      overlay.style.zIndex = '';
      overlay.style.transition = '';
      overlay.style.opacity = '';
    }
    options.edgeHandle?.sync();
  }

  function cancelGesture() {
    if (!active) return;
    const gesture = active;
    active = null;
    gesture.events.abort();
    if (gesture.locked) {
      options.edgeHandle?.suppressClick();
      clearDragVisual();
    }
  }

  function recordSample(gesture: ActiveGesture, x: number, t: number) {
    gesture.samples.push({ x, t });
    while (gesture.samples.length > 6 && t - gesture.samples[0].t > VELOCITY_WINDOW_MS) {
      gesture.samples.shift();
    }
  }

  function onTouchMove(event: TouchEvent) {
    if (disposed || !active || !win) return;
    // Once the browser claims the touch sequence for native scrolling, touchmove
    // is no longer cancelable; abort immediately so the drawer never steals it.
    if (!event.cancelable || event.touches.length !== 1 || !isDrawerLayout()) {
      cancelGesture();
      return;
    }
    const touch = findTouch(event.touches, active.touchId);
    if (!touch) {
      cancelGesture();
      return;
    }
    const dx = touch.clientX - active.startX;
    const dy = touch.clientY - active.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const t = now();

    if (!active.locked) {
      // Abort promptly on vertical movement or movement in the wrong horizontal direction.
      if (absDy >= LOCK_PX && absDy >= absDx) {
        cancelGesture();
        return;
      }
      if (active.mode === 'open' && dx <= -LOCK_PX) {
        cancelGesture();
        return;
      }
      if (active.mode === 'close' && dx >= LOCK_PX) {
        cancelGesture();
        return;
      }
      recordSample(active, touch.clientX, t);
      const directionalDx = active.mode === 'open' ? dx : -dx;
      if (directionalDx < LOCK_PX || absDx <= absDy * LOCK_SLOPE) return;
      if (active.target && canScrollHorizontally(active.target, active.mode, win)) {
        cancelGesture();
        return;
      }
      active.locked = true;
    } else {
      recordSample(active, touch.clientX, t);
    }

    if (event.cancelable) event.preventDefault();

    if (!active.reducedMotion) {
      const sidebar = getSidebar();
      if (!sidebar) {
        cancelGesture();
        return;
      }
      const progress = active.mode === 'open'
        ? dx / active.drawerWidth
        : 1 + dx / active.drawerWidth;
      applyDragVisual(sidebar, getOverlay(), progress, active.drawerWidth);
    }
  }

  function onTouchEnd(event: TouchEvent) {
    if (disposed || !active) return;
    const touch = findTouch(event.changedTouches, active.touchId);
    if (!touch) return;
    const gesture = active;
    active = null;
    gesture.events.abort();
    if (!gesture.locked) return;
    options.edgeHandle?.suppressClick();

    const endX = touch.clientX;
    const endT = now();
    const dx = endX - gesture.startX;
    const velocity = computeVelocity(gesture.samples, endX, endT);
    clearDragVisual();

    if (!isDrawerLayout()) return;
    if (gesture.mode === 'open') {
      const flickBack = velocity <= -FLICK_VELOCITY_PX_MS;
      const shouldOpen = !flickBack && (
        dx >= COMMIT_DISTANCE_PX || (velocity >= FLICK_VELOCITY_PX_MS && dx >= FLICK_MIN_PX)
      );
      if (shouldOpen) options.open();
    } else {
      const flickBack = velocity >= FLICK_VELOCITY_PX_MS;
      const shouldClose = !flickBack && (
        -dx >= COMMIT_DISTANCE_PX || (velocity <= -FLICK_VELOCITY_PX_MS && -dx >= FLICK_MIN_PX)
      );
      if (shouldClose) options.close();
    }
  }

  function onTouchCancel(event: TouchEvent) {
    if (!active) return;
    if (findTouch(event.changedTouches, active.touchId) || event.touches.length === 0) {
      cancelGesture();
    }
  }

  function onTouchStart(event: TouchEvent) {
    if (disposed || !win) return;
    if (event.touches.length !== 1) {
      cancelGesture();
      return;
    }
    if (!isDrawerLayout() || isZoomed()) return;
    const sidebar = getSidebar();
    if (!sidebar) return;

    const touch = event.touches.item(0);
    if (!touch) return;
    const target = elementFromTarget(event.target);
    const isOpen = sidebar.classList.contains('open');

    if (hasTextSelection(win) || hasBlockingOverlay(document, win)) return;
    if (target && hasTouchActionNone(target, win)) return;

    let mode: 'open' | 'close';
    if (!isOpen) {
      const configuredZone = options.edgeHandle?.zone();
      if (configuredZone) {
        if (touch.clientX < configuredZone.left || touch.clientX > configuredZone.right) return;
        if (touch.clientY < configuredZone.top || touch.clientY > configuredZone.bottom) return;
      } else {
        const appRect = document.querySelector('.app')?.getBoundingClientRect();
        const edgeOrigin = appRect ? Math.max(0, appRect.left) : 0;
        const offsetFromEdge = touch.clientX - edgeOrigin;
        if (offsetFromEdge < 0 || offsetFromEdge > EDGE_ZONE_PX) return;
      }
      if (target && (target.closest(OPEN_EXCLUDED_SELECTOR) || canScrollHorizontally(target, 'open', win))) return;
      mode = 'open';
    } else {
      const overlay = getOverlay();
      const onDrawerOrOverlay = !!target && (sidebar.contains(target) || (!!overlay && overlay.contains(target)));
      if (!onDrawerOrOverlay) return;
      if (target.closest(CLOSE_EXCLUDED_SELECTOR) || canScrollHorizontally(target, 'close', win)) return;
      mode = 'close';
    }

    cancelGesture();
    const events = new AbortController();
    const t = now();
    active = {
      mode,
      touchId: touch.identifier,
      target,
      startX: touch.clientX,
      startY: touch.clientY,
      drawerWidth: measureDrawerWidth(sidebar),
      reducedMotion: prefersReducedMotion(),
      locked: false,
      samples: [{ x: touch.clientX, t }],
      events,
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false, signal: events.signal });
    document.addEventListener('touchend', onTouchEnd, { passive: true, signal: events.signal });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true, signal: events.signal });
  }

  function mount() {
    if (disposed || mounted || !win) return;
    mounted = true;
    const { signal } = lifetime;
    document.addEventListener('touchstart', onTouchStart, { passive: true, signal });
    win.addEventListener('resize', cancelGesture, { passive: true, signal });
    win.addEventListener('blur', cancelGesture, { passive: true, signal });
    document.addEventListener('visibilitychange', cancelGesture, { passive: true, signal });
  }

  function dispose() {
    if (disposed) return;
    cancelGesture();
    disposed = true;
    lifetime.abort();
  }

  return {
    mount,
    dispose,
    get dragging() { return !!active?.locked; },
  };
}
