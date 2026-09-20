#!/usr/bin/env node
/**
 * Build src/data/nfl-brand-kit.json — a committed CATALOG of every NFL team
 * mark we can reach, beyond the single primary logo in public/assets/nfl-logos.
 *
 *   node scripts/fetch-nfl-brand-kit.mjs
 *   node scripts/fetch-nfl-brand-kit.mjs --dry-run
 *
 * ── Why a catalog of URLs and not mirrored files ──────────────────────────
 * This records WHERE each mark lives; it deliberately downloads nothing into
 * public/. ESPN's brand-kit cuts are 4096x4096 PNGs — mirroring all six
 * treatments for both the primary and secondary mark is ~100MB of binaries
 * per build, and today NOTHING renders them. When a surface picks one up,
 * mirror just that treatment through scripts/lib/dark-logo-mirror.mjs (the
 * established pattern: gitignored files under public/, a committed manifest
 * of what the build actually has) and read its URL from here.
 *
 * The catalog itself is small, diffable, and doubles as a rebrand tripwire:
 * ESPN stamps `lastUpdated` per logo, so a club changing its mark shows up as
 * a date moving in the diff. That is how the stale 2026 Titans and Rams marks
 * were caught — TEN moved 2026-03-20, LAR 2026-04-24, while the frozen
 * mflscripts mirror this repo used to pull from never moved at all.
 *
 * ── Three upstreams ───────────────────────────────────────────────────────
 *  - NFL.com club endpoint — the authoritative primary mark, as SVG. Same
 *    source scripts/download-nfl-logos.mjs commits.
 *  - ESPN core API — `logos[]` per team. Beyond default/dark/scoreboard it
 *    carries a SECONDARY mark (all 32 teams have one) in six treatments at
 *    4096px. The secondary is generally the alternate/uniform mark, which is
 *    the only free source of alternates found: SportsLogos.net and the clubs'
 *    own brand pages have no API and are licensed.
 *  - nflverse — wordmarks (a horizontal lockup, which no other free source
 *    here provides), squared logos, and the four team colors. Community
 *    maintained, so it LAGS a rebrand by weeks; treat its art as second
 *    choice to NFL.com/ESPN for anything that must be current.
 *
 * Guard: tests/nfl-brand-kit-data.test.ts.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outPath = path.join(projectRoot, 'src', 'data', 'nfl-brand-kit.json');
const dryRun = process.argv.includes('--dry-run');

const ESPN_TEAMS = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams?limit=40';
const NFLVERSE_CSV =
  'https://raw.githubusercontent.com/nflverse/nflfastR-data/master/teams_colors_logos.csv';

/** Canonical ESPN codes — mirrors getAllNFLTeamCodes() in src/utils/nfl-logo.ts. */
const CANONICAL_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
];

/** Canonical code → the code each upstream uses, where they disagree. */
const NFL_DOT_COM_CODE = { WSH: 'WAS' };
const NFLVERSE_CODE = { WSH: 'WAS' };

/**
 * ESPN's `rel` arrays, joined, → the key we publish. Anything ESPN adds that
 * is not listed here is carried through under a camelCased fallback key
 * rather than dropped, so a new treatment shows up in the diff.
 */
const ESPN_REL_KEYS = {
  default: 'default',
  dark: 'dark',
  scoreboard: 'scoreboard',
  'scoreboard/dark': 'scoreboardDark',
  grayscale: 'grayscale',
  primary_logo_on_white_color: 'primaryOnWhite',
  primary_logo_on_black_color: 'primaryOnBlack',
  primary_logo_on_primary_color: 'primaryOnPrimary',
  primary_logo_on_secondary_color: 'primaryOnSecondary',
  primary_logo_black: 'primaryBlack',
  primary_logo_white: 'primaryWhite',
  secondary_logo_on_white_color: 'secondaryOnWhite',
  secondary_logo_on_black_color: 'secondaryOnBlack',
  secondary_logo_on_primary_color: 'secondaryOnPrimary',
  secondary_logo_on_secondary_color: 'secondaryOnSecondary',
  secondary_logo_black: 'secondaryBlack',
  secondary_logo_white: 'secondaryWhite',
};

const camel = (s) => s.replace(/[^a-z0-9]+(.)/gi, (_, c) => c.toUpperCase());

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * nflverse publishes its art as github.com/<o>/<r>/raw/<ref>/<path>, which is
 * a 302 to raw.githubusercontent.com. Record the resolved host directly: the
 * redirecting form is refused by some egress proxies (403 with a JSON body),
 * so a future mirror step reading these URLs would fail on the hop rather
 * than on the asset.
 */
const rawGithub = (url) =>
  typeof url === 'string'
    ? url.replace(
        /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\//,
        'https://raw.githubusercontent.com/$1/$2/',
      )
    : url;

/** Minimal CSV reader — this feed has no quoted fields or embedded commas. */
function parseCsv(text) {
  const [header, ...rows] = text.trim().split('\n');
  const cols = header.split(',');
  return rows.map((row) => Object.fromEntries(row.split(',').map((v, i) => [cols[i], v])));
}

async function fetchEspn() {
  const index = await getJson(ESPN_TEAMS);
  const byCode = {};
  for (const item of index.items) {
    const team = await getJson(item.$ref);
    const logos = {};
    for (const logo of team.logos ?? []) {
      const rel = logo.rel.slice(1).join('/') || 'default';
      const key = ESPN_REL_KEYS[rel] ?? camel(rel);
      logos[key] = { url: logo.href, width: logo.width, lastUpdated: logo.lastUpdated };
    }
    byCode[team.abbreviation] = { espnId: team.id, name: team.displayName, logos };
  }
  return byCode;
}

async function fetchNflverse() {
  const res = await fetch(NFLVERSE_CSV, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${NFLVERSE_CSV}`);
  const byCode = {};
  for (const row of parseCsv(await res.text())) {
    byCode[row.team_abbr] = {
      wordmark: rawGithub(row.team_wordmark),
      squaredLogo: rawGithub(row.team_logo_squared),
      wikipediaLogo: row.team_logo_wikipedia,
      colors: [row.team_color, row.team_color2, row.team_color3, row.team_color4].filter(Boolean),
    };
  }
  return byCode;
}

async function run() {
  console.log('[fetch-nfl-brand-kit] fetching ESPN core API + nflverse…');
  const [espn, nflverse] = await Promise.all([fetchEspn(), fetchNflverse()]);

  const teams = {};
  const warnings = [];

  for (const code of CANONICAL_CODES) {
    const e = espn[code];
    const n = nflverse[NFLVERSE_CODE[code] ?? code];
    if (!e) {
      warnings.push(`${code}: no ESPN entry`);
      continue;
    }
    if (!n) warnings.push(`${code}: no nflverse entry`);
    if (!e.logos.secondaryOnWhite) warnings.push(`${code}: ESPN has no secondary mark`);

    teams[code] = {
      name: e.name,
      espnId: e.espnId,
      // The same SVG scripts/download-nfl-logos.mjs commits, recorded so a
      // consumer can re-fetch at full fidelity without hardcoding the host.
      primarySvg: `https://static.www.nfl.com/league/api/clubs/logos/${NFL_DOT_COM_CODE[code] ?? code}.svg`,
      colors: n?.colors ?? [],
      wordmark: n?.wordmark ?? null,
      squaredLogo: n?.squaredLogo ?? null,
      espn: e.logos,
    };
  }

  // Sorted keys so a re-run with no upstream change is a byte-identical file
  // (storage-and-build.md: a nondeterministic write regrows .git).
  const sorted = Object.fromEntries(Object.keys(teams).sort().map((k) => [k, teams[k]]));
  const payload = {
    // NOTE: deliberately no generatedAt stamp — a run-clock field would make
    // every run a diff and every diff a production build.
    sources: {
      primarySvg: 'https://static.www.nfl.com/league/api/clubs/logos/{CODE}.svg',
      espn: ESPN_TEAMS,
      nflverse: NFLVERSE_CSV,
    },
    teams: sorted,
  };

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  let existing = null;
  try {
    existing = await fs.readFile(outPath, 'utf-8');
  } catch {
    /* new file */
  }

  for (const w of warnings) console.warn(`  ⚠️  ${w}`);

  if (existing === json) {
    console.log(`[fetch-nfl-brand-kit] ${Object.keys(sorted).length} teams — unchanged`);
    return;
  }
  if (!dryRun) await fs.writeFile(outPath, json, 'utf-8');
  console.log(
    `[fetch-nfl-brand-kit] ${Object.keys(sorted).length} teams — ${existing === null ? 'created' : 'updated'}` +
      `${dryRun ? ' (dry run — not written)' : ''}`,
  );
}

run().catch((err) => {
  console.error('✗ fetch-nfl-brand-kit failed:', err);
  process.exitCode = 1;
});
