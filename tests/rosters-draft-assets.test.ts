/**
 * The roster page's draft cards (src/utils/rosters/draft-assets.ts).
 *
 * Extracted in Phase 7 from ~95 lines of frontmatter that nothing could test:
 * it read four feeds through `import.meta.glob` and mutated five `let`s, all
 * inside a 10k-line page. The feeds stay in the page (glob specifiers must be
 * literal and relative to the file); the derivation is now a pure function,
 * which is what makes these cases reachable at all.
 *
 * Every assertion is a rule the cards depend on:
 *
 * - Real MFL draft results BEAT transaction-derived ones. The fallback can
 *   miscalculate pick positions, so it must never win when real data exists.
 * - The viewed club is always in the asset list, even owning no picks — a
 *   club that traded everything away otherwise opens someone else's card.
 * - No standings means no cards, not a crash: that is every day between the
 *   final and MFL publishing the next season's feed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calculateDraftOrder = vi.fn();
const buildActualDraftPicks = vi.fn();
const convertActualPicksToPredictions = vi.fn();
const extractToiletBowlWinners = vi.fn();
const extractLeagueChampion = vi.fn();
const convertAssetsToPredictions = vi.fn();
const isValidAssetsData = vi.fn();
const extractAssetsFromTransactions = vi.fn();

vi.mock('../src/utils/draft-utils', () => ({
  calculateDraftOrder: (...a: unknown[]) => calculateDraftOrder(...a),
  buildActualDraftPicks: (...a: unknown[]) => buildActualDraftPicks(...a),
  convertActualPicksToPredictions: (...a: unknown[]) => convertActualPicksToPredictions(...a),
}));
vi.mock('../src/utils/toilet-bowl-utils', () => ({
  extractToiletBowlWinners: (...a: unknown[]) => extractToiletBowlWinners(...a),
  extractLeagueChampion: (...a: unknown[]) => extractLeagueChampion(...a),
}));
vi.mock('../src/utils/assets-utils', () => ({
  convertAssetsToPredictions: (...a: unknown[]) => convertAssetsToPredictions(...a),
  isValidAssetsData: (...a: unknown[]) => isValidAssetsData(...a),
  extractAssetsFromTransactions: (...a: unknown[]) => extractAssetsFromTransactions(...a),
}));

const { buildDraftAssets } = await import('../src/utils/rosters/draft-assets');

const TEAMS = [
  { id: '0001', name: 'Pacific Pigskins', icon: '/a.png', banner: '/a-b.png' },
  { id: '0002', name: 'Bring the Pain', icon: '/b.png', banner: '/b-b.png' },
];
const STANDINGS = { leagueStandings: { franchise: [{ id: '0001' }, { id: '0002' }] } };

const input = (over: Record<string, unknown> = {}) => ({
  teams: TEAMS,
  standingsData: STANDINGS,
  bracketData: { playoffBracket: {} },
  draftResultsData: null,
  transactionsData: null,
  draftNextYear: 2027,
  defaultTeamId: '0001',
  includeFollowingYear: false,
  ...over,
});

beforeEach(() => {
  for (const fn of [
    calculateDraftOrder, buildActualDraftPicks, convertActualPicksToPredictions,
    extractToiletBowlWinners, extractLeagueChampion, convertAssetsToPredictions,
    isValidAssetsData, extractAssetsFromTransactions,
  ]) fn.mockReset();

  calculateDraftOrder.mockReturnValue([{ franchiseId: '0002', overallPick: 1 }]);
  extractToiletBowlWinners.mockReturnValue([{ franchiseId: '0002' }]);
  extractLeagueChampion.mockReturnValue('0001');
  buildActualDraftPicks.mockReturnValue([]);
  convertActualPicksToPredictions.mockReturnValue([]);
  isValidAssetsData.mockReturnValue(true);
  extractAssetsFromTransactions.mockReturnValue({ franchises: [] });
  convertAssetsToPredictions.mockReturnValue([]);
});

describe('which source the picks come from', () => {
  it('prefers real MFL draft results over anything derived from transactions', () => {
    buildActualDraftPicks.mockReturnValue([{ overallPickNumber: 1, currentFranchiseId: '0002' }]);
    convertActualPicksToPredictions.mockReturnValue([{ franchiseId: '0002' }]);

    const out = buildDraftAssets(input({ draftResultsData: { draftResults: {} }, transactionsData: { transactions: {} } }));

    expect(convertActualPicksToPredictions).toHaveBeenCalled();
    // The fallback can get pick POSITIONS wrong; with real results present it
    // must not run at all.
    expect(extractAssetsFromTransactions).not.toHaveBeenCalled();
    expect(out.assetsPredictions).toEqual([{ franchiseId: '0002' }]);
  });

  it('falls back to transactions only while MFL has published no results', () => {
    convertAssetsToPredictions.mockReturnValue([{ franchiseId: '0002' }]);

    const out = buildDraftAssets(input({ transactionsData: { transactions: {} } }));

    expect(extractAssetsFromTransactions).toHaveBeenCalledWith(
      { transactions: {} }, STANDINGS, 2027, [{ franchiseId: '0002', overallPick: 1 }],
    );
    expect(out.assetsPredictions).toEqual([{ franchiseId: '0002' }]);
  });

  it('keeps the fallback out when the derived data does not validate', () => {
    isValidAssetsData.mockReturnValue(false);
    const out = buildDraftAssets(input({ transactionsData: { transactions: {} } }));
    expect(convertAssetsToPredictions).not.toHaveBeenCalled();
    expect(out.assetsPredictions).toEqual([]);
  });
});

describe('the lists the cards render', () => {
  it('puts the viewed club in the asset list even when it owns no picks', () => {
    convertAssetsToPredictions.mockReturnValue([{ franchiseId: '0002' }]);
    const out = buildDraftAssets(input({ transactionsData: {}, defaultTeamId: '0001' }));
    // 0001 traded everything away; without this its owner opens 0002's card.
    expect(out.assetTeamIds).toEqual(['0001', '0002']);
  });

  it('does not duplicate the viewed club when it does own picks', () => {
    convertAssetsToPredictions.mockReturnValue([{ franchiseId: '0001' }, { franchiseId: '0001' }]);
    const out = buildDraftAssets(input({ transactionsData: {} }));
    expect(out.assetTeamIds).toEqual(['0001']);
  });

  it('asks for the year AFTER only when the planner wants both cards', () => {
    const off = buildDraftAssets(input({ transactionsData: {}, includeFollowingYear: false }));
    expect(off.followingYearPredictions).toEqual([]);
    expect(off.followingYearTeamIds).toEqual([]);
    expect(extractAssetsFromTransactions).toHaveBeenCalledTimes(1); // this year only

    extractAssetsFromTransactions.mockClear();
    buildDraftAssets(input({ transactionsData: {}, includeFollowingYear: true }));
    const years = extractAssetsFromTransactions.mock.calls.map((c) => c[2]);
    expect(years).toEqual([2027, 2028]);
  });
});

describe('the days there is nothing to draw', () => {
  it('returns empty lists when standings have not been published', () => {
    const out = buildDraftAssets(input({ standingsData: null, transactionsData: {} }));
    expect(out.draftPredictions).toEqual([]);
    expect(out.actualDraftPicks).toEqual([]);
    expect(out.toiletBowlWinners).toEqual([]);
    expect(calculateDraftOrder).not.toHaveBeenCalled();
    // The viewed club still leads the (empty) list, so the card has a tab.
    expect(out.assetTeamIds).toEqual(['0001']);
  });

  it('draws the order without a bracket — the special picks are optional', () => {
    const out = buildDraftAssets(input({ bracketData: null }));
    expect(extractToiletBowlWinners).not.toHaveBeenCalled();
    expect(out.toiletBowlWinners).toEqual([]);
    // No bracket means no champion to push to the last pick, not no order.
    expect(calculateDraftOrder).toHaveBeenCalledWith(expect.anything(), expect.anything(), '', []);
  });
});
