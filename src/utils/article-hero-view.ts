/**
 * article-hero-view — the homepage card that promotes a Schefter ARTICLE, for
 * any league.
 *
 * Both leagues ran an article slot and both got it wrong in their own way.
 * TheLeague rendered the classic bordered card (`ArticleHero`'s fallback) for
 * every post without a `heroPlayerId`, so the waiver report sat on the homepage
 * as a plain white box beside composite heroes. The AFL got the composite
 * treatment but hardcoded copy — "AROUND THE AFL." into `/afl-fantasy/news` —
 * so the card never named the story it was promoting and the CTA dropped the
 * reader on a listing to find it themselves.
 *
 * One builder now answers both: the LATEST article's own headline, its own
 * excerpt, and ITS OWN LINK. The three rules that matter:
 *
 *  1. **The CTA is the article's `link`.** The listing page is a fallback for
 *     a feed with no article in it at all, never the destination for a card
 *     that just printed an article's headline — that is the bug this replaces.
 *  2. **The newest article wins, by timestamp.** Not by feed position: MFL
 *     ordering is nondeterministic and the feeds are append-merged by cron,
 *     so "posts[0]" is a guess that happens to be right most days.
 *  3. **The byline is the author's**, resolved from the post's `authorId`
 *     rather than assumed to be Claude — the feeds carry external bylines
 *     (Adam Schefter, Mel Kiper) and a card that puts Claude's face on one of
 *     those is attributing someone else's reporting to the house reporter.
 *
 * Pure: takes posts and returns a view. No feed imports, no clock, no auth —
 * which is what makes it storyable and what let the second league adopt it
 * without a fork.
 */
import type { CompositeHeroTreatment } from '../types/composite-hero';
import type { EventHeroView } from './afl-hero-resolver';
import { splitTitleHeadline } from './whats-new-hero-headline';

/** The author's face and name, rendered as the card's byline. */
export interface ArticleHeroByline {
  name: string;
  /** Resolved avatar path — `getAuthorAvatar(getAuthor(post.authorId))`. */
  avatar: string;
}

/**
 * The subset of a `SchefterPost` this builder reads. Structural rather than
 * the full type so the module stays importable from a story fixture.
 */
export interface ArticleHeroSource {
  type?: string;
  headline: string;
  body?: string;
  link?: string;
  linkLabel?: string;
  timestamp?: string;
  authorId?: string;
  heroPlayerId?: string;
}

/** Longest excerpt the two-line summary clamp can show without cutting mid-line. */
const EXCERPT_CHARS = 180;

/**
 * Longest leading "kicker:" the display line drops. Schefter titles a story
 * `Week 2 Wall: League Walks Into Buzz Saw` — a section label glued to the
 * headline. Fed whole to `splitTitleHeadline` that lands the accent on "Saw."
 * after five lines of condensed display type; dropping the kicker gives
 * "LEAGUE WALKS INTO / BUZZ SAW." and loses nothing the eyebrow isn't already
 * saying. Bounded, because a long lead before a colon is the headline itself
 * ("204 Games. Four to Circle. The AFL Schedule Is Out.").
 */
const MAX_KICKER = 28;

/** The part of a headline the hero displays — the kicker, if any, removed. */
export function stripHeadlineKicker(headline: string): string {
  const text = headline.trim().replace(/\s+/g, ' ');
  const at = text.indexOf(': ');
  if (at < 0 || at > MAX_KICKER) return text;
  const rest = text.slice(at + 2).trim();
  // Never strip down to a fragment — a two-word remainder is worse than the
  // whole title.
  return rest.length >= 12 ? rest : text;
}

/** Trim the body to one readable sentence-ish excerpt, on a word boundary. */
export function articleExcerpt(body: string | undefined, limit = EXCERPT_CHARS): string {
  const text = (body ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/\s+\S*$/, '')}…`;
}

/**
 * The newest article in the feed, optionally preferring one whose headline
 * matches `prefer` (the waiver report on a Wednesday, the weekend preview on a
 * Friday). A miss falls back to the newest article rather than to nothing: the
 * slot is already showing, and yesterday's story beats an empty card.
 *
 * `within` (ms) bounds "latest" — a slot that would otherwise promote a
 * three-month-old article as this week's news.
 */
export function pickLatestArticle<T extends ArticleHeroSource>(
  posts: readonly T[],
  opts: { prefer?: RegExp; now?: Date; within?: number } = {},
): T | null {
  const { prefer, now = new Date(), within } = opts;
  const articles = posts
    .filter((p) => p.type === 'article')
    .slice()
    // Newest first, by TIMESTAMP — see rule 2 in the module header.
    .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime());
  if (articles.length === 0) return null;

  const fresh =
    within === undefined
      ? articles
      : articles.filter((p) => now.getTime() - new Date(p.timestamp ?? 0).getTime() <= within);
  const pool = fresh.length > 0 ? fresh : articles;

  if (prefer) {
    const match = pool.find((p) => prefer.test(p.headline));
    if (match) return match;
  }
  return pool[0] ?? null;
}

/**
 * The story a homepage hands its hero resolver, already chosen and with its
 * byline resolved.
 *
 * Passed IN for the same reason `recap` and `waiver` are on the AFL resolver:
 * the feed lives on disk and the resolver is synchronous and pure. Absent, the
 * article slot degrades to the desk card — which is what it always rendered.
 */
export interface LatestArticle {
  post: ArticleHeroSource;
  byline: ArticleHeroByline;
}

/** The dateline beside the pill. One formatter, so both leagues read alike. */
export function articleDateLabel(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return undefined;
  return at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Everything the composite hero needs that is not the cast player. */
export type ArticleHeroView = Pick<
  EventHeroView,
  'pill' | 'pillDate' | 'headline' | 'accentWord' | 'summary' | 'link' | 'linkLabel' | 'composite' | 'byline'
>;

export interface ArticleHeroOptions {
  /** Section kicker, e.g. "Waiver Report" or "Week 2". */
  pill: string;
  /** Palette + ghost wordmark, a literal from the caller (each league's own). */
  composite: CompositeHeroTreatment;
  byline: ArticleHeroByline;
  /** Where the CTA goes when the post carries no link of its own. */
  fallbackLink: string;
  fallbackLinkLabel?: string;
  /** Formatted post date shown beside the pill. */
  dateLabel?: string;
}

/**
 * The card for a real article. `post.link` is the CTA — the listing page is
 * only ever the fallback for a post that has no permalink.
 */
export function articleHeroView(post: ArticleHeroSource, opts: ArticleHeroOptions): ArticleHeroView {
  const { headline, accentWord } = splitTitleHeadline(stripHeadlineKicker(post.headline));
  return {
    pill: opts.pill,
    pillDate: opts.dateLabel,
    headline,
    accentWord,
    summary: articleExcerpt(post.body),
    link: post.link ?? opts.fallbackLink,
    linkLabel: post.link ? (post.linkLabel ?? 'Read the full story') : (opts.fallbackLinkLabel ?? 'Read the latest'),
    composite: opts.composite,
    byline: opts.byline,
  };
}

/**
 * The card for a feed with no article in it. Names the desk rather than a
 * story, because there is no story to name — the one honest use of the
 * listing-page CTA.
 */
export function emptyArticleHeroView(opts: {
  pill: string;
  headline: string;
  accentWord: string;
  summary: string;
  composite: CompositeHeroTreatment;
  byline: ArticleHeroByline;
  link: string;
  linkLabel: string;
}): ArticleHeroView {
  const { pill, headline, accentWord, summary, composite, byline, link, linkLabel } = opts;
  return { pill, headline, accentWord, summary, link, linkLabel, composite, byline };
}
