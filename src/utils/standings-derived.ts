/**
 * Fill the standings columns a league's MFL export leaves out.
 *
 * Archie's `leagueStandings` export carries only the overall record, victory
 * points and points for — no all-play, PA, streak or division record — yet the
 * shared standings page shows all of them. They are derivable from the weekly
 * scores and the schedule, and the Pecking Order already derives the first
 * three that way (`enrichStandingsFromResults`), so this reuses it and adds
 * the division record from the schedule's own per-game results.
 *
 * Only BLANK fields are filled: a league whose export has them (TheLeague, the
 * AFL) keeps MFL's values untouched. Row ORDER is never changed — MFL's order
 * is the official one (docs/claude/rules/standings-brackets-draft-order.md).
 */
import type { StandingsFranchise } from '../types/standings';
import {
  buildPairings,
  enrichStandingsFromResults,
} from '../../scripts/lib/pecking-order-math.mjs';
import { addResult, emptyRecord, weekGames } from './game-results.mjs';

interface WeeklyResultsFeed {
  weeks?: Array<{ week?: number | string; scores?: Record<string, number | string> }>;
}

interface ScheduleFeed {
  schedule?: {
    weeklySchedule?: Array<{
      week?: string;
      matchup?: unknown;
    }>;
  };
}

const asArray = <T>(x: T | T[] | null | undefined): T[] =>
  Array.isArray(x) ? x : x == null ? [] : [x];

const blank = (v: unknown) => v == null || v === '';

/** The last week any team has a real score in — the derivation's horizon. */
export function lastScoredWeek(weeklyResults: WeeklyResultsFeed | null | undefined): number {
  let last = 0;
  for (const w of asArray(weeklyResults?.weeks)) {
    const week = Number(w?.week);
    const scored = Object.values(w?.scores ?? {}).some((v) => Number(v) > 0);
    if (scored && week > last) last = week;
  }
  return last;
}

/**
 * Division record per franchise from the schedule's decided games: only games
 * whose two teams share a division, only through `throughWeek`. Doubleheader
 * weeks simply contribute two games.
 */
export function divisionRecords(
  schedule: ScheduleFeed | null | undefined,
  divisionOf: (franchiseId: string) => string | undefined,
  throughWeek: number
): Map<string, { w: number; l: number; t: number }> {
  const records = new Map<string, { w: number; l: number; t: number }>();
  // Which pairings are games, and their results, is game-results.mjs's call:
  // MFL stamps an unplayed week "T", so the result field alone is not a game.
  for (const wk of asArray(schedule?.schedule?.weeklySchedule)) {
    if (Number(wk?.week) > throughWeek) continue;
    for (const g of weekGames(wk)) {
      const div = divisionOf(g.a);
      if (!div || div !== divisionOf(g.b)) continue;
      for (const [id, result] of [
        [g.a, g.ra],
        [g.b, g.rb],
      ] as const) {
        const rec = emptyRecord();
        addResult(rec, result);
        const prev = records.get(id) ?? { w: 0, l: 0, t: 0 };
        records.set(id, { w: prev.w + rec.wins, l: prev.l + rec.losses, t: prev.t + rec.ties });
      }
    }
  }
  return records;
}

/**
 * The standings rows with every blank derivable column filled. Returns new
 * rows in the SAME order; a league with nothing missing gets equal rows back.
 */
export function fillDerivedStandings(
  franchises: StandingsFranchise[],
  sources: {
    weeklyResults: WeeklyResultsFeed | null | undefined;
    schedule: ScheduleFeed | null | undefined;
    divisionOf: (franchiseId: string) => string | undefined;
  }
): StandingsFranchise[] {
  const throughWeek = lastScoredWeek(sources.weeklyResults);
  if (throughWeek === 0) return franchises;

  const pairings = buildPairings(sources.schedule, null);
  const enriched = enrichStandingsFromResults(
    new Map(franchises.map((f) => [f.id, f])),
    sources.weeklyResults ?? {},
    pairings,
    throughWeek
  ) as Map<string, StandingsFranchise & Record<string, unknown>>;
  const divRecords = divisionRecords(sources.schedule, sources.divisionOf, throughWeek);

  return franchises.map((row) => {
    const next = { ...(enriched.get(row.id) ?? row) } as StandingsFranchise & Record<string, unknown>;
    const raw = row as unknown as Record<string, unknown>;
    if (blank(raw.h2hpct) && typeof row.h2hwlt === 'string') {
      const [w, l, t] = row.h2hwlt.split('-').map((n) => Number(n) || 0);
      const games = w + l + t;
      if (games) next.h2hpct = ((w + t / 2) / games).toFixed(3);
    }
    const div = divRecords.get(row.id);
    if (div && blank(raw.divwlt)) {
      const games = div.w + div.l + div.t;
      next.divwlt = `${div.w}-${div.l}-${div.t}`;
      next.divpct = games ? ((div.w + div.t / 2) / games).toFixed(3) : '';
    }
    return next;
  });
}
