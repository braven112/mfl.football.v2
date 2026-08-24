#!/usr/bin/env node
/**
 * Populate `displayName` in src/data/owners-registry.json from MFL.
 *
 * MFL's `league` export returns owner names — but ONLY to a request carrying
 * the cookie of a user with commissioner access. Every league.json committed
 * in this repo was fetched unauthenticated, which is why all 44 of them carry
 * no owner field at all and why the feature shipped anonymous. This script is
 * the authenticated path.
 *
 * ── PRIVACY: NAMES ONLY ───────────────────────────────────────────────────
 * The same authenticated response also contains EMAIL ADDRESSES. This script
 * extracts names and nothing else: emails are never stored, never printed,
 * never written to disk, and the raw response is never cached. If you add a
 * field here, check it is not PII first. `assertNoContactInfo` fails the run
 * if anything email-shaped reaches the output.
 *
 * ── Why this can name FORMER owners too ───────────────────────────────────
 * Each MFL league-year is its own league. Fetching 2009's league with a
 * commissioner cookie returns the people who owned those franchises IN 2009 —
 * not today's owners. So a year-by-year sweep can name the previous owners
 * whose seasons this whole feature exists to surface, not just the 40 current
 * ones.
 *
 * ── Credentials ───────────────────────────────────────────────────────────
 * Either:
 *   MFL_USERNAME=... MFL_PASSWORD=... node scripts/fetch-owner-names.mjs
 * or, if you already have a session cookie:
 *   MFL_COOKIE='MFL_USER_ID=...' node scripts/fetch-owner-names.mjs
 *
 * Usage:
 *   node scripts/fetch-owner-names.mjs                 # dry run — prints what it would set
 *   node scripts/fetch-owner-names.mjs --write         # apply to owners-registry.json
 *   node scripts/fetch-owner-names.mjs --league=afl    # one league
 *   node scripts/fetch-owner-names.mjs --year=2009     # one year
 *
 * A name a human already set is NEVER overwritten. A tenure where MFL reports
 * two different owners is reported and left alone — that is a tenure the
 * registry should probably SPLIT, and guessing would bury the signal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { mflFetch, loginToMFL } from './lib/mfl-api.mjs';
import { LEAGUE_SLUGS, resolveLeagueArg } from './lib/owner-tenure-inputs.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REGISTRY_PATH = path.join(ROOT, 'src/data/owners-registry.json');

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs() {
  const opts = { league: null, year: null, write: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--write') opts.write = true;
    else if (arg === '--dry-run') opts.write = false;
    else if (arg.startsWith('--league=')) opts.league = resolveLeagueArg(arg.slice('--league='.length));
    else if (arg.startsWith('--year=')) opts.year = Number(arg.slice('--year='.length));
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/fetch-owner-names.mjs [--league=<slug|afl>] [--year=YYYY] [--write]\n' +
          '  Needs MFL_USERNAME + MFL_PASSWORD, or MFL_COOKIE.\n' +
          '  Dry run by default. Names only — emails are never stored.'
      );
      process.exit(0);
    }
  }
  return opts;
}

/**
 * The only fields we are willing to read off a franchise. Deliberately a
 * whitelist: MFL adds fields over time and a blacklist would silently start
 * capturing whatever it adds next.
 */
const NAME_FIELDS = ['owner_name', 'ownerName'];

export const cleanName = (raw) => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  // MFL sometimes stores a co-owned team as "A and B" / "A & B" / "A, B".
  // Keep it whole — the registry expresses co-ownership with two PEOPLE and
  // `shared: true`, and silently splitting here would invent claims.
  return trimmed;
};

/** Fail loudly rather than let anything email-shaped reach the registry. */
export const assertNoContactInfo = (value, where) => {
  if (typeof value !== 'string') return;
  if (/@/.test(value) || /https?:\/\//i.test(value)) {
    throw new Error(
      `Refusing to write "${where}": value looks like contact info, not a name. ` +
        `This script must never store email addresses.`
    );
  }
};

async function resolveCookies() {
  if (process.env.MFL_COOKIE) return process.env.MFL_COOKIE;
  const username = process.env.MFL_USERNAME;
  const password = process.env.MFL_PASSWORD;
  if (!username || !password) {
    console.error(
      'No credentials. Set MFL_COOKIE, or MFL_USERNAME + MFL_PASSWORD.\n' +
        'Owner names are only returned to a user with commissioner access.'
    );
    process.exit(1);
  }
  const result = await loginToMFL(username, password);
  const cookies = typeof result === 'string' ? result : result?.cookies ?? null;
  if (!cookies) {
    console.error('Login did not return a usable cookie — check the credentials.');
    process.exit(1);
  }
  return cookies;
}

/** Years this league actually has feeds for — the years with owners to name. */
function yearsFor(league, only) {
  const feedsDir = path.join(ROOT, league.dataPath, 'mfl-feeds');
  if (!fs.existsSync(feedsDir)) return [];
  const years = fs
    .readdirSync(feedsDir)
    .map(Number)
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b);
  return only ? years.filter((y) => y === only) : years;
}

async function fetchOwnersForYear(league, year, cookies) {
  const url = `https://${league.mflHost}/${year}/export?TYPE=league&L=${league.id}&JSON=1`;
  const res = await mflFetch({ url, cookies, timeoutMs: 15_000 });
  let payload;
  try {
    payload = typeof res === 'string' ? JSON.parse(res) : res?.body ? JSON.parse(res.body) : res;
  } catch {
    return null;
  }
  const franchises = payload?.league?.franchises?.franchise ?? [];
  const byFranchise = new Map();
  for (const franchise of Array.isArray(franchises) ? franchises : [franchises]) {
    if (!franchise?.id) continue;
    for (const field of NAME_FIELDS) {
      const name = cleanName(franchise[field]);
      if (name) {
        assertNoContactInfo(name, `${league.slug} ${year} franchise ${franchise.id}`);
        byFranchise.set(franchise.id, name);
        break;
      }
    }
  }
  return byFranchise;
}

/**
 * Fold per-season observations onto tenures: every season a person claims
 * votes for a name, and a tenure needs ONE answer.
 *
 * Exported so tests can cover it without a network or credentials — the
 * conflict rule in particular, which is the difference between recording a
 * boundary and burying it.
 */
export function foldNamesOntoTenures(registry, observed) {
  const proposals = [];
  const conflicts = [];
  for (const person of registry.people) {
    if (person.displayName) continue; // never overwrite a human's edit
    const votes = new Map();
    for (const claim of person.claims ?? []) {
      const end = Math.min(claim.yearEnd, 3000);
      for (let year = claim.yearStart; year <= end; year++) {
        const name = observed.get(`${claim.league}|${claim.franchiseId}|${year}`);
        if (!name) continue;
        votes.set(name, (votes.get(name) ?? 0) + 1);
      }
    }
    if (votes.size === 0) continue;
    if (votes.size > 1) {
      // Two names across one tenure usually means the tenure should be SPLIT.
      // Naming it after whichever appeared more would hide exactly the
      // boundary the registry exists to record.
      conflicts.push({
        id: person.id,
        slug: person.slug,
        names: [...votes.entries()].map(([n, c]) => `${n} (${c}y)`),
      });
      continue;
    }
    const [name] = [...votes.keys()];
    assertNoContactInfo(name, person.id);
    proposals.push({ person, name });
  }
  return { proposals, conflicts };
}

async function main() {
  const opts = parseArgs();
  const slugs = opts.league ? [opts.league] : LEAGUE_SLUGS;
  const registry = readJson(REGISTRY_PATH);
  if (!registry) {
    console.error(`${path.relative(ROOT, REGISTRY_PATH)} not found — run seed-owners-registry.mjs first.`);
    process.exit(1);
  }

  const cookies = await resolveCookies();
  console.log(`\n👤 Owner names from MFL — ${slugs.join(', ')}\n`);

  // (league|franchiseId|year) -> name, straight from MFL.
  const observed = new Map();
  for (const slug of slugs) {
    const league = LEAGUES[slug];
    const years = yearsFor(league, opts.year);
    if (years.length === 0) {
      console.log(`  [${slug}] no feed years — skipping`);
      continue;
    }
    let named = 0;
    for (const year of years) {
      let byFranchise = null;
      try {
        byFranchise = await fetchOwnersForYear(league, year, cookies);
      } catch (err) {
        console.warn(`  [${slug}] ${year}: ${err.message}`);
      }
      if (!byFranchise || byFranchise.size === 0) {
        console.log(`  [${slug}] ${year}: no owner names returned (not commissioner for this year?)`);
      } else {
        for (const [franchiseId, name] of byFranchise) {
          observed.set(`${slug}|${franchiseId}|${year}`, name);
        }
        named += byFranchise.size;
      }
      await sleep(600); // be polite to MFL
    }
    console.log(`  [${slug}] collected ${named} franchise-year owner names across ${years.length} years`);
  }

  if (observed.size === 0) {
    console.log('\n  Nothing collected. Without commissioner access MFL returns no owner names.\n');
    return;
  }

  const { proposals, conflicts } = foldNamesOntoTenures(registry, observed);

  console.log(`\n  would name:        ${proposals.length}`);
  console.log(`  already named:     ${registry.people.filter((p) => p.displayName).length}`);
  console.log(`  conflicting:       ${conflicts.length}`);
  console.log(`  still unnamed:     ${registry.people.filter((p) => !p.displayName).length - proposals.length - conflicts.length}`);

  for (const { person, name } of proposals.slice(0, 20)) {
    console.log(`    + ${person.slug.padEnd(38)} ${name}`);
  }
  if (proposals.length > 20) console.log(`    … and ${proposals.length - 20} more`);

  if (conflicts.length > 0) {
    console.log('\n  ⚠ tenures MFL reports more than one owner for — these probably need SPLITTING:');
    for (const c of conflicts) console.log(`    ! ${c.slug.padEnd(38)} ${c.names.join(' / ')}`);
  }

  if (!opts.write) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --write.\n`);
    return;
  }

  for (const { person, name } of proposals) {
    person.displayName = name;
    person.seededFrom = `mfl:league-export@${new Date().toISOString().slice(0, 10)}`;
  }
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
  console.log(`\n  wrote ${path.relative(ROOT, REGISTRY_PATH)} — ${proposals.length} names set`);
  console.log('  Now re-run: pnpm compute:owner-tenures\n');
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
