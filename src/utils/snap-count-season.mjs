/**
 * Which NFL season's snap counts a surface should show.
 *
 * THE BUG THIS EXISTS TO STOP
 * ---------------------------
 * The Free Agents page used to pick its snap-count file by filename sort —
 * "the most recent file wins" — and label the columns `Snaps` / `Snap%` with
 * no season anywhere. Nothing scheduled the fetch, so the newest file on disk
 * was the 2025 season captured in February 2026, and in week 2 of the 2026
 * season the page confidently showed Kareem Hunt at 529 snaps next to an empty
 * GP. A stale file is indistinguishable from a live one when the only thing
 * choosing it is `sort().reverse()`.
 *
 * THE RULE
 * --------
 * Once the season's official kickoff has passed, show THAT season, however
 * thin it is — week 1 usage is the question an owner is asking in September.
 * Before kickoff (the whole offseason, including the Labor Day → kickoff gap)
 * show the last completed season.
 *
 * Kickoff is `nflWeekOneKickoff`, never a derivation from Labor Day: 2026
 * opened on a WEDNESDAY, so "the Thursday after Labor Day" sits closed through
 * the season's first game. See src/utils/nfl-week-starts.mjs.
 *
 * The year is read off the PACIFIC clock. On New Year's Eve a UTC year and a
 * PT year disagree, and since neither season has kicked off in January the two
 * answers differ by a whole season.
 *
 * ONE COPY, BOTH LEAGUES
 * ----------------------
 * `resolveSnapCounts` below is the whole decision — season, lookup and the
 * labels that name the season on screen — because BOTH free-agent pages show
 * these columns and they are forked siblings. A page that re-implemented the
 * pick would be a second copy of the rule that shipped this bug, free to drift
 * from the first. The data itself lives at `data/nfl/snap-counts-<year>.json`
 * rather than under a league: NFLverse snap counts are NFL facts, and MFL
 * player ids are global across leagues (all 2622 of the AFL's 2026 players
 * resolve to the same id and name in TheLeague's feed), so one file is
 * genuinely correct for both rather than merely convenient.
 */

import { nflWeekOneKickoff } from './pecking-order-season-window.mjs';
import { ptParts } from './nfl-week-starts.mjs';

/**
 * The season whose snap counts should be on screen at `now`:
 * the most recent season whose week 1 has kicked off.
 */
export function snapCountSeason(now = new Date()) {
  const year = ptParts(now).year;
  return now >= nflWeekOneKickoff(year) ? year : year - 1;
}

/**
 * Choose a snap-count season from the ones we actually hold on disk.
 *
 * Returns the wanted season when we have it. Otherwise the newest season we
 * DO hold that is not in the future — which covers the real gap between
 * kickoff and the first Tuesday fetch, when the new season exists but no
 * games have been played yet. Never silently upgrades: the caller gets the
 * season back so it can be rendered next to the number.
 *
 * @param {Iterable<number>} available seasons present on disk
 * @param {Date} now
 * @returns {number | null}
 */
export function pickSnapCountSeason(available, now = new Date()) {
  const wanted = snapCountSeason(now);
  const seasons = [...available].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
  if (seasons.includes(wanted)) return wanted;
  return seasons.find((y) => y < wanted) ?? null;
}

/**
 * Everything a free-agent page needs to render the GP / Snaps / Snap% columns.
 *
 * @param {Record<string, any>} modules an eager `import.meta.glob` of
 *   `data/nfl/snap-counts-*.json`
 * @param {Date} now request-time instant (honour `?testDate=`)
 * @returns {{
 *   season: number | null,
 *   weeks: number,
 *   byPlayerId: Map<string, { snaps: number, pct: number, games: number }>,
 *   has: boolean,
 *   seasonLabel: string,
 *   scopeTitle: string,
 * }}
 */
export function resolveSnapCounts(modules, now = new Date()) {
  const unwrap = (mod) =>
    mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;

  const bySeason = new Map();
  for (const [key, mod] of Object.entries(modules)) {
    const data = unwrap(mod);
    if (!data?.players) continue;
    const season = Number(data.season ?? key.match(/snap-counts-(\d{4})\.json$/)?.[1]);
    if (Number.isFinite(season)) bySeason.set(season, data);
  }

  const season = pickSnapCountSeason(bySeason.keys(), now);
  const data = season != null ? bySeason.get(season) : null;

  const byPlayerId = new Map();
  for (const [mflId, stats] of Object.entries(data?.players ?? {})) {
    byPlayerId.set(mflId, {
      snaps: stats.offenseSnaps ?? 0,
      pct: stats.offensePct ?? 0,
      games: stats.gamesPlayed ?? 0,
    });
  }

  const weeks = data?.weeksCovered ?? 0;
  const wanted = snapCountSeason(now);
  // Label every column with the season it is actually reporting. In week 2 of
  // a new season "Snaps 529" and "Snaps 41" are both plausible-looking
  // numbers; only the year tells them apart, and `weeksCovered` is what makes
  // a 58% off one game legible as a one-game sample.
  return {
    season,
    weeks,
    byPlayerId,
    has: byPlayerId.size > 0,
    seasonLabel: season != null ? `'${String(season).slice(2)}` : '',
    scopeTitle: season == null
      ? ''
      : season === wanted
        ? `${season} regular season, through week ${weeks}`
        : `${season} regular season (complete) \u2014 the ${wanted} season has no snap data yet`,
  };
}
