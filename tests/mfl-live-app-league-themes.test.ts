/**
 * League themes in the MFL Football app (store-app plan decision 22).
 *
 * 1. The committed colors are exactly what the builder makes from today's
 *    website themes, so a theme edit cannot leave the app on stale colors.
 * 2. Every role is a plain hex, and every pairing a screen draws clears
 *    WCAG AA, so no league's theme ships unreadable text.
 * 3. The server offers a theme only for a league we run, once per league.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  AA_BODY,
  APP_LEAGUE_THEMES_FILE,
  buildAppLeagueThemes,
  contrast,
  serializeAppLeagueThemes,
} from '../scripts/lib/app-league-themes.mjs';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { appLeagueThemesFor } from '../src/utils/live/app-league-themes';
import { APP_LEAGUE_THEMES } from '../src/config/mfl-live-app-league-themes.generated';

const committed = fs.readFileSync(path.join(process.cwd(), APP_LEAGUE_THEMES_FILE), 'utf8');
const themes = APP_LEAGUE_THEMES;

describe('app league themes data', () => {
  it('matches the builder (run node scripts/build-app-league-themes.mjs)', () => {
    expect(committed).toBe(serializeAppLeagueThemes(buildAppLeagueThemes()));
  });

  it('covers every registry league that names a theme', () => {
    for (const league of ALL_LEAGUES) {
      if (league.theme) expect(themes[league.slug], league.slug).toBeDefined();
    }
  });

  it('every role is a 6-digit hex', () => {
    for (const [slug, { colors }] of Object.entries(themes)) {
      for (const [role, value] of Object.entries(colors)) {
        expect(value, `${slug}.${role}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('every text role reads on both surfaces, and onAccent on accent', () => {
    for (const [slug, { colors }] of Object.entries(themes)) {
      for (const role of ['text', 'muted', 'accentText'] as const) {
        const ink = colors[role];
        if (!ink) continue;
        for (const ground of [colors.ground, colors.card]) {
          if (ground) expect(contrast(ink, ground), `${slug}.${role} on ${ground}`).toBeGreaterThanOrEqual(AA_BODY);
        }
      }
      if (colors.accent) {
        expect(contrast(colors.onAccent, colors.accent), `${slug} onAccent`).toBeGreaterThanOrEqual(AA_BODY);
      }
    }
  });

  it('every league we run gets a full theme today', () => {
    for (const [slug, { colors }] of Object.entries(themes)) {
      expect(Object.keys(colors).sort(), slug).toEqual(
        ['accent', 'accentText', 'border', 'card', 'field', 'ground', 'muted', 'onAccent', 'text'],
      );
    }
  });
});

describe('appLeagueThemesFor', () => {
  const ours = ALL_LEAGUES.filter((l) => themes[l.slug]);

  it('offers only leagues we run, once each, in the order given', () => {
    const [a, b] = ours;
    const got = appLeagueThemesFor(['1', b.id, a.id, b.id]);
    expect(got.map((t) => t.slug)).toEqual([b.slug, a.slug]);
    expect(got[0]).toMatchObject({ leagueId: b.id, name: b.name, colors: themes[b.slug].colors });
  });

  it('answers nothing for an account with no league on our platform', () => {
    expect(appLeagueThemesFor(['12345', '67890'])).toEqual([]);
  });
});
