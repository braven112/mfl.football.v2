/**
 * Playoff-bubble history — who missed the playoffs by one spot, and who took it.
 *
 * Commissioner, Nov 2026: a team that keeps finishing just outside the
 * playoffs, facing the team that took its spot, is a storyline Schefter should
 * call out in the weekly preview. It is NOT a scheduling rule — the schedule is
 * drawn before the season, so it cannot know who will be on the bubble.
 *
 * Read off the League History dataset (`data/<league>/derived/league-history.json`):
 * each completed season's teams carry `rk` (MFL's final order, which already
 * applies the constitution's tiebreakers — never re-sorted) and `r` (M =
 * missed, anything else = made the playoffs). Seeding is per CONFERENCE where
 * a league has them (the AFL), otherwise league-wide.
 *
 * A season counts against a franchise only while its CURRENT owner held it
 * (`h`), so a new owner is never blamed for the last one's near-misses.
 *
 * Pure: hand it the dataset and a division→conference map.
 */

const MADE = (t) => t?.r && t.r !== 'M';

/** 2024 / 2024 and 2025 / 2023, 2024 and 2025 — oldest first. */
const listYears = (years) => {
  const ys = [...years].sort((a, b) => a - b).map(String);
  return ys.length < 2 ? ys.join('') : `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}`;
};

/**
 * Per completed season and seeding scope: the last team in and the first team
 * out. Newest season first.
 *
 * @param {object} ds                       league-history.json
 * @param {Record<string,string>} [conferenceOfDivision]  division name -> conference; absent = one scope
 * @param {number} [lookback]               completed seasons to read
 */
export function bubbleSeasons(ds, conferenceOfDivision = {}, lookback = 5) {
  const done = (ds?.seasons ?? []).filter((s) => s.done).sort((a, b) => b.y - a.y).slice(0, lookback);
  const out = [];
  for (const s of done) {
    const scopes = {};
    for (const [id, t] of Object.entries(s.teams ?? {})) {
      const scope = conferenceOfDivision[t.d] ?? '_';
      (scopes[scope] ??= []).push({ id, ...t });
    }
    for (const [scope, teams] of Object.entries(scopes)) {
      const made = teams.filter(MADE).sort((a, b) => a.rk - b.rk);
      const missed = teams.filter((t) => !MADE(t)).sort((a, b) => a.rk - b.rk);
      if (!made.length || !missed.length) continue;
      const lastIn = made[made.length - 1];
      const firstOut = missed[0];
      out.push({ year: s.y, scope, lastIn: lastIn.id, lastInOwner: lastIn.h, firstOut: firstOut.id, firstOutOwner: firstOut.h });
    }
  }
  return out;
}

/** The owner holding each franchise in the dataset's newest season. */
export function currentOwners(ds) {
  const latest = [...(ds?.seasons ?? [])].sort((a, b) => b.y - a.y)[0];
  return Object.fromEntries(Object.entries(latest?.teams ?? {}).map(([id, t]) => [id, t.h]));
}

/**
 * Fact-sheet lines for one matchup. Empty when neither side has a bubble story.
 *
 *  - a head-to-head bubble: one side missed by a spot in a season the other
 *    took that last spot ("took his spot", the post's own example)
 *  - a repeat near-miss: a side that has been first out two or more times
 */
export function bubbleFacts(seasons, owners, a, b, nameOf) {
  const held = (id, owner) => owners[id] && owners[id] === owner;
  const lines = [];

  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    const took = seasons.filter(
      (s) => s.firstOut === x && s.lastIn === y && held(x, s.firstOutOwner) && held(y, s.lastInOwner),
    );
    if (took.length) {
      const years = listYears(took.map((s) => s.year));
      lines.push(
        `Playoff bubble: ${nameOf(x)} missed the playoffs by one spot in ${years}; ` +
          `${nameOf(y)} took that last spot ${took.length > 1 ? 'every time' : 'instead'}.`,
      );
    }
  }

  for (const x of [a, b]) {
    const misses = seasons.filter((s) => s.firstOut === x && held(x, s.firstOutOwner));
    if (misses.length >= 2) {
      lines.push(
        `Bubble history: ${nameOf(x)} have been the first team out of the playoffs ${misses.length} times in the last ` +
          `${new Set(seasons.map((s) => s.year)).size} seasons (${listYears(misses.map((s) => s.year))}).`,
      );
    }
  }
  return lines;
}
