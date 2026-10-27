/**
 * Guard: league and team identity in the MFL Live app (package E).
 *
 *  - Every league this site runs has its logo rendered to the PNG the phone
 *    draws (`scripts/build-app-league-logos.mjs`): React Native cannot draw
 *    the SVG the website uses, so a league whose PNG is missing would show a
 *    broken image. Re-run the script after changing a registry `logo`.
 *  - A league we do not run gets no logo at all, never a stand-in.
 *  - The app's board carries the logo and the matchup colours, and the
 *    colours are plain #rrggbb the app can paint.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues';
import { appLeagueLogo, APP_LEAGUE_LOGO_DIR } from '../src/utils/live/app-league-logo';
import { toMflLiveAppBoard } from '../src/utils/live/mfl-live-app-view';
import { resolveMatchupColorVars } from '../src/utils/live/model';
import type { MflLiveBoard, MflLiveTeam } from '../src/types/mfl-live';

const PUBLIC = join(__dirname, '..', 'public');

function team(fid: string): MflLiveTeam {
  return {
    franchiseId: fid,
    name: `Team ${fid}`,
    nameShort: fid,
    initials: 'T',
    icon: '',
    iconAlt: '',
    rung: 'text',
    live: 0,
    projectedFinal: 0,
    yetToPlay: 0,
    players: [],
    bench: [],
  };
}

describe('league logos for the app', () => {
  const withLogo = ALL_LEAGUES.filter((l) => l.logo?.dark && existsSync(join(PUBLIC, l.logo.dark)));

  it('covers at least the leagues we run with a logo', () => {
    expect(withLogo.length).toBeGreaterThan(0);
  });

  it.each(withLogo.map((l) => [l.slug]))('%s has a rendered PNG on disk', (slug) => {
    const path = appLeagueLogo(slug);
    expect(path).toBe(`${APP_LEAGUE_LOGO_DIR}/${slug}.png`);
    expect(existsSync(join(PUBLIC, path))).toBe(true);
  });

  it('answers nothing for a league we do not run', () => {
    expect(appLeagueLogo(null)).toBe('');
    expect(appLeagueLogo('')).toBe('');
    expect(appLeagueLogo('not-a-league')).toBe('');
  });
});

describe("the app's board", () => {
  const registered = ALL_LEAGUES.find((l) => l.logo?.dark)!;
  const colorVars = resolveMatchupColorVars({ color: '#64748b' }, { color: '#64748b' }, 'mfl');
  const board: MflLiveBoard = {
    ok: true,
    week: 8,
    year: 2026,
    fetchedAt: new Date(0).toISOString(),
    leagues: [registered.slug, null].map((slug, i) => ({
      leagueId: String(i),
      leagueName: `League ${i}`,
      franchiseId: '0001',
      slug,
      registered: !!slug,
      status: 'ok' as const,
      matchups: [{ index: 0, mine: team('0001'), opponent: team('0002'), winProbability: 0.5, colorVars }],
    })),
    games: [],
    moments: [],
    redZone: [],
    playerMeta: {},
  };
  const view = toMflLiveAppBoard(board, [], 0);

  it('names the logo for a league we run, and none for one we do not', () => {
    expect(view.leagues[0].leagueLogo).toBe(appLeagueLogo(registered.slug));
    expect(view.leagues[1].leagueLogo).toBe('');
  });

  it('ships the matchup colours as #rrggbb, the two sides told apart', () => {
    const vars = view.leagues[0].matchups[0].colorVars;
    for (const key of ['--t0-dark', '--t1-dark', '--t0-ink-dark', '--t1-ink-dark']) {
      expect(vars[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // Two neutral claims still come back as two different colours.
    expect(vars['--t0-dark']).not.toBe(vars['--t1-dark']);
  });
});
