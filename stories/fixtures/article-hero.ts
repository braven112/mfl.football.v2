/**
 * Fixtures for the ARTICLE state of LeagueCompositeHero — the homepage card
 * that promotes the latest Schefter story.
 *
 * Frozen copies of what `articleHeroView()` ACTUALLY returns for the two
 * stories that were on the homepages the day this card was built, so the story
 * needs no feed and no clock.
 *
 * "Actually" is load-bearing and was wrong on the first pass. These were
 * hand-written to the split a human would choose — `League Walks Into` /
 * `Buzz Saw.` — but `splitTitleHeadline` accents the LAST word, so production
 * renders `League Walks Into Buzz` / `Saw.`. A fixture that flatters the code
 * is worse than no fixture: Chromatic then pins a shape the site never draws,
 * and the screenshots reviewed before shipping showed a card nobody would see.
 * If you change these, re-derive them by RUNNING the builder, never by taste.
 *
 * Offline on purpose, same two ways as league-composite-hero.ts: an inline
 * data-URI face rather than an ESPN cutout, and a free-agent `nflTeam` so no
 * a.espncdn.com logo is fetched. The byline avatar is the real local asset —
 * it ships in public/, which Storybook serves.
 *
 * Plain object literals and no imports beyond types (Trap 6).
 */
import type { EventHeroView } from '../../src/utils/afl-hero-resolver';
import type { HeroModel } from '../../src/utils/hero-casting';

const FACE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48cmVjdCB3aWR0aD0nMjAwJyBoZWlnaHQ9JzIwMCcgZmlsbD0nbm9uZScvPjxjaXJjbGUgY3g9JzEwMCcgY3k9JzcyJyByPSc0MicgZmlsbD0nI2NmZDRkYScvPjxwYXRoIGQ9J00yMCAyMDBjMC00NiAzNi03NCA4MC03NHM4MCAyOCA4MCA3NHonIGZpbGw9JyNjZmQ0ZGEnLz48L3N2Zz4=';

/** The byline every house story carries. Resolved in app code from `authorId`. */
export const schefterByline = {
  name: 'Claude Schefter',
  avatar: '/assets/claude-schefter-avatar.webp',
};

/** The player the article named in its body (`heroPlayerId`). */
export const gauntletModel: HeroModel = {
  mflId: '15501',
  name: 'Marcus Reed',
  position: 'RB',
  nflTeam: 'FA',
  headshot: FACE,
  descriptor: 'Top Pickup',
};

/**
 * TheLeague's Wednesday waiver report — the card in the bug report, which
 * shipped as an unstyled white box because the post named no hero player.
 * Note the CTA: the article's own permalink, not `/theleague/news`.
 */
export const theLeagueWaiverReport: EventHeroView = {
  pill: 'WAIVER REPORT',
  pillDate: 'Wed, Sep 16',
  // splitTitleHeadline('League Walks Into Buzz Saw') — the kicker
  // ("Week 2 Wall: ") is dropped by stripHeadlineKicker first.
  headline: 'League Walks Into Buzz',
  accentWord: 'Saw.',
  summary:
    'Dark Magicians of Chaos face the gauntlet’s hardest road at 54 difficulty. But two undefeated teams built their records on cupcakes—and reality is coming.',
  link: '/theleague/news/sf_2026_gauntlet_w02',
  linkLabel: 'Read The Gauntlet',
  composite: { wordmark: 'NEWS', accent: 'kickoff', tone: null, scope: 'league' },
  byline: schefterByline,
  model: gauntletModel,
};

/**
 * The AFL's news card. Same component, its own navy, and — the fix — the
 * latest article's headline and permalink where "AROUND THE AFL." into the
 * listing page used to be.
 */
export const aflWeekArticle: EventHeroView = {
  pill: 'WEEK 2',
  pillDate: 'Wed, Sep 16',
  headline: 'Week 2 is a league-wide buzz saw — get ready for the',
  accentWord: 'reckoning.',
  summary:
    'Every contender draws a top-ten schedule this week, and the two records built on soft opponents are about to be audited in public.',
  link: '/afl-fantasy/news/sf_2026_gauntlet_w02_afl',
  linkLabel: 'Read The Gauntlet',
  composite: { wordmark: 'NEWS', accent: 'navy', tone: null, scope: 'league' },
  byline: schefterByline,
  model: gauntletModel,
};

/** A feed with no article: the one honest use of the listing-page CTA. */
export const emptyDesk: EventHeroView = {
  pill: 'AROUND THE AFL',
  headline: 'Around the',
  accentWord: 'AFL.',
  summary: 'Schefter covers the moves, the matchups, and the storylines shaping the AL and NL races.',
  link: '/afl-fantasy/news',
  linkLabel: 'Read the latest',
  composite: { wordmark: 'NEWS', accent: 'navy', tone: null, scope: 'league' },
  byline: schefterByline,
  model: null,
};

/**
 * An ESPN contributor's post. The byline is resolved from the post's own
 * `authorId`, so this card wears Adam Schefter's name and face — the house
 * reporter's byline on it would attribute someone else's reporting to him.
 */
export const externalBylineArticle: EventHeroView = {
  ...theLeagueWaiverReport,
  pill: 'AROUND THE NFL',
  headline: 'Sources: deal is done, and it lands',
  accentWord: 'tonight.',
  summary:
    'The two sides have agreed to terms and the paperwork is expected to be filed before the window closes, per sources.',
  link: '/theleague/news/sf_2026_external_example',
  linkLabel: 'Read the report',
  byline: { name: 'Adam Schefter', avatar: '/assets/schefter/adam-schefter-avatar.webp' },
};
