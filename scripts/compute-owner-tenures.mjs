#!/usr/bin/env node
/**
 * Owner tenures — derived data for every league that runs the franchise-history
 * pipeline.
 *
 * Writes data/<league>/derived/owner-tenures.json: one entry per owner tenure,
 * current and former, with the record, seasons, trophies and identities worn.
 * This is what gives the 110 (TheLeague) and 230 (AFL) orphaned
 * franchise-seasons — and the 14 championships and 73 division titles inside
 * them — a page to live on.
 *
 * The output MUST be committed, like franchise-history.json: the page wrappers
 * import it statically, and prebuild's `run()` is non-fatal, so a missing file
 * fails the build rather than degrading.
 *
 * Usage:
 *   node scripts/compute-owner-tenures.mjs                  # every league
 *   node scripts/compute-owner-tenures.mjs --league=afl
 *   node scripts/compute-owner-tenures.mjs --dry-run
 *
 * Leagues with no franchise-history.json are skipped structurally — which is
 * how best-ball-1 is excluded, with no special-casing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { buildOwnerTenures, makeIconResolver } from '../src/utils/owner-tenures.mjs';
import {
  loadLeagueInputs,
  makeAssetExists,
  LEAGUE_SLUGS,
  resolveLeagueArg,
} from './lib/owner-tenure-inputs.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REGISTRY_PATH = path.join(ROOT, 'src/data/owners-registry.json');

function parseArgs() {
  const opts = { league: null, dryRun: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--league') opts.league = resolveLeagueArg(args[++i]);
    else if (arg.startsWith('--league=')) opts.league = resolveLeagueArg(arg.slice('--league='.length));
  }
  return opts;
}

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

const outputPath = (league) =>
  path.join(ROOT, league.dataPath, 'derived', 'owner-tenures.json');

/**
 * Conservation: every ledger row lands on exactly one owner. This is the
 * invariant the whole feature rests on — a season that falls out here is a
 * season that vanishes from the site, which is precisely the bug being fixed.
 * Failing the RUN (not just a test) means a bad registry edit can never write
 * a lossy file in the first place.
 */
function assertConservation(slug, ledgerRows, payload) {
  const owned = [];
  for (const owner of payload.owners) {
    for (const tenure of owner.tenures) {
      for (const season of tenure.seasons) {
        owned.push(`${tenure.franchiseId}|${season.year}`);
      }
    }
  }
  const ledgerKeys = ledgerRows.map((r) => `${r.franchiseId}|${r.year}`);
  const ownedSet = new Set(owned);
  const problems = [];

  // A season may appear under more than one owner ONLY when those owners are
  // declared co-owners of a shared team. Anything else is a season quietly
  // counted twice.
  if (owned.length !== ownedSet.size) {
    const holdersOf = new Map();
    for (const owner of payload.owners) {
      for (const tenure of owner.tenures) {
        for (const season of tenure.seasons) {
          const key = `${tenure.franchiseId}|${season.year}`;
          if (!holdersOf.has(key)) holdersOf.set(key, []);
          holdersOf.get(key).push(owner);
        }
      }
    }
    const undeclared = [];
    for (const [key, holders] of holdersOf) {
      if (holders.length < 2) continue;
      const allShared = holders.every((o) => o.isShared);
      const mutual = holders.every((o) =>
        holders.filter((x) => x !== o).every((x) => o.coOwners.some((c) => c.slug === x.slug))
      );
      if (allShared && mutual) continue;
      undeclared.push(`${key} (${holders.map((h) => h.slug).join(', ')})`);
    }
    if (undeclared.length > 0) {
      problems.push(
        `${undeclared.length} season(s) under more than one owner without a declared shared ` +
          `team: ${undeclared.slice(0, 5).join('; ')}`
      );
    }
  }
  const missing = ledgerKeys.filter((k) => !ownedSet.has(k));
  if (missing.length > 0) {
    problems.push(`${missing.length} ledger season(s) on no owner: ${missing.slice(0, 5).join(', ')}`);
  }
  const extra = [...ownedSet].filter((k) => !ledgerKeys.includes(k));
  if (extra.length > 0) {
    problems.push(`${extra.length} owner season(s) not in the ledger: ${extra.slice(0, 5).join(', ')}`);
  }

  // One live owner per slot. An owner who moved slots is still `isCurrent`,
  // but is no longer the current owner OF the slot they left, so this counts
  // currentFranchiseId rather than tenure membership.
  const liveCounts = new Map();
  for (const owner of payload.owners) {
    if (!owner.currentFranchiseId) continue;
    if (!liveCounts.has(owner.currentFranchiseId)) liveCounts.set(owner.currentFranchiseId, []);
    liveCounts.get(owner.currentFranchiseId).push(owner);
  }
  // A shared team legitimately has two current owners on one slot, so this
  // counts HOLDINGS: co-owners of the same slot collapse to one.
  const contested = [];
  for (const [slot, holders] of liveCounts) {
    if (holders.length < 2) continue;
    const allShared = holders.every((o) => o.isShared);
    if (allShared) continue;
    contested.push(`${slot} (${holders.map((h) => h.slug).join(', ')})`);
  }
  if (contested.length > 0) {
    problems.push(`slot(s) with more than one current owner: ${contested.join('; ')}`);
  }

  if (problems.length > 0) {
    throw new Error(`[owner-tenures] ${slug} conservation failed:\n  - ${problems.join('\n  - ')}`);
  }
}

async function runLeague(slug, opts, registry) {
  const league = LEAGUES[slug];
  const inputs = loadLeagueInputs(ROOT, league);
  if (!inputs) {
    console.log(`  [${slug}] no franchise-history.json — skipping (not an error)`);
    return null;
  }

  const payload = buildOwnerTenures({
    league,
    teams: inputs.teams,
    ledgerRows: inputs.ledgerRows,
    yearSummaries: inputs.yearSummaries,
    feedIdentityFor: inputs.feedIdentityFor,
    registry,
    // Verify against the real public/ tree so a dead config URL falls through
    // to the documented placeholder instead of shipping a 404.
    resolveIcon: makeIconResolver({
      league,
      teams: inputs.teams,
      assetExists: makeAssetExists(ROOT),
    }),
  });

  assertConservation(slug, inputs.ledgerRows, payload);

  const out = outputPath(league);
  if (opts.dryRun) {
    console.log(
      `  [${slug}] dry-run — would write ${path.relative(ROOT, out)}: ` +
        `${payload.counts.total} owners (${payload.counts.current} current, ${payload.counts.former} former), ` +
        `${payload.counts.seasons} seasons`
    );
    return payload;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(
    `  [${slug}] wrote ${path.relative(ROOT, out)}: ` +
      `${payload.counts.total} owners (${payload.counts.current} current, ${payload.counts.former} former), ` +
      `${payload.counts.seasons} seasons`
  );
  return payload;
}

async function main() {
  const opts = parseArgs();
  const slugs = opts.league ? [opts.league] : LEAGUE_SLUGS;
  const registry = readJson(REGISTRY_PATH);
  if (!registry) {
    console.warn(
      `  [owner-tenures] ${path.relative(ROOT, REGISTRY_PATH)} not found — deriving from inference alone`
    );
  }

  console.log(`\n👤 Owner tenures — ${slugs.join(', ')}\n`);
  // Leagues touch disjoint files — run them concurrently.
  await Promise.all(slugs.map((slug) => runLeague(slug, opts, registry)));
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
