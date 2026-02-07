import { expect, test } from '@playwright/test';

const shouldRun = process.env.RUN_PSD_DOWNLOAD_TESTS === '1';
const assetPages = ['/theleague/assets', '/afl-fantasy/assets'];

test.describe('PSD download links', () => {
  test.skip(!shouldRun, 'Set RUN_PSD_DOWNLOAD_TESTS=1 to enable PSD link checks.');

  for (const path of assetPages) {
    test(`downloads available on ${path}`, async ({ page, request }) => {
      test.setTimeout(120000);
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const links = await page.$$eval('a[href*=".psd"]', (anchors) =>
        anchors.map((a) => a.href)
      );

      expect(links.length).toBeGreaterThan(0);

      for (const href of links) {
        const response = await request.get(href);
        expect(response.status(), `Failed ${href}`).toBeLessThan(400);
      }
    });
  }
});
