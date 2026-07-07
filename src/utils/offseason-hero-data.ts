/**
 * Off-Season Hero Data Utilities
 *
 * Loads and parses MFL data feeds for the 5 off-season hero components.
 * Called from new-hp.astro via enrichHeroState() to populate typed prop bags.
 * Runs server-side only (SSR).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { HeroState } from '../types/hero-state';
import { TARGET_ACTIVE_COUNT } from './salary-calculations';
import { getCurrentSeasonYear } from './league-year';
import { getNthDayOfMonth, getNflDraftDate } from './league-event-resolver';
import { isCutWatchUrgent } from './hero-resolver';
import { normalizeTeamCode, getNFLTeamName } from './nfl-logo';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';

// ── JSON Data Loaders ──

function readJsonFile(relativePath: string): any {
  try {
    const filePath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Repo-relative path to a synced MFL feed file for a league year. League data
 * roots come from the league registry — never hardcode 'data/theleague' etc.
 */
function feedPath(league: CanonicalLeagueSlug, leagueYear: number, file: string): string {
  const dataPath = getLeagueBySlug(league)?.dataPath ?? 'data/theleague';
  return `${dataPath}/mfl-feeds/${leagueYear}/${file}`;
}

// ── Rostered Player IDs ──

/**
 * All player IDs currently on any franchise roster, from the MFL rosters
 * feed on disk. Used as the reliable floor for roster-aware hero casting —
 * the Redis roster cache is fresher but unavailable in local dev, and
 * salary-file data can lag for recent pickups (rookies especially).
 */
export function getRosteredPlayerIds(
  leagueYear: number,
  league: CanonicalLeagueSlug = 'theleague',
): Set<string> {
  const rosterData = readJsonFile(feedPath(league, leagueYear, 'rosters.json'));
  const ids = new Set<string>();
  const franchises = rosterData?.rosters?.franchise;
  if (!franchises) return ids;
  for (const franchise of Array.isArray(franchises) ? franchises : [franchises]) {
    const players = Array.isArray(franchise.player)
      ? franchise.player
      : franchise.player
        ? [franchise.player]
        : [];
    for (const p of players) {
      if (p?.id) ids.add(p.id);
    }
  }
  return ids;
}

/** Map of rostered playerId → owning franchiseId, from the rosters feed. */
export function getOwnerByPlayer(
  leagueYear: number,
  league: CanonicalLeagueSlug = 'theleague',
): Map<string, string> {
  const ownerByPlayer = new Map<string, string>();
  const rosterData = readJsonFile(feedPath(league, leagueYear, 'rosters.json'));
  const franchises = rosterData?.rosters?.franchise;
  for (const franchise of franchises ? (Array.isArray(franchises) ? franchises : [franchises]) : []) {
    const players = Array.isArray(franchise.player)
      ? franchise.player
      : franchise.player
        ? [franchise.player]
        : [];
    for (const p of players) {
      if (p?.id) ownerByPlayer.set(p.id, franchise.id);
    }
  }
  return ownerByPlayer;
}

// ── Franchise Headliners ──

/**
 * Each franchise's headliner — the active rostered player with the highest
 * projected score (falls back to highest salary when projections are empty,
 * e.g. before the new season's projections publish). Feeds preseason /
 * "lock your lineup" hero casting: the signed-in owner sees THEIR headliner.
 */
export function getFranchiseHeadliners(
  leagueYear: number,
  league: CanonicalLeagueSlug = 'theleague',
): Array<{ playerId: string; franchiseId: string }> {
  const rosterData = readJsonFile(feedPath(league, leagueYear, 'rosters.json'));
  const franchises = rosterData?.rosters?.franchise;
  if (!franchises) return [];
  const projections = getProjectionMap(leagueYear, league);
  const playerMap = getUnifiedPlayerMap(leagueYear);
  // ADP rank is the deep tie-break: in a league year whose projections feed is
  // dead (post-season Feb–May) and whose rosters carry no salaries (AFL),
  // score and salary are 0 for everyone and a bare id tie-break degenerates to
  // "lowest MFL id" — each team's DEF. ADP keeps the pick a real headliner.
  // Loaded lazily: with live projections/salaries the earlier comparisons
  // decide, and the extra feed read never happens.
  let adpRank: Map<string, number> | null = null;
  const rankOf = (id: string): number => {
    if (!adpRank) {
      adpRank = new Map();
      getAdpRankedIds(leagueYear, league).forEach((pid, i) => adpRank!.set(pid, i));
    }
    return adpRank.get(id) ?? Number.MAX_SAFE_INTEGER;
  };

  const headliners: Array<{ playerId: string; franchiseId: string }> = [];
  for (const franchise of Array.isArray(franchises) ? franchises : [franchises]) {
    const players = Array.isArray(franchise.player)
      ? franchise.player
      : franchise.player
        ? [franchise.player]
        : [];
    let best: { playerId: string; score: number; salary: number } | null = null;
    for (const p of players) {
      if (!p?.id || (p.status && p.status !== 'ROSTER')) continue;
      // A headliner is a player, never a team DEF (and DEF can't composite).
      if (playerMap.get(p.id)?.position === 'DEF') continue;
      const score = projections.get(p.id) ?? 0;
      const salary = parseFloat(p.salary || '0') || 0;
      // Score, then salary, then ADP rank, then player id — the trailing
      // tie-breaks keep the pick stable and meaningful when projections
      // and/or salaries are empty, regardless of roster feed order.
      let better = false;
      if (!best) better = true;
      else if (score !== best.score) better = score > best.score;
      else if (salary !== best.salary) better = salary > best.salary;
      else {
        const rank = rankOf(p.id);
        const bestRank = rankOf(best.playerId);
        better = rank !== bestRank ? rank < bestRank : p.id < best.playerId;
      }
      if (better) best = { playerId: p.id, score, salary };
    }
    if (best) headliners.push({ playerId: best.playerId, franchiseId: franchise.id });
  }
  return headliners;
}

/**
 * Each franchise's best COMPOSITABLE headliner — the highest-projected rostered
 * player whose ESPN cutout composites (position !== DEF, headshot on espncdn).
 * Unlike `getFranchiseHeadliners` (the single top player, compositable or not),
 * this skips down the roster until it finds a face that renders, so playoff/
 * matchup panels don't come up empty when the #1 projected player is a team
 * defense or lacks a transparent ESPN headshot.
 */
export function getFranchiseCompositableHeadliners(
  leagueYear: number,
): Array<{ playerId: string; franchiseId: string }> {
  const rosterData = readJsonFile(`data/theleague/mfl-feeds/${leagueYear}/rosters.json`);
  const franchises = rosterData?.rosters?.franchise;
  if (!franchises) return [];
  const projections = getProjectionMap(leagueYear);
  const players = getUnifiedPlayerMap(leagueYear);

  const out: Array<{ playerId: string; franchiseId: string }> = [];
  for (const franchise of Array.isArray(franchises) ? franchises : [franchises]) {
    const roster = (Array.isArray(franchise.player)
      ? franchise.player
      : franchise.player
        ? [franchise.player]
        : []
    )
      .filter((p: any) => p?.id && (!p.status || p.status === 'ROSTER'))
      .map((p: any) => ({ id: p.id, score: projections.get(p.id) ?? 0, salary: parseFloat(p.salary || '0') || 0 }))
      // id tie-break keeps the pick stable (deterministic SSR) when a franchise
      // has players tied on both projection and salary — mirrors getFranchiseHeadliners.
      .sort((a: any, b: any) => b.score - a.score || b.salary - a.salary || String(a.id).localeCompare(String(b.id)));
    for (const p of roster) {
      const pm = players.get(p.id);
      if (pm && pm.position !== 'DEF' && pm.headshot.includes('espncdn.com')) {
        out.push({ playerId: p.id, franchiseId: franchise.id });
        break;
      }
    }
  }
  return out;
}

/** TheLeague fields 9 starters — a team's projected total sums its best 9. */
const STARTER_COUNT = 9;

/**
 * Each franchise's projected starting-lineup total — the sum of its top-9
 * rostered player projections (TheLeague starts 9). An approximation of the
 * set lineup used to compare playoff opponents in the round heroes; falls to 0
 * for every team before the season's projections publish.
 */
export function getFranchiseProjectedTotals(leagueYear: number): Map<string, number> {
  const out = new Map<string, number>();
  const rosterData = readJsonFile(`data/theleague/mfl-feeds/${leagueYear}/rosters.json`);
  const franchises = rosterData?.rosters?.franchise;
  if (!franchises) return out;
  const projections = getProjectionMap(leagueYear);

  for (const franchise of Array.isArray(franchises) ? franchises : [franchises]) {
    const players = Array.isArray(franchise.player)
      ? franchise.player
      : franchise.player
        ? [franchise.player]
        : [];
    const scores = players
      .filter((p: any) => p?.id && (!p.status || p.status === 'ROSTER'))
      .map((p: any) => projections.get(p.id) ?? 0)
      .sort((a: number, b: number) => b - a);
    const total = scores.slice(0, STARTER_COUNT).reduce((s: number, v: number) => s + v, 0);
    out.set(franchise.id, Math.round(total * 10) / 10);
  }
  return out;
}

// ── Kickoff Game (earliest game of the week) ──

export interface KickoffGame {
  /** Normalized ESPN-format team codes, away first */
  teamCodes: [string, string];
  awayName: string;
  homeName: string;
}

/** Resolve a raw nflSchedule matchup into a typed KickoffGame (null if malformed). */
function matchupToKickoffGame(matchup: any): KickoffGame | null {
  if (!Array.isArray(matchup?.team) || matchup.team.length !== 2) return null;
  const away = matchup.team.find((t: any) => t.isHome !== '1') ?? matchup.team[0];
  const home = matchup.team.find((t: any) => t.isHome === '1') ?? matchup.team[1];
  const awayCode = normalizeTeamCode(away.id || '');
  const homeCode = normalizeTeamCode(home.id || '');
  if (!awayCode || !homeCode) return null;
  return {
    teamCodes: [awayCode, homeCode],
    awayName: getNFLTeamName(awayCode),
    homeName: getNFLTeamName(homeCode),
  };
}

/**
 * The earliest game of the current NFL week, from the live nflSchedule feed
 * (`nflSchedule.matchup` — the current week's slate; week 1 during the
 * preseason). Drives the kickoff-headliner hero casting rule: "the best player
 * starting in the earliest game of the week."
 *
 * With a `referenceDate`, prefers the earliest game still upcoming or live
 * (kickoff + 4h grace) so a mid-week caller doesn't feature Thursday's
 * finished game on Sunday; falls back to the absolute earliest when the
 * whole week has been played.
 */
export function getKickoffGame(
  leagueYear: number,
  league: CanonicalLeagueSlug = 'theleague',
  referenceDate?: Date,
): KickoffGame | null {
  const data = readJsonFile(feedPath(league, leagueYear, 'nflSchedule.json'));
  const matchups = data?.nflSchedule?.matchup;
  if (!matchups) return null;

  const games = (Array.isArray(matchups) ? matchups : [matchups]).filter(
    (m: any) => m?.kickoff && Array.isArray(m.team) && m.team.length === 2,
  );
  if (games.length === 0) return null;

  const sorted = [...games].sort((a: any, b: any) => parseInt(a.kickoff, 10) - parseInt(b.kickoff, 10));
  let earliest = sorted[0];
  if (referenceDate) {
    const cutoff = Math.floor(referenceDate.getTime() / 1000) - 4 * 3600;
    earliest = sorted.find((m: any) => parseInt(m.kickoff, 10) >= cutoff) ?? sorted[0];
  }
  return matchupToKickoffGame(earliest);
}

/**
 * Scored candidates for the kickoff-game headliner: every fantasy player on
 * the two teams in the earliest game of the week, scored by projection,
 * with the league franchise that rosters them (empty string = free agent).
 */
export function getKickoffGameCandidates(
  leagueYear: number,
  league: CanonicalLeagueSlug = 'theleague',
  referenceDate?: Date,
): Array<{ playerId: string; franchiseId: string; score: number }> {
  const game = getKickoffGame(leagueYear, league, referenceDate);
  if (!game) return [];

  const projections = getProjectionMap(leagueYear, league);
  const playerMap = getUnifiedPlayerMap(leagueYear);

  const ownerByPlayer = getOwnerByPlayer(leagueYear, league);

  const codes = new Set(game.teamCodes);
  const candidates: Array<{ playerId: string; franchiseId: string; score: number }> = [];
  for (const p of playerMap.values()) {
    if (p.position === 'DEF' || !codes.has(p.nflTeam)) continue;
    candidates.push({
      playerId: p.mflId,
      franchiseId: ownerByPlayer.get(p.mflId) ?? '',
      score: projections.get(p.mflId) ?? 0,
    });
  }
  // "Best" means most projected points. If projections haven't published yet
  // every score is 0 and "best" would be an arbitrary tie-break — return
  // nothing so the caller's fallback ladder (franchise headliners, which
  // tie-breaks on salary) takes over instead.
  if (!candidates.some((c) => c.score > 0)) return [];
  return candidates;
}

// ── Marquee Game Stars (in-season matchup preview) ──

export interface MarqueeGameStars {
  awayCode: string;
  homeCode: string;
  awayName: string;
  homeName: string;
  /** Scored candidates on the away team (highest = the side's star) */
  awayCandidates: Array<{ playerId: string; franchiseId: string; score: number }>;
  /** Scored candidates on the home team (highest = the side's star) */
  homeCandidates: Array<{ playerId: string; franchiseId: string; score: number }>;
}

/**
 * The highest week present in the playerScores feed — the just-completed
 * scored week (the feed carries a single week; 0 out of season). Drives the
 * recap slot's "Week N" copy and picks the marquee week for a completed
 * season whose live current-week schedule is gone.
 */
export function getLatestScoredWeek(
  seasonYear: number,
  league: CanonicalLeagueSlug = 'theleague',
): number {
  const data = readJsonFile(feedPath(league, seasonYear, 'playerScores.json'));
  const list = data?.playerScores?.playerScore;
  const scores = Array.isArray(list) ? list : list ? [list] : [];
  let maxWeek = 0;
  for (const s of scores) {
    const w = parseInt(s?.week, 10);
    if (Number.isFinite(w) && w > maxWeek) maxWeek = w;
  }
  return maxWeek;
}

/** playerId → actual points from the playerScores feed (the completed week). */
function getActualScoreMap(
  seasonYear: number,
  league: CanonicalLeagueSlug = 'theleague',
): Map<string, number> {
  const data = readJsonFile(feedPath(league, seasonYear, 'playerScores.json'));
  const list = data?.playerScores?.playerScore;
  const scores = Array.isArray(list) ? list : list ? [list] : [];
  const map = new Map<string, number>();
  for (const s of scores) {
    const v = parseFloat(s?.score || '');
    if (s?.id && Number.isFinite(v)) map.set(s.id, v);
  }
  return map;
}

/**
 * The score map for the marquee game's stars: projected points (a true
 * pre-game preview) when projections are published, else the completed
 * week's actual box score. A season whose projections feed is emptied
 * post-year (e.g. 2025 after rollover) still resolves its two stars from
 * real points instead of coming up blank.
 */
function getGameScoreMap(
  seasonYear: number,
  league: CanonicalLeagueSlug,
  source: MarqueeSource,
): Map<string, number> {
  const projections = getProjectionMap(seasonYear, league);
  // A LIVE game is a genuine pre-game preview — score by projection ONLY. If the
  // projection feed is empty/unpublished, the caller must come up empty and fall
  // back, NEVER borrow last week's box score (that would headline the wrong
  // players mid-week). Only the completed-season ARCHIVE path, whose projections
  // are long gone, falls through to the week's actual points.
  if (source === 'live') return projections;
  for (const v of projections.values()) {
    if (v > 0) return projections;
  }
  return getActualScoreMap(seasonYear, league);
}

/** Where a marquee game came from — gates whether actual scores may stand in. */
type MarqueeSource = 'live' | 'archive';

interface MarqueeGame extends KickoffGame {
  source: MarqueeSource;
}

/**
 * The marquee game of the current NFL week — its earliest kickoff, the same
 * opener the kickoff hero features. Reads the live current-week feed
 * (`nflSchedule.matchup`) first (source `'live'`); for a completed/synced
 * season (only `fullNflSchedule` on disk) it falls back to the latest scored
 * week's earliest game (source `'archive'`) so the recap and preview share one
 * week. The source flows to `getGameScoreMap` so only the archive path may
 * score by actual points.
 */
function getMarqueeGame(
  seasonYear: number,
  league: CanonicalLeagueSlug = 'theleague',
  referenceDate?: Date,
): MarqueeGame | null {
  // Live current-week slate (in-season production path).
  const live = getKickoffGame(seasonYear, league, referenceDate);
  if (live) return { ...live, source: 'live' };

  // Completed season: full-schedule feed. Pick the latest scored week (matches
  // the recap), then its earliest kickoff game. Normalize MFL's single-object
  // shape (a one-item list can arrive as a bare object).
  const data = readJsonFile(feedPath(league, seasonYear, 'nflSchedule.json'));
  const rawWeeks = data?.fullNflSchedule?.nflSchedule;
  const weeks = Array.isArray(rawWeeks) ? rawWeeks : rawWeeks ? [rawWeeks] : [];
  if (weeks.length === 0) return null;

  const targetWeek = getLatestScoredWeek(seasonYear, league);
  const week =
    weeks.find((w: any) => parseInt(w?.week, 10) === targetWeek) ?? weeks[weeks.length - 1];
  const games = (Array.isArray(week?.matchup) ? week.matchup : week?.matchup ? [week.matchup] : [])
    .filter((m: any) => m?.kickoff && Array.isArray(m.team) && m.team.length === 2);
  if (games.length === 0) return null;

  const earliest = [...games].sort(
    (a: any, b: any) => parseInt(a.kickoff, 10) - parseInt(b.kickoff, 10),
  )[0];
  const resolved = matchupToKickoffGame(earliest);
  return resolved ? { ...resolved, source: 'archive' } : null;
}

/**
 * The marquee game of the current NFL week and each side's fantasy roster,
 * scored for casting — for the matchup-preview split panel (the game's two
 * stars). "Marquee" = the earliest game of the week (the same opener the
 * kickoff hero features), so recap → preview share one data spine. Returns
 * null when no schedule resolves or either side has no scored player (caller
 * falls back to the full matchup-preview grid).
 */
export function getMarqueeGameStars(
  seasonYear: number,
  league: CanonicalLeagueSlug = 'theleague',
  referenceDate?: Date,
): MarqueeGameStars | null {
  const game = getMarqueeGame(seasonYear, league, referenceDate);
  if (!game) return null;

  const [awayCode, homeCode] = game.teamCodes;
  const playerMap = getUnifiedPlayerMap(seasonYear);
  const ownerByPlayer = getOwnerByPlayer(seasonYear, league);
  const scoreOf = getGameScoreMap(seasonYear, league, game.source);

  const awayCandidates: Array<{ playerId: string; franchiseId: string; score: number }> = [];
  const homeCandidates: Array<{ playerId: string; franchiseId: string; score: number }> = [];
  for (const p of playerMap.values()) {
    if (p.position === 'DEF') continue;
    if (p.nflTeam !== awayCode && p.nflTeam !== homeCode) continue;
    // Coerce a non-finite score (malformed feed → NaN) to 0 — `?? 0` wouldn't
    // (NaN isn't null), and castBestScoredModel doesn't filter finite, so a NaN
    // candidate could otherwise win the pick.
    const rawScore = scoreOf.get(p.mflId);
    const candidate = {
      playerId: p.mflId,
      franchiseId: ownerByPlayer.get(p.mflId) ?? '',
      score: Number.isFinite(rawScore) ? (rawScore as number) : 0,
    };
    if (p.nflTeam === awayCode) awayCandidates.push(candidate);
    else homeCandidates.push(candidate);
  }

  // Need at least one scored star on each side to justify the split panel.
  if (!awayCandidates.some((c) => c.score > 0) || !homeCandidates.some((c) => c.score > 0)) {
    return null;
  }

  return {
    awayCode,
    homeCode,
    awayName: game.awayName,
    homeName: game.homeName,
    awayCandidates,
    homeCandidates,
  };
}

// ── ADP Rankings ──

/**
 * Player IDs in dynasty-ADP order (best consensus rank first), from the MFL
 * ADP feed on disk. Drives "best available free agent" hero casting.
 */
export function getAdpRankedIds(
  leagueYear: number,
  league: CanonicalLeagueSlug = 'theleague',
): string[] {
  const data = readJsonFile(feedPath(league, leagueYear, 'adp-dynasty.json'));
  const list = data?.adp?.player;
  if (!list) return [];
  const players = Array.isArray(list) ? list : [list];
  return players
    .filter((p: any) => p?.id && Number.isFinite(parseFloat(p.averagePick)))
    .sort((a: any, b: any) => parseFloat(a.averagePick) - parseFloat(b.averagePick))
    .map((p: any) => p.id);
}

// ── Trade Bait ──

/**
 * Players currently listed on trade blocks, with their owning franchise.
 * The synced tradeBait feed is a flat array of player ids (the fetch script
 * pre-processes MFL's response); ownership comes from the rosters feed.
 * Drives "on the block" hero casting for trade-window states.
 */
export function getTradeBaitCandidates(
  leagueYear: number,
  league: CanonicalLeagueSlug = 'theleague',
): Array<{ playerId: string; franchiseId: string }> {
  const data = readJsonFile(feedPath(league, leagueYear, 'tradeBait.json'));
  if (!Array.isArray(data)) return [];

  const ownerByPlayer = getOwnerByPlayer(leagueYear, league);
  return data
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    .map((playerId: string) => ({
      playerId,
      franchiseId: ownerByPlayer.get(playerId) ?? '',
    }))
    // A block listing for a player no longer rostered is stale — drop it.
    .filter((c) => c.franchiseId !== '');
}

// ── Weekly Top Scorers ──

// ── Breaking Story ──

export interface BreakingStory {
  /** Feed post id — used to link the hero to the post's own thread page */
  id: string;
  /** The headline player's MFL id (feed posts order received-side first) */
  playerIds: string[];
  headline: string;
  /** Longer body / Schefter hot take used as the hero sub-line */
  summary: string;
  /** External source URL when the post has one (breaking transactions don't) */
  link?: string;
  /** The subject franchise — the team that ACQUIRED the headline player
   *  (franchiseIds[0] for auction wins and trades). Drives the CTA → its roster. */
  franchiseId?: string;
  /** Post timestamp in epoch ms — drives the "N hrs ago" eyebrow */
  timestampMs: number;
}

/**
 * The freshest breaking-tier Schefter post with a compositable player,
 * within `windowHours` (default 48h) of the reference date. Powers the
 * breaking-story hero: a trade or auction bomb takes the homepage while it's
 * still news. Returns null when nothing qualifies (the common case — the
 * hero only exists for genuine breaking moments).
 *
 * Auction-win posts never surface here in practice: during the auction their
 * dates resolve to the auction hero (a higher-priority state), and once the
 * auction closes they've aged out of the window.
 */
export function getBreakingStoryPost(
  referenceDate: Date,
  windowHours: number = 48,
): BreakingStory | null {
  const feed = readJsonFile('src/data/theleague/schefter-feed.json');
  return selectBreakingStory(feed?.posts, referenceDate, windowHours);
}

/**
 * Pure selection: the freshest qualifying breaking post from a posts array.
 * Exported so the window/tier/freshness logic is testable with fixtures
 * (the on-disk feed is cron-regenerated and can't anchor assertions).
 */
export function selectBreakingStory(
  posts: any,
  referenceDate: Date,
  windowHours: number = 48,
  canCast?: (playerIds: string[]) => boolean,
): BreakingStory | null {
  if (!Array.isArray(posts)) return null;

  const nowMs = referenceDate.getTime();
  const windowMs = windowHours * 3_600_000;

  // Collect every qualifying breaking post (right tier, has playerIds, fresh),
  // MFL ids normalized to strings (feed can send numbers) so the player-map
  // lookup key always matches.
  const qualifying: Array<{ post: any; ts: number; playerIds: string[] }> = [];
  for (const post of posts) {
    if (post?.tier !== 'breaking') continue;
    if (!Array.isArray(post.playerIds) || post.playerIds.length === 0) continue;
    const ts = Date.parse(post.timestamp);
    if (!Number.isFinite(ts)) continue;
    // Fresh: strictly within the window, not in the future vs the ref date.
    if (ts > nowMs || nowMs - ts >= windowMs) continue;
    qualifying.push({ post, ts, playerIds: post.playerIds.map(String) });
  }

  // Freshest first, then skip posts whose players won't composite so a newer
  // uncastable bomb doesn't hide an older castable one (when a predicate is
  // supplied by the caller that has the player map).
  qualifying.sort((a, b) => b.ts - a.ts);
  const chosen = canCast ? qualifying.find((q) => canCast(q.playerIds)) : qualifying[0];
  if (!chosen) return null;

  const { post, ts, playerIds } = chosen;
  // The Schefter feed stores the take in `body`; `analysis`/`hotTake` are
  // defensive fallbacks. Guard against non-string values (malformed feed).
  const summary = (([post.body, post.analysis, post.hotTake].find((v) => typeof v === 'string') as string) ?? '').trim();
  return {
    id: post.id || '',
    playerIds,
    headline: typeof post.headline === 'string' && post.headline ? post.headline : 'Breaking news',
    summary,
    link: typeof post.link === 'string' ? post.link : undefined,
    franchiseId: Array.isArray(post.franchiseIds) && post.franchiseIds[0] != null
      ? String(post.franchiseIds[0])
      : undefined,
    timestampMs: ts,
  };
}

/**
 * Scored candidates from the current playerScores feed (the most recent
 * scored week): every ROSTERED player with a positive score, tagged with the
 * franchise that owns him. Drives "week's top scorer" hero casting for the
 * recap slot. Empty out of season (the feed carries week 0 with no scores).
 */
export function getWeeklyTopScorerCandidates(
  leagueYear: number,
  league: CanonicalLeagueSlug = 'theleague',
): Array<{ playerId: string; franchiseId: string; score: number }> {
  const data = readJsonFile(feedPath(league, leagueYear, 'playerScores.json'));
  const list = data?.playerScores?.playerScore;
  if (!list) return [];

  const ownerByPlayer = getOwnerByPlayer(leagueYear, league);
  const scores = Array.isArray(list) ? list : [list];
  const candidates: Array<{ playerId: string; franchiseId: string; score: number }> = [];
  for (const ps of scores) {
    const score = parseFloat(ps?.score || '');
    const franchiseId = ps?.id ? ownerByPlayer.get(ps.id) : undefined;
    if (!ps?.id || !franchiseId || !Number.isFinite(score) || score <= 0) continue;
    candidates.push({ playerId: ps.id, franchiseId, score });
  }
  return candidates;
}

// ── Championship Result ──

interface ChampionshipResult {
  winnerFranchiseId: string;
  loserFranchiseId: string;
  winnerScore: number;
  loserScore: number;
}

/**
 * Extract the championship game result from playoff bracket data.
 * Bracket "1" is "The League Championship". The final round (Week 17)
 * has a single playoffGame object (not array) with home/away scores.
 */
export function getChampionshipResult(seasonYear: number): ChampionshipResult | null {
  const data = readJsonFile(`data/theleague/mfl-feeds/${seasonYear}/playoff-brackets.json`);
  if (!data?.brackets?.['1']?.playoffBracket?.playoffRound) return null;

  const rounds = data.brackets['1'].playoffBracket.playoffRound;
  if (!rounds.length) return null;

  // Final round is the last element (Week 17 championship game)
  const finalRound = rounds[rounds.length - 1];
  // Single game in finals = object, not array
  const game = Array.isArray(finalRound.playoffGame)
    ? finalRound.playoffGame[0]
    : finalRound.playoffGame;

  if (!game?.home?.points || !game?.away?.points) return null;

  const homeScore = parseFloat(game.home.points);
  const awayScore = parseFloat(game.away.points);

  if (isNaN(homeScore) || isNaN(awayScore)) return null;

  const homeWins = homeScore >= awayScore;
  return {
    winnerFranchiseId: homeWins ? game.home.franchise_id : game.away.franchise_id,
    loserFranchiseId: homeWins ? game.away.franchise_id : game.home.franchise_id,
    winnerScore: homeWins ? homeScore : awayScore,
    loserScore: homeWins ? awayScore : homeScore,
  };
}

// ── Tagged Players ──

interface TaggedPlayerRaw {
  franchiseId: string;
  playerId: string;
}

/**
 * Find FRANCHISE_TAG transactions from the transactions feed.
 * Transaction field format: "playerId|amount|..."
 */
export function getTaggedPlayers(leagueYear: number): TaggedPlayerRaw[] {
  const data = readJsonFile(`data/theleague/mfl-feeds/${leagueYear}/transactions.json`);
  if (!data?.transactions?.transaction) return [];

  const txns = Array.isArray(data.transactions.transaction)
    ? data.transactions.transaction
    : [data.transactions.transaction];

  return txns
    .filter((t: any) => t.type === 'FRANCHISE_TAG')
    .map((t: any) => {
      const parts = (t.transaction || '').split('|');
      return {
        franchiseId: t.franchise,
        playerId: parts[0] || '',
      };
    })
    .filter((t: TaggedPlayerRaw) => t.playerId);
}

// ── Cut Watch ──

interface CutCandidateRaw {
  franchiseId: string;
  activeCount: number;
  cutCandidates: Array<{
    playerId: string;
    salary: number;
  }>;
}

/**
 * Get projected scores as a Map<playerId, score>.
 */
function getProjectionMap(
  leagueYear: number,
  league: CanonicalLeagueSlug = 'theleague',
): Map<string, number> {
  const data = readJsonFile(feedPath(league, leagueYear, 'projectedScores.json'));
  const map = new Map<string, number>();
  if (!data?.projectedScores?.playerScore) return map;

  const scores = Array.isArray(data.projectedScores.playerScore)
    ? data.projectedScores.playerScore
    : [data.projectedScores.playerScore];

  for (const ps of scores) {
    const score = parseFloat(ps.score || '0');
    if (ps.id) map.set(ps.id, score);
  }
  return map;
}

/**
 * Get the most recent pickup per franchise from transactions.
 * Returns Map<franchiseId, playerId[]> sorted newest-first.
 */
function getRecentPickups(leagueYear: number): Map<string, string[]> {
  const data = readJsonFile(`data/theleague/mfl-feeds/${leagueYear}/transactions.json`);
  const map = new Map<string, { playerId: string; timestamp: number }[]>();
  if (!data?.transactions?.transaction) return new Map();

  const txns = Array.isArray(data.transactions.transaction)
    ? data.transactions.transaction
    : [data.transactions.transaction];

  for (const txn of txns) {
    if (txn.type !== 'FREE_AGENT' && txn.type !== 'AUCTION_WON') continue;
    const franchiseId = txn.franchise;
    const timestamp = parseInt(txn.timestamp || '0', 10);
    if (!franchiseId) continue;

    let playerIds: string[] = [];
    const txnStr = txn.transaction || '';

    if (txn.type === 'AUCTION_WON') {
      // Format: "playerId|salary|"
      const pid = txnStr.split('|')[0];
      if (pid) playerIds = [pid];
    } else {
      // FREE_AGENT format: "|addedId1,addedId2,|droppedId1,droppedId2,"
      const parts = txnStr.split('|');
      const added = (parts[1] || '').split(',').filter(Boolean);
      playerIds = added;
    }

    if (!map.has(franchiseId)) map.set(franchiseId, []);
    for (const pid of playerIds) {
      map.get(franchiseId)!.push({ playerId: pid, timestamp });
    }
  }

  // Sort each franchise's pickups newest-first and return just IDs
  const result = new Map<string, string[]>();
  for (const [fid, pickups] of map) {
    pickups.sort((a, b) => b.timestamp - a.timestamp);
    result.set(fid, pickups.map((p) => p.playerId));
  }
  return result;
}

/**
 * Identify teams over the 22-player active roster limit and their likely cuts.
 *
 * Uses a two-source alternating algorithm:
 * 1. Most recent pickup (from transactions — newest acquisition first)
 * 2. Lowest projected points at the owner's most-stacked position
 *
 * Alternates between these two sources until the team is at the limit,
 * skipping duplicates.
 */
export function getCutCandidates(leagueYear: number): CutCandidateRaw[] {
  const rosterData = readJsonFile(`data/theleague/mfl-feeds/${leagueYear}/rosters.json`);
  if (!rosterData?.rosters?.franchise) return [];

  const franchises = Array.isArray(rosterData.rosters.franchise)
    ? rosterData.rosters.franchise
    : [rosterData.rosters.franchise];

  const projections = getProjectionMap(leagueYear);
  const recentPickups = getRecentPickups(leagueYear);
  const playerMap = getPlayerMap(leagueYear);

  const results: CutCandidateRaw[] = [];

  for (const franchise of franchises) {
    const players = Array.isArray(franchise.player) ? franchise.player : franchise.player ? [franchise.player] : [];
    const activePlayers = players.filter((p: any) => p.status === 'ROSTER');

    if (activePlayers.length <= TARGET_ACTIVE_COUNT) continue;

    const excess = activePlayers.length - TARGET_ACTIVE_COUNT;
    const activeIds = new Set(activePlayers.map((p: any) => p.id));
    const salaryMap = new Map<string, number>(activePlayers.map((p: any) => [p.id, parseFloat(p.salary || '0')]));

    // Source 1: Recent pickups (filtered to players still on active roster)
    const pickupQueue = (recentPickups.get(franchise.id) || [])
      .filter((pid) => activeIds.has(pid));

    // Source 2: Lowest projected points at the most-stacked position
    // Build position counts for active players
    const posCounts = new Map<string, string[]>();
    for (const p of activePlayers) {
      const info = playerMap.get(p.id);
      const pos = info?.position || 'UNKNOWN';
      if (!posCounts.has(pos)) posCounts.set(pos, []);
      posCounts.get(pos)!.push(p.id);
    }

    // Build a queue: from most-stacked position, pick lowest-projected player,
    // then re-evaluate which position is most stacked
    const getNextWeakestAtStackedPos = (excluded: Set<string>): string | null => {
      // Recount positions excluding already-picked candidates
      const remaining = new Map<string, string[]>();
      for (const [pos, pids] of posCounts) {
        const active = pids.filter((id) => !excluded.has(id));
        if (active.length > 1) remaining.set(pos, active);
      }
      if (remaining.size === 0) return null;

      // Find position with most players
      let maxPos = '';
      let maxCount = 0;
      for (const [pos, pids] of remaining) {
        if (pids.length > maxCount) {
          maxCount = pids.length;
          maxPos = pos;
        }
      }
      if (!maxPos) return null;

      // Pick the lowest-projected player at that position
      const candidates = remaining.get(maxPos)!;
      candidates.sort((a, b) => (projections.get(a) || 0) - (projections.get(b) || 0));
      return candidates[0] || null;
    };

    // Alternate between the two sources
    const selected: Array<{ playerId: string; salary: number }> = [];
    const used = new Set<string>();
    let pickupIdx = 0;
    let usePickup = true; // Start with most recent pickup

    while (selected.length < excess) {
      let candidate: string | null = null;

      if (usePickup) {
        // Try next recent pickup not already selected
        while (pickupIdx < pickupQueue.length && used.has(pickupQueue[pickupIdx])) {
          pickupIdx++;
        }
        if (pickupIdx < pickupQueue.length) {
          candidate = pickupQueue[pickupIdx];
          pickupIdx++;
        }
      }

      if (!usePickup || candidate === null) {
        // Fall back to lowest-projected at most-stacked position
        candidate = getNextWeakestAtStackedPos(used);
      }

      if (candidate === null) {
        // Final fallback: cheapest remaining player
        const remaining = activePlayers
          .filter((p: any) => !used.has(p.id))
          .sort((a: any, b: any) => parseFloat(a.salary || '0') - parseFloat(b.salary || '0'));
        if (remaining.length > 0) candidate = remaining[0].id;
        else break;
      }

      used.add(candidate);
      selected.push({
        playerId: candidate,
        salary: salaryMap.get(candidate) || 0,
      });

      usePickup = !usePickup; // Alternate
    }

    results.push({
      franchiseId: franchise.id,
      activeCount: activePlayers.length,
      cutCandidates: selected.sort((a, b) => a.salary - b.salary),
    });
  }

  // Sort by most over-limit first
  return results.sort((a, b) => b.activeCount - a.activeCount);
}

// ── Draft Completion ──

/**
 * Pure check: do the parsed MFL draft results contain picks and is every
 * pick filled with a player? Exported separately so tests can cover the
 * empty/partial-pick logic with fixtures instead of live repo data.
 */
export function areAllDraftPicksFilled(data: any): boolean {
  if (!data?.draftResults?.draftUnit?.draftPick) return false;

  const picks = Array.isArray(data.draftResults.draftUnit.draftPick)
    ? data.draftResults.draftUnit.draftPick
    : [data.draftResults.draftUnit.draftPick];

  if (picks.length === 0) return false;

  return picks.every((p: any) => p.player && p.player.trim() !== '');
}

/**
 * Check if the rookie draft is complete by verifying all picks have players.
 */
export function isDraftComplete(leagueYear: number): boolean {
  return areAllDraftPicksFilled(
    readJsonFile(`data/theleague/mfl-feeds/${leagueYear}/draftResults.json`)
  );
}

// ── Player Lookup ──
import { getPlayerMap as getUnifiedPlayerMap } from './player-map';

function getPlayerMap(leagueYear: number): Map<string, { name: string; position: string; team: string }> {
  const identityMap = getUnifiedPlayerMap(leagueYear);
  const map = new Map<string, { name: string; position: string; team: string }>();
  for (const [id, identity] of identityMap) {
    map.set(id, {
      name: identity.name,
      position: identity.position,
      team: identity.nflTeam,
    });
  }
  // Also load non-fantasy-position players from raw feed (coaches, etc. may appear in transactions)
  const data = readJsonFile(`data/theleague/mfl-feeds/${leagueYear}/players.json`);
  if (data?.players?.player) {
    const players = Array.isArray(data.players.player) ? data.players.player : [data.players.player];
    for (const p of players) {
      if (!map.has(p.id)) {
        map.set(p.id, { name: p.name || 'Unknown', position: p.position || '', team: p.team || '' });
      }
    }
  }
  return map;
}

// ── Franchise Lookup ──

interface FranchiseConfig {
  franchiseId: string;
  name: string;
  nameShort?: string;
  icon: string;
  color: string;
}

function getFranchiseMap(): Map<string, FranchiseConfig> {
  const data = readJsonFile('src/data/theleague.config.json');
  const teams = data?.teams ?? data?.default?.teams ?? [];
  const map = new Map<string, FranchiseConfig>();
  for (const t of teams) {
    map.set(t.franchiseId, {
      franchiseId: t.franchiseId,
      name: t.name || '',
      nameShort: t.nameShort || t.nameMedium || t.name || '',
      icon: t.icon || '',
      color: t.color || '',
    });
  }
  return map;
}

// ── enrichHeroState ──

/**
 * Enrich a resolved HeroState with data from MFL feeds.
 * Only loads data for the currently active phase.
 */
export async function enrichHeroState(state: HeroState): Promise<HeroState> {
  switch (state.phase) {
    case 'champion-crowned':
      return enrichChampion(state);
    case 'tagged-showcase':
      return enrichTaggedShowcase(state);
    case 'cut-watch':
      return enrichCutWatch(state);
    case 'preseason-countdown':
      return enrichPreseason(state);
    case 'draft-countdown':
      return enrichDraftCountdown(state);
    default:
      return state;
  }
}

function enrichDraftCountdown(state: HeroState): HeroState {
  const refDate = state.metadata.referenceDate;
  const nflDraft = getNflDraftDate(refDate.getFullYear());
  const refMidnight = new Date(refDate); refMidnight.setHours(0, 0, 0, 0);
  const draftMidnight = new Date(nflDraft); draftMidnight.setHours(0, 0, 0, 0);
  const daysUntilDraft = Math.max(
    0,
    Math.round((draftMidnight.getTime() - refMidnight.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const nflDraftDate = nflDraft.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return { ...state, draftCountdownProps: { nflDraftDate, daysUntilDraft } };
}

/** NFL kickoff = Thursday after Labor Day (1st Monday of September). */
function getKickoffDate(year: number): Date {
  const laborDay = getNthDayOfMonth(year, 8, 1, 1); // 1st Monday of September
  const kickoff = new Date(laborDay);
  kickoff.setDate(kickoff.getDate() + 3); // Thursday = Monday + 3
  kickoff.setHours(0, 0, 0, 0);
  return kickoff;
}

function enrichPreseason(state: HeroState): HeroState {
  const refDate = state.metadata.referenceDate;
  const kickoff = getKickoffDate(refDate.getFullYear());
  const refMidnight2 = new Date(refDate); refMidnight2.setHours(0, 0, 0, 0);
  const kickoffMidnight = new Date(kickoff); kickoffMidnight.setHours(0, 0, 0, 0);
  const daysUntilKickoff = Math.max(
    0,
    Math.round((kickoffMidnight.getTime() - refMidnight2.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const kickoffDate = kickoff.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return { ...state, preseasonProps: { kickoffDate, daysUntilKickoff } };
}

function enrichChampion(state: HeroState): HeroState {
  // Championship spans Dec→Jan; resolve the correct season year
  const refDate = state.metadata.referenceDate;
  const refYear = refDate.getFullYear();
  // If we're in January, the championship was from the previous season year
  const refMonth = refDate.getMonth(); // 0-indexed
  const seasonYear = refMonth <= 1 ? refYear - 1 : refYear;

  // Try current season year first, then the previous one
  let result = getChampionshipResult(seasonYear);
  if (!result) result = getChampionshipResult(seasonYear - 1);
  if (!result) return state;

  const franchises = getFranchiseMap();
  const winner = franchises.get(result.winnerFranchiseId);
  const loser = franchises.get(result.loserFranchiseId);

  if (!winner || !loser) return state;

  return {
    ...state,
    championProps: {
      winnerFranchiseId: result.winnerFranchiseId,
      winnerName: winner.name,
      winnerIcon: winner.icon,
      winnerGroupMeIcon: winner.icon.startsWith('/assets/theleague/icons/')
        ? winner.icon.replace('/assets/theleague/icons/', '/assets/theleague/group-me/')
        : winner.icon,
      loserFranchiseId: result.loserFranchiseId,
      loserName: loser.name,
      winnerScore: result.winnerScore,
      loserScore: result.loserScore,
      leagueYear: seasonYear,
    },
  };
}

function enrichTaggedShowcase(state: HeroState): HeroState {
  const refDate = state.metadata.referenceDate;
  const leagueYear = refDate.getFullYear();

  const rawTags = getTaggedPlayers(leagueYear);
  if (rawTags.length === 0) {
    return { ...state, taggedShowcaseProps: { taggedPlayers: [] } };
  }

  const playerMap = getPlayerMap(leagueYear);
  const franchises = getFranchiseMap();

  const taggedPlayers = rawTags.map((tag) => {
    const player = playerMap.get(tag.playerId);
    const franchise = franchises.get(tag.franchiseId);
    return {
      playerId: tag.playerId,
      playerName: player?.name || 'Unknown Player',
      position: player?.position || '',
      nflTeam: player?.team || '',
      headshot: `https://sleepercdn.com/content/nfl/players/thumb/${tag.playerId}.jpg`,
      franchiseId: tag.franchiseId,
      franchiseName: franchise?.name || '',
      franchiseIcon: franchise?.icon || '',
    };
  });

  return { ...state, taggedShowcaseProps: { taggedPlayers } };
}

function enrichCutWatch(state: HeroState): HeroState {
  const refDate = state.metadata.referenceDate;
  const leagueYear = refDate.getFullYear();

  const rawCuts = getCutCandidates(leagueYear);
  const playerMap = getPlayerMap(leagueYear);
  const franchises = getFranchiseMap();

  // Deadline: 3rd Sunday of August
  const deadline = getNthDayOfMonth(leagueYear, 7, 0, 3); // 3rd Sunday of August
  const refMidnightCw = new Date(refDate); refMidnightCw.setHours(0, 0, 0, 0);
  const deadlineMidnight = new Date(deadline); deadlineMidnight.setHours(0, 0, 0, 0);
  const daysUntil = Math.max(0, Math.round((deadlineMidnight.getTime() - refMidnightCw.getTime()) / (1000 * 60 * 60 * 24)));
  const deadlineFormatted = deadline.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  const overLimitTeams = rawCuts.map((team) => {
    const franchise = franchises.get(team.franchiseId);
    return {
      franchiseId: team.franchiseId,
      franchiseName: franchise?.name || '',
      franchiseNameShort: franchise?.nameShort || franchise?.name || '',
      franchiseIcon: franchise?.icon || '',
      activeCount: team.activeCount,
      cutCandidates: team.cutCandidates.map((c) => {
        const player = playerMap.get(c.playerId);
        return {
          playerId: c.playerId,
          playerName: player?.name || 'Unknown',
          position: player?.position || '',
          salary: c.salary,
        };
      }),
    };
  });

  return {
    ...state,
    cutWatchProps: {
      overLimitTeams,
      deadlineDate: deadlineFormatted,
      daysUntilDeadline: daysUntil,
      urgent: isCutWatchUrgent(refDate),
    },
  };
}
