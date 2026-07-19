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
 *   - tradeBait:        scanner lane for MFL trade-bait listings.
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
 * Scanner-only toggles stay here as code consts (per CLAUDE.md: feature
 * gates live in code, not GitHub Actions vars).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../../src/config/leagues-data.mjs';

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
    registrySlug: reg.slug,
    leagueId: reg.id,
    playersPath: (year) => path.join(projectRoot, reg.dataPath, 'mfl-feeds', String(year), 'players.json'),
    baseUrl: `https://${reg.domains[0]}`,
    calendarUrl: `https://${reg.domains[0]}/calendar`,
    feedPath: path.join(projectRoot, reg.schefterFeedPath),
    configPath: path.join(projectRoot, reg.configPath),
    ...overrides,
  };
}

export const SCHEFTER_LEAGUES = [
  buildSchefterLeague('theleague', {
    eventsPath: path.join(projectRoot, 'src', 'data', 'theleague', 'resolved-events.json'),
    groupMeSchefterBotId: process.env.GROUPME_SCHEFTER_BOT_ID,
    groupMeRogerBotId: process.env.GROUPME_ROGER_BOT_ID,
    features: {
      rumorMill: getLeagueBySlug('theleague').features.schefterTips,
      tradeBait: true,
      eventReminders: true,
      // TheLeague uses the rumor mill + big-drop flow for GroupMe; no direct posting in scanLeague
      directGroupMe: false,
      tradeOfferRumors: true,
      groupmeListen: true,
    },
  }),
  buildSchefterLeague('afl-fantasy', {
    eventsPath: path.join(projectRoot, 'data', 'afl-fantasy', 'resolved-events.json'),
    groupMeSchefterBotId: process.env.GROUPME_AFL_SCHEFTER_BOT_ID,
    groupMeRogerBotId: process.env.GROUPME_AFL_ROGER_BOT_ID,
    features: {
      rumorMill: getLeagueBySlug('afl-fantasy').features.schefterTips,
      tradeBait: false,
      eventReminders: true,
      // AFL posts breaking/standard transactions directly to GroupMe from scanLeague
      directGroupMe: true,
      // Deferred for AFL — see module doc.
      tradeOfferRumors: false,
      groupmeListen: false,
    },
  }),
];

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
