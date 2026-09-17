#!/usr/bin/env node
/**
 * Record every DISTINCT MFL transaction-string shape, from the committed feeds.
 *
 * `tests/fixtures/mfl-transaction-strings.json` is the corpus two independent
 * parsers are held to (`src/utils/contract-eligibility.ts#parseTransactionString`
 * and `scripts/lib/roster-move-parse.mjs#parseRosterMove`). It was recorded from
 * ONE league's ONE season, so it carried 10 shapes out of the 50-odd this league
 * has actually emitted — and the parity test that reads it therefore passed
 * while the two parsers genuinely disagreed on a shape neither had ever seen in
 * the fixture (#1158 F2). A corpus that cannot contain the counterexample is not
 * a corpus.
 *
 * This reads `data/<league>/mfl-feeds/<year>/transactions.json` for every league
 * in the registry and every season on disk, so the fixture spans both leagues
 * and all 20+ seasons without a network call or an API key.
 *
 *   node scripts/record-transaction-shapes.mjs            # rewrite the fixture
 *   node scripts/record-transaction-shapes.mjs --stdout   # print, write nothing
 *   node scripts/record-transaction-shapes.mjs --check     # exit 1 if stale
 *
 * Determinism: no timestamp is stamped and the example for a shape is the
 * lexicographically smallest string in its group, so re-recording an unchanged
 * set of feeds is byte-identical (docs/claude/rules/storage-and-build.md — a
 * feed writer that reorders regrows `.git`).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'tests/fixtures/mfl-transaction-strings.json');

/**
 * Mask the VALUES out of a transaction string, keeping its punctuation.
 * `"0517,|450000|8062,"` → `"N,|N|N,"`. Numeric forms are distinguished
 * because they are exactly what the parsers' regexes turn on: `D` is a
 * decimal bid ("1525000.00") and `E` is MFL's scientific notation
 * ("1.525e+06"), both of which an integer-only `\d+` silently misses.
 *
 * `Z` is the legacy no-drop SENTINEL `0000`, and it gets its own token on
 * purpose. It is a grammatical marker, not a value: no season of either
 * league has a player with that id, it never appears in a FREE_AGENT row or
 * in any post-2016 shape, and it stands in exactly where the modern format
 * writes an empty segment. Folded in with `N` it would share a group with a
 * real drop id and the corpus could never carry it as its own case.
 * Exported for tests.
 */
export function shapeOf(txnString) {
  return String(txnString ?? '')
    .replace(/(^|[|,])0000(?=$|[|,])/g, '$1Z')
    .replace(/\d+(?:\.\d*)?[eE][+-]?\d+/g, 'E')
    .replace(/\d+\.\d*/g, 'D')
    .replace(/\d+/g, 'N');
}

/** Read every roster/transaction row the committed feeds hold. Exported for tests. */
export function collectRows(root = ROOT) {
  const rows = [];
  for (const league of ALL_LEAGUES) {
    const base = join(root, league.dataPath, 'mfl-feeds');
    if (!existsSync(base)) continue;
    for (const season of readdirSync(base).sort()) {
      const file = join(base, season, 'transactions.json');
      if (!existsSync(file)) continue;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue; // a half-written feed is not a shape census's problem
      }
      let list = parsed?.transactions?.transaction ?? [];
      if (!Array.isArray(list)) list = [list];
      for (const txn of list) {
        if (!txn?.type) continue;
        rows.push({ league: league.slug, season, type: txn.type, txn: txn.transaction ?? '' });
      }
    }
  }
  return rows;
}

/** Group rows into one entry per (type, shape). Exported for tests. */
export function censusShapes(rows) {
  const groups = new Map();
  for (const row of rows) {
    const shape = shapeOf(row.txn);
    const key = `${row.type} ${shape}`;
    if (!groups.has(key)) {
      groups.set(key, { type: row.type, shape, examples: [], occurrences: 0, leagues: new Set(), seasons: new Set() });
    }
    const g = groups.get(key);
    g.occurrences += 1;
    g.examples.push(row.txn);
    g.leagues.add(row.league);
    g.seasons.add(row.season);
  }
  return [...groups.values()]
    .map(g => {
      const seasons = [...g.seasons].sort();
      return {
        type: g.type,
        shape: g.shape,
        // Smallest by codepoint, so the example does not change when MFL
        // reorders its array or a new season adds another row of the shape.
        example: g.examples.sort()[0],
        occurrences: g.occurrences,
        leagues: [...g.leagues].sort(),
        seasons: seasons.length === 1 ? seasons[0] : `${seasons[0]}-${seasons[seasons.length - 1]}`,
      };
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.shape.localeCompare(b.shape));
}

export function buildFixture(root = ROOT) {
  const shapes = censusShapes(collectRows(root));
  return {
    _provenance: {
      source: 'data/<league>/mfl-feeds/<year>/transactions.json — every league in the registry, every season on disk',
      recorder: 'scripts/record-transaction-shapes.mjs',
      note:
        'One entry per DISTINCT (type, string shape). These are real MFL strings, never hand-written: '
        + 'the add-only BBID shape was once fabricated by hand as "N,|N|," and MFL has never emitted that, '
        + 'which is how the drop-free waiver claim went unparsed. Re-record with the script above rather '
        + 'than editing by hand, and never delete a shape to make a test pass — a shape here is a row that '
        + 'really happened.',
    },
    shapes,
  };
}

function main(argv) {
  const stdout = argv.includes('--stdout');
  const check = argv.includes('--check');
  const json = `${JSON.stringify(buildFixture(), null, 2)}\n`;

  if (stdout) {
    process.stdout.write(json);
    return 0;
  }
  if (check) {
    // Compare the SHAPE SET, not the file. `occurrences` and `seasons` move
    // every time a cron writes a feed, so a byte comparison reports "stale"
    // on ordinary data syncs — and a check that cries wolf on every sync is
    // one people learn to ignore, which is how the corpus got stale enough to
    // matter in the first place. The invariant is which shapes exist; the
    // counts are documentation.
    const recorded = existsSync(FIXTURE)
      ? new Set(JSON.parse(readFileSync(FIXTURE, 'utf8')).shapes.map(s => `${s.type} ${s.shape}`))
      : new Set();
    const live = new Set(JSON.parse(json).shapes.map(s => `${s.type} ${s.shape}`));
    const unseen = [...live].filter(k => !recorded.has(k));
    const gone = [...recorded].filter(k => !live.has(k));
    if (unseen.length === 0) {
      console.log(
        `tests/fixtures/mfl-transaction-strings.json covers every shape in the feeds (${live.size}).`
        + (gone.length ? ` ${gone.length} recorded shape(s) no longer appear — keep them.` : '')
        + (readFileSync(FIXTURE, 'utf8') === json ? '' : ' (Counts have moved; re-record to refresh them.)'),
      );
      return 0;
    }
    console.error(
      'MFL is sending shapes the corpus has never seen. Re-record with '
      + '`node scripts/record-transaction-shapes.mjs`, then CHECK that both parsers read them:\n  '
      + unseen.join('\n  '),
    );
    return 1;
  }
  writeFileSync(FIXTURE, json);
  const { shapes } = JSON.parse(json);
  console.log(`Recorded ${shapes.length} distinct (type, shape) pairs to tests/fixtures/mfl-transaction-strings.json`);
  return 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
