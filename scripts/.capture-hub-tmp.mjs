/**
 * Staged capture for the `transaction-hub` What's New entry.
 *
 * The hub is a MODAL on every page, opened by the header bell, and its two
 * waiver screens are auth-gated — so a blind capture of a link shoots a page
 * with no modal on it. This stages the signed-in state without a session:
 * the SSR config blob is rewritten in the DOM (the hub script re-reads it on
 * every call, by design) and the two live reads are stubbed at the network
 * layer.
 */
import { chromium } from 'playwright';
import { execFileSync, } from 'child_process';
import { unlinkSync } from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:57884';
const OUT = process.argv[2];
const TEAMS = JSON.parse(process.env.TEAMS);
// MFL's real order for TheLeague, read live on 2026-09-05 (Pigskins last).
const ORDER = JSON.parse(process.env.ORDER);

const CLAIMS = {
  success: true,
  claims: [
    { round: '1', index: 0, addPlayerId: '16617', dropPlayerId: '15255', bid: 34,
      addName: 'Coleman, Keon', addPosition: 'WR', addNflTeam: 'BUF',
      dropName: 'Gainwell, Kenneth', dropPosition: 'RB', dropNflTeam: 'PHI' },
    { round: '1', index: 1, addPlayerId: '16080', dropPlayerId: null, bid: 12,
      addName: 'Shaheed, Rashid', addPosition: 'WR', addNflTeam: 'SEA', dropName: null },
  ],
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
const page = await context.newPage();

await page.route('**/api/waiver-claims*', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLAIMS) }));

// The live order needs an owner session too. Stub MFL's real 2026 order so the
// hub's rank chip and the priority screen both render a truthful-looking line.
await page.route('**/api/waiver-order*', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    success: true, year: 2026, asOf: new Date().toISOString(), live: true,
    franchiseId: '0001', system: 'bbid',
    order: ORDER,
  }) }));

// mockTrades seeds the trade sections so the hub shows all three rows with
// something in them — a hub whose top row reads "Nothing pending" undersells
// the thing being announced.
await page.goto(`${BASE}/afl-fantasy/standings?mockTrades=2`, { waitUntil: 'networkidle' });

await page.evaluate((teams) => {
  const el = document.getElementById('transaction-hub-config');
  if (el) el.textContent = JSON.stringify({
    signedIn: true, franchiseId: '0001', conferenceName: 'American League',
    teams, freeAgentsPath: '/afl-fantasy/players', showWaiverPriority: true,
  });
}, TEAMS);

await page.evaluate(() => document.dispatchEvent(new CustomEvent('waiver-claims:changed')));
await page.waitForTimeout(800);
// mockTrades auto-opens on the trades list; back out to the hub home, which
// is the screen the entry is about.
await page.waitForTimeout(600);
await page.click('#thm-list-back');
await page.waitForTimeout(2500);

for (const [suffix, dark] of [['', false], ['-dark', true]]) {
  if (dark) {
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(600);
  }
  const webp = OUT.replace(/\.webp$/, `${suffix}.webp`);
  const png = webp.replace(/\.webp$/, '.png');
  await page.screenshot({ path: png, type: 'png' });
  execFileSync('cwebp', ['-q', '85', png, '-o', webp], { stdio: 'pipe' });
  unlinkSync(png);
  console.log('saved', webp);
}

await browser.close();
