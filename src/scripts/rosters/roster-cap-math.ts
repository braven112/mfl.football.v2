/**
 * Cap math for the roster page.
 *
 * Extracted from the inline client script in `rosters.astro`. These produce
 * every number in the cap footer and the bucket subtotals, which is exactly
 * what `scripts/roster-parity-check.mjs` fingerprints — so the extraction is
 * covered end-to-end as well as by the unit tests beside it.
 *
 * Everything the originals closed over (cap-inclusion percentages, pending
 * contract actions, declarations) is now an explicit parameter. That is most of
 * the value: the numbers were previously unreachable without booting a browser.
 *
 * See `docs/plans/rosters-page-split.md`.
 */

export type RosterBucket = 'ACTIVE' | 'PRACTICE' | 'INJURED';

export interface CapPlayer {
  id?: string | number;
  position?: string | null;
  salary?: unknown;
  points?: unknown;
  contractYears?: unknown;
  displayTag?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

/** `{ ACTIVE: { current: 1, future: 1 }, PRACTICE: { current: 0.5, … }, … }` */
export type CapInclusion = Record<string, { current?: number; future?: number }>;

export interface ContractAction {
  type?: string;
  newSalary?: unknown;
  ufaYearIndex?: number;
  salaryBreakdown?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Declaration {
  years?: number | null;
  requestedYears?: number | null;
  [key: string]: unknown;
}

/**
 * Percentage of a salary that counts against the cap for a bucket.
 *
 * Practice-squad and IR players count at a reduced rate in the CURRENT year and
 * usually in full in future years, which is why `isCurrent` is not cosmetic —
 * getting it wrong silently understates next year's cap.
 */
export function getCapPercent(
  tag: string = 'ACTIVE',
  isCurrent: boolean = true,
  capInclusion: CapInclusion = {},
): number {
  const normalized = String(tag).toUpperCase();
  const map = capInclusion?.[normalized] ?? { current: 1, future: 1 };
  return (isCurrent ? map.current : map.future) ?? 1;
}

/**
 * Collapse the many spellings of a roster status into the three buckets the
 * cap rules recognize. `status` can arrive as "IR", "Injured Reserve",
 * "PRACTICE SQUAD", etc., so this is substring matching on purpose.
 */
export function normalizeBucket(player: CapPlayer): RosterBucket {
  const raw = String(player.displayTag ?? player.status ?? 'ACTIVE').toUpperCase();
  if (raw.includes('PRACTICE')) return 'PRACTICE';
  if (raw.includes('INJURED') || raw === 'IR') return 'INJURED';
  return 'ACTIVE';
}

export interface CapChargeContext {
  /** One entry per displayed contract year; only the length is read. */
  salaryYears: unknown[];
  capInclusion?: CapInclusion;
  /** Pending, unsaved actions keyed by player id (cuts, trades, extensions…). */
  contractActions?: Record<string, ContractAction>;
  /** Optimistic local declarations, which win over the saved ones. */
  localDeclarations?: Record<string, Declaration>;
  declarationsByPlayer?: Record<string, Declaration>;
}

/** Annual salary escalation applied to every multi-year contract. */
export const ANNUAL_ESCALATION = 1.1;

/**
 * Cap charge per contract year.
 *
 * Three things stack here, in this order:
 *  - cut/traded players contribute nothing (their dead money is added by the
 *    caller, not here);
 *  - a declaration's year count overrides the player's own contract length;
 *  - an extension's explicit per-year breakdown overrides the 10% escalation.
 *
 * Franchise tags and team options are added at their UFA year rather than
 * escalated, because they are one-year awards priced off positional averages.
 */
export function calculateCapCharges(
  rows: CapPlayer[] = [],
  {
    salaryYears,
    capInclusion = {},
    contractActions = {},
    localDeclarations = {},
    declarationsByPlayer = {},
  }: CapChargeContext,
): number[] {
  return salaryYears.map((_, index) => {
    let total = rows.reduce((sum, player) => {
      const key = String(player.id ?? '');
      const action = contractActions[key];
      if (action && (action.type === 'cut' || action.type === 'trade')) return sum;

      const decl = localDeclarations[key] || declarationsByPlayer[key];
      const declYears = decl ? (decl.years ?? decl.requestedYears ?? null) : null;
      const effectiveContractYears =
        declYears != null ? declYears : (Number(player.contractYears ?? 0) || 0);

      if (effectiveContractYears <= index) return sum;

      const percent = getCapPercent(normalizeBucket(player), index === 0, capInclusion);
      const baseSalary = Number(player.salary ?? 0) || 0;

      let salaryForYear = baseSalary * ANNUAL_ESCALATION ** index;
      if (action && action.type === 'extension' && action.salaryBreakdown) {
        salaryForYear = Number(action.salaryBreakdown[`year${index}`] ?? salaryForYear);
      }

      return sum + (salaryForYear * percent || 0);
    }, 0);

    Object.values(contractActions).forEach((action) => {
      if (
        (action.type === 'franchise' || action.type === 'team-option')
        && action.ufaYearIndex === index
      ) {
        total += Number(action.newSalary ?? 0) || 0;
      }
    });

    return total;
  });
}

export interface BucketCaps {
  active: number;
  practice: number;
  injured: number;
  counts: { active: number; practice: number; injured: number };
}

/**
 * Current-year cap totals and headcounts per bucket.
 *
 * Note this reads `displayTag` only (not `status`) and always uses the
 * current-year percentage — it describes the roster as displayed right now.
 */
export function calculateBucketCaps(
  rows: CapPlayer[] = [],
  capInclusion: CapInclusion = {},
): BucketCaps {
  return rows.reduce<BucketCaps>(
    (acc, player) => {
      const tag = String(player.displayTag ?? 'active').toUpperCase();
      const percent = getCapPercent(tag, true, capInclusion);
      const salary = Number(player.salary ?? 0) || 0;
      if (tag === 'PRACTICE') {
        acc.practice += salary * percent;
        acc.counts.practice += 1;
      } else if (tag === 'INJURED') {
        acc.injured += salary * percent;
        acc.counts.injured += 1;
      } else {
        acc.active += salary * percent;
        acc.counts.active += 1;
      }
      return acc;
    },
    { active: 0, practice: 0, injured: 0, counts: { active: 0, practice: 0, injured: 0 } },
  );
}

/** Current-year cap spend per position. Expired contracts are excluded. */
export function calculatePositionCaps(
  rows: CapPlayer[] = [],
  capInclusion: CapInclusion = {},
): Record<string, number> {
  return rows.reduce<Record<string, number>>((totals, player) => {
    if ((Number(player.contractYears ?? 0) || 0) <= 0) return totals;
    const percent = getCapPercent(normalizeBucket(player), true, capInclusion);
    const pos = String(player.position ?? 'UNK').toUpperCase();
    totals[pos] = (totals[pos] ?? 0) + (Number(player.salary ?? 0) || 0) * percent;
    return totals;
  }, {});
}

/**
 * Dollars per fantasy point, per position — lower is better value.
 *
 * Players with no points are skipped rather than counted as infinitely
 * expensive, which would make any position with a benched player look terrible.
 */
export function calculateCapEfficiency(rows: CapPlayer[] = []): Record<string, number> {
  const totals: Record<string, { totalCost: number; totalPoints: number }> = {};
  rows.forEach((player) => {
    if ((Number(player.contractYears ?? 0) || 0) <= 0) return;
    if ((Number(player.points ?? 0) || 0) <= 0) return;
    const pos = String(player.position ?? 'UNK').toUpperCase();
    if (!totals[pos]) totals[pos] = { totalCost: 0, totalPoints: 0 };
    totals[pos].totalCost += Number(player.salary ?? 0) || 0;
    totals[pos].totalPoints += Number(player.points ?? 0) || 0;
  });

  const result: Record<string, number> = {};
  Object.entries(totals).forEach(([pos, data]) => {
    result[pos] = data.totalCost / data.totalPoints;
  });
  return result;
}

/** Total contract years on the roster, and the longest single contract. */
export function calculateContractYearsMeta(rows: CapPlayer[] = []): {
  contractYearsTotal: number;
  longestContract: number;
} {
  const contractYearsTotal = rows.reduce(
    (sum, player) => sum + Math.max(Number(player.contractYears ?? 0) || 0, 0),
    0,
  );
  const longestContract = rows.reduce(
    (max, player) => Math.max(max, Number(player.contractYears ?? 0) || 0),
    0,
  );
  return { contractYearsTotal, longestContract };
}
