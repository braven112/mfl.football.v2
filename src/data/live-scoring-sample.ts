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
import type {
  LivePlayerRow,
  LiveScoringDemoDetail,
  LiveScoringPlay,
  MatchupPairing,
  NflGame,
  PlayerMeta,
} from '../types/live-scoring';

/** A regulation NFL game is 3600 game-seconds (mirrors live-win-probability). */
const NFL_GAME_SECONDS = 3600;

/**
 * Sample stand-in for /api/nfl-game-detail.
 *
 * `plays` carries one entry per franchise's top live scorer so the matchup
 * ticker has something to render offseason. It is EXPLICITLY not a play — the
 * historical feeds this sample is built from have no play-by-play, so the text
 * says what it actually is and `typeAbbrev` is left empty rather than claiming
 * a touchdown that we cannot verify happened.
 *
 * `boxScore` is deliberately EMPTY. Per-player stat lines come from ESPN's
 * athlete-keyed box score, which has no offseason equivalent here, and
 * inventing "5 rec, 64 yds" for a sample would put a fabricated stat line on
 * screen next to real ones. The island's honest "no stat line" state is what
 * shows instead; verify that feature against live data on a preview deploy.
 */
export type SampleDetail = LiveScoringDemoDetail;

export interface LiveScoringSample {
  week: number;
  matchups: MatchupPairing[];
  scores: Record<string, number>;
  remaining: Record<string, number>;
  players: Record<string, LivePlayerRow[]>;
  playersYetToPlay: Record<string, number>;
  playerMeta: Record<string, PlayerMeta>;
  nflGames: NflGame[];
  detail: SampleDetail;
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

/** A week's NFL game with its real final scores + assigned phase (pre-strip). */
interface RawGame {
  aCode: string;
  hCode: string;
  aFinal: number;
  hFinal: number;
  phase: GamePhase;
  /** Retained for deterministic possession assignment. */
  hash: number;
}

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
 * still in-progress — so the demo shows a live-Sunday mix. Returns a `byTeam`
 * map (each starter inherits their team's game state) plus the raw games with
 * their real final scores. Keyed by `normalizeTeamCode` so the strip and the
 * player rows agree regardless of feed code quirks. The strip itself is built
 * later (`buildStrip`) from actual player liveness, so a game only ever renders
 * "live" when a starter on it is genuinely still playing.
 */
function buildGamePhases(dataPath: string, year: number, week: number): {
  byTeam: Map<string, GamePhase>;
  rawGames: RawGame[];
} {
  const byTeam = new Map<string, GamePhase>();
  const rawGames: RawGame[] = [];
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
    const aFinal = Number(away.score) || 0;
    const hFinal = Number(home.score) || 0;

    const h = hashStr(`${aCode}@${hCode}`);
    const inProgress = h % 20 >= 11; // ~45% of games still being played

    let phase: GamePhase;
    if (!inProgress) {
      phase = FINAL_PHASE;
    } else {
      // Unsigned shift: h can exceed 2^31, and a signed `>>` would go negative
      // → negative index → undefined progress → NaN clock/scores.
      const progress = PROGRESS[(h >>> 5) % PROGRESS.length];
      const sec = Math.round(((1 - progress) * NFL_GAME_SECONDS) / 60) * 60;
      phase = { state: 'in', progress, sec };
    }
    byTeam.set(aCode, phase);
    byTeam.set(hCode, phase);
    rawGames.push({ aCode, hCode, aFinal, hFinal, phase, hash: h });
  }
  return { byTeam, rawGames };
}

/**
 * Render the NFL strip from the assigned phases, but downgrade any phased-live
 * game to Final unless a starter on it is actually still playing (`liveTeams`).
 * This keeps the strip a faithful mirror of the player rows: it never shows a
 * game live for a matchup whose starters have all been marked final (the
 * matchup-level "done" override decouples a starter's state from its NFL game).
 */
function buildStrip(rawGames: RawGame[], liveTeams: Set<string>): NflGame[] {
  return rawGames.map((g) => {
    const live = g.phase.state === 'in' && (liveTeams.has(g.aCode) || liveTeams.has(g.hCode));
    if (!live) {
      return game(g.aCode, g.aFinal, g.hCode, g.hFinal, 'post', 'Final', 4, '0:00', null);
    }
    const { progress, sec } = g.phase;
    const elapsed = NFL_GAME_SECONDS - sec;
    const quarter = Math.min(4, Math.floor(elapsed / 900) + 1);
    const remInQ = 900 - (elapsed % 900);
    const clock = `${Math.floor(remInQ / 60)}:${String(remInQ % 60).padStart(2, '0')}`;
    const poss = g.hash % 2 === 0 ? g.aCode : g.hCode;
    return game(
      g.aCode, Math.round(g.aFinal * progress),
      g.hCode, Math.round(g.hFinal * progress),
      'in', `${clock} - ${ordinal(quarter)}`, quarter, clock, poss,
    );
  });
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
      playersYetToPlay: {}, playerMeta: {}, nflGames: [],
      detail: { boxScore: {}, plays: [] },
    };
  }

  const { year, week } = final;
  const players: Record<string, LivePlayerRow[]> = {};
  const playerMeta: Record<string, PlayerMeta> = {};
  const scores: Record<string, number> = {};
  const remaining: Record<string, number> = {};
  const playersYetToPlay: Record<string, number> = {};
  const topScorers: Array<{ fid: string; id: string; name: string; team: string; live: number; sec: number }> = [];

  // Per-NFL-game phases (some Final, some in-progress). The strip is rendered
  // afterward from the teams that actually have a live starter (`liveTeams`).
  const { byTeam, rawGames } = buildGamePhases(league!.dataPath, year, week);
  const liveTeams = new Set<string>();

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
  //
  // KNOWN, INTENTIONAL TRADE-OFF: a fantasy matchup and an NFL game are
  // cross-cutting, so a forced-final starter can sit on an NFL team that another
  // (live) matchup's starter is still playing — that team then reads live on the
  // decorative NFL strip while this row reads Final. Making them perfectly agree
  // would require a starter's Final/Live to equal his NFL game's, which makes a
  // whole-matchup "Final" essentially impossible (matchups span too many teams)
  // and collapses the board to all-Live. The mix is the product ask; the strip
  // cross-reference mismatch is accepted for this offseason-only sample. Don't
  // "fix" it by tying starter state back to the game phase without re-reading
  // this — you'll silently delete the Final/Live board mix.
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
    let topStarter: { id: string; name: string; team: string; live: number; sec: number } | null = null;

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
      // Projection: final players get 0 (no boom, per-row "proj" shows the real
      // final). In-progress players target their real final — EXCEPT a
      // deterministic ~1-in-5 "hot" players already outscoring their projection,
      // which lights the green boom cell (live >= projected). A live floor keeps
      // bench-level scorers from booming.
      const hot = !isDone && live > 5 && hashStr(`${r.id}:hot`) % 5 === 0;
      const projected = isDone ? 0 : hot ? round2(live * 0.85) : finalPts;
      playerMeta[r.id] = {
        id: r.id,
        name: m?.name ?? 'Unknown Player',
        position: m?.position ?? '',
        nflTeam,
        headshot: m?.headshot ?? '',
        espnId: m?.espnId ?? null,
        projected,
      };
      rows.push({ id: r.id, live, secondsRemaining: sec, status: 'starter' });
      if (sec > 0 && nflTeam) liveTeams.add(normalizeTeamCode(nflTeam));
      if (!topStarter || live > topStarter.live) {
        topStarter = { id: r.id, name: m?.name ?? 'Unknown Player', team: nflTeam, live, sec };
      }
    }

    players[fid] = rows;
    scores[fid] = round2(rows.reduce((s, r) => s + r.live, 0));
    remaining[fid] = rows.reduce((s, r) => s + r.secondsRemaining, 0);
    playersYetToPlay[fid] = rows.filter((r) => r.secondsRemaining >= NFL_GAME_SECONDS).length;

    // One ticker row per team (its top live performer) so any opened matchup
    // shows both sides' standout; the detail view slices these to a handful.
    if (topStarter && topStarter.live > 0) {
      topScorers.push({ fid, ...topStarter });
    }
  }

  // Surface the biggest performances first. buildMoments() reverses the list
  // (ESPN orders plays chronologically, newest last), so seed it backwards to
  // land on biggest-first in the UI.
  topScorers.sort((a, b) => a.live - b.live);
  const plays: LiveScoringPlay[] = topScorers.map((t, i) => ({
    playId: `sample-${t.fid}`,
    gameId: `sample-${t.fid}`,
    sequence: i,
    period: 0,
    clock: clockForSec(t.sec),
    text: `${t.name} leads with ${t.live.toFixed(1)} pts`,
    typeAbbrev: '',
    typeText: '',
    nflTeam: normalizeTeamCode(t.team),
    scoreValue: 0,
    playerIds: [t.id],
  }));

  // Build the NFL strip now that we know which teams actually have a live
  // starter, so a phased-live game reads Final unless a starter is still on it.
  const nflGames = buildStrip(rawGames, liveTeams);

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
    detail: { boxScore: {}, plays },
  };
}

// ── current-roster demo (real rosters + a live NFL slate) ──────────────────

/**
 * Build a board from each franchise's REAL CURRENT ROSTER, for pairing with a
 * live NFL slate.
 *
 * Why this exists separately from the replay above. Between February and
 * kickoff MFL hands us nothing to score: `liveScoring` answers
 * "Live scoring not available until the season starts", and `weeklyResults`
 * for week 1 returns the matchups with EMPTY starters because no owner has
 * submitted a lineup yet. So a demo that wants to show the ESPN-backed
 * surfaces against a game being played right now cannot get its players from
 * MFL — but the current rosters are on disk and are real.
 *
 * FANTASY POINTS ARE ZERO HERE, deliberately. MFL has no scoring for a season
 * that has not started, and the ESPN box score cannot supply it — turning
 * yards into fantasy points needs each league's own scoring rules, which we do
 * not model. The same reasoning that leaves DEF/ST without a stat line applies
 * with more force to a whole board: a plausible invented total is worse than
 * an honest zero. What IS real here is every player, his NFL game, his clock,
 * his box-score line and his scoring plays — which is the half being
 * demonstrated.
 *
 * The caller is expected to leave the ESPN pollers ON and point them at a live
 * slate (see resolveEspnTarget); this returns no `nflGames` for that reason.
 */
export function getCurrentRosterSample(opts: { slug?: string; year: number }): LiveScoringSample {
  const league = getLeagueBySlug(opts.slug ?? DEFAULT_LEAGUE_SLUG);
  const empty: LiveScoringSample = {
    week: 1, matchups: [], scores: {}, remaining: {}, players: {},
    playersYetToPlay: {}, playerMeta: {}, nflGames: [], detail: { boxScore: {}, plays: [] },
  };
  if (!league) return empty;

  const dir = join(process.cwd(), league.dataPath, 'mfl-feeds', String(opts.year));
  const rosters = readJson(join(dir, 'rosters.json'))?.rosters?.franchise;
  const schedule = readJson(join(dir, 'schedule.json'))?.schedule;
  if (!rosters || !schedule) return empty;

  // Week 1's real pairings. Both leagues play doubleheaders, so this is one
  // entry per franchise rather than half that many.
  const weeks = asArray<any>(schedule.weeklySchedule);
  const week1 = weeks.find((w) => String(w?.week) === '1');
  const matchups: MatchupPairing[] = [];
  for (const m of asArray<any>(week1?.matchup)) {
    const ids = asArray<any>(m?.franchise).map((f) => String(f?.id ?? ''));
    if (ids.length >= 2 && ids[0] && ids[1]) matchups.push({ home: ids[0], away: ids[1] });
  }
  if (matchups.length === 0) return empty;

  // Rank by redraft ADP so a franchise's best players start, rather than
  // whatever order MFL happened to return its roster in.
  const adpRank = new Map<string, number>();
  for (const row of asArray<any>(readJson(join(dir, 'adp-redraft.json'))?.adp?.player)) {
    if (row?.id) adpRank.set(String(row.id), Number(row.averagePick) || Number.MAX_SAFE_INTEGER);
  }

  const starterSlots = resolveStarterSlots(readJson(join(dir, 'league.json'))?.league);

  const players: Record<string, LivePlayerRow[]> = {};
  const playerMeta: Record<string, PlayerMeta> = {};
  const scores: Record<string, number> = {};
  const remaining: Record<string, number> = {};
  const playersYetToPlay: Record<string, number> = {};

  const inMatchups = new Set<string>();
  for (const m of matchups) { inMatchups.add(m.home); inMatchups.add(m.away); }

  for (const f of asArray<any>(rosters)) {
    const fid = String(f?.id ?? '');
    if (!fid || !inMatchups.has(fid)) continue;

    const roster = asArray<any>(f?.player)
      .map((p) => ({ id: String(p?.id ?? ''), meta: getPlayer(opts.year, String(p?.id ?? '')) }))
      .filter((p) => p.id && p.meta)
      .sort(
        (a, b) =>
          (adpRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (adpRank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );

    const picked = pickStarters(roster, starterSlots);
    const rows: LivePlayerRow[] = [];
    for (const p of picked) {
      const m = p.meta!;
      playerMeta[p.id] = {
        id: p.id,
        name: m.name,
        position: m.position,
        nflTeam: m.nflTeam,
        headshot: m.headshot,
        espnId: m.espnId,
        // No projection either — same reason as the points.
        projected: 0,
      };
      // A FULL game remaining, not zero. Zero reads as "final" everywhere
      // downstream — the matchup header rendered a confident FINAL over
      // 0.0-0.0, which says the game ended scoreless rather than that it has
      // not been played. A full clock is the truthful state for a season that
      // has not started, and it makes the "yet to play" counts correct too.
      // The clock each row DISPLAYS still comes from the real ESPN game;
      // formatGameClock prefers it whenever one resolves.
      rows.push({ id: p.id, live: 0, secondsRemaining: NFL_GAME_SECONDS, status: 'starter' });
    }
    players[fid] = rows;
    scores[fid] = 0;
    remaining[fid] = rows.length * NFL_GAME_SECONDS;
    playersYetToPlay[fid] = rows.length;
  }

  return {
    week: 1,
    matchups,
    scores,
    remaining,
    players,
    playersYetToPlay,
    playerMeta,
    // Deliberately empty: the live poller supplies the real slate.
    nflGames: [],
    detail: { boxScore: {}, plays: [] },
  };
}

/** One starting slot: a position and how many of it are required. */
interface StarterSlot { position: string; count: number; flex: boolean }

/** The league's full starter rules: required slots, flex pool, and per-position caps. */
interface StarterRules {
  fixed: StarterSlot[];
  flexPositions: string[];
  /** Position → the MOST that may start there. Load-bearing during the flex fill. */
  maxByPosition: Map<string, number>;
  total: number;
}

/**
 * Read the league's own starter requirements rather than hardcoding a shape.
 * MFL expresses them as `{ name: 'RB', limit: '1-4' }` plus a total `count`,
 * so a fixed position takes its minimum and anything with a range is flex
 * that competes for the leftover slots.
 */
function resolveStarterSlots(league: any): StarterRules {
  const rows = asArray<any>(league?.starters?.position);
  const total = Number(league?.starters?.count) || 9;
  const fixed: StarterSlot[] = [];
  const flexPositions: string[] = [];
  const maxByPosition = new Map<string, number>();
  for (const r of rows) {
    const name = normalizePos(String(r?.name ?? ''));
    const limit = String(r?.limit ?? '');
    const min = Number(limit.split('-')[0]) || 0;
    const max = Number(limit.split('-')[1] ?? limit) || min;
    if (!name) continue;
    maxByPosition.set(name, max);
    if (min > 0) fixed.push({ position: name, count: min, flex: max > min });
    if (max > min) flexPositions.push(name);
  }
  if (fixed.length === 0) {
    // Config unreadable — fall back to the shape both leagues actually use.
    return {
      fixed: [
        { position: 'QB', count: 1, flex: false },
        { position: 'RB', count: 1, flex: true },
        { position: 'WR', count: 1, flex: true },
        { position: 'TE', count: 1, flex: true },
        { position: 'PK', count: 1, flex: false },
        { position: 'DEF', count: 1, flex: false },
      ],
      flexPositions: ['RB', 'WR', 'TE'],
      maxByPosition: new Map([['QB', 1], ['RB', 4], ['WR', 4], ['TE', 4], ['PK', 1], ['DEF', 1]]),
      total: 9,
    };
  }
  return { fixed, flexPositions, maxByPosition, total };
}

const normalizePos = (p: string): string => (p === 'Def' ? 'DEF' : p.toUpperCase());

/**
 * Fill every required slot, then the leftover flex slots, best ADP first.
 *
 * The per-position CAP is enforced throughout, not just the total. Without it
 * a lopsided roster overfills one slot — a real AFL franchise with seven
 * keepers started five wide receivers against a limit of four. A short lineup
 * is the correct outcome when the roster cannot legally fill the board (the
 * same franchise carrying two quarterbacks can only start one of them), and is
 * a truthful thing to show; an illegal one is not.
 */
function pickStarters(
  roster: Array<{ id: string; meta: ReturnType<typeof getPlayer> }>,
  slots: StarterRules,
): Array<{ id: string; meta: ReturnType<typeof getPlayer> }> {
  const used = new Set<string>();
  const usedByPos = new Map<string, number>();
  const out: Array<{ id: string; meta: ReturnType<typeof getPlayer> }> = [];

  const capFor = (pos: string) => slots.maxByPosition.get(pos) ?? slots.total;
  const take = (p: { id: string; meta: ReturnType<typeof getPlayer> }, pos: string) => {
    out.push(p);
    used.add(p.id);
    usedByPos.set(pos, (usedByPos.get(pos) ?? 0) + 1);
  };
  const hasRoom = (pos: string) => (usedByPos.get(pos) ?? 0) < capFor(pos);

  for (const slot of slots.fixed) {
    const atPos = roster.filter(
      (p) => !used.has(p.id) && normalizePos(p.meta?.position ?? '') === slot.position,
    );
    for (const p of atPos.slice(0, slot.count)) {
      if (!hasRoom(slot.position)) break;
      take(p, slot.position);
    }
  }

  const flex = new Set(slots.flexPositions.map(normalizePos));
  for (const p of roster) {
    if (out.length >= slots.total) break;
    if (used.has(p.id)) continue;
    const pos = normalizePos(p.meta?.position ?? '');
    if (!flex.has(pos) || !hasRoom(pos)) continue;
    take(p, pos);
  }
  return out.slice(0, slots.total);
}

