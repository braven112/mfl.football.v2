/**
 * Shared input loading for the owner-tenure scripts.
 *
 * `seed-owners-registry.mjs` and `compute-owner-tenures.mjs` need the same
 * four things per league — config teams, the season ledger, the year summaries
 * that carry the raw trophy ids, and the MFL feed's own team names for gap
 * fill. Loading them in one place keeps the seeder and the compute from
 * drifting into two slightly different views of the same league.
 *
 * Every path comes from the league registry (`LEAGUE.dataPath` /
 * `LEAGUE.configPath`) — never a literal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LEAGUES } from '../../src/config/leagues-data.mjs';

export const LEAGUE_SLUGS = Object.keys(LEAGUES);

/** Accepts the documented `afl` alias, matching compute-franchise-history.mjs. */
export const resolveLeagueArg = (arg) => {
  const slug = arg === 'afl' ? 'afl-fantasy' : arg;
  if (!LEAGUE_SLUGS.includes(slug)) {
    console.error(
      `Unknown --league=${arg}. Known: ${LEAGUE_SLUGS.join(', ')} (or the alias 'afl').`
    );
    process.exit(1);
  }
  return slug;
};

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

/**
 * Load everything the derivation needs for one league.
 *
 * Returns null when the league has no computed franchise history — which is
 * how best-ball-1 is excluded. It is a structural skip, not a special case:
 * any league that doesn't run the franchise-history pipeline simply has no
 * owners file, and the guard tests skip it the same way.
 */
export const loadLeagueInputs = (root, league) => {
  const derivedDir = path.join(root, league.dataPath, 'derived');
  const historyPath = path.join(derivedDir, 'franchise-history.json');
  const ledgerPath = path.join(derivedDir, 'season-ledger.json');
  if (!fs.existsSync(historyPath) || !fs.existsSync(ledgerPath)) return null;

  const configPath = path.join(root, league.configPath);
  const rawConfig = readJson(configPath);
  if (!rawConfig) return null;
  const teams = Array.isArray(rawConfig.teams)
    ? rawConfig.teams
    : Object.values(rawConfig.teams ?? rawConfig);

  const history = readJson(historyPath);
  const ledger = readJson(ledgerPath);

  // The MFL feed's own name for a franchise in a given season. Used only for
  // gap fill — years no config `history[]` entry covers. Read lazily and
  // cached per year; a missing feed simply yields no name and the identity
  // stays null rather than guessing.
  const feedCache = new Map();
  const feedIdentityFor = (franchiseId, year) => {
    if (!feedCache.has(year)) {
      const feedPath = path.join(root, league.dataPath, 'mfl-feeds', String(year), 'league.json');
      const byId = new Map();
      const feed = readJson(feedPath);
      const franchises = feed?.league?.franchises?.franchise ?? [];
      for (const franchise of Array.isArray(franchises) ? franchises : [franchises]) {
        if (!franchise?.id) continue;
        byId.set(franchise.id, {
          name: franchise.name ?? null,
          // Feed icon/logo URLs point at MFL's host, not our asset tree — the
          // icon resolver repairs them, so don't carry them through.
          icon: null,
          banner: null,
        });
      }
      feedCache.set(year, byId);
    }
    return feedCache.get(year).get(franchiseId) ?? null;
  };

  return {
    teams,
    ledgerRows: ledger.rows ?? [],
    yearSummaries: history.yearSummaries ?? [],
    historyPath,
    ledgerPath,
    derivedDir,
  };
};

/**
 * Does this asset actually exist under public/? Used by the icon resolver so a
 * dead config URL falls through to the documented placeholder rather than
 * shipping a 404 into the derived file.
 */
export const makeAssetExists = (root) => {
  const cache = new Map();
  return (assetPath) => {
    if (!assetPath || !assetPath.startsWith('/assets/')) return false;
    if (!cache.has(assetPath)) {
      cache.set(assetPath, fs.existsSync(path.join(root, 'public', assetPath.replace(/^\//, ''))));
    }
    return cache.get(assetPath);
  };
};
