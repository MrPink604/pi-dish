const { test, expect, ROOT } = require('./fixtures');
test.use({ liveSessions: true });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const attachment = { name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') };

async function attach(page) {
  await page.locator('input[type=file][accept*="image"]').setInputFiles(attachment);
  await expect(page.locator('#attachmentStrip img')).toHaveCount(1);
}

test('drafts and attachments remain separate for matching ids on two hosts', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.locator('#promptInput').fill('self draft');
  await attach(page);
  await fleet.select(fleet.peer);
  await expect(page.locator('#promptInput')).toHaveValue('');
  await expect(page.locator('#attachmentStrip img')).toHaveCount(0);
  await page.locator('#promptInput').fill('peer draft');
  await fleet.select(fleet.self);
  await expect(page.locator('#promptInput')).toHaveValue('self draft');
  await expect(page.locator('#attachmentStrip img')).toHaveCount(1);
  await fleet.select(fleet.peer);
  await expect(page.locator('#promptInput')).toHaveValue('peer draft');
  await expect(page.locator('#attachmentStrip img')).toHaveCount(0);
});

for (const kind of ['prompt', 'command', 'steer', 'followUp']) {
  test(`failed ${kind} restores payload to the origin after switching hosts`, async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const message = kind === 'command' ? '/fixture-command' : `failed ${kind}`;
    await page.locator('#promptInput').fill(message);
    if (kind !== 'command') await attach(page);
    const endpoint = `${fleet.self.base}/api/sessions/${ROOT}/${kind === 'followUp' ? 'prompt' : kind}`;
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    await page.route(endpoint, route => receive(route));
    await page.evaluate(kind => {
      window.testSend = kind === 'steer' ? sendSteer() : kind === 'followUp' ? sendFollowUp() : sendPrompt();
    }, kind);
    const route = await received;
    await fleet.select(fleet.peer);
    await page.locator('#promptInput').fill('peer work');
    await route.fulfill({ status: 503, json: { error: 'fixture rejection' } });
    await page.evaluate(() => window.testSend);
    await expect(page.locator('#promptInput')).toHaveValue('peer work');
    await expect(page.locator('#attachmentStrip img')).toHaveCount(0);
    await fleet.select(fleet.self);
    await expect(page.locator('#promptInput')).toHaveValue(message);
    await expect(page.locator('#attachmentStrip img')).toHaveCount(kind === 'command' ? 0 : 1);
  });
}

test('an image finishing preparation after navigation belongs to its starting composer', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    const prepare = createImageBitmap;
    createImageBitmap = file => new Promise(resolve => {
      window.finishImage = async () => resolve(await prepare(file).catch(() => null));
    });
  });
  await page.locator('input[type=file][accept*="image"]').setInputFiles(attachment);
  await page.waitForFunction(() => !!window.finishImage);
  await fleet.select(fleet.peer);
  await page.evaluate(() => window.finishImage());
  await expect(page.locator('#attachmentStrip img')).toHaveCount(0);
  await fleet.select(fleet.self);
  await expect(page.locator('#attachmentStrip img')).toHaveCount(1);
});
