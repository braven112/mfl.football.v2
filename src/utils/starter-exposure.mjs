/**
 * Projected-starter bye exposure — how many of a franchise's LIKELY STARTERS
 * are on an NFL bye in a given week.
 *
 * WHY THE WHOLE-ROSTER COUNT WAS NOT GOOD ENOUGH
 *
 * `byeExposure` (schedule-plan.mjs) counts every rostered player on bye, which
 * treats a lost WR4 the same as a lost QB1. Measured against the real 2026
 * rosters that is not a rounding error, and it breaks the two leagues in
 * opposite directions:
 *
 *   AFL         reveals its schedule BEFORE the draft, so a roster is keepers
 *               only — 7 players, all of them people you kept on purpose. 46%
 *               of (team, bye-week) slots already have a fully clean roster,
 *               and the whole-roster count is already a fair read on starters.
 *   The League   reveals June 1 with rosters FULL — 24 players, 20-25 of whom
 *               sit on a bye at some point. Only 10% of its (team, bye-week)
 *               slots are clean, and Weeks 8, 11 and 13 have ZERO clean teams.
 *               Counting the whole roster there says "every week is bad",
 *               which is useless as a signal to schedule against.
 *
 * So the starter model is mostly a League need. It falls out correctly for the
 * AFL for free: a 7-player roster cannot fill 9 starter slots, so every player
 * IS a starter and this returns exactly what the roster count returns. No
 * special-casing, and no pretending we know more than we do.
 *
 * HOW A STARTER IS PICKED
 *
 * Best available by composite rank, filling the league's own lineup
 * requirements (`league.starters`) — minimums first, then the remaining slots
 * from whichever flex positions have room. Value comes from the same built-in
 * ranking sources the site already fetches (`data/ranking-sources/<year>.json`),
 * averaged across every source that lists the player, with roster salary as the
 * tiebreak for players no source ranks (84% of League rosters are ranked; the
 * rest are deep bench, and salary orders them well enough for a bye count).
 *
 * This is a PROJECTION, deliberately a coarse one. It is used to compare weeks
 * against each other months before kickoff, not to set anyone's lineup.
 */
import { asArray, byeWeeksOf } from './schedule-rules.mjs';

/**
 * Composite value rank per MFL player id: the mean of its normalised rank in
 * every source that lists it. Lower is better.
 *
 * Averaging normalised ranks rather than raw ones matters because the sources
 * are different lengths — rank 200 in a 600-player dynasty list and rank 200 in
 * a 278-player redraft list are not the same statement.
 */
export const compositeValueRanks = (rankingSourcesJson) => {
  const sum = {};
  const seen = {};
  for (const source of asArray(rankingSourcesJson?.sources)) {
    const players = asArray(source.players);
    if (!players.length) continue;
    for (const p of players) {
      const id = String(p.id);
      const normalised = Number(p.rank) / players.length;
      if (!Number.isFinite(normalised)) continue;
      sum[id] = (sum[id] ?? 0) + normalised;
      seen[id] = (seen[id] ?? 0) + 1;
    }
  }
  const rank = {};
  for (const id of Object.keys(sum)) rank[id] = sum[id] / seen[id];
  return rank;
};

/** `"1-4"` -> {min:1, max:4}; `"1"` -> {min:1, max:1}. */
const parseLimit = (limit) => {
  const [lo, hi] = String(limit ?? '').split('-');
  const min = Number(lo) || 0;
  return { min, max: Number(hi ?? lo) || min };
};

/**
 * The lineup a franchise would most likely start, as a Set of player ids.
 *
 * Fills every position's MINIMUM first — a lineup without a kicker is not a
 * lineup, however many good receivers you own — then spends what is left on the
 * best remaining players any position still has room for.
 *
 * A roster too small to fill the slots returns every player it has, which is
 * the correct answer for a keeper-only AFL roster rather than a degenerate one.
 */
export const projectedStarters = (playerIds, { positionOf, valueOf, starters }) => {
  const slots = asArray(starters?.position).map((p) => ({ name: p.name, ...parseLimit(p.limit) }));
  const total = Number(starters?.count) || slots.reduce((n, s) => n + s.min, 0);

  const byValue = [...playerIds].sort((a, b) => valueOf(a) - valueOf(b));
  if (byValue.length <= total) return new Set(byValue);

  const chosen = new Set();
  const used = {};
  for (const s of slots) used[s.name] = 0;

  const take = (id, pos) => {
    chosen.add(id);
    used[pos] += 1;
  };

  for (const slot of slots) {
    for (const id of byValue) {
      if (used[slot.name] >= slot.min) break;
      if (chosen.has(id) || positionOf(id) !== slot.name) continue;
      take(id, slot.name);
    }
  }
  const room = (pos) => {
    const slot = slots.find((s) => s.name === pos);
    return slot ? used[pos] < slot.max : false;
  };
  for (const id of byValue) {
    if (chosen.size >= total) break;
    const pos = positionOf(id);
    if (chosen.has(id) || !room(pos)) continue;
    take(id, pos);
  }
  return chosen;
};

/**
 * `{ franchiseId: { week: projectedStartersOnBye } }` — a drop-in replacement
 * for `byeExposure`, same shape, better signal.
 *
 * @param {object} args
 * @param {any} args.rostersJson      MFL rosters feed
 * @param {any} args.playersJson      MFL players feed (position + NFL team)
 * @param {any} args.rankingSourcesJson  data/ranking-sources/<year>.json
 * @param {Record<string,number>} args.byes  NFL team -> bye week
 * @param {string[]} args.franchiseIds
 * @param {any} args.starters         `league.starters` from the league feed
 */
export const starterByeExposure = ({
  rostersJson,
  playersJson,
  rankingSourcesJson,
  byes,
  franchiseIds,
  starters,
}) => {
  const teamOf = {};
  const posOf = {};
  for (const p of asArray(playersJson?.players?.player)) {
    teamOf[p.id] = p.team;
    posOf[p.id] = p.position;
  }
  const valueRank = compositeValueRanks(rankingSourcesJson);

  const table = {};
  const lineups = {};
  for (const id of franchiseIds) {
    table[id] = {};
    lineups[id] = new Set();
  }

  for (const f of asArray(rostersJson?.rosters?.franchise)) {
    const roster = asArray(f.player);
    // Salary breaks ties for players no source ranks. Ranked players always
    // sort ahead of unranked ones (+1 clears the normalised-rank range of 0-1),
    // and among the unranked a bigger contract sorts first.
    const salary = {};
    for (const p of roster) salary[p.id] = Number(p.salary) || 0;
    const maxSalary = Math.max(1, ...Object.values(salary));
    const valueOf = (id) =>
      valueRank[String(id)] ?? 1 + (1 - (salary[id] ?? 0) / maxSalary);

    const starterIds = projectedStarters(
      roster.map((p) => p.id),
      { positionOf: (id) => posOf[id], valueOf, starters },
    );
    lineups[f.id] = starterIds;
    table[f.id] ??= {};
    for (const id of starterIds) {
      for (const week of byeWeeksOf(byes, teamOf[id])) {
        table[f.id][week] = (table[f.id][week] ?? 0) + 1;
      }
    }
  }
  return { exposure: table, lineups };
};
