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
import { buildBracketKindResolver } from '../src/utils/afl-bracket-kind.mjs';

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
    // Resolve each conference bracket by NAME, never by its position in the
    // feed array. Every committed feed happens to list AL before NL, so a
    // positional read works today and would silently swap both conferences'
    // games the first time MFL reorders them — the same class of incidental-
    // ordering bug this script exists to undo.
    const named = (re) => bracketMetas.find((b) => re.test(String(b?.name ?? '').trim()));
    const al = named(/^AL\s+Championship$/i);
    const nl = named(/^NL\s+Championship$/i);
    if (!al || !nl) return null;
    const conf = [al, nl];
    const weeks = conf.map((b) => num(b.startWeek)).filter(Boolean);
    const teams = conf.reduce((sum, b) => sum + num(b.teamsInvolved), 0);
    if (weeks.length !== 2 || teams < 4) return null;
    return {
      era: 'split',
      startWeek: Math.min(...weeks),
      finalWeek: titleWeek,
      teams,
      conferenceBracketIds: { al: String(al.id), nl: String(nl.id) },
    };
  }

  const rounds = Math.max(1, Math.ceil(Math.log2(titleTeams)));
  return {
    era: 'single',
    startWeek: titleWeek,
    finalWeek: titleWeek + rounds - 1,
    teams: titleTeams,
    conferenceBracketIds: null,
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
 * Recover the championship field from the schedule when the standings cannot
 * seed it.
 *
 * `championshipField` assumes the bracket is the top N of each conference in
 * standings order. That holds for sixteen of the eighteen reconstructable
 * seasons, but not 2004 or 2011: six divisions fed an eight-team bracket, so
 * division winners took most of the slots and a team well down the table got in
 * ahead of better records (2011's Midwestside Connection and Way More Funner,
 * neither in the standings' top eight). Seeded wrong, the walk finds only two of
 * its four opening games and bails.
 *
 * The exact qualification rule is not recoverable from the feed, and it does not
 * need to be. A valid bracket is its own fingerprint: pick `teams / 2` games
 * from the opening week whose winners pair off into real games the following
 * week, and so on down to one. For 2004 and 2011 that leaves exactly three
 * candidates each — the championship plus two halves of the 16-team NIT, which
 * are structurally identical — so the known final decides between them. If the
 * champion and runner-up are not on record, nothing is published.
 */
function searchChampionshipField(schedule, shape, knownFinal) {
  if (!knownFinal?.champion || !knownFinal?.runnerUp) return null;
  const opening = pruneRound(scheduleGamesByWeek(schedule).get(shape.startWeek) ?? []) ?? [];
  const pick = Math.floor(shape.teams / 2);
  // Guard the combinatorics: a 24-team league opens with 12 games (495 subsets).
  if (pick < 1 || opening.length > 24 || opening.length < pick) return null;

  const matches = [];
  const combine = (start, chosen) => {
    if (matches.length > 1) return; // already ambiguous, stop early
    if (chosen.length === pick) {
      const teams = new Set(chosen.flatMap((g) => [g.home.franchise_id, g.away.franchise_id]));
      if (teams.size !== shape.teams) return;
      const walked = walkBracket(schedule, teams, shape.startWeek, shape.finalWeek);
      if (
        walked &&
        walked.finalGame.champion === knownFinal.champion &&
        walked.finalGame.runnerUp === knownFinal.runnerUp
      ) {
        matches.push({ teams, walked });
      }
      return;
    }
    for (let i = start; i < opening.length; i++) combine(i + 1, [...chosen, opening[i]]);
  };
  combine(0, []);

  return matches.length === 1 ? matches[0] : null;
}

/**
 * A single-elimination round cannot contain the same franchise twice, but the
 * AFL's archived schedules do. Two distinct artifacts:
 *
 *   - A stray extra matchup linking two teams already paired elsewhere that
 *     week. Weeks 14 of 2013, 2014 and 2015 each carry one (three rows total —
 *     the count `tests/afl-reconstructed-brackets.test.ts` pins). Only 2014 and
 *     2015 reach this function, because 2013's pair straddles the championship
 *     and NIT fields, so no single bracket ever sees both teams; that row is
 *     simply never claimed rather than pruned.
 *   - An outright self-matchup bye row (`0023 vs 0023`, 2012 week 14), dropped
 *     by the first filter below rather than by the duplicate logic.
 *
 * Left in, both render as phantom games: 2012's quarterfinals showed five, one
 * of them a team playing itself.
 *
 * The redundant link is identifiable without guessing: it is the only game
 * whose BOTH sides also appear in another game that round, so dropping it
 * leaves every team with exactly one opponent. Anything still duplicated after
 * that is genuinely ambiguous and fails the walk.
 */
function pruneRound(candidates) {
  const real = candidates.filter((g) => g.home.franchise_id !== g.away.franchise_id);
  const tally = () => {
    const counts = new Map();
    for (const g of real) {
      for (const id of [g.home.franchise_id, g.away.franchise_id]) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  };

  let counts = tally();
  while ([...counts.values()].some((n) => n > 1)) {
    const index = real.findIndex(
      (g) => counts.get(g.home.franchise_id) > 1 && counts.get(g.away.franchise_id) > 1
    );
    if (index === -1) return null; // duplicated, but not a removable cross-link
    real.splice(index, 1);
    counts = tally();
  }
  return real;
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
    const candidates = [];

    for (const matchup of toArray(entry.matchup)) {
      const sides = toArray(matchup.franchise);
      if (sides.length !== 2) continue;
      const [a, b] = sides;
      if (!remaining.has(a.id) || !remaining.has(b.id)) continue;
      const aPts = num(a.score);
      const bPts = num(b.score);
      if (aPts === 0 && bPts === 0) continue;
      candidates.push({
        home: { franchise_id: a.id, points: String(a.score ?? '') },
        away: { franchise_id: b.id, points: String(b.score ?? '') },
      });
    }

    const pruned = pruneRound(candidates);
    if (!pruned?.length) return null;
    const games = pruned.map((g, i) => ({ game_id: `r${week}g${i + 1}`, ...g }));

    const survivors = new Set();
    games.forEach((game) => {
      const homeWins = num(game.home.points) >= num(game.away.points);
      const winner = homeWins ? game.home.franchise_id : game.away.franchise_id;
      survivors.add(winner);
      if (week === finalWeek) {
        finalGame = {
          champion: winner,
          runnerUp: homeWins ? game.away.franchise_id : game.home.franchise_id,
        };
      }
    });

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

const gameKey = (a, b) => [a, b].sort().join('|');
const gameId = (game) => gameKey(game.home.franchise_id, game.away.franchise_id);
const winnerOf = (g) => (num(g.home.points) >= num(g.away.points) ? g.home : g.away).franchise_id;
const loserOf = (g) => (num(g.home.points) >= num(g.away.points) ? g.away : g.home).franchise_id;

/**
 * Every playoff-week game from the schedule that has a score, keyed by week.
 * Self-matchups (MFL bye rows) and unplayed games are dropped here so the
 * consolation solver never has to reason about them.
 */
function scheduleGamesByWeek(schedule) {
  const byWeek = new Map();
  for (const entry of toArray(schedule?.schedule?.weeklySchedule)) {
    const week = num(entry.week);
    const games = [];
    for (const matchup of toArray(entry.matchup)) {
      const sides = toArray(matchup.franchise);
      if (sides.length !== 2) continue;
      const [a, b] = sides;
      if (a.id === b.id) continue;
      if (num(a.score) === 0 && num(b.score) === 0) continue;
      games.push({
        home: { franchise_id: a.id, points: String(a.score ?? '') },
        away: { franchise_id: b.id, points: String(b.score ?? '') },
      });
    }
    if (games.length) byWeek.set(week, games);
  }
  return byWeek;
}

/**
 * Rebuild the consolation and placement brackets — the AFL Losers/Consolation
 * bracket, the 3rd/5th/7th place games, and the deep stack of NIT losers
 * brackets that decide draft order. Between them they cover roughly half of
 * every season's postseason games, and they are the brackets that determine
 * where a team actually FINISHED.
 *
 * They cannot be seeded from the standings the way the championship and NIT
 * are, because their fields are made of losers. So this walks forward week by
 * week, consuming the games the primary brackets did not:
 *
 *   1. Continuation — an open bracket claims any unconsumed game on its own
 *      side involving a team it still has alive. This is what lets late
 *      entrants join (the AFL Consolation Bracket is 6 teams: 4 quarterfinal
 *      losers in week 15, then the 2 semifinal losers drop in for week 16).
 *   2. Seeding — whatever is left is grouped by how deep its teams got in the
 *      primary bracket, and handed to the brackets that start that week.
 *
 * Step 2's grouping is load-bearing, not cosmetic. 2005 week 17 has three
 * different 1-game brackets starting at once ("3rd Round NIT Losers", "2nd and
 * 3rd Round NIT Losers", "1st Rd. NIT Losers & Week 16 Losers") and nothing but
 * elimination depth distinguishes them — they award the #3 first-rounder, the
 * #2 second-rounder and the #3 second-rounder respectively, so guessing would
 * hand out the wrong draft picks. Teams that survived longer in the primary
 * bracket go to the lower-numbered (higher-placing) bracket.
 *
 * Deliberately NOT used anywhere: `bracketWinnerTitle`. The AFL wrote custom
 * titles into these brackets for years and MFL renders a custom title as a
 * finishing position it does not mean, which is why its own placement table
 * shows 2005's Da Dangsters 2nd when they finished 3rd. Only the games are
 * trustworthy.
 */
function reconstructConsolation({ schedule, primary, metas, primaryIds, kindOf }) {
  const consumed = new Set();
  const side = new Map(); // franchiseId -> 'nit' | 'championship'
  const exitWeek = new Map(); // franchiseId -> week it lost in a PRIMARY bracket

  for (const [id, payload] of Object.entries(primary)) {
    const bracketSide = kindOf(id) === 'nit' ? 'nit' : 'championship';
    for (const round of toArray(payload.playoffBracket.playoffRound)) {
      for (const game of toArray(round.playoffGame)) {
        consumed.add(`${round.week}:${gameId(game)}`);
        side.set(game.home.franchise_id, bracketSide);
        side.set(game.away.franchise_id, bracketSide);
        exitWeek.set(loserOf(game), num(round.week));
      }
    }
  }
  if (!side.size) return { brackets: {}, unclaimed: [] };

  const candidates = metas
    .filter((m) => !primaryIds.has(String(m.id)))
    .filter((m) => kindOf(m.id) === 'nit' || kindOf(m.id) === 'championship')
    .filter((m) => num(m.startWeek) > 0 && num(m.startWeekGames) > 0)
    .map((m) => ({
      id: String(m.id),
      side: kindOf(m.id) === 'nit' ? 'nit' : 'championship',
      startWeek: num(m.startWeek),
      startWeekGames: num(m.startWeekGames),
      teamsInvolved: num(m.teamsInvolved),
      rounds: [],
      alive: new Set(),
      teams: new Set(),
    }))
    .sort((a, b) => a.startWeek - b.startWeek || Number(a.id) - Number(b.id));

  const byWeek = scheduleGamesByWeek(schedule);
  const playoffWeeks = [...byWeek.keys()]
    .filter((w) => w >= Math.min(...candidates.map((c) => c.startWeek)))
    .sort((a, b) => a - b);

  // Only games between two teams on the same side are postseason bracket games;
  // in 2021-2023 the whole league still plays a regular-season week 14.
  const availableAt = (week, wantSide) =>
    (byWeek.get(week) ?? []).filter(
      (g) =>
        !consumed.has(`${week}:${gameId(g)}`) &&
        side.get(g.home.franchise_id) === wantSide &&
        side.get(g.away.franchise_id) === wantSide
    );

  const claim = (bracket, week, games) => {
    const pruned = pruneRound(games);
    if (!pruned?.length) return false;
    bracket.alive = new Set();
    for (const [i, game] of pruned.entries()) {
      consumed.add(`${week}:${gameId(game)}`);
      bracket.teams.add(game.home.franchise_id);
      bracket.teams.add(game.away.franchise_id);
      bracket.alive.add(winnerOf(game));
      game.game_id = `r${week}g${i + 1}`;
    }
    bracket.rounds.push({
      week: String(week),
      playoffGame: pruned.map((g) => ({ game_id: g.game_id, home: g.home, away: g.away })),
    });
    return true;
  };

  for (const week of playoffWeeks) {
    for (const bracket of candidates) bracket.claimedThisWeek = false;

    for (const bracket of candidates) {
      if (!bracket.rounds.length || !bracket.alive.size) continue;
      const games = availableAt(week, bracket.side).filter(
        (g) => bracket.alive.has(g.home.franchise_id) || bracket.alive.has(g.away.franchise_id)
      );
      if (games.length) bracket.claimedThisWeek = claim(bracket, week, games);
    }

    for (const wantSide of ['championship', 'nit']) {
      // Brackets opening this week first, then any already-open bracket that
      // found no continuation game and still has room for a fresh cohort.
      // 2006's "AFL Losers Bracket Placing Games" is 4 teams playing two
      // unconnected games a week apart — its week-17 pair are the losers of the
      // main consolation bracket's week-16 round, not survivors of its own.
      const claimants = [
        ...candidates.filter(
          (c) => c.side === wantSide && c.startWeek === week && !c.rounds.length
        ),
        ...candidates.filter(
          (c) =>
            c.side === wantSide &&
            c.rounds.length &&
            !c.claimedThisWeek &&
            c.teams.size < c.teamsInvolved
        ),
      ];

      for (const bracket of claimants) {
        const groups = new Map();
        for (const game of availableAt(week, wantSide)) {
          const depth = Math.max(
            exitWeek.get(game.home.franchise_id) ?? 0,
            exitWeek.get(game.away.franchise_id) ?? 0
          );
          (groups.get(depth) ?? groups.set(depth, []).get(depth)).push(game);
        }
        // Deepest run in the primary bracket goes to the lowest bracket id.
        const match = [...groups.entries()]
          .sort((a, b) => b[0] - a[0])
          .find(([, games]) => games.length === bracket.startWeekGames);
        if (match) claim(bracket, week, match[1]);
      }
    }
  }

  const brackets = {};
  for (const bracket of candidates) {
    if (!bracket.rounds.length) continue;
    // A bracket that did not end up with the number of teams MFL says it has is
    // a mis-assignment, not a discovery. Drop it rather than publish it.
    if (bracket.teamsInvolved && bracket.teams.size !== bracket.teamsInvolved) continue;
    brackets[bracket.id] = bracketPayload(bracket.id, bracket.rounds);
  }

  const unclaimed = [];
  for (const week of playoffWeeks) {
    for (const game of byWeek.get(week) ?? []) {
      if (consumed.has(`${week}:${gameId(game)}`)) continue;
      if (side.get(game.home.franchise_id) !== side.get(game.away.franchise_id)) continue;
      unclaimed.push(`w${week} ${gameId(game)}`);
    }
  }
  return { brackets, unclaimed };
}

async function reconstructYear(year, knownFinal) {
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

  let field = championshipField(league, rows, shape.teams);
  let walked = field ? walkBracket(schedule, field.keys(), shape.startWeek, shape.finalWeek) : null;

  if (!walked && shape.era === 'single') {
    // The standings did not describe this season's field — see
    // searchChampionshipField. Only reachable with a champion AND runner-up on
    // record, so it can never invent a bracket.
    const recovered = searchChampionshipField(schedule, shape, knownFinal);
    if (recovered) {
      // Conference is only consulted in the split era, so an empty tag is fine.
      field = new Map([...recovered.teams].map((id) => [id, '']));
      walked = recovered.walked;
      log(`${year}: standings could not seed the field; recovered it from the schedule`);
    }
  }

  if (!field) return { skipped: 'could not seed the championship field' };
  if (!walked) return { skipped: 'elimination walk did not resolve' };

  // Refuse to publish a reconstruction that contradicts the known champion.
  if (knownFinal?.champion && walked.finalGame.champion !== knownFinal.champion) {
    return {
      skipped: `walk champion ${walked.finalGame.champion} != known ${knownFinal.champion}`,
    };
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
    const { al: alId, nl: nlId } = shape.conferenceBracketIds;
    const byConference = { [alId]: [], [nlId]: [] };

    // Which conference id is the American League is read from that season's own
    // conference NAMES, not assumed to be '00' — the id is just an index and
    // the AFL has re-parented its conferences before. Falls back to the
    // long-standing 00=AL / 01=NL convention only if the names are missing.
    const americanConferenceId =
      toArray(league?.league?.conferences?.conference).find((c) =>
        /^American\b/i.test(String(c?.name ?? '').trim())
      )?.id ?? '00';
    const confBracketFor = (conference) =>
      String(conference) === String(americanConferenceId) ? alId : nlId;

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

  // --- NIT ------------------------------------------------------------------
  // The consolation tournament for everyone who missed the championship field:
  // 16 of the AFL's 24 franchises, so for most owners it IS their postseason.
  // Its field is the exact complement of the championship field, which is what
  // makes it recoverable — no extra seeding assumption needed.
  //
  // Found by NAME, never by id: the NIT is bracket 3 in 2005, 4 in 2006, 5 in
  // 2007-2017 and 6 in 2018+. Hardcoding an id would silently walk a different
  // tournament.
  const nitMeta = metas.find((b) => /^NIT(\s+Championship)?$/i.test(String(b?.name ?? '').trim()));
  let nit = null;
  if (nitMeta) {
    const nitStart = num(nitMeta.startWeek);
    const nitTeams = num(nitMeta.teamsInvolved);
    const inChampionship = new Set(field.keys());
    const nitField = rows.map((r) => r.id).filter((id) => !inChampionship.has(id));

    if (nitStart && nitTeams >= 2 && nitField.length === nitTeams) {
      const nitRounds = Math.max(1, Math.ceil(Math.log2(nitTeams)));
      const walkedNit = walkBracket(schedule, nitField, nitStart, nitStart + nitRounds - 1);
      if (walkedNit) {
        brackets[String(nitMeta.id)] = bracketPayload(nitMeta.id, walkedNit.rounds);
        nit = { bracketId: String(nitMeta.id), champion: walkedNit.finalGame.champion };
      }
    }
  }

  const primaryIds = new Set(Object.keys(brackets));
  const consolation = reconstructConsolation({
    schedule,
    primary: brackets,
    metas,
    primaryIds,
    kindOf: buildBracketKindResolver(metas),
  });
  Object.assign(brackets, consolation.brackets);

  return {
    brackets,
    finalGame: walked.finalGame,
    rounds: walked.rounds.length,
    nit,
    consolation: {
      count: Object.keys(consolation.brackets).length,
      unclaimed: consolation.unclaimed,
    },
  };
}

async function main() {
  const championsFile = await readJson(CHAMPIONS_PATH);
  // The whole entry, not just the champion: recovering 2004/2011's field from
  // the schedule needs the runner-up too (see searchChampionshipField).
  const knownFinals = new Map(
    (championsFile?.championships ?? []).map((c) => [c.year, c])
  );

  const years = SINGLE_YEAR
    ? [SINGLE_YEAR]
    : (await fs.readdir(FEEDS_DIR)).filter((d) => /^\d{4}$/.test(d)).map(Number).sort();

  const out = {};
  let built = 0;
  const skipped = [];

  for (const year of years) {
    const result = await reconstructYear(year, knownFinals.get(year));
    if (!result) continue;
    if (result.skipped) {
      skipped.push(`${year} (${result.skipped})`);
      continue;
    }
    out[String(year)] = result.brackets;
    built++;
    log(
      `${year}: ${result.rounds} rounds, ${Object.keys(result.brackets).length} bracket(s) — champion ${result.finalGame.champion}` +
        (result.nit ? `, NIT #${result.nit.bracketId} champion ${result.nit.champion}` : ', NIT not recovered') +
        `, ${result.consolation.count} consolation` +
        (result.consolation.unclaimed.length
          ? ` — UNCLAIMED: ${result.consolation.unclaimed.join(', ')}`
          : '')
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
