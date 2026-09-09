/**
 * Weekly changelog — the formatting half.
 *
 * Split out of scripts/weekly-changelog-rollup.mjs so it can be TESTED. That
 * script reads files, publishes and calls process.exit at module scope, so
 * importing it RUNS the rollup — which left every builder below with no
 * coverage at all, while they decide the shape of the one article a week
 * anybody reads.
 *
 * Everything here is PURE: changes in, strings and blocks out. No clock, no
 * filesystem. The date-sensitive helpers (which Monday is it, when does
 * staging reset) deliberately stayed in the script — a function that reads
 * `new Date()` is not one a test can pin.
 *
 * It also owns the scope rule (which league articles a staged change lands in)
 * for the same reason: the rollup and the PR-time data test both need it, and
 * two copies of that answer is how Best Ball ended up with an article about
 * Schefter, which Best Ball does not have.
 */

import { ALL_LEAGUES } from '../../src/config/leagues-data.mjs';

/**
 * @typedef {import('../../src/types/whats-new').DescriptionBlock} DescriptionBlock
 *
 * @typedef {object} StagedChange
 * @property {string} date
 * @property {string} type
 * @property {string} summary
 * @property {string} [impact]
 * @property {string} [area]
 * @property {string} [league]
 * @property {boolean} [featured]
 * @property {string} [guide]
 * @property {string} [entryId]
 */

/**
 * The league tag meaning "the whole site", not one league.
 */
export const BOTH_TAG = 'both';

/**
 * What `both` expands to: every FULL-MANAGEMENT league.
 *
 * It used to expand to every league in the registry, which quietly included
 * Best Ball — a draft-only league with no lineups, no in-season management,
 * no Schefter feed and no /notifications route. A `both`-tagged line about any
 * of those shipped to bb1's article describing a feature it does not have, and
 * one of them shipped a link that 404s there (the link guard caught the href;
 * nothing was checking the audience).
 *
 * Derived from the registry's own `bestBall` flag rather than a list of slugs:
 * the flag already means "draft-only, skip UI that assumes roster management"
 * (see its docblock in leagues-data.mjs), which is exactly the question being
 * asked here, and a fourth league joins the right side of it automatically.
 */
export const BOTH_LEAGUES = ALL_LEAGUES.filter((l) => !l.bestBall).map((l) => l.navSlug);

/**
 * Which league articles a staged change lands in.
 *
 * A change may still be tagged with a single league by name — including a
 * best-ball one, for a fix that genuinely only affects it. `both` is the only
 * tag that fans out.
 */
export /** @param {Partial<StagedChange>} change @returns {string[]} */
function leaguesForStagedChange(change) {
  return change?.league === BOTH_TAG ? [...BOTH_LEAGUES] : [String(change?.league)];
}

/** Map area slugs to display names */
export const AREA_LABELS = {
  'free-agents': 'Free Agents',
  'rosters': 'Rosters',
  'navigation': 'Navigation & Routing',
  'design-system': 'Design System & Theming',
  'homepage': 'Homepage',
  'rankings': 'Rankings',
  'trade-builder': 'Trade Builder',
  'salary': 'Salary',
  'league-summary': 'League Summary',
  'calendar': 'Calendar',
  'standings': 'Standings',
  'live-scoring': 'Live Scoring',
  'playoffs': 'Playoffs',
  'mvp': 'MVPs',
  'rules': 'Rules',
  'import-rankings': 'Import Rankings',
  'whats-new': "What's New",
  'guides': 'Guides',
  'transactions': 'Transactions',
  'admin': 'Admin',
  'schefter': 'Schefter Report',
  'draft': 'Draft',
  'keeper-analysis': 'Keeper Report Card',
  'awards': 'Awards & Trophies',
  'franchises': 'Franchise Pages',
  'owners': 'Owner Pages',
  'notifications': 'Notifications',
  'sunday-ticket': 'Sunday Ticket',
  'other': 'Other',
};

/**
 * Group changes by area, preserving insertion order.
 */
export /** @param {StagedChange[]} changes @returns {Map<string, StagedChange[]>} */
function groupByArea(changes) {
  const groups = new Map();
  for (const change of changes) {
    const area = change.area || 'other';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(change);
  }
  return groups;
}

/**
 * Which staged types read as "something new" versus "something mended".
 *
 * The split IS the article: one list of things you can now do, one list of
 * things that stopped being wrong. An `enhancement` sits in the first because
 * a changed feature is news to whoever uses it; a `style-tweak` sits in the
 * second because nobody came to read that a crest is no longer cropped.
 */
export const FEATURE_TYPES = new Set(['new-page', 'new-feature', 'enhancement']);
export const FIX_TYPES = new Set(['bug-fix', 'style-tweak']);

/** "1 fix" / "3 fixes" — per-league splits make single-change weeks common. */
export function countPhrase(total, singular, plural) {
  return `${total} ${total === 1 ? singular : plural}`;
}

/** Join a list into readable prose: "a", "a and b", "a, b and c". */
export function joinPhrases(parts) {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * One line of the article, as inline HTML.
 *
 * The summary carries the news; the trailing anchor carries the depth. A
 * change may point at a `guide` (an evergreen how-to under /guides) or at the
 * `entryId` of a marquee article that already published mid-week — never
 * both, and the marquee link wins because it is the fuller read.
 *
 * Hrefs are written LEAGUE-NEUTRAL on purpose: one body is stored per league
 * but `rewriteDescriptionLinks` still prefixes each href for the reader and
 * the apex hosts serve them bare. See src/utils/whats-new-links.ts.
 */
export /** @param {StagedChange} change @returns {string} */
function buildChangeLine(change) {
  const summary = String(change.summary ?? '').trim().replace(/\s+$/, '');
  const body = /[.!?)]$/.test(summary) ? summary : `${summary}.`;

  if (change.entryId) {
    return `${body} <a href="/whats-new/${change.entryId}">Read the full story</a>.`;
  }
  if (change.guide) {
    const href = change.guide.startsWith('/') ? change.guide : `/guides/${change.guide}`;
    return `${body} <a href="${href}">How to use it</a>.`;
  }
  return body;
}

/**
 * Build the article body: a screenshot's worth of lede, then one line per
 * change under a heading. Deliberately NOT prose paragraphs per area — the
 * previous rollup concatenated every summary into a run-on wall nobody read,
 * which is the whole reason this format exists.
 *
 * Fixes stay grouped by area (a reader scanning for "did they fix the draft
 * room" wants them together); features do not, because a week has two or three
 * and a heading per area would be more chrome than content.
 */
export function buildDescription({ features, fixes, dateRange }) {
  /**
   * Annotated rather than inferred: without it TypeScript widens the list
   * blocks' `type` to `string`, which is not the literal `'list'` that
   * `DescriptionBlock` requires — so every consumer sees an unassignable type
   * and has to cast. Ten call sites in the test suite did exactly that.
   * @type {DescriptionBlock[]}
   */
  const blocks = [];

  if (features.length > 0) {
    blocks.push({
      type: 'list',
      heading: 'New this week',
      items: features.map(buildChangeLine),
    });
  }

  if (fixes.length > 0) {
    const groups = groupByArea(fixes);
    const items = [];
    for (const [area, changes] of groups) {
      const label = AREA_LABELS[area] || area;
      for (const change of changes) {
        items.push(`<strong>${label}</strong> \u2014 ${buildChangeLine(change)}`);
      }
    }
    blocks.push({ type: 'list', heading: 'Fixes & polish', items });
  }

  // "in the week of" rather than "between": a one-day range reads as
  // "between Sep 7", which is not a range at all.
  blocks.push(
    `Everything above shipped in the week of ${dateRange}. Older weeks are in ` +
      `<a href="/whats-new">the archive</a>, and the how-to pages for each feature ` +
      `live in <a href="/guides">the guides</a>.`,
  );

  return blocks;
}

/**
 * The card/hero summary line, when the featured change did not author a lede.
 *
 * A fallback, not the goal: a week worth reading has a human sentence on it.
 */
export function buildSummary({ features, fixes }) {
  const parts = [];
  if (features.length > 0) {
    parts.push(countPhrase(features.length, 'new feature', 'new features'));
  }
  if (fixes.length > 0) parts.push(countPhrase(fixes.length, 'fix', 'fixes'));
  const what = joinPhrases(parts) || 'A quiet week';
  return `${what} across the site this week.`;
}

/**
 * Compute the date range string for the title (e.g., "Feb 16-22").
 */
export /** @param {StagedChange[]} changes @returns {string} */
function buildDateRange(changes) {
  const dates = changes.map((c) => c.date).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];

  const start = new Date(earliest + 'T12:00:00');
  const end = new Date(latest + 'T12:00:00');

  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });

  if (startMonth === endMonth) {
    if (start.getDate() === end.getDate()) {
      return `${startMonth} ${start.getDate()}`;
    }
    return `${startMonth} ${start.getDate()}-${end.getDate()}`;
  }
  return `${startMonth} ${start.getDate()}-${endMonth} ${end.getDate()}`;
}
