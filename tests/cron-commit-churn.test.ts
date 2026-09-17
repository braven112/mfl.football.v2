/**
 * A scan that found nothing must commit nothing.
 *
 * ## The bug this exists for
 *
 * `schefter-scan.yml` commits six files. Two of them are rewritten from
 * scratch on every run and carry a top-level clock reading —
 * `resolved-events.json` (`computedAt`, from compute-league-events.mjs, which
 * the workflow runs as its first step) and `groupme-suppressions.json`
 * (`generatedAt`, empty on almost every run). Written with a plain
 * `fs.writeFile`, each one leaves a one-line diff behind whether or not the
 * scan found a single transaction. So the workflow committed on EVERY run, and
 * **every commit to `main` is a production build** — 91% of the Vercel bill.
 *
 * It hid for months behind GitHub's dropped scheduler: the job was delivered
 * 5-8 times a day and committed 5-8 times a day, and 1:1 reads as "every run
 * had news" rather than "every run commits regardless". Moving the schedule
 * onto the reliable Vercel cron bridge is what turned it into real money — the
 * same trap the roster sync hit at a flat quarter-hourly cadence, where 42
 * dispatches produced 43 commits.
 *
 * The fix is the repo's existing one: `writeJsonIfChanged`
 * (scripts/lib/canonical-json.mjs) with the run clock in `ignoreKeys`, so an
 * unchanged payload keeps its old timestamp on disk and produces no diff,
 * while a real change still writes the fresh stamp. Nothing reads either
 * field.
 *
 * ## Why a test rather than a note
 *
 * The plain write is the obvious thing to type, and its failure mode is
 * invisible from the script: the run is green, the file is correct, the diff
 * is one line, and the cost lands on a bill nobody reads next to the scan.
 * This pins the three writers feeding the bridged workflows; the cadence
 * itself is pinned by tests/vercel-cron-targets.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/**
 * Writers whose output is committed by a Vercel-cron-bridged workflow AND
 * carries a per-run timestamp. `key` is the field that must be ignored during
 * the comparison; `writes` is how many such writes the file performs.
 */
const CHURNY_WRITERS: { file: string; key: string; writes: number; committedBy: string }[] = [
  {
    file: 'scripts/compute-league-events.mjs',
    key: 'computedAt',
    // TheLeague and the AFL each get their own resolved-events.json.
    writes: 2,
    committedBy: 'schefter-scan.yml (first step: "Recompute league events")',
  },
  {
    file: 'scripts/schefter-scan.mjs',
    key: 'generatedAt',
    writes: 1,
    committedBy: 'schefter-scan.yml',
  },
  {
    file: 'scripts/schefter-rumor-scan.mjs',
    key: 'generatedAt',
    writes: 1,
    committedBy: 'schefter-rumor-scan.yml, which shares the suppressions file',
  },
];

describe('cron-committed files do not churn on a quiet run', () => {
  it.each(CHURNY_WRITERS)(
    '$file writes through writeJsonIfChanged, ignoring $key',
    ({ file, key, writes, committedBy }) => {
      const src = read(file);

      expect(
        src.includes("from './lib/canonical-json.mjs'"),
        `${file} does not import writeJsonIfChanged. Its output is committed by ` +
          `${committedBy}, and a plain write rewrites the \`${key}\` stamp on ` +
          `every run — which commits, which is a production build.`,
      ).toBe(true);

      const guarded = [...src.matchAll(/writeJsonIfChanged\(/g)].length;
      expect(
        guarded,
        `${file} should perform ${writes} skip-if-unchanged write(s) and does ` +
          `${guarded}. A new timestamped output committed by ${committedBy} ` +
          `needs the same treatment — or this count needs updating with it.`,
      ).toBe(writes);

      const ignored = [...src.matchAll(/ignoreKeys:\s*\[([^\]]*)\]/g)].filter((m) =>
        m[1].includes(`'${key}'`),
      ).length;
      expect(
        ignored,
        `${file} writes through writeJsonIfChanged but does not put '${key}' in ` +
          `ignoreKeys, so the comparison sees the run clock and writes anyway. ` +
          `The skip only happens when the volatile field is excluded.`,
      ).toBe(writes);
    },
  );

  it.each(CHURNY_WRITERS)('$file has no plain write of a $key payload left', ({ file, key }) => {
    // The shape being refused: a `writeFile`/`writeFileSync` call whose payload
    // literal opens with the run clock. Comment lines are dropped first — this
    // file's own reasoning quotes the broken form, and a scanner that cannot
    // tell code from commentary fails the file that is doing it right.
    const code = read(file)
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
      })
      .join('\n');

    const offenders = [...code.matchAll(/writeFile(?:Sync)?\(([\s\S]{0,200}?)\)/g)].filter((m) =>
      new RegExp(`${key}\\s*:`).test(m[1]),
    );
    expect(
      offenders.length,
      `${file} still writes a \`${key}\` payload with a plain writeFile. Use ` +
        `writeJsonIfChanged(path, json, { ignoreKeys: ['${key}'] }) — a run ` +
        `that changed nothing must leave the file byte-identical.`,
    ).toBe(0);
  });
});
