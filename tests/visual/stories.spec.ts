import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * One screenshot per story per mode, compared against the baselines in
 * tests/visual/__screenshots__/ (checked out from the `visual-baselines`
 * branch in CI — they are never committed to main or staging).
 *
 * The capture plan is tests/visual/stories.manifest.json, written by
 * scripts/visual/manifest.mjs from each story's `parameters.chromatic`
 * (modes, disableSnapshot, delay). The key name is Chromatic's; the stories
 * kept it so the theme × league matrix in .storybook/modes.ts carried over.
 */

interface Mode {
  name: string;
  globals: { theme?: string; league?: string; style?: string };
}
interface StoryEntry {
  id: string;
  title: string;
  name: string;
  skip: boolean;
  delay: number;
  viewport: number | null;
  modes: Mode[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'stories.manifest.json');
const BASELINES = join(HERE, '__screenshots__');

if (!existsSync(MANIFEST)) {
  throw new Error('tests/visual/stories.manifest.json is missing — run `node scripts/visual/manifest.mjs` first.');
}
const stories: StoryEntry[] = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function globalsParam(g: Mode['globals']): string {
  return Object.entries(g)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

for (const story of stories) {
  if (story.skip) continue;
  const modes: Mode[] = story.modes.length ? story.modes : [{ name: 'Default', globals: {} }];

  for (const mode of modes) {
    const file = `${story.id}--${slug(mode.name)}.png`;

    test(`${story.title} / ${story.name} [${mode.name}]`, async ({ page }, testInfo) => {
      // Stories are built to render from public/ alone. Anything reaching off
      // the box is a nondeterministic capture (a slow CDN is a timeout, a
      // flaky one a false diff), so it fails to load rather than flickers.
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());

      if (story.viewport) await page.setViewportSize({ width: story.viewport, height: 900 });

      const globals = globalsParam(mode.globals);
      await page.goto(
        `/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story${globals ? `&globals=${globals}` : ''}`,
        { waitUntil: 'networkidle' },
      );
      // Storybook flags the body once the story has rendered (or failed to).
      // Waiting on the root's children instead hangs on a story that
      // legitimately renders nothing (NetworkBadge/No Network).
      await page.waitForSelector('body.sb-show-main, body.sb-show-errordisplay', { state: 'attached' });
      const error = await page.evaluate(() =>
        document.body.classList.contains('sb-show-errordisplay')
          ? (document.querySelector('#error-message')?.textContent ?? 'render error')
          : null,
      );
      expect(error, `${story.id} threw while rendering`).toBeNull();
      await page.evaluate(() => document.fonts.ready);
      // A `loading="lazy"` image below the fold starts loading only when the
      // full-page capture grows the viewport, so it lands between the two
      // screenshots toHaveScreenshot needs to match (Free Agents' position
      // leaders: the second crest down failed "two consecutive stable
      // screenshots"). The dark theme also swaps a club's mark through CSS
      // `content: url(...)`, which fetches its own file. Load and decode both
      // now; one that fails or is aborted counts as settled.
      await page.evaluate(() => {
        const settle = (img: HTMLImageElement) =>
          (img.complete
            ? img.decode()
            : new Promise((done) => {
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
              })
          ).catch(() => null);
        const swapped = new Set<string>();
        for (const img of document.images) {
          const url = /^url\("?(.*?)"?\)$/.exec(getComputedStyle(img).content)?.[1];
          if (url) swapped.add(url);
        }
        const loads = Array.from(document.images, (img) => {
          img.loading = 'eager';
          return settle(img);
        });
        for (const src of swapped) {
          const img = new Image();
          img.src = src;
          loads.push(settle(img));
        }
        return Promise.all(loads);
      });
      if (story.delay) await page.waitForTimeout(story.delay);

      // A story added in this PR has no baseline yet. That is not a failure:
      // attach what it looks like, and the baseline is written when the
      // change lands on staging.
      const comparing = testInfo.config.updateSnapshots === 'none' || testInfo.config.updateSnapshots === 'missing';
      if (comparing && !existsSync(join(BASELINES, file))) {
        testInfo.annotations.push({ type: 'new-story', description: `No baseline yet for ${file}` });
        await testInfo.attach(file, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
        return;
      }

      await expect(page).toHaveScreenshot(file, { fullPage: true });
    });
  }
}
