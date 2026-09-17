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
import { readFileSync } from 'node:fs';

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
const TL_PANEL = readFileSync(
  'src/components/shared/front-office-hub/TheLeaguePlannerPanel.astro',
  'utf-8',
);
const AFL_PANEL = readFileSync(
  'src/components/shared/front-office-hub/AflKeeperPlannerPanel.astro',
  'utf-8',
);
const MODULE = readFileSync('src/utils/roster-analytics.ts', 'utf-8');
const TL_DATA = readFileSync('src/utils/front-office-planner-data.ts', 'utf-8');

describe('both hub panels render the SAME analytics components', () => {
  it('neither panel carries its own chart markup', () => {
    for (const [name, src] of [['TheLeague', TL_PANEL], ['AFL', AFL_PANEL]] as const) {
      expect(src, `${name} panel re-inlined a donut`).not.toMatch(/donut-chart/);
      expect(src, `${name} panel re-inlined the strip plot`).not.toMatch(/strip-plot/);
      expect(src, `${name} panel re-inlined a stack card`).not.toMatch(/nfl-teams-grid/);
    }
  });

  it('both panels mount RosterAnalyticsPanel', () => {
    expect(TL_PANEL).toMatch(/<RosterAnalyticsPanel/);
    expect(AFL_PANEL).toMatch(/<RosterAnalyticsPanel/);
  });

  it('both panels mount NflCollegeStacks', () => {
    expect(TL_PANEL).toMatch(/<NflCollegeStacks/);
    expect(AFL_PANEL).toMatch(/<NflCollegeStacks/);
  });
});

describe('cap charts are feature-gated, not league-gated', () => {
  it('RosterAnalyticsPanel decides on the `cap` prop, never on a league slug', () => {
    // A slug compare here is the bug: it hardcodes which leagues have a cap,
    // so adding a third league means editing a component instead of the
    // registry. See CLAUDE.md "League registry — never hardcode league
    // constants".
    expect(ANALYTICS).not.toMatch(/'theleague'/);
    expect(ANALYTICS).not.toMatch(/'afl-fantasy'/);
    expect(ANALYTICS).toMatch(/\{cap && \(/);
  });

  it('the AFL passes no cap (salaryCap: false), TheLeague does', () => {
    expect(AFL_PANEL).not.toMatch(/<RosterAnalyticsPanel[\s\S]{0,300}?cap=/);
    expect(TL_PANEL).toMatch(/<RosterAnalyticsPanel[\s\S]{0,300}?cap=\{/);
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
    expect(TL_DATA).toMatch(/buildRosterAnalytics\(/);
    expect(TL_DATA).toMatch(/buildCapAnalytics\(/);
  });

  it('the charts toggle by team attribute, the same idiom as FA needs', () => {
    expect(TL_PANEL).toMatch(/data-analytics-team-id=\{team\.id\}/);
    expect(TL_PANEL).toMatch(/togglePanels\('\[data-analytics-team-id\]'/);
  });

  it('the STACKS render for the selected team only, and say why', () => {
    // 16 teams of stacks measured 1.45 MB raw / 133 KB gzipped — a doubling
    // of the page to pre-paint fifteen teams nobody is looking at. If this
    // ever moves back inside the per-team loop, the page doubles again.
    expect(TL_PANEL).toMatch(/<NflCollegeStacks[\s\S]{0,200}?teamAnalytics\[selectedTeamId\]/);
    expect(TL_PANEL).not.toMatch(/teamsList\.map[\s\S]{0,600}?<NflCollegeStacks/);
    expect(TL_PANEL).toMatch(/fo-stacks-host/);
    expect(TL_PANEL).toMatch(/fo-stacks-link/);
  });
});

describe('DraftAssetChips replaced the two draft ChartCards', () => {
  it('the hub no longer renders DraftTeamAssetsView or DraftPicksCard', () => {
    expect(TL_PANEL).not.toMatch(/<DraftTeamAssetsView/);
    expect(TL_PANEL).not.toMatch(/<DraftPicksCard/);
    expect(TL_PANEL).toMatch(/<DraftAssetChips/);
  });

  it('both draft years land in ONE card, as year groups', () => {
    // The class, not the word — the CSS comment recording its removal is
    // allowed to name it.
    expect(TL_PANEL).not.toMatch(/class="draft-cards-grid"/);
    expect(TL_PANEL).not.toMatch(/^\s*\.draft-cards-grid\s*\{/m);
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
