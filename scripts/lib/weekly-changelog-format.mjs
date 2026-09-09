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
 */

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
export function groupByArea(changes) {
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
export function buildChangeLine(change) {
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
export function buildDateRange(changes) {
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
