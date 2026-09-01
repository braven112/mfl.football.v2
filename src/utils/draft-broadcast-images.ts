/**
 * Which images the broadcast board will need tonight, in the order it will
 * need them.
 *
 * WHY THIS EXISTS. Every reveal-critical image on this page is a remote PNG
 * that the card requests for the FIRST time at the moment it mounts — and a
 * reveal owns the TV for 18 seconds, so a headshot that takes four of them to
 * arrive is four seconds of the room looking at a name with no face. Warming
 * them ahead of time turns that into a decode.
 *
 * And it is not a one-time cost, which is the part that is easy to get wrong:
 * ESPN serves headshots with `cache-control: max-age=233` (measured
 * 2026-08-28 — under four minutes, and it counts DOWN, so it is an edge TTL,
 * not a client hint). A browser-cache warm-up done at 6pm is therefore
 * expired by the third pick. That is why the durable half of this lives in the
 * service worker (`REMOTE_IMAGE_HOSTS` in `public/sw.js`), which stores these
 * responses on its own clock and ignores the origin's four minutes; this
 * module only decides WHAT to ask for, and `useImageWarmup` asks.
 *
 * Order is the whole value of the plan. A draft room has a few hundred
 * plausible picks and a pool several times that, so warming in pool order
 * spends the first minutes of wifi on players nobody will take. Board rank —
 * the same number the reveal card prints — is the best available proxy for
 * "who goes next", so the plan walks it.
 *
 * Pure and isomorphic on purpose: the page can plan server-side, the island
 * can plan client-side, and `tests/draft-broadcast-images.test.ts` can plan
 * with neither.
 */

import type { DraftRoomTeam } from '../types/draft-room';
import type { BroadcastDefenseFace, BroadcastPlayer } from '../types/draft-broadcast';
import { isSplashCutoutEligible } from './pick-reveal';
import { resolveOrigin } from './draft-broadcast';
import { getCollegeHeadshot, getPlayerHeadshot } from '../constants/roster-constants';

/**
 * How many players deep the plan reaches by default.
 *
 * The AFL drafts 108 players per conference out of a pool of several hundred,
 * and TheLeague's rookie board is 51. 400 covers the whole realistic board
 * several times over while keeping the warm-up inside a couple of minutes on
 * room wifi — a full-pool warm-up is ~4x the bytes to insure picks that will
 * not happen. Raise it from the URL with `?warm=N` on a fast connection.
 */
export const DEFAULT_WARM_DEPTH = 400;

export interface BroadcastImagePlanInput {
  players: BroadcastPlayer[];
  teams: DraftRoomTeam[];
  defenseFaces?: Record<string, BroadcastDefenseFace[]>;
  /** Players deep to warm, by board rank. Defaults to `DEFAULT_WARM_DEPTH`. */
  depth?: number;
}

export interface BroadcastImagePlan {
  /** Every URL to warm, deduped, most-needed first. */
  urls: string[];
  /** Franchise crests — local, tiny, and on screen before any pick lands. */
  crests: number;
  /** Remote headshots. The expensive half, and the one that fails visibly. */
  cutouts: number;
  /** Origin marks (school + NFL). Local SVG or remote NCAA PNG. */
  logos: number;
  /** Marquee-defender headshots standing in for team defenses. */
  faces: number;
}

/**
 * Rank a player for warm-up order.
 *
 * `boardRank` is the pre-draft pool position the card itself prints, so it is
 * exactly the order the room will work down. A player without one is not
 * skipped — a real pick can be a deep flier no feed ranks (see
 * `trimToDraftable`) — he just sorts behind everybody who has one, which is
 * the honest statement of what we know about him.
 */
function warmRank(player: BroadcastPlayer, index: number): number {
  return player.boardRank ?? Number.MAX_SAFE_INTEGER - 1_000_000 + index;
}

/**
 * Build the warm-up plan.
 *
 * Crests come first and unconditionally: they are local, they are the whole
 * franchise identity on both screens, and six of them are already on the idle
 * board before a single pick lands. Everything after that is board order.
 */
export function planBroadcastImages({
  players,
  teams,
  defenseFaces,
  depth = DEFAULT_WARM_DEPTH,
}: BroadcastImagePlanInput): BroadcastImagePlan {
  const seen = new Set<string>();
  const urls: string[] = [];
  let crests = 0;
  let cutouts = 0;
  let logos = 0;
  let faces = 0;

  const push = (url: string | null | undefined, bump: () => void): void => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
    bump();
  };

  // BOTH crests per franchise: a team whose only dark cut is a 100px `iconDark`
  // wears different artwork on the big surfaces and the small ones (see
  // `resolveBroadcastCrest`), and warming only one of the two leaves whichever
  // screen comes up first fetching a crest cold. `push` dedupes, so the
  // majority of franchises — where the two resolve to the same file — still
  // cost exactly one entry.
  for (const team of teams) {
    push(team.icon, () => (crests += 1));
    push(team.iconSmall, () => (crests += 1));
  }

  // Sorted on a COPY: `players` is the island's own prop, and the reveal card
  // reads that array's order to seat the defender chips.
  const ordered = players
    .map((player, index) => ({ player, rank: warmRank(player, index) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.max(0, depth))
    .map((entry) => entry.player);

  for (const player of ordered) {
    // Exactly the predicate the card uses to decide whether it paints a cutout
    // at all, so the plan can never warm an image the card will not request
    // (nor miss one it will) — see `isSplashCutoutEligible`.
    if (isSplashCutoutEligible(player)) {
      push(player.headshot, () => (cutouts += 1));
      // The card's 404 cascade is NFL cutout -> COLLEGE cutout -> no cutout
      // (`handleCutoutError`), so warming only the first leaves the fallback to
      // be fetched cold mid-reveal — the exact failure this plan exists to
      // remove, and the COMMON path on TheLeague's rookies-only board where the
      // NFL headshot is the one that 404s.
      //
      // Rookies only, deliberately. Warming a college fallback for every
      // veteran would roughly double the plan to insure a 404 that does not
      // happen to them; a rookie's NFL headshot missing is the ordinary case.
      if (player.isRookie && player.espnId) {
        push(getCollegeHeadshot(player.espnId), () => (cutouts += 1));
      }
    }
    push(resolveOrigin(player).logo, () => (logos += 1));
  }

  // Every defense's faces, not a top slice: the card draws two at random from
  // each five-man pool per reveal (see `BroadcastRevealCard`), so warming only
  // the first two would leave three of five cold on every team-defense pick.
  // There are at most 32 pools, which is why the whole thing is affordable.
  for (const pool of Object.values(defenseFaces ?? {})) {
    for (const face of pool) {
      push(getPlayerHeadshot(undefined, face.espnId), () => (faces += 1));
    }
  }

  return { urls, crests, cutouts, logos, faces };
}

/**
 * How deep to warm, from `?warm=`.
 *
 * `0` / `off` / `no` disables the warm-up outright — the escape hatch for a
 * connection where the warm-up would compete with the poll it is meant to
 * protect. `all` reaches the whole pool. Anything unparseable is the default,
 * because a typo in a query string must not silently turn the warm-up off on
 * draft night.
 */
export function resolveWarmDepth(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_WARM_DEPTH;
  const value = raw.trim().toLowerCase();
  if (value === 'off' || value === 'no' || value === 'false' || value === '0') return 0;
  if (value === 'all' || value === 'max') return Number.MAX_SAFE_INTEGER;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WARM_DEPTH;
}
