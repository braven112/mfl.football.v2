/**
 * Blind-bid waiver claim validation and payload construction.
 *
 * TheLeague runs BBID_FCFS: blind bidding during the waiver window, then
 * first-come-first-served once waivers process. This module owns the rules a
 * claim must satisfy BEFORE it reaches MFL, because MFL's rejection messages
 * are terse and arrive after the owner has already left the page.
 *
 * The bid rules come from the league export, never hardcoded:
 *   bbidMinimum      the floor for any bid          (TheLeague: 425000)
 *   bbidIncrement    bids must be a multiple of it  (TheLeague: 25000)
 *   bbidConditional  whether ROUND is required      (TheLeague: Yes)
 *
 * WHY BIDS ARE NOT SUMMED against the balance: conditional claims in one round
 * are ALTERNATIVES — MFL awards at most one, then stops. So the constraint is
 * that the LARGEST single bid is affordable, not the total. Summing would
 * reject a perfectly legal board of four $425K alternatives for an owner
 * holding $1M.
 */

export interface WaiverBidRules {
  /** Minimum legal bid, in whole dollars. */
  minimum: number;
  /** Bids must be a multiple of this above zero. */
  increment: number;
  /** When true MFL requires a ROUND with each request. */
  conditional: boolean;
  /** Highest round number the league accepts. */
  maxRounds: number;
}

export interface WaiverClaim {
  /** MFL player id to bid on. */
  addPlayerId: string;
  /** Whole dollars. */
  bid: number;
  /** MFL player id to drop if awarded; omit to add without dropping. */
  dropPlayerId?: string;
}

export interface ClaimValidationContext {
  rules: WaiverBidRules;
  /** The franchise's remaining blind-bid dollars. */
  availableBalance: number;
  /** Player ids currently on the franchise's roster. */
  rosterPlayerIds: Set<string>;
  /** Player ids that are unrostered league-wide. */
  freeAgentIds: Set<string>;
  /** Roster limit, so a no-drop claim that would overfill is caught here. */
  rosterLimit?: number;
}

/** MFL's sentinel for "adding without dropping anyone". */
export const NO_DROP = '0000';

/** Read the bid rules off an MFL `export?TYPE=league` payload. */
export function readBidRules(league: Record<string, any> = {}): WaiverBidRules {
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    minimum: num(league.bbidMinimum, 0),
    // A zero or missing increment must not become a modulo-by-zero; treat it
    // as "any amount" rather than rejecting every bid.
    increment: num(league.bbidIncrement, 1),
    conditional: String(league.bbidConditional ?? '').toLowerCase() === 'yes',
    maxRounds: num(league.maxWaiverRounds, 1),
  };
}

/**
 * Validate a full round of claims. Returns every problem rather than the first,
 * so an owner fixes one board instead of resubmitting four times.
 */
export function validateClaims(claims: WaiverClaim[], ctx: ClaimValidationContext): string[] {
  const errors: string[] = [];
  const { rules } = ctx;

  if (!Array.isArray(claims) || claims.length === 0) {
    return ['Submit at least one claim.'];
  }

  const seen = new Set<string>();
  for (const [i, c] of claims.entries()) {
    const label = `Claim ${i + 1}`;

    if (!c?.addPlayerId || !/^\d+$/.test(String(c.addPlayerId))) {
      errors.push(`${label}: missing or invalid player to add.`);
      continue;
    }
    if (seen.has(c.addPlayerId)) {
      errors.push(`${label}: you already have a claim on this player in this round.`);
    }
    seen.add(c.addPlayerId);

    if (!ctx.freeAgentIds.has(c.addPlayerId)) {
      errors.push(`${label}: that player is not a free agent.`);
    }

    if (!Number.isFinite(c.bid) || c.bid <= 0) {
      errors.push(`${label}: enter a bid amount.`);
    } else {
      if (c.bid < rules.minimum) {
        errors.push(`${label}: bid is below the $${rules.minimum.toLocaleString()} minimum.`);
      }
      if (c.bid % rules.increment !== 0) {
        errors.push(`${label}: bid must be a multiple of $${rules.increment.toLocaleString()}.`);
      }
      if (c.bid > ctx.availableBalance) {
        errors.push(
          `${label}: bid exceeds your $${ctx.availableBalance.toLocaleString()} remaining blind-bid budget.`
        );
      }
    }

    if (c.dropPlayerId !== undefined && c.dropPlayerId !== NO_DROP) {
      if (!/^\d+$/.test(String(c.dropPlayerId))) {
        errors.push(`${label}: invalid player to drop.`);
      } else if (!ctx.rosterPlayerIds.has(c.dropPlayerId)) {
        errors.push(`${label}: you can only drop a player on your own roster.`);
      }
    } else if (ctx.rosterLimit !== undefined && ctx.rosterPlayerIds.size >= ctx.rosterLimit) {
      errors.push(
        `${label}: your roster is full (${ctx.rosterPlayerIds.size}/${ctx.rosterLimit}) — pick someone to drop.`
      );
    }
  }

  return errors;
}

/**
 * Build MFL's `PICKS` value: `addId_bid_dropId`, comma-separated, in priority
 * order. `0000` in the drop slot means "no drop".
 *
 * Order is the owner's conditional priority and MFL honors it, so callers must
 * not re-sort.
 */
export function buildPicksParam(claims: WaiverClaim[]): string {
  return claims
    .map((c) => `${c.addPlayerId}_${c.bid}_${c.dropPlayerId && c.dropPlayerId !== NO_DROP ? c.dropPlayerId : NO_DROP}`)
    .join(',');
}

/**
 * Round must be present and in range when the league bids conditionally.
 * Returns null when acceptable, else the reason.
 */
export function validateRound(round: unknown, rules: WaiverBidRules): string | null {
  if (!rules.conditional) return null;
  const n = Number(round);
  if (!Number.isInteger(n) || n < 1 || n > rules.maxRounds) {
    return `Round must be a whole number between 1 and ${rules.maxRounds}.`;
  }
  return null;
}
