/**
 * NFL games played on a Wednesday — and the league waiver runs they collide with.
 *
 * WHY THIS EXISTS: TheLeague and the AFL process waivers on Wednesday evening
 * (TheLeague's blind bid at 7:00 PM PT, the AFL's reverse-order run at 8:00 PM
 * PT, in 2026). The NFL almost never plays on a Wednesday, so that slot is
 * normally safe: the week's games have not started. When it does — the 2026
 * opener (Wed Sep 9), Thanksgiving week 2026 (Wed Nov 25), Christmas 2024 —
 * the waiver run lands AFTER a kickoff, and players from that game can be
 * claimed once their points are already on the board.
 *
 * The fix is a hand edit on MFL's calendar (the owner moves that week's run),
 * which nothing here can do. What can be automated is NOT FORGETTING: the
 * schedule-release job runs this the day the NFL publishes its schedule and
 * pushes the league's admins one reminder per new Wednesday game.
 *
 * Pure functions only — the script (scripts/check-nfl-wednesday-games.mjs)
 * does the fetching, the state file and the push.
 */

import { ptParts } from './nfl-week-starts.mjs';

/** MFL calendar event types that actually PROCESS claims (see waiver-window.ts RUN_TYPES). */
export const WAIVER_RUN_TYPES = new Set(['WAIVER_BBID', 'WAIVER_REVERSE']);

/** MFL's NFL team codes that differ from the brand kit's. */
const MFL_TO_BRAND = {
  GBP: 'GB', KCC: 'KC', JAC: 'JAX', LVR: 'LV', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB', WAS: 'WSH',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

/** Pacific calendar facts for an instant: ISO date, weekday index, "5:00 PM". */
export function pacificFacts(instant) {
  const { year, month, day, hour, minute, offset } = ptParts(instant);
  const isoDate = `${year}-${pad(month)}-${pad(day)}`;
  // Weekday of a calendar date, independent of the host's zone.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const time = `${h12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
  return {
    isoDate,
    weekday,
    time,
    iso: `${isoDate}T${pad(hour)}:${pad(minute)}:00${offset}`,
    label: `${WEEKDAYS[weekday]} ${MONTHS[month - 1]} ${day}`,
  };
}

/**
 * Every Wednesday (Pacific) game in MFL's `nflSchedule&W=ALL` payload.
 *
 * Pacific, not UTC, on purpose: a 5:20 PM PT Wednesday kickoff is Thursday in
 * UTC, and a Tuesday-night game would read as Wednesday. The league keeps its
 * waiver clock in PT, so that is the only day that matters.
 *
 * @param {Array<{week: string|number, matchup?: Array<{kickoff: string|number, team?: Array<{id: string, isHome?: string}>}>}>} weeks
 * @returns {Array<{week: number, kickoff: string, date: string, label: string, time: string, away: string, home: string}>}
 */
export function findWednesdayGames(weeks) {
  const out = [];
  for (const entry of Array.isArray(weeks) ? weeks : []) {
    const week = Number(entry?.week);
    if (!Number.isInteger(week)) continue;
    for (const m of [].concat(entry?.matchup ?? [])) {
      const kickoff = Number(m?.kickoff);
      if (!Number.isFinite(kickoff) || kickoff <= 0) continue;
      const facts = pacificFacts(new Date(kickoff * 1000));
      if (facts.weekday !== 3) continue;
      const teams = [].concat(m?.team ?? []);
      const home = teams.find((t) => t?.isHome === '1')?.id ?? teams[1]?.id ?? '?';
      const away = teams.find((t) => t?.id !== home)?.id ?? '?';
      out.push({ week, kickoff: facts.iso, date: facts.isoDate, label: facts.label, time: facts.time, away, home });
    }
  }
  return out.sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.home.localeCompare(b.home));
}

/** Stable identity of a game — a moved kickoff is a NEW game worth a reminder. */
export const gameKey = (g) => `${g.week}|${g.away}|${g.home}|${g.kickoff}`;

/**
 * Games in `current` that `known` has never seen and that have not kicked off.
 * A past game is never worth a push — there is nothing left to move.
 */
export function newUpcomingGames(known, current, now = new Date()) {
  const seen = new Set((known ?? []).map(gameKey));
  return (current ?? []).filter((g) => !seen.has(gameKey(g)) && Date.parse(g.kickoff) > now.getTime());
}

/** "Packers" for GBP, falling back to the code itself. */
export function teamNickname(mflCode, brandTeams = {}) {
  const name = brandTeams?.[MFL_TO_BRAND[mflCode] ?? mflCode]?.name;
  return typeof name === 'string' && name.trim() ? name.trim().split(/\s+/).pop() : mflCode;
}

/**
 * Every claim-processing run a league's MFL calendar holds, expanded through
 * its weekly `happens` repeats, as Pacific facts.
 *
 * A repeat keeps its WALL-CLOCK time across DST (that is how MFL schedules it),
 * so the date steps by seven days and the time is the first run's time.
 */
export function waiverRuns(events) {
  const runs = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!WAIVER_RUN_TYPES.has(e?.type)) continue;
    const start = Number(e.start_time);
    if (!Number.isFinite(start) || start <= 0) continue;
    const first = pacificFacts(new Date(start * 1000));
    const repeats = Math.max(0, Math.min(Number(e.happens) || 0, 30));
    for (let i = 0; i <= repeats; i += 1) {
      const [y, m, d] = first.isoDate.split('-').map(Number);
      const date = new Date(Date.UTC(y, m - 1, d + i * 7));
      const isoDate = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
      runs.push({ type: e.type, date: isoDate, weekday: date.getUTCDay(), time: first.time, recurring: repeats > 0 });
    }
  }
  return runs;
}

/** Does this calendar's regular (recurring) waiver run fall on a Wednesday? */
export function runsWaiversOnWednesday(events) {
  return waiverRuns(events).some((r) => r.recurring && r.weekday === 3);
}

/** The time of the league's usual Wednesday run, e.g. "7:00 PM", or null. */
export function usualWednesdayRunTime(events) {
  return waiverRuns(events).find((r) => r.recurring && r.weekday === 3)?.time ?? null;
}

/**
 * What a league's calendar says about one Wednesday game's date.
 *
 *   'conflict'  a run is scheduled that day, at `time` — move it.
 *   'moved'     the calendar covers that week and has no run that day.
 *   'usual'     the calendar does not reach that date yet (a schedule released
 *               in May, before the league's new calendar is set), so the
 *               league's usual Wednesday slot is the best guess — move it.
 */
export function waiverStatusOn(events, isoDate) {
  const runs = waiverRuns(events);
  const sameDay = runs.find((r) => r.date === isoDate);
  if (sameDay) return { status: 'conflict', time: sameDay.time };
  const last = runs.map((r) => r.date).sort().pop();
  if (last && last >= isoDate) return { status: 'moved', time: null };
  return { status: 'usual', time: usualWednesdayRunTime(events) };
}
