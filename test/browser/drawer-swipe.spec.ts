import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

test.use({ hasTouch: true, isMobile: true });

interface TouchPoint {
  x: number;
  y: number;
}

async function dispatchTouchSwipe(
  page: Page,
  points: readonly TouchPoint[],
  options: { stepDelayMs?: number; pauseBeforeEndMs?: number; cancel?: boolean; holdOpen?: boolean } = {},
) {
  const cdp = await page.context().newCDPSession(page);
  const { stepDelayMs = 12, pauseBeforeEndMs = 0, cancel = false, holdOpen = false } = options;
  try {
    const first = points[0];
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: first.x, y: first.y, id: 1 }],
    });
    for (let i = 1; i < points.length; i++) {
      if (stepDelayMs > 0) await page.waitForTimeout(stepDelayMs);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: points[i].x, y: points[i].y, id: 1 }],
      });
    }
    if (holdOpen) {
      return {
        async finish(cancelEnd = false) {
          try {
            if (pauseBeforeEndMs > 0) await page.waitForTimeout(pauseBeforeEndMs);
            await cdp.send('Input.dispatchTouchEvent', {
              type: cancelEnd ? 'touchCancel' : 'touchEnd',
              touchPoints: [],
            });
          } finally {
            await cdp.detach();
          }
        },
      };
    }
    if (pauseBeforeEndMs > 0) await page.waitForTimeout(pauseBeforeEndMs);
    await cdp.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
    await cdp.detach();
    return null;
  } catch (error) {
    await cdp.detach().catch(() => {});
    throw error;
  }
}

async function setMobileViewport(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  // Resizing from desktop triggers .sidebar's 250ms slide-out transition; wait
  // for it to settle off-screen so touches hit #messages rather than the drawer.
  await expect.poll(() => page.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    return sidebar ? sidebar.getBoundingClientRect().right : 0;
  })).toBeLessThanOrEqual(0);
}

async function drawerState(page: Page) {
  return page.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button[data-toggle-sidebar]'));
    return {
      open: !!sidebar?.classList.contains('open'),
      dragging: !!sidebar?.classList.contains('drawer-dragging'),
      overlayActive: !!overlay?.classList.contains('active'),
      overlayDragging: !!overlay?.classList.contains('drawer-dragging'),
      bodyOpen: document.body.classList.contains('sidebar-open'),
      inlineTransform: sidebar?.style.transform ?? '',
      inlineTransition: sidebar?.style.transition ?? '',
      inlineOverlayOpacity: overlay?.style.opacity ?? '',
      inlineOverlayDisplay: overlay?.style.display ?? '',
      ariaExpanded: [...new Set(buttons.map(btn => btn.getAttribute('aria-expanded')))],
    };
  });
}

test('edge swipe opens drawer following the finger, snaps cleanly, and swipe-left closes it', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  expect(await drawerState(page)).toEqual({
    open: false,
    dragging: false,
    overlayActive: false,
    overlayDragging: false,
    bodyOpen: false,
    inlineTransform: '',
    inlineTransition: '',
    inlineOverlayOpacity: '',
    inlineOverlayDisplay: '',
    ariaExpanded: ['false'],
  });

  // Start inside the left edge zone and hold mid-drag to confirm finger-following transform.
  const held = await dispatchTouchSwipe(page, [
    { x: 10, y: 400 },
    { x: 30, y: 401 },
    { x: 130, y: 403 },
  ], { holdOpen: true });

  const midDrag = await drawerState(page);
  expect(midDrag.dragging).toBe(true);
  expect(midDrag.overlayDragging).toBe(true);
  expect(midDrag.inlineTransform).toMatch(/^translateX\(-\d+(?:\.\d+)?px\)$/);
  expect(parseFloat(midDrag.inlineOverlayOpacity)).toBeGreaterThan(0.1);
  expect(parseFloat(midDrag.inlineOverlayOpacity)).toBeLessThan(1);

  await held!.finish(false);

  expect(await drawerState(page)).toEqual({
    open: true,
    dragging: false,
    overlayActive: true,
    overlayDragging: false,
    bodyOpen: true,
    inlineTransform: '',
    inlineTransition: '',
    inlineOverlayOpacity: '',
    inlineOverlayDisplay: '',
    ariaExpanded: ['true'],
  });

  // Swipe left on the open drawer to close it.
  await dispatchTouchSwipe(page, [
    { x: 220, y: 400 },
    { x: 160, y: 402 },
    { x: 80, y: 403 },
  ]);

  expect(await drawerState(page)).toEqual({
    open: false,
    dragging: false,
    overlayActive: false,
    overlayDragging: false,
    bodyOpen: false,
    inlineTransform: '',
    inlineTransition: '',
    inlineOverlayOpacity: '',
    inlineOverlayDisplay: '',
    ariaExpanded: ['false'],
  });

  // Fast flick from the left edge also opens (dx < 50px but high velocity).
  await dispatchTouchSwipe(page, [
    { x: 8, y: 400 },
    { x: 26, y: 401 },
    { x: 44, y: 401 },
  ], { stepDelayMs: 0 });
  expect((await drawerState(page)).open).toBe(true);

  // Swipe left on the exposed backdrop closes the drawer too.
  await dispatchTouchSwipe(page, [
    { x: 375, y: 400 },
    { x: 330, y: 401 },
    { x: 260, y: 402 },
  ]);
  expect((await drawerState(page)).open).toBe(false);
});

test('short slow edge nudge snaps closed and touchcancel resets cleanly', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  // Short drag with pause before release stays closed.
  await dispatchTouchSwipe(page, [
    { x: 8, y: 400 },
    { x: 22, y: 401 },
    { x: 34, y: 401 },
  ], { stepDelayMs: 40, pauseBeforeEndMs: 160 });
  const afterNudge = await drawerState(page);
  expect(afterNudge.open).toBe(false);
  expect(afterNudge.dragging).toBe(false);
  expect(afterNudge.inlineTransform).toBe('');

  // Browser-initiated touchcancel (e.g. iOS Safari bezel back-swipe) never snaps open.
  await dispatchTouchSwipe(page, [
    { x: 6, y: 400 },
    { x: 40, y: 401 },
    { x: 140, y: 402 },
  ], { cancel: true });
  const afterCancel = await drawerState(page);
  expect(afterCancel.open).toBe(false);
  expect(afterCancel.dragging).toBe(false);
  expect(afterCancel.inlineTransform).toBe('');
  expect(afterCancel.inlineOverlayOpacity).toBe('');
});

test('swipe starting mid-screen or outside edge zone does not open drawer', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  await dispatchTouchSwipe(page, [
    { x: 140, y: 400 },
    { x: 210, y: 401 },
    { x: 300, y: 402 },
  ]);
  expect((await drawerState(page)).open).toBe(false);

  // Just outside the 24px edge zone.
  await dispatchTouchSwipe(page, [
    { x: 32, y: 400 },
    { x: 100, y: 401 },
    { x: 200, y: 402 },
  ]);
  expect((await drawerState(page)).open).toBe(false);
});

test('vertical scroll near the left edge scrolls transcript and does not open drawer', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  await page.evaluate(() => {
    const messages = fixtureElement(document.getElementById('messages'), '#messages');
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('p');
      p.style.margin = '18px 0';
      p.textContent = `Vertical scroll filler line ${i} with enough height to scroll the transcript.`;
      messages.append(p);
    }
    messages.scrollTop = 300;
  });

  const beforeTop = await page.evaluate(() => fixtureElement(document.getElementById('messages'), '#messages').scrollTop);
  expect(beforeTop).toBeGreaterThan(200);

  await dispatchTouchSwipe(page, [
    { x: 12, y: 500 },
    { x: 15, y: 470 },
    { x: 18, y: 380 },
    { x: 20, y: 260 },
  ]);

  const afterTop = await page.evaluate(() => fixtureElement(document.getElementById('messages'), '#messages').scrollTop);
  expect((await drawerState(page)).open).toBe(false);
  expect(afterTop).toBeGreaterThan(beforeTop);
});

test('curved diagonal scroll across populated open drawer scrolls list without moving or closing drawer', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  await page.locator('.header-menu-btn').click();
  await expect.poll(() => page.evaluate(() =>
    fixtureElement(document.getElementById('sidebar'), '#sidebar').getBoundingClientRect().left)).toBe(0);

  await page.evaluate(() => {
    const list = fixtureElement(document.getElementById('sessionList'), '#sessionList');
    for (let i = 0; i < 35; i++) {
      const item = document.createElement('div');
      item.className = 'session-item';
      item.textContent = `Populated session row ${i}`;
      list.append(item);
    }
    list.scrollTop = 0;
  });

  // Record whether any drag transform or class is ever applied to #sidebar during the gesture.
  await page.evaluate(() => {
    const sidebar = fixtureElement(document.getElementById('sidebar'), '#sidebar');
    const seen = { transform: false, dragging: false };
    Reflect.set(window, '__drawerDragObserved', seen);
    const observer = new MutationObserver(() => {
      if (sidebar.style.transform) seen.transform = true;
      if (sidebar.classList.contains('drawer-dragging')) seen.dragging = true;
    });
    observer.observe(sidebar, { attributes: true, attributeFilter: ['style', 'class'] });
    Reflect.set(window, '__drawerDragObserver', observer);
  });

  await dispatchTouchSwipe(page, [
    { x: 220, y: 520 },
    { x: 192, y: 495 },
    { x: 167, y: 480 },
    { x: 120, y: 465 },
    { x: 90, y: 460 },
  ]);

  const result = await page.evaluate(() => {
    const observer = Reflect.get(window, '__drawerDragObserver');
    if (observer instanceof MutationObserver) observer.disconnect();
    const observed = Reflect.get(window, '__drawerDragObserved');
    const list = fixtureElement(document.getElementById('sessionList'), '#sessionList');
    return { scrollTop: list.scrollTop, observed };
  });

  expect(result.scrollTop).toBeGreaterThan(0);
  expect(result.observed).toEqual({ transform: false, dragging: false });
  const state = await drawerState(page);
  expect(state.open).toBe(true);
  expect(state.dragging).toBe(false);
  expect(state.inlineTransform).toBe('');
});

test('horizontal scroll in a code block is not hijacked in either direction', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  const preBox = await page.evaluate(() => {
    const messages = fixtureElement(document.getElementById('messages'), '#messages');
    const msg = document.createElement('div');
    msg.className = 'message assistant';
    msg.innerHTML = `<div class="message-content"><div class="code-block"><pre id="wideCodePre"><code>${'const wideLineSegment = 1234567890; '.repeat(12)}</code></pre></div></div>`;
    messages.prepend(msg);
    messages.scrollTop = 0;
    const pre = fixtureElement(document.getElementById('wideCodePre'), '#wideCodePre');
    const rect = pre.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollWidth: pre.scrollWidth, clientWidth: pre.clientWidth };
  });
  expect(preBox.scrollWidth).toBeGreaterThan(preBox.clientWidth + 100);
  const midY = Math.round(preBox.y + preBox.height / 2);

  // Drag right-to-left across the code block to scroll right.
  await dispatchTouchSwipe(page, [
    { x: 260, y: midY },
    { x: 180, y: midY },
    { x: 60, y: midY },
  ]);
  const scrolledRight = await page.evaluate(() => fixtureElement(document.getElementById('wideCodePre'), '#wideCodePre').scrollLeft);
  expect(scrolledRight).toBeGreaterThan(40);
  expect((await drawerState(page)).open).toBe(false);

  // Now drag left-to-right starting inside the 24px left edge over the scrolled code block.
  const edgeInsidePre = Math.min(20, Math.max(Math.ceil(preBox.x + 4), 14));
  await dispatchTouchSwipe(page, [
    { x: edgeInsidePre, y: midY },
    { x: 90, y: midY },
    { x: 210, y: midY },
  ]);
  const scrolledBack = await page.evaluate(() => fixtureElement(document.getElementById('wideCodePre'), '#wideCodePre').scrollLeft);
  expect((await drawerState(page)).open).toBe(false);
  expect(scrolledBack).toBeLessThan(scrolledRight);
});

test.describe('composer exclusion on live session', () => {
  test.use({ liveSessions: true });

  test('composer textarea near the left edge is not hijacked', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await setMobileViewport(page);

    const composerBox = await page.locator('#promptInput').boundingBox();
    expect(composerBox).not.toBeNull();
    const composerY = Math.round(composerBox!.y + composerBox!.height / 2);
    await dispatchTouchSwipe(page, [
      { x: Math.min(20, Math.max(Math.ceil(composerBox!.x + 4), 12)), y: composerY },
      { x: 100, y: composerY },
      { x: 200, y: composerY },
    ]);
    expect((await drawerState(page)).open).toBe(false);
  });
});

test('text selection, lightbox, modal, GLB viewer, and multi-touch are not hijacked', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  // 1. Active text selection (must run at scale 1 so isZoomed() does not mask it).
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBeLessThanOrEqual(1.01);
  await page.evaluate(() => {
    const content = document.querySelector('#messages .message-content');
    if (content?.firstChild) {
      const range = document.createRange();
      range.selectNodeContents(content);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });
  await dispatchTouchSwipe(page, [
    { x: 10, y: 400 },
    { x: 80, y: 400 },
    { x: 180, y: 400 },
  ]);
  expect((await drawerState(page)).open).toBe(false);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());

  // 2. Open lightbox (image/diagram viewer).
  await page.evaluate(() => {
    const lb = document.createElement('div');
    lb.className = 'lightbox-overlay';
    lb.id = 'testLightbox';
    document.body.append(lb);
  });
  await dispatchTouchSwipe(page, [
    { x: 10, y: 400 },
    { x: 80, y: 400 },
    { x: 180, y: 400 },
  ]);
  expect(page.url()).toContain(fleet.self.base);
  expect((await drawerState(page)).open).toBe(false);
  await page.evaluate(() => document.getElementById('testLightbox')?.remove());

  // 3. Open modal overlay.
  await page.evaluate(() => {
    fixtureElement(document.getElementById('settingsModal'), '#settingsModal').style.display = 'flex';
  });
  await dispatchTouchSwipe(page, [
    { x: 10, y: 400 },
    { x: 80, y: 400 },
    { x: 180, y: 400 },
  ]);
  expect((await drawerState(page)).open).toBe(false);
  await page.evaluate(() => {
    fixtureElement(document.getElementById('settingsModal'), '#settingsModal').style.display = 'none';
  });

  // 4. GLB 3D model viewer stage.
  const viewerY = await page.evaluate(() => {
    const viewer = document.createElement('div');
    viewer.className = 'model-viewer';
    viewer.id = 'testModelViewer';
    viewer.style.cssText = 'position:fixed;left:0;top:300px;width:100%;height:200px;z-index:10;';
    viewer.innerHTML = '<div class="model-viewer-stage" style="width:100%;height:100%"><canvas width="390" height="200"></canvas></div>';
    document.body.append(viewer);
    return Math.round(viewer.getBoundingClientRect().top + 80);
  });
  await dispatchTouchSwipe(page, [
    { x: 10, y: viewerY },
    { x: 80, y: viewerY },
    { x: 180, y: viewerY },
  ]);
  expect((await drawerState(page)).open).toBe(false);
  await page.evaluate(() => document.getElementById('testModelViewer')?.remove());

  // 5. Multi-touch gesture starting at left edge (runs last because Chromium's
  // gesture recognizer may apply pinch zoom on 2-finger CDP touch moves).
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBeLessThanOrEqual(1.01);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 10, y: 400, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 10, y: 400, id: 1 }, { x: 200, y: 420, id: 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 150, y: 400, id: 1 }, { x: 280, y: 420, id: 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
  expect((await drawerState(page)).open).toBe(false);
});

test('first slop-sized horizontal touchmove is claimed before the drag lock so native scrolling cannot take it', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  // Chrome dispatches only the first touchmove past its slop as cancelable; an
  // unconsumed small first move (dx 8 < LOCK_PX) used to hand the gesture to scrolling.
  const prevented = await page.evaluate(() => {
    const target = document.elementFromPoint(10, 400) ?? document.body;
    const touchAt = (x: number, y: number) => new Touch({ identifier: 7, target, clientX: x, clientY: y });
    const fire = (type: string, touches: Touch[], changed: Touch[]) => {
      const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: changed });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const start = touchAt(10, 400);
    fire('touchstart', [start], [start]);
    const firstMove = touchAt(18, 401);
    const result = fire('touchmove', [firstMove], [firstMove]);
    const end = touchAt(18, 401);
    fire('touchend', [], [end]);
    return result;
  });
  expect(prevented).toBe(true);
  expect((await drawerState(page)).open).toBe(false);
});

test('a drawer-list scroll that starts with a short leftward drift is not claimed', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  await page.locator('.header-menu-btn').click();
  await expect.poll(() => page.evaluate(() =>
    fixtureElement(document.getElementById('sidebar'), '#sidebar').getBoundingClientRect().left)).toBe(0);

  // Claiming this first cancelable move would leave the list unable to scroll
  // once the finger turns vertical.
  const prevented = await page.evaluate(() => {
    const list = fixtureElement(document.getElementById('sessionList'), '#sessionList');
    for (let i = 0; i < 35; i++) {
      const item = document.createElement('div');
      item.className = 'session-item';
      item.textContent = `Populated session row ${i}`;
      list.append(item);
    }
    const target = document.elementFromPoint(150, 400) ?? list;
    const touchAt = (x: number, y: number) => new Touch({ identifier: 9, target, clientX: x, clientY: y });
    const fire = (type: string, touches: Touch[], changed: Touch[]) => {
      const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: changed });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const start = touchAt(150, 400);
    fire('touchstart', [start], [start]);
    const firstMove = touchAt(144, 398);
    const result = fire('touchmove', [firstMove], [firstMove]);
    const end = touchAt(144, 398);
    fire('touchend', [], [end]);
    return result;
  });
  expect(prevented).toBe(false);
  expect((await drawerState(page)).open).toBe(true);
});

test('a resting palm or thumb elsewhere on the screen does not block the edge swipe', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  const palm = { x: 300, y: 760, id: 9 };
  const cdp = await page.context().newCDPSession(page);
  try {
    // Palm already down before the edge swipe starts.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [palm] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [palm, { x: 10, y: 400, id: 1 }] });
    for (const x of [30, 70, 130, 180]) {
      await page.waitForTimeout(12);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [palm, { x, y: 401, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [palm] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
  expect((await drawerState(page)).open).toBe(true);

  await page.evaluate(() => fixtureApp.features.sidebarQuery.close());
  await setMobileViewport(page);

  const cdp2 = await page.context().newCDPSession(page);
  try {
    // A stray touch landing mid-swipe stays ignored while it rests still.
    await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 10, y: 400, id: 1 }] });
    await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 10, y: 400, id: 1 }, palm] });
    for (const x of [30, 70, 130, 180]) {
      await page.waitForTimeout(12);
      await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 401, id: 1 }, palm] });
    }
    await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [palm] });
    await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp2.detach();
  }
  expect((await drawerState(page)).open).toBe(true);
});

test('hamburger buttons keep opening and closing identically across empty state and session header', async ({ page, fleet }) => {
  await setMobileViewport(page);

  // Empty state hamburger.
  await page.locator('.empty-menu-btn').click();
  expect((await drawerState(page)).open).toBe(true);
  expect((await drawerState(page)).ariaExpanded).toEqual(['true']);

  // Tap exposed overlay strip to close.
  const overlay = await page.locator('#sidebarOverlay').boundingBox();
  expect(overlay).not.toBeNull();
  await page.locator('#sidebarOverlay').click({ position: { x: overlay!.width - 8, y: overlay!.height / 2 } });
  expect((await drawerState(page)).open).toBe(false);
  expect((await drawerState(page)).ariaExpanded).toEqual(['false']);

  // Session header hamburger.
  await fleet.select(fleet.self);
  await page.locator('.header-menu-btn').click();
  expect((await drawerState(page)).open).toBe(true);
  expect((await drawerState(page)).ariaExpanded).toEqual(['true']);

  await page.locator('#sidebarOverlay').click({ position: { x: overlay!.width - 8, y: overlay!.height / 2 } });
  expect((await drawerState(page)).open).toBe(false);
  expect((await drawerState(page)).ariaExpanded).toEqual(['false']);
});

test('prefers-reduced-motion suppresses drag transform and CSS transition while keeping swipe working', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setMobileViewport(page);

  const transitionDuration = await page.evaluate(() =>
    getComputedStyle(fixtureElement(document.getElementById('sidebar'), '#sidebar')).transitionDuration);
  expect(transitionDuration).toBe('0s');

  const held = await dispatchTouchSwipe(page, [
    { x: 10, y: 400 },
    { x: 40, y: 401 },
    { x: 140, y: 402 },
  ], { holdOpen: true });

  const midDrag = await drawerState(page);
  expect(midDrag.dragging).toBe(false);
  expect(midDrag.inlineTransform).toBe('');
  expect(midDrag.inlineOverlayOpacity).toBe('');

  await held!.finish(false);
  expect((await drawerState(page)).open).toBe(true);

  await dispatchTouchSwipe(page, [
    { x: 220, y: 400 },
    { x: 140, y: 401 },
    { x: 80, y: 402 },
  ]);
  expect((await drawerState(page)).open).toBe(false);
});

test('desktop width is unaffected by edge touch swipes', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.setViewportSize({ width: 1280, height: 900 });

  await dispatchTouchSwipe(page, [
    { x: 10, y: 400 },
    { x: 80, y: 401 },
    { x: 180, y: 402 },
  ]);

  const state = await drawerState(page);
  expect(state.open).toBe(false);
  expect(state.dragging).toBe(false);
  expect(state.overlayActive).toBe(false);
  expect(state.bodyOpen).toBe(false);
  expect(state.inlineTransform).toBe('');
});

test('version skew: missing overlay or sidebar markup never throws', async ({ page, fleet }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  // Cached old HTML without #sidebarOverlay still opens #sidebar cleanly.
  await page.evaluate(() => document.getElementById('sidebarOverlay')?.remove());
  await dispatchTouchSwipe(page, [
    { x: 10, y: 400 },
    { x: 70, y: 401 },
    { x: 150, y: 402 },
  ]);
  expect((await drawerState(page)).open).toBe(true);

  // Cached/stripped DOM without #sidebar does not throw, and close() still clears overlay/body/aria state.
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.id = 'sidebarOverlay';
    overlay.className = 'sidebar-overlay active';
    document.body.append(overlay);
    document.getElementById('sidebar')?.remove();
    fixtureApp.features.sidebarQuery.toggle();
    fixtureApp.features.sidebarQuery.open();
    fixtureApp.features.sidebarQuery.close();
  });
  const afterMissingClose = await drawerState(page);
  expect(afterMissingClose.overlayActive).toBe(false);
  expect(afterMissingClose.bodyOpen).toBe(false);
  expect(afterMissingClose.ariaExpanded).toEqual(['false']);
  await dispatchTouchSwipe(page, [
    { x: 10, y: 400 },
    { x: 90, y: 401 },
    { x: 160, y: 402 },
  ]);
  expect(errors).toEqual([]);
});

export {};
