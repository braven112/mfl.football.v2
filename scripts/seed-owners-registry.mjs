#!/usr/bin/env node
/**
 * Seed src/data/owners-registry.json — the league-neutral ledger of people.
 *
 * The registry is HAND-EDITED config. This script exists only to write the
 * first version of it, so a human starts from a complete ledger of every owner
 * tenure in every league rather than an empty file. After that it is a
 * once-in-a-while tool for adopting newly-inferred tenures, not part of any
 * build.
 *
 * Two rules make it safe to re-run:
 *
 *   1. **It never rewrites an existing slug.** Slugs are URLs. A person already
 *      in the file keeps their id, slug and displayName no matter what the
 *      inference now says; only genuinely new tenures are appended.
 *   2. **--dry-run is the DEFAULT.** Pass --write to actually touch the file.
 *
 * Every seeded person gets `displayName: null`. Owner names exist nowhere in
 * this repo — MFL's league.json carries no owner field in any league-year, and
 * the only names anywhere are 15 first names in a code comment. Pages title
 * themselves by the identities worn until a human fills these in (PR 4).
 *
 * Usage:
 *   node scripts/seed-owners-registry.mjs                 # dry run, prints a summary
 *   node scripts/seed-owners-registry.mjs --write         # actually write the file
 *   node scripts/seed-owners-registry.mjs --league=afl    # one league only
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { buildOwnerTenures } from '../src/utils/owner-tenures.mjs';
import { loadLeagueInputs, LEAGUE_SLUGS, resolveLeagueArg } from './lib/owner-tenure-inputs.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REGISTRY_PATH = path.join(ROOT, 'src/data/owners-registry.json');

function parseArgs() {
  const opts = { league: null, write: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--write') opts.write = true;
    else if (arg === '--dry-run') opts.write = false;
    else if (arg.startsWith('--league=')) opts.league = arg.slice('--league='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/seed-owners-registry.mjs [--league=<slug|afl>] [--write]\n' +
          '  Dry run by default. --write updates src/data/owners-registry.json.'
      );
      process.exit(0);
    }
  }
  return opts;
}

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

/** `own-0001`, `own-0002`, … — opaque and sequence-assigned, never regenerated. */
const formatOwnerId = (n) => `own-${String(n).padStart(4, '0')}`;

async function main() {
  const opts = parseArgs();
  const slugs = opts.league ? [resolveLeagueArg(opts.league)] : LEAGUE_SLUGS;

  const existing = readJson(REGISTRY_PATH) ?? { version: 1, people: [] };
  const people = [...(existing.people ?? [])];

  // A tenure is "already known" when some person claims its exact opening
  // season on its slot. Keyed that way rather than by slug so a human who
  // renamed a slug, or merged two tenures, is never given a duplicate back.
  const claimedSeasons = new Set();
  for (const person of people) {
    for (const claim of person.claims ?? []) {
      const end = Math.min(claim.yearEnd, 3000);
      for (let year = claim.yearStart; year <= end; year++) {
        claimedSeasons.add(`${claim.league}|${claim.franchiseId}|${year}`);
      }
    }
  }

  const usedSlugs = new Set(people.flatMap((p) => [p.slug, ...(p.previousSlugs ?? [])]));
  let nextId =
    people.reduce((max, p) => {
      const match = /^own-(\d+)$/.exec(p.id ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;

  const added = [];
  const skipped = [];

  for (const slug of slugs) {
    const league = LEAGUES[slug];
    const inputs = loadLeagueInputs(ROOT, league);
    if (!inputs) {
      console.log(`  [${slug}] no franchise-history/season-ledger — skipping`);
      continue;
    }

    const derived = buildOwnerTenures({
      league,
      teams: inputs.teams,
      ledgerRows: inputs.ledgerRows,
      yearSummaries: inputs.yearSummaries,
      feedIdentityFor: inputs.feedIdentityFor,
      // Seed from pure inference: the point is to capture what inference says
      // so a human can correct it. Overlaying the registry would make the
      // output a fixed point of itself and hide newly-inferred tenures.
      registry: null,
      generatedAt: 'seed',
    });

    for (const owner of derived.owners) {
      const firstTenure = owner.tenures[0];
      const openingKey = `${slug}|${firstTenure.franchiseId}|${firstTenure.yearStart}`;
      if (claimedSeasons.has(openingKey)) {
        skipped.push(`${slug} ${owner.slug}`);
        continue;
      }

      // Slugs are frozen once written. Disambiguate only against slugs already
      // in the file (or claimed earlier in this run).
      let slugCandidate = owner.slug;
      if (usedSlugs.has(slugCandidate)) {
        slugCandidate = `${owner.slug}-${firstTenure.franchiseId}`;
        let n = 2;
        while (usedSlugs.has(slugCandidate)) {
          slugCandidate = `${owner.slug}-${firstTenure.franchiseId}-${n++}`;
        }
      }
      usedSlugs.add(slugCandidate);

      const claims = owner.tenures.map((tenure) => ({
        league: slug,
        franchiseId: tenure.franchiseId,
        // An open-ended tenure stays open-ended so next season flows in
        // without a registry edit.
        yearStart: tenure.yearStart,
        yearEnd:
          owner.isCurrent && tenure.franchiseId === owner.currentFranchiseId
            ? 9999
            : tenure.yearEnd,
      }));

      for (const claim of claims) {
        const end = Math.min(claim.yearEnd, 3000);
        for (let year = claim.yearStart; year <= end; year++) {
          claimedSeasons.add(`${slug}|${claim.franchiseId}|${year}`);
        }
      }

      people.push({
        id: formatOwnerId(nextId++),
        slug: slugCandidate,
        previousSlugs: [],
        displayName: null,
        claims,
        seededFrom: `inferred:identity-split@${new Date().toISOString().slice(0, 10)}`,
        notes: null,
      });
      added.push({ league: slug, slug: slugCandidate, title: owner.title, isCurrent: owner.isCurrent });
    }
  }

  const output = { version: 1, people };

  console.log(`\n👤 Owners registry — ${slugs.join(', ')}\n`);
  console.log(`  existing people: ${existing.people?.length ?? 0}`);
  console.log(`  new tenures:     ${added.length}`);
  console.log(`  already claimed: ${skipped.length}`);
  for (const entry of added.slice(0, 12)) {
    console.log(`    + ${entry.league.padEnd(12)} ${entry.slug.padEnd(40)} ${entry.isCurrent ? '(current)' : ''} ${entry.title}`);
  }
  if (added.length > 12) console.log(`    … and ${added.length - 12} more`);

  if (!opts.write) {
    console.log(
      `\n  DRY RUN — nothing written. Re-run with --write to update ${path.relative(ROOT, REGISTRY_PATH)}\n`
    );
    return;
  }

  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\n  wrote ${path.relative(ROOT, REGISTRY_PATH)} (${people.length} people)\n`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
