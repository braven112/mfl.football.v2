/**
 * Capture What's New Screenshots
 *
 * Takes automated screenshots of What's New feature pages using Playwright.
 * Run with: npx playwright test scripts/capture-whats-new-screenshots.mjs
 * Or standalone: node scripts/capture-whats-new-screenshots.mjs
 *
 * Prerequisites:
 *   - Dev server running on localhost:4321 (pnpm dev)
 *   - Playwright browsers installed (npx playwright install chromium)
 *
 * Usage:
 *   node scripts/capture-whats-new-screenshots.mjs              # capture all missing
 *   node scripts/capture-whats-new-screenshots.mjs --force       # re-capture all, even if files exist
 *   node scripts/capture-whats-new-screenshots.mjs dead-money-awards  # capture specific entry
 *   node scripts/capture-whats-new-screenshots.mjs --force dead-money-awards  # force re-capture specific entry
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ASSETS_DIR = resolve(ROOT, 'public/assets/whats-new');
const DATA_PATH = resolve(ROOT, 'src/data/whats-new.json');

const SCREENSHOT_CATEGORIES = ['new-page', 'new-feature', 'enhancement'];
const VIEWPORT = { width: 2560, height: 1440 };
const BASE_URL = process.env.BASE_URL || 'http://localhost:4321';

async function main() {
  const entries = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const targetId = args.find((a) => a !== '--force');

  // Filter to entries that need screenshots
  const targets = entries.filter((e) => {
    if (!SCREENSHOT_CATEGORIES.includes(e.category)) return false;
    if (!e.image) return false; // must have image field set in JSON
    if (targetId && e.id !== targetId) return false;
    if (force) return true;
    const imagePath = resolve(ASSETS_DIR, e.image);
    // Only capture if the file doesn't already exist
    return !existsSync(imagePath);
  });

  if (targets.length === 0) {
    console.log('No screenshots to capture. All entries either have images or no image field set.');
    if (!force) console.log('Tip: use --force to re-capture existing screenshots.');
    process.exit(0);
  }

  console.log(`Capturing ${targets.length} screenshot(s)...`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });

  for (const entry of targets) {
    const page = await context.newPage();
    const url = entry.link ? `${BASE_URL}${entry.link}` : BASE_URL;
    const outputPath = resolve(ASSETS_DIR, entry.image);

    console.log(`  [${entry.id}] navigating to ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      // Wait a beat for animations/transitions to settle
      await page.waitForTimeout(1000);
      await page.screenshot({ path: outputPath, type: 'webp' });
      console.log(`  [${entry.id}] saved -> ${entry.image}`);
    } catch (err) {
      console.error(`  [${entry.id}] FAILED: ${err.message}`);
    }
    await page.close();
  }

  await browser.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
