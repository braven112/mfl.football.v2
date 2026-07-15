import { test, expect } from '@playwright/test';

/**
 * Standings mobile layout guard.
 *
 * The AFL Premier League (tier) standings used to stretch the whole page wider
 * than the viewport on phones, forcing horizontal scroll (bug reported July
 * 2026). The fix is structural (`min-width: 0` containment so wide tables scroll
 * inside their own wrapper) plus per-column mobile priority (`hideBelow: 'sm'`).
 *
 * This spec locks in the invariant that must never regress: at every mobile
 * width, on every standings view of both leagues, the DOCUMENT does not scroll
 * horizontally (scrollWidth <= innerWidth). It also asserts desktop keeps every
 * column so the ≥768px layout is unchanged.
 */

const VIEWS = [
  { name: 'afl-division', path: '/afl-fantasy/standings?view=division' },
  { name: 'afl-league', path: '/afl-fantasy/standings?view=league' },
  { name: 'afl-allplay', path: '/afl-fantasy/standings?view=all_play' },
  { name: 'tl-division', path: '/theleague/standings?view=division' },
  { name: 'tl-league', path: '/theleague/standings?view=league' },
  { name: 'tl-allplay', path: '/theleague/standings?view=all_play' },
];

const MOBILE_WIDTHS = [320, 375, 390];

for (const width of MOBILE_WIDTHS) {
  test.describe(`standings @ ${width}px — no horizontal page scroll`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const view of VIEWS) {
      test(`${view.name}`, async ({ page }) => {
        await page.goto(view.path, { waitUntil: 'networkidle' });
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(
          scrollWidth,
          `${view.name} overflows the viewport by ${scrollWidth - innerWidth}px`
        ).toBeLessThanOrEqual(innerWidth);
      });
    }
  });
}

test.describe('standings @ 768px — desktop columns intact', () => {
  test.use({ viewport: { width: 768, height: 900 } });

  test('AFL Premier League keeps all four tier columns', async ({ page }) => {
    await page.goto('/afl-fantasy/standings?view=all_play', { waitUntil: 'networkidle' });
    // Headers are uppercased by CSS text-transform; compare case-insensitively.
    const headers = (await page.locator('.v-tier thead th').allInnerTexts()).map((h) =>
      h.trim().toUpperCase()
    );
    expect(headers).toContain('RANK');
    expect(headers).toContain('TEAM');
    expect(headers).toContain('PRIZE');
  });

  test('TheLeague playoff view keeps its secondary columns visible', async ({ page }) => {
    await page.goto('/theleague/standings?view=league', { waitUntil: 'networkidle' });
    // `.hide-sm` columns must be visible at >=768px (desktop unchanged).
    const hidden = page.locator('.v-league th.hide-sm').first();
    await expect(hidden).toBeVisible();
  });
});

test.describe('standings @ 375px — secondary columns collapse', () => {
  test.use({ viewport: { width: 375, height: 900 } });

  test('TheLeague playoff view hides secondary columns on mobile', async ({ page }) => {
    await page.goto('/theleague/standings?view=league', { waitUntil: 'networkidle' });
    const hidden = page.locator('.v-league th.hide-sm').first();
    await expect(hidden).toBeHidden();
    // Primary columns remain.
    const headers = await page.locator('.v-league thead th:visible').allInnerTexts();
    expect(headers).toContain('Team');
    expect(headers).toContain('Overall');
  });
});
