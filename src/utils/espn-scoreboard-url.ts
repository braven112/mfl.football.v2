/**
 * ESPN scoreboard URL builder — one place that knows how ESPN numbers weeks.
 *
 * ESPN does NOT continue the regular-season week count into January: the
 * playoffs are `seasontype=3` with `week=1..4`, not weeks 19-22. Getting that
 * wrong returns a 200 with an empty or wrong slate, which reads as "no games"
 * rather than as a bug — so the rule lives here and every caller shares it.
 */

const SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/** How ESPN addresses a given league week. */
export interface EspnSeasonSlot {
  /**
   * 1 = preseason, 2 = regular season, 3 = postseason.
   *
   * `espnSeasonSlot` only ever produces 2 or 3 — the board has no reason to
   * show preseason games, since no fantasy week maps to one. 1 is reachable
   * ONLY through the validation override below, which is the whole point of
   * it: it is the only way to put a game that is actually being played in
   * front of the in-progress code paths outside of September through January.
   */
  seasonType: 1 | 2 | 3;
  /** ESPN's own week number within that season type. */
  week: number;
}

/** The last week of the NFL regular season (17 games + 1 bye across 18 weeks). */
export const LAST_REGULAR_SEASON_WEEK = 18;

export function espnSeasonSlot(leagueWeek: number): EspnSeasonSlot {
  const week = Number.isFinite(leagueWeek) && leagueWeek > 0 ? Math.floor(leagueWeek) : 1;
  if (week > LAST_REGULAR_SEASON_WEEK) {
    return { seasonType: 3, week: week - LAST_REGULAR_SEASON_WEEK };
  }
  return { seasonType: 2, week };
}

export function buildEspnScoreboardUrl(slot: EspnSeasonSlot, year: number): string {
  return `${SCOREBOARD_BASE}?week=${slot.week}&seasontype=${slot.seasonType}&dates=${year}`;
}

// ── validation override ────────────────────────────────────────────────────

/**
 * Query params that point the ESPN routes at an arbitrary slate.
 *
 * WHY THIS EXISTS. The board can only ever ask ESPN for the regular season or
 * the playoffs (`espnSeasonSlot` emits seasonType 2 or 3, never 1), and `year`
 * comes from `getCurrentSeasonYear()`, which does not roll until Labor Day. So
 * between February and kickoff there is no URL the page can construct that
 * reaches a game actually being played — which means the in-progress paths
 * (live clock, red zone, down & distance, possession) cannot be exercised on
 * the real page for six months of the calendar. They are also the only paths
 * a fixture cannot fully vouch for, since ESPN populates `situation` only
 * while a game is live.
 *
 * These params close that gap: point the NFL half of the board at a preseason
 * slate and watch the real thing, while the fantasy half stays on whatever
 * week it was already showing.
 *
 * They are a VALIDATION AFFORDANCE, not a feature. Two consequences:
 *  - Every value is whitelisted before it reaches an upstream URL, same as
 *    `week` and `year` already are. These are interpolated into a fetch.
 *  - When one is active the response says so (`espnSlot.overridden`), and the
 *    island badges the board. A URL with these params is shareable, and a
 *    board silently showing a different week's NFL games than its own header
 *    claims would be worse than not having this at all.
 */
export const ESPN_OVERRIDE_PARAMS = ['espnSeason', 'espnWeek', 'espnYear'] as const;

/** What the routes actually asked ESPN for, echoed back to the client. */
export interface EspnSlotResolution {
  slot: EspnSeasonSlot;
  year: number;
  /** True when any override param changed the target. */
  overridden: boolean;
}

const SEASON_TYPES = new Set([1, 2, 3]);

/**
 * Digits-only, then parse. `parseInt` is far too permissive on its own —
 * `parseInt('2x')` is 2 and `parseInt('1;DROP')` is 1, so a lax reading here
 * quietly ACCEPTS junk and reports it as a deliberate override. The value
 * cannot reach the upstream URL either way (we re-emit the parsed number), but
 * an override that silently activates on a typo is its own bug: the board
 * would show another slate's games and the badge would insist that was asked
 * for.
 */
function strictInt(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Resolve which ESPN slate to fetch, honoring the override params when present
 * and valid. An invalid value is IGNORED rather than rejected — this is a
 * debugging aid, and failing a live scoring request because someone fat-fingered
 * a validation param would be a worse outcome than showing the normal week.
 */
export function resolveEspnTarget(
  params: URLSearchParams,
  leagueWeek: number,
  defaultYear: number,
): EspnSlotResolution {
  const base = espnSeasonSlot(leagueWeek);
  let { seasonType, week } = base;
  let year = defaultYear;
  let overridden = false;

  const rawSeason = strictInt(params.get('espnSeason'));
  if (rawSeason !== null && SEASON_TYPES.has(rawSeason)) {
    seasonType = rawSeason as 1 | 2 | 3;
    overridden = true;
  }

  const rawWeek = strictInt(params.get('espnWeek'));
  if (rawWeek !== null && rawWeek >= 1 && rawWeek <= 25) {
    week = rawWeek;
    overridden = true;
  }

  const rawYear = strictInt(params.get('espnYear'));
  if (rawYear !== null && rawYear >= 2000 && rawYear <= 2100) {
    year = rawYear;
    overridden = true;
  }

  return { slot: { seasonType, week }, year, overridden };
}

/**
 * Copy any override params from one query string to another.
 *
 * The pollers run in the browser and build their own request URLs, so without
 * this the override would apply to the server-rendered load and then silently
 * vanish on the first poll — the board would flip back to the normal slate a
 * minute later, which is exactly the kind of thing that wastes an evening.
 */
/**
 * Stable signature of whichever override params a query string carries — the
 * empty string when it carries none.
 *
 * This exists to go in a CACHE KEY. The shared pollers keyed only on
 * `year:week` while reading the overrides straight off `window.location` at
 * fetch time, so the key did not describe what had actually been fetched. With
 * `ClientRouter` on (TheLeagueLayout), a soft navigation between an overridden
 * URL and a plain one keeps the module — and therefore the store — alive, and
 * `subscribe` only forces an immediate load when the entry is idle or a failed
 * empty. An entry sitting there `ok` is reused as-is, so the board would show
 * the preseason slate on a page that asked for the live one until the next
 * timer tick, up to five minutes later.
 *
 * Order is fixed by ESPN_OVERRIDE_PARAMS rather than by the order the user
 * happened to type them, so two spellings of the same target share one entry
 * instead of double-polling.
 */
export function espnOverrideKey(search: string | URLSearchParams): string {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const out = new URLSearchParams();
  copyEspnOverrides(params, out);
  return out.toString();
}

export function copyEspnOverrides(from: URLSearchParams, to: URLSearchParams): void {
  for (const key of ESPN_OVERRIDE_PARAMS) {
    const value = from.get(key);
    if (value !== null) to.set(key, value);
  }
}
