/**
 * The monthly newsletter issue, built from a month of What's New articles.
 *
 * The weekly changelog rollup already writes one article per league every
 * Monday (src/data/whats-new.json). The newsletter is for people OUTSIDE the
 * leagues — old MFLaddons customers, past league-mates — so it reads one copy
 * of each week: TheLeague's, the flagship, whose rollup runs every week. The
 * other leagues' copies of the same week are the same news in their own words.
 *
 * Pure: no I/O, no clock. The route passes in the entries and the month.
 */

export interface WhatsNewEntry {
  id: string;
  date: string;
  title: string;
  summary?: string;
  image?: string;
  imageAlt?: string;
  leagues?: string[];
  category?: string;
}

export interface NewsletterItem {
  title: string;
  summary: string;
  url: string;
  imageUrl: string | null;
  imageAlt: string;
}

export interface NewsletterIssue {
  /** Also the idempotency key: one draft per subject. */
  subject: string;
  previewText: string;
  description: string;
  html: string;
  items: NewsletterItem[];
}

/** Which league's copy of each article the newsletter reads. */
export const NEWSLETTER_SOURCE_LEAGUE_TAG = 'theleague';

/** Keeps an issue short enough to be read. */
export const MAX_ITEMS = 6;

/**
 * Which articles win a slot when a month has more than MAX_ITEMS. The weekly
 * rollup is the week's headline; a launch-day article for a new page or
 * feature next; enhancements last. A fixes-only rollup is never news to
 * someone outside the leagues, so it is left out entirely.
 */
const CATEGORY_RANK: Record<string, number> = {
  weekly: 0,
  'new-page': 1,
  'new-feature': 1,
  enhancement: 2,
};
const rank = (e: WhatsNewEntry) => CATEGORY_RANK[e.category ?? ''] ?? 3;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The calendar month before `now`'s, as { year, month (1-12) }. */
export function previousMonth(now: Date): { year: number; month: number } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based: this IS last month's 1-based number
  return m === 0 ? { year: y - 1, month: 12 } : { year: y, month: m };
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

export function issueSubject(year: number, month: number): string {
  return `What's new on mfl.football: ${monthLabel(year, month)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The month's items: the MAX_ITEMS highest-ranked (newest first within a
 * rank), then shown oldest first. `articleUrl` and `assetUrl` turn an entry
 * id / image file name into absolute links (the caller owns the origin, via
 * leagueUrl — this module never concatenates one).
 */
export function selectItems(
  entries: WhatsNewEntry[],
  year: number,
  month: number,
  articleUrl: (id: string) => string,
  assetUrl: (file: string) => string,
): NewsletterItem[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return entries
    .filter((e) => e.date?.startsWith(prefix))
    .filter((e) => (e.leagues ?? []).includes(NEWSLETTER_SOURCE_LEAGUE_TAG))
    .filter((e) => e.category !== 'bug-fix')
    .sort((a, b) => rank(a) - rank(b) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .slice(0, MAX_ITEMS)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((e) => ({
      title: e.title,
      summary: e.summary ?? '',
      url: articleUrl(e.id),
      imageUrl: e.image ? assetUrl(e.image) : null,
      imageAlt: e.imageAlt ?? e.title,
    }));
}

/**
 * The issue, or null when the month published nothing — an empty newsletter
 * is worse than a skipped month.
 */
export function buildMonthlyIssue(
  entries: WhatsNewEntry[],
  year: number,
  month: number,
  articleUrl: (id: string) => string,
  assetUrl: (file: string) => string,
): NewsletterIssue | null {
  const items = selectItems(entries, year, month, articleUrl, assetUrl);
  if (items.length === 0) return null;
  const label = monthLabel(year, month);

  const blocks = items
    .map((it) => {
      const img = it.imageUrl
        ? `<p><a href="${escapeHtml(it.url)}"><img src="${escapeHtml(it.imageUrl)}" alt="${escapeHtml(it.imageAlt)}" width="560" style="max-width:100%;height:auto;border-radius:6px"></a></p>`
        : '';
      return `<h2>${escapeHtml(it.title)}</h2>${img}<p>${escapeHtml(it.summary)}</p><p><a href="${escapeHtml(it.url)}">Read more</a></p>`;
    })
    .join('\n');

  const html = [
    `<p>Hi {{ subscriber.first_name | default: "there" }},</p>`,
    `<p>Here's what I built on mfl.football in ${escapeHtml(label)}.</p>`,
    blocks,
    `<p>Thanks for reading,<br>Brandon</p>`,
  ].join('\n');

  return {
    subject: issueSubject(year, month),
    previewText: items[0].title,
    description: `Monthly issue for ${label}, drafted from ${items.length} What's New article${items.length === 1 ? '' : 's'}.`,
    html,
    items,
  };
}
