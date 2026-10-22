import { defineConfig } from '@playwright/test';

/**
 * Visual regression for the Storybook workbench — the free replacement for
 * Chromatic (removed Oct 2026). Separate from playwright.config.ts, which
 * drives the dev server for the e2e specs.
 *
 *   pnpm build:storybook && pnpm test:visual          # compare
 *   pnpm build:storybook && pnpm test:visual:update   # rewrite changed baselines
 *
 * Baselines are rendered on the CI runner and are only comparable to renders
 * from the same OS and browser build: font hinting differs between macOS and
 * Linux, so a local run on a Mac reports every story as changed. Treat CI as
 * the source of truth (docs/claude/rules/storybook.md § Visual regression).
 */
export default defineConfig({
  testDir: './tests/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never', outputFolder: 'visual-report' }], ['github']] : [['list'], ['html', { open: 'never', outputFolder: 'visual-report' }]],
  outputDir: 'test-results/visual',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      // Same runner, same browser build: renders are deterministic, so this
      // only absorbs the odd anti-aliased edge.
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:6007',
    browserName: 'chromium',
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
    ...(process.env.PW_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } }
      : {}),
  },
  webServer: {
    command: 'node scripts/visual/serve-static.mjs storybook-static 6007',
    url: 'http://127.0.0.1:6007/iframe.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
