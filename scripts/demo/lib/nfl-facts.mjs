/**
 * The NFL facts the demo league is built on — read from the real feeds BEFORE
 * the demo build deletes them, and nothing else.
 *
 * What counts as a fact: who an NFL player is (name, position, NFL team, draft
 * year), and how many fantasy points he scored in a given NFL week. Those are
 * true in every league. What is NOT read: which franchise rostered him, what
 * he was paid, who traded for him — the league's own history, which the demo
 * must never carry. The scores come from `weekly-results-raw.json` because it
 * is the one committed file holding every rostered player's weekly score; only
 * the player id and score are taken out of it, and the franchise wrapper is
 * discarded on read.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DEMO_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK', 'Def'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Facts for one season: `players` (id → identity) and `scores`
 * (week → Map<playerId, points>), plus the last week with any score.
 */
export function loadSeasonFacts(feedsDir, year) {
  const dir = path.join(feedsDir, String(year));
  const playersFeed = readJson(path.join(dir, 'players.json'));
  const players = new Map();
  for (const p of asArray(playersFeed?.players?.player)) {
    if (!DEMO_POSITIONS.includes(p.position)) continue;
    players.set(p.id, {
      id: p.id,
      name: p.name,
      position: p.position,
      team: p.team,
      draftYear: Number(p.draft_year) || null,
    });
  }

  /** @type {Map<number, Map<string, number>>} */
  const scores = new Map();
  const put = (week, id, score) => {
    const w = Number(week);
    const s = Number(score);
    if (!w || !id || !Number.isFinite(s)) return;
    if (!scores.has(w)) scores.set(w, new Map());
    scores.get(w).set(String(id), s);
  };

  for (const wk of asArray(readJson(path.join(dir, 'weekly-results-raw.json')))) {
    const week = wk?.weeklyResults?.week;
    for (const matchup of asArray(wk?.weeklyResults?.matchup)) {
      for (const side of asArray(matchup.franchise)) {
        for (const p of asArray(side.player)) put(week, p.id, p.score);
      }
    }
  }
  // The in-progress season also carries a league-independent per-week score
  // table with a wider pool; merge it where present.
  const byWeek = readJson(path.join(dir, 'playerScores-by-week.json'))?.weeks;
  if (byWeek && typeof byWeek === 'object') {
    for (const [week, table] of Object.entries(byWeek)) {
      for (const [id, score] of Object.entries(table ?? {})) put(week, id, score);
    }
  }

  const weeksScored = [...scores.keys()].sort((a, b) => a - b);
  return {
    year,
    players,
    scores,
    lastScoredWeek: weeksScored.length ? weeksScored[weeksScored.length - 1] : 0,
  };
}

/** Season total and games played per player, for valuing him. */
export function seasonTotals(facts, throughWeek = Infinity) {
  const totals = new Map();
  for (const [week, table] of facts.scores) {
    if (week > throughWeek) continue;
    for (const [id, score] of table) {
      const t = totals.get(id) ?? { points: 0, games: 0 };
      t.points += score;
      t.games += 1;
      totals.set(id, t);
    }
  }
  return totals;
}
