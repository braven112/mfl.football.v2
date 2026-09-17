/**
 * Guards the Front Office hub's player-modal + manage/watch-kebab wiring on
 * TheLeague's side (the AFL's own KeeperPlanner/AflKeeperPlannerPanel wiring
 * is covered in tests/afl-keeper-planner-features.test.ts).
 *
 * Both FreeAgentNeedsCard.astro and FrontOfficePanel.astro are ALSO
 * used by rosters.astro's `nextyear`/planner view, which does not mount
 * WatchListBridge — so the kebab is opt-in (`showActions`), defaulting off,
 * turned on only by the Front Office panel. Without the opt-in gate, a
 * kebab would render on rosters.astro too with no listener behind it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PANEL_SRC = readFileSync(
  'src/components/shared/front-office-hub/FrontOfficePanel.astro',
  'utf-8',
);
const CARD_SRC = readFileSync('src/components/theleague/FreeAgentNeedsCard.astro', 'utf-8');
const ROUTE_SRC = readFileSync('src/pages/theleague/front-office/index.astro', 'utf-8');

describe('TheLeaguePlannerPanel mounts the player modal + watch bridge once', () => {
  it('mounts PlayerDetailsModal and WatchListBridge with the league\'s own claim verb', () => {
    expect(PANEL_SRC).toMatch(/<PlayerDetailsModal hideContract=\{!contracts\} \/>/);
    // "TheLeague bids, the AFL claims — never normalize these." One panel
    // serves both, so the verb is chosen per league rather than hardcoded.
    expect(PANEL_SRC).toMatch(/claimVerb=\{claimVerb\}/);
    expect(PANEL_SRC).toMatch(/claimVerb =[\s\S]{0,80}?'Claim' : 'Bid'/);
  });

  it('turns showActions on for FreeAgentNeedsCard', () => {
    expect(PANEL_SRC).toMatch(/<FreeAgentNeedsCard[\s\S]*?showActions/);
  });

  it('threads signedIn from the route, derived from the viewer\'s own franchise, not the selected team', () => {
    // The panel derives it from the viewer's own franchise, which the route
    // resolves with isAuthorizedForLeague — both leagues have a franchise 0001.
    expect(ROUTE_SRC).toMatch(/isAuthorizedForLeague\(user, league\.id\)/);
    const PANEL_DATA = readFileSync('src/utils/front-office-panel-data.ts', 'utf-8');
    expect(PANEL_DATA).toMatch(/signedIn = !!viewerFranchiseId/);
  });
});

describe('FreeAgentNeedsCard renders a claimable kebab only when asked', () => {
  it('defaults showActions to false so rosters.astro is unaffected', () => {
    expect(CARD_SRC).toMatch(/showActions\s*=\s*false/);
  });

  it('renders the shared .pa-kebab with data-pa-claimable="true" (these are real free agents)', () => {
    expect(CARD_SRC).toMatch(/\{showActions && \(/);
    expect(CARD_SRC).toMatch(/class="pa-kebab"/);
    expect(CARD_SRC).toMatch(/data-pa-claimable="true"/);
    expect(CARD_SRC).toMatch(/data-pa-sub="Free agent"/);
  });
});
