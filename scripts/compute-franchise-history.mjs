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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FEEDS_DIR = path.join(ROOT, 'data/theleague/mfl-feeds');
const SALARIES_DIR = path.join(ROOT, 'data/theleague');
const LEAGUE_CONFIG_PATH = path.join(ROOT, 'src/data/theleague.config.json');
const OUTPUT_PATH = path.join(ROOT, 'data/theleague/derived/franchise-history.json');

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
      highlights: { highestSingleGame: null, lowestSingleGame: null },
    });
  }
  return franchiseMap.get(id);
};

const yearSummaries = []; // for the index page: champion/runner-up per year

for (const year of years) {
  const yearDir = path.join(FEEDS_DIR, String(year));
  const standings = readJson(path.join(yearDir, 'standings.json'));
  if (!isValidFeed(standings) || !standings.leagueStandings) continue;

  const leagueJson = readJson(path.join(yearDir, 'league.json'));
  const playoffBrackets = readJson(path.join(yearDir, 'playoff-brackets.json'));
  const weeklyResults = readJson(path.join(yearDir, 'weekly-results.json'));
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

  // Division titles — best record per division (tiebreak by PF)
  const divisionTitleHolders = new Map(); // divisionId -> franchiseId
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

  // Championship results
  const champResult = getChampionshipResult(playoffBrackets);
  const playoffParticipants = getPlayoffParticipants(playoffBrackets);

  // Awards from salaries
  const awards = computeAwardsForYear(salaryData);

  // Per-franchise per-year row — apply ownerHistory attribution so years
  // follow the human owner across franchise-ID changes.
  for (const row of standingsRows) {
    const targetId = attributeYear(row.franchiseId, year);
    if (!targetId) continue; // skip — former-owner year on a team that has ownerHistory

    const fr = ensureFranchise(targetId);
    const identity = getIdentityForYear(row.franchiseId, year);

    let playoffResult = playoffParticipants.has(row.franchiseId) ? 'playoffs' : 'missed';
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
      regSeasonRank: row.regSeasonRank,
      divisionId: row.divisionId,
      divisionName: row.divisionId ? divisionNames.get(row.divisionId) : null,
      wonDivision: !!wonDivision,
      playoffResult,
    });

    fr.careerWins += row.wins;
    fr.careerLosses += row.losses;
    fr.careerTies += row.ties;
    fr.careerPointsFor += row.pointsFor;
    fr.yearsActive += 1;
    if (playoffParticipants.has(row.franchiseId)) fr.playoffAppearances += 1;

    if (champResult?.champion === row.franchiseId) {
      fr.championships.push(year);
    } else if (champResult?.runnerUp === row.franchiseId) {
      fr.runnerUps.push(year);
    } else if (champResult?.thirdPlace === row.franchiseId) {
      fr.thirdPlaces.push(year);
    }

    if (wonDivision) {
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

  yearSummaries.push({
    year,
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

const output = {
  generatedAt: new Date().toISOString(),
  yearsCovered: years.filter((y) => franchiseMap.size > 0),
  yearSummaries,
  franchises,
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

const champCount = yearSummaries.filter((y) => y.champion).length;
console.log(
  `[franchise-history] wrote ${OUTPUT_PATH}: ${Object.keys(franchises).length} franchises, ${years.length} years scanned, ${champCount} championship years`
);
