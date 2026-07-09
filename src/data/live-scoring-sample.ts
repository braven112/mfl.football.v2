/**
 * Sample live-scoring dataset for `/theleague/live-scoring?demo=1`.
 *
 * The real MFL `liveScoring` feed is empty in the offseason, so this snapshot
 * lets us validate the deployed page (layout, theming, headshots, NFL strip,
 * moments) without a live game. It is only used when ?demo=1 is present and the
 * page renders a "SAMPLE DATA" badge; real usage never touches it.
 *
 * Rather than synthesize scores, the demo replays a REAL historical scoreboard:
 * the last game of the last completed regular season — the league's final
 * regular-season week (`lastRegularSeasonWeek` from league.json). For that week
 * we read each franchise's actual starting lineup and the actual fantasy points
 * every starter scored (`weekly-results-raw.json`), join player identity + ESPN
 * ids for headshots (`players.json` via getPlayer), and pull the week's real
 * final NFL scores for the strip (`nflSchedule.json`). Every game is `Final`
 * (secondsRemaining 0), so the totals, per-player points, winners, and margins
 * all match the true historical results.
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
import { getLeagueBySlug } from '../config/leagues';
import type { LivePlayerRow, MatchupPairing, NflGame, PlayerMeta } from '../types/live-scoring';

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
    let played = true;

    for (const m of matchupsRaw) {
      const franchises = asArray<any>(m.franchise);
      if (franchises.length !== 2) {
        played = false;
        break;
      }

      // Default away/home by array order; override from the isHome flag.
      let away = franchises[0].id as string;
      let home = franchises[1].id as string;

      for (const f of franchises) {
        const starterIds = String(f.starters ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const scoreById = new Map<string, number>();
        for (const p of asArray<any>(f.player)) {
          scoreById.set(String(p.id), Number(p.score) || 0);
        }
        if (starterIds.length === 0) played = false;
        lineups[f.id] = starterIds.map((id) => ({ id, live: scoreById.get(id) ?? 0 }));
        if (String(f.isHome) === '1') home = f.id;
        else if (String(f.isHome) === '0') away = f.id;
      }

      matchups.push({ home, away });
    }

    if (!played) continue;
    return { year, week, matchups, lineups };
  }

  return null;
}

/**
 * Roster-based fallback for a franchise whose real lineup is missing/incomplete
 * for the resolved week. Reads the salary snapshot, takes that franchise's
 * highest-scoring rostered players by position, and approximates a weekly total
 * from season points. Real data covers every team, so this is defensive only.
 */
function buildFallbackLineup(year: number, fid: string): StarterSeed[] {
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

  // Approximate a weekly figure from the season total (18 max weeks).
  return picked.slice(0, 9).map((p) => ({
    id: String(p.id),
    live: round2((Number(p.points) || 0) / 18),
  }));
}

/** Real final NFL scores for the strip, straight from the week's schedule feed. */
function buildNflGames(dataPath: string, year: number, week: number): NflGame[] {
  const data = readJson(join(process.cwd(), dataPath, 'mfl-feeds', String(year), 'nflSchedule.json'));
  const wk = asArray<any>(data?.fullNflSchedule?.nflSchedule).find(
    (w) => parseInt(w.week, 10) === week,
  );
  const games: NflGame[] = [];
  for (const m of asArray<any>(wk?.matchup)) {
    const teams = asArray<any>(m.team);
    if (teams.length !== 2) continue;
    const away = teams.find((t) => String(t.isHome) === '0') ?? teams[0];
    const home = teams.find((t) => String(t.isHome) === '1') ?? teams[1];
    games.push(game(
      away.id, Number(away.score) || 0,
      home.id, Number(home.score) || 0,
      'post', 'Final', 4, '0:00', null,
    ));
  }
  return games;
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
  const dataPath = getLeagueBySlug(opts.slug ?? 'theleague')?.dataPath ?? 'data/theleague';
  const final = resolveFinalRegularSeasonWeek(dataPath);

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

  const franchiseIds = new Set<string>();
  for (const m of final.matchups) {
    franchiseIds.add(m.home);
    franchiseIds.add(m.away);
  }

  for (const fid of franchiseIds) {
    let seeds = final.lineups[fid];
    if (!seeds || seeds.length === 0) seeds = buildFallbackLineup(year, fid);

    // Resolve identity, order by position, keep the valid 9.
    const resolved = seeds
      .map((s) => ({ ...s, meta: getPlayer(year, s.id) }))
      .sort((a, b) => posRank(a.meta?.position) - posRank(b.meta?.position))
      .slice(0, 9);

    const rows: LivePlayerRow[] = [];
    let topStarter: { name: string; team: string; live: number } | null = null;

    for (const r of resolved) {
      const m = r.meta;
      const live = round2(r.live);
      playerMeta[r.id] = {
        id: r.id,
        name: m?.name ?? 'Unknown Player',
        position: m?.position ?? '',
        nflTeam: m?.nflTeam ?? '',
        headshot: m?.headshot ?? '',
        espnId: m?.espnId ?? null,
        // Game is final, so the "projection" is the actual final total.
        projected: live,
      };
      rows.push({ id: r.id, live, secondsRemaining: 0, status: 'starter' });
      if (!topStarter || live > topStarter.live) {
        topStarter = { name: m?.name ?? 'Unknown Player', team: m?.nflTeam ?? '', live };
      }
    }

    players[fid] = rows;
    scores[fid] = round2(rows.reduce((s, r) => s + r.live, 0));
    remaining[fid] = 0; // completed game
    playersYetToPlay[fid] = 0;

    // One moment per team (its top starter) so any opened matchup shows both
    // sides' standout; the detail view slices these to the first handful.
    if (topStarter && topStarter.live > 0) {
      moments.push({
        key: `m-${fid}`,
        fid,
        name: topStarter.name,
        team: topStarter.team,
        delta: topStarter.live,
        clock: 'Final',
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
    nflGames: buildNflGames(dataPath, year, week),
    moments,
  };
}
