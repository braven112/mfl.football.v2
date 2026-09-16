/**
 * Roster analytics for the AFL Front Office panel — position composition,
 * age-by-position, age stats/distribution, and NFL-team/college groupings.
 *
 * A fresh implementation of the same analysis AFL `rosters.astro`'s
 * Analytics view computes inline, not an extraction from it (that page's
 * own copy stays untouched — see docs/plans for why). This one exists
 * because the Front Office hub's Keeper Planner panel never had this data
 * at all, and duplicating the ~150 lines of pure bucket/chart math a
 * SECOND time inline in the panel component would bury the actual
 * component logic. Pure module: no feed reads here, callers pass in
 * already-loaded player rows.
 */
import { normalizeTeamCode } from './nfl-logo';

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
