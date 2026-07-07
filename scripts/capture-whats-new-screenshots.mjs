/**
 * Capture What's New Screenshots
 *
 * Takes automated screenshots of What's New feature pages using Playwright.
 * Automatically detects stale screenshots by comparing file timestamps against
 * whats-new.json — so screenshots updated in a cloud session get re-captured
 * on the next local run.
 *
 * Prerequisites:
 *   - Dev server running on localhost:4321 (pnpm dev)
 *   - Playwright browsers installed (npx playwright install chromium)
 *
 * Usage:
 *   node scripts/capture-whats-new-screenshots.mjs                              # capture missing + stale
 *   node scripts/capture-whats-new-screenshots.mjs --force                      # re-capture all (except MANUAL_CAPTURE_ONLY entries below)
 *   node scripts/capture-whats-new-screenshots.mjs dead-money-awards pwa-app    # capture specific entries
 *   node scripts/capture-whats-new-screenshots.mjs --force dead-money-awards    # force re-capture specific entry
 *
 * Note: entries in MANUAL_CAPTURE_ONLY (below) are always skipped by a bare
 * `--force` — they require a hand-staged environment (auth, mock data, a
 * specific scroll position) that a blind capture can't reproduce. Name the
 * entry explicitly on the CLI to recapture it.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, statSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ASSETS_DIR = resolve(ROOT, 'public/assets/whats-new');
const DATA_PATH = resolve(ROOT, 'src/data/whats-new.json');

const SCREENSHOT_CATEGORIES = ['new-page', 'new-feature', 'enhancement'];
const VIEWPORT = { width: 2560, height: 1440 };
const BASE_URL = process.env.BASE_URL || 'http://localhost:4321';

/**
 * Entries whose screenshots are staged by hand — a blind capture of the
 * entry's link shoots a sign-in screen, an unpopulated analytics page, or
 * the wrong scroll position. Skipped unless named explicitly on the CLI.
 *
 * - submit-lineup / tip-schefter-gets-louder / mock-draft: auth-gated pages
 * - owner-activity / afl-owner-activity: analytics only populate in prod
 *   (locally, append ?mock=true for a staged capture)
 * - afl-trophy-wall: needs a franchise profile scrolled to the trophy wall
 */
const MANUAL_CAPTURE_ONLY = new Set([
  'submit-lineup',
  'tip-schefter-gets-louder',
  'mock-draft',
  'owner-activity',
  'afl-owner-activity',
  'afl-trophy-wall',
]);

/**
 * Per-entry page setup hooks.
 * Each key is an entry ID; the value is an async function that runs
 * after navigation + initial wait, right before the screenshot is taken.
 */
const PAGE_HOOKS = {
  'nav-drawer-redesign': async (page) => {
    // Open the navigation drawer so it's visible in the screenshot
    await page.evaluate(() => {
      const drawer = document.getElementById('nav-drawer');
      if (drawer) drawer.classList.add('nav-drawer--open');
    });
    await page.waitForTimeout(500); // let drawer animation finish
  },
  'rookie-showcase-composite-cards': async (page) => {
    // Force lazy cutouts to load, then frame the card wall (not the page top)
    await page.evaluate(() => {
      document.querySelectorAll('.rcc__cutout').forEach((img) => { img.loading = 'eager'; });
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const el = document.querySelector('.rookie-showcase');
      if (el) el.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -140);
    });
    await page.waitForTimeout(300);
  },
};

/**
 * Check if a screenshot is stale by comparing its mtime against whats-new.json.
 * If the JSON was modified more recently than the screenshot, the screenshot
 * is considered stale (e.g., pages changed in a cloud session without re-capturing).
 */
function isStale(imagePath, jsonMtime) {
  if (!existsSync(imagePath)) return true;
  const imageMtime = statSync(imagePath).mtimeMs;
  return imageMtime < jsonMtime;
}

async function main() {
  const entries = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const jsonMtime = statSync(DATA_PATH).mtimeMs;
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const targetIds = args.filter((a) => !a.startsWith('--'));
  const hasTargets = targetIds.length > 0;
  const targetSet = new Set(targetIds);

  // Filter to entries that need screenshots
  const targets = entries.filter((e) => {
    if (!SCREENSHOT_CATEGORIES.includes(e.category)) return false;
    if (!e.image) return false; // must have image field set in JSON
    if (hasTargets && !targetSet.has(e.id)) return false;
    // Manual-capture entries only run when explicitly named on the CLI
    if (!hasTargets && MANUAL_CAPTURE_ONLY.has(e.id)) return false;
    if (force) return true;
    const imagePath = resolve(ASSETS_DIR, e.image);
    // Capture if missing OR stale (json was updated more recently than the screenshot)
    return isStale(imagePath, jsonMtime);
  });

  if (hasTargets) {
    const missing = targetIds.filter((id) => !entries.some((e) => e.id === id));
    if (missing.length > 0) {
      console.warn(`Warning: no matching entries found for: ${missing.join(', ')}`);
    }
  }

  // MANUAL_CAPTURE_ONLY entries are excluded from `targets` above regardless
  // of staleness, so a default run would otherwise report "up to date" even
  // when one of them is missing its image file entirely — surface that
  // separately so a broken/deleted manual asset doesn't go unnoticed.
  if (!hasTargets) {
    const missingManual = entries.filter(
      (e) =>
        MANUAL_CAPTURE_ONLY.has(e.id) &&
        SCREENSHOT_CATEGORIES.includes(e.category) &&
        e.image &&
        !existsSync(resolve(ASSETS_DIR, e.image)),
    );
    if (missingManual.length > 0) {
      console.warn(
        `Warning: ${missingManual.length} manual-capture screenshot(s) are MISSING and won't ` +
          `be auto-captured (see MANUAL_CAPTURE_ONLY docs at the top of this script): ` +
          `${missingManual.map((e) => e.id).join(', ')}`,
      );
    }
  }

  if (targets.length === 0) {
    console.log('All screenshots are up to date.');
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

      // Run per-entry page hook if one exists
      if (PAGE_HOOKS[entry.id]) {
        await PAGE_HOOKS[entry.id](page);
      }

      // Playwright doesn't support webp — capture as PNG then convert
      const pngPath = outputPath.replace(/\.webp$/, '.png');
      const isWebp = outputPath.endsWith('.webp');
      await page.screenshot({ path: isWebp ? pngPath : outputPath, type: 'png' });

      if (isWebp) {
        try {
          execSync(`cwebp -q 85 "${pngPath}" -o "${outputPath}"`, { stdio: 'pipe' });
          unlinkSync(pngPath);
        } catch {
          console.warn(`  [${entry.id}] cwebp not found, keeping PNG`);
        }
      }
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
