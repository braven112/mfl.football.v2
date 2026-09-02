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

export type WaiverSystem = 'bbid' | 'priority';

export interface WaiverBidRules {
  /**
   * Which system the league runs. TheLeague is BBID_FCFS (blind bidding); the
   * AFL is WAIVERS_FCFS (rolling priority, no bids). They use DIFFERENT MFL
   * import types and different PICKS shapes, so this is not cosmetic.
   */
  system: WaiverSystem;
  /** Convenience: `system === 'bbid'`. */
  blindBid: boolean;
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
  /** Whole dollars. Ignored by priority-waiver leagues, which do not bid. */
  bid?: number;
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
  const blindBid = String(league.currentWaiverType ?? '').toUpperCase().includes('BBID');
  return {
    system: blindBid ? 'bbid' : 'priority',
    blindBid,
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

    // Bind once so the number is genuinely narrowed — `Number.isFinite` is not
    // a TypeScript type guard, so testing `c.bid` through it leaves the
    // optional type in place and every later use needs a `!`.
    const bid = typeof c.bid === 'number' && Number.isFinite(c.bid) ? c.bid : null;
    if (rules.system !== 'bbid') {
      // Priority waivers have no bid — position in the order decides.
    } else if (bid === null || bid <= 0) {
      errors.push(`${label}: enter a bid amount.`);
    } else {
      if (bid < rules.minimum) {
        errors.push(`${label}: bid is below the $${rules.minimum.toLocaleString()} minimum.`);
      }
      if (bid % rules.increment !== 0) {
        errors.push(`${label}: bid must be a multiple of $${rules.increment.toLocaleString()}.`);
      }
      if (bid > ctx.availableBalance) {
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
export function buildPicksParam(claims: WaiverClaim[], system: WaiverSystem = 'bbid'): string {
  return claims
    .map((c) => {
      const drop = c.dropPlayerId && c.dropPlayerId !== NO_DROP ? c.dropPlayerId : NO_DROP;
      // Priority waivers are add_drop only — sending a bid there would make MFL
      // read the amount as the drop player id.
      if (system !== 'bbid') return `${c.addPlayerId}_${drop}`;
      // `bid` is optional on the type because priority leagues have none, but a
      // blind bid without one is a programmer error. Refuse loudly: defaulting
      // to 0 would send MFL a real, valid, zero-dollar bid.
      const bid = c.bid;
      if (typeof bid !== 'number' || !Number.isFinite(bid)) {
        throw new Error(`Blind-bid claim for player ${c.addPlayerId} has no bid amount.`);
      }
      return `${c.addPlayerId}_${bid}_${drop}`;
    })
    .join(',');
}

/**
 * Round must be present and in range when the league bids conditionally.
 * Returns null when acceptable, else the reason.
 */
export function validateRound(round: unknown, rules: WaiverBidRules): string | null {
  // Priority waivers (`waiverRequest`) require ROUND unconditionally; blind
  // bidding only requires it when the league bids conditionally.
  if (!rules.conditional && rules.system !== 'priority') return null;
  const n = Number(round);
  if (!Number.isInteger(n) || n < 1 || n > rules.maxRounds) {
    return `Round must be a whole number between 1 and ${rules.maxRounds}.`;
  }
  return null;
}

/** MFL import type for a league's waiver system. */
export function waiverImportType(rules: WaiverBidRules): string {
  return rules.blindBid ? 'blindBidWaiverRequest' : 'waiverRequest';
}

/**
 * Which conference a franchise belongs to, or null in a single-conference
 * league. MFL puts `conference` on the DIVISION, not the franchise, so it has
 * to be resolved through the divisions map.
 */
export function conferenceOfFranchise(
  league: Record<string, any> = {},
  franchiseId: string
): string | null {
  const divisions = league?.divisions?.division;
  const list = Array.isArray(divisions) ? divisions : divisions ? [divisions] : [];
  if (list.length === 0) return null;
  const franchises = Array.isArray(league?.franchises?.franchise)
    ? league.franchises.franchise
    : [league?.franchises?.franchise].filter(Boolean);
  const mine = franchises.find((f: any) => String(f?.id) === String(franchiseId));
  if (!mine) return null;
  const div = list.find((d: any) => String(d?.id) === String(mine.division));
  return div?.conference != null ? String(div.conference) : null;
}

/**
 * Whether a player being on SOMEONE ELSE'S roster makes them unavailable.
 *
 * False in a duplicate-player league scoped by conference (the AFL:
 * `playerLimitUnit: CONFERENCE`), where the same player can be rostered by one
 * franchise in each conference — so a rival conference's roster says nothing
 * about your availability. Reading it as "taken" would silently reject
 * perfectly legal claims. The registry carries the same warning for
 * cut-player's ownership preflight.
 */
export function freeAgencyIsLeagueWide(league: Record<string, any> = {}): boolean {
  return String(league?.playerLimitUnit ?? 'LEAGUE').toUpperCase() !== 'CONFERENCE';
}

/**
 * Player ids appearing in an `export?TYPE=pendingWaivers` payload — the
 * read-back that proves a submitted round actually landed.
 *
 * Returns **null** when the payload cannot be interpreted (an error body, or no
 * `pendingWaivers` key at all). Null is not "nothing is stored": the caller
 * must report it as UNVERIFIED rather than as success or failure. Collapsing
 * those two is what let a dropped write report "Round 1 submitted".
 *
 * MFL's shape here is undocumented and has changed before, so rather than pin
 * one key path this walks the subtree and collects every id-shaped value. The
 * bias is deliberate: a loose match can only cause a real failure to go
 * unreported, whereas a too-narrow match tells an owner their perfectly good
 * claim did not go through. `""` is MFL's empty-state for these list exports
 * (same as `pendingTrades`) and is a genuine, verified "nothing pending".
 */
export function readPendingWaiverPlayerIds(body: any): string[] | null {
  if (!body || typeof body !== 'object') return null;
  if (body.error) return null;
  const pending = body.pendingWaivers ?? body.pendingWaiver;
  if (pending === undefined || pending === null) return null;
  if (typeof pending === 'string') return pending.trim() === '' ? [] : null;
  if (typeof pending !== 'object') return null;

  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (
        (key === 'id' || key === 'player' || key === 'add' || key === 'drop') &&
        (typeof value === 'string' || typeof value === 'number')
      ) {
        const id = String(value).trim();
        if (/^\d{2,6}$/.test(id)) ids.add(id);
        continue;
      }
      walk(value);
    }
  };
  walk(pending);
  // Zero ids out of a payload that HAD content is not "nothing pending" — it is
  // a shape we do not recognize, and the two must not collapse. Reporting it as
  // a verified empty list tells an owner their good claim did not go through;
  // `null` tells them we could not check, which is the truth.
  if (ids.size === 0 && Object.keys(pending as Record<string, unknown>).length > 0) return null;
  return [...ids];
}
