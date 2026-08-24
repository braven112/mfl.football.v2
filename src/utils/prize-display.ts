/**
 * Prize amounts for DISPLAY surfaces, derived from the league registry.
 *
 * `payouts` in `src/config/leagues-data.mjs` is the only prize table (see
 * docs/claude/rules/accounting.md). It was not always: `StandingsTable.astro`
 * hardcoded `TIER_PRIZES`, and BOTH playoff pages hardcoded their own copies
 * (`placementPayouts` in TheLeague's, `aflPayouts` in the AFL's), so the
 * dollars an owner read on a page and the dollars the commissioner actually
 * wrote to MFL were independent constants free to disagree.
 *
 * Every lookup here returns the registry row rather than a bare number, so a
 * caller renders the registry's own `label` instead of re-typing one.
 *
 * These are DISPLAY helpers only — they answer "what does this prize pay",
 * never "who won it". Winner derivation belongs in the payout planner
 * (`accounting-payouts.mjs`), which is pure and separately tested.
 */

import { getLeaguePayouts, type PayoutPrize } from '../config/leagues';

/**
 * Dollars, the way every prize surface shows them. Whole amounts render
 * without cents ($150, not $150.00) because every prize in both leagues'
 * tables is whole; a split weekly-high tie ($1.50) is the one case that
 * isn't, so fractions keep two decimals rather than rounding away half a
 * dollar an owner is owed.
 */
export function formatPrizeAmount(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Every prize a league publishes, in constitution order. */
export function getPrizes(slug: string): PayoutPrize[] {
  return getLeaguePayouts(slug)?.prizes ?? [];
}

/**
 * The constitution's stated prize pool, or null for a league that publishes
 * no table. Display-and-reconcile only — never used to scale a prize.
 */
export function getPrizePool(slug: string): number | null {
  return getLeaguePayouts(slug)?.prizePool ?? null;
}

/** A prize by its stable registry key. */
export function getPrizeByKey(slug: string, key: string): PayoutPrize | null {
  return getPrizes(slug).find((prize) => prize.key === key) ?? null;
}

/** The prize for finishing Nth in the league's placement brackets. */
export function getPlacementPrize(slug: string, place: number): PayoutPrize | null {
  return (
    getPrizes(slug).find(
      (prize) => prize.source.kind === 'placement' && prize.source.place === place
    ) ?? null
  );
}

/** The prize attached to an award slug already resolved in awards history. */
export function getAwardPrize(slug: string, awardSlug: string): PayoutPrize | null {
  return (
    getPrizes(slug).find(
      (prize) => prize.source.kind === 'award' && prize.source.slug === awardSlug
    ) ?? null
  );
}

/**
 * The prize a conference playoff seed pays.
 *
 * The AFL pays its division titles and wild cards this way — seeds 1-2 are
 * the division winners who actually reached the playoffs, seeds 3-4 the wild
 * cards. A seed outside any prize's `seeds` list pays nothing, which is the
 * whole point: the AFL has six divisions but pays FOUR division titles, and a
 * third division winner who misses the playoffs is not paid. Do not "fix"
 * that back to six.
 */
export function getSeedPrize(slug: string, seed: number): PayoutPrize | null {
  return (
    getPrizes(slug).find(
      (prize) => prize.source.kind === 'playoff-seed' && prize.source.seeds.includes(seed)
    ) ?? null
  );
}

/** The prize for rank N of an all-play tier table. */
export function getTierPrize(slug: string, tier: string, rank: number): PayoutPrize | null {
  return (
    getPrizes(slug).find(
      (prize) =>
        prize.source.kind === 'tier-rank' &&
        prize.source.tier === tier &&
        prize.source.rank === rank
    ) ?? null
  );
}

/**
 * The per-week high-score prize and the week count the constitution states.
 *
 * `weeks` is the EXPECTED count, not a promise: the planner pays whichever
 * regular-season weeks actually have scores and reconciles against this. A
 * display surface showing a season total must say "expected" or derive from
 * played weeks — never present `amount * weeks` as money already awarded.
 */
export function getWeeklyHighPrize(
  slug: string
): { prize: PayoutPrize; amount: number; weeks: number } | null {
  const prize = getPrizes(slug).find((p) => p.source.kind === 'weekly-high');
  if (!prize || prize.source.kind !== 'weekly-high') return null;
  return { prize, amount: prize.amount, weeks: prize.source.weeks };
}

/** One rendered row of a league's published prize table. */
export interface PrizeTableRow {
  key: string;
  label: string;
  /** The per-winner amount, formatted. */
  amount: string;
  /**
   * How this prize is awarded, derived from its source kind — e.g. "Each
   * conference, seeds 1-2". Empty for a prize awarded once outright.
   */
  note: string;
  /**
   * Winners this prize pays, when the registry alone determines it, else
   * null. A `playoff-seed` prize pays its seeds in EVERY conference, and the
   * conference count is league structure the payout table does not carry —
   * so it stays null rather than guessing a multiplier.
   */
  winners: number | null;
}

function describeSource(prize: PayoutPrize): { note: string; winners: number | null } {
  switch (prize.source.kind) {
    case 'placement':
    case 'award':
    case 'tier-rank':
      return { note: '', winners: 1 };
    case 'weekly-high':
      return {
        note: `${formatPrizeAmount(prize.amount)} × ${prize.source.weeks} weeks`,
        winners: prize.source.weeks,
      };
    case 'playoff-seed': {
      const seeds = prize.source.seeds;
      const range =
        seeds.length > 1 ? `seeds ${seeds[0]}-${seeds[seeds.length - 1]}` : `seed ${seeds[0]}`;
      // Paid in every conference, and the registry does not carry how many
      // conferences a league runs — so the winner count is not derivable here.
      return { note: `Each conference, ${range}`, winners: null };
    }
  }
}

/** A league's published prize table, ready to render. */
export function getPrizeTableRows(slug: string): PrizeTableRow[] {
  return getPrizes(slug).map((prize) => {
    const { note, winners } = describeSource(prize);
    return {
      key: prize.key,
      label: prize.label,
      amount: formatPrizeAmount(prize.amount),
      note,
      winners,
    };
  });
}

/**
 * What the published table adds up to, or null when the registry alone can't
 * say.
 *
 * Returns null if ANY prize's winner count is unknown (a `playoff-seed`
 * prize, whose winners scale with the conference count). Showing a total that
 * silently omits four $150 division titles is worse than showing none — the
 * AFL's table would read $1,325 against a stated $2,220 pool and look like
 * money had gone missing.
 */
export function getDerivedPrizeTotal(slug: string): number | null {
  const prizes = getPrizes(slug);
  if (prizes.length === 0) return null;
  let total = 0;
  for (const prize of prizes) {
    const { winners } = describeSource(prize);
    if (winners === null) return null;
    total += prize.amount * winners;
  }
  return total;
}
