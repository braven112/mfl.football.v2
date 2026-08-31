/**
 * AFL waiver-order construction.
 *
 * The AFL constitution (docs/claude/afl-rules.md, "Free Agents (Waivers)")
 * says: "Initial waiver order = base draft order from the previous season."
 *
 * That sentence needs one piece of interpretation, because the two sides of it
 * have different shapes:
 *
 *  - The BASE DRAFT ORDER is per-conference. The AFL drafts as two independent
 *    12-team conferences (MFL runs them as separate draft units,
 *    `CONFERENCE00` / `CONFERENCE01`), so "the base draft order" is really TWO
 *    orders of 12 — reverse Week-13 standings, with each conference champion
 *    forced to that conference's last slot. It is the round-2+ order, NOT
 *    round 1: the NIT bonus reshuffles round 1 only (see afl-draft-utils.ts).
 *
 *  - The WAIVER ORDER is a single league-wide list of 24. MFL stores it as one
 *    `waiverSortOrder` per franchise, 1..24.
 *
 * The commissioner's ruling (2026-08-31): render the two conference orders as
 * one list by STRICT ALTERNATION, preserving each conference's internal base
 * order exactly. The conference holding the single worst team in the league
 * leads, so waiver #1 still belongs to a team with a claim to being the worst.
 * The alternative considered and rejected was re-ranking all 24 league-wide,
 * which produces a tidier monotonic list but is no longer "the base draft
 * order" in any literal sense.
 *
 * Alternation is also what keeps the merge fair: each conference gets exactly
 * one of every two slots, so neither is systematically ahead of the other.
 */

/** One franchise's slot in a conference's base draft order. */
export interface ConferenceBaseOrder {
  /** MFL conference code — '00' (American) or '01' (National). */
  conference: string;
  /** Franchise ids, worst-first: index 0 holds that conference's base pick 1. */
  franchiseIds: string[];
}

/** One resolved waiver slot. */
export interface WaiverOrderEntry {
  /** 1-based waiver priority — this is the value written to `waiverSortOrder`. */
  position: number;
  franchiseId: string;
  conference: string;
  /** 1-based slot this franchise held in its own conference's base order. */
  conferenceBasePosition: number;
}

/**
 * Interleave two conference base orders into one league-wide waiver order.
 *
 * @param baseOrders     Exactly two conferences, each with the same team count.
 * @param leadFranchiseId Franchise whose conference takes waiver slot 1 —
 *                        pass the league's single worst team.
 * @throws If the two conferences differ in size, if a franchise appears twice,
 *         or if `leadFranchiseId` is not in either conference. Each of those
 *         would silently produce a wrong-but-plausible order, and this value is
 *         written straight to the live league.
 */
export function buildAflWaiverOrder(
  baseOrders: ConferenceBaseOrder[],
  leadFranchiseId: string
): WaiverOrderEntry[] {
  if (baseOrders.length !== 2) {
    throw new Error(`Expected exactly 2 conferences, got ${baseOrders.length}`);
  }
  const [a, b] = baseOrders;
  if (a.franchiseIds.length !== b.franchiseIds.length) {
    throw new Error(
      `Conferences must be the same size — ${a.conference} has ${a.franchiseIds.length}, ` +
        `${b.conference} has ${b.franchiseIds.length}. Alternation would leave a tail of ` +
        `consecutive same-conference slots.`
    );
  }
  if (a.franchiseIds.length === 0) {
    throw new Error('Conference base orders are empty — refusing to build an empty waiver order');
  }
  if (a.conference === b.conference) {
    throw new Error(
      `Both base orders carry conference "${a.conference}" — one conference is missing. ` +
        `Alternating a conference with itself yields a full 24-slot order that looks valid ` +
        `and is semantically wrong.`
    );
  }

  const seen = new Set<string>();
  for (const id of [...a.franchiseIds, ...b.franchiseIds]) {
    if (seen.has(id)) throw new Error(`Franchise ${id} appears in more than one base-order slot`);
    seen.add(id);
  }
  if (!seen.has(leadFranchiseId)) {
    throw new Error(`Lead franchise ${leadFranchiseId} is not in either conference base order`);
  }

  const lead = a.franchiseIds.includes(leadFranchiseId) ? a : b;
  const follow = lead === a ? b : a;

  const order: WaiverOrderEntry[] = [];
  for (let i = 0; i < lead.franchiseIds.length; i++) {
    for (const conf of [lead, follow]) {
      order.push({
        position: order.length + 1,
        franchiseId: conf.franchiseIds[i],
        conference: conf.conference,
        conferenceBasePosition: i + 1,
      });
    }
  }
  return order;
}

/**
 * Which of the two readings of MFL's DATA spec to emit.
 *
 * MFL documents DATA as "the same as the contents of the `<franchises>`
 * element in the export league API". That is ambiguous: `salaries` documents
 * its payload WITH the `<salaries>` root, but "contents of" reads as the
 * `<franchise>` children alone. The 2026-08-31 live run sent 'wrapped' and MFL
 * accepted it while applying nothing, so neither reading is confirmed and the
 * caller tries both rather than guessing again.
 */
export type FranchisesXmlShape = 'wrapped' | 'bare';

/**
 * Serialize a waiver order as the `DATA` payload for
 * `import?TYPE=franchises`.
 *
 * ⚠️ The caller MUST send this with `OVERLAY=1`. MFL's franchises import
 * ERASES every field absent from the payload when OVERLAY is not set — this
 * XML carries only `id` and `waiverSortOrder`, so a non-overlay write would
 * blank every team name, logo, icon, abbreviation and division in the league.
 * `setAflWaiverOrderUrl()` is the only supported way to build the target URL.
 */
export function buildFranchisesWaiverXml(
  order: WaiverOrderEntry[],
  shape: FranchisesXmlShape = 'wrapped'
): string {
  const rows = order
    .map((e) => `  <franchise id="${xmlAttr(e.franchiseId)}" waiverSortOrder="${e.position}" />`)
    .join('\n');
  return shape === 'wrapped' ? `<franchises>\n${rows}\n</franchises>` : rows;
}

/**
 * Build the franchises-import URL, with `OVERLAY=1` welded on — see the
 * warning on {@link buildFranchisesWaiverXml} for why it is not a parameter.
 *
 * @param writeHost Bare MFL host for the league (e.g. 'www44.myfantasyleague.com').
 *                  Commissioner imports are rejected by api.myfantasyleague.com.
 */
export function setAflWaiverOrderUrl(writeHost: string, year: number, leagueId: string): string {
  const host = writeHost.replace(/^https?:\/\//, '');
  if (host.startsWith('api.')) {
    throw new Error(
      `Commissioner writes must target the league's own host, not ${host} — ` +
        `api.myfantasyleague.com rejects franchises imports.`
    );
  }
  return `https://${host}/${year}/import?TYPE=franchises&L=${leagueId}&OVERLAY=1`;
}

function xmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
