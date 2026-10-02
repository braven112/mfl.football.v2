/**
 * MFL's calendar, read live — the source of "which waiver window is open now".
 *
 * The committed `data/<league>/mfl-feeds/<year>/calendar.json` is only as fresh
 * as the last sync commit, and GitHub drops this repo's scheduled runs in bulk
 * (see docs/claude/rules/storage-and-build.md). A Free Agents page that read
 * only that file could show the WAIVER window's state after MFL had flipped to
 * FCFS, or the reverse — while `POST /api/waiver-claim`, which reads live,
 * decided the claim correctly. Since the window also gates whether MFL's
 * `locked` flag means anything (`fetchDropLocks`), a stale window put lock
 * icons on the page that the route would never honour, or hid them when it
 * would. So the pages ask MFL first and fall back to the committed feed.
 *
 * mflFetch, NOT fetch: the calendar export is owner-gated and undici drops the
 * Cookie on MFL's api → www## redirect, so a bare fetch reads back "API
 * requires a logged in user", which parses as an empty calendar → 'unknown'.
 */
import { mflFetch } from './mfl-fetch';
import type { MflCalendarEvent } from './waiver-window';

// The calendar is the same for every owner in a league and moves a few times a
// season, so one read per league per warm instance per minute is plenty.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; events: MflCalendarEvent[] }>();

/**
 * Read MFL's calendar events for a league. Returns null — NOT an empty array —
 * when the read did not produce a usable calendar, so the caller can tell "MFL
 * says there are no waiver events" from "we could not ask", and fall back to the
 * committed feed only in the second case. Only a usable read is cached.
 */
export async function readLiveWaiverEvents(
  year: number | string,
  leagueId: string,
  mflUserCookie: string,
): Promise<MflCalendarEvent[] | null> {
  const key = `${leagueId}:${year}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.events;
  try {
    const res = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/export?TYPE=calendar&L=${leagueId}&JSON=1&_=${Date.now()}`,
      method: 'GET',
      mflUserCookie,
    });
    const body = await res.json().catch(() => null);
    const raw = body?.calendar?.event;
    if (!raw) return null;
    const events: MflCalendarEvent[] = Array.isArray(raw) ? raw : [raw];
    cache.set(key, { at: Date.now(), events });
    return events;
  } catch {
    return null;
  }
}

/**
 * Live events when the viewer can read them, else the committed feed.
 *
 * `mflUserCookie` is the signed-in viewer's own MFL cookie, and only when their
 * session belongs to THIS league (`franchiseIdForLeague` non-null) — a signed-out
 * visitor cannot claim, so the committed feed is enough for them.
 */
export async function waiverEventsLiveFirst(
  year: number | string,
  leagueId: string,
  mflUserCookie: string | null | undefined,
  committed: MflCalendarEvent[],
): Promise<MflCalendarEvent[]> {
  if (!mflUserCookie) return committed;
  return (await readLiveWaiverEvents(year, leagueId, mflUserCookie)) ?? committed;
}

/** Test seam: forget cached calendars. */
export function _resetLiveWaiverCalendarCache(): void {
  cache.clear();
}
