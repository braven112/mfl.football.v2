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
  it('age filter hides cards above the chosen threshold, never the keeper slots', () => {
    expect(SRC).toMatch(/data-age-filter/);
    expect(SRC).toMatch(/kp-card--filtered/);
    // The filter reads age off the card itself, not the (age-free) slot clone.
    expect(SRC).toMatch(/data-age=\{player\.age\}/);
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
