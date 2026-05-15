#!/usr/bin/env node
/**
 * Aggregate per-franchise career history from MFL feeds.
 *
 * Reads:
 *   data/theleague/mfl-feeds/<year>/standings.json     (regular-season W-L-T, PF)
 *   data/theleague/mfl-feeds/<year>/playoff-brackets.json  (championship + 3rd place)
 *   data/theleague/mfl-feeds/<year>/weekly-results.json    (highlights — best game, biggest blowout)
 *   data/theleague/mfl-feeds/<year>/league.json            (division assignments per year)
 *   data/theleague/mfl-player-salaries-<year>.json         (MVP / Jerry Jones / Brock Osweiler)
 *   src/data/theleague.config.json                         (current franchise identities)
 *
 * Writes:
 *   data/theleague/derived/franchise-history.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBadgeContext, computeBadgesFor } from './badges.mjs';
import {
  diffNewAwards,
  buildMilestonePost,
  mergeMilestonePosts,
} from './lib/franchise-milestone-posts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FEEDS_DIR = path.join(ROOT, 'data/theleague/mfl-feeds');
const SALARIES_DIR = path.join(ROOT, 'data/theleague');
const LEAGUE_CONFIG_PATH = path.join(ROOT, 'src/data/theleague.config.json');
const CHAMPIONSHIP_HISTORY_PATH = path.join(ROOT, 'data/theleague/championship-history.json');
const OUTPUT_PATH = path.join(ROOT, 'data/theleague/derived/franchise-history.json');
const SCHEFTER_FEED_PATH = path.join(ROOT, 'src/data/theleague/schefter-feed.json');

const INDIVIDUAL_AWARD_MIN_SALARY = 1_500_000;

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const isValidFeed = (data) => data && !data.error;

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

const parseNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const parseRecord = (wlt) => {
  const [w, l, t] = String(wlt || '').split('-').map((s) => parseNum(s));
  return { w: w || 0, l: l || 0, t: t || 0 };
};

// --- Discover available years ---
const years = fs
  .readdirSync(FEEDS_DIR)
  .filter((d) => /^\d{4}$/.test(d))
  .map(Number)
  .sort((a, b) => a - b);

// --- Load league config for current identities ---
const leagueConfig = readJson(LEAGUE_CONFIG_PATH);
const currentTeams = leagueConfig.teams || [];

// Hand-curated championship history for years where MFL's playoff-bracket
// export has metadata only (2007-2019, plus in-season years where the
// bracket isn't decided yet). Maps year → { champion, runnerUp } with
// franchise IDs that owned those slots at the time.
const championshipHistory = readJson(CHAMPIONSHIP_HISTORY_PATH);
const championshipManualByYear = new Map();
if (championshipHistory?.championships) {
  for (const entry of championshipHistory.championships) {
    championshipManualByYear.set(entry.year, entry);
  }
}

const getIdentityForYear = (franchiseId, year) => {
  const team = currentTeams.find((t) => t.franchiseId === franchiseId);
  if (!team) return { name: franchiseId, icon: null, banner: null };
  if (team.history) {
    for (const entry of team.history) {
      if (year >= entry.yearStart && year <= entry.yearEnd) {
        return {
          name: entry.name,
          nameMedium: entry.nameMedium ?? entry.name,
          icon: entry.icon,
          banner: entry.banner,
          isHistorical: true,
        };
      }
    }
  }
  return {
    name: team.name,
    nameMedium: team.nameMedium ?? team.name,
    icon: team.icon,
    banner: team.banner,
    isHistorical: false,
  };
};

// --- Owner-history attribution ---
// Some franchises moved IDs over the years (e.g. the current Midwestside
// Connection owner held franchise 0010 from 2012-2015 then took over 0011
// in 2019). For each (sourceFranchiseId, year) the attribution map returns
// the franchise that should get credit.
const teamsWithOwnerHistory = currentTeams.filter((t) => Array.isArray(t.ownerHistory) && t.ownerHistory.length > 0);

const normalizeName = (s) => (s || '').trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ');

// Infer the year the current owner took over for each franchise. Used to
// exclude former-owner years from the franchise's career stats.
//
//   1. If the team has an ownerHistory: earliest yearStart across entries.
//   2. Else if the most recent history entry's name matches the current
//      top-level name: walk backwards including consecutive entries that
//      share the same name OR the same ownerEra → return earliest yearStart
//      of that run.
//   3. Else if there's a history but no name match: yearEnd of the last
//      history entry + 1 (current owner started after the prior owner).
//   4. Else (no history at all): null → include all years.
const inferCurrentOwnerSince = (team) => {
  if (typeof team.currentOwnerSince === 'number') {
    return team.currentOwnerSince;
  }
  if (Array.isArray(team.ownerHistory) && team.ownerHistory.length > 0) {
    return Math.min(...team.ownerHistory.map((h) => h.yearStart));
  }
  if (!Array.isArray(team.history) || team.history.length === 0) {
    return null;
  }
  const sorted = [...team.history].sort((a, b) => a.yearStart - b.yearStart);
  const last = sorted[sorted.length - 1];
  const currentNorm = normalizeName(team.name);
  if (normalizeName(last.name) !== currentNorm) {
    return last.yearEnd + 1;
  }
  let i = sorted.length - 1;
  while (i > 0) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const sameName = normalizeName(prev.name) === normalizeName(cur.name);
    const sameEra =
      prev.ownerEra != null && cur.ownerEra != null && prev.ownerEra === cur.ownerEra;
    if (sameName || sameEra) i--;
    else break;
  }
  return sorted[i].yearStart;
};

const currentOwnerSinceMap = new Map();
for (const team of currentTeams) {
  currentOwnerSinceMap.set(team.franchiseId, inferCurrentOwnerSince(team));
}

const attributeYear = (sourceId, year) => {
  // Cross-franchise ownerHistory claim wins first.
  for (const team of teamsWithOwnerHistory) {
    for (const entry of team.ownerHistory) {
      if (entry.franchiseId === sourceId && year >= entry.yearStart && year <= entry.yearEnd) {
        return team.franchiseId;
      }
    }
  }
  const sourceTeam = currentTeams.find((t) => t.franchiseId === sourceId);
  // If the source team itself has an ownerHistory but none of its entries
  // cover this year, the year belongs to a former owner we don't track.
  if (Array.isArray(sourceTeam?.ownerHistory) && sourceTeam.ownerHistory.length > 0) {
    return null;
  }
  // For teams without explicit ownerHistory, drop years before the inferred
  // currentOwnerSince — those belong to a former owner.
  const since = currentOwnerSinceMap.get(sourceId);
  if (since != null && year < since) {
    return null;
  }
  return sourceId;
};

// --- Helpers for playoff bracket parsing ---
function getChampionshipResult(playoffBrackets) {
  if (!playoffBrackets) return null;
  const bracketsList = playoffBrackets.brackets || playoffBrackets.playoffBrackets?.brackets;
  if (!bracketsList) return null;

  // Bracket "1" is the league championship
  const champBracket = bracketsList['1']?.playoffBracket;
  if (!champBracket) return null;

  const rounds = toArray(champBracket.playoffRound);
  if (!rounds.length) return null;

  // Final game is the last round, single game
  const finalRound = rounds[rounds.length - 1];
  const finalGame = toArray(finalRound.playoffGame)[0];
  if (!finalGame || !finalGame.home?.franchise_id || !finalGame.away?.franchise_id) return null;

  const homePts = parseNum(finalGame.home.points);
  const awayPts = parseNum(finalGame.away.points);
  if (homePts === 0 && awayPts === 0) return null;

  const winner = homePts >= awayPts ? finalGame.home : finalGame.away;
  const loser = homePts >= awayPts ? finalGame.away : finalGame.home;

  // 3rd place = bracket "2"
  let thirdPlace = null;
  const consolation = bracketsList['2']?.playoffBracket;
  if (consolation) {
    const consoFinal = toArray(consolation.playoffRound).slice(-1)[0];
    const consoGame = toArray(consoFinal?.playoffGame)[0];
    if (consoGame?.home?.franchise_id && consoGame?.away?.franchise_id) {
      const cHome = parseNum(consoGame.home.points);
      const cAway = parseNum(consoGame.away.points);
      if (cHome > 0 || cAway > 0) {
        thirdPlace = cHome >= cAway ? consoGame.home.franchise_id : consoGame.away.franchise_id;
      }
    }
  }

  return {
    champion: winner.franchise_id,
    runnerUp: loser.franchise_id,
    thirdPlace,
    championPoints: Math.max(homePts, awayPts),
    runnerUpPoints: Math.min(homePts, awayPts),
  };
}

function getPlayoffParticipants(playoffBrackets) {
  if (!playoffBrackets) return new Set();
  const champBracket = playoffBrackets.brackets?.['1']?.playoffBracket;
  if (!champBracket) return new Set();
  const participants = new Set();
  toArray(champBracket.playoffRound).forEach((round) => {
    toArray(round.playoffGame).forEach((game) => {
      if (game.home?.franchise_id) participants.add(game.home.franchise_id);
      if (game.away?.franchise_id) participants.add(game.away.franchise_id);
    });
  });
  return participants;
}

// Pre-2020 brackets reference seeds (no franchise IDs), so the function above
// returns an empty set. Recover the teams that actually made the playoffs by
// re-running MFL's standard seeding logic against the regular-season standings:
//
//   * Seeds 1..N: division winners, ordered by overall record + tiebreakers.
//   * Seeds N+1..: non-division winners, ordered by overall record.
//
// The championship bracket's metadata advertises `teamsInvolved` — the number
// of seeds that count as "made the playoffs". Take the top N seeded teams.
function getChampionshipBracketSize(playoffBrackets) {
  if (!playoffBrackets) return 0;
  const meta = toArray(playoffBrackets.playoffBrackets?.playoffBracket).find(
    (b) => b.id === '1'
  );
  return meta ? Number(meta.teamsInvolved) || 0 : 0;
}

function inferPlayoffParticipants(standingsRows, divisionTitleHolders, bracketSize) {
  if (!bracketSize) return [];
  const divWinnerIds = new Set([...divisionTitleHolders.values()].filter(Boolean));
  const sorted = [...standingsRows].sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      b.h2hPct - a.h2hPct ||
      b.allPlayPct - a.allPlayPct ||
      b.pointsFor - a.pointsFor
  );
  const divWinners = sorted.filter((r) => divWinnerIds.has(r.franchiseId));
  const wildcards = sorted.filter((r) => !divWinnerIds.has(r.franchiseId));
  return [...divWinners, ...wildcards].slice(0, bracketSize).map((r) => r.franchiseId);
}

// Build a Map<key, { round, bracket }> for every championship-or-3rd-place
// playoff matchup that has actual scores. Key = "<week>:<smallerId>:<biggerId>"
// so per-week matchup lookups are owner-direction independent. Used to tag
// rivalry matchups with isPlayoff + a human-readable round name.
function getPlayoffMatchupKeys(playoffBrackets) {
  const keys = new Map();
  if (!playoffBrackets) return keys;
  const list = playoffBrackets.brackets || playoffBrackets.playoffBrackets?.brackets;
  if (!list) return keys;

  const TAGGED = [
    { id: '1', tag: 'championship' },
    { id: '2', tag: 'consolation' },
  ];

  for (const { id: bracketId, tag } of TAGGED) {
    const bracket = list[bracketId]?.playoffBracket;
    if (!bracket) continue;
    const rounds = toArray(bracket.playoffRound);
    const totalRounds = rounds.length;
    rounds.forEach((round, idx) => {
      const week = parseNum(round.week);
      const games = toArray(round.playoffGame);
      const isFinal = idx === totalRounds - 1;
      const isSemi = idx === totalRounds - 2 && totalRounds >= 2;
      const roundName =
        tag === 'consolation'
          ? isFinal ? '3rd Place' : `Consolation R${idx + 1}`
          : isFinal ? 'Championship' : isSemi ? 'Semifinal' : `Quarterfinal`;
      games.forEach((game) => {
        const homeId = game.home?.franchise_id;
        const awayId = game.away?.franchise_id;
        if (!homeId || !awayId) return;
        const homePts = parseNum(game.home.points);
        const awayPts = parseNum(game.away.points);
        if (homePts === 0 && awayPts === 0) return; // unplayed
        const [a, b] = [homeId, awayId].sort();
        keys.set(`${week}:${a}:${b}`, { round: roundName, bracket: tag });
      });
    });
  }
  return keys;
}

// Pre-2020 brackets reference seeds (no franchise IDs), so getPlayoffMatchupKeys
// returns an empty map and the rivalry pages undercount playoff meetings for
// those years. Recover the matchups by walking schedule.json from the
// championship bracket's startWeek onward — every game where BOTH franchises
// are championship-bracket participants is a playoff meeting.
//
// Round labels are heuristic at this granularity (we don't try to recreate
// MFL's exact bracket chain): the championship game gets relabelled later in
// the per-franchise post-process from championship-history.json. Anything
// else is "Playoffs" generic, which is enough for the rivalry-page sub-list.
function getPreFranchiseIdPlayoffMatchupKeys(playoffBrackets, schedule, participants) {
  const keys = new Map();
  if (!schedule?.schedule?.weeklySchedule || participants.size < 2) return keys;
  const meta = toArray(playoffBrackets?.playoffBrackets?.playoffBracket).find(
    (b) => b.id === '1'
  );
  const startWeek = meta ? Number(meta.startWeek) || 0 : 0;
  if (!startWeek) return keys;
  for (const wk of toArray(schedule.schedule.weeklySchedule)) {
    const week = Number(wk.week);
    if (!week || week < startWeek) continue;
    for (const m of toArray(wk.matchup)) {
      const fr = toArray(m.franchise);
      if (fr.length < 2) continue;
      const idA = fr[0]?.id;
      const idB = fr[1]?.id;
      if (!idA || !idB) continue;
      if (!participants.has(idA) || !participants.has(idB)) continue;
      const [a, b] = [idA, idB].sort();
      keys.set(`${week}:${a}:${b}`, { round: 'Playoffs', bracket: 'championship' });
    }
  }
  return keys;
}

// --- Helpers for weekly results parsing ---
function getWeeklyHighlightsForYear(weeklyResults, year) {
  const highlights = []; // { year, week, franchiseId, score, opponentId, opponentScore, margin }
  if (!weeklyResults?.weeks) return highlights;

  // Build matchup pairs from weeklyResults — but we need an opponent.
  // weeklyResults.weeks[].scores is { franchiseId: score }, no pairing.
  // We can't reconstruct head-to-head from this alone. Use weekly-results-raw.json if available.
  // For now, just track raw scores per franchise per week.
  const records = [];
  weeklyResults.weeks.forEach((week) => {
    const scores = week.scores || {};
    Object.entries(scores).forEach(([franchiseId, score]) => {
      const s = parseNum(score);
      if (s > 0) {
        records.push({ year, week: parseNum(week.week), franchiseId, score: s });
      }
    });
  });
  return records;
}

// --- MVP / Jerry Jones / Brock Osweiler from salaries ---
function computeAwardsForYear(salaryData) {
  if (!salaryData?.players) return null;

  const rostered = salaryData.players
    .filter((p) => parseNum(p.salary) > 0 && p.status === 'ROSTER')
    .map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      salary: parseNum(p.salary),
      points: parseNum(p.points),
      franchiseId: p.franchiseId,
    }));

  // MVP — highest points/salary among scorers
  const scorers = rostered.filter((p) => p.points > 0);
  if (!scorers.length) return null;

  const mvpCandidates = [...scorers].sort(
    (a, b) => b.points / b.salary - a.points / a.salary
  );
  const mvp = mvpCandidates[0];

  // Brock Osweiler — worst points/salary among scorers with salary >= $1.5M
  const eligibleForBust = scorers.filter((p) => p.salary >= INDIVIDUAL_AWARD_MIN_SALARY);
  const osweilerCandidates = [...eligibleForBust].sort(
    (a, b) => a.points / a.salary - b.points / b.salary
  );
  const osweiler = osweilerCandidates[0] || null;

  // Jerry Jones — worst team starting-lineup cost-per-point
  const byFranchise = new Map();
  rostered.forEach((p) => {
    if (!byFranchise.has(p.franchiseId)) byFranchise.set(p.franchiseId, []);
    byFranchise.get(p.franchiseId).push(p);
  });

  const buildOptimalLineup = (roster) => {
    const byPos = (pos) =>
      roster.filter((p) => (Array.isArray(pos) ? pos.includes(p.position) : p.position === pos))
        .sort((a, b) => b.points - a.points);
    const qbs = byPos('QB');
    const rbs = byPos('RB');
    const wrs = byPos('WR');
    const tes = byPos('TE');
    const pks = byPos('PK');
    const defs = byPos(['Def', 'DEF']);
    const lineup = [];
    if (qbs[0]) lineup.push(qbs[0]);
    if (rbs[0]) lineup.push(rbs[0]);
    if (wrs[0]) lineup.push(wrs[0]);
    if (tes[0]) lineup.push(tes[0]);
    if (pks[0]) lineup.push(pks[0]);
    if (defs[0]) lineup.push(defs[0]);
    const taken = new Set(lineup.map((p) => p.id));
    const flexPool = [...rbs, ...wrs, ...tes]
      .filter((p) => !taken.has(p.id))
      .sort((a, b) => b.points - a.points)
      .slice(0, 3);
    return [...lineup, ...flexPool];
  };

  const teamCostPerPoint = [];
  for (const [franchiseId, roster] of byFranchise) {
    const lineup = buildOptimalLineup(roster);
    const totalSalary = lineup.reduce((s, p) => s + p.salary, 0);
    const totalPoints = lineup.reduce((s, p) => s + p.points, 0);
    if (totalPoints > 0 && lineup.length >= 6) {
      teamCostPerPoint.push({
        franchiseId,
        costPerPoint: totalSalary / totalPoints,
        totalSalary,
        totalPoints,
      });
    }
  }
  teamCostPerPoint.sort((a, b) => b.costPerPoint - a.costPerPoint);
  const jerryJones = teamCostPerPoint[0] || null;

  return { mvp, osweiler, jerryJones };
}

// --- Aggregate ---
const franchiseMap = new Map(); // franchiseId -> aggregated record

const ensureFranchise = (id) => {
  if (!franchiseMap.has(id)) {
    franchiseMap.set(id, {
      franchiseId: id,
      yearByYear: [],
      championships: [],
      runnerUps: [],
      thirdPlaces: [],
      divisionTitles: [],
      mvpAwards: [],
      jerryJonesAwards: [],
      brockOsweilerAwards: [],
      playoffAppearances: 0,
      careerWins: 0,
      careerLosses: 0,
      careerTies: 0,
      careerPointsFor: 0,
      yearsActive: 0,
      highlights: {
        highestSingleGame: null,
        lowestSingleGame: null,
        biggestBlowoutWin: null,
        biggestBlowoutLoss: null,
      },
      headToHead: {}, // opponentFranchiseId -> { wins, losses, ties }
      matchupHistory: {}, // opponentFranchiseId -> [{year, week, score, opponentScore, isPlayoff, playoffRound, sourceFranchiseId}]
      trades: [], // [{year, timestamp, partnerId, gaveUp[], received[], comments, sourceFranchiseId, partnerSourceId}]
      draftPicks: [], // [{year, round, pick, playerId, viaTrade, comments, timestamp, sourceFranchiseId}]
      auctionWins: [], // [{year, playerId, winningBid, timestamp, sourceFranchiseId}]
    });
  }
  return franchiseMap.get(id);
};

const yearSummaries = []; // for the index page: champion/runner-up per year

// Player-name lookup populated from each year's players.json as we process
// trades. Only contains players that appear in trade ledgers — keeps the
// derived JSON small while letting rivalry/franchise pages display human
// names without bundling all 2,700+ players.
const playerNameLookup = {};

for (const year of years) {
  const yearDir = path.join(FEEDS_DIR, String(year));
  const standings = readJson(path.join(yearDir, 'standings.json'));
  if (!isValidFeed(standings) || !standings.leagueStandings) continue;

  const leagueJson = readJson(path.join(yearDir, 'league.json'));
  const playoffBrackets = readJson(path.join(yearDir, 'playoff-brackets.json'));
  const weeklyResults = readJson(path.join(yearDir, 'weekly-results.json'));
  const schedule = readJson(path.join(yearDir, 'schedule.json'));
  const salaryData = readJson(path.join(SALARIES_DIR, `mfl-player-salaries-${year}.json`));

  // Map franchiseId -> division for this year
  const divisionMap = new Map();
  const divisionNames = new Map();
  if (isValidFeed(leagueJson) && leagueJson.league) {
    toArray(leagueJson.league.divisions?.division).forEach((d) => {
      if (d.id != null && d.name) divisionNames.set(String(d.id), d.name);
    });
    toArray(leagueJson.league.franchises?.franchise).forEach((f) => {
      if (f.id) divisionMap.set(f.id, f.division);
    });
  }

  // Build standings rows
  const standingsRows = toArray(standings.leagueStandings.franchise).map((f) => {
    const { w, l, t } = parseRecord(f.h2hwlt);
    const divTriple = parseRecord(f.divwlt);
    return {
      franchiseId: f.id,
      wins: w,
      losses: l,
      ties: t,
      pointsFor: parseNum(f.pf),
      h2hPct: parseNum(f.h2hpct),
      allPlayPct: parseNum(f.all_play_pct),
      divisionId: divisionMap.get(f.id),
      divisionWins: divTriple.w,
      divisionLosses: divTriple.l,
      divisionTies: divTriple.t,
    };
  });

  // Compute regular-season rank by h2hPct then PF
  const ranked = [...standingsRows].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.h2hPct - a.h2hPct ||
      b.pointsFor - a.pointsFor
  );
  ranked.forEach((row, idx) => {
    row.regSeasonRank = idx + 1;
  });

  // Don't crown a division leader (or anything else) before any games have
  // been played — MFL still emits standings rows with PF=0 ranked by
  // tiebreaker, which would otherwise leak into division titles + playoff
  // appearance counts for the in-progress current season.
  const seasonHasGames = standingsRows.some((r) => r.wins + r.losses + r.ties > 0);

  // Division titles — best record per division (tiebreak by PF)
  const divisionTitleHolders = new Map(); // divisionId -> franchiseId
  if (seasonHasGames) {
    const byDiv = new Map();
    standingsRows.forEach((row) => {
      if (!row.divisionId) return;
      if (!byDiv.has(row.divisionId)) byDiv.set(row.divisionId, []);
      byDiv.get(row.divisionId).push(row);
    });
    for (const [divId, members] of byDiv) {
      members.sort(
        (a, b) =>
          b.divisionWins - a.divisionWins ||
          b.wins - a.wins ||
          b.pointsFor - a.pointsFor
      );
      if (members[0]) divisionTitleHolders.set(divId, members[0].franchiseId);
    }
  }

  // Championship results
  // Prefer MFL's bracket data when it has actual franchise winners; otherwise
  // fall back to the hand-curated championship-history.json. MFL's pre-2020
  // brackets are metadata-only.
  let champResult = getChampionshipResult(playoffBrackets);
  if (!champResult) {
    const manual = championshipManualByYear.get(year);
    if (manual?.champion || manual?.runnerUp) {
      champResult = {
        champion: manual.champion ?? null,
        runnerUp: manual.runnerUp ?? null,
        thirdPlace: manual.thirdPlace ?? null,
      };
    }
  }
  const playoffParticipants = getPlayoffParticipants(playoffBrackets);
  const playoffMatchupKeys = getPlayoffMatchupKeys(playoffBrackets);

  // MFL's pre-2020 brackets are metadata-only (no franchise IDs), so
  // getPlayoffParticipants returns an empty set for those years. Reconstruct
  // the participant list by re-running MFL's seeding logic (division winners
  // first, then wildcards by record) and keeping the top `teamsInvolved`
  // seeds — that's the actual size of the championship bracket per year.
  if (playoffParticipants.size === 0 && seasonHasGames) {
    const bracketSize = getChampionshipBracketSize(playoffBrackets);
    for (const fid of inferPlayoffParticipants(standingsRows, divisionTitleHolders, bracketSize)) {
      playoffParticipants.add(fid);
    }
  }

  // Same data gap on the matchup side: getPlayoffMatchupKeys can only tag
  // games whose bracket entries carry franchise IDs. For pre-2020 years,
  // walk the schedule from the championship bracket's startWeek onward and
  // tag any participant-vs-participant game as a playoff meeting. The
  // champion-vs-runner-up game gets re-labelled "Championship" by the
  // post-process loop later.
  if (playoffMatchupKeys.size === 0 && playoffParticipants.size >= 2) {
    for (const [k, v] of getPreFranchiseIdPlayoffMatchupKeys(
      playoffBrackets,
      schedule,
      playoffParticipants
    )) {
      playoffMatchupKeys.set(k, v);
    }
  }

  // Belt-and-suspenders: even when MFL did emit franchise IDs, make sure
  // every division winner and the recorded champion / runner-up / third
  // place are credited as playoff participants.
  for (const champId of divisionTitleHolders.values()) {
    if (champId) playoffParticipants.add(champId);
  }
  if (champResult?.champion) playoffParticipants.add(champResult.champion);
  if (champResult?.runnerUp) playoffParticipants.add(champResult.runnerUp);
  if (champResult?.thirdPlace) playoffParticipants.add(champResult.thirdPlace);

  // Awards from salaries
  const awards = computeAwardsForYear(salaryData);

  // Per-franchise per-year row — apply ownerHistory attribution so years
  // follow the human owner across franchise-ID changes.
  for (const row of standingsRows) {
    const targetId = attributeYear(row.franchiseId, year);
    if (!targetId) continue; // skip — former-owner year on a team that has ownerHistory

    const fr = ensureFranchise(targetId);
    const identity = getIdentityForYear(row.franchiseId, year);

    // Suppress preseason placeholder standings: when a season has zero
    // games played AND zero points scored, MFL's standings still report
    // a regSeasonRank and mark a division leader by tiebreaker. Treat
    // those as "not played" so unplayed years don't claim a rank,
    // division title, or playoff appearance. We require pointsFor==0
    // too so we don't blow away historical 0-0 anomalies (e.g. Pigskins
    // 2022 had no W/L recorded but 2k points scored).
    const seasonNotStarted =
      row.wins === 0 && row.losses === 0 && row.ties === 0 && row.pointsFor === 0;

    let playoffResult = !seasonNotStarted && playoffParticipants.has(row.franchiseId)
      ? 'playoffs'
      : 'missed';
    if (champResult?.champion === row.franchiseId) playoffResult = 'champion';
    else if (champResult?.runnerUp === row.franchiseId) playoffResult = 'runner-up';
    else if (champResult?.thirdPlace === row.franchiseId) playoffResult = 'third-place';

    const wonDivision = Array.from(divisionTitleHolders.values()).includes(row.franchiseId)
      ? Array.from(divisionTitleHolders.entries()).find(([, id]) => id === row.franchiseId)?.[0]
      : null;

    fr.yearByYear.push({
      year,
      name: identity.name,
      nameMedium: identity.nameMedium,
      icon: identity.icon,
      banner: identity.banner,
      isHistorical: identity.isHistorical,
      sourceFranchiseId: row.franchiseId !== targetId ? row.franchiseId : null,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pointsFor: row.pointsFor,
      regSeasonRank: seasonNotStarted ? null : row.regSeasonRank,
      divisionId: row.divisionId,
      divisionName: row.divisionId ? divisionNames.get(row.divisionId) : null,
      wonDivision: !seasonNotStarted && !!wonDivision,
      playoffResult,
    });

    fr.careerWins += row.wins;
    fr.careerLosses += row.losses;
    fr.careerTies += row.ties;
    fr.careerPointsFor += row.pointsFor;
    if (!seasonNotStarted) fr.yearsActive += 1;
    if (!seasonNotStarted && playoffParticipants.has(row.franchiseId)) fr.playoffAppearances += 1;

    if (champResult?.champion === row.franchiseId) {
      fr.championships.push(year);
    } else if (champResult?.runnerUp === row.franchiseId) {
      fr.runnerUps.push(year);
    } else if (champResult?.thirdPlace === row.franchiseId) {
      fr.thirdPlaces.push(year);
    }

    if (wonDivision && !seasonNotStarted) {
      fr.divisionTitles.push({
        year,
        divisionId: wonDivision,
        divisionName: divisionNames.get(wonDivision) || wonDivision,
      });
    }
  }

  // Award winners — re-attribute by ownerHistory too.
  const attributeAwardFranchise = (franchiseId) => attributeYear(franchiseId, year);

  if (awards?.mvp) {
    const target = attributeAwardFranchise(awards.mvp.franchiseId);
    if (target) {
      ensureFranchise(target).mvpAwards.push({
        year,
        playerId: awards.mvp.id,
        playerName: awards.mvp.name,
        position: awards.mvp.position,
        points: awards.mvp.points,
        salary: awards.mvp.salary,
        sourceFranchiseId: awards.mvp.franchiseId !== target ? awards.mvp.franchiseId : null,
      });
    }
  }
  if (awards?.osweiler) {
    const target = attributeAwardFranchise(awards.osweiler.franchiseId);
    if (target) {
      ensureFranchise(target).brockOsweilerAwards.push({
        year,
        playerId: awards.osweiler.id,
        playerName: awards.osweiler.name,
        position: awards.osweiler.position,
        points: awards.osweiler.points,
        salary: awards.osweiler.salary,
        sourceFranchiseId: awards.osweiler.franchiseId !== target ? awards.osweiler.franchiseId : null,
      });
    }
  }
  if (awards?.jerryJones) {
    const target = attributeAwardFranchise(awards.jerryJones.franchiseId);
    if (target) {
      ensureFranchise(target).jerryJonesAwards.push({
        year,
        costPerPoint: awards.jerryJones.costPerPoint,
        totalSalary: awards.jerryJones.totalSalary,
        totalPoints: awards.jerryJones.totalPoints,
        sourceFranchiseId: awards.jerryJones.franchiseId !== target ? awards.jerryJones.franchiseId : null,
      });
    }
  }

  // Single-game highlights from weekly results — also re-attribute.
  if (weeklyResults?.weeks) {
    weeklyResults.weeks.forEach((week) => {
      const weekNum = parseNum(week.week);
      Object.entries(week.scores || {}).forEach(([fid, raw]) => {
        const score = parseNum(raw);
        if (score <= 0) return;
        const target = attributeYear(fid, year);
        if (!target) return;
        const fr = ensureFranchise(target);
        if (!fr.highlights.highestSingleGame || score > fr.highlights.highestSingleGame.score) {
          fr.highlights.highestSingleGame = { year, week: weekNum, score, sourceFranchiseId: fid !== target ? fid : null };
        }
        if (!fr.highlights.lowestSingleGame || score < fr.highlights.lowestSingleGame.score) {
          fr.highlights.lowestSingleGame = { year, week: weekNum, score, sourceFranchiseId: fid !== target ? fid : null };
        }
      });
    });
  }

  // Head-to-head records + biggest blowouts. weekly-results-raw.json carries
  // both rosters and matchup pairings, but pre-2020 it only contains regular
  // season weeks. schedule.json fills in the playoff weeks (and any other
  // gaps) with matchup pairings + scores. We process weekly-results-raw
  // first; any (week, smallerId, biggerId) tuple it covers becomes
  // authoritative. Then we walk schedule.json and process anything not yet
  // covered so playoff matchups land in matchupHistory.
  const matchupSeen = new Set();
  const recordMatchup = (aId, bId, aScore, bScore, weekNum) => {
    if (!aId || !bId) return;
    if (aScore === 0 && bScore === 0) return;
    const [pa, pb] = [aId, bId].sort();
    const seenKey = `${weekNum}:${pa}:${pb}`;
    if (matchupSeen.has(seenKey)) return;
    matchupSeen.add(seenKey);

    const aTarget = attributeYear(aId, year);
    const bTarget = attributeYear(bId, year);
    const bothAttributed = aTarget != null && bTarget != null;

    const playoffMatch = playoffMatchupKeys.get(`${weekNum}:${pa}:${pb}`) ?? null;

    // Skip games where either side belongs to a former owner (target null).
    // Each side gets credit independently — even if one franchise's owner
    // changed mid-season, we still record the other side's H2H + blowout.
    if (aTarget) {
      const frA = ensureFranchise(aTarget);
      // H2H opponent is the OTHER side's source franchise (stable across
      // owner changes — Phase 2 rivalry pages key off this).
      if (!frA.headToHead[bId]) frA.headToHead[bId] = { wins: 0, losses: 0, ties: 0 };
      if (aScore > bScore) frA.headToHead[bId].wins++;
      else if (aScore < bScore) frA.headToHead[bId].losses++;
      else frA.headToHead[bId].ties++;

      if (!frA.matchupHistory[bId]) frA.matchupHistory[bId] = [];
      frA.matchupHistory[bId].push({
        year,
        week: weekNum,
        score: aScore,
        opponentScore: bScore,
        isPlayoff: !!playoffMatch,
        playoffRound: playoffMatch?.round ?? null,
        playoffBracket: playoffMatch?.bracket ?? null,
        sourceFranchiseId: aId !== aTarget ? aId : null,
        opponentSourceId: bId !== bTarget ? bId : null,
        bothAttributed,
      });

      const margin = aScore - bScore;
      const game = {
        year, week: weekNum,
        score: aScore, opponentScore: bScore,
        opponentFranchiseId: bId,
        margin: Math.abs(margin),
        sourceFranchiseId: aId !== aTarget ? aId : null,
      };
      if (margin > 0 && (!frA.highlights.biggestBlowoutWin || margin > frA.highlights.biggestBlowoutWin.margin)) {
        frA.highlights.biggestBlowoutWin = game;
      }
      if (margin < 0 && (!frA.highlights.biggestBlowoutLoss || -margin > frA.highlights.biggestBlowoutLoss.margin)) {
        frA.highlights.biggestBlowoutLoss = game;
      }
    }
    if (bTarget) {
      const frB = ensureFranchise(bTarget);
      if (!frB.headToHead[aId]) frB.headToHead[aId] = { wins: 0, losses: 0, ties: 0 };
      if (bScore > aScore) frB.headToHead[aId].wins++;
      else if (bScore < aScore) frB.headToHead[aId].losses++;
      else frB.headToHead[aId].ties++;

      if (!frB.matchupHistory[aId]) frB.matchupHistory[aId] = [];
      frB.matchupHistory[aId].push({
        year,
        week: weekNum,
        score: bScore,
        opponentScore: aScore,
        isPlayoff: !!playoffMatch,
        playoffRound: playoffMatch?.round ?? null,
        playoffBracket: playoffMatch?.bracket ?? null,
        sourceFranchiseId: bId !== bTarget ? bId : null,
        opponentSourceId: aId !== aTarget ? aId : null,
        bothAttributed,
      });

      const margin = bScore - aScore;
      const game = {
        year, week: weekNum,
        score: bScore, opponentScore: aScore,
        opponentFranchiseId: aId,
        margin: Math.abs(margin),
        sourceFranchiseId: bId !== bTarget ? bId : null,
      };
      if (margin > 0 && (!frB.highlights.biggestBlowoutWin || margin > frB.highlights.biggestBlowoutWin.margin)) {
        frB.highlights.biggestBlowoutWin = game;
      }
      if (margin < 0 && (!frB.highlights.biggestBlowoutLoss || -margin > frB.highlights.biggestBlowoutLoss.margin)) {
        frB.highlights.biggestBlowoutLoss = game;
      }
    }
  };

  const weeklyRaw = readJson(path.join(yearDir, 'weekly-results-raw.json'));
  if (Array.isArray(weeklyRaw)) {
    for (const wkPayload of weeklyRaw) {
      const weekNum = parseNum(wkPayload?.weeklyResults?.week);
      const matchups = toArray(wkPayload?.weeklyResults?.matchup);
      for (const m of matchups) {
        const fr = toArray(m?.franchise);
        if (fr.length !== 2) continue;
        recordMatchup(
          fr[0]?.id,
          fr[1]?.id,
          parseNum(fr[0]?.score),
          parseNum(fr[1]?.score),
          weekNum
        );
      }
    }
  }
  // Pre-2020 weekly-results-raw stops at the regular season; schedule.json
  // carries the full season including playoff weeks. recordMatchup dedupes
  // against weekly-results-raw via matchupSeen.
  if (schedule?.schedule?.weeklySchedule) {
    for (const wk of toArray(schedule.schedule.weeklySchedule)) {
      const weekNum = Number(wk.week);
      if (!weekNum) continue;
      for (const m of toArray(wk.matchup)) {
        const fr = toArray(m?.franchise);
        if (fr.length !== 2) continue;
        recordMatchup(
          fr[0]?.id,
          fr[1]?.id,
          parseNum(fr[0]?.score),
          parseNum(fr[1]?.score),
          weekNum
        );
      }
    }
  }

  // Trade ledger from transactions.json. Stored on both sides so rivalry
  // pages can lookup by partner ID without a full re-scan.
  const transactions = readJson(path.join(yearDir, 'transactions.json'));
  const txList = toArray(transactions?.transactions?.transaction);
  // Build a per-year players index lazily — used only when this year has
  // trades to resolve.
  let yearPlayers = null;
  const ensurePlayersIndex = () => {
    if (yearPlayers !== null) return yearPlayers;
    const players = readJson(path.join(yearDir, 'players.json'));
    yearPlayers = new Map();
    if (players?.players?.player) {
      for (const p of toArray(players.players.player)) {
        if (p.id) yearPlayers.set(p.id, { name: p.name, position: p.position, team: p.team });
      }
    }
    return yearPlayers;
  };
  for (const tx of txList) {
    if (tx.type !== 'TRADE') continue;
    const fA = tx.franchise;
    const fB = tx.franchise2;
    if (!fA || !fB) continue;
    const aTarget = attributeYear(fA, year);
    const bTarget = attributeYear(fB, year);
    const aGave = String(tx.franchise1_gave_up || '').split(',').filter(Boolean);
    const bGave = String(tx.franchise2_gave_up || '').split(',').filter(Boolean);
    const timestamp = parseNum(tx.timestamp);
    const comments = tx.comments || '';

    // Pull player names for any numeric asset codes used in this trade so
    // the consumer can resolve them without loading per-year players.json.
    const recordPlayerNames = (codes) => {
      if (!codes.some((c) => /^\d+$/.test(c))) return;
      const idx = ensurePlayersIndex();
      for (const code of codes) {
        if (!/^\d+$/.test(code)) continue;
        if (playerNameLookup[code]) continue;
        const p = idx.get(code);
        if (p) playerNameLookup[code] = p;
      }
    };
    recordPlayerNames(aGave);
    recordPlayerNames(bGave);

    const tradeBothAttributed = aTarget != null && bTarget != null;
    if (aTarget) {
      ensureFranchise(aTarget).trades.push({
        year,
        timestamp,
        partnerId: fB,
        gaveUp: aGave,
        received: bGave,
        comments,
        sourceFranchiseId: fA !== aTarget ? fA : null,
        partnerSourceId: fB !== bTarget ? fB : null,
        bothAttributed: tradeBothAttributed,
      });
    }
    if (bTarget) {
      ensureFranchise(bTarget).trades.push({
        year,
        timestamp,
        partnerId: fA,
        gaveUp: bGave,
        received: aGave,
        comments,
        sourceFranchiseId: fB !== bTarget ? fB : null,
        partnerSourceId: fA !== aTarget ? fA : null,
        bothAttributed: tradeBothAttributed,
      });
    }
  }

  // Rookie draft results — every pick is per-franchise; "[Pick traded from
  // <name>]" comments indicate the slot moved between franchises before the
  // selection was made. We don't try to resolve the prior owner's franchise
  // ID from the comment text (names rotate); the pill is just informational.
  const draftResults = readJson(path.join(yearDir, 'draftResults.json'));
  const draftPicks = toArray(draftResults?.draftResults?.draftUnit?.draftPick);
  const draftPlayerIds = [];
  for (const dp of draftPicks) {
    if (!dp?.franchise || !dp?.player) continue;
    const target = attributeYear(dp.franchise, year);
    if (!target) continue;
    draftPlayerIds.push(dp.player);
    const comments = dp.comments || '';
    ensureFranchise(target).draftPicks.push({
      year,
      round: parseNum(dp.round),
      pick: parseNum(dp.pick),
      playerId: dp.player,
      viaTrade: /Pick traded from/i.test(comments),
      comments: comments.trim(),
      timestamp: parseNum(dp.timestamp),
      sourceFranchiseId: dp.franchise !== target ? dp.franchise : null,
    });
  }

  // Auction wins — `winningBid` is the dollar amount in raw integer form.
  const auctionResults = readJson(path.join(yearDir, 'auctionResults.json'));
  const auctionWins = toArray(auctionResults?.auctionResults?.auctionUnit?.auction);
  const auctionPlayerIds = [];
  for (const aw of auctionWins) {
    if (!aw?.franchise || !aw?.player) continue;
    const target = attributeYear(aw.franchise, year);
    if (!target) continue;
    auctionPlayerIds.push(aw.player);
    ensureFranchise(target).auctionWins.push({
      year,
      playerId: aw.player,
      winningBid: parseNum(aw.winningBid),
      timestamp: parseNum(aw.lastBidTime || aw.timeStarted),
      sourceFranchiseId: aw.franchise !== target ? aw.franchise : null,
    });
  }

  // Resolve player names for any draft + auction picks that haven't already
  // been picked up by the trade-asset resolver. Reuses the per-year players
  // index helper defined above (closes over the same `yearPlayers` cache).
  const allDraftAuctionIds = [...draftPlayerIds, ...auctionPlayerIds];
  if (allDraftAuctionIds.some((c) => /^\d+$/.test(c))) {
    const idx = ensurePlayersIndex();
    for (const code of allDraftAuctionIds) {
      if (!/^\d+$/.test(code)) continue;
      if (playerNameLookup[code]) continue;
      const p = idx.get(code);
      if (p) playerNameLookup[code] = p;
    }
  }

  yearSummaries.push({
    year,
    leagueSize: standingsRows.length,
    champion: champResult?.champion ?? null,
    runnerUp: champResult?.runnerUp ?? null,
    thirdPlace: champResult?.thirdPlace ?? null,
    mvpFranchise: awards?.mvp?.franchiseId ?? null,
    jerryJonesFranchise: awards?.jerryJones?.franchiseId ?? null,
    brockOsweilerFranchise: awards?.osweiler?.franchiseId ?? null,
  });
}

// --- Final post-processing per franchise ---
const franchises = {};
for (const [id, fr] of franchiseMap) {
  fr.yearByYear.sort((a, b) => b.year - a.year);
  fr.championships.sort((a, b) => a - b);
  fr.runnerUps.sort((a, b) => a - b);
  fr.thirdPlaces.sort((a, b) => a - b);
  fr.divisionTitles.sort((a, b) => a.year - b.year);
  fr.mvpAwards.sort((a, b) => a.year - b.year);
  fr.jerryJonesAwards.sort((a, b) => a.year - b.year);
  fr.brockOsweilerAwards.sort((a, b) => a.year - b.year);

  // Sort each opponent's per-meeting history oldest → newest
  for (const oppId of Object.keys(fr.matchupHistory)) {
    fr.matchupHistory[oppId].sort((a, b) => a.year - b.year || a.week - b.week);
  }
  // Trades oldest → newest by timestamp; ties → year asc
  fr.trades.sort((a, b) => a.timestamp - b.timestamp || a.year - b.year);
  // Draft picks: ascending by year then overall pick order
  fr.draftPicks.sort((a, b) => a.year - b.year || a.round - b.round || a.pick - b.pick);
  // Auction wins: ascending by year then bid time
  fr.auctionWins.sort((a, b) => a.year - b.year || a.timestamp - b.timestamp);

  // Pre-2020 playoff enrichment: MFL retired the bracket data for older
  // years so getPlayoffMatchupKeys can't tag those games. The hand-curated
  // championship-history.json knows champion/runnerUp/thirdPlace per year
  // — promote the LATEST meeting between champion+runnerUp (and the
  // matching 3rd-place pair when present) to the championship/3rd round.
  for (const [year, entry] of championshipManualByYear) {
    const tagLatestMeeting = (sideA, sideB, round, bracket) => {
      if (!sideA || !sideB) return;
      // The franchise we're enriching (`id`) only sees the matchup if it's
      // one of the two sides.
      let opponent = null;
      if (id === sideA) opponent = sideB;
      else if (id === sideB) opponent = sideA;
      else return;
      const meetings = fr.matchupHistory[opponent] || [];
      const yearMeetings = meetings.filter((m) => m.year === year);
      if (!yearMeetings.length) return;
      // Skip only if the latest meeting is already labeled with a more
      // specific round than the generic "Playoffs" fallback. Otherwise we
      // upgrade the round name in place.
      const latest = yearMeetings[yearMeetings.length - 1];
      if (latest.playoffRound && latest.playoffRound !== 'Playoffs' && latest.playoffRound !== round) {
        return;
      }
      latest.isPlayoff = true;
      latest.playoffRound = round;
      latest.playoffBracket = bracket;
    };
    tagLatestMeeting(entry.champion, entry.runnerUp, 'Championship', 'championship');
    // 3rd-place tag — populated from championship-history.json when the entry
    // carries `thirdPlace` + `thirdPlaceLoser`. Many older years don't have
    // this curated, in which case the consolation game stays as generic
    // "Playoffs" (the rivalry page still counts it as a playoff meeting).
    if (entry.thirdPlace && entry.thirdPlaceLoser) {
      tagLatestMeeting(entry.thirdPlace, entry.thirdPlaceLoser, '3rd Place', 'consolation');
    }
  }

  // Attach current identity for index/detail rendering
  const team = currentTeams.find((t) => t.franchiseId === id);
  fr.currentName = team?.name ?? id;
  fr.currentNameMedium = team?.nameMedium ?? team?.name ?? id;
  fr.currentNameShort = team?.nameShort ?? team?.nameMedium ?? team?.name ?? id;
  fr.currentAbbrev = team?.abbrev ?? null;
  fr.currentIcon = team?.icon ?? null;
  fr.currentBanner = team?.banner ?? null;
  fr.currentDivision = team?.division ?? null;
  fr.currentColor = team?.color ?? null;
  fr.currentOwnerSince = currentOwnerSinceMap.get(id) ?? null;

  franchises[id] = fr;
}

// Phase 3: badge engine. Each franchise's earned badges are derived from the
// already-aggregated stats above + cross-franchise context (league records,
// per-year leaders, league size per year).
const badgeContext = buildBadgeContext(franchises, yearSummaries);
for (const fid of Object.keys(franchises)) {
  franchises[fid].badges = computeBadgesFor(franchises[fid], badgeContext);
}

// Phase 5: Schefter milestone posts. The previously-committed
// franchise-history.json is the snapshot we diff against — if it's missing
// (fresh checkout / first run) we silently seed and emit nothing so we
// don't flood the feed with retroactive posts for every existing badge.
const previousOutput = readJson(OUTPUT_PATH);
if (!previousOutput?.franchises) {
  console.log('[franchise-history] no previous snapshot — milestone diff skipped (silent seed)');
} else {
  const newAwards = diffNewAwards(previousOutput.franchises, franchises);
  if (newAwards.length === 0) {
    console.log('[franchise-history] no new badges — milestone diff empty');
  } else {
    const now = new Date();
    const milestonePosts = newAwards.map((entry) =>
      buildMilestonePost({
        franchiseId: entry.franchiseId,
        badge: entry.badge,
        award: entry.award,
        franchise: franchises[entry.franchiseId],
        now,
      })
    );
    const feed = readJson(SCHEFTER_FEED_PATH);
    if (feed && Array.isArray(feed.posts)) {
      const { posts, added } = mergeMilestonePosts(feed.posts, milestonePosts);
      if (added > 0) {
        feed.posts = posts;
        feed.lastScanTimestamp = now.toISOString();
        fs.writeFileSync(SCHEFTER_FEED_PATH, JSON.stringify(feed, null, 2) + '\n');
        console.log(
          `[franchise-history] emitted ${added} new milestone post(s) to ${SCHEFTER_FEED_PATH}`
        );
      } else {
        console.log(
          `[franchise-history] ${milestonePosts.length} milestone(s) already in feed — no new posts`
        );
      }
    } else {
      console.warn(
        `[franchise-history] could not load ${SCHEFTER_FEED_PATH} — skipping milestone emission`
      );
    }
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  yearsCovered: years.filter((y) => franchiseMap.size > 0),
  yearSummaries,
  franchises,
  playerNames: playerNameLookup,
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

const champCount = yearSummaries.filter((y) => y.champion).length;
console.log(
  `[franchise-history] wrote ${OUTPUT_PATH}: ${Object.keys(franchises).length} franchises, ${years.length} years scanned, ${champCount} championship years`
);
