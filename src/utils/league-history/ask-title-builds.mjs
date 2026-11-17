/**
 * Ask the History — the title-build units (title-builds.mjs as query rows):
 *
 * - `titleTrades`: one row per (title season, trade) for every trade that put
 *   a starter on that champion: a player who came in it (that season or an
 *   earlier one, and stayed), or a pick that came in it and was used on him.
 *   Ranked within the title by what those starters scored that season.
 * - `rosterBuilds`: one row per team-season, its starters summed by how the
 *   team got them (draft, trade, waiver, …), by count and by starter points.
 *   Champions are `champion = true`; this season's contenders are the latest
 *   season's rows.
 * - `tradeOutcomes`: one row per side of every trade, every player and pick
 *   it got followed forward for as long as that team kept him (all seasons),
 *   against what the other side got the same way: who won it long-term.
 *
 * Each draws its own chart (a stacked bar per row, `kind: 'stack'`, drawn by
 * title-build-charts.mjs): the acquisition mix of each roster, each title
 * trade's regular-season and playoff points, each trade's two hauls.
 */
import { formatPickLabel, parsePickToken } from '../mfl-pick-tokens.mjs';
import { HOW } from './stints.mjs';
import { prepareStints } from './ask-stints.mjs';
import { MIX, buildMix, chainsByUse, starterIndex, titleTrades, tradeIndex, tradeOutcomes } from './title-builds.mjs';

const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const POINTS = 'starter points, regular season and playoffs';

/** Field-name stem and label per acquisition method, in MIX order. */
const MIX_KEYS = {
  [HOW.draft]: ['draft', 'Draft'],
  [HOW.trade]: ['trade', 'Trade'],
  [HOW.waiver]: ['waiver', 'Waiver'],
  [HOW.freeAgent]: ['freeAgent', 'Free agent'],
  [HOW.auction]: ['auction', 'Auction'],
  [HOW.commissioner]: ['commissioner', 'Commissioner'],
  [HOW.inherited]: ['inherited', 'Came with team'],
  [HOW.unknown]: ['unknown', 'Unknown'],
};
/** Chart tone per method: 1-7 are the categorical series, 0 is unknown's gray. */
const TONE = Object.fromEntries(MIX.map((h, i) => [h, h === HOW.unknown ? 0 : i + 1]));

const mixFields = () => {
  const out = {};
  for (const h of MIX) {
    const [k, label] = MIX_KEYS[h];
    out[`${k}Starters`] = { type: 'number', label: `${label} #`, desc: `starters acquired by ${h}` };
    out[`${k}Points`] = { type: 'number', label: `${label} pts` };
    out[`${k}Share`] = { type: 'number', label: `${label} %`, desc: 'percent of the team\'s starter points' };
  }
  return out;
};

export const TITLE_BUILD_FIELDS = {
  titleTrades: {
    year: { type: 'number', label: 'Title', desc: 'the title season' },
    team: { type: 'string', label: 'Champion' },
    owner: { type: 'string', label: 'Owner' },
    rank: { type: 'number', label: 'Rank', desc: "this trade's rank among the champion's title trades, by its starters' points that season" },
    ofTrades: { type: 'number', label: 'Of', desc: 'how many trades put a starter on that champion' },
    tradeId: { type: 'string', label: 'Trade id', desc: 'matches trades.tradeId and tradeOutcomes.tradeId; null when the draft record names the team a pick came from but no trade is on record' },
    tradeDate: { type: 'string', label: 'Traded' },
    tradeYear: { type: 'number', label: 'Trade season', desc: 'the season the trade was made in (the title season or earlier)' },
    sameSeason: { type: 'boolean', label: 'That season', desc: 'made in the title season itself' },
    partner: { type: 'string', label: 'From team', desc: 'the other team in the trade' },
    partnerOwner: { type: 'string', label: 'From owner' },
    via: { type: 'string', label: 'Via', desc: 'player (he came in the trade) | pick (a pick that came in the trade was used on him) | player and pick' },
    starters: { type: 'string', label: 'Starters', desc: 'each title starter it led to, with his points that season (playoff points in brackets); contains finds a player' },
    starterCount: { type: 'number', label: 'Starters #' },
    got: { type: 'string', label: 'Got', desc: 'everything the champion got in the trade' },
    gave: { type: 'string', label: 'Gave up', desc: 'everything the champion gave up' },
    starts: { type: 'number', label: 'Starts', desc: 'title season, regular season and playoffs' },
    points: { type: 'number', label: 'Pts', desc: `title season (${POINTS})` },
    regularPoints: { type: 'number', label: 'Reg pts' },
    playoffPoints: { type: 'number', label: 'PO pts', desc: 'title-season playoffs, as a starter' },
    share: { type: 'number', label: '% of pts', desc: "percent of the champion's starter points that season" },
  },
  rosterBuilds: {
    year: { type: 'number', label: 'Season' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    champion: { type: 'boolean', label: 'Champion' },
    finish: { type: 'string', label: 'Finish', desc: 'Champion | Runner-up | Third place | Playoffs | Missed playoffs ("" while the season is in progress)' },
    rank: { type: 'number', label: 'Seed', desc: 'regular-season standings rank, 1 = best (the current one for a season in progress)' },
    w: { type: 'number', label: 'W' },
    l: { type: 'number', label: 'L' },
    pf: { type: 'number', label: 'PF' },
    complete: { type: 'boolean', label: 'Complete', desc: 'false only for the season still being played' },
    starters: { type: 'number', label: 'Starters', desc: 'players who started at least once' },
    points: { type: 'number', label: 'Pts', desc: `every starter's points (${POINTS})` },
    topSource: { type: 'string', label: 'Built by', desc: 'the acquisition method with the most starter points' },
    carriedOver: { type: 'number', label: 'Carried #', desc: 'starters on this roster in an earlier season (a keeper, a contract) rather than added for this one' },
    carriedOverPoints: { type: 'number', label: 'Carried pts' },
    carriedOverShare: { type: 'number', label: 'Carried %' },
    keepers: { type: 'number', label: 'Keepers #', desc: "starters in the team's keeper set (null where the league records none)" },
    keeperPoints: { type: 'number', label: 'Keeper pts' },
    ...mixFields(),
  },
  tradeOutcomes: {
    year: { type: 'number', label: 'Season', desc: 'the season the trade was made in' },
    date: { type: 'string', label: 'Date' },
    tradeId: { type: 'string', label: 'Trade id' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    partner: { type: 'string', label: 'Partner' },
    partnerOwner: { type: 'string', label: 'Partner owner' },
    got: { type: 'string', label: 'Got', desc: 'players and picks this team received (contains finds a player)' },
    gave: { type: 'string', label: 'Gave', desc: 'players and picks this team gave up' },
    gotDetail: { type: 'string', label: 'What it became', desc: 'contains finds a player drafted with a pick from the trade. Each piece followed forward: seasons kept, points, how it ended; a pick names the player it was used on, or says traded on / not used yet / unknown' },
    points: { type: 'number', label: 'Pts', desc: `what this team got from the trade over every season it kept the pieces (${POINTS})` },
    playoffPoints: { type: 'number', label: 'PO pts' },
    starts: { type: 'number', label: 'Starts' },
    titles: { type: 'number', label: 'Titles', desc: 'seasons this team won the title with a piece from the trade starting for it' },
    titleYears: { type: 'string', label: 'Title years' },
    partnerPoints: { type: 'number', label: 'Partner pts', desc: 'the same, for what the other side got' },
    partnerPlayoffPoints: { type: 'number', label: 'Partner PO pts' },
    partnerTitles: { type: 'number', label: 'Partner titles' },
    net: { type: 'number', label: 'Net', desc: 'points - partnerPoints: who won the trade over every season since' },
    result: { type: 'string', label: 'Result', desc: 'won | lost | even, by net' },
    open: { type: 'boolean', label: 'Still open', desc: 'a piece either side got is still rostered there, or a pick is not used yet, so the totals can still change' },
    unresolved: { type: 'number', label: 'Unresolved', desc: "picks (either side) the record cannot follow to a player; their value is not counted" },
  },
};

export const TITLE_BUILD_UNITS = Object.keys(TITLE_BUILD_FIELDS);

export const TITLE_BUILD_DEFAULT_COLUMNS = {
  titleTrades: ['year', 'team', 'rank', 'tradeDate', 'partner', 'starters', 'gave', 'points', 'playoffPoints'],
  rosterBuilds: ['year', 'team', 'finish', 'topSource', 'draftShare', 'tradeShare', 'waiverShare', 'freeAgentShare', 'unknownShare', 'carriedOverShare'],
  tradeOutcomes: ['year', 'team', 'got', 'partner', 'points', 'partnerPoints', 'net', 'titles', 'partnerTitles'],
};

export const TITLE_BUILD_UNIT_WORDS = {
  titleTrades: 'trades that put a starter on a champion (title season, or earlier and carried over; a player or a pick used on him)',
  rosterBuilds: "team-seasons' starters, by how the team got them",
  tradeOutcomes: 'trades (one row per side), every piece followed forward for as long as the team kept it',
};

export const TITLE_BUILD_COUNT_LABEL = { titleTrades: 'Trades', rosterBuilds: 'Team-seasons', tradeOutcomes: 'Trades' };

const FINISH = { C: 'Champion', R: 'Runner-up', 3: 'Third place', P: 'Playoffs', M: 'Missed playoffs' };
const cache = new WeakMap();

/**
 * Index the three units against ask-query's prepared team index `p` and
 * player weeks `pp`, from the stints and pick chains ask-stints.mjs builds.
 */
export function prepareTitleBuilds(p, pp, mds, extra = {}) {
  if (cache.has(mds)) return cache.get(mds);
  const { ix } = p;
  const ps = prepareStints(p, pp, mds, extra);
  const seasons = ix.ds.seasons;
  const lastYear = seasons.at(-1)?.y ?? 0;
  const teamName = (y, f) => {
    if (f == null) return null;
    const t = ix.team(y, f);
    if (t) return t.n;
    const near = y > lastYear ? seasons.findLast((s) => s.teams[f]) : seasons.find((s) => s.teams[f]);
    return near?.teams[f]?.n ?? f;
  };
  const ownerAt = (y, f) => ix.entity(ix.entityOf(Math.min(y, lastYear), f));
  const finish = (y, f) => {
    const s = seasons.find((x) => x.y === y);
    return s?.done ? s.teams?.[f]?.r ?? null : null;
  };

  const names = new Map(Object.entries(mds.players ?? {}));
  for (const w of pp?.playerWeeks ?? []) if (!names.has(w._pid)) names.set(w._pid, [w.player, w.position]);
  const nameOf = (pid) => names.get(pid)?.[0] ?? pid;
  const assetLabel = (y, token) => {
    const pick = parsePickToken(token);
    return pick ? formatPickLabel(pick, (id) => teamName(y, id)) : nameOf(token);
  };
  const assets = (y, tokens) => (tokens?.length ? tokens.map((t) => assetLabel(y, t)).join(', ') : 'nothing on record');
  const chainLabel = (c) => `${c.original ? `${teamName(c.year, c.original)}'s ` : ''}${c.year} round ${c.round} pick`;

  const trades = tradeIndex(mds.trades);
  const starters = starterIndex(ps._stints);
  const byUse = chainsByUse(ps._chains);

  // rosterBuilds: every team-season, champions and contenders alike.
  const buildRows = [];
  for (const s of seasons) {
    for (const [f, t] of Object.entries(s.teams)) {
      const list = starters.get(`${s.y}|${f}`) ?? [];
      if (!list.length) continue;
      const mix = buildMix(list);
      const owner = ownerAt(s.y, f);
      const code = s.done ? t.r : null;
      const share = (pts) => (mix.points ? r1((pts / mix.points) * 100) : 0);
      const row = {
        year: s.y,
        team: t.n,
        owner: owner.name,
        champion: code === 'C',
        finish: code ? FINISH[code] ?? '' : '',
        rank: t.rk ?? null,
        w: t.w,
        l: t.l,
        pf: t.pf,
        complete: !!s.done,
        starters: mix.starters,
        points: mix.points,
        topSource: MIX.slice().sort((a, b) => mix.byHow[b].points - mix.byHow[a].points)[0],
        carriedOver: mix.carried.count,
        carriedOverPoints: mix.carried.points,
        carriedOverShare: share(mix.carried.points),
        keepers: mix.keeper?.count ?? null,
        keeperPoints: mix.keeper?.points ?? null,
        _franchiseId: f,
        _ownerSlug: owner.ownerSlug,
        _mix: mix,
      };
      for (const h of MIX) {
        const [k] = MIX_KEYS[h];
        row[`${k}Starters`] = mix.byHow[h].count;
        row[`${k}Points`] = mix.byHow[h].points;
        row[`${k}Share`] = share(mix.byHow[h].points);
      }
      buildRows.push(row);
    }
  }

  // titleTrades: every champion's trades.
  const champions = buildRows.filter((r) => r.champion).map((r) => ({ year: r.year, franchiseId: r._franchiseId, points: r.points }));
  const titleTotals = new Map(champions.map((c) => [`${c.year}|${c.franchiseId}`, c.points]));
  const titleRows = titleTrades(champions, starters, byUse, trades).map((x) => {
    const owner = ownerAt(x.year, x.franchiseId);
    const po = x.partner ? ownerAt(x.tradeYear ?? x.year, x.partner) : null;
    const vias = [...new Set(x.players.map((pl) => pl.via))];
    const total = titleTotals.get(`${x.year}|${x.franchiseId}`) ?? 0;
    return {
      year: x.year,
      team: teamName(x.year, x.franchiseId),
      owner: owner.name,
      rank: x.rank,
      ofTrades: x.ofTrades,
      tradeId: x.tradeId,
      tradeDate: x.tradeDate,
      tradeYear: x.tradeYear,
      sameSeason: x.tradeYear === x.year,
      partner: x.partner ? teamName(x.tradeYear ?? x.year, x.partner) : null,
      partnerOwner: po?.name ?? null,
      via: vias.length > 1 ? 'player and pick' : vias[0],
      starters: x.players
        .map((pl) => `${nameOf(pl.pid)}${pl.via === 'pick' ? ` (drafted with ${pl.chain ? chainLabel(pl.chain) : 'a traded pick'})` : ''} ${fmt(pl.points)} (${fmt(pl.playoffPoints)})`)
        .join('; '),
      starterCount: x.players.length,
      got: x.got ? assets(x.tradeYear, x.got) : null,
      gave: x.gave ? assets(x.tradeYear, x.gave) : null,
      starts: x.starts,
      points: x.points,
      regularPoints: r2(x.points - x.playoffPoints),
      playoffPoints: x.playoffPoints,
      share: total ? r1((x.points / total) * 100) : 0,
      _franchiseId: x.franchiseId,
      _ownerSlug: owner.ownerSlug,
      _names: x.players.map((pl) => nameOf(pl.pid)),
    };
  });

  // tradeOutcomes: every trade, both sides, all seasons.
  const pieceText = (pc) => {
    const v = pc.value;
    const span = v?.firstYear == null ? '' : v.firstYear === v.lastYear ? `${v.firstYear}` : `${v.firstYear}-${v.lastYear}`;
    const scored = v?.starts ? `${fmt(v.points)} pts in ${v.starts} ${v.starts === 1 ? 'start' : 'starts'}` : 'never started';
    const kept = v ? `${scored}${span ? `, ${span}` : ''}${v.titleYears.length ? `, won ${v.titleYears.join(', ')}` : ''} (${v.ended})` : '';
    if (pc.kind === 'player') return `${nameOf(pc.pid)}: ${v ? kept : 'never on a roster week'}`;
    const label = chainLabel(pc.chain);
    if (pc.status === 'used') return `${label} → ${nameOf(pc.pid)}: ${v ? kept : 'never on a roster week'}`;
    if (pc.status === 'traded on') return `${label}: traded on ${pc.onward.date ?? ''} to ${teamName(pc.onward.year, pc.onward.to)}`.replace('  ', ' ');
    if (pc.status === 'not used yet') return `${label}: not used yet`;
    return `${label}: the record cannot say which player it became`;
  };
  const outcomeRows = tradeOutcomes(ps._stints, ps._chains, trades, finish).map((x) => {
    const t = x.trade;
    const owner = ownerAt(t.year, x.franchiseId);
    const po = ownerAt(t.year, x.partnerId);
    const unresolvedOf = (side) => side.picksUntraced + side.pieces.filter((pc) => pc.status === 'unknown').length;
    return {
      year: t.year,
      date: t.date,
      tradeId: t.id,
      team: teamName(t.year, x.franchiseId),
      owner: owner.name,
      partner: teamName(t.year, x.partnerId),
      partnerOwner: po.name,
      got: assets(t.year, t.gave[x.partnerId]),
      gave: assets(t.year, t.gave[x.franchiseId]),
      gotDetail: x.pieces.map(pieceText).join('; '),
      points: x.points,
      playoffPoints: x.playoffPoints,
      starts: x.starts,
      titles: x.titleYears.length,
      titleYears: x.titleYears.join(', '),
      partnerPoints: x.partner.points,
      partnerPlayoffPoints: x.partner.playoffPoints,
      partnerTitles: x.partner.titleYears.length,
      net: x.net,
      result: x.result,
      open: x.open || x.partner.open,
      unresolved: unresolvedOf(x) + unresolvedOf(x.partner),
      _event: `trade${t.index}`,
      _franchiseId: x.franchiseId,
      _ownerSlug: owner.ownerSlug,
    };
  });

  const prepared = { titleTrades: titleRows, rosterBuilds: buildRows, tradeOutcomes: outcomeRows };
  cache.set(mds, prepared);
  return prepared;
}

const CHART_BARS = 10;
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The chart a title-build answer draws, from the matching rows in the order
 * the query sorted them (the first ten): a stacked bar per row.
 * @returns {{ kind: 'stack', label: string, percent: boolean, series: Array<{ label: string, tone: number }>, bars: Array<{ name: string, context: string, values: number[], display: string, franchiseId: string | null }>, take: string } | null}
 */
export function titleBuildChart(unit, rows, all) {
  if (!rows.length) return null;
  if (unit === 'rosterBuilds') return mixChart(rows, all);
  if (unit === 'titleTrades') return titleTradeChart(rows);
  if (unit === 'tradeOutcomes') return outcomeChart(rows);
  return null;
}

function mixChart(rows, all) {
  const bars = rows.slice(0, CHART_BARS).map((r) => ({
    name: `${r.team} ${r.year}`,
    context: r.finish || (r.complete ? '' : 'in progress'),
    values: MIX.map((h) => r[`${MIX_KEYS[h][0]}Share`]),
    display: `${fmt(r.points)} pts`,
    franchiseId: r._franchiseId,
  }));
  // Against contenders (any row not a champion), the average champion, for scale.
  const champs = all.filter((r) => r.champion);
  let avg = null;
  if (rows.slice(0, CHART_BARS).some((r) => !r.champion) && champs.length) {
    avg = MIX.map((h) => r1(champs.reduce((a, r) => a + r[`${MIX_KEYS[h][0]}Share`], 0) / champs.length));
    bars.push({ name: `Avg. champion (${champs.length})`, context: 'every title team', values: avg, display: 'average', franchiseId: null });
  }
  const first = bars[0];
  const topI = first.values.indexOf(Math.max(...first.values));
  const topLabel = MIX_KEYS[MIX[topI]][1].toLowerCase();
  let take = `${first.name}: the biggest share of starter points came by ${topLabel} (${first.values[topI]}%).`;
  if (avg && rows[0] && !rows[0].champion) take += ` The average champion got ${avg[topI]}% that way.`;
  const unknown = bars.some((b) => b.values[MIX.indexOf(HOW.unknown)] > 0);
  if (unknown) take += ' Gray is unknown: a starter whose arrival is not on record.';
  return {
    kind: 'stack',
    label: 'Share of starter points, by how the team got the player',
    percent: true,
    series: MIX.map((h) => ({ label: MIX_KEYS[h][1], tone: TONE[h] })),
    bars,
    take,
  };
}

function titleTradeChart(rows) {
  const bars = rows.slice(0, CHART_BARS).map((r) => ({
    name: short(r._names.join(' + '), 40),
    context: `from ${r.partner ?? 'unknown'}${r.tradeYear ? ` (${r.tradeYear})` : ''} · ${r.team} ${r.year}`,
    values: [r.regularPoints, r.playoffPoints],
    display: fmt(r.points),
    franchiseId: r._franchiseId,
  }));
  const top = rows[0];
  const teams = new Set(rows.map((r) => `${r.team} ${r.year}`));
  const take =
    teams.size === 1
      ? `${rows.length} ${rows.length === 1 ? 'trade' : 'trades'} put starters on ${top.team} in ${top.year}; the biggest, for ${top._names.join(' and ')}, brought ${fmt(top.points)} points (${fmt(top.playoffPoints)} in the playoffs), ${top.share}% of the team's starter points.`
      : `The top trade here, ${top._names.join(' and ')} to ${top.team} (${top.year}), brought ${fmt(top.points)} points in the title season, ${fmt(top.playoffPoints)} of them in the playoffs.`;
  return { kind: 'stack', label: 'Title-season points from each trade', percent: false, series: [{ label: 'Regular season', tone: 1 }, { label: 'Playoffs', tone: 2 }], bars, take };
}

function outcomeChart(rows) {
  const seen = new Set();
  const bars = [];
  for (const r of rows) {
    if (seen.has(r.tradeId)) continue;
    seen.add(r.tradeId);
    bars.push({
      name: short(`${r.team} vs ${r.partner}`, 40),
      context: `${r.date} · ${fmt(r.points)} to ${fmt(r.partnerPoints)}`,
      values: [r.points, r.partnerPoints],
      display: '',
      franchiseId: r._franchiseId,
    });
    if (bars.length === CHART_BARS) break;
  }
  const top = rows[0];
  const verdict = top.result === 'even' ? 'came out even' : `${top.result} it by ${fmt(Math.abs(top.net))} points`;
  const take = `${top.team} ${verdict} over every season since (${fmt(top.points)} to ${fmt(top.partnerPoints)})${top.titles || top.partnerTitles ? `; titles with the pieces: ${top.titles} to ${top.partnerTitles}` : ''}${top.open ? '. Still open: a piece is still on a roster' : ''}.`;
  return { kind: 'stack', label: 'Points each side got from the trade, every season since', percent: false, series: [{ label: 'First-named team got', tone: 1 }, { label: 'Second-named team got', tone: 2 }], bars, take };
}

/** The prompt's lines about these units (ask.ts). */
export function titleBuildLine() {
  return `- Title builds use three more units. titleTrades: one row per (title season, trade) for every trade that put a starter on that champion, in the title season or an earlier one (a player who came in it and stayed, or a pick that came in it and was used on him), with what the champion gave up, the starters' points that season (points, regularPoints, playoffPoints, share of the team's points) and rank among that champion's trades. For "trades that led to Team X's 2019 title" use titleTrades for that year and team (sort by points), not titleRosters, and say what was given up. rosterBuilds: one row per team-season, its starters by how the team got them (draftStarters/draftPoints/draftShare and the same for trade, waiver, freeAgent, auction, commissioner, inherited, unknown) plus carriedOver (on the roster in an earlier season); "how was each title team built" is rosterBuilds where champion = true, and "compare this year's contenders to past champions" is rosterBuilds for the season in progress sorted by rank (its chart adds the average champion), with the champions' averages from summarize over champion = true. Unknown stays unknown: say how much of a roster the record cannot explain. tradeOutcomes: one row per side of every trade, each player and pick followed forward for every season the team kept him (not just that season), with points, playoffPoints, titles won with the pieces starting, the partner's same totals, net and result; use it for "who won the trade long-term" (the trades unit only counts the rest of that season). A piece traded on is not credited with what it later became; say so when gotDetail says "traded on", and when open is true say the trade can still swing. These units draw their own chart, so do not set chart on them.`;
}
