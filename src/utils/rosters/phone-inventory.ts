/**
 * Where every roster-table column lives on a phone (docs/plans/rosters-mobile-layout.md,
 * rule 1: "Nothing is removed").
 *
 * Below 768px the roster table's header row is hidden and each row becomes a
 * card, so a column can quietly stop being visible. This map is the contract:
 * every desktop `<th data-column>` on both roster pages names its phone home,
 * and `tests/rosters-phone-inventory.test.ts` fails when a page grows a column
 * with no entry here (or an entry outlives its column). A key ending in `*` is
 * a family of generated columns (`year1`…`year5`, `trend-<week>`).
 *
 * Adding a column: put it on the card or in the player sheet first, then say
 * where here. "The sheet" is PlayerDetailsModal as the roster pages open it
 * (src/utils/rosters/phone-sheet.ts, afl-phone-sheet.ts).
 */

export type PhoneInventoryLeague = 'theleague' | 'afl-fantasy';

export const PHONE_HOMES: Readonly<Record<PhoneInventoryLeague, Readonly<Record<string, string>>>> = {
  theleague: {
    player: 'Card: avatar, name + badges (line 1), NFL logo + position (line 2)',
    actions: 'Hidden: the row opens the sheet, whose ⋮ Contract options menu is the same list',
    rank: 'GM card line 2, right (My Rank); sheet My Rank tile',
    years: 'GM card line 2 (Yrs chip, thru YY)',
    'year*': 'GM card line 1, right (this year); every year in the sheet’s Salary tab',
    oppRank: 'Coach card line 2 (coloured rank); sheet This week',
    opponent: 'Coach card line 2 (vs/@ + logo), its spread on line 3; sheet This week',
    ou: 'Coach card line 3; sheet This week',
    weather: 'Coach card line 3, first; sheet This week',
    oppAvg: 'Sheet This week',
    'trend-*': 'Sheet This week (Recent weeks)',
    avgRecent: 'Coach card line 3 (L3); sheet This week',
    totalSeason: 'Sheet This week (Season points)',
    avgSeason: 'Coach card line 3, right (avg); sheet This week',
    projected: 'Coach card line 1, right; sheet This week',
    'dm-year*': 'Dead money cards (the Cap Hits table, one card per charge)',
  },
  'afl-fantasy': {
    player: 'Card: avatar, name + badges (line 1), NFL logo + position (line 2)',
    actions: 'Hidden: the row opens the sheet, whose trade block and ⋮ Player options hand off to AFLActionModal',
    rank: 'Sheet My Rank tile',
    oppRank: 'Card line 2 (coloured rank); sheet This week',
    opponent: 'Card line 2 (vs/@ + logo); sheet This week',
    ou: 'Card line 3 (phone span); sheet This week',
    weather: 'Card line 3, first (phone span); sheet This week',
    oppAvg: 'Sheet This week',
    total: 'Sheet This week (Season points); sheet Summary tile',
    avg: 'Card line 3, right (avg); sheet This week',
    projected: 'Card line 1, right; sheet This week',
  },
};

/** The inventory key a column falls under, or null when it has none. */
export function phoneHomeKey(league: PhoneInventoryLeague, column: string): string | null {
  const homes = PHONE_HOMES[league];
  if (column in homes) return column;
  const family = Object.keys(homes).find((k) => k.endsWith('*') && column.startsWith(k.slice(0, -1)));
  return family ?? null;
}
