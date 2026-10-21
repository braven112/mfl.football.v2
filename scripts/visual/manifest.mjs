#!/usr/bin/env node
/**
 * List every story the visual suite should capture, and in which modes.
 *
 *   node scripts/visual/manifest.mjs   # needs `pnpm build:storybook` first
 *
 * Writes tests/visual/stories.manifest.json, which tests/visual/stories.spec.ts
 * reads. A separate step because Playwright collects test files BEFORE any
 * globalSetup runs, so the list of tests cannot depend on a browser.
 *
 * The capture plan comes from each story's own `parameters.chromatic`
 * (`modes`, `disableSnapshot`, `delay`, `viewports`) — the same keys Chromatic
 * read, merged by Storybook exactly as before (project → component → story),
 * so the theme × league matrix in .storybook/modes.ts carries over unchanged.
 * Reading them from the BUILT preview rather than parsing the story files is
 * what makes that merge correct: a story-level `modes` map is unioned with the
 * component-level one by Storybook itself (docs/claude/rules/storybook.md,
 * Trap 9), and re-implementing that here would be a second copy to drift.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { serveStatic } from './serve-static.mjs';

const DIR = 'storybook-static';
const PORT = 6008;
const OUT = 'tests/visual/stories.manifest.json';

if (!existsSync(`${DIR}/iframe.html`)) {
  console.error(`No ${DIR}/iframe.html — run \`pnpm build:storybook\` first.`);
  process.exit(1);
}

const server = await serveStatic(DIR, PORT);
const browser = await chromium.launch(
  process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {},
);
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/iframe.html`);
  await page.waitForFunction(() => globalThis.__STORYBOOK_PREVIEW__?.storyStoreValue, null, { timeout: 60_000 });
  const stories = await page.evaluate(async () => {
    const store = globalThis.__STORYBOOK_PREVIEW__.storyStoreValue;
    await store.cacheAllCSFFiles();
    const all = store.extract();
    return Object.values(all).map((s) => {
      const c = s.parameters?.chromatic ?? {};
      const modes = Object.entries(c.modes ?? {})
        .filter(([, m]) => m && !m.disable)
        .map(([name, m]) => ({ name, globals: { theme: m.theme, league: m.league, style: m.style } }));
      return {
        id: s.id,
        title: s.title,
        name: s.name,
        skip: Boolean(c.disableSnapshot),
        delay: typeof c.delay === 'number' ? c.delay : 0,
        viewport: Array.isArray(c.viewports) && c.viewports.length ? c.viewports[0] : null,
        modes,
      };
    });
  });
  stories.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(OUT, `${JSON.stringify(stories, null, 2)}\n`);
  const captures = stories.filter((s) => !s.skip).reduce((n, s) => n + Math.max(s.modes.length, 1), 0);
  console.log(`${stories.length} stories, ${captures} captures -> ${OUT}`);
} finally {
  await browser.close();
  server.close();
}
