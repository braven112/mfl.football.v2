/**
 * Is trading OPEN in this league right now? And is this pending offer still a
 * real, live offer?
 *
 * Two questions Schefter's trade lanes must answer before writing a word, both
 * learned from one post (TheLeague, Sat 2026-11-14, 8:06 AM PT): "Four trade
 * offers are circling, and The Dream are at the center of the McCaffrey
 * chatter… More to come." It went out eleven hours after MFL closed trading
 * for the season, linked to the Trade Builder, and leaned on proposals built
 * around a player who had been traded four days earlier.
 *
 * TRADING WINDOW. MFL IS THE SOURCE OF TRUTH for the deadline (Brandon,
 * 2026-11-13): its calendar's `TRADE` event starts at the instant trading
 * closes and — where MFL fills it — ends when trading reopens (TheLeague 2026:
 * closes Fri Nov 13 8:45 PM PT, reopens Jan 3). Only when the calendar has no
 * deadline does the Constitution formula (`tradeDeadlineCutoffISO`) stand in.
 * With no reopen time, trading stays closed until the league year rolls over,
 * because the deadline being read belongs to that league year.
 *
 * DEAD OFFERS. A pending proposal is dead the moment any player in it changes
 * hands — MFL cannot execute it — even though owner self-reports keep it in
 * view. Two signals, both read off data we already hold:
 *   - a player in it is now rostered by a franchise that is NOT in the deal;
 *   - a player in it moved in a completed trade AFTER the proposal was made.
 * The second catches the case the first cannot: the deal's own partner just
 * acquired the player in a different trade.
 *
 * Pure: takes the calendar, rosters and trades; never fetches.
 */

import { mflTradeCutoff } from '../../src/utils/mfl-trade-deadline.mjs';
import { tradeDeadlineCutoffISO, tradeDeadlineTimeLabel } from '../../src/utils/trade-deadline.mjs';

function eventsOf(calendar) {
  if (Array.isArray(calendar)) return calendar;
  const raw = calendar?.calendar?.event;
  if (Array.isArray(raw)) return raw;
  return raw ? [raw] : [];
}

/** "Fri, Nov 13" for an instant, on the Pacific clock. */
function ptDayLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric',
  }).format(date);
}

/**
 * The trading window for league year `leagueYear` at `now`.
 *
 * @param {{ slug: string, leagueYear: number, now?: Date, calendar?: unknown }} args
 * @returns {{
 *   closed: boolean,
 *   source: 'mfl' | 'constitution' | 'none',
 *   cutoffISO: string | null,
 *   cutoffLabel: string | null,
 *   reopensISO: string | null,
 * }}
 */
export function tradingWindowState({ slug, leagueYear, now = new Date(), calendar = null }) {
  const open = { closed: false, source: /** @type {const} */ ('none'), cutoffISO: null, cutoffLabel: null, reopensISO: null };

  const mfl = mflTradeCutoff(eventsOf(calendar), leagueYear);
  let cutoffMs;
  let reopenMs = null;
  let source;
  let timeLabel;
  if (mfl) {
    cutoffMs = mfl.epoch * 1000;
    source = 'mfl';
    timeLabel = mfl.timeLabel;
    // The same event's end, when MFL filled it with a real instant after the
    // start. The AFL's event carries `end_time: '18'` — junk, ignored.
    const event = eventsOf(calendar).find(
      (e) => String(e?.type ?? '').toUpperCase() === 'TRADE' && Number(e.start_time) === mfl.epoch,
    );
    const end = Number(event?.end_time);
    if (Number.isFinite(end) && end > mfl.epoch) reopenMs = end * 1000;
  } else {
    const iso = tradeDeadlineCutoffISO(slug, leagueYear);
    if (!iso) return open;
    cutoffMs = new Date(iso).getTime();
    source = 'constitution';
    timeLabel = tradeDeadlineTimeLabel(slug);
  }

  const nowMs = now.getTime();
  const closed = nowMs >= cutoffMs && (reopenMs == null || nowMs < reopenMs);
  const cutoff = new Date(cutoffMs);
  return {
    closed,
    source,
    cutoffISO: cutoff.toISOString(),
    cutoffLabel: `${ptDayLabel(cutoff)} at ${timeLabel}`,
    reopensISO: reopenMs == null ? null : new Date(reopenMs).toISOString(),
  };
}

const padFid = (fid) => String(fid ?? '').trim().padStart(4, '0');

/** Player ids (not picks) on both sides of a pending-trade row. */
export function offerPlayerIds(raw) {
  return [raw?.franchise1_gave_up, raw?.franchise2_gave_up, raw?.will_give_up, raw?.will_receive]
    .flatMap((s) => String(s || '').split(','))
    .map((t) => t.trim())
    .filter((t) => /^\d+$/.test(t))
    .filter((t, i, all) => all.indexOf(t) === i);
}

/**
 * playerId → the latest epoch-ms at which he moved in a completed trade.
 * Accepts the raw transactions export or a list of transaction rows.
 */
export function lastTradedAtByPlayer(transactions) {
  const raw = transactions?.transactions?.transaction ?? transactions ?? [];
  const rows = Array.isArray(raw) ? raw : [raw];
  const map = new Map();
  for (const row of rows) {
    if (String(row?.type ?? '').toUpperCase() !== 'TRADE') continue;
    const ms = Number(row.timestamp) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) continue;
    for (const id of offerPlayerIds(row)) {
      if (!map.has(id) || map.get(id) < ms) map.set(id, ms);
    }
  }
  return map;
}

/**
 * Why this pending offer can no longer happen, or null while it still can.
 *
 * @param {object} raw  pendingTrades row (`franchise`, `franchise2`/`offeredto`,
 *   `franchise1_gave_up`, `franchise2_gave_up`, `timestamp` in epoch seconds)
 * @param {{ rosterOwnerByPlayerId?: Map<string,string>, lastTradedAt?: Map<string,number> }} ctx
 * @returns {string | null}
 */
export function deadOfferReason(raw, { rosterOwnerByPlayerId, lastTradedAt } = {}) {
  const pair = new Set([padFid(raw?.franchise), padFid(raw?.franchise2 || raw?.offeredto)]);
  const proposedMs = Number(raw?.timestamp) * 1000;
  for (const id of offerPlayerIds(raw)) {
    const owner = rosterOwnerByPlayerId?.get?.(id);
    if (owner && !pair.has(padFid(owner))) return `player ${id} is now rostered by ${padFid(owner)}, outside the deal`;
    const traded = lastTradedAt?.get?.(id);
    if (traded && Number.isFinite(proposedMs) && proposedMs > 0 && traded > proposedMs) {
      return `player ${id} was traded after this offer was made`;
    }
  }
  return null;
}

/**
 * The line every Schefter rumor prompt carries once trading has closed. The
 * deadline has passed, so a pending proposal is history: it is a deal that did
 * not get done, never a deal still coming.
 */
export function tradingClosedPromptBlock(state) {
  if (!state?.closed) return '';
  return `TRADING IS CLOSED. The trade deadline passed ${state.cutoffLabel}. No trade can be made until trading reopens${state.reopensISO ? ' after the season' : ' next league year'}. NEVER imply a trade is coming, being worked on, imminent, "more to come", or that teams are shopping, fielding calls or in talks. Talk about trades ONLY in the past tense: deals that got done before the deadline, or deals that were on the table and did not get done.`;
}
