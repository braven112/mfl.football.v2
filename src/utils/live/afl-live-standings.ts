/**
 * The AFL live board's Standings tab: the Premier League and D-League, live,
 * then every division, live.
 *
 * The AFL's OWN competition (docs/claude/rules/standings-brackets-draft-order.md
 * rule 1c) — no other league has tiers — so its rules live here and reach the
 * shared board only as data: which franchises a table holds, in what official
 * order, and which positions carry a marker. The board draws any sectioned tab
 * the same way (`LvStandingsSections`).
 *
 * ── WHERE EACH NUMBER COMES FROM ──────────────────────────────────────────
 *  - Records, points and order: MFL's `leagueStandings`, read LIVE through the
 *    standings pages' own refresh (`getStandingsFeedWithLiveRefresh`: public,
 *    60 s cache, committed snapshot on any failure). No owner cookie — a
 *    signed-out visitor gets the tab too.
 *  - The tiers' all-play base: MFL's own `all_play_wlt` column, which is
 *    current to the last week MFL has processed. The committed
 *    `weekly-results.json` lags the sync (on 2026-11-03 it stopped at week 7
 *    while MFL had week 8), so it only FILLS weeks MFL's column no longer
 *    carries — the tier competition runs to week 17, past the week-14 end of
 *    MFL's regular season.
 *  - Divisions and tiers: the league config and `tier-history.json`, the
 *    same sources the Standings page groups with.
 *
 * Divisions are filtered out of MFL's league order and never re-sorted, as on
 * the Standings page. The tiers are ranked on all-play (then points, then
 * Power Rank), the order the Standings page's tier tables use.
 *
 * SERVER-SIDE ONLY.
 */

import type {
  LiveAllPlayBase,
  LiveAllPlayRecord,
  LiveMatchup,
  LiveStandingsRow,
  LiveStandingsSection,
  LiveStandingsSectionGroup,
  LiveStandingsSections,
} from '../../types/live';
import { getLeagueBySlug } from '../../config/leagues';
import { getLeagueConfig } from '../league-config';
import { leagueFeedPath, loadLeagueData } from '../league-data';
import { getStandingsFeedWithLiveRefresh, type StandingsFeed } from '../live-standings';
import { parsePriorGameCounts } from '../mfl-schedule-pairings';
import { allPlayWeek } from '../game-results.mjs';
import { resolveTierCutoffWeek } from '../all-play.mjs';
import { getTierLogo, getTierLogoDark, getTierMembership, D_LEAGUE, PREMIER_LEAGUE } from '../afl-tier';
import { tierZoneFor } from '../tier-board';
import { decorateStandings, markWeekCounted, parseStandingsFeedRows } from './standings';

/** The one league this tab is for. */
export const AFL_LIVE_STANDINGS_SLUG = 'afl-fantasy';

export interface AflLiveStandings {
  standings: LiveStandingsRow[] | null;
  standingsSections?: LiveStandingsSections;
}

interface ConfigTeam {
  franchiseId: string;
  division?: string;
  conference?: string;
  tier?: string;
}

interface AflConfig {
  teams?: ConfigTeam[];
  conferences?: Array<{ name: string; code: string; divisions: string[] }>;
  tierCompetition?: { cutoffWeek?: number; cutoffWeekByYear?: Record<string, number> };
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v ? [v as T] : []);

function num(value: unknown): number {
  const parsed = Number.parseFloat(`${value ?? ''}`.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

const pad = (id: unknown) => `${id ?? ''}`.trim().padStart(4, '0');

/** "American League" → "AL". */
function conferenceShort(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

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
 * The Standings tab's tables for the AFL: tiers first, then divisions with
 * the viewer's own first.
 */
export function buildAflStandingsSections(input: {
  feedRows: readonly Record<string, unknown>[];
  config: AflConfig;
  tierMembership: Record<string, string> | null;
  allPlay: LiveAllPlayBase | null;
  viewerFranchiseId: string | null;
  leagueSlug: string;
}): LiveStandingsSections {
  const { feedRows, config, tierMembership, allPlay, viewerFranchiseId, leagueSlug } = input;
  const order = feedRows.map((r) => pad(r.id)).filter((id) => id !== '0000');
  const position = new Map(order.map((id, i) => [id, i]));
  const pwr = new Map(feedRows.map((r) => [pad(r.id), num(r.pwr)]));
  const teams = new Map((config.teams ?? []).map((t) => [t.franchiseId, t]));

  // ── Tiers ──
  const tierOf = (id: string) => tierMembership?.[id] ?? teams.get(id)?.tier;
  const tierSections: LiveStandingsSection[] = [PREMIER_LEAGUE, D_LEAGUE].flatMap((tier) => {
    const ids = order.filter((id) => tierOf(id) === tier);
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

  // ── Divisions ──
  const viewerDivision = viewerFranchiseId ? teams.get(viewerFranchiseId)?.division : undefined;
  const divisionSections: LiveStandingsSection[] = [];
  for (const conference of config.conferences ?? []) {
    for (const division of conference.divisions) {
      const ids = order.filter((id) => teams.get(id)?.division === division);
      if (ids.length === 0) continue;
      divisionSections.push({
        id: `division-${division}`,
        title: `${conferenceShort(conference.name)} ${division}`,
        basis: 'record',
        franchiseIds: ids,
      });
    }
  }
  const mine = divisionSections.findIndex((s) => s.id === `division-${viewerDivision}`);
  if (mine > 0) divisionSections.unshift(...divisionSections.splice(mine, 1));

  const groups: LiveStandingsSectionGroup[] = [];
  if (tierSections.length) {
    groups.push({ id: 'tiers', title: 'Premier League & D-League', sections: tierSections });
  }
  if (divisionSections.length) {
    groups.push({ id: 'divisions', title: 'Divisions', sections: divisionSections });
  }
  return { groups, allPlay };
}

/**
 * Read everything the AFL's Standings tab needs. `undefined` for any other
 * league, whose board keeps no Standings tab. Never throws: a failed
 * standings read is `standings: null`, which the tab renders as "couldn't
 * read the standings" rather than as an empty table.
 */
export async function readAflLiveStandings(input: {
  slug: string;
  year: number;
  week: number;
  viewerFranchiseId: string | null;
}): Promise<AflLiveStandings | undefined> {
  const { slug, year, week, viewerFranchiseId } = input;
  if (slug !== AFL_LIVE_STANDINGS_SLUG) return undefined;
  const league = getLeagueBySlug(slug);
  if (!league) return undefined;

  try {
    const path = (file: string) => leagueFeedPath(league.dataPath, year, file);
    const [committed, schedule, weeklyResults] = await Promise.all([
      loadLeagueData(path('standings.json')).catch(() => null),
      loadLeagueData(path('schedule.json')).catch(() => null),
      loadLeagueData(path('weekly-results.json')).catch(() => null),
    ]);
    const { feed } = await getStandingsFeedWithLiveRefresh({
      league,
      year,
      committedFeed: (committed ?? undefined) as StandingsFeed | undefined,
    });
    const feedRows = asArray<Record<string, unknown>>(feed?.leagueStandings?.franchise);
    if (feedRows.length === 0) return { standings: null };

    const rows = markWeekCounted(
      decorateStandings(parseStandingsFeedRows(feedRows), {
        league: {
          id: league.id,
          name: league.name,
          franchiseId: '',
          franchiseName: '',
          registered: league,
          host: null,
          isSession: false,
        },
        year,
        mflUserCookie: '',
        viewerFranchiseId,
      }),
      schedule ? parsePriorGameCounts(schedule, week) : null,
    );

    const standings = rows;

    const config = getLeagueConfig(slug) as AflConfig;
    const cutoffWeek = resolveTierCutoffWeek(config.tierCompetition, year) ?? 17;
    const allPlay = buildAllPlayBase({
      feedRows,
      weeklyResults: (weeklyResults ?? null) as WeeklyResults | null,
      boardWeek: week,
      cutoffWeek,
    });

    return {
      standings,
      standingsSections: buildAflStandingsSections({
        feedRows,
        config,
        tierMembership: getTierMembership(year),
        allPlay,
        viewerFranchiseId,
        leagueSlug: slug,
      }),
    };
  } catch {
    return { standings: null };
  }
}

/**
 * The board's own identities on the standings rows, so the Standings tab wears
 * the same (possibly Throwback) crest and name as the Scores tab beside it.
 * Applied once both reads have landed — they run side by side.
 */
export function withBoardIdentities(
  rows: LiveStandingsRow[] | null,
  matchups: readonly LiveMatchup[],
): LiveStandingsRow[] | null {
  if (rows === null) return null;
  const sides = new Map(matchups.flatMap((m) => m.sides).map((s) => [s.franchiseId, s]));
  return rows.map((row) => {
    const side = sides.get(row.franchiseId);
    return side
      ? {
          ...row,
          name: side.name,
          nameShort: side.nameShort,
          initials: side.initials,
          icon: side.icon,
          iconAlt: side.iconAlt,
          rung: side.rung,
        }
      : row;
  });
}
