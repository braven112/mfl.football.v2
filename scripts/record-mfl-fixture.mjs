#!/usr/bin/env node
/**
 * Record an MFL export as a deterministic test fixture.
 *
 * MFL returns array elements in NONDETERMINISTIC order
 * (docs/claude/rules/storage-and-build.md). A fixture pasted from a browser
 * tab carries whatever order that one response had, so a test written
 * against it can pass on the recording and fail on the next re-record for
 * no semantic reason — or, worse, encode "first element" assumptions that
 * hold only by accident. This records through the registry (no literal ids
 * or hosts), sorts every array by a stable key, and stamps provenance so the
 * fixture says where it came from and when.
 *
 *   node scripts/record-mfl-fixture.mjs --league theleague --type rosters --year 2026 \
 *     [--extra "&FRANCHISE=0001"] [--out tests/fixtures/mfl/theleague-rosters-2026.json] [--stdout]
 *
 * Sorting: arrays of objects sort by the first present of `id`, `player`,
 * `franchise`, `week`, `name`; arrays of scalars sort lexically. Object keys
 * are sorted. Sorting is applied to the FIXTURE ONLY — never re-sort a live
 * feed file on disk, because MFL's standings row order is the league's
 * official order (see the rules doc above).
 *
 * Output goes under tests/fixtures/mfl/ by default; the directory is created.
 * Refuses to overwrite unless --force is passed, so a fixture a test depends
 * on is not silently replaced by a different snapshot.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getLeagueBySlug, ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { fetchExport } from './lib/mfl-api.mjs';

const SORT_KEYS = ['id', 'player', 'franchise', 'week', 'name'];

function parseArgs(argv) {
  const out = { extra: '', force: false, stdout: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--league') out.league = next();
    else if (a === '--type') out.type = next();
    else if (a === '--year') out.year = next();
    else if (a === '--extra') out.extra = next();
    else if (a === '--out') out.out = next();
    else if (a === '--force') out.force = true;
    else if (a === '--stdout') out.stdout = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

/** Deterministic deep copy: sorted keys, arrays sorted by a stable key. Exported for tests. */
export function canonicalizeForFixture(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonicalizeForFixture);
    const allObjects = items.every((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (allObjects) {
      // A key only counts when every element has it as a SCALAR — `franchise`
      // is an array on schedule matchups and `player` is '' on unmade picks,
      // and a non-discriminating key leaves elements in MFL's arbitrary input
      // order. Ties (and no key at all) fall back to the whole canonical
      // element, so the result is a function of content alone.
      const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
      const key = SORT_KEYS.find((k) => items.every((v) => k in v && scalar(v[k]) && v[k] !== ''));
      const whole = (v) => JSON.stringify(v);
      return items.sort((a, b) => {
        if (key) {
          const c = String(a[key]).localeCompare(String(b[key]), 'en', { numeric: true });
          if (c !== 0) return c;
        }
        return whole(a).localeCompare(whole(b));
      });
    }
    return items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalizeForFixture(value[k]);
    return out;
  }
  return value;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const errors = [];
  const league = a.league ? getLeagueBySlug(a.league) : null;
  if (!league) errors.push(`--league must be one of ${ALL_LEAGUES.map((l) => l.slug).join(', ')}`);
  if (!a.type) errors.push('--type is required (an MFL export TYPE, e.g. rosters, players, league, standings)');
  if (!a.year || !/^\d{4}$/.test(a.year)) errors.push('--year YYYY is required');
  if (errors.length) {
    console.error('record-mfl-fixture: cannot proceed\n  ' + errors.join('\n  '));
    process.exit(2);
  }
  const out = a.out ?? `tests/fixtures/mfl/${league.slug}-${a.type}-${a.year}${a.extra ? '-' + a.extra.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() : ''}.json`;
  if (!a.stdout && existsSync(join(process.cwd(), out)) && !a.force) {
    console.error(`record-mfl-fixture: ${out} exists — pass --force to replace a fixture tests may depend on.`);
    process.exit(2);
  }

  const host = league.mflHost.replace(/\.myfantasyleague\.com$/, '');
  const raw = await fetchExport(
    { host, leagueId: league.id, year: a.year, type: a.type, extra: a.extra },
    { retries: 2, sleepMs: 500, timeoutMs: 15_000, userAgent: 'mfl.football fixture recorder' },
  );
  const fixture = {
    $fixture: {
      league: league.slug,
      type: a.type,
      year: a.year,
      extra: a.extra || undefined,
      recordedAt: new Date().toISOString(),
      note: 'Arrays sorted by a stable key for determinism (scripts/record-mfl-fixture.mjs). MFL itself returns them in arbitrary order — tests must not depend on position.',
    },
    data: canonicalizeForFixture(raw),
  };
  const text = JSON.stringify(fixture, null, 2) + '\n';
  if (a.stdout) {
    process.stdout.write(text);
    return;
  }
  mkdirSync(dirname(join(process.cwd(), out)), { recursive: true });
  // codeql[js/http-to-file-access] — persisting the MFL response IS the purpose: this records a test fixture to a path built from validated CLI args, never from the response.
  writeFileSync(join(process.cwd(), out), text);
  console.log(`wrote ${out} (${(text.length / 1024).toFixed(1)} KB)`);
}

const invokedDirectly = process.argv[1] && /record-mfl-fixture\.mjs$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
