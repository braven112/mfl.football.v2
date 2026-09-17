/**
 * Roster analytics for the Front Office hub, BOTH leagues — position
 * composition, age-by-position, age stats/distribution, NFL-team/college
 * groupings, and (for a league that runs a cap) cap allocation, roster
 * composition, position spend and cap efficiency.
 *
 * Started life as `afl-roster-analytics.ts`, serving only the AFL's Keeper
 * Planner panel. Renamed and widened here because TheLeague's hub had no
 * analytics at all and the alternative was a third inline copy of the same
 * bucket math (both `rosters.astro` files already carry one each — those
 * stay untouched until their Analytics tabs retire; see
 * docs/plans/front-office-hub.md).
 *
 * TWO RULES THIS MODULE KEEPS:
 *
 * 1. **Pure.** No feed reads, no fs, no clock beyond `calculateAgeFromBirthdate`'s
 *    "today". Callers pass already-loaded rows, which is what lets one
 *    module serve a per-team loop over 16 teams without 16 lots of I/O.
 * 2. **It declares no cap formula of its own.** Every rate, percentage and
 *    threshold in the cap section comes from `salary-calculations.ts` —
 *    `calculateBucketCaps`, `calculatePositionCaps`, `calculateCapEfficiency`.
 *    This module only shapes their output into chart slices. A cap number
 *    that is wrong should be wrong in exactly one place, the same place the
 *    Trade Builder and rosters.astro read it from.
 */
import { normalizeTeamCode } from './nfl-logo';
import {
  calculateBucketCaps,
  calculatePositionCaps,
  calculateCapEfficiency,
  type CapPlayer,
} from './salary-calculations';

export interface AnalyticsBucket {
  label: string;
  count: number;
  pct: number;
}

export type PositionLane = 'QB' | 'RB' | 'WR' | 'TE' | 'PK' | 'DEF';
export const POSITION_LANES: readonly PositionLane[] = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];

export interface AgePositionDot {
  position: PositionLane;
  age: number;
  name: string;
  stackIndex: number;
}

export interface DonutSegment extends AnalyticsBucket {
  color: string;
  dashArray: string;
  dashOffset: number;
}

/** Analytics input row — the fields rosters.astro's own RosterEntry carries
 *  that this module needs. Kept minimal and structural (not importing
 *  KeeperPlannerPlayer) so this stays independent of any one caller's type. */
export interface RosterAnalyticsInput {
  name: string;
  position: string;
  team: string;
  college?: string | null;
  birthdate?: string | number | null;
}

export interface RosterGroup<T> {
  key: string;
  players: T[];
}

/**
 * The row the NFL/College stack cards and the player-details modal need.
 *
 * Lived in `front-office-keeper-data.ts` as `FrontOfficeAnalyticsPlayer`
 * while only the AFL had stacks; it moved here so TheLeague's builder does
 * not have to import a type out of the AFL's data module to describe the
 * same thing. Deliberately separate from either league's roster row
 * (`KeeperPlannerPlayer`, `FrontOfficeTagPlayer`) rather than widening one
 * of those with fields their own boards never read.
 */
export interface AnalyticsPlayer {
  id: string;
  name: string;
  position: string;
  /** NFL team code, any format — `groupByNflTeam` normalizes it. */
  team: string;
  espnId?: string;
  status: string;
  college: string | null;
  /** Unix seconds, as MFL ships it. String or number both parse. */
  birthdate: string | number | null;
  height: string | null;
  weight: string | null;
  jersey: string | null;
  draftYear: number | null;
  draftRound: number | null;
  draftPick: number | null;
  draftTeam: string | null;
  /** Headshot URL. Absent for the AFL, which lets PlayerCell derive one. */
  headshot?: string;
}

export interface RosterAnalytics {
  rosterSize: number;
  positionDistribution: AnalyticsBucket[];
  donutSegments: DonutSegment[];
  ageBuckets: AnalyticsBucket[];
  ageStats: {
    avg: number | null;
    oldest: { name: string; age: number } | null;
    youngest: { name: string; age: number } | null;
  };
  ageByPositionDots: AgePositionDot[];
  ageStripRange: { min: number; max: number; ticks: number[] };
}

/** Color palette for the position donut chart (consistent everywhere it renders). */
export const POSITION_COLORS: Record<string, string> = {
  QB: '#c41e3a',
  RB: '#2563eb',
  WR: '#16a34a',
  TE: '#9333ea',
  PK: '#ea580c',
  DEF: '#0891b2',
  Other: '#64748b',
};

/** MFL ships only `birthdate` (Unix seconds) — there's no `age` field on the feed. */
export function calculateAgeFromBirthdate(birthdate?: string | number | null): number | null {
  if (!birthdate) return null;
  const seconds = typeof birthdate === 'number' ? birthdate : Number(birthdate);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const birthDate = new Date(seconds * 1000);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age > 0 ? age : null;
}

function makeDonutSegments(buckets: AnalyticsBucket[]): DonutSegment[] {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return [];
  let cumulative = 0;
  return buckets.map((b) => {
    const startPct = cumulative / total;
    cumulative += b.count;
    const endPct = cumulative / total;
    // Map to circumference; using r=42 so circumference ≈ 263.89
    const circumference = 2 * Math.PI * 42;
    const dashLength = (endPct - startPct) * circumference;
    const dashOffset = -startPct * circumference;
    return {
      ...b,
      color: POSITION_COLORS[b.label] ?? '#64748b',
      dashArray: `${dashLength} ${circumference - dashLength}`,
      dashOffset,
    };
  });
}

export function buildRosterAnalytics(roster: RosterAnalyticsInput[]): RosterAnalytics {
  const positionDistribution: AnalyticsBucket[] = (() => {
    const PRIMARY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK'];
    const counts = new Map<string, number>();
    for (const p of roster) {
      const pos = p.position;
      const key = PRIMARY_POSITIONS.includes(pos)
        ? pos
        : pos === 'DEF' || pos === 'Def'
          ? 'DEF'
          : 'Other';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const ordered = [...PRIMARY_POSITIONS, 'DEF', 'Other'];
    return ordered
      .map((label) => ({
        label,
        count: counts.get(label) ?? 0,
        pct: roster.length ? ((counts.get(label) ?? 0) / roster.length) * 100 : 0,
      }))
      .filter((b) => b.count > 0);
  })();

  const ageBuckets: AnalyticsBucket[] = (() => {
    const ranges: Array<{ label: string; min: number; max: number }> = [
      { label: '≤23', min: 0, max: 23 },
      { label: '24–26', min: 24, max: 26 },
      { label: '27–29', min: 27, max: 29 },
      { label: '30+', min: 30, max: 99 },
    ];
    const ages = roster
      .map((p) => calculateAgeFromBirthdate(p.birthdate))
      .filter((n): n is number => n !== null);
    return ranges
      .map((r) => {
        const count = ages.filter((a) => a >= r.min && a <= r.max).length;
        return { label: r.label, count, pct: ages.length ? (count / ages.length) * 100 : 0 };
      })
      .filter((b) => b.count > 0);
  })();

  const ageStats: RosterAnalytics['ageStats'] = (() => {
    const withAge = roster
      .map((p) => ({ name: p.name, age: calculateAgeFromBirthdate(p.birthdate) }))
      .filter((p): p is { name: string; age: number } => p.age !== null);
    if (!withAge.length) return { avg: null, oldest: null, youngest: null };
    const sum = withAge.reduce((acc, p) => acc + p.age, 0);
    const sortedByAge = [...withAge].sort((a, b) => a.age - b.age);
    return {
      avg: sum / withAge.length,
      youngest: sortedByAge[0]!,
      oldest: sortedByAge[sortedByAge.length - 1]!,
    };
  })();

  const ageByPositionDots: AgePositionDot[] = (() => {
    const points: { position: PositionLane; age: number; name: string }[] = [];
    for (const p of roster) {
      const age = calculateAgeFromBirthdate(p.birthdate);
      if (age === null) continue;
      const rawPos = (p.position || '').toUpperCase();
      const lane: PositionLane | null =
        rawPos === 'DEF' ? 'DEF' : (POSITION_LANES as readonly string[]).includes(rawPos) ? (rawPos as PositionLane) : null;
      if (!lane) continue;
      points.push({ position: lane, age, name: p.name });
    }
    const seen = new Map<string, number>();
    return points.map((pt) => {
      const key = `${pt.position}:${pt.age}`;
      const stackIndex = seen.get(key) ?? 0;
      seen.set(key, stackIndex + 1);
      return { ...pt, stackIndex };
    });
  })();

  const ageStripRange = (() => {
    const ages = ageByPositionDots.map((d) => d.age);
    const lo = ages.length ? Math.min(...ages) : 22;
    const hi = ages.length ? Math.max(...ages) : 36;
    const min = Math.max(18, Math.floor((lo - 1) / 2) * 2);
    const max = Math.ceil((hi + 1) / 2) * 2;
    const ticks: number[] = [];
    for (let t = min; t <= max; t += 2) ticks.push(t);
    return { min, max, ticks };
  })();

  return {
    rosterSize: roster.length,
    positionDistribution,
    donutSegments: makeDonutSegments(positionDistribution),
    ageBuckets,
    ageStats,
    ageByPositionDots,
    ageStripRange,
  };
}

/** Group roster rows by NFL team — only teams with 2+ of this franchise's
 *  players get a card, mirroring rosters.astro's Analytics layout. Coaches
 *  and free agents are excluded so the grouping stays about real NFL overlap. */
export function groupByNflTeam<T extends { team: string; position: string; name: string }>(
  roster: T[],
): RosterGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const p of roster) {
    const team = (p.team || '').trim();
    if (!team || team === 'FA' || team === 'N/A') continue;
    const pos = (p.position || '').toUpperCase();
    if (pos === 'COACH') continue;
    const normalized = normalizeTeamCode(team) || team;
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized)!.push(p);
  }
  return [...groups.entries()]
    .filter(([, players]) => players.length > 1)
    .map(([key, players]) => ({ key, players: [...players].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Group roster rows by college — same 2+ threshold, DEF excluded (no college). */
export function groupByCollege<T extends { college?: string | null; position: string; name: string }>(
  roster: T[],
): RosterGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const p of roster) {
    const college = (p.college || '').trim();
    if (!college || college === 'N/A' || college.toLowerCase() === 'unknown') continue;
    const pos = (p.position || '').toUpperCase();
    if (pos === 'DEF') continue;
    if (!groups.has(college)) groups.set(college, []);
    groups.get(college)!.push(p);
  }
  return [...groups.entries()]
    .filter(([, players]) => players.length > 1)
    .map(([key, players]) => ({ key, players: [...players].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ─────────────────────────────────────────────────────────────────────────
// Cap analytics — leagues with `salaryCap` only.
//
// Everything below SHAPES the output of salary-calculations.ts into chart
// slices. It computes no cap rate, percentage or threshold of its own; see
// rule 2 in this file's header.
// ─────────────────────────────────────────────────────────────────────────

/** One labelled, coloured bar/segment with a value in dollars (or $/point). */
export interface CapSlice {
  label: string;
  value: number;
  color: string;
  /** Share of the chart's total, 0-100. Meaningless for efficiency bars. */
  pct: number;
}

export interface CapAnalytics {
  /** Cap committed vs. what is left, for the allocation donut. */
  allocation: CapSlice[];
  /** Headcount by bucket, for the roster-composition donut. */
  composition: CapSlice[];
  /** Current-year cap dollars by position. */
  positionSpend: CapSlice[];
  /** Dollars per fantasy point by position — LOWER IS BETTER, unlike every
   *  other chart here, which is why the panel labels it explicitly. */
  efficiency: CapSlice[];
  capLimit: number;
  capUsed: number;
  capFree: number;
}

/** Bucket colours for the allocation/composition donuts. Position charts
 *  reuse POSITION_COLORS so a position is the same colour in every chart. */
const BUCKET_COLORS: Record<string, string> = {
  Active: '#2563eb',
  Practice: '#0891b2',
  'Injured Reserve': '#ea580c',
  'Dead Money': '#64748b',
  Available: '#16a34a',
  Open: '#cbd5e1',
};

const toSlices = (
  entries: Array<[string, number]>,
  color: (label: string) => string,
): CapSlice[] => {
  const total = entries.reduce((sum, [, v]) => sum + Math.max(v, 0), 0);
  return entries
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({
      label,
      value,
      color: color(label),
      pct: total > 0 ? (Math.max(value, 0) / total) * 100 : 0,
    }));
};

/**
 * Cap analytics for ONE team's current-year roster.
 *
 * @param rows        The team's players, each already carrying the
 *                    `displayTag` its bucket implies ('active' | 'practice'
 *                    | 'injured') — the same shape `calculateCapCharges`
 *                    takes, so callers build the array once.
 * @param capLimit    The league's cap for the year. Passed in, never read
 *                    from a constant here: `SALARY_CAP` is TheLeague's and
 *                    this module must not know whose roster it is holding.
 * @param deadMoney   Current-year dead money, already aggregated by
 *                    `aggregateDeadMoney`. Shown as its own allocation
 *                    segment because a team cannot spend it and it is the
 *                    first thing an owner looks for.
 * @param rosterLimit Roster size cap, for the composition donut's "Open"
 *                    slots. Omit to leave open slots out entirely.
 */
export function buildCapAnalytics(
  rows: (CapPlayer & { position?: string | null; points?: unknown })[],
  capLimit: number,
  deadMoney = 0,
  rosterLimit?: number,
): CapAnalytics {
  const buckets = calculateBucketCaps(rows);
  const capUsed = buckets.active + buckets.practice + buckets.injured + deadMoney;
  // Not clamped at the top: an over-cap team reads as negative free space
  // rather than as zero, the same call formatCapSpaceDisplay makes.
  const capFree = capLimit - capUsed;

  const allocation = toSlices(
    [
      ['Active', buckets.active],
      ['Practice', buckets.practice],
      ['Injured Reserve', buckets.injured],
      ['Dead Money', deadMoney],
      // An over-cap team contributes no "Available" wedge; the donut then
      // reads as fully committed, which is the truth.
      ['Available', Math.max(capFree, 0)],
    ],
    (label) => BUCKET_COLORS[label] ?? '#64748b',
  );

  const filled = buckets.counts.active + buckets.counts.practice + buckets.counts.injured;
  const composition = toSlices(
    [
      ['Active', buckets.counts.active],
      ['Practice', buckets.counts.practice],
      ['Injured Reserve', buckets.counts.injured],
      ['Open', rosterLimit ? Math.max(rosterLimit - filled, 0) : 0],
    ],
    (label) => BUCKET_COLORS[label] ?? '#64748b',
  );

  const positionColor = (label: string) => POSITION_COLORS[label] ?? '#64748b';
  const orderPositions = (entries: Array<[string, number]>) => {
    const order = [...POSITION_LANES] as string[];
    return entries.sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      if (ia !== ib) return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
      return a[0].localeCompare(b[0]);
    });
  };

  const positionSpend = toSlices(
    orderPositions(Object.entries(calculatePositionCaps(rows))),
    positionColor,
  );
  const efficiency = toSlices(
    orderPositions(Object.entries(calculateCapEfficiency(rows))),
    positionColor,
  );

  return { allocation, composition, positionSpend, efficiency, capLimit, capUsed, capFree };
}
