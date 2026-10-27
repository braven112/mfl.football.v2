/**
 * Sleeper leagues in the MFL Live store app (`?source=mfl`).
 *
 * The store build carries no ESPN data at all (docs/plans/mfl-live-store-app.md,
 * decision 10), and the web board takes each Sleeper starter's game clock from
 * the ESPN scoreboard. Sleeper sends points but no clock, so in store mode the
 * clock comes from MFL's own `nflSchedule` export instead: one league-free
 * request per poll, the same per-club `gameSecondsRemaining` MFL scores its
 * own leagues with. It does not tick between MFL updates, which is fine for
 * what Sleeper needs it for (live vs final, and players yet to play).
 *
 * SERVER-SIDE ONLY.
 */

import { canonicalNflCode } from '../espn-game-detail';

/**
 * Whether the store app shows Sleeper leagues at all.
 *
 * Sleeper's Terms of Use (updated 2026-10-06) license the service for
 * "personal and non-commercial use" and route third-party products through a
 * separate written agreement ("Approved Integration Partner", section 2.9).
 * The free closed test charges nobody; before the app charges anyone, either
 * Sleeper approves the integration or this goes to `false`. One switch, so the
 * paid build cannot ship Sleeper by accident of a second copy.
 */
export const SLEEPER_IN_STORE_APP = true;

/** A full NFL game, in seconds. Matches `secondsRemainingByTeam` in live.ts. */
const GAME_SECONDS = 3600;

const MFL_SCHEDULE_HOST = 'https://api.myfantasyleague.com';
const TIMEOUT_MS = 6000;
/** MFL refreshes its live data about once a minute; one read serves every poll inside that. */
const CACHE_MS = 30_000;

const asArray = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/**
 * MFL's `nflSchedule` week → game-seconds left per NFL club, canonical codes
 * (`GBP` → `GB`, the code the Sleeper player map uses). Pure.
 *
 * A live game is never reported as zero, which reads as final; a club with no
 * game this week is simply absent (`sleeperWeekToSnapshot` counts it finished).
 */
export function secondsRemainingFromMflSchedule(body: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const matchups = asArray((body as { nflSchedule?: { matchup?: unknown } })?.nflSchedule?.matchup);
  for (const m of matchups as Array<{ gameSecondsRemaining?: unknown; team?: unknown }>) {
    const raw = Number.parseInt(String(m?.gameSecondsRemaining ?? ''), 10);
    if (!Number.isFinite(raw)) continue;
    const seconds = Math.max(0, Math.min(raw, GAME_SECONDS));
    for (const t of asArray(m?.team) as Array<{ id?: unknown }>) {
      const code = canonicalNflCode(typeof t?.id === 'string' ? t.id : '');
      if (code) out.set(code, seconds);
    }
  }
  return out;
}

const memory = new Map<string, { at: number; clock: Map<string, number> }>();

/** Exported for tests only. */
export function clearMflClockCache(): void {
  memory.clear();
}

/**
 * This week's per-club clock from MFL, or null when it could not be read —
 * never an empty map for that, because an empty map reads every starter as
 * finished and every live Sleeper matchup as Final.
 */
export async function loadMflNflClock(
  input: { year: number; week: number },
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, number> | null> {
  const key = `${input.year}:${input.week}`;
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.clock;
  try {
    const res = await fetchImpl(
      `${MFL_SCHEDULE_HOST}/${input.year}/export?TYPE=nflSchedule&W=${input.week}&JSON=1`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) return hit?.clock ?? null;
    const clock = secondsRemainingFromMflSchedule(await res.json());
    if (clock.size === 0) return hit?.clock ?? null;
    memory.set(key, { at: Date.now(), clock });
    return clock;
  } catch {
    return hit?.clock ?? null;
  }
}
