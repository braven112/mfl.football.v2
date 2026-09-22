/**
 * Team band guard — every franchise, both themes, both floors.
 *
 * The band paints a franchise's own colour as the row surface, so the two
 * things that can go wrong are invisible text and an invisible row. Each has
 * already shipped elsewhere on this site from the same root cause — a brand
 * colour used raw as a fill: the Pecking Order's rank numerals vanished in dark
 * mode, and the broadcast board's full-screen reveal rendered as a black
 * rectangle for the seven TheLeague franchises wearing `#181818`.
 *
 * This is a CENSUS, not a sample: it walks every franchise in every league in
 * the registry, so adding a league or re-colouring a club is checked by the
 * build rather than by whoever happens to look at that division page.
 */
import { describe, it, expect } from 'vitest';
import theleagueConfig from '../src/data/theleague.config.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import bb1Config from '../data/best-ball-1/bb1.config.json';
import { contrastRatio, colorDistance } from '../src/utils/team-color-contrast';
import {
  resolveTeamBand,
  resolveTeamBandForBodyText,
  BAND_INK_BODY_MIN_RATIO,
  DARK_INK_COMFORT_RATIO,
  bandCrestSrc,
  teamBandStyle,
  BAND_INK_DARK,
  BAND_INK_LIGHT,
  BAND_INK_MIN_RATIO,
  BAND_SURFACE_LIGHT,
  BAND_SURFACE_DARK,
  BAND_SURFACE_MIN_RATIO,
} from '../src/utils/team-band';
import type { LeagueSlug } from '../src/types/nav';

const LEAGUES: Array<{ slug: LeagueSlug; teams: any[] }> = [
  { slug: 'theleague', teams: (theleagueConfig as any).teams ?? [] },
  { slug: 'afl', teams: (aflConfig as any).teams ?? [] },
  { slug: 'bb1', teams: (bb1Config as any).teams ?? [] },
];

describe('team band — ink is readable on every franchise fill', () => {
  for (const { slug, teams } of LEAGUES) {
    it(`${slug}: ink clears ${BAND_INK_MIN_RATIO}:1 on the fill in both themes`, () => {
      expect(teams.length).toBeGreaterThan(0);
      const failures: string[] = [];
      for (const team of teams) {
        const band = resolveTeamBand(team.franchiseId, slug);
        const light = contrastRatio(band.ink, band.fill);
        const dark = contrastRatio(band.inkDark, band.fillDark);
        if (!(light >= BAND_INK_MIN_RATIO)) {
          failures.push(`${team.name} light ${light.toFixed(2)}:1 (${band.ink} on ${band.fill})`);
        }
        if (!(dark >= BAND_INK_MIN_RATIO)) {
          failures.push(`${team.name} dark ${dark.toFixed(2)}:1 (${band.inkDark} on ${band.fillDark})`);
        }
      }
      expect(failures).toEqual([]);
    });

    it(`${slug}: the band separates from the card in both themes`, () => {
      const failures: string[] = [];
      for (const team of teams) {
        const band = resolveTeamBand(team.franchiseId, slug);
        const light = contrastRatio(band.fill, BAND_SURFACE_LIGHT);
        const dark = contrastRatio(band.fillDark, BAND_SURFACE_DARK);
        if (!(light >= BAND_SURFACE_MIN_RATIO)) {
          failures.push(`${team.name} light ${light.toFixed(2)}:1 (${band.fill} on white card)`);
        }
        if (!(dark >= BAND_SURFACE_MIN_RATIO)) {
          failures.push(`${team.name} dark ${dark.toFixed(2)}:1 (${band.fillDark} on ${BAND_SURFACE_DARK})`);
        }
      }
      expect(failures).toEqual([]);
    });

    it(`${slug}: the ink is one of the two band inks, never an invented shade`, () => {
      for (const team of teams) {
        const band = resolveTeamBand(team.franchiseId, slug);
        expect([BAND_INK_DARK, BAND_INK_LIGHT]).toContain(band.ink);
        expect([BAND_INK_DARK, BAND_INK_LIGHT]).toContain(band.inkDark);
      }
    });
  }
});

describe('team band — the body-floor variant, for surfaces with small type', () => {
  // `resolveTeamBandForBodyText` exists because the draft order grid paints a
  // 101px card whose lines are 14.2px, 16.5px and 11.8px — text that cannot
  // claim the 3:1 large-text floor the standard band is measured at. A census
  // again, for the same reason: the cost of the higher floor is paid per
  // franchise, and a re-colour is exactly when it would start going unpaid.
  for (const { slug, teams } of LEAGUES) {
    it(`${slug}: ink clears ${BAND_INK_BODY_MIN_RATIO}:1 on the fill in both themes`, () => {
      expect(teams.length).toBeGreaterThan(0);
      const failures: string[] = [];
      for (const team of teams) {
        const band = resolveTeamBandForBodyText(team.franchiseId, slug);
        const light = contrastRatio(band.ink, band.fill);
        const dark = contrastRatio(band.inkDark, band.fillDark);
        if (!(light >= BAND_INK_BODY_MIN_RATIO)) {
          failures.push(`${team.name} light ${light.toFixed(2)}:1 (${band.ink} on ${band.fill})`);
        }
        if (!(dark >= BAND_INK_BODY_MIN_RATIO)) {
          failures.push(`${team.name} dark ${dark.toFixed(2)}:1 (${band.inkDark} on ${band.fillDark})`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it('wears the SAME ink at both floors, for every franchise', () => {
    // A club must not read white in the standings and near-black in the draft
    // grid. That shipped briefly and Brandon caught it on a phone.
    //
    // It holds by construction rather than by luck: the white/dark decision is
    // made against `DARK_INK_COMFORT_RATIO`, which does not depend on the
    // surface's floor, so raising the floor can only move the FILL. If this
    // ever fails, someone has made the ink choice floor-dependent again.
    const flips: string[] = [];
    for (const { slug, teams } of LEAGUES) {
      for (const team of teams) {
        const large = resolveTeamBand(team.franchiseId, slug);
        const body = resolveTeamBandForBodyText(team.franchiseId, slug);
        if (large.ink !== body.ink) flips.push(`${team.name} light: ${large.ink} -> ${body.ink}`);
        if (large.inkDark !== body.inkDark) {
          flips.push(`${team.name} dark: ${large.inkDark} -> ${body.inkDark}`);
        }
      }
    }
    expect(flips).toEqual([]);
  });

  it('keeps a moved fill inside the same colour', () => {
    // The body floor's real cost. Eight clubs darken to hold white ink —
    // the Micks ΔE 15.2, Best Ball's Franchise 04 16.2 — which is a visibly
    // deeper shade and deliberately so: near-black on their untouched
    // mid-tone measured 4.89-5.84 and read badly on a phone.
    //
    // 20 is the ceiling because ~25 is where two colours stop being shades of
    // each other. Past that a club is being repainted rather than darkened,
    // which is a design decision and should not arrive as a side effect of a
    // re-colour.
    const drifted: string[] = [];
    for (const { slug, teams } of LEAGUES) {
      for (const team of teams) {
        const large = resolveTeamBand(team.franchiseId, slug);
        const body = resolveTeamBandForBodyText(team.franchiseId, slug);
        const delta = Math.max(
          colorDistance(large.fill, body.fill),
          colorDistance(large.fillDark, body.fillDark),
        );
        if (delta > 20) drifted.push(`${team.name} ΔE ${delta.toFixed(1)}`);
      }
    }
    expect(drifted).toEqual([]);
  });
});

describe('team band — dark ink only where it is comfortable', () => {
  // Brandon, reading the AFL draft grid on a phone: "the dark text is hard to
  // read on these other than Jocks and Midwest". AA is a luminance quotient
  // and does not express this — a mid-tone can clear 4.5:1 against near-black
  // and still be dark enough that the eye wants light text.
  //
  // So dark ink has to clear AAA, and the census is what keeps that true for
  // clubs nobody happens to look at. The AFL's fills separated with a gap and
  // nothing in it: comfortable from 8.36:1 up, uncomfortable from 5.84 down.
  for (const { slug, teams } of LEAGUES) {
    it(`${slug}: every dark-ink band clears ${DARK_INK_COMFORT_RATIO}:1`, () => {
      const failures: string[] = [];
      for (const team of teams) {
        for (const resolve of [resolveTeamBand, resolveTeamBandForBodyText]) {
          const band = resolve(team.franchiseId, slug);
          for (const [fill, ink] of [[band.fill, band.ink], [band.fillDark, band.inkDark]]) {
            if (ink !== BAND_INK_DARK) continue;
            const cr = contrastRatio(ink, fill);
            if (cr < DARK_INK_COMFORT_RATIO) {
              failures.push(`${team.name} ${cr.toFixed(2)}:1 (dark on ${fill})`);
            }
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('team band — a legible brand colour is left alone', () => {
  it('returns the config colour untouched when it already clears both floors', () => {
    // The Micks' green is the reference design's own band: white ink measures
    // 4.6:1 on it and it is nowhere near either card. Nothing to solve.
    const band = resolveTeamBand('0013', 'afl');
    expect(band.fill).toBe('#42a349');
    expect(band.ink).toBe(BAND_INK_LIGHT);
  });

  it('flips to dark ink rather than darkening a gold fill', () => {
    // Chatmaster. White on this gold is 2.0:1; the fix is the ink, not the hue.
    const band = resolveTeamBand('0021', 'afl');
    expect(band.fill).toBe('#cfad30');
    expect(band.ink).toBe(BAND_INK_DARK);
  });

  it('lifts a near-black fill off the dark card instead of leaving a hole', () => {
    // Vitside Mafia, #181818 — 1.06:1 against the dark card unfloored.
    const band = resolveTeamBand('0009', 'afl');
    expect(contrastRatio(band.fillDark, BAND_SURFACE_DARK)).toBeGreaterThanOrEqual(
      BAND_SURFACE_MIN_RATIO,
    );
    expect(band.inkDark).toBe(BAND_INK_LIGHT);
  });

  it('carries both themes into the style declaration, picking neither', () => {
    const style = teamBandStyle(resolveTeamBand('0013', 'afl'));
    expect(style).toContain('--band-fill:');
    expect(style).toContain('--band-fill-dark:');
    expect(style).toContain('--band-ink:');
    expect(style).toContain('--band-ink-dark:');
  });
});

describe('team band — the crest is chosen by the fill, not the theme', () => {
  it('takes the dark cut onto a dark fill', () => {
    // Chatmaster's light crest is the AIM runner in a gold frame, which is
    // exactly the artwork that disappears on a band. Its fill is light, so the
    // light crest stays; Computer Jocks (#181818) is the dark-fill case.
    const jocks = bandCrestSrc('/assets/afl/icons/computer_jocks.png', 'afl', true);
    expect(jocks).toBe('/assets/afl/icons/computer_jocks_dark.png');
  });

  it('leaves the light crest alone on a light fill', () => {
    const light = bandCrestSrc('/assets/afl/icons/chat.png', 'afl', false);
    expect(light).toBe('/assets/afl/icons/chat.png');
  });

  it('keeps an era crest that has no dark cut rather than dropping it', () => {
    const era = bandCrestSrc('/assets/afl/history/smokane_2003_icon.png', 'afl', true);
    expect(era).toBe('/assets/afl/history/smokane_2003_icon.png');
  });
});
