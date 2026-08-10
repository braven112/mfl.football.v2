import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAllNFLTeamCodes, normalizeTeamCode, TEAM_CODE_MAP } from '../src/utils/nfl-logo';

/**
 * NFL logo asset guardrail.
 *
 * Player cells across every league render self-hosted team logos from
 * `public/assets/nfl-logos/{CODE}.svg`. Those files being missing is not a
 * cosmetic problem: the apex domains sit behind Cloudflare, which (until the
 * Aug 2026 settings fix) stamped `max-age=14400` on responses INCLUDING
 * 404s, so a single broken window poisoned every visitor's browser cache
 * for 4 hours after the origin was fixed — which is exactly how "missing
 * team images" kept resurfacing through Aug 2026 despite repeated fixes.
 * (The files were originally never committed at all; they reached main by
 * accident on 2026-08-08.)
 *
 * Three invariants, so a regression fails CI instead of shipping:
 *
 * 1. Every canonical ESPN code has a committed, well-formed SVG.
 * 2. Every MFL/legacy alias in TEAM_CODE_MAP has a committed SVG under the
 *    alias filename too — several pages (players list, roster opponent
 *    cells, calculator, mvp) render the RAW feed code without normalizing
 *    first. That includes `FA` and `UFA` (shield copies): call sites that
 *    default to 'FA' build `/assets/nfl-logos/FA.svg` verbatim. The single
 *    exception is `FA*` (MFL's conditional free agent), which cannot be a
 *    sane cross-platform filename — every renderer must shield-guard it in
 *    code (FA-prefix checks), and normalizeTeamCode maps it to 'NFL'.
 * 3. Every distinct `team` value in the committed MFL datasets — player
 *    feeds for all leagues and years, plus the salary snapshots — resolves
 *    to a committed file both raw and normalized. New data with an
 *    unmapped code breaks the build here, not on owners' phones.
 */

const ROOT = process.cwd();
const LOGOS_DIR = join(ROOT, 'public', 'assets', 'nfl-logos');

/** Codes that cannot be a filename — renderers must shield-guard them. */
const UNFILEABLE_CODES = new Set(['FA*']);

function svgPath(code: string): string {
  return join(LOGOS_DIR, `${code}.svg`);
}

function expectValidSvg(code: string, context: string): void {
  const file = svgPath(code);
  expect(existsSync(file), `${context}: public/assets/nfl-logos/${code}.svg is missing`).toBe(true);
  const content = readFileSync(file, 'utf-8');
  expect(
    /^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(content),
    `${context}: ${code}.svg does not start with an <svg> root (corrupt or an error page saved as .svg)`
  ).toBe(true);
  expect(content.length, `${context}: ${code}.svg is suspiciously small`).toBeGreaterThan(100);
}

/** All committed data files whose `"team"` values can reach a logo path. */
function collectTeamBearingFiles(): string[] {
  const files: string[] = [];

  // data/<league>/mfl-feeds/<year>/players.json
  const dataDir = join(ROOT, 'data');
  for (const league of readdirSync(dataDir, { withFileTypes: true })) {
    if (!league.isDirectory()) continue;
    const feedsDir = join(dataDir, league.name, 'mfl-feeds');
    if (!existsSync(feedsDir)) continue;
    for (const year of readdirSync(feedsDir, { withFileTypes: true })) {
      if (!year.isDirectory()) continue;
      const players = join(feedsDir, year.name, 'players.json');
      if (existsSync(players)) files.push(players);
    }
  }

  // src/data/**/mfl-player-salaries-*.json — the historical salary
  // snapshots carry legacy codes (OAK, RAM, SDC, STL, FA*) that the
  // current-season feeds no longer do.
  const salaryDirs = [join(ROOT, 'src', 'data'), join(ROOT, 'src', 'data', 'theleague')];
  for (const dir of salaryDirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (/^mfl-player-salaries-.*\.json$/.test(entry)) files.push(join(dir, entry));
    }
  }

  return files;
}

describe('nfl-logo assets', () => {
  it('has the NFL shield fallback', () => {
    expectValidSvg('NFL', 'shield fallback');
  });

  it('has a committed SVG for every canonical team code', () => {
    for (const code of getAllNFLTeamCodes()) {
      expectValidSvg(code, 'canonical code');
    }
  });

  it('has a committed SVG for every legacy alias filename', () => {
    for (const alias of Object.keys(TEAM_CODE_MAP)) {
      if (UNFILEABLE_CODES.has(alias)) continue;
      expectValidSvg(alias, `alias for ${normalizeTeamCode(alias)}`);
    }
  });

  it('covers every team code present in the committed MFL datasets', () => {
    const files = collectTeamBearingFiles();
    expect(files.length, 'no team-bearing data files found — did the data layout move?').toBeGreaterThan(0);

    const codes = new Set<string>();
    for (const file of files) {
      // Regex scan instead of JSON.parse — these files add up to tens of MB.
      for (const match of readFileSync(file, 'utf-8').matchAll(/"team"\s*:\s*"([^"]+)"/g)) {
        codes.add(match[1]);
      }
    }
    expect(codes.size).toBeGreaterThan(30);

    for (const code of codes) {
      if (UNFILEABLE_CODES.has(code)) continue; // FA* is shield-guarded in code
      // Raw path: pages like players.astro and calculator.astro render
      // `/assets/nfl-logos/${team}.svg` straight from the data value.
      expectValidSvg(code, 'raw feed code');
      // Normalized path: PlayerCell and friends normalize first.
      const canonical = normalizeTeamCode(code);
      if (!UNFILEABLE_CODES.has(canonical)) {
        expectValidSvg(canonical, `normalized form of feed code ${code}`);
      }
    }
  });
});
