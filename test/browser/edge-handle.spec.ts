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
  options: { stepDelayMs?: number; pauseBeforeEndMs?: number; cancel?: boolean } = {},
) {
  const cdp = await page.context().newCDPSession(page);
  const { stepDelayMs = 12, pauseBeforeEndMs = 0, cancel = false } = options;
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
    if (pauseBeforeEndMs > 0) await page.waitForTimeout(pauseBeforeEndMs);
    await cdp.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function setMobileViewport(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    return sidebar ? sidebar.getBoundingClientRect().right : 0;
  })).toBeLessThanOrEqual(0);
}

async function isDrawerOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.getElementById('sidebar')?.classList.contains('open'));
}

async function setRangeValue(page: Page, selector: string, value: number) {
  await page.locator(selector).evaluate((el, next) => {
    const input = el as HTMLInputElement;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('defaults match legacy invisible full-height 24px zone and restore vertical pull-to-refresh', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  const state = await page.evaluate(() => {
    const htmlStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const handle = document.getElementById('edgeHandle');
    const pill = document.getElementById('edgeHandlePill');
    return {
      settings: fixtureApp.features.edgeHandle.settings,
      zone: fixtureApp.features.edgeHandle.zone(),
      htmlOverscrollX: htmlStyle.overscrollBehaviorX,
      htmlOverscrollY: htmlStyle.overscrollBehaviorY,
      bodyOverscrollX: bodyStyle.overscrollBehaviorX,
      bodyOverscrollY: bodyStyle.overscrollBehaviorY,
      handleVisibility: handle ? getComputedStyle(handle).visibility : null,
      pillHidden: pill ? pill.hidden : null,
    };
  });

  expect(state.settings).toEqual({
    position: 50,
    length: 100,
    touchWidth: 24,
    visible: false,
    opacity: 0.5,
  });
  expect(state.zone).toEqual({ left: 0, right: 24, top: 0, bottom: 844 });
  expect(state.handleVisibility).toBe('hidden');
  expect(state.pillHidden).toBe(true);
  expect(state.htmlOverscrollX).toBe('none');
  expect(state.htmlOverscrollY).toBe('auto');
  expect(state.bodyOverscrollX).toBe('none');
  expect(state.bodyOverscrollY).toBe('auto');
});

test('trusted-touch swipe opens only from inside configured position, length and touch width', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  // Configure via the real Settings modal at 390x844.
  await page.evaluate(() => fixtureApp.features.displayPreferences.open());
  await page.locator('#edgeHandleVisible').check();
  await setRangeValue(page, '#edgeHandlePosition', 20);
  await setRangeValue(page, '#edgeHandleLength', 25);
  await setRangeValue(page, '#edgeHandleTouchWidth', 44);
  await setRangeValue(page, '#edgeHandleOpacity', 65);
  await page.locator('#settingsModal [data-app-click="closeSettingsModal"]').click();

  const pill = page.locator('#edgeHandlePill');
  await expect(pill).toBeVisible();
  const rect = await page.evaluate(() => {
    const handle = fixtureElement(document.getElementById('edgeHandle'), '#edgeHandle');
    const pillEl = fixtureElement(document.getElementById('edgeHandlePill'), '#edgeHandlePill');
    const box = handle.getBoundingClientRect();
    const pillBox = pillEl.getBoundingClientRect();
    return {
      top: box.top,
      bottom: box.bottom,
      height: box.height,
      width: box.width,
      pillWidth: pillBox.width,
      opacity: getComputedStyle(pillEl).opacity,
    };
  });

  // 25% of 844 = 211px; top = (844 - 211) * 0.20 = 126.6px.
  expect(rect.height).toBeCloseTo(211, 0);
  expect(rect.top).toBeCloseTo(126.6, 0);
  expect(rect.width).toBeCloseTo(44, 0);
  expect(rect.pillWidth).toBeGreaterThanOrEqual(4);
  expect(rect.pillWidth).toBeLessThanOrEqual(10);
  expect(parseFloat(rect.opacity)).toBeCloseTo(0.65, 2);

  const midY = Math.round((rect.top + rect.bottom) / 2);

  // 1. Inside configured zone (x=36 > legacy 24px, <= configured 44px; y inside vertical range) -> opens.
  await dispatchTouchSwipe(page, [
    { x: 36, y: midY },
    { x: 96, y: midY + 1 },
    { x: 180, y: midY + 2 },
  ]);
  expect(await isDrawerOpen(page)).toBe(true);
  // While open, handle hides cleanly.
  await expect(pill).toBeHidden();

  // Close drawer with swipe-left.
  await dispatchTouchSwipe(page, [
    { x: 220, y: midY },
    { x: 140, y: midY + 1 },
    { x: 60, y: midY + 2 },
  ]);
  expect(await isDrawerOpen(page)).toBe(false);
  await expect(pill).toBeVisible();

  // 2. Above configured vertical zone -> does NOT open.
  await dispatchTouchSwipe(page, [
    { x: 10, y: Math.max(10, Math.round(rect.top - 40)) },
    { x: 90, y: Math.max(10, Math.round(rect.top - 40)) },
    { x: 190, y: Math.max(10, Math.round(rect.top - 40)) },
  ]);
  expect(await isDrawerOpen(page)).toBe(false);

  // 3. Below configured vertical zone -> does NOT open.
  await dispatchTouchSwipe(page, [
    { x: 10, y: Math.min(820, Math.round(rect.bottom + 80)) },
    { x: 90, y: Math.min(820, Math.round(rect.bottom + 80)) },
    { x: 190, y: Math.min(820, Math.round(rect.bottom + 80)) },
  ]);
  expect(await isDrawerOpen(page)).toBe(false);

  // 4. Outside configured touchWidth (x=54 > 44px) even at midY -> does NOT open.
  await dispatchTouchSwipe(page, [
    { x: 54, y: midY },
    { x: 130, y: midY + 1 },
    { x: 220, y: midY + 2 },
  ]);
  expect(await isDrawerOpen(page)).toBe(false);

  // 5. Desktop width hides the handle completely, returning to mobile restores it.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(pill).toBeHidden();
  await setMobileViewport(page);
  await expect(pill).toBeVisible();
});

test('visible handle opens on tap without blocking content taps or hijacking overlays', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await setMobileViewport(page);

  await page.evaluate(() => {
    fixtureApp.features.edgeHandle.update({
      visible: true,
      position: 50,
      length: 30,
      touchWidth: 48,
      opacity: 0.7,
    });
  });

  const pill = page.locator('#edgeHandlePill');
  await expect(pill).toBeVisible();

  // Tapping the visible handle opens the drawer.
  await pill.click();
  expect(await isDrawerOpen(page)).toBe(true);
  await page.evaluate(() => fixtureApp.features.sidebarQuery.close());
  expect(await isDrawerOpen(page)).toBe(false);

  // Short cancelled swipe nudge starting on the pill must NOT open via synthetic click.
  const pillBox = await pill.boundingBox();
  expect(pillBox).not.toBeNull();
  const pillMidY = Math.round(pillBox!.y + pillBox!.height / 2);
  await dispatchTouchSwipe(page, [
    { x: 3, y: pillMidY },
    { x: 18, y: pillMidY },
    { x: 28, y: pillMidY },
  ], { stepDelayMs: 40, pauseBeforeEndMs: 160 });
  expect(await isDrawerOpen(page)).toBe(false);

  // Content outside the handle's vertical range and inside the 48px touch strip (outside the 6px pill) remains tappable.
  await page.evaluate(midY => {
    const counts = { outside: 0, inStrip: 0 };
    Reflect.set(window, '__edgeTapCounts', counts);
    const outsideBtn = document.createElement('button');
    outsideBtn.id = 'edgeTestOutsideBtn';
    outsideBtn.type = 'button';
    outsideBtn.textContent = 'Outside';
    outsideBtn.style.cssText = 'position:fixed;left:4px;top:110px;width:72px;height:36px;z-index:20;';
    outsideBtn.addEventListener('click', () => { counts.outside += 1; });

    const inStripBtn = document.createElement('button');
    inStripBtn.id = 'edgeTestStripBtn';
    inStripBtn.type = 'button';
    inStripBtn.textContent = 'Strip';
    inStripBtn.style.cssText = `position:fixed;left:14px;top:${midY - 18}px;width:64px;height:36px;z-index:20;`;
    inStripBtn.addEventListener('click', () => { counts.inStrip += 1; });

    document.body.append(outsideBtn, inStripBtn);
  }, pillMidY);

  await page.locator('#edgeTestOutsideBtn').click();
  await page.locator('#edgeTestStripBtn').click();
  expect(await page.evaluate(() => Reflect.get(window, '__edgeTapCounts'))).toEqual({ outside: 1, inStrip: 1 });
  expect(await isDrawerOpen(page)).toBe(false);

  // Blocking overlay prevents pill click from opening the drawer.
  await page.evaluate(() => {
    const lb = document.createElement('div');
    lb.className = 'lightbox-overlay';
    lb.id = 'edgeTestLightbox';
    document.body.append(lb);
    fixtureElement(document.getElementById('edgeHandlePill'), '#edgeHandlePill').click();
  });
  expect(await isDrawerOpen(page)).toBe(false);
  await page.evaluate(() => {
    document.getElementById('edgeTestLightbox')?.remove();
    document.getElementById('edgeTestOutsideBtn')?.remove();
    document.getElementById('edgeTestStripBtn')?.remove();
  });

  // Hamburger button still works identically.
  await page.locator('.header-menu-btn').click();
  expect(await isDrawerOpen(page)).toBe(true);
});

test('settings UI persists, clamps corrupt storage, previews live at 390x844, and resets cleanly', async ({ page, fleet }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await fleet.select(fleet.self);
  await setMobileViewport(page);

  // 1. Corrupt localStorage falls back to defaults cleanly across reload.
  await page.evaluate(() => localStorage.setItem('pi-dish-edge-handle', '{broken-json'));
  await page.reload();
  await setMobileViewport(page);
  expect(await page.evaluate(() => fixtureApp.features.edgeHandle.settings)).toEqual({
    position: 50,
    length: 100,
    touchWidth: 24,
    visible: false,
    opacity: 0.5,
  });

  // 2. Out-of-range and wrong-typed values clamp / fall back per field.
  await page.evaluate(() => localStorage.setItem('pi-dish-edge-handle', JSON.stringify({
    position: 999,
    length: 2,
    touchWidth: -10,
    visible: 'yes',
    opacity: 42,
  })));
  await page.reload();
  await setMobileViewport(page);
  expect(await page.evaluate(() => fixtureApp.features.edgeHandle.settings)).toEqual({
    position: 100,
    length: 10,
    touchWidth: 12,
    visible: false,
    opacity: 1,
  });

  // 3. Open Settings via the real sidebar gear button at 390x844.
  await page.locator('.empty-menu-btn, .header-menu-btn').filter({ visible: true }).first().click();
  await expect.poll(() => isDrawerOpen(page)).toBe(true);
  await page.locator('.global-settings-btn').click();
  await expect(page.locator('#settingsModal')).toBeVisible();
  await expect(page.locator('#edgeHandleSettings')).toBeVisible();

  // Usable at 390x844: no horizontal overflow in the settings modal or edge-handle section.
  const layout = await page.evaluate(() => {
    const body = fixtureElement(document.querySelector<HTMLElement>('.settings-body'), '.settings-body');
    const section = fixtureElement(document.getElementById('edgeHandleSettings'), '#edgeHandleSettings');
    const box = section.getBoundingClientRect();
    return {
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      sectionLeft: box.left,
      sectionRight: box.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.bodyClientWidth + 1);
  expect(layout.sectionLeft).toBeGreaterThanOrEqual(0);
  expect(layout.sectionRight).toBeLessThanOrEqual(layout.viewportWidth);

  // Opacity slider stays hidden while handle is invisible.
  await expect(page.locator('#edgeHandleOpacityRow')).toBeHidden();

  // 4. Adjusting sliders starts live preview on the real handle above the modal.
  await setRangeValue(page, '#edgeHandleLength', 30);
  await setRangeValue(page, '#edgeHandlePosition', 75);
  await setRangeValue(page, '#edgeHandleTouchWidth', 40);

  const previewWhileInvisible = await page.evaluate(() => {
    const handle = fixtureElement(document.getElementById('edgeHandle'), '#edgeHandle');
    const pill = fixtureElement(document.getElementById('edgeHandlePill'), '#edgeHandlePill');
    const box = handle.getBoundingClientRect();
    const style = getComputedStyle(handle);
    return {
      previewing: fixtureApp.features.edgeHandle.previewing,
      hasClass: handle.classList.contains('edge-handle-preview'),
      visibility: style.visibility,
      zIndex: Number(style.zIndex),
      pointerEvents: style.pointerEvents,
      pillHidden: pill.hidden,
      width: box.width,
      height: box.height,
      top: box.top,
    };
  });
  expect(previewWhileInvisible.previewing).toBe(true);
  expect(previewWhileInvisible.hasClass).toBe(true);
  expect(previewWhileInvisible.visibility).toBe('visible');
  expect(previewWhileInvisible.zIndex).toBeGreaterThan(100);
  expect(previewWhileInvisible.pointerEvents).toBe('none');
  expect(previewWhileInvisible.pillHidden).toBe(true);
  expect(previewWhileInvisible.width).toBeCloseTo(40, 0);
  // 30% of 844 = 253.2px; top = (844 - 253.2) * 0.75 = 443.1px.
  expect(previewWhileInvisible.height).toBeCloseTo(253.2, 0);
  expect(previewWhileInvisible.top).toBeCloseTo(443.1, 0);

  // 5. Enabling visibility reveals opacity slider and shows real pill in live preview.
  await page.locator('#edgeHandleVisible').check();
  await expect(page.locator('#edgeHandleOpacityRow')).toBeVisible();
  await setRangeValue(page, '#edgeHandleOpacity', 70);

  const previewVisible = await page.evaluate(() => {
    const pill = fixtureElement(document.getElementById('edgeHandlePill'), '#edgeHandlePill');
    return { hidden: pill.hidden, opacity: parseFloat(getComputedStyle(pill).opacity), pointerEvents: getComputedStyle(pill).pointerEvents };
  });
  expect(previewVisible.hidden).toBe(false);
  expect(previewVisible.opacity).toBeCloseTo(0.7, 2);
  expect(previewVisible.pointerEvents).toBe('none');

  // 6. Closing Settings ends preview, retains real handle, and retires old inputs.
  await page.evaluate(() => {
    const lengthSlider = fixtureInput(document.getElementById('edgeHandleLength'), '#edgeHandleLength');
    fixtureApp.ports.appBindings.actions.closeSettingsModal(new Event('click'), document.body);
    lengthSlider.value = '10';
    lengthSlider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => ({
    previewing: fixtureApp.features.edgeHandle.previewing,
    settings: fixtureApp.features.edgeHandle.settings,
    hasPreviewClass: document.getElementById('edgeHandle')?.classList.contains('edge-handle-preview'),
  }))).toEqual({
    previewing: false,
    settings: { position: 75, length: 30, touchWidth: 40, visible: true, opacity: 0.7 },
    hasPreviewClass: false,
  });

  // 7. Persisted settings survive reload.
  await page.reload();
  await setMobileViewport(page);
  expect(await page.evaluate(() => fixtureApp.features.edgeHandle.settings)).toEqual({
    position: 75,
    length: 30,
    touchWidth: 40,
    visible: true,
    opacity: 0.7,
  });
  await expect(page.locator('#edgeHandlePill')).toBeVisible();

  // 8. Reset to default restores defaults, clears localStorage, and hides handle after closing Settings.
  await page.evaluate(() => fixtureApp.features.displayPreferences.open());
  await expect(page.locator('#edgeHandleReset')).toBeEnabled();
  await page.locator('#edgeHandleReset').click();
  await expect(page.locator('#edgeHandleReset')).toBeDisabled();
  await expect(page.locator('#edgeHandleOpacityRow')).toBeHidden();
  expect(await page.evaluate(() => ({
    stored: localStorage.getItem('pi-dish-edge-handle'),
    settings: fixtureApp.features.edgeHandle.settings,
  }))).toEqual({
    stored: null,
    settings: { position: 50, length: 100, touchWidth: 24, visible: false, opacity: 0.5 },
  });
  await page.locator('#settingsModal [data-app-click="closeSettingsModal"]').click();
  await expect(page.locator('#edgeHandlePill')).toBeHidden();
  expect(errors).toEqual([]);
});

test('version skew: old CSS without edge-handle rules keeps layout intact and handle functional', async ({ page, fleet }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await fleet.select(fleet.self);
  await setMobileViewport(page);

  // Strip every .edge-handle* CSS rule to simulate new JS running against old cached style.css.
  const removedRules = await page.evaluate(() => {
    let removed = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (rule.cssText.includes('edge-handle')) {
          sheet.deleteRule(i);
          removed += 1;
        }
      }
    }
    return removed;
  });
  expect(removedRules).toBeGreaterThan(0);

  // Invisible by default: stays fixed, hidden, zero pointer-events.
  await page.evaluate(() => fixtureApp.features.edgeHandle.sync());
  expect(await page.evaluate(() => {
    const handle = fixtureElement(document.getElementById('edgeHandle'), '#edgeHandle');
    const style = getComputedStyle(handle);
    return { position: style.position, visibility: style.visibility, pointerEvents: style.pointerEvents };
  })).toEqual({ position: 'fixed', visibility: 'hidden', pointerEvents: 'none' });

  // Visible on mobile: fixed positioned pill at exact geometry, tap still opens drawer.
  await page.evaluate(() => fixtureApp.features.edgeHandle.update({
    visible: true, position: 40, length: 25, touchWidth: 32, opacity: 0.6,
  }));
  const mobileStyle = await page.evaluate(() => {
    const handle = fixtureElement(document.getElementById('edgeHandle'), '#edgeHandle');
    const pill = fixtureElement(document.getElementById('edgeHandlePill'), '#edgeHandlePill');
    const box = handle.getBoundingClientRect();
    return {
      position: getComputedStyle(handle).position,
      width: box.width,
      height: box.height,
      pillOpacity: parseFloat(getComputedStyle(pill).opacity),
      pillWidth: pill.getBoundingClientRect().width,
    };
  });
  expect(mobileStyle.position).toBe('fixed');
  expect(mobileStyle.width).toBeCloseTo(32, 0);
  expect(mobileStyle.height).toBeCloseTo(211, 0);
  expect(mobileStyle.pillOpacity).toBeCloseTo(0.6, 2);
  expect(mobileStyle.pillWidth).toBeCloseTo(6, 0);

  await page.locator('#edgeHandlePill').click();
  expect(await isDrawerOpen(page)).toBe(true);
  await page.evaluate(() => fixtureApp.features.sidebarQuery.close());

  // Desktop width still hides handle even without CSS media rules.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#edgeHandle')).toBeHidden();
  expect(errors).toEqual([]);
});

export {};
