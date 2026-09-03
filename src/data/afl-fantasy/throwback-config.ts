/**
 * AFL Throwback Week: the AFL's counterpart to
 * `src/data/theleague/throwback-config.ts`. Same two knobs — which eras are
 * excluded, and which era each franchise wears by default — over a much
 * deeper archive: 116 eras across 24 franchises going back to 2003, against
 * TheLeague's 42 back to 2007.
 *
 * Feature learnings live in docs/claude/insights/features/throwback-week.md.
 */

import {
  AFL_THROWBACK_WEEKS as WEEKS,
  isAflThrowbackWeek as isWeek,
} from './throwback-weeks.mjs';
import type { FranchiseHistoryEntry } from '../../utils/team-names';
import aflConfig from '../../../data/afl-fantasy/afl.config.json';

/**
 * NFL week numbers that trigger AFL throwback identity. Defined in
 * `throwback-weeks.mjs` and re-exported here for the same reason TheLeague's
 * config does it: node scripts need the list without a TypeScript loader.
 * Edit it in the league registry.
 */
export const AFL_THROWBACK_WEEKS_LIST: number[] = WEEKS;

/**
 * `{franchiseId, yearStart}` pairs excluded from AFL throwback eligibility.
 *
 * The AFL has passed names and art between franchises for twenty years, so
 * this list is three times TheLeague's and every entry is a commissioner call
 * (September 2026). Two rules produced it, in this order:
 *
 * 1. **A live franchise's CURRENT identity is not available to anyone else.**
 *    Five eras resolve to art another franchise is wearing right now — the
 *    throwback would put two Chatmasters (or two Da Dangsters) on the same
 *    scoreboard, one of them a team that is actually playing that week. Same
 *    call as TheLeague's Midwestside Connection exclusion.
 * 2. **A name two franchises both held goes to the longer tenure.** Five
 *    historic names are claimed twice; the franchise that wore it more
 *    seasons keeps it.
 *
 * The Vandalizers was a genuine coin flip — Ditka 2004 and Avenging Amish
 * 2003 held it one year each — and went to the Amish on the earlier claim.
 */
export const AFL_THROWBACK_ASSET_CONFLICTS: { franchiseId: string; yearStart: number }[] = [
  // Rule 1 — the identity belongs to a currently active franchise.
  { franchiseId: '0004', yearStart: 2005 }, // Muck Juggling Micks — franchise 0013 wears it now
  { franchiseId: '0007', yearStart: 2004 }, // Chatmaster — franchise 0021 wears it now
  { franchiseId: '0016', yearStart: 2017 }, // Dicks out for Harambe — franchise 0008 wears it now
  { franchiseId: '0018', yearStart: 2014 }, // Computer Jocks — franchise 0005 wears it now
  { franchiseId: '0021', yearStart: 2003 }, // Da Dangsters — franchise 0006 wears it now
  // Rule 2 — shared historic name, awarded to the longer tenure.
  { franchiseId: '0004', yearStart: 2004 }, // The Vandalizers → Avenging Amish (1yr each; earlier claim wins)
  { franchiseId: '0016', yearStart: 2016 }, // CSKA Sofia → Get off my Ditka (2yr vs 1yr)
  { franchiseId: '0006', yearStart: 2004 }, // Taco Hell → Titsburgh Feelers (2yr vs 1yr)
  { franchiseId: '0006', yearStart: 2005 }, // The Street → No Soup For You (4yr vs 3yr)
  { franchiseId: '0012', yearStart: 2007 }, // Blitzkrieg → Titsburgh Feelers (5yr vs 1yr; shared art file too)
];

/**
 * Commissioner-picked starting default per franchise (`franchiseId` -> history
 * entry `yearStart`).
 *
 * Seeded with the LONGEST-RUNNING eligible era, never a punitive last-place
 * rebrand (commissioner call, September 2026). The rule and the reasoning live
 * in `pickDefaultThrowbackEra` — this map only records what that rule produced,
 * so an entry here can be hand-edited to overrule it for any franchise except
 * onto a rebrand, which the resolver skips on purpose.
 *
 * It replaced a "most recent look that differs from today's" heuristic that
 * had picked four shame names outright — a last-place rename is by
 * construction both recent and visually distinct, so that heuristic sought
 * them out. Tenure asks a better question: the identity a franchise wore for
 * seventeen seasons is the one the league remembers.
 *
 * Owners self-serve an override at /afl-fantasy/throwback-settings, and both
 * disqualified kinds stay selectable there — a rebrand era, and an era
 * BORROWED from the same owner's franchise in TheLeague. Wearing either is a
 * choice an owner may make, just not one the site makes for them; every
 * default below is an era the franchise wore in THIS league.
 *
 * Franchises 0002 and 0010 are here at all only because their art was
 * recovered from MFL's own `fflnetdynamic` hosting in September 2026; they
 * never changed their NAME, so their `history[]` was empty and they were the
 * only AFL teams that could not throw back.
 */
export const AFL_DEFAULT_THROWBACK_ERA: Record<string, number> = {
  '0001': 2006, // Smokane FC → Smokane FC (The gas mask) — 13 seasons
  '0002': 2003, // Drunk Indians → Drunk Indians (The original Wahoo) — 14 seasons
  '0003': 2013, // Team Minty Fresh → Team Minty Fresh (The mint leaf) — 12 seasons
  '0004': 2019, // Get off my Ditka → Maga Nation — commissioner pick over the
                //   tenure rule, which would say 2012 (The Dude that Abides, 5).
  '0005': 2010, // Computer Jocks → booyakasha — 5 seasons
  '0006': 2013, // Da Dangsters → Da Dangsters (The tommy gun) — 12 seasons
  '0007': 2010, // Avenging Amish → Touchdown My Pants — 4 seasons
  '0008': 2003, // Dicks out for Harambe → The Nukes — 13 seasons
  '0009': 2010, // Vitside Mafia → Vitside Mafia (The old lockup) — 15 seasons
  '0010': 2005, // Fullybaked → Fullybaked (Red graffiti) — 12 seasons
  '0011': 2010, // Midwestside Connection → Midwestside Connection (The gold lockup) — 15 seasons
  '0012': 2009, // Suh girls, one cup → Pubes — 10 seasons
  '0013': 2010, // Muck Juggling Micks → Delirium Tremens — 10 seasons
  '0014': 2007, // A Bruin Pegs Me → Thundering Herd — 19 seasons
  '0015': 2003, // The Mariachi Ninjas → The Blunt Bros. — 8 seasons
  '0016': 2009, // Swiftie 4 Life → Brady's Bastards — 5 seasons
  '0017': 2008, // Titsburgh Feelers → Blitzkrieg — 5 seasons
  '0018': 2009, // Jewpacabra → Zephyr — 5 seasons
  '0019': 2011, // Badd Boys → Cliffside Killer Clowns — 4 seasons
  '0020': 2008, // The Boondock Saints → The Boondock Saints (The brothers) — 8 seasons
  '0021': 2010, // Chatmaster → Chatmaster (The AIM lockup) — 15 seasons
  '0022': 2005, // Balls Deep → Way More Funner — 7 seasons
  '0023': 2019, // The Show → No Frills (The clean wordmark) — commissioner pick
                //   over the tenure rule, which would say 2005 (14 seasons).
  '0024': 2019, // No Soup For You → No Soup For You (The Soup Nazi) — 6 seasons
};

export const isAflThrowbackWeek: (week: number) => boolean = isWeek;

/**
 * The Throwback Rebrand.
 *
 * Finishing last in the AFL gets you renamed for the season. This carries
 * that into Throwback Week: the franchise currently serving its punishment
 * does not throw back to its own history at all — it wears a shame name
 * borrowed from someone ELSE's, chosen by the commissioner each year.
 *
 * 2026: A Bruin Pegs Me (0014) wears Jewpacabra's 2019 "Jesus Killers".
 *
 * Three consequences, all deliberate:
 *
 * - It OVERRIDES the owner's pick rather than seeding it. A rebrand is
 *   imposed, not chosen — the same reason this franchise does not get to
 *   pick its current name either. The settings page says so plainly instead
 *   of offering a picker whose result would never render.
 * - The SOURCE franchise loses the era while it is on loan. Two teams
 *   wearing one identity on a single scoreboard is precisely what
 *   `AFL_THROWBACK_ASSET_CONFLICTS` exists to prevent, and Jewpacabra can
 *   still pick any of its other five.
 * - It is NOT auto-expiring. A silent revert would be worse than a stale
 *   entry, so this stays until someone changes it and
 *   `tests/afl-throwback-identity.test.ts` fails the build if it stops
 *   pointing at the franchise that actually carries `currentRebrand`.
 */
export interface ThrowbackRebrandAssignment {
  /** Franchise serving the rebrand. Must be the one carrying `currentRebrand`. */
  franchiseId: string;
  /** Whose history the shame identity is borrowed from. */
  sourceFranchiseId: string;
  /** `yearStart` of that franchise's era. */
  yearStart: number;
}

export const AFL_THROWBACK_REBRAND: ThrowbackRebrandAssignment | null = {
  franchiseId: '0014', // A Bruin Pegs Me
  sourceFranchiseId: '0018', // Jewpacabra
  yearStart: 2019, // "Jesus Killers"
};

/**
 * The assignment's era, resolved from the config rather than restated here.
 *
 * Copying the name/art/colors inline would be a second source of truth that
 * drifts the moment the source era's art is retouched — and the whole point
 * is that this IS Jewpacabra's 2019 identity, not a lookalike.
 */
export const AFL_THROWBACK_REBRAND_ERA: FranchiseHistoryEntry | null = (() => {
  if (!AFL_THROWBACK_REBRAND) return null;
  const source = ((aflConfig as any).teams ?? []).find(
    (t: any) => t.franchiseId === AFL_THROWBACK_REBRAND!.sourceFranchiseId
  );
  return (
    (source?.history ?? []).find(
      (e: FranchiseHistoryEntry) => e.yearStart === AFL_THROWBACK_REBRAND!.yearStart
    ) ?? null
  );
})();
