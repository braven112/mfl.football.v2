/**
 * AFL waiver-order construction.
 *
 * The AFL constitution (docs/claude/afl-rules.md, "Free Agents (Waivers)")
 * says: "Initial waiver order = base draft order from the previous season."
 *
 * THE BASE DRAFT ORDER IS PER-CONFERENCE, AND SO IS THE WAIVER ORDER. The AFL
 * drafts as two independent 12-team conferences (MFL runs them as separate
 * draft units, `CONFERENCE00` / `CONFERENCE01`), so "the base draft order" is
 * really TWO orders of 12 — reverse Week-13 standings with each conference
 * champion forced to that conference's last slot. It is the round-2+ order,
 * NOT round 1: the NIT bonus reshuffles round 1 only (see afl-draft-utils.ts).
 *
 * MFL's Custom Waiver Order page (`csetup?C=WAIVORD`) presents the two
 * conferences as SEPARATE sections, and serializes them into the single
 * `waiverSortOrder` field as one block after the other: American League 1-12,
 * National League 13-24. There is no way to interleave them, and no reason to
 * want to.
 *
 * WHY THE BLOCKING IS HARMLESS, which is the part that is easy to get wrong:
 * the AFL is a duplicate-player league scoped by conference
 * (`rostersPerPlayer: 1` with `playerLimitUnit: CONFERENCE`; `duplicatePlayers:
 * true` in the registry). The same NFL player can be rostered simultaneously by
 * one American and one National franchise, so teams in different conferences
 * NEVER contend for the same claim. Only a franchise's rank WITHIN its own
 * conference affects any real outcome.
 *
 * An earlier version of this file merged the two orders by strict alternation
 * to stop one conference sitting "systematically ahead" of the other. With
 * separate player pools that was never a real risk, and MFL's own page cannot
 * express it. Do not reintroduce it.
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
 * Serialize two conference base orders into MFL's single 1..N
 * `waiverSortOrder` space, one conference block after the other in conference
 * order ('00' American first, then '01' National) — the layout MFL's own
 * Custom Waiver Order page produces.
 *
 * @param baseOrders Exactly two conferences, each with the same team count.
 * @throws If the two conferences differ in size, carry the same conference
 *         code, or repeat a franchise. Each would silently produce a
 *         wrong-but-plausible order, and this value is read back against the
 *         live league.
 */
export function buildAflWaiverOrder(baseOrders: ConferenceBaseOrder[]): WaiverOrderEntry[] {
  if (baseOrders.length !== 2) {
    throw new Error(`Expected exactly 2 conferences, got ${baseOrders.length}`);
  }
  const [a, b] = baseOrders;
  if (a.conference === b.conference) {
    throw new Error(
      `Both base orders carry conference "${a.conference}" — one conference is missing.`
    );
  }
  if (a.franchiseIds.length !== b.franchiseIds.length) {
    throw new Error(
      `Conferences must be the same size — ${a.conference} has ${a.franchiseIds.length}, ` +
        `${b.conference} has ${b.franchiseIds.length}.`
    );
  }
  if (a.franchiseIds.length === 0) {
    throw new Error('Conference base orders are empty — refusing to build an empty waiver order');
  }
  const seen = new Set<string>();
  for (const id of [...a.franchiseIds, ...b.franchiseIds]) {
    if (seen.has(id)) throw new Error(`Franchise ${id} appears in more than one base-order slot`);
    seen.add(id);
  }

  const blocks = [...baseOrders].sort((x, y) => x.conference.localeCompare(y.conference));
  const order: WaiverOrderEntry[] = [];
  for (const block of blocks) {
    block.franchiseIds.forEach((franchiseId, i) => {
      order.push({
        position: order.length + 1,
        franchiseId,
        conference: block.conference,
        conferenceBasePosition: i + 1,
      });
    });
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

/** One conference's verdict when comparing the live order to the expected one. */
export interface ConferenceDriftResult {
  conference: string;
  /** Expected franchise ids, worst-first. */
  expected: string[];
  /** Live franchise ids for this conference, ordered by their MFL slot. */
  actual: string[];
  /** Franchises the live league had no slot for at all. */
  missing: string[];
  ok: boolean;
}

/**
 * Compare a computed waiver order against the live league, PER CONFERENCE.
 *
 * Rank within a conference is the only thing that affects an outcome in this
 * league (per-conference player pools — see the header), and comparing the flat
 * 1..N list would additionally break the moment MFL renumbers the blocks. So
 * the comparison is the relative order of each conference's own franchises.
 *
 * @param expected The full computed order.
 * @param liveSlot Franchise id → the `waiverSortOrder` MFL currently reports.
 */
export function compareAflWaiverOrder(
  expected: WaiverOrderEntry[],
  liveSlot: Map<string, number>
): ConferenceDriftResult[] {
  const conferences = [...new Set(expected.map((e) => e.conference))].sort();
  return conferences.map((conference) => {
    const want = expected.filter((e) => e.conference === conference).map((e) => e.franchiseId);
    const missing = want.filter((id) => !liveSlot.has(id));
    const present = want.filter((id) => liveSlot.has(id));
    // Ties would make the comparison order-dependent and hide a real problem;
    // fall back to franchise id so the result is at least deterministic.
    const actual = [...present].sort(
      (a, b) => liveSlot.get(a)! - liveSlot.get(b)! || a.localeCompare(b)
    );
    return {
      conference,
      expected: want,
      actual,
      missing,
      ok: missing.length === 0 && actual.join() === want.join(),
    };
  });
}
