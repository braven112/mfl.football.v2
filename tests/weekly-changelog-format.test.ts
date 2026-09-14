import { describe, it, expect } from 'vitest';
import {
  AREA_LABELS,
  BOTH_LEAGUES,
  BOTH_TAG,
  FEATURE_TYPES,
  FIX_TYPES,
  buildChangeLine,
  buildDateRange,
  buildDescription,
  buildSummary,
  groupByArea,
  joinPhrases,
  leaguesForStagedChange,
} from '../scripts/lib/weekly-changelog-format.mjs';
import {
  countAnchorOpenTags,
  countSiteLinks,
  extractDescriptionHrefs,
  isLeagueScopedPath,
} from '../src/utils/whats-new-links';
import type { DescriptionBlock, DescriptionListBlock } from '../src/types/whats-new';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ALL_LEAGUES } from '../src/config/leagues';

/**
 * The rollup builds the ONE article a week anybody reads, unattended, at 8pm
 * Monday — and then empties the staging queue, so a formatting bug is not
 * something you fix by re-running. Until these builders were split out of
 * scripts/weekly-changelog-rollup.mjs they had no coverage at all: the script
 * publishes at module scope, so importing it ran the rollup.
 *
 * Everything here is the article's SHAPE — the half a data test on published
 * JSON cannot reach, because by the time an entry is in whats-new.json the
 * mistake has already shipped.
 */

const change = (over: Record<string, unknown> = {}) => ({
  date: '2026-09-08',
  type: 'bug-fix',
  summary: 'A thing that was wrong is no longer wrong',
  impact: 'user',
  area: 'homepage',
  league: 'theleague',
  ...over,
});

/** The list blocks of a description, by heading. */
const listBlock = (blocks: DescriptionBlock[], heading: string) =>
  blocks.find(
    (b): b is DescriptionListBlock =>
      typeof b === 'object' && (b as DescriptionListBlock).type === 'list' && (b as DescriptionListBlock).heading === heading,
  );

describe('buildChangeLine — one bullet per change', () => {
  it('terminates a summary that does not punctuate itself', () => {
    expect(buildChangeLine(change({ summary: 'The card now opens the right page' }))).toBe(
      'The card now opens the right page.',
    );
  });

  it('leaves existing terminal punctuation alone rather than doubling it', () => {
    for (const summary of ['It works now.', 'Does it work now?', 'It works now!']) {
      expect(buildChangeLine(change({ summary }))).toBe(summary);
    }
  });

  it('appends a guide link when the change points at one', () => {
    const line = buildChangeLine(change({ guide: '/guides/sunday-ticket' }));
    expect(line).toContain('<a href="/guides/sunday-ticket">How to use it</a>');
  });

  it('accepts a bare guide slug as well as a path', () => {
    expect(buildChangeLine(change({ guide: 'sunday-ticket' }))).toContain(
      'href="/guides/sunday-ticket"',
    );
  });

  it('links a marquee entry by id, league-neutral', () => {
    const line = buildChangeLine(change({ entryId: 'sunday-ticket-live-scoring' }));
    expect(line).toContain('<a href="/whats-new/sunday-ticket-live-scoring">');
    // NOT /theleague/whats-new/... — one body is rendered per league and
    // rewriteDescriptionLinks prefixes it for the reader.
    expect(line).not.toContain('/theleague/');
    expect(line).not.toContain('/afl-fantasy/');
  });

  it('prefers the marquee article over a guide when a change carries both', () => {
    // The staging guard rejects both together; this pins which one wins if one
    // ever slips through, so the fuller read is never the one dropped.
    const line = buildChangeLine(change({ entryId: 'big-launch', guide: '/guides/x' }));
    expect(line).toContain('/whats-new/big-launch');
    expect(line).not.toContain('/guides/x');
  });

  it('closes every anchor it opens', () => {
    for (const over of [{ guide: '/guides/x' }, { entryId: 'y' }]) {
      const line = buildChangeLine(change(over));
      expect(countAnchorOpenTags([line])).toBe(extractDescriptionHrefs([line]).length);
    }
  });
});

describe('buildDescription — the article body', () => {
  const dateRange = 'Sep 7-8';

  it('puts features above fixes', () => {
    const blocks = buildDescription({
      features: [change({ type: 'new-page', summary: 'A new page exists' })],
      fixes: [change()],
      dateRange,
    }) as DescriptionBlock[];

    const headings = blocks
      .filter((b): b is DescriptionListBlock => typeof b === 'object' && (b as DescriptionListBlock).type === 'list')
      .map((b) => b.heading);
    expect(headings).toEqual(['New this week', 'Fixes & polish']);
  });

  it('omits a section entirely rather than shipping an empty heading', () => {
    const fixesOnly = buildDescription({ features: [], fixes: [change()], dateRange });
    expect(listBlock(fixesOnly, 'New this week')).toBeUndefined();
    expect(listBlock(fixesOnly, 'Fixes & polish')).toBeDefined();

    const featuresOnly = buildDescription({
      features: [change({ type: 'new-feature' })],
      fixes: [],
      dateRange,
    });
    expect(listBlock(featuresOnly, 'New this week')).toBeDefined();
    expect(listBlock(featuresOnly, 'Fixes & polish')).toBeUndefined();
  });

  it('labels each fix with its area, and never with a raw slug', () => {
    const blocks = buildDescription({
      features: [],
      fixes: [change({ area: 'league-summary' }), change({ area: 'trade-builder' })],
      dateRange,
    });
    const items = listBlock(blocks, 'Fixes & polish')!.items;
    expect(items[0]).toContain('<strong>League Summary</strong>');
    expect(items[1]).toContain('<strong>Trade Builder</strong>');
  });

  it('does not label features by area — a week has two or three, not sections', () => {
    const blocks = buildDescription({
      features: [change({ type: 'new-page', area: 'homepage' })],
      fixes: [],
      dateRange,
    });
    expect(listBlock(blocks, 'New this week')!.items[0]).not.toContain('<strong>Homepage</strong>');
  });

  it('keeps fixes of the same area together', () => {
    const blocks = buildDescription({
      features: [],
      fixes: [
        change({ area: 'homepage', summary: 'First homepage fix' }),
        change({ area: 'schefter', summary: 'A Schefter fix' }),
        change({ area: 'homepage', summary: 'Second homepage fix' }),
      ],
      dateRange,
    });
    const items = listBlock(blocks, 'Fixes & polish')!.items;
    expect(items.map((i) => i.match(/<strong>([^<]+)<\/strong>/)![1])).toEqual([
      'Homepage',
      'Homepage',
      'Schefter Report',
    ]);
  });

  it('always ends with a closing line that links the archive and the guides', () => {
    const blocks = buildDescription({ features: [], fixes: [change()], dateRange });
    const closing = blocks[blocks.length - 1];
    expect(typeof closing).toBe('string');
    expect(closing).toContain('<a href="/whats-new">');
    expect(closing).toContain('<a href="/guides">');
  });

  it('reads "in the week of" for a single-day range as well as a span', () => {
    // "between Sep 7" is not a range. Both forms go through one phrasing.
    for (const range of ['Sep 7', 'Sep 7-8', 'Aug 31-Sep 2']) {
      const blocks = buildDescription({ features: [], fixes: [change()], dateRange: range });
      expect(blocks[blocks.length - 1]).toContain(`in the week of ${range}`);
    }
  });

  /**
   * The rule the whole redesign hangs on: a rollup with nothing to click has
   * thrown away the detail AND the way to reach it. `weekly` is in
   * LINK_REQUIRED_CATEGORIES, so a body that failed this would red the build
   * on Monday night — after publishing.
   */
  it('satisfies the inline-link requirement even on a fixes-only week', () => {
    const blocks = buildDescription({ features: [], fixes: [change()], dateRange });
    expect(countSiteLinks({ description: blocks })).toBeGreaterThan(0);
  });

  it('writes every href league-neutral, so the reader-side rewriter can place it', () => {
    const blocks = buildDescription({
      features: [change({ type: 'new-page', guide: '/guides/sunday-ticket' })],
      fixes: [change({ entryId: 'big-launch' })],
      dateRange,
    });
    const hrefs = extractDescriptionHrefs(blocks).filter(isLeagueScopedPath);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, `${href} is already league-prefixed`).not.toMatch(
        /^\/(theleague|afl-fantasy|best-ball-1)\//,
      );
    }
  });

  it('keeps every link inside a list item visible to the guards', () => {
    // A link the guards cannot see is still league-prefixed by the renderer —
    // the exact "ships pointing at the wrong league" failure. This fails if
    // htmlFragments ever stops walking list items.
    const blocks = buildDescription({
      features: [change({ type: 'new-page', guide: '/guides/sunday-ticket' })],
      fixes: [],
      dateRange,
    });
    expect(extractDescriptionHrefs(blocks)).toContain('/guides/sunday-ticket');
  });
});

describe('buildSummary — the card and hero line', () => {
  it('counts features and fixes separately', () => {
    expect(
      buildSummary({ features: [change(), change()], fixes: [change()] }),
    ).toBe('2 new features and 1 fix across the site this week.');
  });

  it('singularizes one of each', () => {
    expect(buildSummary({ features: [change()], fixes: [] })).toBe(
      '1 new feature across the site this week.',
    );
    expect(buildSummary({ features: [], fixes: [change()] })).toBe(
      '1 fix across the site this week.',
    );
  });

  it('says something rather than nothing when a week is empty', () => {
    expect(buildSummary({ features: [], fixes: [] })).toBe('A quiet week across the site this week.');
  });
});

describe('buildDateRange', () => {
  it('collapses a single day', () => {
    expect(buildDateRange([change({ date: '2026-09-07' })])).toBe('Sep 7');
  });

  it('spans days within one month', () => {
    expect(
      buildDateRange([change({ date: '2026-09-08' }), change({ date: '2026-09-07' })]),
    ).toBe('Sep 7-8');
  });

  it('names both months across a boundary', () => {
    expect(
      buildDateRange([change({ date: '2026-09-02' }), change({ date: '2026-08-31' })]),
    ).toBe('Aug 31-Sep 2');
  });

  it('does not depend on the order changes were staged in', () => {
    const dates = ['2026-09-08', '2026-09-05', '2026-09-07'];
    const forwards = buildDateRange(dates.map((date) => change({ date })));
    const backwards = buildDateRange([...dates].reverse().map((date) => change({ date })));
    expect(forwards).toBe(backwards);
  });
});

describe('the type split', () => {
  it('routes every staged type to exactly one section', () => {
    const all = ['new-page', 'new-feature', 'enhancement', 'bug-fix', 'style-tweak'];
    for (const type of all) {
      expect(
        FEATURE_TYPES.has(type) !== FIX_TYPES.has(type),
        `${type} lands in both sections or neither`,
      ).toBe(true);
    }
  });

  it('puts an enhancement under features — a changed feature is news to whoever uses it', () => {
    expect(FEATURE_TYPES.has('enhancement')).toBe(true);
  });

  it('puts a style-tweak under fixes — nobody came to read that a crest is uncropped', () => {
    expect(FIX_TYPES.has('style-tweak')).toBe(true);
  });
});

describe('helpers', () => {
  it('groupByArea preserves first-seen order and defaults a missing area', () => {
    const groups = groupByArea([
      change({ area: 'schefter' }),
      change({ area: undefined }),
      change({ area: 'schefter' }),
    ]);
    expect([...groups.keys()]).toEqual(['schefter', 'other']);
    expect(groups.get('schefter')).toHaveLength(2);
  });

  it('joinPhrases reads as English at every length', () => {
    expect(joinPhrases([])).toBe('');
    expect(joinPhrases(['a'])).toBe('a');
    expect(joinPhrases(['a', 'b'])).toBe('a and b');
    expect(joinPhrases(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('AREA_LABELS never renders a raw slug for a label it does define', () => {
    for (const [slug, label] of Object.entries(AREA_LABELS)) {
      expect(label, `${slug} has no display label`).toBeTruthy();
      expect(label).not.toBe(slug === 'other' ? '' : slug);
    }
  });
});

describe('`both` means the full-management leagues, not every league', () => {
  /**
   * `both` used to expand to every league in the registry, Best Ball included.
   * Best Ball is draft-only: no lineups, no in-season management, no Schefter
   * feed, no /notifications route. It shipped an article whose only line was a
   * Schefter fix, for a league with no Schefter — and a `both` line linking
   * /notifications, which the link guard caught only because the href 404s.
   * The wrong AUDIENCE had nothing checking it at all.
   */
  it('excludes every best-ball league', () => {
    const draftOnly = ALL_LEAGUES.filter((l) => l.bestBall).map((l) => l.navSlug);
    expect(draftOnly.length, 'no best-ball league in the registry — has the flag moved?')
      .toBeGreaterThan(0);
    for (const slug of draftOnly) {
      expect(BOTH_LEAGUES, `"${BOTH_TAG}" must not fan out to draft-only ${slug}`).not.toContain(slug);
    }
  });

  it('still covers more than one league, or the tag means nothing', () => {
    expect(BOTH_LEAGUES.length).toBeGreaterThan(1);
  });

  it('includes every league that is not draft-only', () => {
    const expected = ALL_LEAGUES.filter((l) => !l.bestBall).map((l) => l.navSlug);
    expect([...BOTH_LEAGUES].sort()).toEqual([...expected].sort());
  });

  it('fans out only the both tag — a named league stays itself', () => {
    expect(leaguesForStagedChange({ league: BOTH_TAG })).toEqual([...BOTH_LEAGUES]);
    for (const league of ALL_LEAGUES) {
      expect(leaguesForStagedChange({ league: league.navSlug })).toEqual([league.navSlug]);
    }
  });

  /**
   * The rollup and the PR-time data test must apply the SAME expansion. Both
   * import the helper above; an inline `=== 'both'` in the rollup would be a
   * second copy of the rule, which is exactly how the two drifted before.
   */
  it('the rollup routes through the helper rather than comparing inline', () => {
    const source = readFileSync(
      resolve(__dirname, '../scripts/weekly-changelog-rollup.mjs'),
      'utf-8',
    );
    expect(source).toContain('leaguesForStagedChange');
    const inlineCompare = /\.league\s*===\s*['"]both['"]/.test(source);
    expect(
      inlineCompare,
      'weekly-changelog-rollup.mjs compares the "both" tag inline. Use ' +
        'leaguesForStagedChange() so the script and tests/whats-new-data.test.ts ' +
        'cannot answer this differently.',
    ).toBe(false);
  });
});
