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
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

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
