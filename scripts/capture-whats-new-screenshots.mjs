/**
 * Capture What's New Screenshots
 *
 * Takes automated screenshots of What's New feature pages using Playwright.
 * Every entry is captured as a THEME PAIR: the light capture at the entry's
 * `image` filename, and a dark-mode capture (html.dark toggled before the
 * shot) at the `-dark` suffix (e.g. trade-builder.webp + trade-builder-dark.webp).
 * The composite hero swaps between the pair with CSS — never capture only one.
 *
 * Automatically detects stale screenshots by comparing file timestamps against
 * whats-new.json — so screenshots updated in a cloud session get re-captured
 * on the next local run. A missing dark capture also counts as stale.
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
import { execFileSync } from 'child_process';
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
 * the wrong scroll position (exactly what the 2026-07-06 backfill did
 * before this list existed). Skipped in bulk runs; naming one explicitly
 * on the CLI captures it anyway — that's a deliberate act, and the staging
 * notes below make it reproducible:
 *
 * - auth-gated pages: mint a session via a temporary DEV-only route
 * - analytics pages: append ?mock=true locally for a staged capture
 * - afl-trophy-wall: scroll a franchise profile to the trophy wall
 *
 * Values are the per-entry reason, shown when a bulk --force run skips one.
 * tests/whats-new-data.test.ts asserts every id here matches a real entry.
 */
const MANUAL_CAPTURE_ONLY = {
  'feature-first-heroes': 'both-league entry, no link — auto-capture would shoot the MFL landing page; capture the /theleague homepage hero manually',
  'draft-room-pick-reveal': 'hand-staged pick-reveal splash mid-animation — auto-capture shoots the idle draft board',
  'schefter-og-unfurls': 'hand-made OG card image, not a page screenshot — auto-capture would replace it with the landing page',
  'trade-composites': 'hand-staged trade-confirmation modal with specific players — auto-capture shoots the bare trade builder',
  'submit-lineup': 'auth-gated page — blind capture shoots the sign-in redirect',
  'tip-schefter-gets-louder': 'auth-gated page — blind capture shoots the sign-in redirect',
  'lineup-faceoff-scoreboard': 'auth-gated page — blind capture shoots the sign-in redirect',
  'mock-draft': 'sign-in gate replaces the draft config UI',
  'afl-trophy-wall': 'hand-staged scroll to a franchise trophy wall',
  'owner-activity': 'analytics only populate in prod — dev shows the empty state',
  'afl-owner-activity': 'analytics only populate in prod — dev shows the empty state',
};

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
  'dead-money-shame-banners': async (page) => {
    // Switch to the Brock Osweiler view so the banner AND the franchise-color
    // player-card grid are both in frame, then force lazy cutouts to load.
    await page.evaluate(() => {
      const vf = document.getElementById('view-filter');
      if (vf) { vf.value = 'brock_osweiler'; vf.dispatchEvent(new Event('change')); }
      document.querySelectorAll('.dmc__model, .dmpc__cutout').forEach((img) => { img.loading = 'eager'; });
    });
    await page.waitForTimeout(1400);
    await page.evaluate(() => {
      const el = document.getElementById('brock-osweiler-heading') || document.querySelector('.award-banner');
      if (el) el.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -90);
    });
    await page.waitForTimeout(400);
  },
};

/** Dark-capture filename for an entry image: foo.webp → foo-dark.webp */
function darkVariant(image) {
  return image.replace(/\.(\w+)$/, '-dark.$1');
}

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
    if (!hasTargets && MANUAL_CAPTURE_ONLY[e.id]) {
      if (force) {
        console.log(`  [${e.id}] SKIPPED (manual capture only): ${MANUAL_CAPTURE_ONLY[e.id]}`);
      }
      return false;
    }
    if (force) return true;
    // Capture if either half of the theme pair is missing OR stale
    // (json was updated more recently than the screenshot)
    return (
      isStale(resolve(ASSETS_DIR, e.image), jsonMtime) ||
      isStale(resolve(ASSETS_DIR, darkVariant(e.image)), jsonMtime)
    );
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
        MANUAL_CAPTURE_ONLY[e.id] &&
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

  // Playwright doesn't support webp — capture as PNG then convert
  async function shoot(page, entryId, imageName) {
    const outputPath = resolve(ASSETS_DIR, imageName);
    const pngPath = outputPath.replace(/\.webp$/, '.png');
    const isWebp = outputPath.endsWith('.webp');
    await page.screenshot({ path: isWebp ? pngPath : outputPath, type: 'png' });

    if (isWebp) {
      try {
        execFileSync('cwebp', ['-q', '85', pngPath, '-o', outputPath], { stdio: 'pipe' });
        unlinkSync(pngPath);
      } catch {
        // The referenced .webp was NOT written — the entry will render broken
        // until cwebp is installed and the capture re-run.
        console.warn(`  [${entryId}] cwebp failed — kept ${pngPath.split('/').pop()}, ${imageName} NOT written`);
        return;
      }
    }
    console.log(`  [${entryId}] saved -> ${imageName}`);
  }

  for (const entry of targets) {
    const page = await context.newPage();
    const url = entry.link ? `${BASE_URL}${entry.link}` : BASE_URL;

    console.log(`  [${entry.id}] navigating to ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      // Wait a beat for animations/transitions to settle
      await page.waitForTimeout(1000);

      // Run per-entry page hook if one exists
      if (PAGE_HOOKS[entry.id]) {
        await PAGE_HOOKS[entry.id](page);
      }

      // Light capture, then flip html.dark (the theme mechanism — resolved
      // client-side, never SSR) and capture the dark half of the pair.
      await shoot(page, entry.id, entry.image);
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.waitForTimeout(400); // let theme transitions settle
      await shoot(page, entry.id, darkVariant(entry.image));
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
