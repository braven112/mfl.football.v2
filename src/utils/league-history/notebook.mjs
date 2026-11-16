/**
 * Buck's Notebook: a few history facts tied to the coming week, posted to the
 * league's news feed every Tuesday by Buck Archives, the Ask the History
 * historian (Brandon, 2026-11-16: "the highest score in a Week 3 game is
 * 111.11", "the team with the best record after 8 games was X", something new
 * each week, random and unique for each league).
 *
 * Every number comes from the Ask the History engine (ask-query.mjs), so a
 * fact counts exactly the way Ask the History and the Record Book count it:
 * consolation games are left out, seasons belong to the owner who held them.
 * No model writes any of it. Buck's flavor is in the fixed phrasings below,
 * picked at random, never in the numbers (the byline-not-a-voice rule,
 * src/data/historian.ts).
 *
 * Pure: the caller hands in the dataset, the week and what earlier issues
 * this season already said. The same league, season and week always draw the
 * same notebook, and two leagues draw different ones.
 */

import { runQuery } from './ask-query.mjs';

/** Fewer seasons than this and "the most ever" is not a record worth posting. */
export const MIN_SEASONS = 3;

/** How many facts an issue carries, drawn at random so the format changes week to week. */
const FACT_COUNTS = [1, 2, 3, 3, 4, 5];

/** Fact kinds used in the last this-many issues are drawn last, so a week rarely repeats the one before. */
const RECENT_ISSUES = 2;

const POSITIONS = [
  { code: 'QB', word: 'quarterback' },
  { code: 'RB', word: 'running back' },
  { code: 'WR', word: 'receiver' },
  { code: 'TE', word: 'tight end' },
];

// ── Random, but repeatable ──────────────────────────────────────────────────

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator, so a re-run draws the same issue. */
export function seededRandom(seedText) {
  let a = hashSeed(String(seedText));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function shuffle(rng, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Formatting ──────────────────────────────────────────────────────────────

const pts = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const record = (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const countWord = (n) => NUMBER_WORDS[n] ?? String(n);

/** How a finished season ended, as a phrase that follows "and". */
function outcome(row) {
  if (row.champion) return 'won the title';
  if (row.finish === 'Runner-up') return 'lost in the title game';
  if (row.madePlayoffs) return 'made the playoffs';
  if (row.finish === 'Missed playoffs') return 'missed the playoffs';
  return null;
}

// ── Reading the engine ──────────────────────────────────────────────────────

/** Run one query and return its rows as objects keyed by column. */
function rowsOf(ctx, query) {
  try {
    const result = runQuery(ctx.ds, query, { players: ctx.players, league: ctx.league });
    const keys = result.columns.map((c) => c.key);
    return {
      total: result.total,
      rows: result.rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r.cells[i]]))),
    };
  } catch {
    // A unit this league has no data for (players), or a field it lacks: no fact.
    return { total: 0, rows: [] };
  }
}

/** Week-N games, one row per team-week (a doubleheader's one score is not two records). */
function weekGames(ctx, query) {
  const { rows } = rowsOf(ctx, {
    unit: 'games',
    ...query,
    where: [{ field: 'week', op: 'eq', value: ctx.week }, ...(query.where ?? [])],
    columns: ['year', 'week', 'team', 'owner', 'opponent', 'score', 'oppScore', 'margin', 'combined', 'result'],
    limit: 25,
  });
  const seen = new Set();
  return rows.filter((r) => {
    const key = query.pairKey ? [r.year, ...[r.team, r.opponent].sort()].join('|') : `${r.year}|${r.team}|${r.score}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The regular-season starts through the first `games` games, every season that played that many. */
function starts(ctx, query) {
  return rowsOf(ctx, {
    unit: 'seasons',
    throughGames: ctx.games,
    ...query,
    columns: ['year', 'team', 'owner', 'w', 'l', 't', 'winPct', 'pf', 'finish', 'champion', 'madePlayoffs', 'complete'],
    limit: query.limit ?? 25,
  });
}

/** How many seasons have a Week N game on record. */
function seasonsWithWeek(ctx) {
  const { rows } = rowsOf(ctx, {
    unit: 'games',
    where: [{ field: 'week', op: 'eq', value: ctx.week }],
    groupBy: ['year'],
    limit: 25,
  });
  return rows.length;
}

// ── The facts ───────────────────────────────────────────────────────────────
//
// Each returns { text } or null when the league's record cannot say it
// truthfully (too few seasons, no player data, nobody ever did it). `key`
// is the kind; the id a fact is remembered by also carries the week or game
// count it is about, so "best start through 8" and "through 9" are two facts.

const FACTS = [
  {
    key: 'week-high',
    scope: 'week',
    build(ctx, rng) {
      const [top] = weekGames(ctx, { sort: [{ field: 'score', dir: 'desc' }] });
      if (!top) return null;
      return pick(rng, [
        `The highest score ever posted in Week ${ctx.week}: ${pts(top.score)}, by ${top.team} in ${top.year}.`,
        `Most points in a Week ${ctx.week} game: ${pts(top.score)}. ${top.team} did it in ${top.year}, and nobody has topped it since.`,
        `Week ${ctx.week} record to beat: ${top.team} hung ${pts(top.score)} on ${top.opponent} in ${top.year}.`,
      ]);
    },
  },
  {
    key: 'week-low',
    scope: 'week',
    build(ctx, rng) {
      const [low] = weekGames(ctx, { where: [{ field: 'score', op: 'gt', value: 0 }], sort: [{ field: 'score', dir: 'asc' }] });
      if (!low) return null;
      const still = low.result === 'W' ? ` And they still won.` : '';
      return pick(rng, [
        `The lowest Week ${ctx.week} score on record: ${pts(low.score)}, by ${low.team} in ${low.year}.${still}`,
        `Rock bottom in Week ${ctx.week}: ${low.team} managed ${pts(low.score)} in ${low.year}.${still}`,
      ]);
    },
  },
  {
    key: 'week-blowout',
    scope: 'week',
    build(ctx, rng) {
      const [g] = weekGames(ctx, { sort: [{ field: 'margin', dir: 'desc' }] });
      if (!g || !(g.margin > 0)) return null;
      return pick(rng, [
        `Biggest Week ${ctx.week} blowout ever: ${g.team} beat ${g.opponent} by ${pts(g.margin)} in ${g.year}, ${pts(g.score)} to ${pts(g.oppScore)}.`,
        `Week ${ctx.week} has seen some beatdowns. The worst: ${g.team} over ${g.opponent}, ${pts(g.score)} to ${pts(g.oppScore)}, in ${g.year}.`,
      ]);
    },
  },
  {
    key: 'week-shootout',
    scope: 'week',
    build(ctx, rng) {
      const [g] = weekGames(ctx, { sort: [{ field: 'combined', dir: 'desc' }], pairKey: true });
      if (!g) return null;
      return pick(rng, [
        `Wildest Week ${ctx.week} shootout on record: ${g.team} ${pts(g.score)}, ${g.opponent} ${pts(g.oppScore)} in ${g.year}. That's ${pts(g.combined)} combined.`,
        `Most combined points in a Week ${ctx.week} game: ${pts(g.combined)}, when ${g.team} and ${g.opponent} went at it in ${g.year}.`,
      ]);
    },
  },
  {
    key: 'week-thriller',
    scope: 'week',
    build(ctx, rng) {
      const [g] = weekGames(ctx, { where: [{ field: 'margin', op: 'gt', value: 0 }], sort: [{ field: 'margin', dir: 'asc' }] });
      if (!g) return null;
      return pick(rng, [
        `Closest Week ${ctx.week} game ever: ${g.team} edged ${g.opponent} ${pts(g.score)} to ${pts(g.oppScore)} in ${g.year}. A ${pts(g.margin)}-point win.`,
        `Nail-biter file, Week ${ctx.week}: ${g.team} beat ${g.opponent} by ${pts(g.margin)} in ${g.year}.`,
      ]);
    },
  },
  {
    key: 'week-player',
    scope: 'week',
    build(ctx, rng) {
      const { rows } = rowsOf(ctx, {
        unit: 'playerWeeks',
        where: [{ field: 'week', op: 'eq', value: ctx.week }],
        sort: [{ field: 'score', dir: 'desc' }],
        columns: ['year', 'player', 'position', 'team', 'score'],
        limit: 1,
      });
      const [p] = rows;
      if (!p) return null;
      return pick(rng, [
        `Best Week ${ctx.week} game by any starter: ${p.player} (${p.position}) put up ${pts(p.score)} for ${p.team} in ${p.year}.`,
        `The Week ${ctx.week} high for a single player: ${pts(p.score)}, ${p.player} for ${p.team} in ${p.year}.`,
      ]);
    },
  },
  {
    key: 'week-position',
    scope: 'week',
    build(ctx, rng) {
      const pos = pick(rng, POSITIONS);
      const { rows } = rowsOf(ctx, {
        unit: 'playerWeeks',
        where: [
          { field: 'week', op: 'eq', value: ctx.week },
          { field: 'position', op: 'eq', value: pos.code },
        ],
        sort: [{ field: 'score', dir: 'desc' }],
        columns: ['year', 'player', 'team', 'score'],
        limit: 1,
      });
      const [p] = rows;
      if (!p) return null;
      return `Top ${pos.word} in a Week ${ctx.week} game: ${p.player}, ${pts(p.score)} points for ${p.team} in ${p.year}.`;
    },
  },
  {
    key: 'week-owner-wins',
    scope: 'week',
    build(ctx, rng) {
      const { rows } = rowsOf(ctx, {
        unit: 'games',
        where: [
          { field: 'week', op: 'eq', value: ctx.week },
          { field: 'result', op: 'eq', value: 'W' },
        ],
        groupBy: ['owner'],
        limit: 2,
      });
      const [top, next] = rows;
      if (!top || top.count < 3 || (next && next.count === top.count)) return null;
      return pick(rng, [
        `Nobody owns Week ${ctx.week} like ${top.owner}: ${plural(top.count, 'win')} in Week ${ctx.week} games, the most of any owner.`,
        `Most Week ${ctx.week} wins by one owner: ${top.owner}, with ${top.count}.`,
      ]);
    },
  },
  {
    key: 'start-best',
    scope: 'games',
    build(ctx, rng) {
      const { rows } = starts(ctx, { sort: [{ field: 'winPct', dir: 'desc' }, { field: 'pf', dir: 'desc' }] });
      const [top] = rows;
      if (!top) return null;
      const same = rows.filter((r) => r.w === top.w && r.l === top.l && r.t === top.t);
      // Several unbeaten starts are start-unbeaten's fact; saying it twice in one issue reads as filler.
      if (same.length > 1 && top.l === 0 && top.t === 0) return null;
      const ended = top.complete ? outcome(top) : null;
      if (same.length === 1) {
        return pick(rng, [
          `Best start through ${ctx.games} games in league history: ${top.team} at ${record(top)} in ${top.year}${ended ? `, and they ${ended}` : ''}.`,
          `${top.team} went ${record(top)} through ${ctx.games} games in ${top.year}. No team has started better.${ended ? ` They ${ended}.` : ''}`,
        ]);
      }
      return `${countWord(same.length)} teams have started ${record(top)} through ${ctx.games} games, the best start on record. ${top.team} (${top.year}) scored the most doing it, ${pts(top.pf)}${ended ? `, and ${ended}` : ''}.`;
    },
  },
  {
    key: 'start-points',
    scope: 'games',
    build(ctx, rng) {
      const { rows } = starts(ctx, { sort: [{ field: 'pf', dir: 'desc' }], limit: 1 });
      const [top] = rows;
      if (!top) return null;
      return pick(rng, [
        `Most points through ${ctx.games} games: ${pts(top.pf)}, by ${top.team} in ${top.year} (${record(top)}).`,
        `The scoring pace to beat after ${ctx.games} games belongs to ${top.team}: ${pts(top.pf)} in ${top.year}.`,
      ]);
    },
  },
  {
    key: 'start-comeback',
    scope: 'games',
    build(ctx, rng) {
      const { rows } = starts(ctx, {
        where: [
          { field: 'complete', op: 'eq', value: true },
          { field: 'madePlayoffs', op: 'eq', value: true },
        ],
        sort: [{ field: 'winPct', dir: 'asc' }, { field: 'pf', dir: 'asc' }],
        limit: 1,
      });
      const [r] = rows;
      if (!r || !(r.winPct < 0.5)) return null;
      const title = r.champion ? ' Then won the whole thing.' : '';
      return pick(rng, [
        `Don't pack it in yet: ${r.team} was ${record(r)} through ${ctx.games} games in ${r.year} and still made the playoffs.${title}`,
        `Worst start to reach the playoffs after ${ctx.games} games: ${r.team}, ${record(r)} in ${r.year}.${title}`,
      ]);
    },
  },
  {
    key: 'start-collapse',
    scope: 'games',
    build(ctx, rng) {
      const { rows } = starts(ctx, {
        where: [
          { field: 'complete', op: 'eq', value: true },
          { field: 'madePlayoffs', op: 'eq', value: false },
          { field: 'finish', op: 'eq', value: 'Missed playoffs' },
        ],
        sort: [{ field: 'winPct', dir: 'desc' }, { field: 'pf', dir: 'desc' }],
        limit: 1,
      });
      const [r] = rows;
      if (!r || !(r.winPct >= 0.6)) return null;
      return pick(rng, [
        `A hot start guarantees nothing. ${r.team} was ${record(r)} through ${ctx.games} games in ${r.year} and missed the playoffs.`,
        `Best start that still missed the playoffs, through ${ctx.games} games: ${r.team} at ${record(r)} in ${r.year}.`,
      ]);
    },
  },
  {
    key: 'start-unbeaten',
    scope: 'games',
    build(ctx) {
      if (ctx.games < 4) return null;
      const where = [
        { field: 'l', op: 'eq', value: 0 },
        { field: 't', op: 'eq', value: 0 },
      ];
      const done = starts(ctx, { where: [...where, { field: 'complete', op: 'eq', value: true }] }).rows;
      const now = starts(ctx, { where: [...where, { field: 'complete', op: 'eq', value: false }] }).rows;
      if (!done.length) return null;
      const titles = done.filter((r) => r.champion).length;
      const latest = now.length ? ` ${now.map((r) => r.team).join(' and ')} ${now.length === 1 ? 'is' : 'are'} the latest to try.` : '';
      if (done.length === 1) {
        const [r] = done;
        return `Only one team has opened ${ctx.games}-0: ${r.team} in ${r.year}. ${r.champion ? 'They won the title.' : 'They did not win the title.'}${latest}`;
      }
      const won = titles === 0 ? 'None of them won the title.' : `${countWord(titles)} of them won the title.`;
      return `${countWord(done.length)} teams have opened ${ctx.games}-0. ${won}${latest}`;
    },
  },
  {
    key: 'start-winless',
    scope: 'games',
    build(ctx) {
      if (ctx.games < 3) return null;
      const { rows } = starts(ctx, {
        where: [
          { field: 'w', op: 'eq', value: 0 },
          { field: 't', op: 'eq', value: 0 },
          { field: 'complete', op: 'eq', value: true },
        ],
      });
      if (!rows.length) return null;
      const made = rows.filter((r) => r.madePlayoffs).length;
      if (rows.length === 1) {
        const [r] = rows;
        return `Only one team has started 0-${ctx.games}: ${r.team} in ${r.year}.${r.madePlayoffs ? ' They made the playoffs anyway.' : ''}`;
      }
      const tail = made ? ` ${countWord(made)} of them made the playoffs anyway.` : ' None of them made the playoffs.';
      return `${countWord(rows.length)} teams have started 0-${ctx.games}.${tail}`;
    },
  },
];

export const FACT_KEYS = FACTS.map((f) => f.key);

/** The id a fact is remembered by: its kind plus the week or game count it is about. */
export function factId(key, { week, games }) {
  const fact = FACTS.find((f) => f.key === key);
  return `${key}@${fact?.scope === 'games' ? `g${games}` : `w${week}`}`;
}

const OPENERS = [
  (w) => `Pulled from the archives ahead of Week ${w}:`,
  (w) => `Week ${w} is coming. Here's what the record book says:`,
  (w) => `Dusted off the old ledgers for Week ${w}:`,
  (w) => `Before Week ${w} kicks off, a little history:`,
  (w) => `From the vault, Week ${w} edition:`,
];

/**
 * One week's notebook.
 *
 * @param {object} o
 * @param {any} o.ds league-history.json
 * @param {any} [o.players] league-history-players.json, for the player facts
 * @param {string} o.league registry slug (also part of the draw)
 * @param {number} o.year the season being played
 * @param {number} o.week the coming NFL week the week facts are about
 * @param {number} o.games regular-season games each team has played so far
 * @param {Array<{ factIds?: string[], keys?: string[] }>} [o.earlier] this season's earlier issues, newest first
 * @returns {{ facts: Array<{ key: string, id: string, text: string }>, opener: string } | null}
 */
export function buildNotebook({ ds, players = null, league, year, week, games, earlier = [] }) {
  if (!ds?.seasons || ds.seasons.length < MIN_SEASONS) return null;
  const ctx = { ds, players, league, year, week, games };
  const rng = seededRandom(`${league}:${year}:w${week}`);

  const said = new Set(earlier.flatMap((i) => i.factIds ?? []));
  const recent = new Set(earlier.slice(0, RECENT_ISSUES).flatMap((i) => i.keys ?? []));
  const weekReady = seasonsWithWeek(ctx) >= MIN_SEASONS;

  const order = shuffle(rng, FACTS).sort((a, b) => Number(recent.has(a.key)) - Number(recent.has(b.key)));
  const want = pick(rng, FACT_COUNTS);
  const facts = [];
  for (const fact of order) {
    if (facts.length >= want) break;
    if (fact.scope === 'week' && !weekReady) continue;
    if (fact.scope === 'games' && !(games >= 2)) continue;
    const id = factId(fact.key, ctx);
    if (said.has(id)) continue;
    const text = fact.build(ctx, rng);
    if (text) facts.push({ key: fact.key, id, text });
  }
  if (!facts.length) return null;
  return { facts, opener: pick(rng, OPENERS)(week) };
}

/** The feed post's headline and body for a notebook. The body is plain, line-broken text. */
export function notebookText({ facts, opener }, { week }) {
  const lines = facts.length === 1 ? [facts[0].text] : facts.map((f) => `• ${f.text}`);
  return {
    headline: `Buck's Notebook: Week ${week}`,
    body: `${opener}\n\n${lines.join('\n')}`,
  };
}
