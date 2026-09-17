/**
 * Guards the Front Office hub's SHARED analytics layer — the thing Phase A
 * of docs/plans/front-office-hub.md exists to create.
 *
 * The rule these pin is one rule: **one implementation per UI, both
 * leagues.** Before this, roster analytics existed three times (the AFL's
 * hub panel, and both `rosters.astro` files inline) and TheLeague's hub had
 * none. The failure mode is not that a chart breaks — it is that someone
 * adds a chart to one league by pasting markup, and the two drift.
 *
 * `rosters.astro`'s own inline copies are deliberately NOT covered here:
 * they are on their way out and pinning them would freeze code we intend to
 * delete. What is pinned is that the HUB never grows a second copy.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const ANALYTICS = readFileSync(
  'src/components/shared/front-office-hub/RosterAnalyticsPanel.astro',
  'utf-8',
);
const STACKS = readFileSync(
  'src/components/shared/front-office-hub/NflCollegeStacks.astro',
  'utf-8',
);
const CHIPS = readFileSync(
  'src/components/shared/front-office-hub/DraftAssetChips.astro',
  'utf-8',
);
// Phase B merged the two league panels into one. The rules these guards
// pin are unchanged; there is simply a single file carrying them now.
const PANEL = readFileSync(
  'src/components/shared/front-office-hub/FrontOfficePanel.astro',
  'utf-8',
);
const MODULE = readFileSync('src/utils/roster-analytics.ts', 'utf-8');
const TL_DATA = readFileSync('src/utils/front-office-planner-data.ts', 'utf-8');
// Same file; a second name because the Phase D blocks read it for different rules.
const PANEL_DATA_PLANNER = TL_DATA;
const KEEPER_DATA = readFileSync('src/utils/front-office-keeper-data.ts', 'utf-8');
const PANEL_DATA = readFileSync('src/utils/front-office-panel-data.ts', 'utf-8');
const TL_ROUTE = readFileSync('src/pages/theleague/front-office/index.astro', 'utf-8');
const AFL_ROUTE = readFileSync('src/pages/afl-fantasy/front-office/index.astro', 'utf-8');

describe('ONE panel serves both leagues', () => {
  it('neither route carries a league-specific panel', () => {
    // Phase B's whole point. Two panels rendering the same page shape is
    // how this repo grew 24 forked siblings; a new *Panel.astro beside this
    // one is the regression.
    expect(existsSync('src/components/shared/front-office-hub/TheLeaguePlannerPanel.astro')).toBe(false);
    expect(existsSync('src/components/shared/front-office-hub/AflKeeperPlannerPanel.astro')).toBe(false);
    expect(TL_ROUTE).toMatch(/<FrontOfficePanel\b/);
    expect(AFL_ROUTE).toMatch(/<FrontOfficePanel\b/);
  });

  it('the panel carries no chart markup of its own', () => {
    expect(PANEL).not.toMatch(/donut-chart/);
    expect(PANEL).not.toMatch(/strip-plot/);
    expect(PANEL).not.toMatch(/nfl-teams-grid/);
    expect(PANEL).toMatch(/<RosterAnalyticsPanel/);
    expect(PANEL).toMatch(/<NflCollegeStacks/);
  });

  it('branches on DATA PRESENCE and registry features, never on a league slug', () => {
    // `leagueSlug === 'theleague'` in here would hardcode which leagues have
    // a cap or keepers, so a third league would mean editing a component
    // instead of the registry. See CLAUDE.md "League registry".
    expect(PANEL).toMatch(/\{contracts && \(/);
    expect(PANEL).toMatch(/\{keepers && \(/);
    expect(PANEL).toMatch(/leagueHasFeature\(leagueSlug, 'keepers'\)/);

    // One documented exception: the claim verb. "TheLeague bids, the AFL
    // claims — never normalize these", so it cannot come from a feature flag.
    const slugCompares = [...PANEL.matchAll(/leagueSlug === '[a-z-]+'/g)].map((m) => m[0]);
    expect(slugCompares.length, `unexpected slug branch(es): ${slugCompares.join(', ')}`).toBe(1);
    expect(PANEL).toMatch(/claimVerb =[\s\S]{0,80}?leagueSlug === 'afl-fantasy'/);
  });
});

describe('the cap block is feature-gated in the DATA, not the component', () => {
  it('RosterAnalyticsPanel decides on the `cap` prop alone', () => {
    expect(ANALYTICS).not.toMatch(/'theleague'/);
    expect(ANALYTICS).not.toMatch(/'afl-fantasy'/);
    expect(ANALYTICS).toMatch(/\{cap && \(/);
  });

  it('the panel passes whatever the builder produced, without deciding', () => {
    expect(PANEL).toMatch(/cap=\{byTeam\[team\.id\]\?\.cap \?\? null\}/);
  });

  it('the builder splits on leagueHasFeature and the AFL yields no cap', () => {
    expect(PANEL_DATA).toMatch(/leagueHasFeature\(leagueSlug, 'contracts'\)/);
    expect(KEEPER_DATA).toMatch(/cap: null/);
  });
});

describe("the AFL keeper board is owner-private, not merely un-actionable", () => {
  // Every other section is public roster data, so the switcher shows any
  // team read-only. A keeper plan is a private strategic scratchpad and
  // /api/afl-keepers enforces owner-only read -- rendering another owner's
  // board would draw an empty planner backed by a 403.
  it('the builder returns keepers only for the viewer\'s own team', () => {
    expect(PANEL_DATA).toMatch(/keepers: isOwnTeam \? afl\.keepers : null/);
    expect(KEEPER_DATA).toMatch(/if \(isOwnTeam\)/);
  });

  it('the API this relies on really is owner-only', () => {
    // If this ever becomes a public read, the privacy argument above is void
    // and the switcher should show the board like everything else.
    const api = readFileSync('src/pages/api/afl-keepers.ts', 'utf-8');
    expect(api).toMatch(/owners can only read\/write their own/i);
  });

  it('the panel explains the absence instead of rendering nothing', () => {
    expect(PANEL).toMatch(/\{!keepers && leagueHasFeature\(leagueSlug, 'keepers'\)/);
    expect(PANEL).toMatch(/private to each team owner/);
    expect(PANEL).toMatch(/Switch back to your team/);
  });

  it('TheLeague never prints a keeper section — it has no keepers', () => {
    expect(PANEL).toMatch(/leagueHasFeature\(leagueSlug, 'keepers'\)/);
  });
});

describe('roster-analytics.ts declares no cap formula of its own', () => {
  it('imports every cap computation from salary-calculations', () => {
    expect(MODULE).toMatch(/from '\.\/salary-calculations'/);
    expect(MODULE).toMatch(/calculateBucketCaps/);
    expect(MODULE).toMatch(/calculatePositionCaps/);
    expect(MODULE).toMatch(/calculateCapEfficiency/);
  });

  it('hardcodes no cap limit, escalation rate or roster limit', () => {
    // The limit arrives as a parameter precisely so this module cannot know
    // whose roster it is holding. A literal here is a second source of truth
    // for a number the Trade Builder and rosters.astro read from one place.
    const body = MODULE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(body).not.toMatch(/45[_,]?000[_,]?000/);
    expect(body).not.toMatch(/SALARY_CAP/);
    expect(body).not.toMatch(/1\.1\b/);
  });

  it('stays pure — no fs, no feed reads', () => {
    expect(MODULE).not.toMatch(/from 'node:fs'/);
    expect(MODULE).not.toMatch(/readFileSync/);
  });
});

describe('the hub renders analytics SERVER-SIDE, per team', () => {
  it("TheLeague precomputes every team's analytics, like it does teamMetrics", () => {
    expect(TL_DATA).toMatch(/teamAnalytics\[team\.id\] = \{/);
    expect(KEEPER_DATA).toMatch(/byTeam\[team\.id\] = \{/);
    expect(TL_DATA).toMatch(/buildRosterAnalytics\(/);
    expect(TL_DATA).toMatch(/buildCapAnalytics\(/);
  });

  it('the charts toggle by team attribute, the same idiom as FA needs', () => {
    expect(PANEL).toMatch(/data-analytics-team-id=\{team\.id\}/);
    expect(PANEL).toMatch(/togglePanels\('\[data-analytics-team-id\]'/);
  });

  it('the STACKS render for the selected team only, and say why', () => {
    // 16 teams of stacks measured 1.45 MB raw / 133 KB gzipped — a doubling
    // of the page to pre-paint fifteen teams nobody is looking at. If this
    // ever moves back inside the per-team loop, the page doubles again.
    expect(PANEL).not.toMatch(/teamsList\.map[\s\S]{0,600}?<NflCollegeStacks/);
    expect(PANEL).toMatch(/fo-stacks-host/);
    expect(PANEL).toMatch(/fo-stacks-link/);
    // The builder hands over the selected team's groups and no others.
    expect(PANEL_DATA).toMatch(/playersByNflTeam: selected\?\.playersByNflTeam/);
  });
});

describe('DraftAssetChips replaced the two draft ChartCards', () => {
  it('the hub no longer renders DraftTeamAssetsView or DraftPicksCard', () => {
    expect(PANEL).not.toMatch(/<DraftTeamAssetsView/);
    expect(PANEL).not.toMatch(/<DraftPicksCard/);
    expect(PANEL).toMatch(/<DraftAssetChips/);
  });

  it('both draft years land in ONE card, as year groups', () => {
    // The class, not the word — the CSS comment recording its removal is
    // allowed to name it.
    expect(PANEL).not.toMatch(/class="draft-cards-grid"/);
    expect(PANEL).not.toMatch(/^\s*\.draft-cards-grid\s*\{/m);
    expect(CHIPS).toMatch(/groups: DraftAssetGroup\[\]/);
    expect(CHIPS).toMatch(/showYearHeadings/);
  });

  it('the trade-chain reveal is accessible, not a title attribute', () => {
    // A `title` never appears on touch and screen-reader support for it is
    // inconsistent — the reason this is a button with aria-expanded and a
    // described-by sibling, revealed on hover AND focus AND tap.
    expect(CHIPS).toMatch(/aria-expanded="false"/);
    expect(CHIPS).toMatch(/aria-describedby=\{chainId\}/);
    expect(CHIPS).toMatch(/:focus-visible ~ \.fo-picks__chain/);
    expect(CHIPS).toMatch(/aria-expanded='true'\] ~ \.fo-picks__chain/);
    expect(CHIPS).not.toMatch(/title=\{chip\.chain\}/);
  });

  it('a pick with no chain is not a button', () => {
    // A button that does nothing is worse than no button: it takes focus,
    // announces as interactive, and rewards a tap with silence.
    expect(CHIPS).toMatch(/chip\.chain \? \(/);
    expect(CHIPS).toMatch(/<span class="fo-picks__face">/);
  });
});

describe('client scripts survive a ClientRouter navigation', () => {
  it('the stacks re-arm off an element flag, never a module variable', () => {
    expect(STACKS).toMatch(/el\.dataset\.modalInit/);
    expect(STACKS).toMatch(/astro:page-load/);
  });

  it("the chips' document listener is removed before it is re-added", () => {
    // A `document` listener survives every swap, so re-running init without
    // removing the previous handler stacks a second and third copy of it.
    expect(CHIPS).toMatch(/document\.removeEventListener\('click', chainHandler\)/);
    expect(CHIPS).toMatch(/astro:page-load/);
  });
});

describe('the routes stay thin wrappers', () => {
  // Under 80 lines keeps them off tests/fixtures/page-fork-baseline.json,
  // and under 75 keeps them out of the empty band that test defends. Logic
  // that grows here belongs in FrontOfficePanel or the data builder.
  it('both front-office routes are well under the fork threshold', () => {
    for (const [name, src] of [['theleague', TL_ROUTE], ['afl-fantasy', AFL_ROUTE]] as const) {
      const lines = src.split('\n').length;
      expect(lines, `${name}/front-office/index.astro is ${lines} lines`).toBeLessThan(75);
    }
  });

  it('each route owns its own auth gate and cookie write, and nothing else', () => {
    for (const src of [TL_ROUTE, AFL_ROUTE]) {
      expect(src).toMatch(/isAuthorizedForLeague/);
      expect(src).toMatch(/buildFrontOfficePanelData\(/);
    }
    // A component writing Astro.cookies runs after the headers are committed
    // and throws, blanking the page.
    expect(TL_ROUTE).toMatch(/setTheLeaguePreference\(Astro\.cookies/);
    expect(AFL_ROUTE).toMatch(/rememberAflTeamChoice\(Astro\.cookies/);
  });

  it('the AFL resolves its own team last, behind an explicit choice', () => {
    // param > cookie > your team > first team. Passing the viewer's
    // franchise as `defaultTeam` is what puts it in that slot.
    expect(AFL_ROUTE).toMatch(/defaultTeam: myFranchiseId/);
  });
});

describe("the panel's client script survives a cross-league swap", () => {
  it('gates on a data-league node the swap replaces, not a captured value', () => {
    // Both leagues render the same element ids here and a cross-league
    // navigation is same-origin (the nav's league switcher emits a relative
    // href), so it is a swap, not a fresh document.
    expect(PANEL).toMatch(/data-league=\{leagueSlug\}/);
    expect(PANEL).toMatch(/querySelector<HTMLElement>\('\.fo-planner\[data-league\]'\)/);
    expect(PANEL).toMatch(/astro:page-load/);
  });

  it('removes its document listener before re-adding it', () => {
    // A `document` listener survives every swap; re-running init without
    // removing the old handler stacks a second and third copy.
    expect(PANEL).toMatch(/document\.removeEventListener\('fo:team-change', currentHandler\)/);
  });

  it('walks whatever metric tiles the server sent, rather than naming ids', () => {
    // TheLeague's tiles are cap-shaped and the AFL's roster-shaped. A script
    // that hardcodes `fo-metric-cap` silently no-ops on the other league.
    expect(PANEL).toMatch(/for \(const m of metrics\)/);
    expect(PANEL).not.toMatch(/setText\('fo-metric-cap'/);
  });
});

describe('Phase D — the hub can act, but only where the server will let it', () => {
  const ACTIONS = readFileSync('src/components/shared/front-office-hub/FrontOfficeActions.astro', 'utf-8');
  const CUTS = readFileSync('src/components/shared/front-office-hub/CutCandidatesCard.astro', 'utf-8');

  it('every write affordance is gated on canAct', () => {
    // /api/cut-player authenticates with the viewer's own MFL cookie and
    // verifies they roster the player; /api/contracts/declare checks
    // isFranchiseOwner. Rendering either for someone else's team offers a
    // button the server is going to refuse.
    expect(PANEL).toMatch(/\{contracts && canAct && \(\s*<FrontOfficeActions/);
    expect(PANEL).toMatch(/\{contracts && canAct && \(\s*<div class="planner-section planner-section--cuts"/);
    expect(PANEL).toMatch(/showActions=\{canAct\}/);
    expect(PANEL_DATA).toMatch(/canAct: isOwnTeam/);
    // The AFL has no contracts or cap, so no declare/cut surface at all.
    expect(PANEL_DATA).toMatch(/canAct: false/);
  });

  it('the candidate cards default showActions OFF so rosters.astro is unaffected', () => {
    // That page has its own Contract Decision Modal flow and its own bulk
    // submit; a second button wired to neither would be live and wrong.
    for (const f of [
      'src/components/theleague/VeteranExtensionCandidates.astro',
      'src/components/theleague/FranchiseOptions.astro',
    ]) {
      expect(readFileSync(f, 'utf-8')).toMatch(/showActions = false/);
    }
    const ROSTERS = readFileSync('src/pages/theleague/rosters.astro', 'utf-8');
    expect(ROSTERS).not.toMatch(/<FranchiseOptions[\s\S]{0,300}?showActions/);
    expect(ROSTERS).not.toMatch(/<VeteranExtensionCandidates[\s\S]{0,300}?showActions/);
  });

  it('both render paths of each card carry the button, not just the SSR one', () => {
    // These cards re-render themselves in JS on every team switch. A button
    // added only to the Astro pass disappears the first time you switch.
    for (const f of [
      'src/components/theleague/VeteranExtensionCandidates.astro',
      'src/components/theleague/FranchiseOptions.astro',
    ]) {
      const src = readFileSync(f, 'utf-8');
      expect(src).toMatch(/\{showActions && \(/); // Astro pass
      expect(src).toMatch(/\$\{showActions \? `<td/); // client re-render
      // …and the client pass reads the flag off the DOM each time rather
      // than capturing it, because ClientRouter keeps one module instance.
      expect(src).toMatch(/dataset\.showActions === 'true'/);
    }
  });

  it('confirms in place rather than with a native dialog', () => {
    // A native confirm() cannot show the cap consequence, which is the
    // whole point of confirming. Same inline swap front-office/contracts
    // already uses.
    // Strip comments first — the block above legitimately NAMES confirm().
    const code = ACTIONS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(code).not.toMatch(/\bwindow\.confirm\(/);
    expect(code).not.toMatch(/[^.\w]confirm\(/);
    expect(ACTIONS).toMatch(/confirmInPlace/);
    expect(ACTIONS).toMatch(/fo-confirm__yes/);
  });

  it('a cut names the dead money it leaves behind', () => {
    // Unlike a declaration, a cut writes to MFL immediately with no
    // approval step. The confirm has to state the cost, not just ask.
    expect(ACTIONS).toMatch(/Cut · \$\{formatSalaryCompact\(dead\)\} dead|Cut · \$\{formatSalaryCompact/);
    expect(CUTS).toMatch(/cannot be undone/i);
  });

  it('the cut card reaches the whole roster, not just obvious candidates', () => {
    // "Action cards only" was the call, but a card that lists only the
    // obvious candidates cannot cut a player it does not surface.
    expect(CUTS).toMatch(/players: CutCandidate\[\]/);
    expect(CUTS).toMatch(/data-cuts-expand/);
    expect(PANEL_DATA_PLANNER).toMatch(/cutCandidates: allPlayers\.filter\(\(p\) => p\.franchiseId === selectedTeamId\)/);
  });

  it('surfaces a negative cut differently from a positive one', () => {
    // Cutting an expensive long deal costs more than it saves. If that read
    // the same as a cut that helps, the card would actively mislead.
    expect(CUTS).toMatch(/fo-cuts__net--negative/);
    expect(CUTS).toMatch(/netSaved: p\.salary - penalty\.totalPenalty/);
  });

  it('prices and files through the shared core, never its own formula', () => {
    expect(ACTIONS).toMatch(/from '\.\.\/\.\.\/\.\.\/utils\/contract-actions-client'/);
    expect(ACTIONS).toMatch(/submitDeclaration\(/);
    expect(ACTIONS).toMatch(/toDeclarationRequest\(/);
    expect(ACTIONS).not.toMatch(/\* 1\.2\b/);
    expect(CUTS).toMatch(/from '\.\.\/\.\.\/\.\.\/utils\/salary-calculations'/);
  });

  it('surfaces the API\'s own error rather than a generic one', () => {
    expect(ACTIONS).toMatch(/err instanceof Error \? err\.message/);
  });

  it('treats a 409 cut as done, not as a failure to retry', () => {
    // 409 = already off the roster on MFL. The desired end state is true.
    expect(ACTIONS).toMatch(/res\.status !== 409/);
  });
});

describe('the hub feeds its candidate cards real points', () => {
  // Every player on the hub read points: 0 before this — the salary file a
  // cron writes reads zero between the league rollover and the first scored
  // week, and the builder had no fallback. The extension and franchise-tag
  // cards pick candidates by rank OR points, so the two cards the declare
  // buttons hang off were ranking arbitrarily.
  it('falls back to the prior season when the whole league reads zero', () => {
    expect(PANEL_DATA_PLANNER).toMatch(/priorPointsById/);
    expect(PANEL_DATA_PLANNER).toMatch(/seasonRows\.every\(\(p\) => \(Number\(p\?\.points\) \|\| 0\) === 0\)/);
  });

  it('patches the SOURCE rows so the cards and the cap chart agree', () => {
    // The cards read allPlayers; the cap-efficiency chart reads
    // seasonData.teams. Patching one would have them disagreeing on one page.
    expect(PANEL_DATA_PLANNER).toMatch(/const seasonRows: any\[\] = Object\.values\(seasonData\.teams/);
  });

  it('never overwrites a single player\'s real zero', () => {
    // One player with no points is a fact about that player.
    expect(PANEL_DATA_PLANNER).toMatch(/priorPointsById\.size > 0 && seasonRows\.every/);
  });
});
