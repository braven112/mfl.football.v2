import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A column that runs on a weekly cron must never claim the homepage hero.
 *
 * THE BUG THIS EXISTS FOR. `tier: 'breaking'` is not decoration — it is the
 * homepage. `selectBreakingStory` (src/utils/offseason-hero-data.ts) takes the
 * freshest breaking-tier post under 48h old and `resolveHeroState` renders it
 * at P0, above the regular-season daily rotation, yielding only to a genuinely
 * live game. That slot was built for a trade or an auction bomb.
 *
 * Three scheduled columns shipped at 'breaking' anyway, and 48h windows from a
 * weekly cron tile the calendar: recap Tue 6am→Thu 6am, weekend preview
 * Fri 8am→Sun 8am, matchup preview Sat 9am→Mon 9am. The homepage hero was a
 * Schefter column roughly four days in seven all season, and the game-day /
 * kickoff / live states it preempted were the ones written for those exact
 * days. It surfaced when the Friday column published a WEEK 0 preview — "no
 * matchups scheduled" — and that empty article owned the homepage for two days.
 *
 * THE RULE. If the workflow fires it on a given weekday, every week, it is a
 * column and not news. Seasonal one-offs (draft grades, team grades,
 * championship recap, release day) are untouched — they really are events.
 *
 * DERIVED, NOT LISTED. The weekly set is read from the workflow's own cron→type
 * map, so a new weekly column is covered the day its cron lands rather than
 * whenever someone remembers to extend a list here.
 */
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/schefter-articles.yml');
const TYPES_DIR = path.join(ROOT, 'scripts/article-types');
const SELECTOR = path.join(ROOT, 'src/utils/offseason-hero-data.ts');

/**
 * Article types the workflow fires on a fixed weekday.
 *
 * A cron whose day-of-week field is not `*` recurs every week; `0 18 * * *`
 * (schedule-release) is daily and self-gates on the commissioner's paste, so
 * it is not a weekly column and keeps its breaking tier.
 */
function weeklyColumnTypes(): string[] {
  const src = readFileSync(WORKFLOW, 'utf8');
  const types = new Set<string>();
  for (const m of src.matchAll(/"([^"]+)"\)\s*TYPE="([a-z-]+)"/g)) {
    const [, cron, type] = m;
    const dayOfWeek = cron.trim().split(/\s+/)[4];
    if (dayOfWeek === '*') continue;
    // Only types that are actually article modules — the poll and pecking-order
    // entries route elsewhere in the workflow.
    if (existsSync(path.join(TYPES_DIR, `${type}.mjs`))) types.add(type);
  }
  return [...types].sort();
}

describe('weekly columns do not claim the homepage hero', () => {
  it('derives the weekly column set from the workflow (sanity)', () => {
    const weekly = weeklyColumnTypes();
    // If a workflow rewrite breaks the derivation this set empties and every
    // assertion below passes vacuously, which is the failure mode to catch.
    expect(weekly).toContain('weekly-recap');
    expect(weekly).toContain('weekend-preview');
    expect(weekly).toContain('matchup-preview');
    // The daily, event-gated release column is not a weekly column.
    expect(weekly).not.toContain('schedule-release');
  });

  for (const type of weeklyColumnTypes()) {
    it(`${type} is not tier 'breaking'`, async () => {
      const mod = await import(path.join(TYPES_DIR, `${type}.mjs`));
      expect(mod.config.tier).not.toBe('breaking');
    });
  }

  it('still guards something — the hero selector gates on the breaking tier', () => {
    // The tier above is only load-bearing while this is how the hero picks a
    // post. If the selector stops reading `tier`, the demotions no longer keep
    // columns off the homepage and this file needs rewriting, not deleting.
    const src = readFileSync(SELECTOR, 'utf8');
    expect(src).toMatch(/tier\s*!==\s*'breaking'/);
  });
});
