/**
 * Which color tints a composite hero's glow — the cast player's NFL team, or
 * the FANTASY franchise that rosters him.
 *
 * The recap hero established the idea: that card is about someone's week, so
 * it takes the rostering franchise's color and crest instead of the NFL team's
 * (`RecapCompositeHero`). This generalizes it to any cast hero, and the whole
 * design is about one AFL fact:
 *
 *   THE AFL ROSTERS THE SAME PLAYER TWICE. `duplicatePlayers: true` in the
 *   registry is not a footnote — 60 of the AL's 84 keepers are kept in the NL
 *   too. So "the franchise that rosters this player" is a LIST, and a hero
 *   that picks one at random paints a stranger's colors on your homepage.
 *
 * The rule that resolves it, and the reason it is not "whoever owns him":
 *
 *   Scope ownership to the VIEWER'S OWN CONFERENCE. Inside one conference a
 *   player has at most one owner, so the ambiguity disappears rather than being
 *   broken by a tiebreak nobody can predict. A viewer in the AL sees the AL
 *   franchise's colors; the NL owner of the same player is not their story.
 *
 * Everything that is not that resolves to the NFL team color, which is the
 * behavior every composite had before this existed:
 *   - a signed-out viewer (no conference, so no franchise is "theirs")
 *   - a player nobody in the viewer's conference rosters (a free agent)
 *   - a league with one flat conference (TheLeague), where the concept does
 *     not apply and the NFL color is already the right answer
 *   - a franchise whose config carries no usable color
 *
 * The returned color is fed to `CompositeHero`'s `glowColor`, which is only
 * ever used as a translucent radial tint over a deep-ink gradient — so it is
 * NOT subject to the avatar helpers' luminance floor. A near-white franchise
 * color would still wash the corner out, though, so `MIN_GLOW_CONTRAST` floors
 * it against white ink the same way `hero-franchise-backdrop` floors a
 * gradient stop. One AFL franchise is `#e9e9e9`, which is exactly that case.
 */
import { getLeagueTeamBrands } from './league-team-brands';
import { ensureContrastOn } from './team-color-contrast';
import type { CanonicalLeagueSlug } from '../config/leagues';
import type { ConferenceId } from './afl-conference';

/**
 * A glow tint sits under white caption text at low alpha. 2.2:1 against white
 * is well below a text threshold on purpose — the glow is not text, and
 * pushing it further would flatten every light franchise to the same ink. It
 * is the floor at which the corner still reads as a tint rather than a smear.
 */
export const MIN_GLOW_CONTRAST = 2.2;

export interface FranchiseAccentInput {
  /** MFL id of the cast player. */
  playerId: string | undefined;
  /** Every franchise rostering him, from `getOwnersByPlayer` — a LIST, always. */
  ownersByPlayer: Map<string, string[]> | null | undefined;
  /** The viewer's conference, or null for a guest / a league without conferences. */
  viewerConferenceId: ConferenceId | null | undefined;
  /** Resolves a franchise id to its conference; null for a league without them. */
  conferenceOf: (franchiseId: string) => ConferenceId | null;
  league: CanonicalLeagueSlug;
  /** The NFL team primary — the answer whenever no franchise claims the story. */
  fallback: string;
}

export interface FranchiseAccent {
  /** Hex to tint the glow with. */
  color: string;
  /** The franchise the color came from, or null when the fallback won. */
  franchiseId: string | null;
}

/**
 * Resolve the accent color for a cast hero.
 *
 * Total: every branch returns `fallback` rather than throwing, because a hero
 * that cannot resolve a color must still render.
 */
export function resolveHeroFranchiseAccent(input: FranchiseAccentInput): FranchiseAccent {
  const { playerId, ownersByPlayer, viewerConferenceId, conferenceOf, league, fallback } = input;
  const none: FranchiseAccent = { color: fallback, franchiseId: null };

  if (!playerId || !ownersByPlayer || !viewerConferenceId) return none;

  const owners = ownersByPlayer.get(playerId);
  if (!owners || owners.length === 0) return none;

  // Scope to the viewer's conference BEFORE picking. Never `owners[0]`: in the
  // AFL that is whichever conference the rosters feed happened to list first.
  const mine = owners.filter((id) => conferenceOf(id) === viewerConferenceId);
  // Exactly one, or the ambiguity we refused to guess at is still here.
  if (mine.length !== 1) return none;

  const brand = getLeagueTeamBrands(league)[mine[0]];
  const color = brand?.colorPrimary;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return none;

  // `ensureContrastOn` darkens against a light background and is a no-op once
  // the color already clears the floor, so a normal brand color passes through
  // untouched and only the near-white outlier moves.
  return { color: ensureContrastOn(color, '#ffffff', MIN_GLOW_CONTRAST), franchiseId: mine[0] };
}
