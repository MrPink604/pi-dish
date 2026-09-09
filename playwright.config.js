const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    launchOptions: { executablePath: process.env.CHROME_BIN || undefined },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
