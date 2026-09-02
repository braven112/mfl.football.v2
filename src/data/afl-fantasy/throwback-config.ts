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
 * entry `yearStart`). Seeded with TheLeague's rule — each team's MOST RECENT
 * era whose icon differs from today's — so teams throw back to their last old
 * look rather than everyone snapping to 2003. Owners self-serve an override
 * at /afl-fantasy/throwback-settings; hand-edit any of these.
 *
 * Two franchises are here at all only because their art was recovered from
 * MFL's own `fflnetdynamic` hosting in September 2026 — 0002 and 0010 never
 * changed their NAME, so their `history[]` was empty and they were the only
 * AFL teams that could not throw back.
 */
export const AFL_DEFAULT_THROWBACK_ERA: Record<string, number> = {
  '0001': 2003, // Smokane FC → Smokane (only prior era)
  '0002': 2003, // Drunk Indians → the original Wahoo mark; never renamed, so the BANNER is the tell
  '0003': 2011, // Team Minty Fresh → Level 3 Inception
  '0004': 2024, // Get off my Ditka → Can't get over the baby gate
  '0005': 2010, // Computer Jocks → booyakasha
  '0006': 2011, // Da Dangsters → Whitman's Wonders
  '0007': 2023, // Avenging Amish → Broke Back 'lil Half Dead's Brother
  '0008': 2016, // Dicks out for Harambe → Blowing My Horn
  '0009': 2003, // Vitside Mafia → Gamecocks (only prior era)
  '0010': 2005, // Fullybaked → the red-graffiti lockup (2003 Half Baked poster is the alt)
  '0011': 2009, // Midwestside Connection → The Dark Side
  '0012': 2009, // Suh girls, one cup → Pubes
  '0013': 2010, // Muck Juggling Micks → Delirium Tremens
  '0014': 2007, // A Bruin Pegs Me → Thundering Herd
  '0015': 2011, // The Mariachi Ninjas → Gaelic Rams
  '0016': 2022, // Swiftie 4 Life → Silver Bullets. NOT the seed's 2023 pick: that era is
                //   "Swifty 4 Life", a one-letter spelling variant of the current name, so
                //   it reads as a typo rather than a throwback. Silver Bullets is the most
                //   recent era that is actually a different identity.
  '0017': 2008, // Titsburgh Feelers → Blitzkrieg
  '0018': 2019, // Jewpacabra → Jesus Killers
  '0019': 2011, // Badd Boys → Cliffside Killer Clowns
  '0020': 2006, // The Boondock Saints → Limp Ditkas
  '0021': 2009, // Chatmaster → Tackling Dummies
  '0022': 2012, // Balls Deep → Sparta FC
  '0023': 2025, // The Show → Cock Gobbler
  '0024': 2016, // No Soup For You → BronxBommr
};

export const isAflThrowbackWeek: (week: number) => boolean = isWeek;
