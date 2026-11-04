/**
 * Every league's live Standings tab: which tables it shows, read live.
 *
 *  - **Divisions** wherever the league config declares them (TheLeague, the
 *    AFL), head-to-head, the viewer's own division first. Filtered out of
 *    MFL's league order and never re-sorted, as on the Standings page.
 *  - **The AFL's Premier League and D-League** first, on all-play. The AFL's
 *    own competition (`./afl-live-standings.ts`); no other league gets them.
 *  - **Archie's MAD POWER 99**: the whole league in playoff seed order on
 *    Victory Points (`standingsSeeding.kind === 'mad'` in the registry), then
 *    only the viewer's OWN division (nine tables of eleven is too many).
 *    Archie's own competition, so it is not offered to any other league
 *    "in case" (standings rules doc, rule 1c).
 *  - **No divisions** (a best-ball league): one league table, the board's
 *    original single-table tab.
 *
 * ── WHERE EACH NUMBER COMES FROM ──────────────────────────────────────────
 * Records, points, Victory Points and order: MFL's `leagueStandings`, read
 * LIVE through the standings pages' own refresh (`getStandingsFeedWithLiveRefresh`:
 * public, 60 s cache, committed snapshot on any failure). No owner cookie — a
 * signed-out visitor gets the tab too. The Victory Point RULES are the
 * league's own MFL settings (`league.json` `victoryPoints*`).
 *
 * SERVER-SIDE ONLY.
 */

import type {
  LiveMatchup,
  LiveStandingsRow,
  LiveStandingsSection,
  LiveStandingsSectionGroup,
  LiveStandingsSections,
  LiveVictoryPointRules,
} from '../../types/live';
import { getLeagueBySlug } from '../../config/leagues';
import { getLeagueConfig } from '../league-config';
import { leagueFeedPath, loadLeagueData } from '../league-data';
import { getStandingsFeedWithLiveRefresh, type StandingsFeed } from '../live-standings';
import { parsePriorGameCounts } from '../mfl-schedule-pairings';
import {
  AFL_TIERS_SLUG,
  buildAllPlayBase,
  buildTierSections,
  getTierMembership,
  resolveTierCutoffWeek,
} from './afl-live-standings';
import { decorateStandings, markWeekCounted, parseStandingsFeedRows } from './standings';

export interface LeagueLiveStandings {
  standings: LiveStandingsRow[] | null;
  standingsSections?: LiveStandingsSections;
}

interface ConfigTeam {
  franchiseId: string;
  division?: string;
  tier?: string;
}

interface LeagueConfigShape {
  teams?: ConfigTeam[];
  /** Strings (TheLeague) or `{ id, name }` (Archie's); a team's `division` is the name. */
  divisions?: Array<string | { id?: string; name?: string }>;
  /** The AFL: each conference lists its divisions by name. */
  conferences?: Array<{ name: string; code?: string; divisions: string[] }>;
  tierCompetition?: { cutoffWeek?: number; cutoffWeekByYear?: Record<string, number> };
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v ? [v as T] : []);
const pad = (id: unknown) => `${id ?? ''}`.trim().padStart(4, '0');

/** "American League" → "AL". */
export function conferenceShort(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** Every declared division, in the config's order, with the title it wears. */
function declaredDivisions(config: LeagueConfigShape): { name: string; title: string }[] {
  if (config.conferences?.length) {
    return config.conferences.flatMap((c) =>
      c.divisions.map((d) => ({ name: d, title: `${conferenceShort(c.name)} ${d}` })),
    );
  }
  return (config.divisions ?? [])
    .map((d) => (typeof d === 'string' ? d : d?.name ?? ''))
    .filter(Boolean)
    .map((name) => ({ name, title: name }));
}

/** Head-to-head division tables in MFL's order, the viewer's own first. */
export function buildDivisionSections(input: {
  order: readonly string[];
  config: LeagueConfigShape;
  viewerFranchiseId: string | null;
}): LiveStandingsSection[] {
  const { order, config, viewerFranchiseId } = input;
  const teams = new Map((config.teams ?? []).map((t) => [t.franchiseId, t]));
  const sections: LiveStandingsSection[] = [];
  for (const { name, title } of declaredDivisions(config)) {
    const ids = order.filter((id) => teams.get(id)?.division === name);
    if (ids.length === 0) continue;
    sections.push({ id: `division-${name}`, title, basis: 'record', franchiseIds: ids });
  }
  const viewerDivision = viewerFranchiseId ? teams.get(viewerFranchiseId)?.division : undefined;
  const mine = sections.findIndex((s) => s.id === `division-${viewerDivision}`);
  if (mine > 0) sections.unshift(...sections.splice(mine, 1));
  return sections;
}

/** Only the viewer's own division table — none when signed out. */
export function buildOwnDivisionSection(input: {
  order: readonly string[];
  config: LeagueConfigShape;
  viewerFranchiseId: string | null;
}): LiveStandingsSection[] {
  const { viewerFranchiseId } = input;
  if (!viewerFranchiseId) return [];
  return buildDivisionSections(input).filter((s) => s.franchiseIds.includes(viewerFranchiseId));
}

/** Archie's whole league in MAD POWER 99 seed order. */
export function buildMadSection(input: {
  order: readonly string[];
  config: LeagueConfigShape;
  seeding: { divisionLeaders: number; runnersUp: number; wildCards: number };
}): LiveStandingsSection {
  const { order, config, seeding } = input;
  const divisionOf: Record<string, string> = {};
  for (const t of config.teams ?? []) if (t.division) divisionOf[t.franchiseId] = t.division;
  // The playoff seeds, plus the first few chasing them.
  const shown = seeding.divisionLeaders + seeding.runnersUp + seeding.wildCards + 3;
  return {
    id: 'mad-power-99',
    title: 'Playoff seeding',
    basis: 'mad',
    franchiseIds: [...order],
    seeding,
    divisionOf,
    collapseAfter: shown < order.length ? shown : undefined,
  };
}

/** MFL's `victoryPoints*` league settings, or undefined where none are kept. */
export function parseVictoryPointRules(leagueFeed: unknown): LiveVictoryPointRules | undefined {
  const league = ((leagueFeed as { league?: unknown })?.league ?? leagueFeed) as Record<string, unknown> | null;
  if (!league || league.victoryPointsWin === undefined) return undefined;
  const n = (v: unknown) => {
    const parsed = Number.parseFloat(`${v ?? ''}`);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    win: n(league.victoryPointsWin),
    loss: n(league.victoryPointsLoss),
    tie: n(league.victoryPointsTie),
    buckets: `${league.victoryPointsBuckets ?? ''}`
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(n),
  };
}

const games = (row: Record<string, unknown>) =>
  ['h2hw', 'h2hl', 'h2ht'].reduce((sum, k) => sum + (Number(row[k]) || 0), 0);

/**
 * Points For on every row, even where MFL's PUBLIC export leaves it out.
 *
 * A league can hide `pf` from the anonymous export (Archie's does: it ships
 * only `avgpf`, to one decimal), and the live read is anonymous. The
 * committed snapshot was fetched with credentials and carries it, so:
 *  - a row whose record matches the snapshot's takes the snapshot's `pf`;
 *  - otherwise `avgpf` times the weeks played, where a week is however many
 *    games the snapshot shows a week holding (Archie's plays two).
 * Rows that already carry `pf` are untouched.
 */
export function fillPointsFor(
  liveRows: Record<string, unknown>[],
  committedRows: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  if (liveRows.every((r) => r.pf !== undefined && r.pf !== '')) return liveRows;
  const committed = new Map(committedRows.map((r) => [pad(r.id), r]));
  let gamesPerWeek = 1;
  for (const r of committedRows) {
    const avg = Number(r.avgpf);
    const pf = Number(r.pf);
    if (avg > 0 && pf > 0 && games(r) > 0) {
      gamesPerWeek = Math.max(1, Math.round(games(r) / Math.round(pf / avg)));
      break;
    }
  }
  return liveRows.map((row) => {
    if (row.pf !== undefined && row.pf !== '') return row;
    const snap = committed.get(pad(row.id));
    if (snap && snap.pf !== undefined && games(snap) === games(row)) return { ...row, pf: snap.pf };
    const avg = Number(row.avgpf);
    if (!Number.isFinite(avg)) return row;
    return { ...row, pf: (avg * (games(row) / gamesPerWeek)).toFixed(2) };
  });
}

/**
 * Read everything a league's Standings tab needs. Never throws: a failed
 * standings read is `standings: null`, which the tab renders as "couldn't
 * read the standings" rather than as an empty table. `undefined` only for a
 * slug the registry does not know.
 */
export async function readLiveStandings(input: {
  slug: string;
  year: number;
  week: number;
  viewerFranchiseId: string | null;
}): Promise<LeagueLiveStandings | undefined> {
  const { slug, year, week, viewerFranchiseId } = input;
  const league = getLeagueBySlug(slug);
  if (!league) return undefined;
  const seeding = (league as { standingsSeeding?: { kind?: string; divisionLeaders: number; runnersUp: number; wildCards: number } })
    .standingsSeeding;
  const isMad = seeding?.kind === 'mad';
  const hasTiers = slug === AFL_TIERS_SLUG;
  try {
    const path = (file: string) => leagueFeedPath(league.dataPath, year, file);
    const [committed, schedule, weeklyResults, leagueFeed] = await Promise.all([
      loadLeagueData(path('standings.json')).catch(() => null),
      loadLeagueData(path('schedule.json')).catch(() => null),
      hasTiers ? loadLeagueData(path('weekly-results.json')).catch(() => null) : null,
      isMad ? loadLeagueData(path('league.json')).catch(() => null) : null,
    ]);
    const { feed } = await getStandingsFeedWithLiveRefresh({
      league,
      year,
      committedFeed: (committed ?? undefined) as StandingsFeed | undefined,
    });
    const committedRows = asArray<Record<string, unknown>>(
      (committed as StandingsFeed | null)?.leagueStandings?.franchise,
    );
    const feedRows = fillPointsFor(
      asArray<Record<string, unknown>>(feed?.leagueStandings?.franchise),
      committedRows,
    );
    if (feedRows.length === 0) return { standings: null };

    const standings = markWeekCounted(
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

    const config = getLeagueConfig(slug) as LeagueConfigShape;
    const order = feedRows.map((r) => pad(r.id)).filter((id) => id !== '0000');
    const groups: LiveStandingsSectionGroup[] = [];
    let allPlay: LiveStandingsSections['allPlay'] = null;
    let victoryPoints: LiveVictoryPointRules | undefined;

    if (hasTiers) {
      const cutoffWeek = resolveTierCutoffWeek(config.tierCompetition, year) ?? 17;
      allPlay = buildAllPlayBase({
        feedRows,
        weeklyResults: (weeklyResults ?? null) as Parameters<typeof buildAllPlayBase>[0]['weeklyResults'],
        boardWeek: week,
        cutoffWeek,
      });
      const membership = getTierMembership(year);
      const teams = new Map((config.teams ?? []).map((t) => [t.franchiseId, t]));
      const tiers = buildTierSections({
        feedRows,
        teamTier: (id) => membership?.[id] ?? teams.get(id)?.tier,
        allPlay,
        leagueSlug: slug,
      });
      if (tiers.length) groups.push({ id: 'tiers', title: 'Premier League & D-League', sections: tiers });
    }

    if (isMad && seeding) {
      victoryPoints = parseVictoryPointRules(leagueFeed);
      groups.push({
        id: 'mad',
        title: 'MAD POWER 99',
        sections: [buildMadSection({ order, config, seeding })],
      });
      // Nine divisions of eleven is too much to scroll past, so only the
      // viewer's own (Brandon, 2026-11-04). Signed out, there is none to show.
      const own = buildOwnDivisionSection({ order, config, viewerFranchiseId });
      if (own.length) groups.push({ id: 'divisions', title: 'Your division', sections: own });
    } else {
      const divisions = buildDivisionSections({ order, config, viewerFranchiseId });
      if (divisions.length) groups.push({ id: 'divisions', title: 'Divisions', sections: divisions });
    }

    // No tables of its own (no divisions declared): the single league table.
    if (groups.length === 0) return { standings };
    return {
      standings,
      standingsSections: { groups, allPlay, ...(victoryPoints ? { victoryPoints } : {}) },
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
