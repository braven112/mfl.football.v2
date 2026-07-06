/**
 * Playoff Round Hero data
 *
 * Turns the compact bracket summary into the ONE round the homepage hero should
 * feature right now, resolved to everything the round components need: each
 * team's franchise brand (color/crest/icon), its headliner composite, seed,
 * record, points-for, and projected starting-lineup total.
 *
 * Three round shapes drive three components:
 *   wild-card    (3 games) → cards + the round's single highest-projected team's headliner
 *   semifinals   (2 games) → 4-up, two franchise-colored pairs + a stat row each
 *   championship (1 game)  → 2-up + trophy + full comparison table
 *
 * Casting rule (Brandon): every seat casts a semantically relevant player — the
 * team's own headliner. Playoff teams are franchise-branded (crest + team color),
 * never NFL-logo'd, because the hero is about the fantasy matchup.
 *
 * `assembleRoundView` is pure (deps injected) so it unit-tests without feeds;
 * `buildPlayoffRoundView` is the thin SSR wrapper that gathers those deps.
 */
import type { PlayoffBracketSummaryGame } from '../../types/hero-state';
import { getPlayerMap } from '../player-map';
import { getFranchiseCompositableHeadliners, getFranchiseProjectedTotals } from '../offseason-hero-data';
import { getFranchiseBrand } from '../franchise-brand';
import { normalizeTeamCode } from '../nfl-logo';
import { chooseTeamName } from '../team-names';

export type PlayoffRoundKind = 'wild-card' | 'semifinals' | 'championship';

/** A composite-ready player face (ESPN cutout), or null when nothing composites. */
export interface PlayoffPlayerModel {
  name: string;
  position: string;
  /** Normalized NFL team code (for the QB · BAL meta line). */
  nflTeam: string;
  headshot: string;
}

/** One team's fully-resolved presentation in a playoff matchup. */
export interface PlayoffTeamView {
  franchiseId: string;
  /** Full franchise name (e.g. "Pacific Pigskins"). */
  name: string;
  /** Medium name (nameMedium ≤15 chars) — one-line team label for the championship. */
  medium: string;
  /** Short chip name (nameShort → abbrev → last word). */
  short: string;
  seed?: number;
  /** Franchise chart/graph color (hex) — what the panels currently tint with. */
  color: string;
  /** Brand primary color (hex) — panel fill / main identity. */
  colorPrimary: string;
  /** Brand secondary color (hex) — accent (e.g. a two-tone empty panel). */
  colorSecondary: string;
  /** Franchise GroupMe crest — the panel/background watermark. */
  crest: string;
  /** Square franchise icon — the card/table row marker. */
  icon: string;
  /** "11-3" (h2h W-L, T appended only when non-zero) — '' before games. */
  record: string;
  /** Points-for, comma-grouped ("1,842") — '' before games. */
  pointsFor: string;
  /** Projected starting-lineup total (0 before projections publish). */
  proj: number;
  /** The team's headliner composite, or null. */
  player: PlayoffPlayerModel | null;
  /** True when this is the signed-in owner's team. */
  isUser: boolean;
}

export interface PlayoffMatchupView {
  gameId: string;
  isComplete: boolean;
  teams: [PlayoffTeamView, PlayoffTeamView];
  /** True when the signed-in owner plays in this game. */
  isUserGame: boolean;
}

export interface PlayoffRoundView {
  kind: PlayoffRoundKind;
  /** Editorial round label ("Wild Card Weekend", "Semifinals", "Championship"). */
  label: string;
  /** The NFL week this round is played (from the bracket round). */
  week: number;
  games: PlayoffMatchupView[];
  /**
   * Wild-card only: the round's highest projected team, whose headliner leads
   * the hero as the composite. Null for later rounds (the matchup IS the story).
   */
  featured: PlayoffTeamView | null;
}

/** Dependencies injected into the pure assembler (all franchise-id keyed). */
export interface RoundViewDeps {
  brandOf: (fid: string) => { name: string; color: string; colorPrimary: string; colorSecondary: string; crest: string; icon: string };
  shortNameOf: (fid: string) => string;
  mediumNameOf: (fid: string) => string;
  headlinerOf: (fid: string) => PlayoffPlayerModel | null;
  projOf: (fid: string) => number;
  recordOf: (fid: string) => string;
  pointsForOf: (fid: string) => string;
  userFranchiseId?: string;
}

const ROUND_LABEL: Record<PlayoffRoundKind, string> = {
  'wild-card': 'Wild Card Weekend',
  semifinals: 'Semifinals',
  championship: 'Championship',
};

/** Classify a round by how many games it holds (robust to bracket byes). */
function classifyRound(gameCount: number): PlayoffRoundKind {
  if (gameCount <= 1) return 'championship';
  if (gameCount === 2) return 'semifinals';
  return 'wild-card';
}

function toTeamView(
  slot: PlayoffBracketSummaryGame['home'],
  deps: RoundViewDeps,
): PlayoffTeamView {
  const fid = slot.franchiseId ?? '';
  const brand = deps.brandOf(fid);
  return {
    franchiseId: fid,
    name: brand.name || slot.displayName,
    medium: deps.mediumNameOf(fid) || brand.name || slot.displayName,
    short: deps.shortNameOf(fid) || slot.displayName,
    seed: slot.seed,
    color: brand.color,
    colorPrimary: brand.colorPrimary,
    colorSecondary: brand.colorSecondary,
    crest: brand.crest,
    icon: brand.icon || slot.icon || '',
    record: deps.recordOf(fid),
    pointsFor: deps.pointsForOf(fid),
    proj: deps.projOf(fid),
    player: deps.headlinerOf(fid),
    isUser: !!fid && fid === deps.userFranchiseId,
  };
}

/**
 * Pure assembler: pick the current round from the bracket and resolve it.
 *
 * Round selection prefers the round matching `preferWeek` (the live NFL week) so
 * the hero always shows *this* week's round. When that isn't available it falls
 * back to the earliest round week with an unplayed game; once every game is
 * final, the last round lingers (the championship result). Returns null when the
 * bracket is empty. In a real progression the two agree — earlier rounds are
 * already played by the time their week passes — so `preferWeek` only matters
 * when the bracket is static (e.g. a preview/test date).
 */
export function assembleRoundView(
  bracketSummary: PlayoffBracketSummaryGame[],
  deps: RoundViewDeps,
  preferWeek?: number,
): PlayoffRoundView | null {
  if (!bracketSummary.length) return null;

  // Group by round week, ascending.
  const byWeek = new Map<number, PlayoffBracketSummaryGame[]>();
  for (const g of bracketSummary) {
    const list = byWeek.get(g.roundWeek) ?? [];
    list.push(g);
    byWeek.set(g.roundWeek, list);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  // Prefer the live week's round; else earliest unfinished; else the final week.
  const currentWeek =
    preferWeek != null && byWeek.has(preferWeek)
      ? preferWeek
      : (weeks.find((w) => (byWeek.get(w) ?? []).some((g) => !g.isComplete)) ??
        weeks[weeks.length - 1]);
  const roundGames = byWeek.get(currentWeek) ?? [];
  if (!roundGames.length) return null;

  const kind = classifyRound(roundGames.length);

  const games: PlayoffMatchupView[] = roundGames.map((g) => {
    const home = toTeamView(g.home, deps);
    const away = toTeamView(g.away, deps);
    // Present higher seed (lower number) on the left for a stable read.
    const teams: [PlayoffTeamView, PlayoffTeamView] =
      (away.seed ?? 99) < (home.seed ?? 99) ? [away, home] : [home, away];
    return {
      gameId: g.gameId,
      isComplete: g.isComplete,
      teams,
      isUserGame: teams[0].isUser || teams[1].isUser,
    };
  });

  // Wild-card featured: the round's highest projected team (its headliner leads
  // the hero). Requires a compositable headliner; skip teams without one.
  let featured: PlayoffTeamView | null = null;
  if (kind === 'wild-card') {
    for (const g of games) {
      for (const t of g.teams) {
        if (!t.player) continue;
        if (!featured || t.proj > featured.proj) featured = t;
      }
    }
  }

  return { kind, label: ROUND_LABEL[kind], week: currentWeek, games, featured };
}

/** Parse the h2h W-L-T string ("11-3-0") into a compact record ("11-3"). */
export function formatRecord(h2hwlt: string | undefined): string {
  if (!h2hwlt) return '';
  const [w = '0', l = '0', t = '0'] = h2hwlt.split('-');
  if (w === '0' && l === '0' && t === '0') return '';
  return Number(t) > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

/** Comma-group a points-for value ("1842.4" → "1,842"). */
export function formatPointsFor(pf: string | number | undefined): string {
  const n = typeof pf === 'string' ? parseFloat(pf) : pf;
  if (n == null || !Number.isFinite(n) || n <= 0) return '';
  return Math.round(n).toLocaleString('en-US');
}

/**
 * SSR wrapper: gather the deps from the season's feeds + config and assemble the
 * current round. `standingsFranchises` is the raw MFL standings franchise list
 * (for record + points-for); `teamAssets` maps franchise id → config name fields
 * for `chooseTeamName`.
 */
export function buildPlayoffRoundView(params: {
  seasonYear: number;
  bracketSummary: PlayoffBracketSummaryGame[];
  standingsFranchises: Array<Record<string, any>>;
  teamAssets: Map<string, { name?: string; nameMedium?: string; nameShort?: string; abbrev?: string }>;
  userFranchiseId?: string;
  /** The live NFL week (metadata.week) — steers round selection to this week. */
  currentWeek?: number;
}): PlayoffRoundView | null {
  const { seasonYear, bracketSummary, standingsFranchises, teamAssets, userFranchiseId, currentWeek } = params;

  const players = getPlayerMap(seasonYear);
  const headliners = getFranchiseCompositableHeadliners(seasonYear);
  const headlinerByFid = new Map(headliners.map((h) => [h.franchiseId, h.playerId]));
  const projTotals = getFranchiseProjectedTotals(seasonYear);

  const recordByFid = new Map<string, string>();
  const pfByFid = new Map<string, string>();
  for (const f of standingsFranchises) {
    if (!f?.id) continue;
    recordByFid.set(f.id, formatRecord(f.h2hwlt));
    pfByFid.set(f.id, formatPointsFor(f.pf));
  }

  const deps: RoundViewDeps = {
    brandOf: (fid) => {
      const b = getFranchiseBrand(fid);
      return { name: b.name, color: b.color, colorPrimary: b.colorPrimary, colorSecondary: b.colorSecondary, crest: b.groupMe, icon: b.icon };
    },
    shortNameOf: (fid) => {
      const a = teamAssets.get(fid);
      if (!a) return '';
      return chooseTeamName(
        { fullName: a.name ?? '', nameMedium: a.nameMedium, nameShort: a.nameShort, abbrev: a.abbrev },
        'short',
      );
    },
    mediumNameOf: (fid) => {
      const a = teamAssets.get(fid);
      if (!a) return '';
      return chooseTeamName(
        { fullName: a.name ?? '', nameMedium: a.nameMedium, nameShort: a.nameShort, abbrev: a.abbrev },
        'default',
      );
    },
    headlinerOf: (fid) => {
      const pid = headlinerByFid.get(fid);
      const p = pid ? players.get(pid) : null;
      if (!p || p.position === 'DEF' || !p.headshot.includes('espncdn.com')) return null;
      return { name: p.name, position: p.position, nflTeam: normalizeTeamCode(p.nflTeam), headshot: p.headshot };
    },
    projOf: (fid) => projTotals.get(fid) ?? 0,
    recordOf: (fid) => recordByFid.get(fid) ?? '',
    pointsForOf: (fid) => pfByFid.get(fid) ?? '',
    userFranchiseId,
  };

  return assembleRoundView(bracketSummary, deps, currentWeek);
}
