/**
 * Ask the History — the biggest games of a rivalry (Brandon, 2026-11-17:
 * "What is the biggest game in the rivalry between X and Y" should be
 * answered on its own).
 *
 * Every counted game (regular season and playoffs; consolation games never,
 * as everywhere else in the engine) gets a STAKES tier, and a rivalry's games
 * rank STAKES FIRST, closest margin breaking ties inside a tier:
 *
 *   100  Championship        the title game (records.mjs roundOf 'Title game')
 *    90  Semifinal           one playoff round before the title game
 *    80  Quarterfinal        two rounds before it (and so on, 10 a round, floor 60)
 *    50  Third-place game    a playoff game in the title week that is not the title game
 *    40  Playoff spot        a regular-season game that decided a playoff spot (below)
 *    10  Regular season      every other regular-season game
 *
 * A league that seeds by conference (the AFL) calls the rounds before the
 * title game "Conference final" / "Conference semifinal".
 *
 * "DECIDED A PLAYOFF SPOT" — exactly, from the official standings rows
 * (league-history.json seasons: w, l, t, wd, r), for a COMPLETED season only:
 * the game changed who made the playoffs. Wins count w + t/2. Each season is
 * cut into seeding pools: the conference a team's division belonged to that
 * year where the league has conferences (`pools`, seeding-pools.ts, read from
 * that year's MFL league feed), otherwise the whole league. In each pool the
 * game's two teams belong to, flip the result (winner one win fewer, loser
 * one more) and re-run the WILD-CARD race: the playoff teams that did not win
 * their division against every team that missed.
 *
 *   - DECIDED (tier "Playoff spot"): after the flip the LOSER (who missed)
 *     is SURELY IN — at least as many race teams strictly behind it as there
 *     were teams that missed — or the WINNER (a wild card) is SURELY OUT — at
 *     least as many race teams strictly ahead of it as there are wild-card
 *     spots. Wild cards go by record, so a strictly better record holds the
 *     spot whatever the tiebreakers say.
 *   - TIEBREAKER (stays "Regular season"; `playoffSpot` says so): after the
 *     flip the loser is not surely out, or the winner not surely in — it would
 *     be level with others for the last spot. MFL's tiebreakers would have
 *     settled it, and they cannot be re-derived (we never re-sort its
 *     standings), so the game is not counted as deciding anything.
 *
 * Not re-derived, and so never counted: division titles (a division winner
 * keeps its bid under the flip, so a game it won never counts as costing it).
 * A season whose pool cannot be known (a conference league with no feed
 * for that year, or `pools: false` when the feeds could not be read) gets no
 * playoff-spot games; `pools` null or `{}` is one league-wide pool.
 *
 * "THE PLAYERS WHO DECIDED IT" — from league-history-players.json, only where
 * the data supports it exactly: each side's top starters, the winner's top
 * starter against the margin, and, for the loser, the best same-position
 * bench-for-starter swap (always a legal lineup) when it would have flipped
 * the result, plus whether MFL's own optimal lineup would have won. The swap
 * and the optimal lineup are offered only when the side's starters add up to
 * its official score, so a week with missing player rows never invents a flip.
 *
 * Pure. `ix` is records.mjs `indexDataset(ds, { groupBy: 'owner' })`, so a
 * game belongs to the owner who played it and a rivalry follows the OWNERS.
 */

const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => Number(n).toFixed(2);

export const STAKES = {
  championship: 100,
  playoffRoundStep: 10,
  playoffFloor: 60,
  thirdPlace: 50,
  placement: 45,
  playoffSpot: 40,
  regular: 10,
};

const MADE = new Set(['C', 'R', '3', 'P']);
const gameKey = (y, wk, wf, lf) => `${y}|${wk}|${wf}|${lf}`;
const winsOf = (t) => (t?.w ?? 0) + (t?.t ?? 0) / 2;

export const RIVALRY_GAME_FIELDS = {
  rivalryGames: {
    year: { type: 'number', label: 'Season' },
    week: { type: 'number', label: 'Week' },
    stakes: {
      type: 'string',
      label: 'Stakes',
      desc: 'Championship | Semifinal | Quarterfinal | Conference final | Conference semifinal | Playoff round | Third-place game | Playoff spot | Regular season',
    },
    stakesLevel: { type: 'number', label: 'Stakes level', desc: '100 championship, 90/80/… earlier playoff rounds (later round higher), 50 third-place game, 40 playoff spot, 10 other regular season' },
    playoffSpot: { type: 'string', label: 'Playoff spot', desc: 'how the game changed the playoff field; on a Regular season game, that the other result would only have forced a tiebreaker for the last spot ("" when neither)' },
    importance: { type: 'number', label: 'Importance', desc: 'stakesLevel first, closer margin breaking ties: sort desc for "biggest game"' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    opponent: { type: 'string', label: 'Opponent' },
    opponentOwner: { type: 'string', label: 'Opp. owner' },
    score: { type: 'number', label: 'Score' },
    oppScore: { type: 'number', label: 'Opp.' },
    margin: { type: 'number', label: 'Margin', desc: 'score - oppScore (negative = a loss)' },
    absMargin: { type: 'number', label: 'Margin (abs)', desc: 'how close it was, either way' },
    result: { type: 'string', label: 'Result', desc: 'W | L | T' },
    winner: { type: 'string', label: 'Winner' },
    topStarter: { type: 'string', label: 'Top starter', desc: "this team's best starter (name, position, points)" },
    oppTopStarter: { type: 'string', label: 'Opp. top starter' },
    benchFlip: { type: 'string', label: 'Bench flip', desc: "the losing side's bench player who would have flipped the result if started over a same-position starter (\"\" when none or not on record)" },
    decidedBy: { type: 'string', label: 'Decided by', desc: 'one line on the players who decided it' },
  },
};

export const RIVALRY_GAME_UNITS = Object.keys(RIVALRY_GAME_FIELDS);

export const RIVALRY_GAME_DEFAULT_COLUMNS = {
  rivalryGames: ['year', 'week', 'stakes', 'team', 'score', 'opponent', 'oppScore', 'margin', 'decidedBy'],
};

export const RIVALRY_GAME_UNIT_WORDS = {
  rivalryGames: 'team-games ranked by stakes (championship, playoff rounds, playoff-spot games, then the rest)',
};

/** Whether the league seeds in pools (conferences) in any season. */
const hasPools = (pools) => !!pools && Object.values(pools).some((m) => m && Object.keys(m).length);

/** A team's seeding pool that season: its division's conference, '_' for a league with none, null when unknown. */
function poolOf(ix, pools, y, f) {
  if (pools === false) return null;
  if (!hasPools(pools)) return '_';
  const d = ix.team(y, f)?.d;
  return (d != null && pools?.[y]?.[d]) || null;
}

const poolCache = new WeakMap();
/** Each completed (season, pool)'s teams, `{ id, t }`. Cached per index and pools. */
function seasonPools(ix, pools) {
  let byPools = poolCache.get(ix);
  if (!byPools) poolCache.set(ix, (byPools = new Map()));
  const cacheKey = JSON.stringify(pools ?? null);
  if (byPools.has(cacheKey)) return byPools.get(cacheKey);
  const out = new Map();
  for (const s of ix.ds.seasons) {
    if (!s.done) continue;
    for (const [id, t] of Object.entries(s.teams)) {
      const pool = poolOf(ix, pools, s.y, id);
      if (pool == null) continue;
      const k = `${s.y}|${pool}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push({ id, t });
    }
  }
  byPools.set(cacheKey, out);
  return out;
}

/**
 * Whether flipping one regular-season game (an ix.games row) would have
 * changed its pool's playoff field. Returns null for a game that could not
 * have; `{ decided: true, text }` when the flip puts a team that missed
 * strictly ahead of a wild card (the field changes); `{ decided: false,
 * tiebreaker: true, text }` when the flip only leaves the two level for the
 * last spot, which MFL's tiebreakers (never re-derived here) would have
 * settled. Applied to each pool the game's two teams belong to.
 */
export function playoffSpotDetail(ix, g, pools) {
  if (g.kind !== 'regular' || g.tie) return null;
  if (!ix.seasonByYear.get(g.y)?.done) return null;
  const byPool = seasonPools(ix, pools);
  const keys = new Set([g.wf, g.lf].map((f) => poolOf(ix, pools, g.y, f)).filter((p) => p != null).map((p) => `${g.y}|${p}`));
  const decided = [];
  const tied = [];
  for (const k of keys) {
    const teams = byPool.get(k) ?? [];
    const adj = (x) => winsOf(x.t) + (x.id === g.lf ? 1 : x.id === g.wf ? -1 : 0);
    // Division winners hold their own bids: only the wild-card race is re-run.
    const wild = teams.filter((x) => MADE.has(x.t.r) && !x.t.wd);
    const missed = teams.filter((x) => !MADE.has(x.t.r));
    if (!wild.length || !missed.length) continue;
    const race = [...wild, ...missed];
    const above = (x) => race.filter((o) => o !== x && adj(o) > adj(x)).length;
    const below = (x) => race.filter((o) => o !== x && adj(o) < adj(x)).length;
    // After the flip: surely in once enough of the race is strictly behind,
    // surely out once every wild-card spot is held by a strictly better record.
    const surelyIn = (x) => below(x) >= missed.length;
    const surelyOut = (x) => above(x) >= wild.length;
    const loser = missed.find((x) => x.id === g.lf);
    const winner = wild.find((x) => x.id === g.wf);
    if (loser && surelyIn(loser)) {
      const out = wild.filter((x) => surelyOut(x)).map((x) => x.t.n);
      decided.push(`with a win, ${loser.t.n} would have made the playoffs${out.length === 1 ? ` instead of ${out[0]}` : ''}`);
    } else if (loser && !surelyOut(loser)) {
      tied.push(`with a win, ${loser.t.n} would have been level for the last spot, a tiebreaker`);
    }
    if (winner && surelyOut(winner)) {
      decided.push(`with a loss, ${winner.t.n} would have missed the playoffs`);
    } else if (winner && !surelyIn(winner)) {
      tied.push(`with a loss, ${winner.t.n} would have been level for the last spot, a tiebreaker`);
    }
  }
  if (decided.length) return { decided: true, tiebreaker: false, text: decided.join('; ') };
  if (tied.length) return { decided: false, tiebreaker: true, text: tied.join('; ') };
  return null;
}

const rounds = new WeakMap();
/** Each playoff game's rounds-before-the-title-game, by gameKey. Cached per index. */
function playoffRoundIndex(ix) {
  if (rounds.has(ix)) return rounds.get(ix);
  const out = new Map();
  const bySeason = new Map();
  for (const g of ix.games) {
    if (g.kind !== 'playoffs') continue;
    if (!bySeason.has(g.y)) bySeason.set(g.y, []);
    bySeason.get(g.y).push(g);
  }
  for (const [, list] of bySeason) {
    const title = list.find((g) => ix.roundOf(g) === 'Title game');
    const titleWeek = title?.wk ?? Math.max(...list.map((g) => g.wk));
    // A bracket game is one both teams reached alive: a team is out once it
    // loses one. Playoff teams already out keep playing placement games
    // (both leagues do), which count as playoff games but decide nothing.
    const dead = new Set();
    const bracket = new Set();
    const weeks = [...new Set(list.map((g) => g.wk))].sort((a, b) => a - b);
    for (const wk of weeks) {
      const losers = [];
      for (const g of list.filter((x) => x.wk === wk)) {
        if (dead.has(g.wf) || dead.has(g.lf)) continue;
        bracket.add(g);
        if (!g.tie) losers.push(g.lf);
      }
      for (const f of losers) dead.add(f);
    }
    const bracketWeeks = [...new Set([...bracket].map((g) => g.wk))];
    for (const g of list) {
      const before = bracketWeeks.filter((w) => w > g.wk && w <= titleWeek).length;
      out.set(gameKey(g.y, g.wk, g.wf, g.lf), { before, hasTitle: !!title, bracket: bracket.has(g) });
    }
  }
  rounds.set(ix, out);
  return out;
}

const ROUND_NAMES = ['Championship', 'Semifinal', 'Quarterfinal'];
const POOL_ROUND_NAMES = ['Championship', 'Conference final', 'Conference semifinal'];

/**
 * The stakes of one game (an ix.games row): `{ level, label, playoffSpot }`.
 * Consolation games have no stakes here (null): they never count.
 */
export function gameStakes(ix, g, pools) {
  if (g.kind === 'consolation') return null;
  if (g.kind === 'playoffs') {
    const named = ix.roundOf(g);
    if (named === 'Title game') return { level: STAKES.championship, label: 'Championship', playoffSpot: null };
    if (named === 'Third-place game') return { level: STAKES.thirdPlace, label: 'Third-place game', playoffSpot: null };
    const r = playoffRoundIndex(ix).get(gameKey(g.y, g.wk, g.wf, g.lf));
    if (r && !r.bracket) return { level: STAKES.placement, label: 'Playoff placement game', playoffSpot: null };
    const before = Math.max(1, r?.before ?? 1);
    const names = hasPools(pools) ? POOL_ROUND_NAMES : ROUND_NAMES;
    // A season still in its playoffs has no title game yet: its rounds are only "Playoffs".
    const label = !r?.hasTitle ? 'Playoffs' : names[before] ?? `Playoff round (${before} before the final)`;
    const level = Math.max(STAKES.playoffFloor, STAKES.championship - STAKES.playoffRoundStep * before);
    return { level, label, playoffSpot: null };
  }
  const spot = playoffSpotDetail(ix, g, pools);
  return spot?.decided
    ? { level: STAKES.playoffSpot, label: 'Playoff spot', playoffSpot: spot }
    : { level: STAKES.regular, label: 'Regular season', playoffSpot: spot };
}

/** Stakes first, then the closer game, then the more recent one. */
export function compareBigGames(a, b) {
  return b.stakesLevel - a.stakesLevel || a.absMargin - b.absMargin || b.year - a.year || b.week - a.week;
}

/** stakesLevel then closeness as one sortable number (a margin is always under 1000). */
export const importanceOf = (level, absMargin) => r2(level * 1000 - Math.min(absMargin, 999.99));

// ---------------------------------------------------------------------------
// The players who decided it.

const playerIndexes = new WeakMap();
/** (year, week, franchise) → [{ pid, name, pos, score, started, optimal }]. Cached per player dataset. */
function playerIndex(pds) {
  if (!pds) return null;
  if (playerIndexes.has(pds)) return playerIndexes.get(pds);
  const out = new Map();
  for (const [y, wk, f, pid, score, flags] of pds.weeks ?? []) {
    const k = `${y}|${wk}|${f}`;
    if (!out.has(k)) out.set(k, []);
    const [name, pos] = pds.players?.[pid] ?? [pid, ''];
    out.get(k).push({ pid, name, pos, score, started: (flags & 1) === 1, optimal: (flags & 2) === 2 });
  }
  playerIndexes.set(pds, out);
  return out;
}

const label = (p) => `${p.name} (${p.pos}) ${fmt(p.score)}`;

/**
 * One side of a game: its starters (best first) and whether they add up to
 * the side's official score, which every exact claim below requires.
 */
function sideOf(index, y, wk, f, score) {
  const list = index?.get(`${y}|${wk}|${f}`) ?? [];
  const starters = list.filter((p) => p.started).sort((a, b) => b.score - a.score);
  const bench = list.filter((p) => !p.started);
  const total = starters.reduce((n, p) => n + p.score, 0);
  const exact = starters.length > 0 && Math.abs(total - score) < 0.05;
  const optimalList = list.filter((p) => p.optimal);
  const optimal = exact && optimalList.length ? r2(optimalList.reduce((n, p) => n + p.score, 0)) : null;
  return { starters, bench, exact, optimal };
}

/**
 * The players who decided one game (an ix.games row), or null when the week
 * has no player scores. `margin` is the winner's margin.
 */
export function decidedBy(index, g) {
  if (!index) return null;
  const w = sideOf(index, g.y, g.wk, g.wf, g.ws);
  const l = sideOf(index, g.y, g.wk, g.lf, g.ls);
  if (!w.starters.length && !l.starters.length) return null;
  const margin = r2(g.ws - g.ls);
  const winnerTop = w.starters.slice(0, 3);
  const loserTop = l.starters.slice(0, 3);
  const star = winnerTop[0] ?? null;

  // The loser's best same-position bench-for-starter swap, when it beats the margin.
  let flip = null;
  if (!g.tie && l.exact) {
    for (const b of l.bench) {
      for (const s of l.starters) {
        if (s.pos !== b.pos) continue;
        const gain = r2(b.score - s.score);
        if (gain > margin && (!flip || gain > flip.gain)) flip = { bench: b, starter: s, gain, by: r2(gain - margin) };
      }
    }
  }
  const optimalWins = !g.tie && l.optimal != null && l.optimal > g.ws;

  const bits = [];
  if (star) bits.push(`${star.name} (${star.pos}) led the winner with ${fmt(star.score)}${!g.tie && star.score > margin ? `, more than the ${fmt(margin)} margin` : ''}`);
  if (flip) bits.push(`${flip.bench.name} (${flip.bench.pos}) scored ${fmt(flip.bench.score)} on the loser's bench; started over ${flip.starter.name} (${fmt(flip.starter.score)}) he would have won it by ${fmt(flip.by)}`);
  else if (optimalWins) bits.push(`the loser's best possible lineup would have scored ${fmt(l.optimal)} and won`);
  return {
    winnerTop: winnerTop.map((p) => ({ name: p.name, pos: p.pos, score: p.score })),
    loserTop: loserTop.map((p) => ({ name: p.name, pos: p.pos, score: p.score })),
    star: star ? { name: star.name, pos: star.pos, score: star.score, beatMargin: !g.tie && star.score > margin } : null,
    benchFlip: flip
      ? { bench: { name: flip.bench.name, pos: flip.bench.pos, score: flip.bench.score }, starter: { name: flip.starter.name, pos: flip.starter.pos, score: flip.starter.score }, wouldHaveWonBy: flip.by }
      : null,
    loserOptimal: optimalWins ? l.optimal : null,
    text: bits.join('; '),
  };
}

// ---------------------------------------------------------------------------
// Ask the History rows.

const rowCache = new WeakMap();

/**
 * The `rivalryGames` unit's rows: one per team per counted game (each game
 * twice, once from each side, like `games`), consolation games left out.
 * `p` is ask-query.mjs's prepared index. Cached per (index, players, pools).
 */
export function rivalryGameRows(p, { players = null, pools = null } = {}) {
  const { ix } = p;
  let byIx = rowCache.get(ix);
  if (!byIx) rowCache.set(ix, (byIx = new Map()));
  const key = `${players ? 'p' : '-'}|${JSON.stringify(pools ?? null)}`;
  const hit = byIx.get(key);
  if (hit && hit.players === players) return hit.rows;

  const index = playerIndex(players);
  const ownerOf = (y, f) => ix.entity(ix.entityOf(y, f));
  const teamName = (y, f) => ix.team(y, f)?.n ?? f;
  const rows = [];
  for (const g of ix.games) {
    const st = gameStakes(ix, g, pools);
    if (!st) continue;
    const who = decidedBy(index, g);
    const absMargin = r2(Math.abs(g.ws - g.ls));
    const winnerName = g.tie ? '' : teamName(g.y, g.wf);
    for (const [f, s, of, os, won] of [
      [g.wf, g.ws, g.lf, g.ls, !g.tie],
      [g.lf, g.ls, g.wf, g.ws, false],
    ]) {
      const owner = ownerOf(g.y, f);
      const opp = ownerOf(g.y, of);
      const isWinner = f === g.wf && !g.tie;
      const top = who ? (isWinner || g.tie ? who.winnerTop[0] : who.loserTop[0]) : null;
      const oppTop = who ? (isWinner || g.tie ? who.loserTop[0] : who.winnerTop[0]) : null;
      rows.push({
        year: g.y,
        week: g.wk,
        kind: g.kind,
        stakes: st.label,
        stakesLevel: st.level,
        playoffSpot: st.playoffSpot?.text ?? '',
        importance: importanceOf(st.level, absMargin),
        team: teamName(g.y, f),
        owner: owner.name,
        opponent: teamName(g.y, of),
        opponentOwner: opp.name,
        score: s,
        oppScore: os,
        margin: r2(s - os),
        absMargin,
        result: g.tie ? 'T' : won ? 'W' : 'L',
        winner: winnerName,
        topStarter: top ? label(top) : '',
        oppTopStarter: oppTop ? label(oppTop) : '',
        benchFlip: who?.benchFlip
          ? `${who.benchFlip.bench.name} (${who.benchFlip.bench.pos}) ${fmt(who.benchFlip.bench.score)} over ${who.benchFlip.starter.name} ${fmt(who.benchFlip.starter.score)}`
          : '',
        decidedBy: who?.text || (index ? '' : 'Player scores not on record'),
        _event: `${g.y}|${g.wk}|${[g.wf, g.lf].sort().join('-')}`,
        _franchiseId: f,
        _ownerSlug: owner.ownerSlug,
      });
    }
  }
  byIx.set(key, { players, rows });
  return rows;
}

// ---------------------------------------------------------------------------
// The rivalry pair page.

/**
 * A rivalry's meetings (rivalry.mjs `rivalryHistory(...).meetings`, from A's
 * side), ranked biggest first: stakes, then the closest margin. Consolation
 * games are left out. Each item is the meeting plus `stakes` ({ level, label,
 * playoffSpot }), `absMargin` and `decidedBy` (null without player scores).
 */
export function rankRivalryMeetings(ix, meetings, { players = null, pools = null, limit = 3 } = {}) {
  const index = playerIndex(players);
  const byKey = new Map(ix.games.map((g) => [`${g.y}|${g.wk}|${[g.wf, g.lf].sort().join('-')}`, g]));
  const out = [];
  for (const m of meetings ?? []) {
    if (m.kind === 'consolation') continue;
    const g = byKey.get(`${m.y}|${m.wk}|${[m.franchiseA, m.franchiseB].sort().join('-')}`);
    if (!g) continue;
    const stakes = gameStakes(ix, g, pools);
    if (!stakes) continue;
    out.push({
      ...m,
      stakes,
      stakesLevel: stakes.level,
      absMargin: r2(Math.abs(m.sA - m.sB)),
      year: m.y,
      week: m.wk,
      decidedBy: decidedBy(index, g),
    });
  }
  return out.sort(compareBigGames).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Seeding pools.

/**
 * Each season's division → conference map, from that year's MFL league feed
 * (`mfl-feeds/<year>/league.json`): `{ [year]: { [divisionName]: conferenceName } }`.
 * A league whose feeds carry no conferences gets `{}`: one league-wide pool.
 * Read per season because a division's conference is the feed's fact for
 * that year, never today's config (the AFL had six divisions until 2012).
 * @param {Record<string | number, any>} feedsByYear year → parsed league.json
 */
export function seedingPoolsFromFeeds(feedsByYear) {
  const out = {};
  for (const [year, feed] of Object.entries(feedsByYear ?? {})) {
    const league = feed?.league ?? feed;
    const conferences = [league?.conferences?.conference ?? []].flat();
    if (!conferences.length) continue;
    const name = Object.fromEntries(conferences.map((c) => [String(c.id), c.name ?? String(c.id)]));
    const map = {};
    for (const d of [league?.divisions?.division ?? []].flat()) {
      if (d?.name && d.conference != null) map[d.name] = name[String(d.conference)] ?? String(d.conference);
    }
    if (Object.keys(map).length) out[Number(year)] = map;
  }
  return out;
}
