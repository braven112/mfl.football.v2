import { test, expect } from '@playwright/test';

test.describe('Navigation Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nav-demo');
  });

  test('should open drawer when hamburger is clicked', async ({ page }) => {
    // Find and click the hamburger button
    const hamburger = page.locator('[data-nav-toggle]');
    await hamburger.click();

    // Drawer should be visible
    const drawer = page.locator('.nav-drawer');
    await expect(drawer).toHaveClass(/nav-drawer--open/);
  });

  test('should display all nav sections with proper spacing', async ({ page }) => {
    // Open drawer
    await page.locator('[data-nav-toggle]').click();
    await page.waitForSelector('.nav-drawer--open');

    // Take a screenshot for visual review
    await page.screenshot({
      path: 'tests/e2e/screenshots/nav-drawer-open.png',
      fullPage: false
    });

    // Check that sections exist
    const sections = page.locator('.nav-links__section');
    const count = await sections.count();
    expect(count).toBeGreaterThan(0);

    // Check section titles are visible
    const sectionTitles = page.locator('.nav-links__section-title:not(.visually-hidden)');
    await expect(sectionTitles.first()).toBeVisible();
  });

  test('should have proper link spacing', async ({ page }) => {
    await page.locator('[data-nav-toggle]').click();
    await page.waitForSelector('.nav-drawer--open');

    // Get all nav links
    const links = page.locator('.nav-links__link');
    const linkCount = await links.count();
    expect(linkCount).toBeGreaterThan(0);

    // Check first link has minimum height (touch target)
    const firstLink = links.first();
    const box = await firstLink.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(40); // Should be at least 40px for touch

    // Check icon is properly sized
    const icon = firstLink.locator('.nav-links__icon svg');
    const iconBox = await icon.boundingBox();
    expect(iconBox?.width).toBe(24);
    expect(iconBox?.height).toBe(24);
  });

  test('should display team info in footer when authenticated', async ({ page }) => {
    await page.locator('[data-nav-toggle]').click();
    await page.waitForSelector('.nav-drawer--open');

    // Check for team info or verify prompt
    const footer = page.locator('.nav-footer');
    await expect(footer).toBeVisible();

    // Take screenshot of footer
    await footer.screenshot({ path: 'tests/e2e/screenshots/nav-footer.png' });
  });

  test('should toggle collapsed mode', async ({ page }) => {
    await page.locator('[data-nav-toggle]').click();
    await page.waitForSelector('.nav-drawer--open');

    // Find collapse button (only visible on desktop)
    const collapseBtn = page.locator('[data-nav-collapse]');

    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();

      // Drawer should have collapsed class
      const drawer = page.locator('.nav-drawer');
      await expect(drawer).toHaveClass(/nav-drawer--collapsed/);

      // Take screenshot of collapsed state
      await page.screenshot({ path: 'tests/e2e/screenshots/nav-drawer-collapsed.png' });
    }
  });

  test('should close drawer when overlay is clicked', async ({ page }) => {
    await page.locator('[data-nav-toggle]').click();
    await page.waitForSelector('.nav-drawer--open');

    // Click overlay (on mobile viewport)
    const overlay = page.locator('.nav-overlay');
    if (await overlay.isVisible()) {
      await overlay.click({ force: true });

      const drawer = page.locator('.nav-drawer');
      await expect(drawer).not.toHaveClass(/nav-drawer--open/);
    }
  });

  test('should close drawer on escape key', async ({ page }) => {
    await page.locator('[data-nav-toggle]').click();
    await page.waitForSelector('.nav-drawer--open');

    await page.keyboard.press('Escape');

    const drawer = page.locator('.nav-drawer');
    await expect(drawer).not.toHaveClass(/nav-drawer--open/);
  });

  test('should have all icons visible', async ({ page }) => {
    await page.locator('[data-nav-toggle]').click();
    await page.waitForSelector('.nav-drawer--open');

    // Get all icons
    const icons = page.locator('.nav-links__icon svg');
    const iconCount = await icons.count();

    // Each icon should have non-zero dimensions
    for (let i = 0; i < Math.min(iconCount, 10); i++) {
      const icon = icons.nth(i);
      const box = await icon.boundingBox();
      expect(box?.width).toBeGreaterThan(0);
      expect(box?.height).toBeGreaterThan(0);
    }
  });

  test('visual: capture full drawer for spacing review', async ({ page, context }) => {
    // Clear any collapsed state cookie to ensure expanded view
    await context.clearCookies();

    // Set a wide viewport to prevent auto-collapse
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.reload();

    await page.locator('[data-nav-toggle]').click();
    await page.waitForSelector('.nav-drawer--open');

    // Wait for any animations
    await page.waitForTimeout(500);

    // Capture full drawer
    const drawer = page.locator('.nav-drawer');
    await drawer.screenshot({
      path: 'tests/e2e/screenshots/nav-drawer-full.png',
    });

    // Capture just the links section
    const links = page.locator('.nav-links');
    await links.screenshot({
      path: 'tests/e2e/screenshots/nav-links-section.png',
    });
  });
});

test.describe('Navigation Drawer - Mobile', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('should show overlay on mobile', async ({ page }) => {
    await page.goto('/nav-demo');
    await page.locator('[data-nav-toggle]').click();
    await page.waitForSelector('.nav-drawer--open');

    const overlay = page.locator('.nav-overlay');
    await expect(overlay).toHaveClass(/nav-overlay--visible/);

    await page.screenshot({ path: 'tests/e2e/screenshots/nav-drawer-mobile.png' });
  });
});
