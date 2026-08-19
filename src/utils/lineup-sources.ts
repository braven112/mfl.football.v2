/**
 * Lineup page data sources — reading a submitted lineup, and surviving a
 * failed MFL call.
 *
 * Two bugs on /theleague/lineup and /afl-fantasy/lineup motivated this
 * module, both worst on FUTURE weeks:
 *
 * 1. Both pages read the owner's saved lineup with
 *    `export?TYPE=myStarters`. `myStarters` is an IMPORT type, not an
 *    export one — MFL answers every such request with
 *    "Invalid Data Type (myStarters)". The parse then swallowed the error
 *    ("starters unavailable — slots will be empty"), so the pages NEVER
 *    showed a submitted lineup for any week; they silently rendered an
 *    optimal-by-projection fill instead. On a future week that reads as
 *    "the lineup I saved is gone".
 *
 *    `export?TYPE=weeklyResults&W=<week>` is the readable counterpart: it
 *    carries each franchise's `starters` CSV (plus a `player[]` array with
 *    `status: 'starter'`) as soon as a lineup is submitted, for future
 *    weeks as well as played ones.
 *
 * 2. Every page view fires ~9 live MFL calls. When one is throttled or
 *    times out the page degraded silently and differently depending on
 *    WHICH call died — a dead `rosters` call emptied every slot, a dead
 *    `players` call rendered "Player 13592" where a name belongs. The
 *    on-disk feed (synced every 5 minutes) is the floor under the roster
 *    call; player identity already has one in `getPlayerMap`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';

/** One player in a franchise's submitted lineup for a week. */
export interface LineupStarter {
  id: string;
  /**
   * Actual fantasy points, or null when MFL reported none for this player.
   * NOT zero: a starter present only in the `starters` CSV has no score yet,
   * and a literal 0 defeats a `?? playerScoresMap` fallback downstream —
   * turning "not reported" into "scored nothing".
   */
  score: number | null;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/**
 * Pull the entry for `week` out of a weeklyResults payload.
 *
 * Handles both shapes MFL returns:
 *  - `W=YTD`  → `{ allWeeklyResults: { weeklyResults: [ { week: '1', … }, … ] } }`
 *  - `W=<n>`  → `{ weeklyResults: { week: '12', matchup: [ … ] } }`
 *
 * `allowUnlabeled` is opt-in and belongs ONLY to a week-scoped fetch, where
 * the request itself identifies the week. Every live `W=<n>` response we have
 * checked does carry `week` — an early reading that said otherwise was a
 * truncated dump of a payload whose key order happened to put `week` last
 * (MFL's JSON key order is nondeterministic, the same trait that makes byte
 * diffs useless on these feeds). So this is a belt-and-braces path, not a
 * workaround for observed behavior. It must never be enabled for the YTD
 * payload: a season that has produced exactly one entry would then answer a
 * lookup for ANY week with that one week's lineups.
 */
export function findWeekResultsEntry(
  payload: any,
  week: number,
  opts: { allowUnlabeled?: boolean } = {},
): any | null {
  if (!payload) return null;
  const unwrapped = payload?.allWeeklyResults ?? payload;

  const entries = Array.isArray(unwrapped)
    ? unwrapped
    : asArray(unwrapped?.weeklyResults);

  const normalized = entries
    .map((item: any) => item?.weeklyResults ?? item)
    .filter(Boolean);

  const matched = normalized.find((wr: any) => parseInt(wr?.week, 10) === week);
  if (matched) return matched;

  if (opts.allowUnlabeled && normalized.length === 1
      && normalized[0]?.week === undefined && normalized[0]?.matchup) {
    return normalized[0];
  }
  return null;
}

/**
 * Every franchise row in a week's results, from BOTH shapes MFL uses.
 *
 * Rows normally hang off `matchup[].franchise[]`, but a franchise with no
 * opponent is listed directly on the week — playoff byes, odd-sized brackets,
 * and (right now) every team in weeks 15-17 of both leagues, where MFL has
 * published the weeks with no `matchup` key at all. Walking only the matchups
 * therefore loses real lineups AND reports a franchise as unlisted, which
 * this module treats as "cannot confirm" — so it would have shown every owner
 * the overwrite warning on playoff weeks and refused to let them set a
 * lineup. `scripts/lib/lineup-warnings.mjs#parseStartingLineups` has handled
 * both shapes all along.
 */
function weekFranchiseRows(weekEntry: any): any[] {
  if (!weekEntry) return [];
  const rows: any[] = [];
  for (const matchup of asArray<any>(weekEntry.matchup)) {
    rows.push(...asArray<any>(matchup?.franchise));
  }
  rows.push(...asArray<any>(weekEntry.franchise));
  return rows;
}

/**
 * The lineup a franchise has submitted for the week the entry describes,
 * in MFL's own order. Empty when no lineup is set (or the entry is missing).
 *
 * Reads BOTH channels MFL populates, because they are not redundant: the
 * `starters` CSV is present the moment a lineup is saved, while the
 * `player[]` rows carry the scores and can lag on an unplayed week.
 */
export function extractLineupStarters(weekEntry: any, franchiseId: string): LineupStarter[] {
  if (!weekEntry || !franchiseId) return [];

  for (const side of weekFranchiseRows(weekEntry)) {
    if (side?.id !== franchiseId) continue;

    const scoreById = new Map<string, number>();
    const startersFromRows: string[] = [];
    for (const p of asArray<any>(side.player)) {
      if (!p?.id || p.status !== 'starter') continue;
      startersFromRows.push(p.id);
      scoreById.set(p.id, parseFloat(p.score) || 0);
    }

    const csvIds = typeof side.starters === 'string'
      ? side.starters.split(',').map((id: string) => id.trim()).filter(Boolean)
      : [];

    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const id of [...csvIds, ...startersFromRows]) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }

    return ordered.map((id) => ({ id, score: scoreById.has(id) ? scoreById.get(id)! : null }));
  }

  return [];
}

/**
 * The weeklyResults feed committed under `data/<league>/mfl-feeds/<year>/`.
 * An ARRAY of per-week MFL payloads, which `findWeekResultsEntry` already
 * reads — but see `resolveWeekLineup` for the one-way rule that governs it.
 */
const weeklyResultsFeedCache = new Map<string, any | null>();

export function loadWeeklyResultsFeedFromDisk(slug: CanonicalLeagueSlug, leagueYear: number): any | null {
  const league = getLeagueBySlug(slug);
  if (!league) return null;
  // Memoized like getPlayerMap: parsing it per request is wasted work on a
  // page that already SSRs nine MFL calls.
  const cacheKey = `${slug}:${leagueYear}`;
  if (weeklyResultsFeedCache.has(cacheKey)) return weeklyResultsFeedCache.get(cacheKey) ?? null;
  try {
    const filePath = path.join(process.cwd(), league.dataPath, 'mfl-feeds', String(leagueYear), 'weekly-results-raw.json');
    const parsed = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
    weeklyResultsFeedCache.set(cacheKey, parsed);
    return parsed;
  } catch {
    weeklyResultsFeedCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Is this franchise listed in the week's matchups at all?
 *
 * Absence is not "no lineup" — MFL omits unscheduled franchises entirely
 * (playoff byes, odd-sized brackets: TheLeague 2025 wk15 lists 14 of 16,
 * the AFL wk17 lists 18 of 24). Reading that omission as an empty lineup
 * hands the owner a projection fill with the submit button armed.
 */
export function franchiseAppearsIn(weekEntry: any, franchiseId: string): boolean {
  if (!weekEntry || !franchiseId) return false;
  return weekFranchiseRows(weekEntry).some((f: any) => f?.id === franchiseId);
}

/** Does this payload carry ANY week? Distinguishes "MFL answered, but that
 *  week doesn't exist" (weeks 18-22 of a 17-week season) from a failed read. */
export function payloadCarriesAnyWeek(payload: any): boolean {
  if (!payload) return false;
  const unwrapped = payload?.allWeeklyResults ?? payload;
  const entries = Array.isArray(unwrapped) ? unwrapped : asArray(unwrapped?.weeklyResults);
  return entries.map((i: any) => i?.weeklyResults ?? i).some((e: any) => e?.matchup || e?.franchise);
}

export interface ResolvedWeekLineup {
  /** The week's results entry, from whichever source answered. */
  entry: any | null;
  /** The franchise's submitted starters, in MFL's order. */
  starters: LineupStarter[];
  /** Did we establish what MFL holds — including "it holds nothing"? */
  lineupReadOk: boolean;
  /** True when the starters came from the committed feed, not from MFL. */
  fromCache: boolean;
  /** False when MFL answered but carries no such week (e.g. week 20 of 17). */
  weekScheduled: boolean;
}

/**
 * Resolve a franchise's lineup for one week across all three sources.
 *
 * Two rules, both about what counts as evidence:
 *
 * **Positive evidence wins between the live sources.** The week-scoped and
 * YTD payloads describe the same fact, so a source that names starters is
 * more informative than one that doesn't. Ordering them by whether an ENTRY
 * exists instead would let a week-scoped payload that carries the week but
 * not this franchise's lineup short-circuit a YTD payload that has it —
 * landing on "nothing on file" with the submit button armed.
 *
 * **The committed feed can confirm a lineup but never deny one.** It is
 * refreshed once a day, so a lineup saved this morning is simply not in it.
 * Reading its silence as "no lineup on file" would arm that same button over
 * a projection fill — the exact overwrite the read-failed state exists to
 * prevent, wearing a fresher-looking source. Its positive answer is also only
 * *a* lineup, not provably the current one, so it is flagged `fromCache` and
 * the page says so rather than claiming a clean "Lineup Saved".
 */
export function resolveWeekLineup(input: {
  weekScopedPayload: any;
  ytdPayload: any;
  week: number;
  franchiseId: string;
  league: CanonicalLeagueSlug;
  leagueYear: number;
}): ResolvedWeekLineup {
  const { weekScopedPayload, ytdPayload, week, franchiseId, league, leagueYear } = input;

  // `allowUnlabeled` only on the week-scoped payload — see above.
  const weekScoped = findWeekResultsEntry(weekScopedPayload, week, { allowUnlabeled: true });
  const ytd = findWeekResultsEntry(ytdPayload, week);

  const liveCandidates = [weekScoped, ytd].filter(Boolean);
  for (const entry of liveCandidates) {
    const starters = extractLineupStarters(entry, franchiseId);
    if (starters.length > 0) {
      return { entry, starters, lineupReadOk: true, fromCache: false, weekScheduled: true };
    }
  }

  // A negative live answer only counts if the franchise is IN the week. An
  // owner MFL never listed that week has no lineup recorded there, and no
  // absence to report.
  const listedLive = liveCandidates.find((entry) => franchiseAppearsIn(entry, franchiseId));
  if (listedLive) {
    return { entry: listedLive, starters: [], lineupReadOk: true, fromCache: false, weekScheduled: true };
  }

  const diskFeed = loadWeeklyResultsFeedFromDisk(league, leagueYear);
  const diskEntry = findWeekResultsEntry(diskFeed, week);
  const diskStarters = extractLineupStarters(diskEntry, franchiseId);
  if (diskStarters.length > 0) {
    return { entry: diskEntry, starters: diskStarters, lineupReadOk: true, fromCache: true, weekScheduled: true };
  }

  // "MFL answered and has no such week" is not a failed read — it's a week
  // the season doesn't contain. The selector offers 1-22; MFL's schedule
  // holds 17, so the alarming read-failed copy would be permanent there.
  const anySourceHasWeeks = [weekScopedPayload, ytdPayload, diskFeed].some(payloadCarriesAnyWeek);
  const weekScheduled = liveCandidates.length > 0 || diskEntry !== null || !anySourceHasWeeks;

  // Nothing usable, and disk can't vouch for absence. Hand back the disk entry
  // anyway when there is one — it still carries the OPPONENT's recorded
  // starters, which the faceoff reads — but say the read failed.
  return {
    entry: diskEntry ?? liveCandidates[0] ?? null,
    starters: [],
    lineupReadOk: false,
    fromCache: false,
    weekScheduled,
  };
}

/**
 * The rosters feed committed under `data/<league>/mfl-feeds/<year>/` — the
 * fallback when the live `TYPE=rosters` call fails. Synced every 5 minutes,
 * so it is at worst minutes stale; an empty lineup page is worse.
 * Returns the raw MFL payload so callers parse one shape either way.
 */
export function loadRostersFeedFromDisk(slug: CanonicalLeagueSlug, leagueYear: number): any | null {
  const league = getLeagueBySlug(slug);
  if (!league) return null;
  try {
    const filePath = path.join(process.cwd(), league.dataPath, 'mfl-feeds', String(leagueYear), 'rosters.json');
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return hasFranchises(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The live rosters payload when it carries franchises, else the on-disk
 * feed. `rostersRes.ok` is not enough of a check: MFL answers a throttled
 * or malformed request with HTTP 200 and an `{ error: … }` body.
 */
export function resolveRostersPayload(
  livePayload: any,
  slug: CanonicalLeagueSlug,
  leagueYear: number,
): any | null {
  if (hasFranchises(livePayload)) return livePayload;
  return loadRostersFeedFromDisk(slug, leagueYear);
}

/**
 * Does a rosters payload actually carry franchises? `payload.rosters.franchise`
 * being merely TRUTHY is not the same question — an empty array passes that
 * and then renders every starter slot as "Tap to set", which is the exact
 * symptom the disk fallback exists to prevent.
 */
function hasFranchises(payload: any): boolean {
  const franchises = payload?.rosters?.franchise;
  if (Array.isArray(franchises)) return franchises.length > 0;
  return Boolean(franchises?.id);
}

/** What the nine rendered slots actually represent for this week. */
export type LineupFillMode =
  /** MFL holds a lineup and these are it. */
  | 'saved'
  /** Nothing on file, week still open — the fill is an offer to save. */
  | 'unsaved-offer'
  /** We could not read the record; the fill must not be submittable. */
  | 'read-failed'
  /** Week already played with no lineup ever set — read-only view. */
  | 'past-unset'
  /** A lineup, but from the daily feed — possibly not today's edit. */
  | 'saved-from-cache'
  /** A lineup, but some of its players are no longer on the roster. */
  | 'saved-partial'
  /** MFL has no such week this season — nothing to submit, ever. */
  | 'week-unscheduled';

export interface LineupFillState {
  mode: LineupFillMode;
  /** May the page offer to submit the untouched auto-fill? */
  canSubmitUnsaved: boolean;
  /** May the owner submit at all, even after deliberately editing slots? */
  canSubmitEdits: boolean;
  /** Is the fill ordered by projection, or just roster order? */
  fillIsProjected: boolean;
}

/**
 * Decide what the slots mean, from the three facts the page knows.
 *
 * The load-bearing distinction is between "no lineup on file" and "we could
 * not find out": both produce zero starters, and treating the second as the
 * first arms a submit button over a projection fill — one tap then overwrites
 * a lineup the owner really had set. A failed read is the ONE case where
 * doing nothing is strictly better than helping.
 */
export function resolveLineupFillState(input: {
  hasStarters: boolean;
  lineupReadOk: boolean;
  weekIsPast: boolean;
  hasProjections: boolean;
  /** Do all nine slots currently hold a player? MFL rejects a partial lineup. */
  slotsFilled: boolean;
  /** Did the starters come from the committed feed rather than from MFL? */
  fromCache?: boolean;
  /** False when MFL carries no such week (weeks past the season's last). */
  weekScheduled?: boolean;
}): LineupFillState {
  const { hasStarters, lineupReadOk, weekIsPast, hasProjections, slotsFilled, fromCache } = input;
  const weekScheduled = input.weekScheduled ?? true;
  const fillIsProjected = hasProjections;

  // Order matters: a failed read outranks everything except starters we can
  // actually see, because every other branch would act on absent evidence.
  if (hasStarters) {
    // A recorded starter who has since been dropped can't be rendered, so
    // the slots come up short under a "Lineup Saved" button with nothing
    // explaining the gap.
    const mode: LineupFillMode = fromCache
      ? 'saved-from-cache'
      : slotsFilled ? 'saved' : 'saved-partial';
    // A cached lineup is up to a day stale, so it gets a banner — but it is
    // still a lineup the owner really set, not the projection guess a failed
    // read produces. Blocking edits here would strand them mid-outage with no
    // way to clear the condition (the outage is on MFL's EXPORT; submitting
    // goes to its import endpoint, which is independent), so the untouched
    // fill is never auto-offered but a deliberate edit may still be sent.
    const canSubmitEdits = !weekIsPast && weekScheduled;
    return { mode, canSubmitUnsaved: false, canSubmitEdits, fillIsProjected };
  }
  if (!weekScheduled) {
    return { mode: 'week-unscheduled', canSubmitUnsaved: false, canSubmitEdits: false, fillIsProjected };
  }
  // A failed read blocks EDITED submits too, not just the untouched fill:
  // the owner would be editing a projection they believe is their lineup, so
  // one swap plus submit replaces the eight slots they never chose.
  if (!lineupReadOk) return { mode: 'read-failed', canSubmitUnsaved: false, canSubmitEdits: false, fillIsProjected };
  if (weekIsPast) return { mode: 'past-unset', canSubmitUnsaved: false, canSubmitEdits: false, fillIsProjected };
  // Still an offer even when the fill is short a slot (a thin roster, a
  // league mid-draft) — the banner should say so. It just isn't submittable
  // until the owner completes it, and the server-rendered button has to
  // agree with that before hydration, not only after.
  // Without projections the "fill" is whatever order MFL listed the roster
  // in, so offering to save it one-tap contradicts the banner telling them to
  // set it themselves. They can still edit and submit.
  return {
    mode: 'unsaved-offer',
    canSubmitUnsaved: slotsFilled && hasProjections,
    canSubmitEdits: true,
    fillIsProjected,
  };
}

/**
 * A player's display name, preferring the identity synced to disk.
 *
 * Order is load-bearing, not cosmetic. The live `TYPE=players` response is
 * the one that disappears under throttling, and when it did the page printed
 * `Player 13592` at an owner — while `getPlayerMap`, reading the same feed
 * from disk, had the name all along. The MFL id is the last resort it was
 * always meant to be.
 */
export function resolvePlayerName(
  identity: { name?: string } | null | undefined,
  livePlayer: { name?: string } | null | undefined,
  mflId: string,
): string {
  return identity?.name || livePlayer?.name || `Player ${mflId}`;
}
