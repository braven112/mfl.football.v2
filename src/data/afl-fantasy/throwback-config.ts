/**
 * AFL Throwback Week: the AFL's counterpart to
 * `src/data/theleague/throwback-config.ts`. Same two knobs — which eras are
 * excluded, and which era each franchise wears by default — over a much
 * deeper archive: 99 eras across 24 franchises going back to 2003, against
 * TheLeague's 42 back to 2007.
 *
 * Feature learnings live in docs/claude/insights/features/throwback-week.md.
 */

import {
  AFL_THROWBACK_WEEKS as WEEKS,
  isAflThrowbackWeek as isWeek,
} from './throwback-weeks.mjs';

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
 * Owners self-serve an override at /afl-fantasy/throwback-settings, and a
 * rebrand era stays selectable there — wearing it is a choice an owner may
 * make, just not one the site makes for them.
 *
 * Franchises 0002 and 0010 are here at all only because their art was
 * recovered from MFL's own `fflnetdynamic` hosting in September 2026; they
 * never changed their NAME, so their `history[]` was empty and they were the
 * only AFL teams that could not throw back.
 */
export const AFL_DEFAULT_THROWBACK_ERA: Record<string, number> = {
  '0001': 2003, // Smokane FC → Smokane — 6 seasons
  '0002': 2003, // Drunk Indians → Drunk Indians (The original Wahoo) — 14 seasons
  '0003': 2003, // Team Minty Fresh → Marriedwithchildren — 8 seasons
  '0004': 2012, // Get off my Ditka → The Dude that Abides — 5 seasons
  '0005': 2010, // Computer Jocks → booyakasha — 5 seasons
  '0006': 2008, // Da Dangsters → More Cowbell — 3 seasons
  '0007': 2010, // Avenging Amish → Touchdown My Pants — 4 seasons
  '0008': 2003, // Dicks out for Harambe → The Nukes — 13 seasons
  '0009': 2003, // Vitside Mafia → Gamecocks — 7 seasons
  '0010': 2005, // Fullybaked → Fullybaked (Red graffiti) — 12 seasons
  '0011': 2005, // Midwestside Connection → The Rookies — 4 seasons
  '0012': 2009, // Suh girls, one cup → Pubes — 10 seasons
  '0013': 2010, // Muck Juggling Micks → Delirium Tremens — 10 seasons
  '0014': 2007, // A Bruin Pegs Me → Thundering Herd — 19 seasons
  '0015': 2003, // The Mariachi Ninjas → The Blunt Bros. — 8 seasons
  '0016': 2009, // Swiftie 4 Life → Brady's Bastards — 5 seasons
  '0017': 2008, // Titsburgh Feelers → Blitzkrieg — 5 seasons
  '0018': 2009, // Jewpacabra → Zephyr — 5 seasons
  '0019': 2005, // Badd Boys → The Bandwagon — 4 seasons
  '0020': 2003, // The Boondock Saints → Your Team Sucks — 3 seasons
  '0021': 2009, // Chatmaster → Tackling Dummies — 1 season
  '0022': 2005, // Balls Deep → Way More Funner — 7 seasons
  '0023': 2005, // The Show → No Frills — 17 seasons
  '0024': 2008, // No Soup For You → The Street — 4 seasons
};

export const isAflThrowbackWeek: (week: number) => boolean = isWeek;
