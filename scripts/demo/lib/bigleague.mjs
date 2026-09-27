/**
 * The /bigleague demo (docs/plans/custom-site-demo.md): a fictional 96-team
 * league in the AFL's slot — eight conferences of twelve, two divisions each,
 * rendered by the AFL's own pages (components/afl-family and friends).
 *
 * - Redraft: every roster is re-drafted each season, a snake within each
 *   conference. Each conference is its own player pool, as the AFL's two are,
 *   so a player can be on one team per conference (MFL's
 *   `playerLimitUnit: CONFERENCE`).
 * - Weeks 1-12: the regular season, inside each conference. Weeks 13-14: a
 *   four-team playoff per conference (two division winners, two wild cards).
 *   Weeks 15-17: the eight conference champions play one bracket for the
 *   overall title.
 * - Tiers, an all-play side competition across the whole league: Premier
 *   League (20), A League (20), D-League (56). Four teams move up and four
 *   down between neighbouring tiers each season.
 *
 * Nothing here may resemble a real franchise or owner — the post-build leak
 * scan fails the demo build if one does.
 */

import { simulateLeague } from './simulate.mjs';
import { lighten } from './franchises.mjs';
import { bannerSvg, crestSvg } from './crests.mjs';
import { WAR_PAINT_PALETTES, warPaintFiles } from './war-paint.mjs';

export const BIGLEAGUE_NAME = 'The Big League';
export const BIGLEAGUE_REGULAR_SEASON_WEEKS = 12;
export const CONFERENCE_PLAYOFF_WEEKS = [13, 14];
export const OVERALL_PLAYOFF_WEEKS = [15, 16, 17];
export const TIERS = ['Premier League', 'A League', 'D-League'];
export const TIER_SIZES = [20, 20, 56];
export const TIER_MOVEMENT = 4;

/** code, name, short, colour, [division names] — division names are unique league-wide. */
const CONFERENCES = [
  ['00', 'Atlantic Conference', 'ATL', '#1f4e79', ['Atlantic North', 'Atlantic South']],
  ['01', 'Pacific Conference', 'PAC', '#0e7c7b', ['Pacific North', 'Pacific South']],
  ['02', 'Lakes Conference', 'LKS', '#3a5a40', ['Lakes East', 'Lakes West']],
  ['03', 'Frontier Conference', 'FRO', '#8c4a2f', ['Frontier East', 'Frontier West']],
  ['04', 'Heartland Conference', 'HRT', '#a4161a', ['Heartland North', 'Heartland South']],
  ['05', 'Gulf Conference', 'GLF', '#b5651d', ['Gulf East', 'Gulf West']],
  ['06', 'Summit Conference', 'SUM', '#5a4e8c', ['Summit North', 'Summit South']],
  ['07', 'Prairie Conference', 'PRA', '#6b7f2a', ['Prairie East', 'Prairie West']],
].map(([code, name, short, color, divisions]) => ({ code, name, short, color, divisions }));

export const BIGLEAGUE_CONFERENCES = CONFERENCES;

/** 96 invented places — one per team. */
const PLACES = [
  'Amberfield', 'Ashgrove', 'Bellhaven', 'Birchmont', 'Bramblewood', 'Brightwater', 'Cairnhill', 'Cinderbay',
  'Clearbrook', 'Coldspring', 'Copperton', 'Crestmoor', 'Dalebury', 'Driftwood', 'Dunmere', 'Eastvale',
  'Elmstead', 'Emberly', 'Fairhollow', 'Fernwick', 'Flintridge', 'Foxmoor', 'Galeport', 'Glenrock',
  'Goldmere', 'Granite Bay', 'Greyhaven', 'Hartwell', 'Hazelford', 'Highgate', 'Hollowmere', 'Ironwood',
  'Juniper Falls', 'Kestrel Point', 'Kingsbridge', 'Lakemont', 'Larkspur', 'Lindenhall', 'Lochridge', 'Maplecrest',
  'Marblehead Bay', 'Meadowbrook', 'Millbrook', 'Mistvale', 'Moonridge', 'Northfield', 'Oakhaven', 'Obsidian Bay',
  'Oldcastle', 'Pebble Creek', 'Pinehurst', 'Portsmere', 'Quarry Hill', 'Ravenmoor', 'Redcliff', 'Ridgewater',
  'Riverbend', 'Rockhollow', 'Rosewood', 'Saltmarsh', 'Sandstone', 'Shadowbrook', 'Silverlake', 'Skyline',
  'Southmere', 'Springvale', 'Starfall', 'Stonebridge', 'Stormhaven', 'Sunmeadow', 'Thornbury', 'Timbercrest',
  'Tidewater', 'Twin Pines', 'Valewood', 'Westbrook', 'Whisper Hills', 'Wildermoor', 'Willowdale', 'Windham',
  'Wolfcreek', 'Woodhaven', 'Yarrow', 'Cobalt Point', 'Alderbrook', 'Bayshore', 'Blackwater', 'Canyon Ridge',
  'Deerfield', 'Evergreen', 'Frostburg', 'Glacier Bay', 'Harborview', 'Ivy Glen', 'Lantern Hill', 'Mesa Verde Park',
];

/** 96 invented team nicknames — one per team. */
const NICKNAMES = [
  'Badgers', 'Beacons', 'Bison', 'Blizzards', 'Bobcats', 'Bombers', 'Boulders', 'Buccaneers',
  'Caribou', 'Chargers', 'Comets', 'Condors', 'Cougars', 'Coyotes', 'Cyclones', 'Dragons',
  'Drifters', 'Eagles', 'Engineers', 'Express', 'Falcons', 'Ferrets', 'Firebirds', 'Foxes',
  'Gators', 'Geysers', 'Gladiators', 'Grizzlies', 'Hammers', 'Harriers', 'Hawks', 'Herons',
  'Hornets', 'Huskies', 'Ibex', 'Jackals', 'Jaguars', 'Javelins', 'Kodiaks', 'Lancers',
  'Lynx', 'Mammoths', 'Mariners', 'Marlins', 'Muskies', 'Meteors', 'Monarchs', 'Mustangs',
  'Navigators', 'Nighthawks', 'Oilers', 'Orcas', 'Ospreys', 'Otters', 'Owls', 'Panthers',
  'Pelicans', 'Pilots', 'Pioneers', 'Prowlers', 'Pumas', 'Quakes', 'Rams', 'Rangers',
  'Rattlers', 'Ravens', 'Riptide', 'Rockets', 'Sabres', 'Scorpions', 'Sentinels', 'Sharks',
  'Skippers', 'Sparrows', 'Stallions', 'Stingrays', 'Storm', 'Summit', 'Tempest', 'Thunder',
  'Timberwolves', 'Titans', 'Tornadoes', 'Trailblazers', 'Tritons', 'Vanguard', 'Vipers', 'Voyagers',
  'Walruses', 'Warhawks', 'Wildcats', 'Wolverines', 'Wranglers', 'Yetis', 'Gusts', 'Stags',
];

const FIRST = [
  'Avery', 'Blake', 'Cameron', 'Dana', 'Elliot', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kai', 'Lane',
  'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sage', 'Tatum', 'Umi', 'Val', 'Wynn', 'Yael',
];
const LAST = ['Ashby', 'Brennick', 'Calloway', 'Dunstan'];

const PALETTE = [
  ['#0b3954', '#bfd7ea'], ['#7a1e2c', '#f2d0a4'], ['#1b4332', '#d8f3dc'], ['#3c096c', '#e0aaff'],
  ['#9a3412', '#fed7aa'], ['#1e3a8a', '#fde68a'], ['#374151', '#fca5a5'], ['#065f46', '#fef3c7'],
  ['#7c2d12', '#bae6fd'], ['#312e81', '#c7d2fe'], ['#831843', '#fbcfe8'], ['#134e4a', '#99f6e4'],
];

const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const abbrevOf = (place, nick) => {
  const words = place.split(/\s+/);
  const head = words.length > 1 ? words.map((w) => w[0]).join('') : place.slice(0, 2);
  return (head + nick[0]).toUpperCase().slice(0, 3);
};

/** The 96 franchises: ids 0001-0096, conference c holds 12 consecutive ids. */
export const BIGLEAGUE_FRANCHISES = Array.from({ length: 96 }, (_, i) => {
  const conference = CONFERENCES[Math.floor(i / 12)];
  const local = i % 12;
  const divisionLocal = local < 6 ? 0 : 1;
  const place = PLACES[i];
  const nick = NICKNAMES[(i * 37) % 96];
  const name = `${place} ${nick}`;
  const [colorPrimary, colorSecondary] = PALETTE[(i * 5) % PALETTE.length];
  const owner = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;
  return {
    id: String(i + 1).padStart(4, '0'),
    name,
    nameShort: nick,
    abbrev: abbrevOf(place, nick),
    owner,
    ownerFirst: owner.split(' ')[0],
    slug: slugOf(name),
    conference: conference.code,
    divisionIndex: Number(conference.code) * 2 + divisionLocal,
    division: conference.divisions[divisionLocal],
    colorPrimary,
    colorSecondary,
    colorPrimaryDark: lighten(colorPrimary, 0.25),
    colorSecondaryDark: lighten(colorSecondary, 0.6),
  };
});

export const BIGLEAGUE_DIVISIONS = CONFERENCES.flatMap((c) => c.divisions);

const ASSET_ROOT = '/assets/afl';

function assetPaths(f) {
  return {
    icon: `${ASSET_ROOT}/icons/${f.slug}.svg`,
    iconDark: `${ASSET_ROOT}/icons/${f.slug}_dark.svg`,
    banner: `${ASSET_ROOT}/banners/${f.slug}.svg`,
  };
}

const confLogo = (c) => `${ASSET_ROOT}/conferences/${c.short.toLowerCase()}.svg`;
const confLogoDark = (c) => `${ASSET_ROOT}/conferences/${c.short.toLowerCase()}-dark.svg`;

/** A conference or tier mark: a coloured disc with its short label. */
function badgeSvg(label, color, { dark = false } = {}) {
  const ink = dark ? '#f5f5f5' : '#ffffff';
  const safe = String(label).replace(/[&<>"']/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="${safe}">
<circle cx="60" cy="60" r="54" fill="${color}" stroke="${ink}" stroke-width="6"/>
<text x="60" y="72" text-anchor="middle" font-family="Arial Black, Helvetica, Arial, sans-serif" font-weight="900" font-size="${safe.length > 3 ? 26 : 34}" fill="${ink}">${safe}</text>
</svg>
`;
}

const TIER_ART = [
  ['premier', 'PL', '#5b2a86'],
  ['tiers/a-league', 'AL', '#1d6fa3'],
  ['dleague', 'DL', '#4a5568'],
];

/** Every file under public/ the big league reads: crests, banners, conference and tier marks. */
export function bigLeagueArtFiles() {
  const files = new Map();
  const strip = (p) => p.replace(/^\//, '');
  for (const f of BIGLEAGUE_FRANCHISES) {
    const p = assetPaths(f);
    files.set(strip(p.icon), crestSvg(f));
    files.set(strip(p.iconDark), crestSvg(f, { dark: true }));
    files.set(strip(p.banner), bannerSvg(f));
  }
  for (const c of CONFERENCES) {
    files.set(strip(confLogo(c)), badgeSvg(c.short, c.color));
    files.set(strip(confLogoDark(c)), badgeSvg(c.short, c.color, { dark: true }));
  }
  for (const [file, label, color] of TIER_ART) {
    files.set(`assets/afl/${file}.svg`, badgeSvg(label, color));
    files.set(`assets/afl/${file}-dark.svg`, badgeSvg(label, color, { dark: true }));
  }
  // The slot's own header mark (afl-logo*.svg) is replaced, as the dynasty
  // demo replaces TheLeague's, so the real AFL's logo never renders here.
  for (const base of ['bigleague-logo', 'afl-logo']) {
    for (const [rel, svg] of warPaintFiles(base, WAR_PAINT_PALETTES.afl, BIGLEAGUE_NAME)) files.set(rel, svg);
  }
  return files;
}

/**
 * `data/afl-fantasy/afl.config.json` for the big league — the AFL config's
 * shape, with eight conferences, three tiers and `structure: multi-conference`.
 */
export function bigLeagueConfig({ leagueId, currentTiers }) {
  return {
    $comment: 'Demo big league (fictional), generated by scripts/demo. See docs/plans/custom-site-demo.md.',
    leagueId,
    name: BIGLEAGUE_NAME,
    loaderLines: ['Counting 96 rosters…', 'Seeding eight conference brackets…'],
    teams: BIGLEAGUE_FRANCHISES.map((f) => ({
      franchiseId: f.id,
      name: f.name,
      nameMedium: f.name,
      nameShort: f.nameShort,
      abbrev: f.abbrev,
      aliases: [],
      conference: f.conference,
      division: f.division,
      tier: currentTiers.get(f.id) ?? TIERS[TIERS.length - 1],
      colorPrimary: f.colorPrimary,
      colorSecondary: f.colorSecondary,
      loaderQuips: [`${f.nameShort} are setting a lineup…`],
      ...assetPaths(f),
    })),
    draftRounds: 22,
    keepers: 0,
    structure: 'multi-conference',
    conferences: CONFERENCES.map((c) => ({
      name: c.name,
      short: c.short,
      code: c.code,
      color: c.color,
      logo: confLogo(c),
      logoDark: confLogoDark(c),
      divisions: c.divisions,
      divisionNames: Object.fromEntries(c.divisions.map((d) => [d, d])),
      draftKind: 'email',
    })),
    divisions: BIGLEAGUE_DIVISIONS,
    divisionToConference: Object.fromEntries(CONFERENCES.flatMap((c) => c.divisions.map((d) => [d, c.code]))),
    tierCompetition: {
      cutoffWeek: BIGLEAGUE_REGULAR_SEASON_WEEKS,
      tiers: TIERS,
      sizes: TIER_SIZES,
      movement: { promote: TIER_MOVEMENT, relegate: TIER_MOVEMENT },
    },
    nit: false,
    postseason: {
      conferencePlayoffWeeks: CONFERENCE_PLAYOFF_WEEKS,
      overallPlayoffWeeks: OVERALL_PLAYOFF_WEEKS,
    },
    features: {},
  };
}

/** The big league's league.json: the dynasty feed's shape, re-cut for eight conferences and redraft. */
export function bigLeagueFeed(base) {
  const league = { ...base.league };
  league.name = BIGLEAGUE_NAME;
  league.keeperType = 'redraft';
  league.usesSalaries = 'NO';
  league.usesContractYear = 'NO';
  league.maxKeepers = '0';
  league.minKeepers = '0';
  league.taxiSquad = '0';
  league.currentWaiverType = 'WAIVERS_FCFS';
  for (const k of ['salaryCapAmount', 'auctionStartAmount', 'bbidMinimum', 'bbidIncrement', 'bbidConditional', 'bbidTiebreaker', 'minBid', 'bidIncrement', 'auction_kind']) {
    delete league[k];
  }
  league.draft_kind = 'email';
  league.loadRosters = 'email_draft';
  league.draftPlayerPool = 'Both';
  league.playerLimitUnit = 'CONFERENCE';
  league.rostersPerPlayer = '1';
  league.lastRegularSeasonWeek = String(BIGLEAGUE_REGULAR_SEASON_WEEKS);
  league.endWeek = String(OVERALL_PLAYOFF_WEEKS[OVERALL_PLAYOFF_WEEKS.length - 1]);
  league.conferences = { count: String(CONFERENCES.length), conference: CONFERENCES.map((c) => ({ name: c.name, id: c.code })) };
  const divisions = CONFERENCES.flatMap((c) =>
    c.divisions.map((name, i) => ({ id: String(Number(c.code) * 2 + i).padStart(2, '0'), name, conference: c.code })),
  );
  league.divisions = { count: String(divisions.length), division: divisions };
  league.franchises = {
    ...league.franchises,
    // Waiver order runs within each conference, 1-12.
    franchise: league.franchises.franchise.map((f, i) => ({
      ...f,
      waiverSortOrder: String((i % 12) + 1),
      bbidAvailableBalance: undefined,
      salaryCapAmount: undefined,
    })),
  };
  return { ...base, league };
}

/** draftResults.json: one draft unit per conference, as the AFL's feed has. */
export function bigLeagueDraftResults(season) {
  return {
    version: '1.0',
    encoding: 'utf-8',
    draftResults: {
      draftUnit: CONFERENCES.map((c) => {
        const picks = season.draftPicksByConference.get(c.code) ?? [];
        const round1 = picks.filter((p) => p.round === '01').map((p) => p.franchise);
        return {
          unit: `CONFERENCE${c.code}`,
          draftType: 'SAME',
          round1DraftOrder: round1.map((f) => `${f},`).join(''),
          static_url: '',
          draftPick: picks,
        };
      }),
    },
  };
}

const pctOf = (r) => (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);

/** League-wide all-play over the given weeks (every team against all 95 others). */
function allPlay(rows, weekly, throughWeek = Infinity) {
  const acc = new Map(rows.map((r) => [r.id, { w: 0, l: 0, t: 0 }]));
  const byWeek = new Map();
  for (const w of weekly) {
    if (w.week > throughWeek) continue;
    const scores = byWeek.get(w.week) ?? new Map();
    for (const [home, away, hid, aid] of w.games) {
      scores.set(hid, home.score);
      scores.set(aid, away.score);
    }
    byWeek.set(w.week, scores);
  }
  for (const scores of byWeek.values()) {
    for (const [id, s] of scores) {
      const a = acc.get(id);
      if (!a) continue;
      for (const [other, o] of scores) {
        if (other === id) continue;
        if (s > o) a.w++;
        else if (s < o) a.l++;
        else a.t++;
      }
    }
  }
  return acc;
}

/**
 * Simulate the big league: each conference as its own 12-team redraft league
 * (its own player pool), merged week by week, then the conference playoffs,
 * the overall bracket and the tier competition.
 */
export function simulateBigLeague({ years, facts, currentYear, currentWeek, rng, weekStart }) {
  const byConference = CONFERENCES.map((c) => ({
    conference: c,
    seasons: simulateLeague({
      years,
      facts,
      currentYear,
      currentWeek,
      franchises: BIGLEAGUE_FRANCHISES.filter((f) => f.conference === c.code),
      rng: rng.fork(`conference-${c.code}`),
      weekStart,
      mode: 'redraft',
      regularSeasonWeeks: BIGLEAGUE_REGULAR_SEASON_WEEKS,
      postseason: false,
    }),
  }));
  const confOf = new Map(BIGLEAGUE_FRANCHISES.map((f) => [f.id, f.conference]));
  const divOf = new Map(BIGLEAGUE_FRANCHISES.map((f) => [f.id, f.divisionIndex]));

  const seasons = [];
  let membership = null; // fid → tier, this season
  const tierHistory = {};

  years.forEach((year, yi) => {
    const parts = byConference.map(({ conference, seasons: s }) => ({ conference, season: s[yi] }));
    const lastWeek = parts[0].season.lastWeek;
    const srng = rng.fork(`bigleague-${year}`);
    const lineupFor = (week, fid) => parts.find((p) => p.conference.code === confOf.get(fid)).season.lineupFor(week, fid);

    // Merge the regular season, conference by conference in code order, so a
    // week's schedule and its results stay index-aligned.
    const weekly = [];
    for (let week = 1; week <= Math.min(lastWeek, BIGLEAGUE_REGULAR_SEASON_WEEKS); week++) {
      weekly.push({
        week,
        regularSeason: true,
        games: parts.flatMap((p) => p.season.weekly.find((w) => w.week === week)?.games ?? []),
      });
    }
    const schedule = Array.from({ length: BIGLEAGUE_REGULAR_SEASON_WEEKS }, (_, i) => parts.flatMap((p) => p.season.schedule[i] ?? []));
    const live = parts.map((p) => p.season.inProgress).filter(Boolean);
    const inProgress = live.length ? { week: live[0].week, games: live.flatMap((l) => l.games) } : null;

    const rows = parts.flatMap((p) => p.season.standings.map((r) => ({ ...r })));

    // --- Postseason ------------------------------------------------------
    const game = (week, homeId, awayId, gameId) => {
      const h = lineupFor(week, homeId);
      const a = lineupFor(week, awayId);
      const homeWins = h.score >= a.score;
      return {
        gameId,
        home: { id: homeId, lineup: h },
        away: { id: awayId, lineup: a },
        winner: homeWins ? homeId : awayId,
        loser: homeWins ? awayId : homeId,
      };
    };
    const seasonDone = lastWeek >= BIGLEAGUE_REGULAR_SEASON_WEEKS;
    const conferenceBrackets = [];
    const postseasonWeeks = new Map(); // week → games
    const logGame = (week, g) => {
      const list = postseasonWeeks.get(week) ?? [];
      list.push(g);
      postseasonWeeks.set(week, list);
    };
    if (seasonDone) {
      for (const { conference } of parts) {
        const confRows = rows.filter((r) => confOf.get(r.id) === conference.code).sort((a, b) => pctOf(b) - pctOf(a) || b.pf - a.pf);
        const winners = [];
        const seenDiv = new Set();
        for (const r of confRows) {
          if (!seenDiv.has(divOf.get(r.id))) {
            seenDiv.add(divOf.get(r.id));
            winners.push(r);
          }
        }
        const wild = confRows.filter((r) => !winners.includes(r)).slice(0, 4 - winners.length);
        const seeds = [...winners, ...wild].map((r, i) => ({ id: r.id, seed: i + 1 }));
        const bracket = { conference, seeds, rounds: [], champion: null };
        const [w1, w2] = CONFERENCE_PLAYOFF_WEEKS;
        if (w1 <= lastWeek) {
          const semis = [game(w1, seeds[0].id, seeds[3].id, 1), game(w1, seeds[1].id, seeds[2].id, 2)];
          bracket.rounds.push({ week: w1, games: semis });
          semis.forEach((g) => logGame(w1, g));
          if (w2 <= lastWeek) {
            const final = { ...game(w2, semis[0].winner, semis[1].winner, 3), from: [1, 2] };
            bracket.rounds.push({ week: w2, games: [final] });
            logGame(w2, final);
            bracket.champion = final.winner;
          }
        }
        conferenceBrackets.push(bracket);
      }
    }
    let overall = null;
    const champions = conferenceBrackets.map((b) => b.champion).filter(Boolean);
    if (champions.length === CONFERENCES.length) {
      const seeded = champions
        .map((id) => rows.find((r) => r.id === id))
        .sort((a, b) => pctOf(b) - pctOf(a) || b.pf - a.pf)
        .map((r, i) => ({ id: r.id, seed: i + 1 }));
      const s = (n) => seeded[n - 1].id;
      overall = { seeds: seeded, rounds: [], champion: null };
      const [q, sf, f] = OVERALL_PLAYOFF_WEEKS;
      if (q <= lastWeek) {
        const quarters = [game(q, s(1), s(8), 1), game(q, s(4), s(5), 2), game(q, s(2), s(7), 3), game(q, s(3), s(6), 4)];
        overall.rounds.push({ week: q, games: quarters });
        quarters.forEach((g) => logGame(q, g));
        if (sf <= lastWeek) {
          const semis = [
            { ...game(sf, quarters[0].winner, quarters[1].winner, 5), from: [1, 2] },
            { ...game(sf, quarters[2].winner, quarters[3].winner, 6), from: [3, 4] },
          ];
          overall.rounds.push({ week: sf, games: semis });
          semis.forEach((g) => logGame(sf, g));
          if (f <= lastWeek) {
            const final = { ...game(f, semis[0].winner, semis[1].winner, 7), from: [5, 6] };
            overall.rounds.push({ week: f, games: [final] });
            logGame(f, final);
            overall.champion = final.winner;
            overall.runnerUp = final.loser;
          }
        }
      }
    }
    for (const week of [...CONFERENCE_PLAYOFF_WEEKS, ...OVERALL_PLAYOFF_WEEKS]) {
      const games = postseasonWeeks.get(week);
      if (games?.length) weekly.push({ week, regularSeason: false, games: games.map((g) => [g.home.lineup, g.away.lineup, g.home.id, g.away.id]) });
    }

    // League-wide all-play over every scored week (MFL's standings field).
    const ap = allPlay(rows, weekly);
    for (const r of rows) {
      const a = ap.get(r.id);
      r.allW = a.w;
      r.allL = a.l;
      r.allT = a.t;
      const n = a.w + a.l + a.t;
      r.allPlayPct = n ? ((a.w + a.t / 2) / n).toFixed(3).replace(/^0/, '') : '.000';
    }
    rows.sort((a, b) => pctOf(b) - pctOf(a) || b.pf - a.pf);

    // --- Tiers -----------------------------------------------------------
    // This season's makeup: the first season is seeded at random; every later
    // one moves TIER_MOVEMENT up and down between neighbours off last season's
    // tier all-play table.
    if (!membership) {
      const order = srng.shuffle(BIGLEAGUE_FRANCHISES.map((f) => f.id));
      membership = new Map();
      let at = 0;
      TIERS.forEach((tier, t) => {
        for (const id of order.slice(at, at + TIER_SIZES[t])) membership.set(id, tier);
        at += TIER_SIZES[t];
      });
    }
    const tierAp = allPlay(rows, weekly, BIGLEAGUE_REGULAR_SEASON_WEEKS);
    const tierPct = (id) => {
      const a = tierAp.get(id);
      const n = a.w + a.l + a.t;
      return n ? (a.w + a.t / 2) / n : 0;
    };
    const pfOf = new Map(rows.map((r) => [r.id, r.pf]));
    const tables = TIERS.map((tier) =>
      [...membership].filter(([, t]) => t === tier).map(([id]) => id).sort((a, b) => tierPct(b) - tierPct(a) || pfOf.get(b) - pfOf.get(a)),
    );
    tierHistory[year] = {
      membership: Object.fromEntries([...membership].sort((a, b) => a[0].localeCompare(b[0]))),
      membershipSource: 'demo-generator',
      ...(seasonDone
        ? {
            champions: Object.fromEntries(TIERS.map((tier, t) => [`${slugOf(tier)}-champion`, tables[t][0]])),
            championsSource: 'demo-generator',
            allPlayStandings: Object.fromEntries(TIERS.map((tier, t) => [tier, tables[t]])),
          }
        : {}),
    };
    const seasonMembership = membership;
    if (seasonDone) {
      const next = new Map(membership);
      for (let t = 0; t < TIERS.length - 1; t++) {
        for (const id of tables[t].slice(-TIER_MOVEMENT)) next.set(id, TIERS[t + 1]);
        for (const id of tables[t + 1].slice(0, TIER_MOVEMENT)) next.set(id, TIERS[t]);
      }
      membership = next;
    }

    const rosters = new Map(parts.flatMap((p) => [...p.season.rosters]));
    const draftPicksByConference = new Map(parts.map((p) => [p.conference.code, p.season.draftPicks]));
    seasons.push({
      year,
      lastWeek,
      schedule,
      weekly,
      inProgress,
      standings: rows,
      playoffs: null,
      conferenceBrackets,
      overall,
      rosters,
      auctionResults: [],
      draftPicks: parts.flatMap((p) => p.season.draftPicks),
      draftPicksByConference,
      salaryAdjustments: [],
      transactions: parts.flatMap((p) => p.season.transactions).sort((a, b) => Number(b.timestamp) - Number(a.timestamp)),
      players: parts[0].season.players,
      futurePicks: [],
      tiers: seasonMembership,
    });
  });

  return { seasons, tierHistory, currentTiers: seasons[seasons.length - 1].tiers };
}

/**
 * playoff-brackets.json in the AFL's shape: bracket 1 is the overall title
 * (eight conference champions), 2-9 are the conference championships.
 */
export function bigLeagueBracketsFeed(season) {
  const list = [
    {
      id: '1',
      name: `${BIGLEAGUE_NAME} Championship`,
      bracketWinnerTitle: `${BIGLEAGUE_NAME} Champion`,
      teamsInvolved: '8',
      startWeek: String(OVERALL_PLAYOFF_WEEKS[0]),
      startWeekGames: '4',
    },
    ...CONFERENCES.map((c, i) => ({
      id: String(i + 2),
      name: `${c.name} Championship`,
      bracketWinnerTitle: `${c.name} Champion`,
      teamsInvolved: '4',
      startWeek: String(CONFERENCE_PLAYOFF_WEEKS[0]),
      startWeekGames: '2',
      conference: c.code,
    })),
  ];
  const two = (n) => Number(n).toFixed(2);
  const side = (s, extra) => ({ franchise_id: s.id, points: two(s.lineup.score), ...extra });
  const body = (id, bracket) => {
    const seedOf = new Map(bracket.seeds.map((s) => [s.id, String(s.seed)]));
    return {
      version: '1.0',
      encoding: 'utf-8',
      playoffBracket: {
        bracket_id: id,
        playoffRound: bracket.rounds.map((round, r) => ({
          week: String(round.week),
          playoffGame: round.games.map((g) => ({
            game_id: String(g.gameId),
            home: side(g.home, r === 0 || !g.from ? { seed: seedOf.get(g.home.id) } : { winner_of_game: String(g.from[0]) }),
            away: side(g.away, r === 0 || !g.from ? { seed: seedOf.get(g.away.id) } : { winner_of_game: String(g.from[1]) }),
          })),
        })),
      },
    };
  };
  const brackets = {};
  if (season.overall?.rounds.length) brackets['1'] = body('1', season.overall);
  season.conferenceBrackets.forEach((b, i) => {
    if (b.rounds.length) brackets[String(i + 2)] = body(String(i + 2), b);
  });
  return { playoffBrackets: { playoffBracket: list }, brackets };
}

/** tier-history.json in the AFL's shape. */
export function bigLeagueTierHistory(tierHistory) {
  return {
    $comment: 'Demo big league tiers (fictional), generated by scripts/demo.',
    movementRules: { promote: TIER_MOVEMENT, relegate: TIER_MOVEMENT, tiers: TIERS, sizes: TIER_SIZES },
    seasons: tierHistory,
  };
}

/** `data/afl-fantasy/afl.assets.json`: every team's crest and banner, the AFL assets file's shape. */
export function bigLeagueAssets({ firstYear, generatedAt }) {
  const entry = (type, relativePath) => ({ type, filename: relativePath.split('/').pop(), relativePath, extension: '.svg' });
  return {
    generatedAt,
    teams: BIGLEAGUE_FRANCHISES.map((f) => {
      const p = assetPaths(f);
      const key = f.slug.replace(/-/g, '_');
      return {
        key,
        slug: key,
        id: f.id,
        name: f.name,
        category: 'active',
        division: f.division,
        aliases: [f.nameShort, f.abbrev],
        assets: { banners: [entry('banners', p.banner)], icons: [entry('icons', p.icon)] },
        eras: [{ yearStart: firstYear, yearEnd: 9999, franchiseId: f.id }],
      };
    }),
    extras: {
      championship: [],
      league: [entry('league', '/assets/logos/bigleague-logo.svg')],
      conference: CONFERENCES.map((c) => entry('conference', confLogo(c))),
      division: [],
    },
  };
}

/** `data/afl-fantasy/championship-history.json`: each finished season's overall final. */
export function bigLeagueChampionships(seasons) {
  const name = new Map(BIGLEAGUE_FRANCHISES.map((f) => [f.id, f.name]));
  return {
    $comment: 'Demo big league championship history, generated by scripts/demo. Fictional.',
    championships: seasons
      .filter((s) => s.overall?.champion)
      .map((s) => ({
        year: s.year,
        champion: s.overall.champion,
        runnerUp: s.overall.runnerUp,
        championName: name.get(s.overall.champion),
        runnerUpName: name.get(s.overall.runnerUp),
      })),
    $gaps: [],
  };
}

/** `data/afl-fantasy/awards-history.json`: the overall title and tier champions per finished season. */
export function bigLeagueAwards(seasons, tierHistory) {
  const name = new Map(BIGLEAGUE_FRANCHISES.map((f) => [f.id, f.name]));
  const award = (id, source) => ({ franchiseId: id, sourceFranchiseId: id, name: name.get(id), source });
  return {
    $comment: 'Demo big league awards (fictional), generated by scripts/demo.',
    seasons: seasons
      .filter((s) => s.overall?.champion)
      .map((s) => {
        const champs = tierHistory[s.year]?.champions ?? {};
        const awards = { 'afl-championship': award(s.overall.champion, 'bracket:1') };
        if (champs['premier-league-champion']) awards['premier-league'] = award(champs['premier-league-champion'], 'tier-all-play');
        if (champs['a-league-champion']) awards['a-league-champion'] = award(champs['a-league-champion'], 'tier-all-play');
        if (champs['d-league-champion']) awards['dleague-champion'] = award(champs['d-league-champion'], 'tier-all-play');
        return { year: s.year, awards };
      }),
  };
}
