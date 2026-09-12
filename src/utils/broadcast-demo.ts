/**
 * A ten-minute rehearsal of a Sunday, on a loop.
 *
 * PURE. Given the board's real panels and player identities it produces the
 * same `BroadcastPollResponse` the live assembler does — so the island runs
 * its ordinary code path and every screen is exercised for real: the reveal
 * queue, the takeover vs the lower third, the red-zone banner, the rotating
 * strip, the score and projection climbing, and the screensaver at the end.
 *
 * It exists because the board cannot otherwise be SEEN. Outside a live NFL
 * window there are no plays, so a reveal never fires — and "looks right when
 * nothing is happening" is the one thing this board must not be judged on.
 * The draft broadcast has the same problem and answers it the same way
 * (`?rehearse=`).
 *
 * Two rules it must not break:
 *
 *  - **Nothing here may reach the real board.** The island only calls this
 *    when `?demo=1` is on the URL, and the page badges itself while it does.
 *    A demo that could be mistaken for live scores is worse than no demo.
 *  - **Real identities, invented events.** Your own franchises, your own
 *    players, your own crests and colours — so what you are judging is the
 *    board you will actually watch, not a mock of it. Only the plays and the
 *    numbers are fabricated.
 */

import type {
  BroadcastLeaguePanel,
  BroadcastLeagueScore,
  BroadcastPollResponse,
  BroadcastTeamScore,
} from '../types/live-broadcast';
import type { LivePlayerRow, NflGame, PlayerMeta } from '../types/live-scoring';
import type { BroadcastMoment, MomentKind, RedZoneAlert } from './broadcast-moments';

/** One loop of the rehearsal. */
export const DEMO_PERIOD_MS = 10 * 60_000;

/** How long a red-zone drive stays on screen once it starts. */
const DEMO_REDZONE_MS = 40_000;

/**
 * A scripted event. `at` is ms from the start of the loop.
 *
 * The script is deliberately a DATA structure rather than a random walk: a
 * rehearsal you cannot predict is one you cannot check a fix against, and the
 * point of watching it twice is to see the same sequence render the same way.
 */
export interface DemoEvent {
  at: number;
  /** Which franchise the play belongs to. */
  side: 'mine' | 'opponent';
  kind: MomentKind;
  /** Slot the scoring player is drawn from, so every position gets a turn. */
  position: string;
  /** Fantasy points the play adds to that franchise's total. */
  points: number;
  /** Yards, for the big-play copy. */
  yards?: number;
  text: string;
}

/**
 * The running order.
 *
 * Built to exercise every screen in one loop rather than to be realistic:
 * both sides score, each position takes a turn, the queue gets two plays
 * eight seconds apart so the backlog behaviour is visible, and the last
 * ninety seconds are deliberately quiet so the board settles.
 */
export const DEMO_SCRIPT: readonly DemoEvent[] = [
  { at: 20_000, side: 'mine', kind: 'field-goal', position: 'PK', points: 3, text: '38 Yd Field Goal' },
  { at: 55_000, side: 'opponent', kind: 'touchdown', position: 'RB', points: 6.4, text: '4 Yd Rush (Kick)' },
  { at: 95_000, side: 'mine', kind: 'touchdown', position: 'WR', points: 11.2, yards: 32, text: '32 Yd pass (Kick)' },
  { at: 130_000, side: 'mine', kind: 'big-play', position: 'RB', points: 5.7, yards: 57, text: 'Rush for 57 Yds' },
  { at: 138_000, side: 'opponent', kind: 'field-goal', position: 'PK', points: 3, text: '51 Yd Field Goal' },
  // Two within eight seconds: the queue has to hold one back.
  { at: 185_000, side: 'mine', kind: 'touchdown', position: 'QB', points: 9.8, yards: 12, text: '12 Yd Rush (Kick)' },
  { at: 193_000, side: 'opponent', kind: 'touchdown', position: 'WR', points: 12.6, yards: 44, text: '44 Yd pass (Kick)' },
  { at: 240_000, side: 'mine', kind: 'turnover', position: 'DEF', points: 2, text: 'Interception' },
  { at: 285_000, side: 'mine', kind: 'touchdown', position: 'TE', points: 10.4, yards: 9, text: '9 Yd pass (Kick)' },
  { at: 320_000, side: 'opponent', kind: 'big-play', position: 'TE', points: 4.8, yards: 48, text: 'Pass Complete for 48 Yds' },
  { at: 365_000, side: 'mine', kind: 'two-point', position: 'WR', points: 2, text: 'Two Point Pass' },
  { at: 400_000, side: 'opponent', kind: 'turnover', position: 'DEF', points: 2, text: 'Fumble Recovery' },
  { at: 430_000, side: 'mine', kind: 'touchdown', position: 'DEF', points: 6, yards: 28, text: '28 Yd Interception Return (Kick)' },
  { at: 465_000, side: 'mine', kind: 'safety', position: 'DEF', points: 2, text: 'Safety' },
  // Quiet from here, so the board can be judged at rest too.
];

/** Red-zone windows, as [start, end) from the loop's origin. */
const DEMO_REDZONE_AT = [75_000, 265_000, 410_000];

/** Where in the current loop we are. */
export function demoElapsed(now: number, startedAt: number): number {
  const delta = now - startedAt;
  return ((delta % DEMO_PERIOD_MS) + DEMO_PERIOD_MS) % DEMO_PERIOD_MS;
}

/** Which loop we are on — the island uses it to reset its shown-moment set. */
export function demoLoopIndex(now: number, startedAt: number): number {
  return Math.floor(Math.max(0, now - startedAt) / DEMO_PERIOD_MS);
}

/**
 * Cast the play: a starter at that position, then any starter, then anyone on
 * the board.
 *
 * The widening fallback is load-bearing, not politeness. A demo run before
 * kickoff reads a week whose lineups are not in yet — the opponent's starter
 * list is genuinely EMPTY — and the first cut silently skipped every play it
 * could not cast, so the opponent's lower-third never fired once in a
 * ten-minute rehearsal. A rehearsal that drops the half of the script you most
 * need to see is worse than no rehearsal, and the miss looked like a layering
 * bug rather than a casting one.
 */
function pickPlayer(
  rows: readonly LivePlayerRow[],
  fallbackRows: readonly LivePlayerRow[],
  meta: Record<string, PlayerMeta>,
  position: string,
  seed: number,
): LivePlayerRow | undefined {
  const atPosition = (pool: readonly LivePlayerRow[]) =>
    pool.filter((r) => (meta[r.id]?.position ?? '').toUpperCase() === position.toUpperCase());

  for (const pool of [atPosition(rows), rows, atPosition(fallbackRows), fallbackRows]) {
    if (pool.length > 0) return pool[seed % pool.length];
  }
  return undefined;
}

export interface DemoPollInput {
  panels: readonly BroadcastLeaguePanel[];
  /** The board's real first-paint numbers — the demo climbs from these. */
  base: BroadcastPollResponse;
  playerMeta: Record<string, PlayerMeta>;
  now: number;
  startedAt: number;
}

/**
 * The board's state at this instant of the rehearsal.
 *
 * Deterministic in `elapsed`: the same moment of the loop always renders the
 * same way, which is what makes it usable for checking a fix rather than just
 * watching something move.
 */
export function demoPollAt(input: DemoPollInput): BroadcastPollResponse {
  const { panels, base, playerMeta, now, startedAt } = input;
  const elapsed = demoElapsed(now, startedAt);
  const loop = demoLoopIndex(now, startedAt);
  const loopOrigin = startedAt + loop * DEMO_PERIOD_MS;

  const fired = DEMO_SCRIPT.filter((e) => e.at <= elapsed);
  const moments: BroadcastMoment[] = [];
  const leagues: BroadcastLeagueScore[] = [];

  for (const [panelIndex, panel] of panels.entries()) {
    const baseLeague = base.leagues.find((l) => l.leagueId === panel.leagueId);
    const teams: Record<string, BroadcastTeamScore> = {};

    for (const [fid, team] of Object.entries(baseLeague?.teams ?? {})) {
      teams[fid] = { ...team, players: [...team.players] };
    }

    const matchup = panel.matchups[0];
    const mineId = panel.franchiseId;
    const oppId = matchup?.opponent?.franchiseId ?? '';

    // Everyone on this league's board, for casting a play on a franchise whose
    // own lineup is not in yet (every rehearsal run before kickoff).
    const anyRows: LivePlayerRow[] = Object.values(teams).flatMap((t) => t.players);

    // Every panel runs the same script, offset a little so two leagues do not
    // fire in lockstep — which would make the queue look like one event.
    const offset = panelIndex * 6_000;

    for (const [i, event] of fired.entries()) {
      if (event.at + offset > elapsed) continue;
      const fid = event.side === 'mine' ? mineId : oppId;
      if (!fid || !teams[fid]) continue;

      teams[fid] = {
        ...teams[fid],
        live: teams[fid].live + event.points,
        projectedFinal: teams[fid].projectedFinal + event.points,
      };

      const row = pickPlayer(teams[fid].players, anyRows, playerMeta, event.position, i + panelIndex);
      // Only when the whole board is empty — nothing to cast from at all.
      if (!row) continue;
      const who = playerMeta[row.id];
      const team = event.side === 'mine' ? matchup?.mine : matchup?.opponent;

      moments.push({
        key: `demo:${loop}:${panel.leagueId}:${i}`,
        playId: `demo-${loop}-${i}`,
        leagueId: panel.leagueId,
        leagueName: panel.leagueName,
        franchiseId: fid,
        franchiseName: team?.name ?? '',
        side: event.side,
        kind: event.kind,
        playerId: row.id,
        playerName: who?.name ?? `Player ${row.id}`,
        team: who?.nflTeam ?? '',
        text: `${who?.name ?? 'Player'} ${event.text}`,
        // A real clock shape, wound forward through the loop — the board
        // refuses to print a fabricated one, and this is the demo's own.
        clock: `Q${Math.min(4, 1 + Math.floor(event.at / 150_000))} ${String(14 - Math.floor((event.at % 150_000) / 12_000)).padStart(2, '0')}:${String(59 - Math.floor((event.at / 1000) % 60)).padStart(2, '0')}`,
        // Stamped NOW, so `isMomentFresh` lets it through exactly once and the
        // 90-second staleness rule is genuinely exercised rather than bypassed.
        wallclock: new Date(loopOrigin + event.at + offset).toISOString(),
        scoreValue: event.kind === 'touchdown' ? 6 : event.kind === 'field-goal' ? 3 : event.kind === 'two-point' || event.kind === 'safety' ? 2 : 0,
        yards: event.yards ?? 0,
      });
    }

    const mine = teams[mineId];
    const theirs = oppId ? teams[oppId] : undefined;
    leagues.push({
      leagueId: panel.leagueId,
      ok: true,
      live: true,
      teams,
      winProbability: panel.matchups.map(() => {
        if (!mine || !theirs) return 0.5;
        const margin = mine.projectedFinal - theirs.projectedFinal;
        // A soft curve, so the bar actually moves as the script runs.
        return Math.min(0.97, Math.max(0.03, 0.5 + margin / 60));
      }),
    });
  }

  // Red zone: on for a window, then off, so both the banner appearing and it
  // clearing are visible within one loop.
  const redZone: RedZoneAlert[] = [];
  const inDrive = DEMO_REDZONE_AT.some((t) => elapsed >= t && elapsed < t + DEMO_REDZONE_MS);
  if (inDrive) {
    const panel = panels[0];
    const mine = base.leagues.find((l) => l.leagueId === panel?.leagueId)?.teams[panel.franchiseId];
    const row = mine?.players[0];
    const who = row ? playerMeta[row.id] : undefined;
    if (panel && who) {
      redZone.push({
        team: who.nflTeam || 'KC',
        downDistance: '1st & Goal',
        players: [{
          leagueId: panel.leagueId,
          leagueName: panel.leagueName,
          side: 'mine',
          playerId: who.id,
          playerName: who.name,
          position: who.position,
        }],
      });
    }
  }

  // A slate that reads as live, so the board does not fall into its
  // screensaver halfway through the rehearsal.
  const games: NflGame[] = (base.games.length > 0 ? base.games : demoGames()).map((g, i) => ({
    ...g,
    state: 'in' as const,
    period: Math.min(4, 1 + Math.floor(elapsed / 150_000)),
    clock: '07:31',
    shortDetail: `07:31 - ${['1st', '2nd', '3rd', '4th'][Math.min(3, Math.floor(elapsed / 150_000))]}`,
    situation: inDrive && i === 0
      ? { isRedZone: true, possession: g.home.code, downDistanceText: '1st & Goal at 6', shortDownDistanceText: '1st & Goal', lastPlay: '' }
      : null,
  }));

  return {
    ok: true,
    week: base.week,
    fetchedAt: new Date(now).toISOString(),
    leagues,
    moments,
    redZone,
    games,
  };
}

/** A minimal slate for a demo run that had no real games to borrow. */
function demoGames(): NflGame[] {
  return [
    { id: 'demo-1', state: 'in', shortDetail: '07:31 - 2nd', period: 2, clock: '07:31', home: { code: 'KC', score: 17 }, away: { code: 'LV', score: 10 }, possession: 'KC', date: '' },
    { id: 'demo-2', state: 'in', shortDetail: '02:14 - 3rd', period: 3, clock: '02:14', home: { code: 'SF', score: 21 }, away: { code: 'SEA', score: 14 }, possession: 'SEA', date: '' },
  ];
}
