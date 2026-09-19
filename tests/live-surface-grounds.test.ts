/**
 * `SURFACE_GROUNDS` must match the real `--card-surface` tokens.
 *
 * Those literals are the background every franchise colour on a live board is
 * judged legible against (`resolveTeamColorPair` → `ensureFieldOn`). They have
 * to be literals: this resolve runs on the SERVER, and with `theme_pref: auto`
 * the server never learns which theme will apply, so it answers for both and
 * lets CSS pick.
 *
 * Which makes them a copy of a value that lives somewhere else — and the
 * failure mode of drift is the quietest kind there is. A wrong ground does not
 * throw and does not look broken; it gives a CONFIDENT, WRONG legibility
 * answer. Seven TheLeague franchises carry `#181818` and several NFL club
 * primaries are near-black, so a card judged against the wrong dark ground
 * ships a colour that is invisible on the one it actually renders on, in only
 * one theme, for only some franchises.
 *
 * `toBroadcastPair` cannot save it either: that helper only ever DARKENS, so
 * it cannot make a colour visible. The ground is the whole input.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SURFACE_GROUNDS, surfaceForLeague, type LiveSurface } from '../src/utils/live/surface';
import { resolveMatchupColorVars } from '../src/utils/live/model';
import {
  colorDistance,
  DEFAULT_MIN_BG_CONTRAST,
  resolveTeamColorPair,
} from '../src/utils/team-color-contrast';
import type { FranchiseColorClaim } from '../src/utils/mfl-live-identity';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

/** Every franchise in one league's config, as a colour claim. */
function loadTeams(configPath: string): Array<{ franchiseId: string; name: string; claim: FranchiseColorClaim }> {
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), configPath), 'utf-8'));
  return (raw.teams ?? []).map((t: Record<string, string>) => ({
    franchiseId: t.franchiseId,
    name: t.name,
    claim: {
      color: t.color ?? t.colorPrimary,
      colorPrimary: t.colorPrimary,
      colorSecondary: t.colorSecondary,
      colorPrimaryDark: t.colorPrimaryDark,
      colorSecondaryDark: t.colorSecondaryDark,
    },
  }));
}

/**
 * Comments are stripped FIRST. A scan guard that reads raw CSS is satisfied by
 * a commented-out block, which makes it worse than no guard at all — it reads
 * as coverage while asserting about prose.
 */
const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const LIGHT = read('src/styles/tokens.css');
const DARK = read('src/styles/tokens-dark.css');

/**
 * The value `--card-surface` resolves to under `selector`, following one level
 * of `var()` indirection (light declares it as `var(--color-white)`).
 *
 * Reads the LAST matching declaration in file order, not the first: one
 * stylesheet can declare the same property in several blocks and the last one
 * wins. A first-match regex asserts about the block it happened to find rather
 * than the block that is live — the mistake `live-broadcast.css`'s own guard
 * had to be rewritten to avoid.
 */
function cardSurfaceUnder(css: string, selector: string): string | null {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  let found: string | null = null;
  for (const [, sel, body] of blocks) {
    if (sel.trim() !== selector) continue;
    const m = [...body.matchAll(/--card-surface\s*:\s*([^;]+);/g)].pop();
    if (m) found = m[1].trim();
  }
  if (!found) return null;
  const indirect = found.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (!indirect) return found;
  const varName = indirect[1].replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  const resolved = [
    ...css.matchAll(new RegExp(`${varName}\\s*:\\s*([^;]+);`, 'g')),
  ].pop();
  return resolved ? resolved[1].trim() : null;
}

/** The `data-league` value each surface renders under, and its dark selector. */
const DARK_SELECTOR: Record<LiveSurface, string> = {
  // Best Ball's own block does not override --card-surface, so it inherits the
  // bare `html.dark` value. That is deliberate and is asserted below.
  theleague: 'html.dark',
  bb1: 'html.dark',
  afl: 'html.dark[data-league="afl"]',
  mfl: 'html.dark[data-league="mfl"]',
};

describe('every surface ground is the real token value', () => {
  it('light is one value for every surface, and it is --card-surface on :root', () => {
    const rootLight = cardSurfaceUnder(LIGHT, ':root');
    expect(rootLight).toBeTruthy();
    for (const [surface, grounds] of Object.entries(SURFACE_GROUNDS)) {
      expect(grounds.light.toLowerCase(), `${surface} light ground`).toBe(
        rootLight!.toLowerCase(),
      );
    }
  });

  it.each(Object.keys(SURFACE_GROUNDS) as LiveSurface[])(
    '%s dark ground matches its own tokens-dark.css block',
    (surface) => {
      const declared = cardSurfaceUnder(DARK, DARK_SELECTOR[surface]);
      expect(declared, `no --card-surface under ${DARK_SELECTOR[surface]}`).toBeTruthy();
      expect(SURFACE_GROUNDS[surface].dark.toLowerCase()).toBe(declared!.toLowerCase());
    },
  );

  it('the AFL and MFL Live really do differ from the default — the per-league ground is not decoration', () => {
    const base = SURFACE_GROUNDS.theleague.dark.toLowerCase();
    expect(SURFACE_GROUNDS.afl.dark.toLowerCase()).not.toBe(base);
    expect(SURFACE_GROUNDS.mfl.dark.toLowerCase()).not.toBe(base);
    expect(SURFACE_GROUNDS.afl.dark.toLowerCase()).not.toBe(
      SURFACE_GROUNDS.mfl.dark.toLowerCase(),
    );
  });

  it('Best Ball shares the default dark ground BECAUSE it declares none of its own', () => {
    // If someone gives bb1 its own --card-surface, this fails and the
    // SURFACE_GROUNDS entry has to be updated with it.
    expect(cardSurfaceUnder(DARK, 'html.dark[data-league="bb1"]')).toBeNull();
    expect(SURFACE_GROUNDS.bb1.dark).toBe(SURFACE_GROUNDS.theleague.dark);
  });
});

describe('every registry league maps to a surface', () => {
  it.each((ALL_LEAGUES as Array<{ slug: string; navSlug: string }>).map((l) => l.slug))(
    '%s resolves to a known surface',
    (slug) => {
      const surface = surfaceForLeague(slug);
      expect(Object.keys(SURFACE_GROUNDS)).toContain(surface);
    },
  );

  it('uses the navSlug, which is what the layout writes into data-league', () => {
    // `TheLeagueLayout` sets data-league={navSlug}: the attribute says `afl`
    // while the canonical slug says `afl-fantasy`. A surface keyed on the
    // canonical slug would silently fall back to TheLeague's ground.
    for (const league of ALL_LEAGUES as Array<{ slug: string; navSlug: string }>) {
      expect(surfaceForLeague(league.slug)).toBe(league.navSlug);
    }
  });
});

/**
 * ── THE BUG THE SURFACE CONTRACT EXISTS TO FIX ────────────────────────────
 *
 * `LiveScoreboard.tsx` hardcodes its two grounds:
 *
 *     const LS_LIGHT_BG = '#ffffff'; // --card-surface (light)
 *     const LS_DARK_BG  = '#262626'; // --card-surface (dark)
 *
 * `#262626` is TheLeague's dark card. But the AFL renders the SAME island, and
 * the AFL's dark card is `#16283c` — a navy, because the AFL's whole theme is
 * navy. The island is handed `leagueId` and never uses it for colour.
 *
 * So every AFL franchise colour is nudged until it is legible against a card
 * it is not drawn on. Measured over the real config:
 *
 *   judged against #262626 (as shipped) -> worst is ΔE 10.7 against #16283c
 *   judged against #16283c (correct)    -> worst is ΔE 21.5
 *
 * 18 is not a number this test invented: it is `DEFAULT_MIN_BG_CONTRAST`, the
 * separation `resolveTeamColorPair` itself promises to deliver against the
 * background it is given. Handing it the wrong background does not make it
 * fail — it makes it succeed at the wrong question, which is why this shipped.
 * `A Bruin Pegs Me` renders `#002244` on a `#16283c` card: a 1.07:1 luminance
 * ratio, indistinguishable from the card.
 *
 * And it is invisible in review: correct in light mode, correct on TheLeague,
 * wrong only for some franchises, on one league, in one theme.
 * `toBroadcastPair` would not have helped either — it only ever DARKENS, so it
 * cannot make a colour visible.
 *
 * These assertions run over the REAL league configs, so they are a CENSUS
 * rather than a sample: a franchise that recolours itself into the hazard
 * fails the build, and so does a league whose card moves without its
 * SURFACE_GROUNDS entry moving with it.
 */
describe('a franchise is separable from ITS OWN league’s card, in both themes', () => {
  const leagues = ALL_LEAGUES as Array<{ slug: string; configPath: string }>;

  for (const league of leagues) {
    const surface = surfaceForLeague(league.slug);
    const grounds = SURFACE_GROUNDS[surface];
    const teams = loadTeams(league.configPath);

    for (const theme of ['light', 'dark'] as const) {
      it(`${league.slug}: ${teams.length} franchises clear ΔE ${DEFAULT_MIN_BG_CONTRAST} on ${grounds[theme]} (${theme})`, () => {
        const failures: string[] = [];
        for (const team of teams) {
          // Paired against every OTHER franchise, because the pair is resolved
          // TOGETHER: a greyscale stop borrows the other side's hue, so the
          // foil changes the answer for the team under test.
          for (const foil of teams) {
            if (foil.franchiseId === team.franchiseId) continue;
            const vars = resolveMatchupColorVars(team.claim, foil.claim, surface);
            const resolved = vars[theme === 'light' ? '--t0-light' : '--t0-dark'];
            const de = colorDistance(resolved, grounds[theme]);
            if (de < DEFAULT_MIN_BG_CONTRAST) {
              failures.push(
                `${team.franchiseId} ${team.name} vs ${foil.franchiseId}: ` +
                  `${resolved} on ${grounds[theme]} = ΔE ${de.toFixed(1)}`,
              );
            }
          }
        }
        expect(failures.slice(0, 8)).toEqual([]);
      });
    }
  }

  it('the AFL’s casualties are fixed by using the right ground, and broken by the wrong one', () => {
    const teams = loadTeams(leagues.find((l) => l.slug === 'afl-fantasy')!.configPath);
    const aflGround = SURFACE_GROUNDS.afl.dark;
    const theLeagueGround = SURFACE_GROUNDS.theleague.dark;
    const opts = { forceAdjust: true, homeVisibilityFallback: true } as const;
    const darkOf = (c: FranchiseColorClaim): FranchiseColorClaim => ({
      ...c,
      colorPrimary: c.colorPrimaryDark ?? c.colorPrimary,
      colorSecondary: c.colorSecondaryDark ?? c.colorSecondary,
    });

    let brokenByWrongGround = 0;
    for (const team of teams) {
      for (const foil of teams) {
        if (foil.franchiseId === team.franchiseId) continue;

        // The correct resolve clears the function's own promise.
        const right = resolveMatchupColorVars(team.claim, foil.claim, 'afl')['--t0-dark'];
        expect(
          colorDistance(right, aflGround),
          `${team.franchiseId} ${team.name} on its own card`,
        ).toBeGreaterThanOrEqual(DEFAULT_MIN_BG_CONTRAST);

        // The shipped resolve — same inputs, TheLeague's ground — does not.
        const shipped = resolveTeamColorPair(darkOf(team.claim), darkOf(foil.claim), {
          ...opts,
          background: theLeagueGround,
        }).home;
        if (colorDistance(shipped, aflGround) < DEFAULT_MIN_BG_CONTRAST) brokenByWrongGround += 1;
      }
    }

    // If this ever reaches zero the bug is gone from the DATA rather than from
    // the code, and the assertion above is the one still doing the work — so
    // say so out loud rather than letting a green test imply a fix.
    expect(
      brokenByWrongGround,
      'no AFL franchise is harmed by the wrong ground any more — re-read this test',
    ).toBeGreaterThan(0);
  });
});
