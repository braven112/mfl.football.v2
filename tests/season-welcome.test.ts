import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { buildSeasonWelcome } from '../src/utils/season-welcome';
import { SEASONAL_THEMES } from '../src/config/seasonal-themes.mjs';
import { seasonalMarkIds } from '../src/utils/seasonal-mark-css';

const ROOT = path.resolve(__dirname, '..');
const XMAS = SEASONAL_THEMES.christmas;
const NOW = new Date('2026-12-22T18:00:00Z');

describe('buildSeasonWelcome', () => {
  it('shows a signed-in owner their own drawn Christmas mark', () => {
    for (const league of ['theleague', 'afl'] as const) {
      for (const fid of seasonalMarkIds(league, 'christmas')) {
        const w = buildSeasonWelcome({ league, franchiseId: fid, season: XMAS, now: NOW });
        expect(w, `${league} ${fid}`).not.toBeNull();
        expect(w!.crest).toMatch(new RegExp(`^/assets/${league}/christmas-marks/${fid}\\.png(\\?v=[0-9a-f]+)?$`));
        expect(fs.existsSync(path.join(ROOT, 'public', w!.crest.split('?')[0]))).toBe(true);
        expect(w!.storageKey).toBe(`season-welcome:${league}:christmas:2026`);
      }
    }
  });

  it('names the day the normal logos come back (the day after the window)', () => {
    const w = buildSeasonWelcome({ league: 'theleague', franchiseId: '0001', season: XMAS, now: NOW });
    expect(w?.returns).toBe('Tuesday, Dec 29');
    expect(w?.seasonName).toBe('Christmas Week');
  });

  it('says nothing without a session, a season, or a season that asks for it', () => {
    expect(buildSeasonWelcome({ league: 'theleague', franchiseId: null, season: XMAS, now: NOW })).toBeNull();
    expect(buildSeasonWelcome({ league: 'theleague', franchiseId: '0001', season: null, now: NOW })).toBeNull();
    // Halloween has no welcome (owner asked for Christmas, Oct 2026).
    expect(
      buildSeasonWelcome({ league: 'theleague', franchiseId: '0001', season: SEASONAL_THEMES.halloween, now: NOW }),
    ).toBeNull();
  });

  it('the layout keys it off the SESSION franchise and the open season', () => {
    const layout = readFileSync('src/layouts/TheLeagueLayout.astro', 'utf8');
    expect(layout).toMatch(/buildSeasonWelcome\(\{\s*league,\s*franchiseId:\s*sessionFranchiseId,\s*season,/);
  });
});
