/**
 * League registry — the single source of truth for every per-league constant.
 *
 * Plain .mjs so both the Astro app (via src/config/leagues.ts, which adds
 * types) and node cron scripts (import '../src/config/leagues-data.mjs') can use
 * it. Never hardcode a league id, slug, data path, or domain anywhere else —
 * look it up here. Adding a league = adding one entry to LEAGUES (plus DNS /
 * Vercel domain attachment for its apex domains).
 */

export const LEAGUES = {
  theleague: {
    /** MFL numeric league id */
    id: '13522',
    /** Canonical slug: path segment under src/pages/ and in URLs */
    slug: 'theleague',
    /** Short slug used by nav config / styles (LeagueSlug type) */
    navSlug: 'theleague',
    name: 'The League',
    /** MFL server hostname for this league */
    mflHost: 'www49.myfantasyleague.com',
    /** Repo-relative data directory written by the fetch pipelines */
    dataPath: 'data/theleague',
    /** Apex domains that serve this league (bare + www) */
    domains: ['theleague.us', 'www.theleague.us'],
    /**
     * The single canonical host for absolute URLs to this league (nav
     * cross-league switch links, admin article links, announcements). The
     * www variant matches what Vercel serves and what users browse; session
     * cookies are host-only, so every generated absolute URL must agree on
     * this host or logins appear to vanish across links. Use leagueOrigin()
     * — don't pick from `domains` ad hoc.
     */
    canonicalDomain: 'www.theleague.us',
    /**
     * Repo-relative league config + Schefter feed locations. TheLeague's
     * live under src/data (build-time imports); AFL's under its dataPath.
     * These are the single source of truth — consumers (article pipeline,
     * schedule-strength compute, schefter-scan) must read them from here,
     * not re-encode the paths.
     */
    configPath: 'src/data/theleague.config.json',
    schefterFeedPath: 'src/data/theleague/schefter-feed.json',
    /**
     * The Owners' Poll — the weekly owner vote that publishes inside The
     * Pecking Order. See docs/plans/owners-poll.md.
     *
     * `slots` is the ballot depth (rank your top N), NOT the field size, and
     * the two are deliberately independent: a 7-slot ballot in a 16-team
     * league leaves a tail the poll does not order, which is a stated design
     * trade rather than an oversight. It lives here rather than as a constant
     * because the AFL's 24-team field would want a different depth, and
     * because tests/league-literal-guard.test.ts is the thing that keeps a
     * number like this from being retyped into three modules.
     *
     * `quorum` is the minimum ballots required to publish a consensus at all —
     * below it the column runs algorithm-only and says so. Half the field.
     *
     * `closeWeekday` / `closeHourPT` are when the ballot shuts (0=Sun).
     * THURSDAY, not Wednesday, and that is a turnout decision: setting a
     * lineup before the first kickoff is the one obligatory weekly action in
     * this league and it mostly happens Wed-Sun, so a Wednesday deadline
     * closed before the highest-traffic weekly action even began. The close is
     * additionally clamped to just before the real first kickoff, so a
     * Thanksgiving week (games at ~10:00 PT) cannot take votes after two games
     * have been played.
     */
    ownersPoll: {
      enabled: true,
      slots: 7,
      quorum: 8,
      closeWeekday: 4,
      closeHourPT: 16,
    },
    features: {
      contracts: true,
      salaryCap: true,
      keepers: false,
      powerRankings: true,
      liveLineups: true,
      schefterFeed: true,
      schefterTips: true,
      liveScoring: true,
      offseasonAuction: true,
      accounting: true,
    },
    /**
     * Prize table for the commissioner's accounting page, straight from the
     * constitution's PAYOUTS section. Amounts are DOLLARS OWED TO the winner —
     * the accounting writer converts them to MFL's sign convention, which is
     * not the same thing (see docs/claude/rules/accounting.md).
     *
     * `prizePool` is the constitution's stated total and exists ONLY so the
     * page can show plan-vs-pool and surface a drift. It is never used to
     * scale or cap a payout.
     */
    payouts: {
      prizePool: 712,
      prizes: [
        { key: 'champion', label: 'League Champion', amount: 300, source: { kind: 'placement', place: 1 } },
        { key: 'second', label: '2nd Place', amount: 150, source: { kind: 'placement', place: 2 } },
        { key: 'third', label: '3rd Place', amount: 100, source: { kind: 'placement', place: 3 } },
        { key: 'fourth', label: '4th Place', amount: 50, source: { kind: 'placement', place: 4 } },
        { key: 'fifth', label: '5th Place', amount: 45, source: { kind: 'placement', place: 5 } },
        { key: 'sixth', label: '6th Place', amount: 25, source: { kind: 'placement', place: 6 } },
        // $3 x 14 weeks. The WEEK COUNT is not a constant to trust blindly:
        // the planner pays whichever regular-season weeks actually have
        // scores, and `weeks` is the expected count it reconciles against.
        { key: 'weekly-high', label: 'Weekly High Score', amount: 3, source: { kind: 'weekly-high', weeks: 14 } },
      ],
    },
    // Contract dynasty league — long-horizon value is the right opening board.
    defaultRankingSources: ['fantasycalc', 'sharks', 'mfl-adp'],
    /**
     * Weeks that run Throwback Week — franchises wear a legacy identity from
     * their `history[]` era instead of their current one. Only TheLeague runs
     * it today; a league without the key simply never triggers it. Read by
     * `src/data/theleague/throwback-weeks.mjs` (the app's accessor) and by the
     * schedule-release lock, which reserves a marquee slot for the week.
     */
    throwbackWeeks: [4],
  },
  'afl-fantasy': {
    id: '19621',
    slug: 'afl-fantasy',
    navSlug: 'afl',
    name: 'AFL',
    mflHost: 'www44.myfantasyleague.com',
    dataPath: 'data/afl-fantasy',
    domains: ['afl-fantasy.com', 'www.afl-fantasy.com'],
    /** See TheLeague entry — canonical host for absolute URLs. */
    canonicalDomain: 'www.afl-fantasy.com',
    /** See TheLeague entry — single source of truth for these locations. */
    configPath: 'data/afl-fantasy/afl.config.json',
    schefterFeedPath: 'data/afl-fantasy/schefter-feed.json',
    /**
     * League-year rollover (month is 1-indexed). AFL flips to the new MFL
     * league year on June 1 — NOT TheLeague's Feb 14 date — because the new
     * AFL season isn't created on MFL until late spring. Consumed by
     * getAflLeagueYear() in src/utils/league-year.ts. Hard flip: on/after this
     * date AFL points at the new year regardless of whether the MFL league
     * exists yet, so the new league must be created on MFL by June 1.
     */
    leagueYearRollover: { month: 6, day: 1 },
    /**
     * AFL runs 24 franchises as duplicate-player conferences — the same NFL
     * player can be rostered by two franchises at once. Any logic that treats
     * "player is on some other roster" as meaningful (e.g. the cut-player
     * ownership preflight) must not draw conclusions from other franchises'
     * rosters in this league.
     */
    duplicatePlayers: true,
    /**
     * The Owners' Poll. See docs/plans/owners-poll.md; the shared machinery is
     * the same as TheLeague's and only these numbers differ.
     *
     * ONE 24-team ballot, not two conference-scoped ones. That fork was left
     * open when the poll shipped, and it is settled the way the column it
     * publishes inside already is: the AFL Pecking Order ranks all 24
     * franchises in a single list, so a conference-scoped poll would print a
     * consensus that disagrees with the machine ranking beside it on which
     * teams are even comparable. Duplicate players make cross-conference
     * comparison awkward to argue about, which is the entertainment, not a
     * defect.
     *
     * `slots` is 10, proportional to TheLeague's 7-of-16 rather than copied
     * from it — 7 of 24 would rank under a third of the field and leave most
     * of the league tied at zero. It stays well under the field size (the
     * unranked block is the design; see the plan's "One tension worth
     * naming").
     *
     * `quorum` is 12 — half the field, the same RULE as TheLeague's 8-of-16
     * rather than the same number. Below it the column runs algorithm-only and
     * says so.
     */
    ownersPoll: {
      enabled: true,
      slots: 10,
      quorum: 12,
      closeWeekday: 4,
      closeHourPT: 16,
    },
    features: {
      contracts: false,
      salaryCap: false,
      keepers: true,
      powerRankings: false,
      liveLineups: false,
      schefterFeed: true,
      schefterTips: true,
      liveScoring: true,
      offseasonAuction: false,
      accounting: true,
    },
    /**
     * AFL prize table (constitution PAYOUTS). The AFL pays for WINNING, and
     * almost every prize resolves off something the league already publishes.
     *
     * The playoff-side prizes are the subtle ones. The AFL has SIX divisions
     * but pays only FOUR division titles: each conference sends four teams —
     * its two best division winners (seeds 1-2) plus two wild cards (seeds
     * 3-4) — so a third division winner who misses the playoffs is not paid.
     * Both prizes therefore key off PLAYOFF SEED, not off a division-title
     * award slug: seeds 1-2 are the paid division champions, seeds 3-4 the
     * wild cards. Paying all six division slugs instead totals $2,525 against
     * a $2,220 pool; paying the four seeds totals $2,225, which is the pool
     * within the same rounding TheLeague's "approximately $712" carries.
     * Confirmed with the commissioner, Aug 2026 — do not "fix" this back to
     * six division awards.
     */
    payouts: {
      prizePool: 2220,
      prizes: [
        { key: 'afl-championship', label: 'League Championship', amount: 300, source: { kind: 'award', slug: 'afl-championship' } },
        { key: 'al-champion', label: 'AL Champion', amount: 150, source: { kind: 'award', slug: 'al-champion' } },
        { key: 'nl-champion', label: 'NL Champion', amount: 150, source: { kind: 'award', slug: 'nl-champion' } },
        // Seeds 1-2 in each conference bracket: the division winners who
        // actually reached the playoffs. Four paid, not six.
        { key: 'division-title', label: 'Division Championship', amount: 150, source: { kind: 'playoff-seed', seeds: [1, 2] } },
        // Seeds 3-4: the playoff teams that did not win a division.
        { key: 'wild-card', label: 'Wild Card', amount: 100, source: { kind: 'playoff-seed', seeds: [3, 4] } },
        { key: 'premier-league', label: 'Premier League Champion', amount: 225, source: { kind: 'tier-rank', tier: 'Premier League', rank: 1 } },
        { key: 'premier-league-2', label: 'Premier League 2nd', amount: 150, source: { kind: 'tier-rank', tier: 'Premier League', rank: 2 } },
        { key: 'premier-league-3', label: 'Premier League 3rd', amount: 100, source: { kind: 'tier-rank', tier: 'Premier League', rank: 3 } },
        { key: 'premier-league-4', label: 'Premier League 4th', amount: 50, source: { kind: 'tier-rank', tier: 'Premier League', rank: 4 } },
        { key: 'dleague-champion', label: 'D-League Champion', amount: 50, source: { kind: 'tier-rank', tier: 'D-League', rank: 1 } },
        { key: 'nit', label: 'NIT Champion', amount: 50, source: { kind: 'award', slug: 'nit' } },
      ],
    },
    // Keeper league that re-drafts most of the roster every year, so the
    // defaults lean redraft/ADP. FantasyCalc dynasty stays AVAILABLE, just
    // not on by default — it overrates youth for a one-season horizon.
    defaultRankingSources: ['mfl-adp', 'espn', 'sharks'],
    /**
     * Week 8, deliberately NOT TheLeague's Week 4 — the two leagues share
     * owners and a site, so spacing the events apart gives each its own
     * moment instead of one crowded weekend.
     *
     * Week 8 is also a plain 12-matchup slate. The AFL plays doubleheaders in
     * weeks 1, 2 and one LATE week that moves year to year (12 in 2023/2026,
     * 13 in 2024/2025) — picking one of those would have made the throwback
     * week a derived value rather than a constant, with the same
     * copy-last-year's-number trap `schedule-optimization.md` documents.
     */
    throwbackWeeks: [8],
  },
  'best-ball-1': {
    id: '37610',
    slug: 'best-ball-1',
    navSlug: 'bb1',
    name: 'Best Ball #1',
    mflHost: 'www45.myfantasyleague.com',
    dataPath: 'data/best-ball-1',
    /**
     * Path-only league: served at /best-ball-1 on the site's own domains
     * (mfl.football), no dedicated apex. Best-ball sister leagues
     * (#2, #3, …) will follow the same pattern.
     */
    domains: [],
    configPath: 'data/best-ball-1/bb1.config.json',
    schefterFeedPath: 'data/best-ball-1/schefter-feed.json',
    /**
     * Best-ball leagues are re-created on MFL each summer ahead of the
     * startup draft, so the league year rolls with the new-league
     * creation window (same clock as AFL), not TheLeague's Feb 14.
     */
    leagueYearRollover: { month: 6, day: 1 },
    /**
     * Draft-only best-ball league: the startup draft is the whole game.
     * No lineups, no add/drops, no in-season roster management — UI that
     * offers any of those must be skipped for leagues with this flag.
     */
    bestBall: true,
    /**
     * No Owners' Poll here, and not because nobody got to it: the poll ranks
     * TEAMS week to week, and a best-ball league has no weekly team story to
     * rank — no lineups, no in-season management, and it is draft-only
     * (docs/claude/rules/best-ball.md). The entry exists disabled so the shape
     * is present everywhere and shared components never branch on undefined.
     */
    ownersPoll: { enabled: false, slots: 0, quorum: 0, closeWeekday: 4, closeHourPT: 16 },
    features: {
      contracts: false,
      salaryCap: false,
      keepers: false,
      powerRankings: false,
      liveLineups: false,
      schefterFeed: false,
      schefterTips: false,
      /**
       * Results-shaped, not management-shaped — with no lineups to set,
       * scoreboard watching is the whole in-season experience here.
       */
      liveScoring: true,
      /** Draft-only: nothing is acquired here after the draft. */
      offseasonAuction: false,
      /**
       * Draft-only league: no MFL syncing, no commissioner write path, and no
       * prize table in its rules. Turning this on would make the accounting
       * page the FIRST write into bb1's MFL league — don't, without deciding
       * that separately.
       */
      accounting: false,
    },
    // Redraft best-ball: one season, no keepers, no contracts — straight
    // redraft ADP is exactly the right opening board.
    defaultRankingSources: ['mfl-adp', 'espn', 'sharks'],
  },
};

export const DEFAULT_LEAGUE_SLUG = 'theleague';

export const ALL_LEAGUES = Object.values(LEAGUES);

/** MFL numeric id of the default league. Use instead of hardcoding '13522'. */
export const DEFAULT_LEAGUE_ID = LEAGUES[DEFAULT_LEAGUE_SLUG].id;

/** @param {string} slug Canonical slug ('theleague' | 'afl-fantasy') */
export function getLeagueBySlug(slug) {
  return LEAGUES[slug] ?? null;
}

/** @param {string} id MFL numeric league id */
export function getLeagueById(id) {
  return ALL_LEAGUES.find((l) => l.id === id) ?? null;
}

/**
 * Resolve a URL pathname to its league (e.g. '/afl-fantasy/rosters').
 * Falls back to the default league for unprefixed paths.
 * @param {string} pathname
 */
export function getLeagueByPath(pathname) {
  for (const league of ALL_LEAGUES) {
    if (pathname === `/${league.slug}` || pathname.startsWith(`/${league.slug}/`)) {
      return league;
    }
  }
  return LEAGUES[DEFAULT_LEAGUE_SLUG];
}

/**
 * Default host for MFL COMMISSIONER WRITES, honoring the MFL_WRITE_HOST env
 * override. Commissioner imports fail on the api.myfantasyleague.com
 * gateway — they must go to the league's own web host. Shared by
 * mfl-contract-writer.ts, apply-pending-contracts.mjs, and
 * sync-draft-pick-contracts.mjs so the invariant lives in one place.
 *
 * @param {Record<string, string | undefined>} [env] Defaults to process.env.
 */
export function defaultMflWriteHost(env = process.env) {
  return env.MFL_WRITE_HOST || `https://${LEAGUES[DEFAULT_LEAGUE_SLUG].mflHost}`;
}

/**
 * The shared app host that serves every league under its path prefix
 * (/theleague/*, /afl-fantasy/*). Fallback target for absolute cross-league
 * URLs when a league has no apex domain of its own.
 */
export const SHARED_APP_ORIGIN = 'https://mfl.football';

/**
 * Canonical absolute origin for a league (e.g. 'https://www.theleague.us'),
 * or null when the league has no apex domain. THE way to build absolute
 * URLs to a league — session cookies are host-only, so every producer of
 * absolute league URLs (nav switch links, admin article links, GroupMe
 * announcements, OG tags) must agree on one host per league.
 *
 * @param {{ canonicalDomain?: string, domains?: string[] }} league Registry entry.
 */
export function leagueOrigin(league) {
  const domain =
    league.canonicalDomain ??
    league.domains?.find((d) => d.startsWith('www.')) ??
    league.domains?.[0];
  return domain ? `https://${domain}` : null;
}

/**
 * Strip a league's OWN path prefix from an internal path.
 *
 * Internal routes are stored prefixed (`/theleague/calendar`) because that's
 * the real Astro route and the only form that works on the shared host. On the
 * league's apex domain the prefix is redundant — middleware rewrites `/calendar`
 * and vercel.json 301s `/theleague/calendar` back to it — so an absolute link
 * built by naive concatenation reads `https://www.theleague.us/theleague/calendar`
 * and costs a redirect hop.
 *
 * Only the league's own slug is stripped: a cross-league link
 * (`/afl-fantasy/...` in a TheLeague post) must keep its prefix to resolve.
 *
 * @param {{ slug: string }} league Registry entry.
 * @param {string} path Internal path, with or without the prefix.
 */
export function stripLeaguePrefix(league, path) {
  const prefix = `/${league.slug}`;
  if (path === prefix) return '/';
  if (!path.startsWith(prefix)) return path;
  const rest = path.slice(prefix.length);
  // Boundary-checked so `/theleague-foo` isn't mangled mid-segment.
  if (!/^[/?#]/.test(rest)) return path;
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/** True when `path` already starts with SOME league's slug prefix. */
function hasAnyLeaguePrefix(path) {
  return ALL_LEAGUES.some((l) => stripLeaguePrefix(l, path) !== path);
}

/**
 * The mirror of stripLeaguePrefix: guarantee a league-local path carries its
 * prefix, which is what routes on the SHARED host (mfl.football) — the only
 * place a league without its own apex domain is reachable.
 *
 * A path already prefixed for ANY league is returned untouched, so a
 * cross-league link never gets double-prefixed onto the wrong league.
 *
 * @param {{ slug: string }} league Registry entry.
 * @param {string} path Internal path, with or without the prefix.
 */
export function ensureLeaguePrefix(league, path) {
  if (hasAnyLeaguePrefix(path)) return path;
  return path === '/' ? `/${league.slug}` : `/${league.slug}${path}`;
}

/**
 * THE way to build an absolute URL to a page for a league — canonical host
 * (see leagueOrigin) plus the path in whichever form that host actually routes.
 * Never concatenate an origin and a path by hand.
 *
 * Total in both directions, so callers don't have to know which kind of league
 * they hold: on a league's own apex domain the prefix is redundant and gets
 * STRIPPED; on the shared host (path-only leagues — no apex domain) it is
 * required and gets ADDED. Pass either form and get a URL that resolves.
 *
 * @param {{ slug: string, canonicalDomain?: string, domains?: string[] }} league
 * @param {string} [path] Internal path (prefixed or not), e.g. '/theleague/calendar'.
 */
export function leagueUrl(league, path = '/') {
  // Already absolute (or protocol-relative) — pass through untouched. Feed
  // links are not always internal: `post.link` on an ESPN item is a full
  // https:// URL, and treating one as a path would emit the nonsense
  // `https://www.theleague.us/https://www.espn.com/...`.
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(path)) return path;
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const origin = leagueOrigin(league);
  if (!origin) return `${SHARED_APP_ORIGIN}${ensureLeaguePrefix(league, withSlash)}`;
  return `${origin}${stripLeaguePrefix(league, withSlash)}`;
}

/** Apex hostname → canonical slug map, derived from each league's domains. */
export function buildHostToSlugMap() {
  /** @type {Record<string, string>} */
  const map = {};
  for (const league of ALL_LEAGUES) {
    for (const domain of league.domains) {
      map[domain] = league.slug;
    }
  }
  return map;
}
/**
 * Which BUILT-IN ranking sources are ticked into "My Rank" by default, per
 * league. Every source is AVAILABLE everywhere — this only decides the
 * starting composite, because the right default depends on how the league
 * drafts: dynasty trade values are the wrong opening board for a league that
 * re-drafts, and a straight redraft ADP is the wrong one for a contract
 * dynasty league.
 *
 * An owner's own tick/weight choices always win after the first visit; this
 * is a starting point, not a policy. Ids come from
 * scripts/fetch-ranking-sources.mjs.
 *
 * Every league carries its own rankings storage (see rankings-scope.ts), so
 * every league can carry its own defaults.
 */
export const DEFAULT_RANKING_SOURCES_FALLBACK = ['mfl-adp', 'sharks'];

/** Built-in ranking sources ticked on by default for a league slug. */
export function defaultRankingSourcesFor(slug) {
  return LEAGUES[slug]?.defaultRankingSources ?? DEFAULT_RANKING_SOURCES_FALLBACK;
}
