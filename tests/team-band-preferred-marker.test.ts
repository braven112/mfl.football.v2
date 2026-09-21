/**
 * The "your team" marker on a banded standings row, and the two things that
 * make it safe — neither of which is the measurement the rest of the band uses.
 *
 * The marker is a bar in the club's SECONDARY colour (`band.trim`). Two earlier
 * shapes failed, and this suite exists so neither comes back:
 *
 * 1. An ink ring around the whole row. Legible, but it boxed the band in and
 *    read as clutter.
 * 2. A `border-right` in the trim. A border sits at the cell's OUTER edge,
 *    against the CARD — and the trim is the club's raw secondary, so the seven
 *    clubs wearing #e9e9e9 lost it on the white card (1.21:1) and the sixteen
 *    wearing #181818 lost it on the dark one (1.17:1). Their row read as
 *    stopping 6px short rather than as carrying a mark.
 *
 * What ships is a pseudo-element floated INSIDE the row, so the bar only ever
 * abuts the fill. That is the first thing pinned here, because "simplify this
 * to a border" is the obvious-looking edit that silently reintroduces (2).
 *
 * The second is the floor it is measured at. Everywhere else in this system the
 * band measures WCAG contrast, and applying that here would condemn 19 of the
 * 40 franchises — including the Micks at 1.00:1, whose orange secondary on
 * their green fill is *completely legible*. WCAG contrast is luminance-only; it
 * is the right question for text and the wrong one for a solid block of colour,
 * where hue does the work. So the floor is CIE76 ΔE, and the census below is
 * what says that holds for every club in every league rather than for the two
 * anyone happened to look at.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import theleagueConfig from '../src/data/theleague.config.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import bb1Config from '../data/best-ball-1/bb1.config.json';
import { colorDistance } from '../src/utils/team-color-contrast';
import { resolveTeamBand } from '../src/utils/team-band';
import type { LeagueSlug } from '../src/types/nav';

/**
 * CIE76 ΔE at which two solid colours read as different colours rather than as
 * a shade of one. `colorDistance`'s own doc puts that at ~25.
 *
 * The worst pair in either league today is Badd Boys' #474749 on #8b8b8b at
 * 27.7, with nothing under 20 — so this is a real floor with real headroom, not
 * a number fitted to the current data. A franchise re-colour that drops a club
 * below it takes its owner's marker with it, which is the whole point of
 * measuring every club rather than sampling.
 */
const MIN_MARKER_DELTA_E = 25;

const LEAGUES: Array<{ slug: LeagueSlug; teams: any[] }> = [
  { slug: 'theleague', teams: (theleagueConfig as any).teams ?? [] },
  { slug: 'afl', teams: (aflConfig as any).teams ?? [] },
  { slug: 'bb1', teams: (bb1Config as any).teams ?? [] },
];

const STANDINGS = resolve(__dirname, '../src/components/theleague/standings/StandingsTable.astro');

describe('band preferred-team marker — the trim reads on every fill', () => {
  for (const { slug, teams } of LEAGUES) {
    it(`${slug}: the secondary clears ΔE ${MIN_MARKER_DELTA_E} on the fill, both themes`, () => {
      expect(teams.length).toBeGreaterThan(0);
      const failures: string[] = [];
      for (const team of teams) {
        const band = resolveTeamBand(team.franchiseId, slug);
        const light = colorDistance(band.trim, band.fill);
        const dark = colorDistance(band.trim, band.fillDark);
        if (light < MIN_MARKER_DELTA_E) {
          failures.push(`${team.name} light ΔE ${light.toFixed(1)} (${band.trim} on ${band.fill})`);
        }
        if (dark < MIN_MARKER_DELTA_E) {
          failures.push(`${team.name} dark ΔE ${dark.toFixed(1)} (${band.trim} on ${band.fillDark})`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it('is measured perceptually, not by the luminance ratio the ink uses', () => {
    // The Micks are the standing proof that these are different questions:
    // identical luminance, obviously different colours. If this ever stops
    // being true the club was re-coloured, and the comment above needs its
    // example replaced — not the floor relaxed.
    const band = resolveTeamBand('0013', 'afl');
    expect(colorDistance(band.trim, band.fill)).toBeGreaterThan(MIN_MARKER_DELTA_E);
  });
});

describe('band preferred-team marker — it is drawn inside the row', () => {
  const css = readFileSync(STANDINGS, 'utf8');

  it('draws the bar as a pseudo-element, never as a border against the card', () => {
    // The trim is measured against the FILL above and nothing else, so the bar
    // has to sit on the fill to inherit that guarantee. A border on the last
    // cell sits against the card instead, where ~23 club/theme pairs vanish.
    expect(css).toMatch(
      /tbody tr\.st-row--band\.preferred-team td:last-child::after\s*\{[^}]*background-color:\s*var\(--band-trim\)/,
    );
    expect(css).not.toMatch(
      /tbody tr\.st-row--band\.preferred-team td:last-child\s*\{[^}]*border-(right|left):\s*\d/,
    );
  });

  it('keeps the bar clear of the card edge on one side and the value on the other', () => {
    // A flat `right` put it 0.6px off the PA value; moving it out instead puts
    // it back against the card. It is centred in the cell's own padding.
    const rule = /td:last-child::after\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/right:\s*calc\(/);
  });

  it('suppresses the row border the trim edge used to cover', () => {
    // `.v-std tr.preferred-team` draws its own 3px accent border on the `tr`.
    // With the band's trim edge gone that was the only thing left in the left
    // gutter, so your team alone grew a stray coloured sliver against the card.
    expect(css).toMatch(
      /tbody tr\.st-row--band\.preferred-team,\s*:global\(html\.dark\) tbody tr\.st-row--band\.preferred-team\s*\{[^}]*border-left:\s*none/,
    );
  });
});
