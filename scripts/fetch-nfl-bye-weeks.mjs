#!/usr/bin/env node
/**
 * Refresh data/nfl/bye-weeks.json from MFL's nflByeWeeks export.
 *
 * The NFL bye calendar moves every season and it is the input that decides
 * where a league's doubleheaders and division games may legally go — see
 * src/utils/schedule-plan.mjs and tests/schedule-optimization.test.ts.
 * Committing it (rather than fetching at test time) keeps the annual audit
 * deterministic and runnable offline.
 *
 * NOTE: this export must go to api.myfantasyleague.com. The per-league www##
 * hosts answer with `{"error":"...must go to api.myfantasyleague.com"}` at
 * HTTP 200, which is the usual MFL trap — an error payload wearing a success
 * status. The writer below refuses to commit a payload that fails to parse
 * into 32 teams, so a bad fetch leaves the last good file in place.
 *
 * Usage:
 *   node scripts/fetch-nfl-bye-weeks.mjs            # current + next season
 *   node scripts/fetch-nfl-bye-weeks.mjs 2027       # one specific season
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/nfl/bye-weeks.json');
const API = 'https://api.myfantasyleague.com';
const EXPECTED_TEAMS = 32;

const fetchSeason = async (year) => {
  const res = await fetch(`${API}/${year}/export?TYPE=nflByeWeeks&JSON=1`, {
    headers: { 'User-Agent': 'mfl.football schedule audit' },
  });
  if (!res.ok) throw new Error(`${year}: HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(`${year}: MFL error — ${json.error?.$t ?? json.error}`);
  const teams = json?.nflByeWeeks?.team;
  if (!Array.isArray(teams) || teams.length !== EXPECTED_TEAMS) {
    throw new Error(`${year}: expected ${EXPECTED_TEAMS} teams, got ${teams?.length ?? 0}`);
  }
  const byTeam = {};
  for (const t of teams) {
    const week = Number(t.bye_week);
    if (!Number.isInteger(week) || week < 1 || week > 22) {
      throw new Error(`${year}: bad bye week for ${t.id}: ${t.bye_week}`);
    }
    byTeam[t.id] = week;
  }
  return Object.fromEntries(Object.entries(byTeam).sort(([a], [b]) => a.localeCompare(b)));
};

const main = async () => {
  const args = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
  const now = new Date().getUTCFullYear();
  const years = args.length ? args : [String(now), String(now + 1)];

  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const seasons = { ...(existing.seasons ?? {}) };

  let changed = 0;
  for (const year of years) {
    try {
      const next = await fetchSeason(year);
      if (JSON.stringify(seasons[year]) === JSON.stringify(next)) {
        console.log(`${year}: unchanged`);
        continue;
      }
      seasons[year] = next;
      changed += 1;
      console.log(`${year}: updated (${Object.keys(next).length} teams)`);
    } catch (err) {
      // A season MFL has not published yet is normal, not a failure.
      console.warn(`${year}: skipped — ${err.message}`);
    }
  }

  if (!changed) {
    console.log('nothing to write');
    return;
  }
  const ordered = Object.fromEntries(
    Object.keys(seasons)
      .sort()
      .map((y) => [y, seasons[y]]),
  );
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        _comment:
          'NFL bye week by team, keyed by season. Source: MFL export TYPE=nflByeWeeks. Refresh with scripts/fetch-nfl-bye-weeks.mjs.',
        seasons: ordered,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${OUT}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
