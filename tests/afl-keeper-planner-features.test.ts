/**
 * Guards the AFL Keeper Planner's decision-support additions: the age
 * filter, the My Rank sort toggle, the lineup-slot fit meter, and the
 * PPG/positional-finish/ADP-trend stat line on each card. Source-level
 * checks (like tests/afl-keeper-finalize-window.test.ts) plus a pure-data
 * test for the new stats util.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildKeeperPlannerStats } from '../src/utils/afl-keeper-planner-stats';

const SRC = readFileSync('src/components/afl-fantasy/KeeperPlanner.astro', 'utf-8');
const ROSTERS_SRC = readFileSync('src/pages/afl-fantasy/rosters.astro', 'utf-8');
const FRONT_OFFICE_DATA_SRC = readFileSync('src/utils/front-office-keeper-data.ts', 'utf-8');

describe('the age slider has real ages to filter on', () => {
  it('AFL rosters.astro derives age from birthdate, never the nonexistent raw feed field', () => {
    // MFL's players feed has no `age` field at all — only `birthdate`. A
    // bare `info?.age || 'N/A'` silently shipped 'N/A' for every player and
    // made the age slider a no-op. Both KeeperPlanner call sites must derive
    // it instead.
    expect(ROSTERS_SRC).toMatch(/age: String\(calculateAgeFromBirthdate\(info\?\.birthdate\) \?\? 'N\/A'\)/);
  });

  it('the Front Office panel data util derives age via the shared age-utils helper', () => {
    expect(FRONT_OFFICE_DATA_SRC).toMatch(/from '\.\/age-utils'/);
    expect(FRONT_OFFICE_DATA_SRC).toMatch(/age: String\(calculateAge\(p\.birthdate\) \?\? 'N\/A'\)/);
  });
});

describe('KeeperPlanner decision-support features', () => {
  it('age filter hides cards above the chosen threshold, cut pool AND keeper slots alike', () => {
    expect(SRC).toMatch(/data-age-filter/);
    expect(SRC).toMatch(/kp-card--filtered/);
    expect(SRC).toMatch(/kp-slot--age-filtered/);
    // The filter reads age off the card itself, not the (age-free) slot clone.
    expect(SRC).toMatch(/data-age=\{player\.age\}/);
    // A filtered keeper slot never loses its player from keeperIds — this is
    // a display-only class toggle, not a state mutation.
    expect(SRC).not.toMatch(/keeperIds\.splice[\s\S]{0,200}applyAgeFilter/);
  });

  it('kp-card and kp-slot can shrink below their content size, so a long name/stat-line never pushes the page sideways', () => {
    // Both are grid items (of .kp-cards / .kp-slots, each an auto-fill grid),
    // and a grid item's automatic min-width is its own min-content, not 0 —
    // true regardless of the min-width: 0 already set on .kp-card__player /
    // .kp-slot__player for their OWN flex sizing. .kp-card__stats is
    // deliberately flex-shrink: 0 (the stat-line/trend badge never
    // truncates), so without this on .kp-card itself, a real long name plus
    // that stats block was enough to blow the row past its grid track and
    // the whole page past the viewport — reproduced and confirmed fixed live
    // via Playwright, since jsdom doesn't lay out flex/grid.
    const kpCard = SRC.match(/\.kp-card\s*\{[\s\S]*?\}/)?.[0] ?? '';
    const kpSlot = SRC.match(/\.kp-slot\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(kpCard).toMatch(/min-width:\s*0/);
    expect(kpSlot).toMatch(/min-width:\s*0/);
  });

  it('re-applies the age filter whenever renderSlots rebuilds slot DOM, not just on slider input', () => {
    // renderSlots() replaces every slot's innerHTML on each call (drag,
    // load, reset), which would silently wipe a previously-applied
    // kp-slot--age-filtered class if the filter weren't re-run afterward.
    const renderSlots = SRC.match(/function renderSlots\(\)[\s\S]*?\n {4}\}/)?.[0] ?? '';
    expect(renderSlots).toMatch(/applyAgeFilter\(\);/);
  });

  it('sort-by-My-Rank uses the shared composite lookup, scoped automatically', () => {
    expect(SRC).toMatch(/from '\.\.\/\.\.\/utils\/rankings-lookup'/);
    expect(SRC).toMatch(/buildRankingLookup\(\)/);
    expect(SRC).toMatch(/COMPOSITE_IMPORT_ID/);
    // Falls back to the server-rendered position/name order when there's no
    // composite yet — never leaves the list empty or unsorted-looking.
    expect(SRC).toMatch(/initialOrderIds/);
  });

  it('the rankings-change subscription is torn down before re-subscribing, not stacked', () => {
    // Same shape as kpKeydownBound: a module-scoped handle that gets
    // replaced, not left to accumulate across ClientRouter navigations.
    expect(SRC).toMatch(/unsubscribeRankingsListener\?\.\(\);/);
    expect(SRC).toMatch(/unsubscribeRankingsListener = onRankingsChanged/);
  });

  it('the lineup-slot meter is driven by the shared LINEUP_SLOTS constants, not re-typed numbers', () => {
    expect(SRC).toMatch(/from '\.\.\/\.\.\/utils\/afl-keeper-analysis'/);
    expect(SRC).toMatch(/LINEUP_SLOTS\[group\]/);
    expect(SRC).toMatch(/BENCH_CREDIT\[group\]/);
    expect(SRC).toMatch(/slotGroupFor\(/);
  });

  it('the lineup meter updates on every keeper move, not just on load', () => {
    const updateCounters = SRC.match(/function updateCounters\(\)[\s\S]*?\n {4}\}/)?.[0] ?? '';
    expect(updateCounters).toMatch(/updateLineupMeter\(\);/);
  });

  it('renders a stat line and ADP trend badge per card, without touching the finalize/cut flow', () => {
    expect(SRC).toMatch(/kp-card__stat-line/);
    expect(SRC).toMatch(/kp-card__trend/);
    expect(SRC).toMatch(/positionalFinish/);
    // The cut payload still keys off playerId/year alone — a stat that's
    // missing for a historical year (no ADP feed, say) must never change
    // who gets cut.
    expect(SRC).toMatch(/body: JSON\.stringify\(\{ playerId: id, year: year > 0 \? year : undefined \}\)/);
  });
});

describe('the Planner view carries its own copy of the roster analytics', () => {
  // rosters.astro is duplicating (not extracting) the Analytics view's
  // 4-card grid below the Planner's player list, ahead of the Roster/
  // Analytics tabs eventually going away — see the Planner view's own
  // comment. NFL/College Analysis come along too but de-emphasized behind
  // a closed <details>, since they're "just for fun" next to age/position.
  const plannerViewSrc =
    ROSTERS_SRC.match(/<section class="view-container" data-view-content="planner"[\s\S]*/)?.[0] ?? '';

  it('renders the 4-card analytics grid inside the owner branch of the Planner view', () => {
    expect(plannerViewSrc).toMatch(/class="planner-analytics"/);
    expect(plannerViewSrc).toMatch(/Position composition/);
    expect(plannerViewSrc).toMatch(/Age by position/);
    expect(plannerViewSrc).toMatch(/Age distribution/);
  });

  it('places it after (below) the KeeperPlanner component, not before', () => {
    const keeperPlannerIdx = plannerViewSrc.indexOf('<KeeperPlanner');
    const analyticsIdx = plannerViewSrc.indexOf('class="planner-analytics"');
    expect(keeperPlannerIdx).toBeGreaterThan(-1);
    expect(analyticsIdx).toBeGreaterThan(keeperPlannerIdx);
  });

  it('de-emphasizes NFL/College Analysis behind a closed <details>, not a fourth prominent card', () => {
    const extra = plannerViewSrc.match(/<details class="planner-analytics__extra">[\s\S]*?<\/details>/)?.[0] ?? '';
    expect(extra).toMatch(/NFL Analysis/);
    expect(extra).toMatch(/College Analysis/);
    expect(extra).not.toMatch(/\bopen\b/);
  });
});

describe('the Front Office AFL panel carries the same roster analytics', () => {
  // The panel used by /afl-fantasy/front-office (AflKeeperPlannerPanel.astro)
  // is a DIFFERENT render path from rosters.astro's ?view=planner tab and
  // never had analytics data at all — the Planner-view copy above doesn't
  // reach it. This is its own wiring, via afl-roster-analytics.ts.
  const PANEL_SRC = readFileSync(
    'src/components/shared/front-office-hub/AflKeeperPlannerPanel.astro',
    'utf-8',
  );
  const KEEPER_DATA_SRC = readFileSync('src/utils/front-office-keeper-data.ts', 'utf-8');

  it('front-office-keeper-data.ts computes analytics via the shared util, not inline duplication', () => {
    expect(KEEPER_DATA_SRC).toMatch(/from '\.\/afl-roster-analytics'/);
    expect(KEEPER_DATA_SRC).toMatch(/buildRosterAnalytics\(/);
    expect(KEEPER_DATA_SRC).toMatch(/groupByNflTeam\(/);
    expect(KEEPER_DATA_SRC).toMatch(/groupByCollege\(/);
  });

  it('the panel renders the 4-card grid below KeeperPlanner, with NFL/College Stacks open by default', () => {
    const keeperPlannerIdx = PANEL_SRC.indexOf('<KeeperPlanner');
    const analyticsIdx = PANEL_SRC.indexOf('fo-afl-analytics"');
    expect(keeperPlannerIdx).toBeGreaterThan(-1);
    expect(analyticsIdx).toBeGreaterThan(keeperPlannerIdx);
    expect(PANEL_SRC).toMatch(/Position composition/);
    expect(PANEL_SRC).toMatch(/Age by position/);
    expect(PANEL_SRC).toMatch(/Age distribution/);
    const extra = PANEL_SRC.match(/<details class="fo-afl-analytics__extra"[\s\S]*?<\/details>/)?.[0] ?? '';
    expect(extra).toMatch(/NFL and College Stacks/);
    expect(extra).toMatch(/NFL Analysis/);
    expect(extra).toMatch(/College Analysis/);
    // Open by default here — unlike the rosters.astro Planner-view copy,
    // which stays closed/de-emphasized.
    expect(extra).toMatch(/<details class="fo-afl-analytics__extra" open>/);
  });

  it('the Age card can shrink a long name without pushing the page sideways', () => {
    // A grid/flex item's automatic min-width is its own content's
    // min-content, not 0, regardless of `overflow: hidden` set on a
    // descendant several levels down (that zeroing rule only applies to the
    // flex/grid item measured directly). A long real name (e.g. "Okonkwo,
    // Chigoziem") was enough to blow .chart-card past its grid track and the
    // whole page past the viewport on mobile — reproduced and confirmed
    // fixed live via Playwright, since jsdom doesn't lay out flex/grid.
    // Every box between the analytics grid and the ellipsis-truncated name
    // needs its own min-width: 0 or the chain breaks at whichever link is
    // missing it.
    const chartCard = PANEL_SRC.match(/\.chart-card\s*\{[\s\S]*?\}/)?.[0] ?? '';
    const minmax = PANEL_SRC.match(/\.age-stats__minmax\s*\{[\s\S]*?\}/)?.[0] ?? '';
    const rowName = PANEL_SRC.match(/\.age-stats__row-name\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(chartCard).toMatch(/min-width:\s*0/);
    expect(minmax).toMatch(/min-width:\s*0/);
    expect(rowName).toMatch(/min-width:\s*0/);
  });
});

describe('buildKeeperPlannerStats', () => {
  it('returns an empty map for a year with no committed feeds', () => {
    const stats = buildKeeperPlannerStats(1899);
    expect(stats.size).toBe(0);
  });

  it('computes PPG, games, positional finish, and ADP ranks for a real AFL year', () => {
    // 2025 is a completed season with both weekly results and ADP feeds —
    // 2026 (the current cycle at test-writing time) is pre-kickoff and has
    // no scores yet, only ADP.
    const stats = buildKeeperPlannerStats(2025);
    expect(stats.size).toBeGreaterThan(0);
    for (const [, s] of stats) {
      if (s.ppg != null) {
        // Defense/ST scoring can go negative in a real week, so only games
        // played is asserted as strictly positive here.
        expect(s.gamesPlayed).toBeGreaterThan(0);
        expect(Number.isFinite(s.ppg)).toBe(true);
      }
      if (s.positionalFinish != null) {
        expect(s.positionalFinish).toBeGreaterThanOrEqual(1);
      }
      if (s.dynastyAdpRank != null) expect(s.dynastyAdpRank).toBeGreaterThanOrEqual(1);
      if (s.redraftAdpRank != null) expect(s.redraftAdpRank).toBeGreaterThanOrEqual(1);
    }
  });

  it('degrades gracefully for a historical year with no ADP feed', () => {
    // ADP is only fetched from 2025 on; 2020 has full weekly results but no
    // ADP feed at all.
    const stats = buildKeeperPlannerStats(2020);
    expect(stats.size).toBeGreaterThan(0);
    for (const [, s] of stats) {
      expect(s.dynastyAdpRank).toBeNull();
      expect(s.redraftAdpRank).toBeNull();
    }
  });

  it('assigns positional finish 1 to exactly one player per position, not one per player', () => {
    const stats = buildKeeperPlannerStats(2025);
    const finishOnes = [...stats.values()].filter((s) => s.positionalFinish === 1);
    // One #1 finisher per position that had any scorer (QB/RB/WR/TE/PK/Def,
    // give or take) — a handful, never a sizeable fraction of the pool.
    expect(finishOnes.length).toBeGreaterThan(0);
    expect(finishOnes.length).toBeLessThan(10);
  });
});
