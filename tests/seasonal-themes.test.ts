/**
 * Seasonal themes (src/config/seasonal-themes.mjs): the window maths, and
 * that everything a season swaps in actually exists for every league that
 * opts in. A missing mark would render the league's normal crest in the
 * middle of an all-black-and-white page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_LEAGUES, type LeagueDefinition } from '../src/config/leagues';
import { SEASONAL_THEMES, activeSeasonalTheme, resolveSeasonPreview } from '../src/config/seasonal-themes.mjs';
import { getLeagueTeams } from '../src/utils/league-config';
import { buildAllTeamIconDarkCss } from '../src/utils/team-icon-dark-styles';
import { buildSeasonalMarkCss, seasonalMarkIds } from '../src/utils/seasonal-mark-css';

const ROOT = path.resolve(__dirname, '..');
const at = (iso: string) => activeSeasonalTheme(['halloween'], new Date(iso))?.id ?? null;

describe('Halloween window', () => {
  it('opens ten days before Halloween, at midnight Pacific', () => {
    expect(at('2026-10-21T06:59:00Z')).toBeNull(); // Oct 20, 11:59pm PDT
    expect(at('2026-10-21T07:00:00Z')).toBe('halloween');
  });

  it('runs through the Monday night game of Halloween week (Nov 2 in 2026)', () => {
    expect(at('2026-11-03T07:59:00Z')).toBe('halloween'); // Nov 2, 11:59pm PST
    expect(at('2026-11-03T08:00:00Z')).toBeNull();
  });

  it('ends on the first Monday on or after Oct 31 every year', () => {
    const end = (y: number) => SEASONAL_THEMES.halloween.window(y).end;
    expect(end(2027)).toEqual({ y: 2027, m: 11, d: 1 });
    expect(end(2028)).toEqual({ y: 2028, m: 11, d: 6 });
    expect(end(2033)).toEqual({ y: 2033, m: 10, d: 31 }); // Halloween on a Monday
  });

  it('a preview opens the season early, only for a league that wears it', () => {
    const oct18 = new Date('2026-10-18T19:00:00Z');
    expect(activeSeasonalTheme(['halloween'], oct18)).toBeNull();
    expect(activeSeasonalTheme(['halloween'], oct18, 'halloween')?.id).toBe('halloween');
    expect(activeSeasonalTheme(undefined, oct18, 'halloween')).toBeNull();
    expect(activeSeasonalTheme(['halloween'], oct18, 'nope')).toBeNull();
  });

  it('?seasonPreview= sets, keeps and clears the session preview', () => {
    expect(resolveSeasonPreview('Halloween', undefined)).toEqual({ kind: 'set', id: 'halloween' });
    expect(resolveSeasonPreview(null, 'halloween')).toEqual({ kind: 'keep', id: 'halloween' });
    expect(resolveSeasonPreview(null, 'bogus')).toEqual({ kind: 'keep', id: null });
    expect(resolveSeasonPreview('off', 'halloween')).toEqual({ kind: 'clear' });
  });

  it('is off for a league that does not opt in', () => {
    expect(activeSeasonalTheme(undefined, new Date('2026-10-25T12:00:00Z'))).toBeNull();
  });
});

describe('opted-in leagues', () => {
  const optedIn: LeagueDefinition[] = ALL_LEAGUES.filter((l: LeagueDefinition) => l.seasonalThemes?.length);

  it('TheLeague wears Halloween, with all 16 marks drawn', () => {
    expect(optedIn.map((l) => l.slug)).toContain('theleague');
    expect(seasonalMarkIds('theleague', 'halloween').size).toBe(16);
  });

  it('the AFL wears Halloween, with all 24 marks drawn', () => {
    expect(optedIn.map((l) => l.slug)).toContain('afl-fantasy');
    expect(seasonalMarkIds('afl', 'halloween').size).toBe(24);
  });

  it('a franchise with no drawn mark keeps its crest (no rule is emitted for it)', () => {
    const css = buildSeasonalMarkCss('theleague', ['halloween'], [{ franchiseId: '0099', icon: '/x/undrawn.png' }]);
    expect(css).toBe('');
  });

  for (const league of optedIn) {
    for (const id of league.seasonalThemes!) {
      const season = SEASONAL_THEMES[id];
      it(`${league.slug}: "${id}" names a known season and palette`, () => {
        expect(season).toBeTruthy();
        expect(fs.existsSync(path.join(ROOT, 'src/themes', `${season.theme}.json`))).toBe(true);
      });
      if (!season?.marks) continue;
      it(`${league.slug}: every listed ${id} mark is a real franchise with a built file`, () => {
        const franchises = new Set(getLeagueTeams(league.navSlug).map((t) => t.franchiseId));
        for (const fid of seasonalMarkIds(league.navSlug, id)) {
          expect(franchises.has(fid), `${fid} is not a ${league.slug} franchise`).toBe(true);
          expect(fs.existsSync(path.join(ROOT, 'public/assets', league.navSlug, season.marks!, `${fid}.png`)), `${fid}.png not built`).toBe(true);
        }
      });
    }
  }

  it('every mark swap is scoped to its league and season', () => {
    const blocks = buildAllTeamIconDarkCss()
      .split('}')
      .filter((b) => b.includes('halloween-marks'));
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      for (const selector of block.split('{')[0]!.split(',')) {
        expect(selector).toMatch(/html\[data-league="\w+"\]\[data-season="halloween"\] img\[src=/);
      }
    }
  });
});
