import LeagueCompositeHero from '../../src/components/shared/LeagueCompositeHero.astro';
import {
  aflWeekArticle,
  emptyDesk,
  externalBylineArticle,
  theLeagueWaiverReport,
} from '../fixtures/article-hero';

/**
 * The ARTICLE state of the homepage composite hero — the card that promotes
 * the latest Schefter story, in either league.
 *
 * Two bugs live here, and both are visible in these snapshots:
 *
 *  - TheLeague rendered this as a plain bordered card whenever the post named
 *    no hero player, so the waiver report sat on the homepage looking unstyled
 *    beside every other composite.
 *  - The AFL got the composite but hardcoded its copy and pointed its CTA at
 *    the news LISTING, so the card never named the story and the reader had to
 *    find it. Every story here links the article's own permalink; `EmptyDesk`
 *    is the only one allowed the listing, because it has no article to link.
 *
 * The byline is the third thing under test: the card is authored journalism, so
 * it carries its author's face — in the FOOTER, beside the CTA, because the
 * flank belongs to the player the story is about. It is resolved from the
 * post's own `authorId`, never assumed to be the house reporter: the feeds
 * carry external bylines (`ExternalByline`).
 *
 * Light + dark via the global `themeModes`. The league skin is decided by args,
 * so `leagueModes` would add snapshots that cannot differ.
 */
export default {
  title: 'Shared/LeagueCompositeHero/Article',
  component: LeagueCompositeHero,
  parameters: { layout: 'padded' },
  args: {
    view: theLeagueWaiverReport,
    regionLabel: 'Waiver Report',
    league: 'theleague',
    clampSummary: true,
  },
  argTypes: {
    league: { control: 'inline-radio', options: ['theleague', 'afl-fantasy'] },
  },
};

/** TheLeague's Wednesday waiver report, in its blue. */
export const TheLeagueWaiverReport = {};

/** The same card in the AFL's navy — and pointing at the article, not /news. */
export const AflWeekArticle = {
  args: { view: aflWeekArticle, league: 'afl-fantasy', regionLabel: 'Around the AFL' },
};

/** No article in the feed: the desk card, and the only listing-page CTA. */
export const EmptyDesk = {
  args: { view: emptyDesk, league: 'afl-fantasy', regionLabel: 'Around the AFL' },
};

/**
 * The post named no player. Production reaches this constantly — most Schefter
 * articles cast nobody — and it is the state that used to render as an
 * unstyled bordered card instead of a hero.
 */
export const NoCastPlayer = {
  args: { view: { ...theLeagueWaiverReport, model: null } },
};

/**
 * An ESPN contributor's post. The face and the name are the POST'S author, not
 * the house reporter's — putting Claude's byline on this would attribute
 * someone else's reporting to him.
 */
export const ExternalByline = {
  args: { view: externalBylineArticle },
};
