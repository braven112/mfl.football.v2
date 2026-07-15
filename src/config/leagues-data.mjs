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
    features: {
      contracts: true,
      salaryCap: true,
      keepers: false,
      powerRankings: true,
      liveLineups: true,
      schefterFeed: true,
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
      liveScoring: false,
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
