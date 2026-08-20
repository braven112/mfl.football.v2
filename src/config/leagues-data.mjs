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
    features: {
      contracts: true,
      salaryCap: true,
      keepers: false,
      powerRankings: true,
      liveLineups: true,
      schefterFeed: true,
      schefterTips: true,
      liveScoring: true,
    },
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
    features: {
      contracts: false,
      salaryCap: false,
      keepers: true,
      powerRankings: false,
      liveLineups: false,
      schefterFeed: true,
      schefterTips: true,
      liveScoring: true,
    },
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
    },
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
