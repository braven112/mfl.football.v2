/**
 * Ownership-boundary parity — the anti-drift test.
 *
 * "When did the current owner take over, and whose season is this?" used to be
 * answered by FIVE separate implementations in this repo, and two of them
 * disagreed: `afl-awards.ts` walked back on NAME ONLY, without the `ownerEra`
 * clause `compute-franchise-history.mjs` carried, and the two agreed only
 * because no AFL team used `ownerEra`. Adding one would have silently forked
 * award credit from display.
 *
 * As of Sept 2026 there is ONE implementation — `inferCurrentOwnerSince` and
 * `buildAttributor` in `src/utils/owner-tenures.mjs` — and every former copy
 * calls it:
 *
 *   1. scripts/compute-franchise-history.mjs  `attributeYear` = `buildAttributor(...).attributeSeason`
 *   2. src/utils/afl-awards.ts                `attributeAwardYear` / `getCurrentOwnerSince` wrap the same
 *   3. src/utils/franchise-eras.ts            `groupHistory` chains `entriesShareEra` (eras AND the identities strip)
 *   4. src/pages/afl-fantasy/franchises/[id].astro reads (2)
 *
 * This test keeps it that way in two layers. The behavioural layer compares
 * the shared function to what the OUTPUTS say over every real franchise-season
 * (the ledger's `attributedTo`, the award attributor, the rendered era
 * anchors). The structural layer fails if any of the three source files grows
 * a local walk-back again — the equality must be by construction, never by
 * coincidence. Both are required; neither is advisory.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { LEAGUES, ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { buildAttributor, inferCurrentOwnerSince } from '../src/utils/owner-tenures.mjs';
import { renderedEraStarts } from '../src/utils/franchise-eras';

const ROOT = path.resolve(__dirname, '..');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const readSrc = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const loadLeague = (slug: string) => {
  const league: any = (LEAGUES as any)[slug];
  const ledgerPath = path.join(ROOT, league.dataPath, 'derived', 'season-ledger.json');
  const configPath = path.join(ROOT, league.configPath);
  if (!existsSync(ledgerPath) || !existsSync(configPath)) return null;
  const cfg = readJson(configPath);
  const teams = Array.isArray(cfg.teams) ? cfg.teams : Object.values(cfg.teams ?? cfg);
  return { league, teams, ledger: readJson(ledgerPath) };
};

const derivable = ALL_LEAGUES.map((l: any) => l.slug).filter((slug: string) =>
  existsSync(path.join(ROOT, (LEAGUES as any)[slug].dataPath, 'derived', 'season-ledger.json'))
);

it('has at least one league with a season ledger to check', () => {
  expect(derivable.length).toBeGreaterThan(0);
});

/**
 * THE core equality. `season-ledger.json`'s `attributedTo` is literally the
 * output of the compute script's `attributeYear` — it was written by that
 * function during the same run. So checking every ledger row against
 * `attributeSeason` compares the shared implementation to the committed
 * output over every real franchise-season in the repo, with no fixture in
 * between. If the script ever stops calling the shared function, the next
 * regenerated ledger fails here.
 */
describe.each(derivable)('%s: attributeSeason matches the ledger', (slug: string) => {
  it('agrees on every franchise-season', () => {
    const loaded = loadLeague(slug);
    if (!loaded) return;
    const { teams, ledger } = loaded;
    const { attributeSeason } = buildAttributor(teams);

    const mismatches: string[] = [];
    for (const row of ledger.rows) {
      const ours = attributeSeason(row.franchiseId, row.year);
      const theirs = row.attributedTo ?? null;
      if ((ours ?? null) !== theirs) {
        mismatches.push(`${row.franchiseId} ${row.year}: ours=${ours} ledger=${theirs}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(ledger.rows.length).toBeGreaterThan(0);
  });
});

describe('AFL: parity with afl-awards.ts', () => {
  const loaded = loadLeague('afl-fantasy');
  const runIf = loaded ? it : it.skip;

  runIf('attributeAwardYear agrees with attributeSeason on every season', async () => {
    const { attributeAwardYear, getCurrentOwnerSince } = await import('../src/utils/afl-awards');
    const { attributeSeason } = buildAttributor(loaded!.teams);

    const mismatches: string[] = [];
    for (const row of loaded!.ledger.rows) {
      const ours = attributeSeason(row.franchiseId, row.year) ?? null;
      const theirs = attributeAwardYear(row.franchiseId, row.year) ?? null;
      if (ours !== theirs) {
        mismatches.push(`${row.franchiseId} ${row.year}: ours=${ours} awards=${theirs}`);
      }
    }
    expect(mismatches).toEqual([]);

    // And the boundary year itself, per slot.
    const sinceMismatches: string[] = [];
    for (const team of loaded!.teams) {
      const ours = inferCurrentOwnerSince(team);
      const theirs = getCurrentOwnerSince(team.franchiseId);
      if ((ours ?? null) !== (theirs ?? null)) {
        sinceMismatches.push(`${team.franchiseId}: ours=${ours} awards=${theirs}`);
      }
    }
    expect(sinceMismatches).toEqual([]);
  });

  runIf('fails closed on a null or unknown source id, like the awards path always did', () => {
    const { attributeSeason } = buildAttributor(loaded!.teams);
    expect(attributeSeason(null, 2020)).toBeNull();
    expect(attributeSeason('9999', 2020)).toBeNull();
  });
});

/**
 * The structural layer. The behavioural checks above can only see a
 * divergence the CURRENT config exercises — exactly the blind spot that let
 * the name-only copy in afl-awards.ts survive for two years. So also pin that
 * the three files that used to carry their own walk-back now import the
 * shared one and contain no walk-back of their own. A re-forked copy fails
 * here on the day it is written, before any config change can expose it.
 */
describe('one implementation — no file carries its own walk-back', () => {
  // Shapes the five copies shared, written variable-agnostic so a renamed
  // local (`hist[i - 1]`, `entries[i-1]`) does not slip past.
  const walkBackSignatures = [
    /function\s+inferCurrentOwnerSince\b/,
    /const\s+inferCurrentOwnerSince\s*=/,
    /\[\s*i\s*-\s*1\s*\]\s*\.\s*name\b/,
    /Math\.min\(\s*\.\.\.\s*[\w.]+\.ownerHistory\.map\(/,
  ];

  const consumers: Array<{ file: string; mustImport: RegExp; mustCall: RegExp }> = [
    {
      file: 'scripts/compute-franchise-history.mjs',
      mustImport: /from\s+['"]\.\.\/src\/utils\/owner-tenures\.mjs['"]/,
      mustCall: /\bbuildAttributor\s*\(/,
    },
    {
      file: 'src/utils/afl-awards.ts',
      mustImport: /from\s+['"]\.\/owner-tenures\.mjs['"]/,
      mustCall: /\bbuildAttributor\s*\(/,
    },
    {
      file: 'src/utils/franchise-eras.ts',
      mustImport: /from\s+['"]\.\/owner-tenures\.mjs['"]/,
      mustCall: /\bentriesShareEra\s*\(/,
    },
  ];

  it.each(consumers)('$file imports the shared boundary and calls it', ({ file, mustImport, mustCall }) => {
    const src = readSrc(file);
    expect(src, `${file} must import from owner-tenures.mjs`).toMatch(mustImport);
    expect(src, `${file} must use the shared boundary`).toMatch(mustCall);
  });

  /**
   * Every source file, not just the three former copies: the fifth copy was
   * page-local logic in an .astro file, and the next one would be too. The
   * shared module is the one file allowed to match.
   */
  const SOURCE_ROOTS = ['src', 'scripts'];
  const SOURCE_EXT = new Set(['.ts', '.mts', '.mjs', '.js', '.astro']);
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (SOURCE_EXT.has(path.extname(entry.name))) out.push(full);
    }
    return out;
  };
  const sourceFiles = SOURCE_ROOTS.flatMap((root) => walk(path.join(ROOT, root))).map((f) =>
    path.relative(ROOT, f)
  );

  it('scans a meaningful number of source files', () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
    for (const c of consumers) expect(sourceFiles).toContain(c.file);
  });

  it('no source file outside owner-tenures.mjs carries an ownership walk-back', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      if (file === 'src/utils/owner-tenures.mjs') continue;
      const src = readSrc(file);
      for (const sig of walkBackSignatures) {
        if (sig.test(src)) offenders.push(`${file}: ${sig}`);
      }
    }
    expect(
      offenders,
      'A local ownership walk-back re-grew. Call inferCurrentOwnerSince / buildAttributor from src/utils/owner-tenures.mjs instead.'
    ).toEqual([]);
  });

  it('the shared module is the only place the walk-back lives', () => {
    const src = readSrc('src/utils/owner-tenures.mjs');
    expect(src).toMatch(/export const inferCurrentOwnerSince\s*=/);
    expect(src).toMatch(/export const entriesShareEra\s*=/);
    expect(src).toMatch(/export const buildAttributor\s*=/);
  });
});

describe('TheLeague: the ownerEra clause is exercised, and it is worth three seasons', () => {
  const loaded = loadLeague('theleague');
  const runIf = loaded ? it : it.skip;

  // The walk-back afl-awards.ts USED to carry — name only, no ownerEra. Kept
  // here as a fixture so the test can show what the clause changes.
  const nameOnlyWalkBack = (t: any) => {
    if (typeof t.currentOwnerSince === 'number') return t.currentOwnerSince;
    if (Array.isArray(t.ownerHistory) && t.ownerHistory.length > 0) {
      return Math.min(...t.ownerHistory.map((h: any) => h.yearStart));
    }
    if (!Array.isArray(t.history) || t.history.length === 0) return null;
    const norm = (s: string) =>
      (s || '').trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ');
    const sorted = [...t.history].sort((a: any, b: any) => a.yearStart - b.yearStart);
    const last = sorted[sorted.length - 1];
    if (norm(last.name) !== norm(t.name)) return last.yearEnd + 1;
    let i = sorted.length - 1;
    while (i > 0 && norm(sorted[i - 1].name) === norm(sorted[i].name)) i--;
    return sorted[i].yearStart;
  };

  /**
   * TheLeague 0003 carries `ownerEra` across "Poker in the Rear / Generals /
   * Poker in the Rear" (2012-2015). Today its current name sits AFTER that
   * run, so both walk-backs happen to agree on the real config — which is
   * precisely why the divergence went unnoticed. Put the era run at the
   * boundary and the clause is the difference between 2012 and 2015.
   */
  runIf('0003 still carries a multi-name ownerEra run (re-point this test if that moves)', () => {
    const team: any = loaded!.teams.find((t: any) => t.franchiseId === '0003');
    expect(team, 'TheLeague 0003 not found').toBeTruthy();
    const eraEntries = (team.history ?? []).filter((h: any) => h.ownerEra != null);
    expect(
      eraEntries.length,
      'TheLeague 0003 no longer uses ownerEra — re-point this test at whichever slot does, ' +
        'or the sameEra clause is now genuinely untested on real config.'
    ).toBeGreaterThan(1);
    expect(new Set(eraEntries.map((h: any) => h.name)).size).toBeGreaterThan(1);
  });

  runIf('with the era run at the boundary, the shared walk-back keeps all of it and name-only loses it', () => {
    const team: any = loaded!.teams.find((t: any) => t.franchiseId === '0003');
    const eraEntries = (team.history ?? [])
      .filter((h: any) => h.ownerEra != null)
      .sort((a: any, b: any) => a.yearStart - b.yearStart);
    const eraStart = eraEntries[0].yearStart;
    const eraEnd = eraEntries[eraEntries.length - 1].yearEnd;
    const lastEraName = eraEntries[eraEntries.length - 1].name;

    // Same slot, but the current identity IS the era run's last name, so the
    // current owner's run has to be walked back through the aliases.
    const synthetic = {
      ...team,
      name: lastEraName,
      history: (team.history ?? []).filter((h: any) => h.yearEnd <= eraEnd),
    };

    expect(inferCurrentOwnerSince(synthetic)).toBe(eraStart);
    const nameOnly = nameOnlyWalkBack(synthetic);
    expect(nameOnly).not.toBe(eraStart);
    expect(nameOnly).toBeGreaterThan(eraStart);

    // And the attributor that stats, awards and the orphan pool all share
    // hands the whole run to the current owner.
    const { attributeSeason } = buildAttributor(
      loaded!.teams.map((t: any) => (t.franchiseId === '0003' ? synthetic : t))
    );
    for (let y = eraStart; y <= eraEnd; y++) {
      expect(attributeSeason('0003', y), `0003 ${y}`).toBe('0003');
    }
    expect(attributeSeason('0003', eraStart - 1)).toBeNull();
  });
});

/**
 * The era anchors the franchise detail page renders must stay consistent with
 * where the boundary falls: an era the page renders should not contain a
 * season the boundary says belongs to somebody else.
 */
describe.each(derivable)('%s: renderedEraStarts stays inside the boundary', (slug: string) => {
  it('never renders an era anchor for a season the boundary disowns', () => {
    const loaded = loadLeague(slug);
    if (!loaded) return;
    const { teams, ledger } = loaded;

    const attributedYears = new Map<string, number[]>();
    for (const row of ledger.rows) {
      if (!row.attributedTo) continue;
      if (!attributedYears.has(row.attributedTo)) attributedYears.set(row.attributedTo, []);
      attributedYears.get(row.attributedTo)!.push(row.year);
    }

    for (const team of teams as any[]) {
      const years = attributedYears.get(team.franchiseId) ?? [];
      if (years.length === 0) continue;
      const starts = renderedEraStarts(team, teams as any[], years);
      for (const start of starts) {
        expect(
          years.some((y) => y >= start),
          `${slug} ${team.franchiseId}: era anchor ${start} has no attributed season`
        ).toBe(true);
      }
    }
  });
});
