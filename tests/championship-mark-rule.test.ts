/**
 * Which championship mark a surface shows (Brandon, Oct 2026).
 *
 *  - TEAM-CENTRIC: a title a club has WON hangs as its own pennant (team
 *    colors, the logo it won under) in the Rafters — HistoryRafters.astro, on
 *    League History home and the franchise and owner pages. Nowhere else.
 *  - LEAGUE-WIDE: the award's own badge (public/assets/afl/awards/) stands for
 *    what COULD be won: the homepage standings' division shield, the playoff
 *    prizes. It also sits beside a team already shown (the footer champions
 *    band under its banner, a Franchises index card's title counts). In a seasonal theme it
 *    wears that season's drawing, Christmas's knitted PNGs included.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(astro|tsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The Rafters' homes: League History home, and the franchise and owner pages (owner sections). */
const RAFTER_SURFACES = [
  'src/components/shared/league-history/HistoryHomePage.astro',
  'src/components/shared/league-history/HistoryFranchisePage.astro',
  'src/components/shared/league-history/HistoryOwnerSections.astro',
];

describe('team-centric title banners hang only in the Rafters', () => {
  it('renders HistoryRafters from Rafters surfaces alone', () => {
    const importers = walk(path.join(ROOT, 'src'))
      .filter((f) => /import\s+HistoryRafters\b/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f))
      .sort();
    // A new caller showing a WON title outside the Rafters uses the league-wide
    // badge instead; one showing the Rafters themselves is added here.
    expect(importers).toEqual([...RAFTER_SURFACES].sort());
  });

  it("keeps the league-wide badge off the owner page's won-title chips", () => {
    // The page hangs those titles in its Rafters; the chips are text only.
    const page = fs.readFileSync(path.join(ROOT, 'src/components/shared/owners/OwnerDetailPage.astro'), 'utf8');
    expect(page).not.toMatch(/getAwardBadge|\/assets\/afl\/awards\//);
  });
});

describe('league-wide badges wear the season, PNG drawings included', () => {
  it('inlines every Christmas badge drawing on the plain badge box', async () => {
    const { aflBadgeSvgs } = await import('../src/utils/afl-badge-art');
    const set = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'src/data/seasonal-marks/afl-christmas.json'), 'utf8'),
    ) as { _swaps: Record<string, string> };
    const normal = aflBadgeSvgs(null);
    const christmas = aflBadgeSvgs('christmas');
    const awards = Object.entries(set._swaps).filter(([from]) => from.startsWith('/assets/afl/awards/'));
    expect(awards.length).toBeGreaterThan(0);
    for (const [from, to] of awards) {
      const file = from.slice('/assets/afl/awards/'.length);
      const art = christmas[file]!;
      expect(art, file).toContain(`href="/assets/afl/christmas-marks/${to}"`);
      expect(fs.existsSync(path.join(ROOT, 'public/assets/afl/christmas-marks', to)), to).toBe(true);
      // same box as the badge it replaces, so a sized slot does not change
      expect(art.match(/viewBox="[^"]+"/)?.[0], file).toBe(normal[file]!.match(/viewBox="[^"]+"/)?.[0]);
    }
    // a badge Christmas does not redraw keeps its art
    expect(christmas['nit.svg']).toBe(normal['nit.svg']);
  });
});
