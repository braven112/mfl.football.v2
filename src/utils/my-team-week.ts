/**
 * "This week" data for the homepage My Team card, for every league.
 *
 * Owner traffic (Owner Activity, Oct 2026) is ~85% six pages, and nearly every
 * visit starts on the homepage — so in season the card answers "what do I
 * need to do this week?" instead of showing the offseason numbers (expiring
 * contracts, draft picks) it carried all year.
 *
 * Two halves, kept apart so the rules are testable without a network:
 *  - `lineupStatusFromStarters` — PURE. What one franchise's saved starters
 *    say once crossed with injuries, byes and kickoffs. The flagging rule is
 *    the pre-kickoff GroupMe check's own (`scripts/lib/lineup-warnings.mjs`),
 *    imported rather than restated, so the card and the chat never disagree
 *    about who "can't play".
 *  - `loadMyTeamWeek` — the I/O: committed feeds off disk plus ONE live
 *    weeklyResults read, shared (and cached) with the hero's lineup check.
 *
 * docs/claude/rules/lineups.md governs the lineup half: "no lineup" and
 * "couldn't read it" are different answers, so a failed live read yields
 * `unknown` and the card says nothing rather than "not set".
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LeagueDefinition } from '../config/leagues';
import { findNextGame, franchiseSchedule, parseWeeklySchedule } from './schedule-data.mjs';
import { extractLineupStarters, findWeekResultsEntry, franchiseAppearsIn, loadWeeklyResultsFeedFromDisk } from './lineup-sources';
import { readLiveWeekResults } from './lineup-submitted';
import { byeWeeksForSeason } from './nfl-bye-weeks';
import { isSeasonWindowOpen } from './pecking-order-season-window.mjs';
import { asArray } from './mfl-normalize';
import {
  buildLineupWarnings,
  buildPlayerIndex,
  dropLockedProblems,
  formatPlayerName,
  parseInjuries,
  parseKickoffsByTeam,
  parseRequiredStarters,
} from '../../scripts/lib/lineup-warnings.mjs';

export type LineupProblemType = 'OUT' | 'IR' | 'SUSPENDED' | 'RETIRED' | 'HOLDOUT' | 'BYE';

export interface LineupProblem {
  playerId: string;
  name: string;
  position: string;
  type: LineupProblemType;
}

export interface LineupStatus {
  /** `unknown` = MFL could not be read; the card must not claim either way. */
  state: 'set' | 'not-set' | 'unknown';
  /** Starters who cannot play and whose game has not locked yet. */
  problems: LineupProblem[];
  /** Starting slots left empty (a partial lineup). */
  emptySlots: number;
}

export interface MyTeamWeekGame {
  opponentId: string;
  isHome: boolean;
}

export interface MyTeamWeek {
  week: number;
  /** One per game: a doubleheader week lists both opponents. */
  games: MyTeamWeekGame[];
  record: { wins: number; losses: number; ties: number } | null;
  /** Points for, from the standings feed. */
  pointsFor: number | null;
  /** Null when the viewer is not the signed-in owner of this franchise. */
  lineup: LineupStatus | null;
}

interface PlayerLike {
  name: string;
  position: string;
  team: string;
}

/**
 * Pure: the lineup state for one franchise from its saved starters.
 * `starters` null means "could not read" → `unknown`, never `not-set`.
 */
export function lineupStatusFromStarters(args: {
  franchiseId: string;
  starters: string[] | null;
  players: Map<string, PlayerLike>;
  injuries: Map<string, string>;
  byeTeams: Set<string>;
  kickoffsByTeam: Map<string, number>;
  requiredStarters: number | null;
  now: Date;
}): LineupStatus {
  const { starters } = args;
  if (starters == null) return { state: 'unknown', problems: [], emptySlots: 0 };

  const warnings = dropLockedProblems(
    buildLineupWarnings({
      lineups: [{ franchiseId: args.franchiseId, starters }],
      players: args.players,
      injuries: args.injuries,
      byeTeams: args.byeTeams,
      requiredStarters: args.requiredStarters,
    }),
    args.kickoffsByTeam,
    args.now,
  );
  const w = warnings[0];
  if (starters.length === 0) {
    // Once every game has kicked off there is nothing left to set: say
    // nothing rather than a warning with an armed Set Lineup button.
    const t = args.now.getTime();
    const kickoffs = [...args.kickoffsByTeam.values()];
    const anyGameAhead = kickoffs.length === 0 || kickoffs.some((at) => at > t);
    return anyGameAhead ? { state: 'not-set', problems: [], emptySlots: 0 } : { state: 'unknown', problems: [], emptySlots: 0 };
  }
  return {
    state: 'set',
    problems: (w?.problems ?? []).map((p: any) => ({
      playerId: p.playerId,
      name: formatPlayerName(p.playerName),
      position: p.position,
      type: p.type as LineupProblemType,
    })),
    emptySlots: w?.emptySlots ?? 0,
  };
}

/**
 * One committed feed under data/<league>/mfl-feeds/<year>/, or null. Same as
 * sunday-ticket-sources' readLeagueFeed, kept local so the homepage does not
 * import that module's live-scoring/Redis graph for five lines.
 */
function readFeed(league: LeagueDefinition, year: number, file: string): any | null {
  try {
    const p = path.join(process.cwd(), league.dataPath, 'mfl-feeds', String(year), file);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  } catch {
    return null;
  }
}

const playerIndexCache = new Map<string, Map<string, PlayerLike>>();

/** MFL player id → {name, position, team} with MFL's own team codes. Cached per league-year. */
export function starterPlayerIndex(league: LeagueDefinition, leagueYear: number): Map<string, PlayerLike> {
  const key = `${league.slug}:${leagueYear}`;
  let index = playerIndexCache.get(key);
  if (!index) {
    index = buildPlayerIndex(readFeed(league, leagueYear, 'players.json')) as Map<string, PlayerLike>;
    playerIndexCache.set(key, index);
  }
  return index;
}

/**
 * Everything the in-season card needs, or null when it should not show:
 * outside the season window, or once the franchise has no game left to play
 * (the offseason card is the right one from then on).
 *
 * `leagueYear` keys the feed directory (it rolls before Labor Day), and
 * `seasonYear` decides the window and the bye calendar — in season the two
 * agree, but they are passed separately so neither is derived from the other.
 */
export async function loadMyTeamWeek(input: {
  league: LeagueDefinition;
  franchiseId: string;
  /** True only when the viewer is SIGNED IN as this franchise. */
  isOwner: boolean;
  leagueYear: number;
  seasonYear: number;
  currentNflWeek: number | null;
  now: Date;
  fetchImpl?: typeof fetch;
}): Promise<MyTeamWeek | null> {
  const { league, franchiseId, leagueYear, seasonYear, now } = input;
  if (!franchiseId || !isSeasonWindowOpen(seasonYear, now)) return null;

  const schedule = franchiseSchedule(parseWeeklySchedule(readFeed(league, leagueYear, 'schedule.json')), franchiseId);
  const next = findNextGame(schedule, input.currentNflWeek ?? 1);
  if (!next) return null;
  const week = next.week;
  const games = (schedule.find((w) => w.week === week)?.games ?? [])
    .filter((g) => !g.played)
    .map((g) => ({ opponentId: g.opponentId, isHome: g.isHome }));

  const standings = asArray<any>(readFeed(league, leagueYear, 'standings.json')?.leagueStandings?.franchise);
  const row = standings.find((f) => f?.id === franchiseId);
  const parts = String(row?.h2hwlt ?? '').split('-').map((n) => parseInt(n, 10));
  const record = parts.length === 3 && parts.every(Number.isFinite)
    ? { wins: parts[0], losses: parts[1], ties: parts[2] }
    : null;
  const pf = parseFloat(row?.pf ?? '');

  let lineup: LineupStatus | null = null;
  if (input.isOwner) {
    const live = await readLiveWeekResults({
      league,
      franchiseId,
      week,
      leagueYear,
      timeoutMs: 2000,
      fetchImpl: input.fetchImpl,
    });
    let starters: string[] | null = null;
    if (live) {
      const entry = findWeekResultsEntry(live, week, { allowUnlabeled: true });
      if (entry && franchiseAppearsIn(entry, franchiseId)) {
        starters = extractLineupStarters(entry, franchiseId).map((s) => s.id);
      }
    } else {
      // Disk is confirm-only (it syncs daily): it may say "set", never "not set".
      const disk = findWeekResultsEntry(loadWeeklyResultsFeedFromDisk(league.slug as any, leagueYear), week);
      const fromDisk = disk ? extractLineupStarters(disk, franchiseId).map((s) => s.id) : [];
      if (fromDisk.length > 0) starters = fromDisk;
    }

    // Raw MFL team codes (KCC, SFO, NEP…), exactly as the GroupMe check reads
    // them: the bye calendar and the kickoff map are keyed by MFL codes, and
    // `getPlayerMap` normalizes to ESPN codes (KC, SF, NE), which silently
    // missed byes and locks for nine clubs.
    const players = starterPlayerIndex(league, leagueYear);
    const byes = byeWeeksForSeason(seasonYear) ?? {};
    const byeTeams = new Set(Object.entries(byes).filter(([, w]) => w === week).map(([team]) => team));
    const fullSchedule = readFeed(league, leagueYear, 'nflSchedule-full.json');
    const nflWeek = asArray<any>(fullSchedule?.fullNflSchedule?.nflSchedule).find((w) => Number(w?.week) === week);

    lineup = lineupStatusFromStarters({
      franchiseId,
      starters,
      players,
      injuries: parseInjuries(readFeed(league, leagueYear, 'injuries.json')),
      byeTeams,
      kickoffsByTeam: parseKickoffsByTeam(nflWeek ? { nflSchedule: nflWeek } : null),
      requiredStarters: parseRequiredStarters(readFeed(league, leagueYear, 'league.json')),
      now,
    });
    // A disk-confirmed lineup may be stale: never report problems from it.
    if (!live && lineup.state === 'set') lineup = { ...lineup, problems: [], emptySlots: 0 };
  }

  return {
    week,
    games,
    record,
    pointsFor: Number.isFinite(pf) ? pf : null,
    lineup,
  };
}
