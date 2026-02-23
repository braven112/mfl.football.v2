/**
 * Takes cropped screenshots (no site header) of all whats-new feature pages.
 * Outputs WebP images for use as hero/card images in the What's New system.
 *
 * Usage: node scripts/screenshot-whats-new.mjs [--port 4321]
 */

import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '4321';

const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = resolve(ROOT, 'public/assets/whats-new');

// Read whats-new.json
const entries = JSON.parse(
  readFileSync(resolve(ROOT, 'src/data/whats-new.json'), 'utf-8')
);

// Build screenshot tasks: one per entry that has a link
const tasks = entries
  .filter((e) => e.link)
  .map((e) => ({
    id: e.id,
    url: `${BASE_URL}${e.link}`,
    filename: `${e.id}.png`,
  }));

console.log(`\n📸 Taking ${tasks.length} screenshots on ${BASE_URL}\n`);

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2, // Retina quality
});

for (const task of tasks) {
  const page = await context.newPage();
  try {
    console.log(`  → ${task.id}: ${task.url}`);
    await page.goto(task.url, { waitUntil: 'networkidle', timeout: 15000 });

    // Wait a beat for any animations/transitions to settle
    await page.waitForTimeout(500);

    // Hide the site header/nav so the screenshot shows only page content.
    // This covers both the legacy header and the nav-drawer layout.
    await page.evaluate(() => {
      const selectors = [
        '.breadcrumb-bar',     // "Back to MFL" top bar
        '.container-header',   // main logo + nav icons header
        '.nav-header',         // nav-drawer header bar
        '.top-bar',            // generic top bar
      ];
      selectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          el.style.display = 'none';
        });
      });
      window.scrollTo(0, 0);
    });

    // Let layout reflow after hiding headers
    await page.waitForTimeout(200);

    const pngPath = resolve(OUT_DIR, task.filename);
    const webpPath = pngPath.replace('.png', '.webp');

    await page.screenshot({
      path: pngPath,
      clip: { x: 0, y: 0, width: 1280, height: 720 }, // 16:9
    });

    // Convert PNG to WebP using cwebp
    try {
      execSync(`cwebp -q 85 "${pngPath}" -o "${webpPath}"`, { stdio: 'pipe' });
      // Remove the intermediate PNG
      execSync(`rm "${pngPath}"`);
      console.log(`    ✅ ${task.id}.webp`);
    } catch (err) {
      console.log(`    ⚠️  cwebp failed, keeping PNG: ${err.message}`);
    }
  } catch (err) {
    console.log(`    ❌ Failed: ${err.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();

console.log(`\n✅ Done! Screenshots saved to public/assets/whats-new/\n`);
