// Shared by the full smoke and a fresh --scenario fleet run.
import type { Page } from 'playwright';
import type { UiScenario } from './contracts.js';

// Horizontal page overflow is the phone-layout regression this guards: a
// card or meter row wider than the viewport would scroll the whole page.
async function layout(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const cards = [...document.querySelectorAll<HTMLElement>('#fleetHosts .fleet-host')];
    const body = document.getElementById('fleetViewBody');
    return {
      width,
      pageScroll: document.documentElement.scrollWidth,
      bodyScroll: body ? body.scrollWidth - body.clientWidth : -1,
      cards: cards.length,
      meters: cards.map(card => card.querySelectorAll('.fleet-meter[role="meter"]').length),
      overflowing: [...document.querySelectorAll<HTMLElement>('#fleetView .fleet-host, #fleetView .fleet-meter, #fleetView .preference-row, #fleetView #bounceView')]
        .filter(el => el.getBoundingClientRect().right > width + 1).map(el => el.className || el.id),
    };
  });
}

const fleet: UiScenario = async ({ desktop, browser, watch, base, check }) => {
  console.log('fleet view:');
  await desktop.click('#btnFleet');
  await desktop.waitForSelector('.main.fleet-open #fleetView', { state: 'visible' });
  await desktop.waitForSelector('#fleetHosts .fleet-host .fleet-meter[role="meter"]', { timeout: 10000 });
  const wide = await layout(desktop);
  check(wide.cards >= 1 && wide.meters.every(count => count >= 2),
    `each host card shows capacity meters (got ${JSON.stringify(wide.meters)})`);
  check(await desktop.locator('#fleetHosts .fleet-host .fleet-sessions').first().textContent()
    .then(text => /\d+ live/.test(text || '')), 'the host card leads with its live session count');
  check(wide.pageScroll <= wide.width && wide.bodyScroll <= 0 && wide.overflowing.length === 0,
    `desktop Fleet view has no horizontal overflow (got ${JSON.stringify(wide)})`);
  check(await desktop.locator('#fleetConnections #hostsList').isVisible() &&
    await desktop.locator('#fleetView #openBounceAgents').isVisible(),
  'connections and bounce controls render below the host cards');
  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => !document.querySelector('.main')?.classList.contains('fleet-open'));
  check(true, 'Escape closes the Fleet view');

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await watch(phone, 'fleet-mobile');
  try {
    await phone.goto(base, { waitUntil: 'networkidle' });
    await phone.evaluate(() => localStorage.removeItem('pi-dish-session'));
    await phone.reload({ waitUntil: 'networkidle' });
    await phone.click('.empty-menu-btn');
    await phone.waitForSelector('.sidebar.open');
    await phone.click('#btnFleet');
    await phone.waitForSelector('.main.fleet-open #fleetView', { state: 'visible' });
    await phone.waitForSelector('#fleetHosts .fleet-host .fleet-meter[role="meter"]', { timeout: 10000 });
    check(!(await phone.locator('.sidebar').evaluate(el => el.classList.contains('open'))),
      'opening Fleet from the drawer closes the drawer');
    await phone.click('#openBounceAgents');
    await phone.waitForSelector('#bounceMode', { state: 'visible' });
    const narrow = await layout(phone);
    check(narrow.cards >= 1 && narrow.meters.every(count => count >= 2),
      `mobile host cards show capacity meters (got ${JSON.stringify(narrow.meters)})`);
    check(narrow.pageScroll <= narrow.width && narrow.bodyScroll <= 0 && narrow.overflowing.length === 0,
      `mobile Fleet view has no horizontal overflow (got ${JSON.stringify(narrow)})`);
    check(await phone.locator('#fleetView .menu-btn').isVisible(), 'the Fleet header carries the mobile drawer button');
  } finally {
    await phone.close();
  }
};

export = fleet;
