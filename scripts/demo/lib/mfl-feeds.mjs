/**
 * Serializes a simulated season (scripts/demo/lib/simulate.mjs) into the
 * files MyFantasyLeague's exports produce — the same names, the same nesting,
 * the same string-typed numbers — so every parser and derivation script in the
 * repo reads the demo league exactly as it reads a real one.
 *
 * Shapes are copied from the committed feeds under data/<league>/mfl-feeds/;
 * the NFL-fact files (players, NFL schedule, player scores, ADP, injuries) are
 * not produced here — build-demo-data.mjs carries them over unchanged.
 */

import { LEAGUE_RULES } from './simulate.mjs';

const money = (n) => `$${Number(n).toFixed(2)}`;
const two = (n) => (Math.round(n * 100) / 100).toString();
const envelope = (body) => ({ version: '1.0', encoding: 'utf-8', ...body });

export function leagueFeed({ season, leagueId, leagueName, franchises, divisions, assetBase, years, baseUrl }) {
  return envelope({
    league: {
      id: leagueId,
      name: leagueName,
      baseURL: baseUrl,
      h2h: 'YES',
      keeperType: 'dynasty',
      usesSalaries: 'YES',
      usesContractYear: 'YES',
      salaryCapAmount: String(LEAGUE_RULES.salaryCap),
      auctionStartAmount: String(LEAGUE_RULES.salaryCap),
      rosterSize: String(LEAGUE_RULES.rosterSize),
      taxiSquad: String(LEAGUE_RULES.taxiSize),
      injuredReserve: '50',
      includeIRWithSalary: '100',
      includeTaxiWithSalary: '100',
      startWeek: '1',
      lastRegularSeasonWeek: String(LEAGUE_RULES.regularSeasonWeeks),
      endWeek: String(LEAGUE_RULES.endWeek),
      currentWaiverType: 'BBID_FCFS',
      bbidMinimum: String(LEAGUE_RULES.minSalary),
      bbidIncrement: '25000',
      bbidConditional: 'Yes',
      bbidTiebreaker: 'Standings',
      minBid: String(LEAGUE_RULES.minSalary),
      bidIncrement: '25000',
      draft_kind: 'email',
      auction_kind: 'email',
      loadRosters: 'email_draft_email_auction',
      draftPlayerPool: 'Rookie',
      bestLineup: 'No',
      partialLineupAllowed: 'No',
      lockout: 'No',
      precision: '2',
      playerLimitUnit: 'LEAGUE',
      rostersPerPlayer: '1',
      standingsSort: 'H2H,PCT,PTS,',
      defaultTradeExpirationDays: '7',
      maxWaiverRounds: '5',
      mobileAlerts: '',
      starters: {
        count: '9',
        position: [
          { name: 'QB', limit: '1' },
          { name: 'RB', limit: '1-4' },
          { name: 'WR', limit: '1-4' },
          { name: 'TE', limit: '1-4' },
          { name: 'PK', limit: '1' },
          { name: 'Def', limit: '1' },
        ],
      },
      divisions: {
        count: String(divisions.length),
        division: divisions.map((name, i) => ({ id: String(i).padStart(2, '0'), name })),
      },
      franchises: {
        count: String(franchises.length),
        franchise: franchises.map((f) => ({
          id: f.id,
          name: f.name,
          abbrev: f.abbrev,
          division: String(f.divisionIndex).padStart(2, '0'),
          icon: `${assetBase}/icons/${f.slug}.svg`,
          logo: `${assetBase}/icons/${f.slug}.svg`,
          owner_name: f.owner,
          salaryCapAmount: '',
          waiverSortOrder: String(16 - season.standings.findIndex((s) => s.id === f.id)),
          bbidAvailableBalance: two(Math.max(0, LEAGUE_RULES.salaryCap - capUsed(season, f.id))),
        })),
      },
      history: {
        league: [...years].reverse().map((y) => ({ year: String(y), url: `${baseUrl.replace(/\/\d{4}.*$/, '')}/${y}/home/${leagueId}` })),
      },
    },
  });
}

function capUsed(season, fid) {
  return [...(season.rosters.get(fid)?.values() ?? [])].reduce((s, c) => s + c.salary, 0);
}

export function rostersFeed(season) {
  return envelope({
    rosters: {
      franchise: [...season.rosters].map(([fid, roster]) => ({
        id: fid,
        week: String(Math.max(1, season.lastWeek)),
        player: [...roster].map(([pid, c]) => ({
          id: pid,
          status: c.status,
          salary: c.salary.toFixed(2),
          contractYear: String(c.contractYear),
          contractInfo: '',
        })),
      })),
    },
  });
}

export function standingsFeed(season) {
  return envelope({
    leagueStandings: {
      franchise: season.standings.map((r) => {
        const games = r.w + r.l + r.t;
        const cap = capUsed(season, r.id);
        return {
          id: r.id,
          h2hw: String(r.w),
          h2hl: String(r.l),
          h2ht: String(r.t),
          h2hwlt: `${r.w}-${r.l}-${r.t}`,
          h2hpct: r.pct,
          pf: two(r.pf),
          pa: two(r.pa),
          pp: two(r.pp),
          avgpf: games ? (r.pf / games).toFixed(1) : '0.0',
          maxpa: two(Math.max(0, ...r.scores)),
          minpa: two(r.scores.length ? Math.min(...r.scores) : 0),
          eff: r.pp ? ((r.pf / r.pp) * 100).toFixed(1) : '0.0',
          divw: String(r.divw),
          divl: String(r.divl),
          divt: String(r.divt),
          divpct: r.divpct,
          divpf: two(r.divpf),
          nondivw: String(r.w - r.divw),
          nondivl: String(r.l - r.divl),
          nondivt: String(r.t - r.divt),
          all_play_w: String(r.allW),
          all_play_l: String(r.allL),
          all_play_t: '0',
          all_play_pct: r.allPlayPct,
          salary: money(cap),
          bbidspent: money(LEAGUE_RULES.salaryCap),
          bbidbalance: money(Math.max(0, LEAGUE_RULES.salaryCap - cap)),
          eliminated: '',
        };
      }),
    },
  });
}

export function scheduleFeed(season, franchises) {
  // Future weeks carry the pairing with no score, as MFL's schedule does.
  const played = new Map(season.weekly.filter((w) => w.regularSeason).map((w) => [w.week, w]));
  return envelope({
    schedule: {
      weeklySchedule: season.schedule.map((games, i) => {
        const week = i + 1;
        const result = played.get(week);
        return {
          week: String(week),
          matchup: games.map(([home, away], g) => {
            const r = result?.games[g];
            const side = (id, isHome, lineup, other) => ({
              id,
              isHome: isHome ? '1' : '0',
              ...(lineup
                ? { score: two(lineup.score), result: lineup.score === other.score ? 'T' : lineup.score > other.score ? 'W' : 'L' }
                : {}),
            });
            return { franchise: [side(away, false, r?.[1], r?.[0]), side(home, true, r?.[0], r?.[1])] };
          }),
        };
      }),
    },
  });
}

/** `weekly-results-raw.json`: one weeklyResults export per played week. */
export function weeklyResultsRawFeed(season) {
  const byWeek = new Map();
  for (const w of season.weekly) {
    if (!byWeek.has(w.week)) byWeek.set(w.week, []);
    byWeek.get(w.week).push(w);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, entries]) =>
      envelope({
        weeklyResults: {
          week: String(week),
          matchup: entries.flatMap((w) =>
            w.games.map(([home, away, hid, aid]) => ({
              ...(w.regularSeason ? { regularSeason: '1' } : {}),
              franchise: [
                lineupSide(aid, away, home, false),
                lineupSide(hid, home, away, true),
              ],
            })),
          ),
        },
      }),
    );
}

function lineupSide(id, lineup, other, isHome) {
  return {
    id,
    isHome: isHome ? '1' : '0',
    score: two(lineup.score),
    opt_pts: two(lineup.optPts),
    result: lineup.score === other.score ? 'T' : lineup.score > other.score ? 'W' : 'L',
    starters: lineup.starters.map((p) => `${p},`).join(''),
    nonstarters: lineup.nonstarters.map((p) => `${p},`).join(''),
    optimal: lineup.optimal.map((p) => `${p},`).join(''),
    player: lineup.players,
  };
}

/** `weekly-results.json`: the compact per-week franchise score table. */
export function weeklyResultsFeed(season) {
  const weeks = new Map();
  for (const w of season.weekly) {
    const scores = weeks.get(w.week) ?? {};
    for (const [home, away, hid, aid] of w.games) {
      scores[hid] = home.score;
      scores[aid] = away.score;
    }
    weeks.set(w.week, scores);
  }
  return { weeks: [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([week, scores]) => ({ week, scores })) };
}

export function transactionsFeed(season) {
  return envelope({ transactions: { transaction: season.transactions } });
}

export function draftResultsFeed(season) {
  const round1 = season.draftPicks.filter((p) => p.round === '01').map((p) => p.franchise);
  return envelope({
    draftResults: {
      draftUnit: {
        unit: 'LEAGUE',
        draftType: 'SAME',
        round1DraftOrder: round1.map((f) => `${f},`).join(''),
        static_url: '',
        draftPick: season.draftPicks,
      },
    },
  });
}

export function auctionResultsFeed(season) {
  return envelope({ auctionResults: { auctionUnit: { unit: 'LEAGUE', auction: season.auctionResults } } });
}

export function futureDraftPicksFeed(season) {
  return envelope({
    futureDraftPicks: {
      franchise: [...season.futurePicks].map(([fid, picks]) => ({
        id: fid,
        futureDraftPick: picks
          .sort((a, b) => a.year - b.year || a.round - b.round)
          .map((p) => ({ year: String(p.year), round: String(p.round), originalPickFor: p.originalPickFor })),
      })),
    },
  });
}

export function salaryAdjustmentsFeed(season) {
  return envelope({
    salaryAdjustments: {
      salaryAdjustment: season.salaryAdjustments.map((a, i) => ({ id: String(i), ...a })),
    },
  });
}

/** `playoff-brackets.json`: the bracket list plus each bracket's games. */
export function playoffBracketsFeed(season, leagueName) {
  const po = season.playoffs;
  const list = [
    { id: '1', name: `${leagueName} Championship`, bracketWinnerTitle: `${leagueName} Champion`, teamsInvolved: '7', startWeek: '15', startWeekGames: '3' },
    { id: '2', name: '3rd Place Bracket', bracketWinnerTitle: '3rd Place', teamsInvolved: '2', startWeek: '17', startWeekGames: '1' },
    { id: '5', name: 'The Toilet Bowl', bracketWinnerTitle: 'Toilet Bowl Champion', teamsInvolved: '7', startWeek: '15', startWeekGames: '3' },
  ];
  const brackets = {};
  if (po) {
    brackets['1'] = bracketBody('1', po.championship, po.seeds);
    brackets['5'] = bracketBody('5', po.toiletBowl, po.bottom);
    if (po.thirdPlace) {
      brackets['2'] = envelope({
        playoffBracket: {
          bracket_id: '2',
          playoffRound: {
            week: '17',
            playoffGame: gameBody(po.thirdPlace, { home: { loser_of_game: '4' }, away: { loser_of_game: '5' } }),
          },
        },
      });
    }
  }
  return { playoffBrackets: { playoffBracket: list }, brackets };
}

function gameBody(g, extra = { home: {}, away: {} }) {
  return {
    game_id: String(g.gameId),
    home: { franchise_id: g.home.id, points: two(g.home.lineup.score), ...extra.home },
    away: { franchise_id: g.away.id, points: two(g.away.lineup.score), ...extra.away },
  };
}

function bracketBody(id, bracket, seeds) {
  const seedOf = new Map(seeds.map((s) => [s.id, String(s.seed)]));
  return envelope({
    playoffBracket: {
      bracket_id: id,
      playoffRound: bracket.rounds.map((round) => ({
        week: String(round.week),
        playoffGame: round.games.map((g) => {
          if (round.week === 15) {
            return gameBody(g, { home: { seed: seedOf.get(g.home.id) }, away: { seed: seedOf.get(g.away.id) } });
          }
          const [hFrom, aFrom] = g.from ?? [];
          return gameBody(g, {
            home: hFrom ? { winner_of_game: String(hFrom) } : { seed: seedOf.get(g.home.id) },
            away: aFrom ? { winner_of_game: String(aFrom) } : { seed: seedOf.get(g.away.id) },
          });
        }),
      })),
    },
  });
}

/**
 * The league calendar: auction, rookie draft, cut-down day, trade deadline,
 * and the weekly waiver runs — the events the homepage and deadline pages read.
 */
export function calendarFeed(season, weekStart) {
  const k1 = weekStart(season.year, 1);
  const day = 86_400;
  const event = (id, type, start, title = '') => ({ id: String(id), type, start_time: String(start), end_time: '', happens: '', title });
  const events = [
    event(1, 'AUCTION_START', k1 - 170 * day),
    event(2, 'DRAFT_START', k1 - 120 * day),
    event(3, 'CUSTOM', k1 - 9 * day, 'Roster cut-down day. Max roster size enforced.'),
    event(4, 'TRADE_DEADLINE', weekStart(season.year, 11)),
  ];
  for (let week = 1; week <= LEAGUE_RULES.endWeek; week++) {
    events.push(event(100 + week, 'WAIVER_LOCK', weekStart(season.year, week) - 2 * day));
  }
  return events;
}

export function fetchMetaFeed(season, leagueId, generatedAt) {
  return { lastFetched: generatedAt, leagueId, year: String(season.year), week: null };
}
