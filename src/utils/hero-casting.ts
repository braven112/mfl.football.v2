/**
 * Hero Casting — picks the player who "models" a composite hero.
 *
 * Casting rules (see docs/claude/insights/features/player-composites.md):
 *   - New features / What's New heroes cast a ROOKIE (rookies represent "new").
 *   - Roster-action heroes (tags, cuts, contracts) cast a player from the
 *     signed-in owner's team; guests get a relevant player from someone's team.
 *   - Every hero casts a semantically relevant player — never decoration.
 *
 * Picks are deterministic per Pacific-Time calendar day so SSR renders are
 * stable across requests but the model rotates daily.
 */

import type { PlayerIdentity } from './player-map';

/** The player a composite hero features. */
export interface HeroModel {
  mflId: string;
  name: string;
  position: string;
  nflTeam: string;
  headshot: string;
  /** Caption qualifier explaining why this player models the hero (e.g. 'Rookie', '3rd Year') */
  descriptor: string;
}

/** Composites need a transparent ESPN cutout — MFL JPGs have baked backgrounds. */
function isCompositable(player: PlayerIdentity): boolean {
  return player.position !== 'DEF' && player.headshot.includes('espncdn.com');
}

function toModel(player: PlayerIdentity, descriptor: string): HeroModel {
  const { mflId, name, position, nflTeam, headshot } = player;
  return { mflId, name, position, nflTeam, headshot, descriptor };
}

/** '2026' class in year 2026 → 'Rookie'; '2024' → '3rd Year'. */
function yearDescriptor(draftYear: string, classYear: number): string {
  const n = classYear - parseInt(draftYear, 10) + 1;
  if (n <= 1) return 'Rookie';
  const suffix = n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix} Year`;
}

/** Newest draft class in the pool that isn't in the future (Feb-rollover safe). */
function currentClassYear(players: Map<string, PlayerIdentity>, referenceDate: Date): number {
  const ceilingYear = parseInt(ptDayKey(referenceDate).slice(0, 4), 10);
  let classYear = 0;
  for (const p of players.values()) {
    const year = parseInt(p.draftYear, 10);
    if (Number.isFinite(year) && year <= ceilingYear && year > classYear) classYear = year;
  }
  return classYear;
}

/** PT calendar day string (YYYY-MM-DD) — the daily rotation seed. */
function ptDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Small deterministic string hash (FNV-1a) for seeded picks. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic daily pick from a candidate pool (stable order first). */
function dailyPick<T>(pool: T[], referenceDate: Date, seedKey: string, keyOf: (item: T) => string): T | null {
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  const index = hashSeed(`${ptDayKey(referenceDate)}:${seedKey}`) % sorted.length;
  return sorted[index];
}

/**
 * Cast a rookie model — for What's New / new-feature heroes.
 *
 * Rookie = most recent draft class present in the player pool that is not in
 * the future (covers the Feb-rollover gap before the next NFL Draft, when the
 * new class doesn't exist in the feed yet).
 *
 * @param players - Player identity map (getPlayerMap)
 * @param referenceDate - Drives the daily rotation and the class-year ceiling
 * @param rosteredIds - Optional: restrict to players rostered in the league
 */
export function castRookieModel(
  players: Map<string, PlayerIdentity>,
  referenceDate: Date = new Date(),
  rosteredIds?: Set<string>,
): HeroModel | null {
  const classYear = currentClassYear(players, referenceDate);
  if (classYear === 0) return null;

  const allRookies = [...players.values()].filter(
    (p) => p.draftYear === String(classYear) && isCompositable(p),
  );
  const rostered = rosteredIds ? allRookies.filter((p) => rosteredIds.has(p.mflId)) : [];
  const pool = rostered.length > 0 ? rostered : allRookies;

  const pick = dailyPick(pool, referenceDate, 'rookie', (p) => p.mflId);
  return pick ? toModel(pick, 'Rookie') : null;
}

/**
 * Cast an enhancement model — for What's New enhancement heroes.
 *
 * "Same guy, leveled up": a league-rostered player in his first five NFL
 * seasons (the current class and the four before it). Strictly rostered —
 * an enhancement to the site is modeled by someone an owner actually
 * invested in; returns null (caller falls back) when none resolve.
 */
export function castEnhancementModel(
  players: Map<string, PlayerIdentity>,
  referenceDate: Date = new Date(),
  rosteredIds: Set<string>,
): HeroModel | null {
  const classYear = currentClassYear(players, referenceDate);
  if (classYear === 0 || rosteredIds.size === 0) return null;

  const pool = [...players.values()].filter((p) => {
    const year = parseInt(p.draftYear, 10);
    return (
      Number.isFinite(year) &&
      year >= classYear - 4 &&
      year <= classYear &&
      rosteredIds.has(p.mflId) &&
      isCompositable(p)
    );
  });

  const pick = dailyPick(pool, referenceDate, 'enhancement', (p) => p.mflId);
  return pick ? toModel(pick, yearDescriptor(pick.draftYear, classYear)) : null;
}

/**
 * Cast the best available free agent — for the auction hero.
 *
 * Walks a ranked player-id list (dynasty ADP order), keeps the top
 * `poolSize` who are unrostered and compositable, and rotates the pick
 * daily so one face doesn't own the 30-day auction window.
 */
export function castTopFreeAgentModel(
  players: Map<string, PlayerIdentity>,
  referenceDate: Date,
  rosteredIds: Set<string>,
  rankedIds: string[],
  poolSize: number = 5,
): HeroModel | null {
  const pool: PlayerIdentity[] = [];
  for (const id of rankedIds) {
    if (rosteredIds.has(id)) continue;
    const p = players.get(id);
    if (!p || !isCompositable(p)) continue;
    pool.push(p);
    if (pool.length >= poolSize) break;
  }

  const pick = dailyPick(pool, referenceDate, 'free-agent', (p) => p.mflId);
  return pick ? toModel(pick, 'Best Available') : null;
}

/**
 * Cast the best rookies still on the board — for the UDFA window hero.
 *
 * Walks the ranked list (dynasty ADP order) and returns the top `count`
 * players of the current draft class who are NOT league-rostered (they went
 * undrafted — that's the whole point) and have usable cutouts. Deterministic:
 * the board is the board.
 */
export function castRookiesOnBoard(
  players: Map<string, PlayerIdentity>,
  rosteredIds: Set<string>,
  rankedIds: string[],
  count: number = 4,
  referenceDate: Date = new Date(),
): HeroModel[] {
  const classYear = currentClassYear(players, referenceDate);
  if (classYear === 0) return [];

  const models: HeroModel[] = [];
  for (const id of rankedIds) {
    if (rosteredIds.has(id)) continue;
    const p = players.get(id);
    if (!p || p.draftYear !== String(classYear) || !isCompositable(p)) continue;
    models.push(toModel(p, 'UDFA'));
    if (models.length >= count) break;
  }
  return models;
}

/**
 * Cast the player whose live auction closes soonest.
 *
 * MFL auctions settle 36 hours after the last bid, so the auction with the
 * OLDEST anchor timestamp (last meaningful bid) ends first. Falls through
 * to the next-soonest auction when a player has no usable cutout.
 */
export function castClosingAuctionModel(
  auctions: Array<{ playerId: string; anchorTimestamp: number }>,
  players: Map<string, PlayerIdentity>,
  descriptor: string = 'Closing Soon',
): HeroModel | null {
  const bySoonest = [...auctions].sort(
    (a, b) => a.anchorTimestamp - b.anchorTimestamp || a.playerId.localeCompare(b.playerId),
  );
  for (const auction of bySoonest) {
    const p = players.get(auction.playerId);
    if (p && isCompositable(p)) return toModel(p, descriptor);
  }
  return null;
}

/** A scored candidate (e.g. projected points) for best-of-pool casting. */
export interface ScoredCastCandidate {
  playerId: string;
  /** League franchise that rosters the player; '' = free agent */
  franchiseId: string;
  score: number;
}

/**
 * Cast the BEST player from a scored candidate pool — no daily rotation.
 *
 * Kickoff-headliner rule: "the best player starting in the earliest game of
 * the week" — and when signed in, "the best player on YOUR team" in that
 * game. Candidates from the user's franchise win when any exist; otherwise
 * the whole pool competes. Highest score wins; ties break by player id so
 * SSR output is stable.
 */
export function castBestScoredModel(
  candidates: ScoredCastCandidate[],
  players: Map<string, PlayerIdentity>,
  userFranchiseId: string | undefined,
  descriptor: string,
): HeroModel | null {
  const resolvable = candidates.filter((c) => {
    const p = players.get(c.playerId);
    return !!p && isCompositable(p);
  });
  if (resolvable.length === 0) return null;

  const own = userFranchiseId
    ? resolvable.filter((c) => c.franchiseId === userFranchiseId)
    : [];
  const pool = own.length > 0 ? own : resolvable;

  const best = pool.reduce((a, b) =>
    b.score > a.score || (b.score === a.score && b.playerId < a.playerId) ? b : a,
  );
  return toModel(players.get(best.playerId)!, descriptor);
}

/**
 * Cast a RANDOM likely starter from a scored candidate pool — daily rotation.
 *
 * Kickoff rule: rotate among the likely starters in the earliest game of the
 * week, not just the single best. "Likely starters" = the top `perTeam`
 * fantasy players per NFL team by projection (the real starters, not the
 * deep bench); a projection of 0 is never a starter. When signed in, the
 * pool narrows to the owner's own likely starters in that game, falling back
 * to the full pool when they roster none. The pick rotates by PT day so the
 * same face doesn't hold the hero all window.
 */
export function castRandomStarterModel(
  candidates: ScoredCastCandidate[],
  players: Map<string, PlayerIdentity>,
  userFranchiseId: string | undefined,
  referenceDate: Date,
  descriptor: string,
  perTeam: number = 8,
): HeroModel | null {
  // Group compositable, projected candidates by NFL team.
  const byTeam = new Map<string, ScoredCastCandidate[]>();
  for (const c of candidates) {
    const p = players.get(c.playerId);
    // A non-finite projection (malformed feed → NaN) is never a likely starter.
    if (!p || !isCompositable(p) || !Number.isFinite(c.score) || c.score <= 0) continue;
    const arr = byTeam.get(p.nflTeam) ?? [];
    arr.push(c);
    byTeam.set(p.nflTeam, arr);
  }

  // Keep each team's top `perTeam` by projection — that's the starter tier.
  const pool: ScoredCastCandidate[] = [];
  for (const arr of byTeam.values()) {
    arr.sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
    pool.push(...arr.slice(0, perTeam));
  }
  if (pool.length === 0) return null;

  const own = userFranchiseId ? pool.filter((c) => c.franchiseId === userFranchiseId) : [];
  const finalPool = own.length > 0 ? own : pool;

  const pick = dailyPick(finalPool, referenceDate, 'starter', (c) => c.playerId);
  return pick ? toModel(players.get(pick.playerId)!, descriptor) : null;
}

/**
 * Cast the exact player an article features — for the article/weekend-preview
 * hero.
 *
 * Unlike the rotating casters, this is DETERMINISTIC by design: the article
 * body already names a specific hero (top scorer, biggest waiver bid, marquee
 * projection), captured as `heroPlayerId` on the post. We simply resolve that
 * id to a model.
 *
 * Deliberately does NOT gate on compositability: the generator always names
 * the genuinely-featured player even when he has no ESPN cutout (or is a
 * DEF), and the article hero renders his TEAM LOGO as the art in that case —
 * swapping in a different player's face would betray the story. Callers check
 * `heroModelHasCutout` to pick cutout vs logo art. Returns null — so the
 * caller falls back to the post's static image card — only when the id is
 * absent (old posts) or unknown to the player map.
 *
 * @param heroPlayerId - The post's `heroPlayerId` (may be undefined on old posts)
 * @param players - Player identity map (getPlayerMap)
 * @param descriptor - Caption qualifier (e.g. 'Top Pickup', 'One to Watch')
 */
export function castArticleModel(
  heroPlayerId: string | undefined,
  players: Map<string, PlayerIdentity>,
  descriptor: string = '',
): HeroModel | null {
  if (!heroPlayerId) return null;
  const player = players.get(heroPlayerId);
  if (!player) return null;
  return toModel(player, descriptor);
}

/** Whether a cast model has a transparent ESPN cutout to composite (vs
 *  rendering the team logo as the hero art). Same rule as `isCompositable`. */
export function heroModelHasCutout(model: HeroModel): boolean {
  return model.position !== 'DEF' && model.headshot.includes('espncdn.com');
}

/** A candidate for a roster-action hero (cut watch, tag window, contracts…). */
export interface RosterCastCandidate {
  playerId: string;
  franchiseId: string;
}

/**
 * Cast a roster-relevant model — for roster-action heroes.
 *
 * Prefers a candidate on the signed-in owner's franchise ("a player from YOUR
 * team that was suggested"); guests and owners with no candidates get a
 * deterministic daily pick from the league-wide candidate list.
 */
export function castRosterModel(
  candidates: RosterCastCandidate[],
  players: Map<string, PlayerIdentity>,
  userFranchiseId: string | undefined,
  referenceDate: Date = new Date(),
  descriptor: string = '',
): HeroModel | null {
  const resolvable = candidates.filter((c) => {
    const p = players.get(c.playerId);
    return !!p && isCompositable(p);
  });
  if (resolvable.length === 0) return null;

  const own = userFranchiseId
    ? resolvable.filter((c) => c.franchiseId === userFranchiseId)
    : [];
  const pool = own.length > 0 ? own : resolvable;

  const pick = dailyPick(pool, referenceDate, 'roster', (c) => `${c.franchiseId}:${c.playerId}`);
  return pick ? toModel(players.get(pick.playerId)!, descriptor) : null;
}
