/**
 * MAD POWER 99 — Archie's playoff seeding, on the site.
 *
 * The same seeding the league's MFL widget draws (public/mfl/10105/
 * standings.js; decisions in public/mfl/10105/DECISIONS.md):
 *
 *   seeds 1-9    each division's leader   — the division's FIRST row
 *   seeds 10-18  each division's runner-up — its SECOND row
 *   seeds 19-30  wild cards               — the next 12 of everyone else
 *   seeds 31+    the field
 *
 * Every tier is taken in MFL's row order, NEVER re-sorted. The widget orders
 * each tier by Victory Points then Points For; the league now sorts MFL itself
 * on VICTORY_POINTS, PTS, H2H, so MFL's order already is that order — and also
 * applies head-to-head, which neither the widget nor we can. The guard test
 * checks the committed feed still agrees with VP/PF, so a league that changes
 * its MFL sort is caught rather than silently seeded on something else.
 * (docs/claude/rules/standings-brackets-draft-order.md, rule 1.)
 */
import type { LeagueDefinition } from '../config/leagues';

export type MadSeeding = NonNullable<LeagueDefinition['standingsSeeding']>;
export type MadTier = 'leader' | 'runnerUp' | 'wildCard' | 'field';

export interface MadSeed {
  id: string;
  seed: number;
  tier: MadTier;
}

/**
 * Seeds for every row, in seed order.
 *
 * @param rowsInFeedOrder MFL's standings rows, exactly as exported.
 * @param divisionOf      The team's division (any stable key).
 */
export function madSeeds(
  rowsInFeedOrder: Array<{ id: string }>,
  divisionOf: (franchiseId: string) => string | undefined,
  seeding: MadSeeding
): MadSeed[] {
  // Position within its division, in feed order: 0 = leader, 1 = runner-up.
  const seenInDivision = new Map<string, number>();
  const leaders: string[] = [];
  const runnersUp: string[] = [];
  const rest: string[] = [];
  for (const row of rowsInFeedOrder) {
    const div = divisionOf(row.id) ?? '';
    const place = seenInDivision.get(div) ?? 0;
    seenInDivision.set(div, place + 1);
    if (place === 0) leaders.push(row.id);
    else if (place === 1) runnersUp.push(row.id);
    else rest.push(row.id);
  }

  // A tier can only hold as many as the league seeds into it; any overflow
  // (more divisions than configured) competes for the wild cards on merit,
  // in feed order, like everyone else.
  const byFeed = new Map(rowsInFeedOrder.map((r, i) => [r.id, i]));
  const inFeedOrder = (ids: string[]) => ids.sort((a, b) => byFeed.get(a)! - byFeed.get(b)!);
  const seededLeaders = leaders.slice(0, seeding.divisionLeaders);
  const seededRunnersUp = runnersUp.slice(0, seeding.runnersUp);
  const others = inFeedOrder([
    ...leaders.slice(seeding.divisionLeaders),
    ...runnersUp.slice(seeding.runnersUp),
    ...rest,
  ]);

  const tiers: Array<[string[], MadTier]> = [
    [seededLeaders, 'leader'],
    [seededRunnersUp, 'runnerUp'],
    [others.slice(0, seeding.wildCards), 'wildCard'],
    [others.slice(seeding.wildCards), 'field'],
  ];
  const out: MadSeed[] = [];
  for (const [ids, tier] of tiers) {
    for (const id of ids) out.push({ id, seed: out.length + 1, tier });
  }
  return out;
}

/** How many teams the seeding puts in the playoffs. */
export function madPlayoffSize(seeding: MadSeeding): number {
  return seeding.divisionLeaders + seeding.runnersUp + seeding.wildCards;
}

/** One qualifying tier on the homepage card, seeds contiguous. */
export interface MadQualifierTier {
  tier: Exclude<MadTier, 'field'>;
  /** First and last seed in the tier. */
  from: number;
  to: number;
  ids: string[];
}

/**
 * The playoff teams only, banded by tier in seed order — what the homepage
 * shows (the full field lives on the standings page's MAD tab). A tier with
 * no teams (week 0, a short league) is dropped rather than rendered empty.
 */
export function madQualifierTiers(seeds: MadSeed[]): MadQualifierTier[] {
  const order: MadQualifierTier['tier'][] = ['leader', 'runnerUp', 'wildCard'];
  return order
    .map((tier) => {
      const inTier = seeds.filter((s) => s.tier === tier);
      return inTier.length
        ? { tier, from: inTier[0].seed, to: inTier[inTier.length - 1].seed, ids: inTier.map((s) => s.id) }
        : null;
    })
    .filter((t): t is MadQualifierTier => t !== null);
}

/**
 * A division's short label for a crest tile: its namesake's last name.
 * "Barry Sanders Division" → "Sanders". Archie's nine divisions each honour a
 * player with a distinct last name, so the last name alone identifies one —
 * the first name does not ("Payton" is both Walter Payton's last name and the
 * first name in "Payton Manning"). A name without a trailing "Division" just
 * yields its last word; a blank name yields "".
 */
export function divisionShortName(name: string): string {
  const words = name.replace(/\s+division\s*$/i, '').trim().split(/\s+/);
  return words[words.length - 1] ?? '';
}
