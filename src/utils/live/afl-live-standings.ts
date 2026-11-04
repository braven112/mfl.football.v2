/**
 * The AFL's own part of the live Standings tab: the Premier League and
 * D-League, ranked live on all-play.
 *
 * The AFL's OWN competition (docs/claude/rules/standings-brackets-draft-order.md
 * rule 1c) — no other league has tiers — so its rules live here and reach the
 * shared board only as data: which franchises a table holds, in what official
 * order, and which positions carry a marker. Every league's tab is assembled
 * in `./league-live-standings.ts`, which calls in here for the AFL.
 *
 *  - The tiers' all-play base: MFL's own `all_play_wlt` column, which is
 *    current to the last week MFL has processed. The committed
 *    `weekly-results.json` lags the sync (on 2026-11-03 it stopped at week 7
 *    while MFL had week 8), so it only FILLS weeks MFL's column no longer
 *    carries — the tier competition runs to week 17, past the week-14 end of
 *    MFL's regular season.
 *  - Membership: `tier-history.json`, the Standings page's source. Ranked on
 *    all-play, then points, then Power Rank — the Standings page's order.
 *
 * SERVER-SIDE ONLY.
 */

import type { LiveAllPlayBase, LiveAllPlayRecord, LiveStandingsSection } from '../../types/live';
import { allPlayWeek } from '../game-results.mjs';
import { resolveTierCutoffWeek } from '../all-play.mjs';
import { getTierLogo, getTierLogoDark, getTierMembership, D_LEAGUE, PREMIER_LEAGUE } from '../afl-tier';
import { tierZoneFor } from '../tier-board';

/** The one league whose tab carries tiers. */
export const AFL_TIERS_SLUG = 'afl-fantasy';

export { getTierMembership, resolveTierCutoffWeek };

function num(value: unknown): number {
  const parsed = Number.parseFloat(`${value ?? ''}`.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

const pad = (id: unknown) => `${id ?? ''}`.trim().padStart(4, '0');


/**
 * Each franchise's all-play record from MFL's own column, plus the number of
 * weeks it holds. A franchise all-plays `teams - 1` others a week, so the week
 * count is the record's total over that — the same arithmetic as reading
 * 148-13-0 for a 24-team league as seven weeks.
 */
function mflAllPlay(feedRows: readonly Record<string, unknown>[]): {
  records: Record<string, LiveAllPlayRecord>;
  weeks: number;
} | null {
  const opponents = feedRows.length - 1;
  if (opponents <= 0) return null;
  const records: Record<string, LiveAllPlayRecord> = {};
  let weeks = 0;
  for (const row of feedRows) {
    const raw = `${row.all_play_wlt ?? ''}`.trim();
    if (!raw) return null;
    const [w = '0', l = '0', t = '0'] = raw.split('-');
    const record = { wins: num(w), losses: num(l), ties: num(t), pointsFor: num(row.pf) };
    records[pad(row.id)] = record;
    weeks = Math.max(weeks, Math.round((record.wins + record.losses + record.ties) / opponents));
  }
  return { records, weeks };
}

interface WeeklyResults {
  weeks?: Array<{ week?: number | string; scores?: Record<string, number | string> }>;
}

/**
 * The tiers' starting record: MFL's all-play, with any week it does not carry
 * (yet) filled from the committed weekly results, up to the week before the
 * board's and never past the competition's last week.
 */
export function buildAllPlayBase(input: {
  feedRows: readonly Record<string, unknown>[];
  weeklyResults: WeeklyResults | null;
  boardWeek: number;
  cutoffWeek: number;
}): LiveAllPlayBase | null {
  const { feedRows, weeklyResults, boardWeek, cutoffWeek } = input;
  const mfl = mflAllPlay(feedRows);
  if (!mfl) return null;
  const records: Record<string, LiveAllPlayRecord> = Object.fromEntries(
    Object.entries(mfl.records).map(([id, r]) => [id, { ...r }]),
  );
  const lastFill = Math.min(boardWeek - 1, cutoffWeek);
  for (const week of weeklyResults?.weeks ?? []) {
    const n = Number(week?.week);
    if (!Number.isFinite(n) || n <= mfl.weeks || n > lastFill) continue;
    const scores = week.scores ?? {};
    for (const [id, add] of allPlayWeek(scores) as Map<string, { wins: number; losses: number; ties: number }>) {
      const record = records[pad(id)];
      if (!record) continue;
      record.wins += add.wins;
      record.losses += add.losses;
      record.ties += add.ties;
    }
  }
  return {
    records,
    weekCounted: mfl.weeks >= boardWeek,
    weekInCompetition: boardWeek <= cutoffWeek,
  };
}

function pct(r: LiveAllPlayRecord): number {
  const games = r.wins + r.losses + r.ties;
  return games === 0 ? 0 : (r.wins + r.ties / 2) / games;
}

/**
 * The Premier League and D-League tables, each in its official all-play order
 * with the constitution's zones on its positions.
 */
export function buildTierSections(input: {
  feedRows: readonly Record<string, unknown>[];
  teamTier: (franchiseId: string) => string | undefined;
  allPlay: LiveAllPlayBase | null;
  leagueSlug: string;
}): LiveStandingsSection[] {
  const { feedRows, teamTier, allPlay, leagueSlug } = input;
  const order = feedRows.map((r) => pad(r.id)).filter((id) => id !== '0000');
  const position = new Map(order.map((id, i) => [id, i]));
  const pwr = new Map(feedRows.map((r) => [pad(r.id), num(r.pwr)]));
  return [PREMIER_LEAGUE, D_LEAGUE].flatMap((tier) => {
    const ids = order.filter((id) => teamTier(id) === tier);
    if (ids.length === 0) return [];
    const record = (id: string) => allPlay?.records[id];
    const sorted = ids.slice().sort((a, b) => {
      const ra = record(a);
      const rb = record(b);
      if (ra && rb) {
        const byPct = pct(rb) - pct(ra);
        if (byPct !== 0) return byPct;
        if (rb.pointsFor !== ra.pointsFor) return rb.pointsFor - ra.pointsFor;
      }
      return (pwr.get(b) ?? 0) - (pwr.get(a) ?? 0) || position.get(a)! - position.get(b)!;
    });
    const zones = sorted.map((_, i) => {
      const z = tierZoneFor(i + 1, sorted.length, { tier, leagueSlug });
      return z && z.zone !== 'money' ? { tone: z.zone as 'up' | 'down' | 'danger' | 'rename', label: z.label } : null;
    });
    return [
      {
        id: `tier-${tier}`,
        title: tier,
        basis: 'all-play' as const,
        franchiseIds: sorted,
        zones,
        logo: { src: getTierLogo(tier), darkSrc: getTierLogoDark(tier) },
      },
    ];
  });
}
