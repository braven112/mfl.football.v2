/**
 * Where a live board is being drawn, expressed as the two GROUNDS a franchise
 * colour has to stay legible against.
 *
 * ── WHY THIS IS A THING AND NOT A CONSTANT ────────────────────────────────
 * `resolveTeamColorPair` needs the background it is judging against, and the
 * wrong background gives a confident, WRONG legibility answer. There are two
 * independent reasons the answer differs, and both are live:
 *
 *  1. **Theme.** Light and dark want opposite answers. Seven TheLeague
 *     franchises carry a near-black `colorPrimary` (`#181818`) and several NFL
 *     club primaries are near-black too (LV `#101820`, CHI `#0b162a`, NO
 *     `#101820`) — all fine on a white card, all invisible on a dark one.
 *     `toBroadcastPair` cannot help here: it only ever DARKENS, so it cannot
 *     make a colour visible. That is `ensureFieldOn`'s job, and it needs the
 *     ground.
 *  2. **League.** The dark card is a different colour per league, because
 *     `--card-surface` is overridden per `data-league` in `tokens-dark.css`.
 *     TheLeague's is `#262626`, the AFL's `#16283c`, MFL Live's `#1e2126`.
 *
 * And the ground is the SURFACE's, never the matchup's league: a TheLeague
 * matchup rendered on MFL Live sits on MFL Live's card, not TheLeague's. So a
 * cross-league board resolves every one of its leagues against its own single
 * ground, and a league board resolves against that league's.
 *
 * These values are LITERALS mirroring `tokens.css` / `tokens-dark.css` because
 * this runs on the server, and with `theme_pref: auto` the server never learns
 * the resolved theme — it has to answer for both and let CSS pick.
 * `tests/live-surface-grounds.test.ts` pins them against the stylesheets, so a
 * token edit cannot silently drift from this file.
 */

/** The `data-league` attribute value a surface renders under. */
export type LiveSurface = 'theleague' | 'afl' | 'bb1' | 'mfl';

export interface SurfaceGrounds {
  /** `--card-surface` in the light theme. */
  light: string;
  /** `--card-surface` under `html.dark[data-league=…]`. */
  dark: string;
}

/**
 * Light is `--color-white` for every league — no league overrides it.
 * Dark is per league, and `bb1` deliberately shares the bare `html.dark`
 * value because its own block does not override `--card-surface`.
 */
export const SURFACE_GROUNDS: Record<LiveSurface, SurfaceGrounds> = {
  theleague: { light: '#ffffff', dark: '#262626' },
  afl: { light: '#ffffff', dark: '#16283c' },
  bb1: { light: '#ffffff', dark: '#262626' },
  mfl: { light: '#ffffff', dark: '#1e2126' },
};

/**
 * The surface a registry league's OWN pages render under — its `navSlug`, which
 * is what `TheLeagueLayout` writes into `data-league`. Not the canonical slug:
 * the attribute says `afl`, the slug says `afl-fantasy`.
 */
const SLUG_TO_SURFACE: Record<string, LiveSurface> = {
  theleague: 'theleague',
  'afl-fantasy': 'afl',
  'best-ball-1': 'bb1',
};

/** The surface a league's own live-scoring page draws on. */
export function surfaceForLeague(slug: string): LiveSurface {
  return SLUG_TO_SURFACE[slug] ?? 'theleague';
}

export function groundsFor(surface: LiveSurface): SurfaceGrounds {
  return SURFACE_GROUNDS[surface];
}
