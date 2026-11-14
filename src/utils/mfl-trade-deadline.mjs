/**
 * The trade deadline AS MFL HAS IT, and whether that agrees with the
 * Constitution.
 *
 * MFL IS THE SOURCE OF TRUTH (Brandon, 2026-11-13). MFL is what actually
 * stops a trade, so a countdown that disagrees with it is lying to owners. Its
 * calendar carries a `TRADE` event ("trading closed") whose `start_time` is
 * the exact instant trading stops — TheLeague's 2026 event starts Fri Nov 13
 * 8:45 PM PT, the AFL's Wed Nov 18 11:45 PM PT.
 *
 * THE CONSTITUTION IS THE CROSS-CHECK. MFL's calendar is carried forward year
 * to year and drifted a week late for TheLeague in 2024–2026 without anyone
 * noticing. `tradeDeadlineIsoDate` (trade-deadline.mjs) still computes the
 * Constitution's date; `checkTradeDeadline` compares the two so a mismatch is
 * FLAGGED (admin banner + ops push) instead of silently picking a winner.
 *
 * Pure: takes the calendar events, never fetches. The pages read the feed
 * through the league-data loader; the drift check fetches it live.
 */

import { LEAGUES } from '../config/leagues-data.mjs';
import { ptDateString, tradeDeadlineIsoDate, tradeDeadlineTimeLabel } from './trade-deadline.mjs';

const PT = 'America/Los_Angeles';

/** `{ isoDate, hhmm, offset }` for an instant, read on the Pacific clock. */
function ptParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: PT,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      timeZoneName: 'longOffset',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  // "GMT-08:00" → "-08:00"
  const offset = String(parts.timeZoneName ?? 'GMT-08:00').replace('GMT', '') || '-08:00';
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${parts.hour}:${parts.minute}`,
    offset,
  };
}

/** "20:45" → "8:45 PM PT"; "00:00" → "midnight PT". */
export function ptTimeLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === 0 && m === 0) return 'midnight PT';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} PT`;
}

/** Accepts the raw export (`{calendar:{event}}`), the synced feed (an array), or a single event. */
function eventsOf(calendar) {
  if (Array.isArray(calendar)) return calendar;
  const raw = calendar?.calendar?.event;
  if (Array.isArray(raw)) return raw;
  return raw ? [raw] : [];
}

/**
 * MFL's trade cutoff for `year`, from its calendar — or null when the calendar
 * has no trading-closed event that season.
 *
 * Picks the earliest `TRADE` event starting August–December of `year` (the
 * in-season deadline). A start of 0 / '' is MFL's "unset" and is skipped; the
 * AFL's event carries an empty `end_time`, which is why only `start_time` is
 * read.
 *
 * @returns {{ epoch: number, isoDate: string, time: string, cutoffISO: string, timeLabel: string } | null}
 */
export function mflTradeCutoff(calendar, year) {
  let best = null;
  for (const e of eventsOf(calendar)) {
    if (String(e?.type ?? '').toUpperCase() !== 'TRADE') continue;
    const epoch = Number(e.start_time);
    if (!Number.isFinite(epoch) || epoch <= 0) continue;
    const { isoDate, hhmm, offset } = ptParts(new Date(epoch * 1000));
    const [y, m] = isoDate.split('-').map(Number);
    if (year != null && (y !== year || m < 8)) continue;
    if (!best || epoch < best.epoch) {
      best = { epoch, isoDate, time: hhmm, cutoffISO: `${isoDate}T${hhmm}:00${offset}`, timeLabel: ptTimeLabel(hhmm) };
    }
  }
  return best;
}

/** "2026-11-13" → "Fri, Nov 13". */
export function formatDeadlineDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Compare MFL's deadline with the Constitution's.
 *
 * status:
 *   'match'       — same day (and same time, where the Constitution names one)
 *   'mismatch'    — they disagree: FLAG IT
 *   'mfl-missing' — MFL's calendar has events but no trade deadline: FLAG IT
 *   'unknown'     — no calendar data to read (feed not synced): stay quiet
 *   'no-rule'     — the league has no deadline (best ball): stay quiet
 *
 * @returns {{ slug: string, year: number, status: string, flag: boolean,
 *   mfl: ReturnType<typeof mflTradeCutoff>, constitution: { isoDate: string, time: string | null, timeLabel: string | null } | null,
 *   message: string | null }}
 */
export function checkTradeDeadline(slug, year, calendar) {
  const constitutionDate = tradeDeadlineIsoDate(slug, year);
  const time = LEAGUES[slug]?.tradeDeadline?.time ?? null;
  const constitution = constitutionDate
    ? { isoDate: constitutionDate, time, timeLabel: time ? tradeDeadlineTimeLabel(slug) : null }
    : null;
  const base = { slug, year, constitution, mfl: null, flag: false, message: null };
  if (!constitution) return { ...base, status: 'no-rule' };

  const events = eventsOf(calendar);
  if (events.length === 0) return { ...base, status: 'unknown' };

  const mfl = mflTradeCutoff(events, year);
  const rule = `${formatDeadlineDate(constitution.isoDate)}${constitution.timeLabel ? ` at ${constitution.timeLabel}` : ''}`;
  if (!mfl) {
    return {
      ...base,
      status: 'mfl-missing',
      flag: true,
      message: `MFL's calendar has no ${year} trade deadline. The Constitution says ${rule}.`,
    };
  }

  const dateOff = mfl.isoDate !== constitution.isoDate;
  const timeOff = Boolean(constitution.time) && mfl.time !== constitution.time;
  if (!dateOff && !timeOff) return { ...base, mfl, status: 'match' };

  return {
    ...base,
    mfl,
    status: 'mismatch',
    flag: true,
    message: `MFL closes trading ${formatDeadlineDate(mfl.isoDate)} at ${mfl.timeLabel}, but the Constitution says ${rule}.`,
  };
}

/**
 * Is a flagged check worth showing / pushing right now? From 60 days before
 * the EARLIER of the two dates through the end of the LATER one — so a
 * mismatch surfaces with time to fix it and stops once both dates have passed.
 */
export function isTradeDeadlineCheckWindow(check, now = new Date(), leadDays = 60) {
  if (!check?.flag || !check.constitution) return false;
  const dates = [check.constitution.isoDate, check.mfl?.isoDate].filter(Boolean).sort();
  const [y, m, d] = dates[0].split('-').map(Number);
  const opens = new Date(Date.UTC(y, m - 1, d - leadDays));
  const opensIso = opens.toISOString().slice(0, 10);
  const today = ptDateString(now);
  return today >= opensIso && today <= dates[dates.length - 1];
}
