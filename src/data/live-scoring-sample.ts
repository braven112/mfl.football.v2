/**
 * Sample live-scoring dataset for `/theleague/live-scoring?demo=1`.
 *
 * The real MFL `liveScoring` feed is empty in the offseason, so this snapshot
 * lets us validate the deployed page (layout, theming, headshots, NFL strip,
 * moments) without a live game. It is only used when ?demo=1 is present and the
 * page renders a "SAMPLE DATA" badge; real usage never touches it.
 *
 * It's grounded in REAL data: the last completed regular season's final week
 * (`lastRegularSeasonWeek` from league.json). For that week we read each
 * franchise's actual starting lineup and the actual fantasy points every starter
 * scored (`weekly-results-raw.json`), and join identity + ESPN ids for headshots
 * (`players.json` via getPlayer).
 *
 * To demonstrate the LIVE experience (win-probability bar, live game clocks,
 * projected finals, boom cues), the week is presented MID-PLAY rather than as a
 * finished replay: each NFL game is assigned a deterministic phase — some Final,
 * some in-progress — and every starter inherits their NFL team's game state. A
 * finished player shows his real final points; an in-progress player shows a
 * partial live total with his real final as the projection, so the projected
 * finals still converge on the true historical results. The NFL strip games
 * mirror the same per-game phases. (A stable string hash drives the split, so
 * the slate is deterministic — no wall-clock/random, which keeps SSR output
 * cache-stable.)
 *
 * If a franchise's real lineup is missing/incomplete for that week, that one
 * team falls back to a roster-based lineup built from the salary snapshot so the
 * full slate still renders. Player headshots use real ESPN ids so the deployed
 * preview shows real photos (a wrong/missing id degrades to the MFL photo, then
 * the team-color gradient via the row onError).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPlayer } from '../utils/player-map';
import { normalizeTeamCode } from '../utils/nfl-logo';
import { DEFAULT_LEAGUE_SLUG, getLeagueBySlug } from '../config/leagues';
import type { LivePlayerRow, MatchupPairing, NflGame, PlayerMeta } from '../types/live-scoring';

/** A regulation NFL game is 3600 game-seconds (mirrors live-win-probability). */
const NFL_GAME_SECONDS = 3600;

/** Serializable moment seed (mirrors the island's Moment shape). */
export interface MomentSeed {
  key: string;
  fid: string;
  name: string;
  team: string;
  delta: number;
  clock: string;
}

export interface LiveScoringSample {
  week: number;
  matchups: MatchupPairing[];
  scores: Record<string, number>;
  remaining: Record<string, number>;
  players: Record<string, LivePlayerRow[]>;
  playersYetToPlay: Record<string, number>;
  playerMeta: Record<string, PlayerMeta>;
  nflGames: NflGame[];
  moments: MomentSeed[];
}

/** Row order the island renders top-to-bottom (QB → RB → WR → TE → PK → DEF). */
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
const posRank = (pos: string | undefined): number => {
  const i = POSITION_ORDER.indexOf((pos ?? '').toUpperCase());
  return i === -1 ? POSITION_ORDER.length : i;
};

const readJson = (path: string): any => {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
};

/** MFL feeds often return a lone object where a list is possible. */
const asArray = <T>(x: T | T[] | undefined | null): T[] =>
  Array.isArray(x) ? x : x == null ? [] : [x];

const round2 = (n: number): number => Number(n.toFixed(2));

/** Stable FNV-1a string hash — deterministic phase assignment, no RNG/clock. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ordinal = (q: number): string => (['', '1st', '2nd', '3rd', '4th'][q] ?? `${q}th`);

/** "Q3 8:20" for an in-progress game; "Final" once the clock hits 0. */
function clockForSec(sec: number): string {
  if (sec <= 0) return 'Final';
  const elapsed = NFL_GAME_SECONDS - sec;
  const quarter = Math.min(4, Math.floor(elapsed / 900) + 1);
  const remInQ = 900 - (elapsed % 900);
  return `Q${quarter} ${Math.floor(remInQ / 60)}:${String(remInQ % 60).padStart(2, '0')}`;
}

/** One NFL game's live state, shared by both its teams. */
interface GamePhase {
  state: 'in' | 'post';
  /** Fraction of the game played (1 = final). Drives partial live points. */
  progress: number;
  /** Game-seconds still to be played (0 = final). */
  sec: number;
}
const FINAL_PHASE: GamePhase = { state: 'post', progress: 1, sec: 0 };

const game = (
  away: string, aScore: number, home: string, hScore: number,
  state: 'pre' | 'in' | 'post', shortDetail: string, period: number, clock: string,
  possession: string | null,
): NflGame => ({
  id: `${away}-${home}`, state, shortDetail, period, clock,
  away: { code: away, score: aScore }, home: { code: home, score: hScore },
  possession, date: '',
});

/** One franchise's real starter for the resolved week: MFL id + points scored. */
interface StarterSeed {
  id: string;
  live: number;
}

interface FinalWeek {
  year: number;
  week: number;
  matchups: MatchupPairing[];
  /** franchiseId → real starters (may be empty if the feed didn't cover a team). */
  lineups: Record<string, StarterSeed[]>;
}

/**
 * Find the last completed regular season and its final week. Scans the feed
 * archive newest-first, reading each year's `lastRegularSeasonWeek` from
 * league.json, and returns the first year whose final regular-season week is
 * actually played (starters + scores present for every matchup). This naturally
 * skips a not-yet-started upcoming season whose weekly-results are still stubs.
 */
function resolveFinalRegularSeasonWeek(dataPath: string): FinalWeek | null {
  const feedsDir = join(process.cwd(), dataPath, 'mfl-feeds');
  let years: number[] = [];
  try {
    years = readdirSync(feedsDir)
      .filter((name) => /^\d{4}$/.test(name))
      .map(Number)
      .sort((a, b) => b - a); // newest first
  } catch {
    return null;
  }

  for (const year of years) {
    const yearDir = join(feedsDir, String(year));
    const league = readJson(join(yearDir, 'league.json'))?.league;
    const raw = readJson(join(yearDir, 'weekly-results-raw.json'));
    if (!league || !Array.isArray(raw)) continue;

    const week = parseInt(league.lastRegularSeasonWeek, 10);
    if (!Number.isFinite(week) || week < 1) continue;

    const payload = raw.find(
      (el: any) => parseInt(el?.weeklyResults?.week, 10) === week,
    );
    const matchupsRaw = asArray(payload?.weeklyResults?.matchup);
    if (matchupsRaw.length === 0) continue;

    const matchups: MatchupPairing[] = [];
    const lineups: Record<string, StarterSeed[]> = {};
    let wellFormed = true;
    let totalFranchises = 0;
    let scoredFranchises = 0;

    for (const m of matchupsRaw) {
      const franchises = asArray<any>(m.franchise);
      if (franchises.length !== 2) {
        wellFormed = false;
        break;
      }

      // Default away/home by array order; override from the isHome flag.
      let away = franchises[0].id as string;
      let home = franchises[1].id as string;

      for (const f of franchises) {
        totalFranchises += 1;
        const starterIds = String(f.starters ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const scoreById = new Map<string, number>();
        for (const p of asArray<any>(f.player)) {
          scoreById.set(String(p.id), Number(p.score) || 0);
        }
        // A franchise is "scored" only when it has real per-player results, not
        // just a locked lineup — a pre-kickoff stub can carry starters with no
        // player scores, which must NOT count as played.
        if (starterIds.length > 0 && scoreById.size > 0) scoredFranchises += 1;
        lineups[f.id] = starterIds.map((id) => ({ id, live: scoreById.get(id) ?? 0 }));
        if (String(f.isHome) === '1') home = f.id;
        else if (String(f.isHome) === '0') away = f.id;
      }

      matchups.push({ home, away });
    }

    // Accept the season only when the final week is genuinely played: reject
    // pre-kickoff stubs (0 scored) and in-progress weeks, but tolerate a small
    // export gap (≤2 missing franchises) since the per-team fallback fills those.
    if (!wellFormed || scoredFranchises === 0 || scoredFranchises < totalFranchises - 2) {
      continue;
    }
    return { year, week, matchups, lineups };
  }

  return null;
}

/**
 * Roster-based fallback for a franchise whose real lineup is missing/incomplete
 * for the resolved week. Reads the salary snapshot, takes that franchise's
 * highest-scoring rostered players by position, and approximates a weekly total
 * by dividing season points across the weeks played to that point. Real data
 * covers every team, so this is defensive only.
 */
function buildFallbackLineup(year: number, fid: string, week: number): StarterSeed[] {
  const salaries = readJson(join(process.cwd(), 'src/data', `mfl-player-salaries-${year}.json`));
  const list = asArray<any>(salaries?.players).filter(
    (p) => p?.franchiseId === fid && posRank(p.position) < POSITION_ORDER.length,
  );
  if (list.length === 0) return [];

  list.sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));

  // 1 QB / 2 RB / 3 WR / 1 TE / 1 PK / 1 DEF, then backfill to 9.
  const template: Array<[string, number]> = [
    ['QB', 1], ['RB', 2], ['WR', 3], ['TE', 1], ['PK', 1], ['DEF', 1],
  ];
  const picked: any[] = [];
  const used = new Set<string>();
  for (const [pos, count] of template) {
    const atPos = list.filter((p) => (p.position ?? '').toUpperCase() === pos && !used.has(p.id));
    for (const p of atPos.slice(0, count)) {
      picked.push(p);
      used.add(p.id);
    }
  }
  for (const p of list) {
    if (picked.length >= 9) break;
    if (!used.has(p.id)) {
      picked.push(p);
      used.add(p.id);
    }
  }

  // Approximate a weekly figure from the season total across the weeks played.
  const weeksPlayed = Math.max(1, week);
  return picked.slice(0, 9).map((p) => ({
    id: String(p.id),
    live: round2((Number(p.points) || 0) / weeksPlayed),
  }));
}

/**
 * Assign every NFL game in the week a deterministic phase — ~55% Final, ~45%
 * still in-progress — so the demo shows a live-Sunday mix. Returns both a
 * `byTeam` map (each starter inherits their team's game state) and the strip's
 * `NflGame[]` rendered to match: Final games carry the real final score, live
 * games a partial score + clock + possession. Keyed by `normalizeTeamCode` so
 * the strip and the player rows agree regardless of feed code quirks.
 */
function buildGamePhases(dataPath: string, year: number, week: number): {
  byTeam: Map<string, GamePhase>;
  games: NflGame[];
} {
  const byTeam = new Map<string, GamePhase>();
  const games: NflGame[] = [];
  const data = readJson(join(process.cwd(), dataPath, 'mfl-feeds', String(year), 'nflSchedule.json'));
  const wk = asArray<any>(data?.fullNflSchedule?.nflSchedule).find(
    (w) => parseInt(w.week, 10) === week,
  );
  // Spread of "how far along" for the in-progress games (Q2 → late Q4).
  const PROGRESS = [0.28, 0.42, 0.55, 0.68, 0.82];

  for (const m of asArray<any>(wk?.matchup)) {
    const teams = asArray<any>(m.team);
    if (teams.length !== 2) continue;
    const away = teams.find((t) => String(t.isHome) === '0') ?? teams[0];
    const home = teams.find((t) => String(t.isHome) === '1') ?? teams[1];
    const aCode = normalizeTeamCode(String(away.id));
    const hCode = normalizeTeamCode(String(home.id));
    const aScore = Number(away.score) || 0;
    const hScore = Number(home.score) || 0;

    const h = hashStr(`${aCode}@${hCode}`);
    const inProgress = h % 20 >= 11; // ~45% of games still being played

    if (!inProgress) {
      byTeam.set(aCode, FINAL_PHASE);
      byTeam.set(hCode, FINAL_PHASE);
      games.push(game(aCode, aScore, hCode, hScore, 'post', 'Final', 4, '0:00', null));
    } else {
      // Unsigned shift: h can exceed 2^31, and a signed `>>` would go negative
      // → negative index → undefined progress → NaN clock/scores.
      const progress = PROGRESS[(h >>> 5) % PROGRESS.length];
      const sec = Math.round(((1 - progress) * NFL_GAME_SECONDS) / 60) * 60;
      const phase: GamePhase = { state: 'in', progress, sec };
      byTeam.set(aCode, phase);
      byTeam.set(hCode, phase);
      const elapsed = NFL_GAME_SECONDS - sec;
      const quarter = Math.min(4, Math.floor(elapsed / 900) + 1);
      const remInQ = 900 - (elapsed % 900);
      const clock = `${Math.floor(remInQ / 60)}:${String(remInQ % 60).padStart(2, '0')}`;
      const poss = h % 2 === 0 ? aCode : hCode;
      games.push(game(
        aCode, Math.round(aScore * progress),
        hCode, Math.round(hScore * progress),
        'in', `${clock} - ${ordinal(quarter)}`, quarter, clock, poss,
      ));
    }
  }
  return { byTeam, games };
}

/**
 * Doubleheader round B: give every team a second game against a fresh opponent
 * by re-pairing round A (each away team hosts the next matchup's home team). All
 * 16 franchises appear exactly once, so the user's team plays twice.
 */
function buildRoundB(roundA: MatchupPairing[]): MatchupPairing[] {
  const homes = roundA.map((m) => m.home);
  const aways = roundA.map((m) => m.away);
  const n = roundA.length;
  return roundA.map((_, i) => ({ home: aways[i], away: homes[(i + 1) % n] }));
}

export function getLiveScoringSample(
  opts: { doubleheader?: boolean; slug?: string } = {},
): LiveScoringSample {
  const league = getLeagueBySlug(opts.slug ?? DEFAULT_LEAGUE_SLUG);
  const final = league ? resolveFinalRegularSeasonWeek(league.dataPath) : null;

  // Feeds unavailable — return an empty-but-valid snapshot (island shows its
  // "scores will appear" state) rather than throwing on the page.
  if (!final) {
    return {
      week: 1, matchups: [], scores: {}, remaining: {}, players: {},
      playersYetToPlay: {}, playerMeta: {}, nflGames: [], moments: [],
    };
  }

  const { year, week } = final;
  const players: Record<string, LivePlayerRow[]> = {};
  const playerMeta: Record<string, PlayerMeta> = {};
  const scores: Record<string, number> = {};
  const remaining: Record<string, number> = {};
  const playersYetToPlay: Record<string, number> = {};
  const moments: MomentSeed[] = [];

  // Per-NFL-game phases (some Final, some in-progress) + the matching strip.
  const { byTeam, games: nflGames } = buildGamePhases(league!.dataPath, year, week);

  const franchiseIds = new Set<string>();
  for (const m of final.matchups) {
    franchiseIds.add(m.home);
    franchiseIds.add(m.away);
  }

  // Matchup-level mix. Fantasy starters spread across ~every NFL team, so with
  // ~45% of games in-progress essentially every matchup would have a live
  // player and read "Live". To show a genuine mix, mark ~half the matchups as
  // complete (both franchises' games treated as final); the rest stay in-play
  // and inherit the per-NFL-game phases (win-probability bar, live clocks).
  // Doubleheader shares a franchise across two matchups, so skip the override
  // there and let everyone run on real per-game phases.
  const doneFids = new Set<string>();
  if (!opts.doubleheader) {
    for (const m of final.matchups) {
      if (hashStr(`${m.away}|${m.home}`) % 2 === 0) {
        doneFids.add(m.home);
        doneFids.add(m.away);
      }
    }
  }

  for (const fid of franchiseIds) {
    let seeds = final.lineups[fid] ?? [];
    // Top up from the roster-based fallback whenever the real lineup is missing
    // or short, so every team keeps the valid-9 invariant. De-dup by id so a
    // fallback pick can't repeat a real starter.
    if (seeds.length < 9) {
      const have = new Set(seeds.map((s) => s.id));
      const fill = buildFallbackLineup(year, fid, week).filter((s) => !have.has(s.id));
      seeds = [...seeds, ...fill].slice(0, 9);
    }

    // Resolve identity, order by position, keep the valid 9.
    const resolved = seeds
      .map((s) => ({ ...s, meta: getPlayer(year, s.id) }))
      .sort((a, b) => posRank(a.meta?.position) - posRank(b.meta?.position))
      .slice(0, 9);

    const rows: LivePlayerRow[] = [];
    let topStarter: { name: string; team: string; live: number; sec: number } | null = null;

    for (const r of resolved) {
      const m = r.meta;
      const nflTeam = m?.nflTeam ?? '';
      const finalPts = round2(r.live); // real fantasy points this player scored
      // A "completed" matchup forces every starter final; an in-play matchup
      // uses the real per-NFL-game phase.
      const phase = doneFids.has(fid)
        ? FINAL_PHASE
        : (byTeam.get(normalizeTeamCode(nflTeam)) ?? FINAL_PHASE);
      const isDone = phase.state === 'post';
      // In-progress: partial live total, with the real final as the projection
      // (projected * fractionLeft carries the row's projected-final back to the
      // true result). Final: full points, projection 0 so the per-row "proj"
      // shows the actual final without lighting "boom" on every positive scorer.
      const live = isDone ? finalPts : round2(finalPts * phase.progress);
      const sec = isDone ? 0 : phase.sec;
      playerMeta[r.id] = {
        id: r.id,
        name: m?.name ?? 'Unknown Player',
        position: m?.position ?? '',
        nflTeam,
        headshot: m?.headshot ?? '',
        espnId: m?.espnId ?? null,
        projected: isDone ? 0 : finalPts,
      };
      rows.push({ id: r.id, live, secondsRemaining: sec, status: 'starter' });
      if (!topStarter || live > topStarter.live) {
        topStarter = { name: m?.name ?? 'Unknown Player', team: nflTeam, live, sec };
      }
    }

    players[fid] = rows;
    scores[fid] = round2(rows.reduce((s, r) => s + r.live, 0));
    remaining[fid] = rows.reduce((s, r) => s + r.secondsRemaining, 0);
    playersYetToPlay[fid] = rows.filter((r) => r.secondsRemaining >= NFL_GAME_SECONDS).length;

    // One moment per team (its top live performer) so any opened matchup shows
    // both sides' standout; the detail view slices these to the first handful.
    if (topStarter && topStarter.live > 0) {
      moments.push({
        key: `m-${fid}`,
        fid,
        name: topStarter.name,
        team: topStarter.team,
        delta: topStarter.live,
        clock: clockForSec(topStarter.sec),
      });
    }
  }

  // Surface the biggest performances first.
  moments.sort((a, b) => b.delta - a.delta);

  const matchups = opts.doubleheader
    ? [...final.matchups, ...buildRoundB(final.matchups)]
    : final.matchups;

  return {
    week,
    matchups,
    scores,
    remaining,
    players,
    playersYetToPlay,
    playerMeta,
    nflGames,
    moments,
  };
}
