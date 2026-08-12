#!/usr/bin/env node
/**
 * Reconstruct AFL playoff bracket GAMES for seasons MFL never gave us.
 *
 * THE PROBLEM
 *
 * /afl-fantasy/playoffs renders "Bracket data not available for this season"
 * for every year before 2024. MFL's playoffBracket export returns seeds only
 * for those seasons — no franchise ids, no points — so the committed
 * playoff-brackets.json has bracket METADATA (names, team counts, start weeks)
 * and an empty `brackets` map where the rounds and games should be. Twenty-one
 * seasons of postseason history render as an empty state.
 *
 * The games themselves were never missing. schedule.json carries every playoff
 * week, fully scored, for every season on record. What's absent is only the
 * structure telling you which of those games belonged to which bracket.
 *
 * THE APPROACH
 *
 * Walk the schedule as a single-elimination tournament, seeded with the teams
 * that actually made each bracket, and emit the result in MFL's own bracket
 * shape so the existing renderer consumes it with no changes:
 *
 *   { "<bracketId>": { playoffBracket: { bracket_id, playoffRound: [ { week,
 *     playoffGame: [ { game_id, home: {franchise_id, points}, away: {...} } ] } ] } } }
 *
 * Seeding the field is not optional. The NIT runs on the same weeks with the
 * same 24 franchises, and its champion also wins three straight — the only way
 * to tell a championship game from an NIT game is to know who was in the
 * bracket. The field is the top N of each conference in that season's own
 * standings order (MFL's rows are already the official final order), using that
 * season's own division/conference map — today's four-division map picks the
 * wrong teams for 2003-2012, when the AFL ran six divisions.
 *
 * ERA AWARENESS
 *
 *   2003-2017  bracket 1 IS the 8-team championship field, three rounds.
 *   2018+      bracket 1 is only the 2-team FINAL; the field lives in separate
 *              "AL Championship" / "NL Championship" brackets (4 teams each)
 *              whose winners meet in it.
 *
 * Reading bracket 1 as the field in the modern era seeds the walk with the top
 * ONE team per conference — i.e. assumes the top seed always wins its
 * conference bracket. It doesn't; that mistake produced the wrong 2019 champion
 * during development.
 *
 * OUTPUT IS ADVISORY, NOT AUTHORITATIVE
 *
 * Writes data/afl-fantasy/derived/reconstructed-playoff-brackets.json, a
 * SEPARATE file. It never edits mfl-feeds/, because a reconstruction is an
 * inference and must not be mistaken for what MFL actually reported — and
 * because backfill jobs have clobbered real bracket data in this repo before
 * (docs/claude/insights/domains/mfl-api.md, 2026-07-04). Each entry is stamped
 * `reconstructed: true` so the page can label it.
 *
 * Every season with a known champion is verified against
 * data/afl-fantasy/championship-history.json; a reconstruction whose final
 * disagrees is DISCARDED rather than published.
 *
 * Usage:
 *   node scripts/reconstruct-afl-playoff-brackets.mjs
 *   node scripts/reconstruct-afl-playoff-brackets.mjs --year 2005
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AFL = getLeagueBySlug('afl-fantasy');
const FEEDS_DIR = path.join(ROOT, AFL.dataPath, 'mfl-feeds');
const OUTPUT_PATH = path.join(ROOT, AFL.dataPath, 'derived/reconstructed-playoff-brackets.json');
const CHAMPIONS_PATH = path.join(ROOT, AFL.dataPath, 'championship-history.json');

const args = process.argv.slice(2);
const yearArg = args.indexOf('--year');
const SINGLE_YEAR = yearArg >= 0 ? Number(args[yearArg + 1]) : null;

const log = (msg) => console.log(`[reconstruct] ${msg}`);
const warn = (msg) => console.warn(`[reconstruct] WARN: ${msg}`);
const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function readJson(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Which weeks a bracket spans and how many teams contest it.
 * Never derive the final week from `startWeekGames` — that counts round-one
 * games, not rounds, so an 8-team bracket starting week 14 computes to week 17
 * when its final is week 16.
 */
function describeShape(bracketMetas) {
  const title = bracketMetas.find((b) => String(b?.id) === '1');
  if (!title) return null;
  const titleWeek = num(title.startWeek);
  const titleTeams = num(title.teamsInvolved);
  if (!titleWeek || titleTeams < 2) return null;

  if (titleTeams === 2) {
    const conf = bracketMetas.filter((b) =>
      /^(AL|NL)\s+Championship$/i.test(String(b?.name ?? '').trim())
    );
    if (conf.length !== 2) return null;
    const weeks = conf.map((b) => num(b.startWeek)).filter(Boolean);
    const teams = conf.reduce((sum, b) => sum + num(b.teamsInvolved), 0);
    if (weeks.length !== 2 || teams < 4) return null;
    return {
      era: 'split',
      startWeek: Math.min(...weeks),
      finalWeek: titleWeek,
      teams,
      conferenceBracketIds: conf.map((b) => String(b.id)),
    };
  }

  const rounds = Math.max(1, Math.ceil(Math.log2(titleTeams)));
  return {
    era: 'single',
    startWeek: titleWeek,
    finalWeek: titleWeek + rounds - 1,
    teams: titleTeams,
    conferenceBracketIds: [],
  };
}

/** Top `teams / 2` of each conference, in that season's own standings order. */
function championshipField(league, standingsRows, teams) {
  const confOfDivision = new Map();
  for (const d of toArray(league?.league?.divisions?.division)) {
    if (d?.id != null && d.conference != null) {
      confOfDivision.set(String(d.id), String(d.conference));
    }
  }
  const confOfFranchise = new Map();
  for (const f of toArray(league?.league?.franchises?.franchise)) {
    const c = confOfDivision.get(String(f?.division));
    if (f?.id && c) confOfFranchise.set(f.id, c);
  }
  if (!confOfFranchise.size) return null;

  const perConference = Math.max(1, Math.floor(teams / 2));
  const counts = new Map();
  const field = new Map(); // franchiseId -> conference
  for (const row of standingsRows) {
    const conference = confOfFranchise.get(row.id);
    if (!conference) continue;
    const seen = counts.get(conference) ?? 0;
    if (seen >= perConference) continue;
    counts.set(conference, seen + 1);
    field.set(row.id, conference);
  }
  return field.size === teams ? field : null;
}

/**
 * Walk the schedule as single elimination, collecting the games per week.
 * Returns rounds plus the final game, or null if the shape doesn't hold —
 * a partial or ambiguous walk is not published.
 */
function walkBracket(schedule, alive, startWeek, finalWeek) {
  const weeks = toArray(schedule?.schedule?.weeklySchedule);
  let remaining = new Set(alive);
  const rounds = [];
  let finalGame = null;

  for (let week = startWeek; week <= finalWeek; week++) {
    const entry = weeks.find((w) => num(w.week) === week);
    if (!entry) return null;
    const games = [];
    const survivors = new Set();

    for (const matchup of toArray(entry.matchup)) {
      const sides = toArray(matchup.franchise);
      if (sides.length !== 2) continue;
      const [a, b] = sides;
      if (!remaining.has(a.id) || !remaining.has(b.id)) continue;
      const aPts = num(a.score);
      const bPts = num(b.score);
      if (aPts === 0 && bPts === 0) continue;
      const winner = aPts >= bPts ? a : b;
      const loser = aPts >= bPts ? b : a;
      survivors.add(winner.id);
      games.push({
        game_id: `r${week}g${games.length + 1}`,
        home: { franchise_id: a.id, points: String(a.score ?? '') },
        away: { franchise_id: b.id, points: String(b.score ?? '') },
      });
      if (week === finalWeek) finalGame = { champion: winner.id, runnerUp: loser.id };
    }

    if (!games.length) return null;
    rounds.push({ week: String(week), playoffGame: games });
    remaining = survivors;
  }

  if (!finalGame || remaining.size !== 1 || remaining.values().next().value !== finalGame.champion) {
    return null;
  }
  return { rounds, finalGame };
}

function bracketPayload(id, rounds) {
  return {
    playoffBracket: {
      bracket_id: String(id),
      playoffRound: rounds,
    },
    reconstructed: true,
  };
}

async function reconstructYear(year, knownChampion) {
  const dir = path.join(FEEDS_DIR, String(year));
  const bracketFeed = await readJson(path.join(dir, 'playoff-brackets.json'));
  if (!bracketFeed) return null;

  // Already have real data from MFL — never shadow it.
  if (Object.keys(bracketFeed.brackets ?? {}).length) {
    return { skipped: 'already has MFL bracket data' };
  }

  const metas = toArray(bracketFeed?.playoffBrackets?.playoffBracket);
  const shape = describeShape(metas);
  if (!shape) return { skipped: 'bracket shape not recognized' };

  const league = await readJson(path.join(dir, 'league.json'));
  const standings = await readJson(path.join(dir, 'standings.json'));
  const schedule = await readJson(path.join(dir, 'schedule.json'));
  const rows = toArray(standings?.leagueStandings?.franchise);
  if (!league || !rows.length || !schedule) return { skipped: 'missing league/standings/schedule' };

  const field = championshipField(league, rows, shape.teams);
  if (!field) return { skipped: 'could not seed the championship field' };

  const walked = walkBracket(schedule, field.keys(), shape.startWeek, shape.finalWeek);
  if (!walked) return { skipped: 'elimination walk did not resolve' };

  // Refuse to publish a reconstruction that contradicts the known champion.
  if (knownChampion && walked.finalGame.champion !== knownChampion) {
    return { skipped: `walk champion ${walked.finalGame.champion} != known ${knownChampion}` };
  }

  const brackets = {};
  if (shape.era === 'single') {
    brackets['1'] = bracketPayload('1', walked.rounds);
  } else {
    // Split era: the conference brackets own every round before the final, and
    // bracket 1 owns the final itself. Games are partitioned by the conference
    // of the teams playing them, which is why `field` carries it.
    const finalRound = walked.rounds[walked.rounds.length - 1];
    const earlier = walked.rounds.slice(0, -1);
    const [alId, nlId] = shape.conferenceBracketIds;
    const byConference = { [alId]: [], [nlId]: [] };
    const confBracketFor = (conference) => (conference === '00' ? alId : nlId);

    for (const round of earlier) {
      const split = {};
      for (const game of round.playoffGame) {
        const conference = field.get(game.home.franchise_id);
        const target = confBracketFor(conference);
        (split[target] ||= []).push(game);
      }
      for (const [bracketId, games] of Object.entries(split)) {
        if (games.length) byConference[bracketId].push({ week: round.week, playoffGame: games });
      }
    }
    for (const [bracketId, rounds] of Object.entries(byConference)) {
      if (rounds.length) brackets[bracketId] = bracketPayload(bracketId, rounds);
    }
    brackets['1'] = bracketPayload('1', [finalRound]);
  }

  return { brackets, finalGame: walked.finalGame, rounds: walked.rounds.length };
}

async function main() {
  const championsFile = await readJson(CHAMPIONS_PATH);
  const knownChampions = new Map(
    (championsFile?.championships ?? []).map((c) => [c.year, c.champion])
  );

  const years = SINGLE_YEAR
    ? [SINGLE_YEAR]
    : (await fs.readdir(FEEDS_DIR)).filter((d) => /^\d{4}$/.test(d)).map(Number).sort();

  const out = {};
  let built = 0;
  const skipped = [];

  for (const year of years) {
    const result = await reconstructYear(year, knownChampions.get(year));
    if (!result) continue;
    if (result.skipped) {
      skipped.push(`${year} (${result.skipped})`);
      continue;
    }
    out[String(year)] = result.brackets;
    built++;
    log(
      `${year}: ${result.rounds} rounds, ${Object.keys(result.brackets).length} bracket(s) — champion ${result.finalGame.champion}`
    );
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        $comment:
          'Playoff brackets RECONSTRUCTED from schedule.json for AFL seasons whose MFL ' +
          'playoffBracket export carries seeds only (no franchise ids, no points). ' +
          'Generated by scripts/reconstruct-afl-playoff-brackets.mjs — advisory, not ' +
          "MFL's own record. Never written into mfl-feeds/. Each season's final is " +
          'verified against championship-history.json before publication; a walk that ' +
          'disagrees is discarded. Shape mirrors the `brackets` map in ' +
          'playoff-brackets.json so the existing renderer consumes it unchanged.',
        generatedFrom: 'schedule.json (elimination walk, conference-seeded field)',
        seasons: out,
      },
      null,
      2
    ) + '\n'
  );

  log(`wrote ${built} season(s) to ${path.relative(ROOT, OUTPUT_PATH)}`);
  if (skipped.length) log(`skipped: ${skipped.join(', ')}`);
}

main().catch((err) => {
  warn(err.stack || err.message);
  process.exit(1);
});
