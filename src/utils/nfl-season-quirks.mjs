/**
 * The odd corners of an NFL season — and the league waiver runs they collide with.
 *
 * WHAT COUNTS AS A QUIRK (owner's list, 2026-11-23): the season opener, every
 * Christmas Day game, and every game on a Tuesday, Wednesday or Friday. Owners
 * see them as a note on the Schedule Release page, before and after the fantasy
 * reveal, because the NFL publishes in mid-May and the leagues reveal later.
 *
 * WHY WAIVERS CARE: TheLeague and the AFL process waivers on Wednesday evening
 * (TheLeague's blind bid at 7:00 PM PT, the AFL's reverse-order run at 8:00 PM
 * PT, in 2026). A Tuesday or Wednesday game means the run lands AFTER a
 * kickoff, so players from that game can be claimed once their points are on
 * the board — the 2026 opener (Wed Sep 9), Thanksgiving week 2026 (Wed Nov 25),
 * Christmas 2024 (Wed). Moving the run is a hand edit on MFL; what can be
 * automated is not forgetting, so the daily Schedule Release job files a
 * GitHub issue for every new Tuesday or Wednesday game
 * (scripts/fetch-nfl-season-quirks.mjs).
 *
 * Every day is the PACIFIC date: a 5:20 PM PT Wednesday kickoff is Thursday in
 * UTC, and the leagues keep their waiver clock in PT.
 *
 * Pure functions only — the script does the fetching, the generated file
 * (src/data/nfl/season-quirks.mjs) and the issues.
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

/** Days of the week (Pacific) that waivers cannot safely follow: Tue, Wed. */
export const WAIVER_AFFECTING_DAYS = new Set([2, 3]);
/** Days of the week (Pacific) worth a note: Tue, Wed, Fri. */
const ODD_DAYS = { 2: 'tuesday', 3: 'wednesday', 5: 'friday' };

/**
 * Every quirk in MFL's `nflSchedule&W=ALL` payload, kickoff order.
 *
 * One entry per game; a game can carry several tags (the 2024 Christmas games
 * were `christmas` + `wednesday`).
 *
 * @param {Array<{week: string|number, matchup?: Array<{kickoff: string|number, team?: Array<{id: string, isHome?: string}>}>}>} weeks
 * @param {Record<string, {name?: string}>} [brandTeams] nfl-brand-kit `teams`, for nicknames.
 */
export function findSeasonQuirks(weeks, brandTeams = {}) {
  const games = [];
  for (const entry of Array.isArray(weeks) ? weeks : []) {
    const week = Number(entry?.week);
    if (!Number.isInteger(week)) continue;
    for (const m of [].concat(entry?.matchup ?? [])) {
      const kickoff = Number(m?.kickoff);
      if (!Number.isFinite(kickoff) || kickoff <= 0) continue;
      const facts = pacificFacts(new Date(kickoff * 1000));
      const teams = [].concat(m?.team ?? []);
      const home = teams.find((t) => t?.isHome === '1')?.id ?? teams[1]?.id ?? '?';
      const away = teams.find((t) => t?.id !== home)?.id ?? '?';
      games.push({ week, facts, away, home });
    }
  }
  games.sort((a, b) => a.facts.iso.localeCompare(b.facts.iso) || a.home.localeCompare(b.home));
  const opener = games.find((g) => g.week === 1);

  const out = [];
  for (const g of games) {
    const tags = [];
    if (g === opener) tags.push('opener');
    if (g.facts.isoDate.endsWith('-12-25')) tags.push('christmas');
    if (ODD_DAYS[g.facts.weekday]) tags.push(ODD_DAYS[g.facts.weekday]);
    if (!tags.length) continue;
    out.push({
      week: g.week,
      kickoff: g.facts.iso,
      date: g.facts.isoDate,
      label: g.facts.label,
      time: g.facts.time,
      away: g.away,
      home: g.home,
      awayName: teamNickname(g.away, brandTeams),
      homeName: teamNickname(g.home, brandTeams),
      tags,
      affectsWaivers: WAIVER_AFFECTING_DAYS.has(g.facts.weekday),
    });
  }
  return out;
}

/** Stable identity of a game — a moved kickoff is a NEW game worth a reminder. */
export const gameKey = (g) => `${g.week}|${g.away}|${g.home}|${g.kickoff}`;

/**
 * Games in `current` that `known` has never seen and that have not kicked off.
 * A past game is never worth a reminder — there is nothing left to move.
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

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The league's regular (recurring) midweek run — Tue or Wed — or null. */
export function usualMidweekRun(events) {
  const r = waiverRuns(events).find((x) => x.recurring && WAIVER_AFFECTING_DAYS.has(x.weekday));
  return r ? { day: DAY_NAMES[r.weekday], time: r.time } : null;
}

/** Does this calendar run waivers on a Tuesday or Wednesday as a rule? */
export function runsWaiversMidweek(events) {
  return usualMidweekRun(events) != null;
}

const addDays = (isoDate, n) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/**
 * What a league's calendar says about one Tuesday or Wednesday game.
 *
 * The window is the game's day through that week's Wednesday — a run on the
 * game day or the day after a Tuesday game processes once that game has
 * kicked off.
 *
 *   'conflict'  a run falls in the window, on `day` at `time` — move it.
 *   'moved'     the calendar covers that week and has no run in the window.
 *   'usual'     the calendar does not reach that date yet (a schedule released
 *               in May, before the league's new calendar is set), so the
 *               league's usual midweek slot is the best guess — move it.
 */
export function waiverStatusOn(events, isoDate) {
  const runs = waiverRuns(events);
  const [y, m, d] = isoDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const windowEnd = addDays(isoDate, Math.max(0, 3 - weekday));
  const hit = runs
    .filter((r) => r.date >= isoDate && r.date <= windowEnd)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (hit) return { status: 'conflict', day: DAY_NAMES[hit.weekday], time: hit.time };
  const last = runs.map((r) => r.date).sort().pop();
  if (last && last >= windowEnd) return { status: 'moved', day: null, time: null };
  const usual = usualMidweekRun(events);
  return { status: 'usual', day: usual?.day ?? null, time: usual?.time ?? null };
}
