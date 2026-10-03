/**
 * Schefter per-league configuration — the single place where the Schefter
 * pipelines (transaction scanner, rumor-mill scanner, articles) learn a
 * league's paths, GroupMe bots, and which sub-pipelines run for it.
 *
 * Extracted from scripts/schefter-scan.mjs so the rumor-mill scanner and the
 * transaction scanner share one league table (AFL_DUPLICATION_PLAN §2.4).
 *
 * Feature semantics:
 *   - rumorMill:        derives from the registry's `features.schefterTips`
 *                       flag — the owner-facing tips → rumor pipeline. To
 *                       launch (or kill) a league's rumor mill, flip the
 *                       registry flag in src/config/leagues-data.mjs.
 *   - tradeBait:        scanner lane for MFL trade-bait listings (both
 *                       leagues; keys are league-scoped via schefterKey).
 *   - eventReminders:   Roger-style event reminder posts.
 *   - directGroupMe:    transaction scanner posts straight to GroupMe
 *                       (AFL) instead of routing through the rumor-mill
 *                       big-drop flow (TheLeague).
 *   - tradeOfferRumors: the pending-trade-offer leak lane. TheLeague-only:
 *                       AFL needs MFL pendingOffer access and the
 *                       duplicate-players escalation model re-thought first.
 *   - groupmeListen:    GroupMe @mention → tip ingestion. TheLeague-only
 *                       until AFL GroupMe message ingestion exists.
 *
 * The per-league lane toggles live in each registry entry's `schefter`
 * block (code, not GitHub Actions vars, per CLAUDE.md).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, getLeagueBySlug, leagueOrigin, leagueUrl } from '../../src/config/leagues-data.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Build a Schefter league config from the registry entry plus per-pipeline
 * overrides. Kept API-compatible with the original schefter-scan.mjs helper.
 */
export function buildSchefterLeague(registrySlug, overrides) {
  const reg = getLeagueBySlug(registrySlug);
  if (!reg) throw new Error(`Unknown league in registry: ${registrySlug}`);
  return {
    // navSlug = 'theleague' | 'afl' — the short slug already used throughout
    // the scanners (e.g. for post.league and Redis key prefixes).
    slug: reg.navSlug,
    /**
     * The SAME value as `slug`, under the name the shared helpers ask for.
     *
     * Not redundancy. A Schefter league's `slug` is the nav slug while a
     * REGISTRY entry's `slug` is the canonical one ('afl' vs 'afl-fantasy'),
     * so the two shapes disagree on what `slug` means and anything taking
     * "a league" has to pick one. `postToGroupMeCapped` asks for `navSlug`
     * and throws without it — including for exempt kinds, since the guard
     * sits above the exemption check — which took out every GroupMe post
     * from this scanner, Roger's deadline reminders included.
     */
    navSlug: reg.navSlug,
    registrySlug: reg.slug,
    leagueId: reg.id,
    // Per-league MFL year rollover (AFL: June 1; absent → Feb 14). Read by
    // scripts/lib/schefter-league-year.mjs#leagueYearFor.
    leagueYearRollover: reg.leagueYearRollover,
    playersPath: (year) => path.join(projectRoot, reg.dataPath, 'mfl-feeds', String(year), 'players.json'),
    /**
     * Any other MFL feed file for a season, resolved off the registry's
     * dataPath. Roger's clapback lane reads rosters/league/draftResults through
     * this rather than joining a league directory by hand — the
     * league-literal guard forbids the literal, and the registry is the only
     * thing that knows where a league's feeds actually live.
     */
    feedFilePath: (year, file) =>
      path.join(projectRoot, reg.dataPath, 'mfl-feeds', String(year), file),
    // Canonical (cookie-safe) host — leagueOrigin, never domains[0] ad hoc:
    // session cookies are host-only, so a bare-apex link opens logged-out.
    baseUrl: leagueOrigin(reg),
    calendarUrl: leagueUrl(reg, `/${reg.slug}/calendar`),
    /**
     * Absolute URL for an internal path. Takes the PREFIXED route
     * (`/theleague/calendar`) and drops the prefix on the league's own apex
     * host — never concatenate baseUrl with a prefixed path by hand, or the
     * post ships `theleague.us/theleague/calendar` and burns a 301.
     */
    url: (p) => leagueUrl(reg, p),
    feedPath: path.join(projectRoot, reg.schefterFeedPath),
    configPath: path.join(projectRoot, reg.configPath),
    ...overrides,
  };
}

/**
 * Every registry league that declares a `schefter` block runs the scanners.
 * The block (leagues-data.mjs) carries the league's events file, the NAMES of
 * its GroupMe env vars, and which lanes run; nothing here is per-league, so a
 * new league opts in from its registry entry alone. A league with the news
 * feed but no block (Archie's) has a feed page and no scanner.
 */
export const SCHEFTER_LEAGUES = ALL_LEAGUES.filter((reg) => reg.schefter).map((reg) => {
  const { eventsPath, env, lanes } = reg.schefter;
  return buildSchefterLeague(reg.slug, {
    eventsPath: path.join(projectRoot, eventsPath),
    groupMeSchefterBotId: process.env[env.schefterBot],
    groupMeRogerBotId: process.env[env.rogerBot],
    // READ credentials — distinct from the bot ids above, which only post.
    groupMeGroupId: process.env[env.groupId],
    groupMeRogerBotSenderId: process.env[env.rogerSender],
    features: {
      rumorMill: reg.features.schefterTips,
      ...lanes,
    },
  });
});

/**
 * Look up a Schefter league by canonical slug ('theleague' | 'afl-fantasy')
 * or navSlug ('theleague' | 'afl'). Throws on unknown slugs — a scanner
 * running against a league it doesn't know is always a bug.
 */
export function getSchefterLeague(slug) {
  const found = SCHEFTER_LEAGUES.find(
    (l) => l.slug === slug || l.registrySlug === slug,
  );
  if (!found) throw new Error(`getSchefterLeague: unknown league "${slug}"`);
  return found;
}
