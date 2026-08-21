/**
 * Pure view-model helpers for the live-scoring island.
 *
 * Everything the board derives from ESPN's real game data lives here rather
 * than inside LiveScoreboard.tsx, so it can be tested without a DOM and
 * without the network — the same reason the ESPN parsers are pure. Each
 * function below replaced something the island used to INVENT.
 */

import type {
  LivePlayerRow,
  LiveScoringPlay,
  NflGame,
  NflGameState,
  PlayerMeta,
} from '../types/live-scoring';

/**
 * The clock shown next to a starter.
 *
 * This replaces a fabrication. The island used to derive a quarter and a clock
 * by dividing MFL's `gameSecondsRemaining` by 900 — which produces a
 * confident-looking "Q3 7:24" that is not the real game clock and drifts from
 * it all afternoon, because the NFL clock stops and MFL's number does not
 * decrement in real time.
 *
 * With ESPN's own status in hand we print the real thing. Without it we print
 * the STATE and no numbers: "In progress" is honestly less than "Q3 7:24", and
 * that is the point — an invented clock is worse than a missing one.
 */
export function formatGameClock(state: NflGameState, game?: NflGame): string {
  if (game) {
    if (game.state === 'post') return 'Final';
    if (game.state === 'pre') return compactKickoff(game.shortDetail) || 'Yet to play';
    // ESPN's shortDetail is already "8:12 - 3rd"; fall back to assembling it
    // only if that string is missing.
    if (game.shortDetail) return game.shortDetail;
    if (game.period > 0) return `Q${game.period}${game.clock ? ` ${game.clock}` : ''}`;
    return 'In progress';
  }
  // No ESPN game matched (offseason, an unmapped team code, or a failed
  // scoreboard fetch). Fall back to what MFL's clock can honestly support.
  if (state === 'final') return 'Final';
  if (state === 'not-started') return 'Yet to play';
  return 'In progress';
}

/**
 * Is THIS player's team the one in the red zone?
 *
 * `isRedZone` belongs to the team that HAS THE BALL, not to the game. Reading
 * it off the game alone tells a receiver his team is in the red zone while his
 * team is actually on defense, which is exactly backwards and reads as a bug
 * the first time an owner sees it. Both the possession check and the
 * in-progress check are load-bearing: a `situation` can linger on a payload
 * whose game has ended.
 */
/**
 * ESPN's pre-game `shortDetail` ("8/22 - 7:00 PM EDT") squeezed into the
 * player row's meta line.
 *
 * The full string is eighteen characters in a column that is about ninety
 * pixels wide on a phone in portrait, so it wrapped to three lines and tripled
 * the row height — with the timezone, the least useful token, taking a whole
 * line of its own. The date and time are what an owner is reading for; the
 * zone is the site's own (every clock on the page is one timezone) and the
 * dash is a separator a space already provides.
 *
 * Anything that does not parse as a kickoff time comes back UNCHANGED. This
 * shortens a known shape; it never guesses at an unknown one.
 */
export function compactKickoff(shortDetail: string): string {
  const m = /^\s*(.*?)\s*(?:-\s*)?(\d{1,2}:\d{2})\s*(AM|PM)\b\s*[A-Z]{0,4}\s*$/i.exec(shortDetail ?? '');
  if (!m) return shortDetail ?? '';
  const when = m[1].trim();
  const time = `${m[2]}${m[3].toLowerCase().startsWith('p') ? 'p' : 'a'}`;
  return when ? `${when} ${time}` : time;
}

/**
 * Plain-language name for the state the dot next to a player's clock encodes.
 *
 * The dot is the only thing on the row that says whether a game is being
 * played, and its three forms — pulsing green, hollow amber ring, solid grey —
 * are learnable but not self-evident ("what does the yellow circle indicate?",
 * owner, 2026-08-21). This rides on the clock's `title` so the answer is one
 * hover or one screen-reader stop away, without spending row width on a legend.
 */
export function describeGameState(state: NflGameState): string {
  if (state === 'in-progress') return 'His game is being played right now';
  if (state === 'not-started') return 'His game has not kicked off yet';
  return 'His game is final';
}

export function isPlayerInRedZone(game: NflGame | undefined, nflTeam: string): boolean {
  if (!game || game.state !== 'in' || !nflTeam) return false;
  const s = game.situation;
  if (!s?.isRedZone || !s.possession) return false;
  return s.possession === nflTeam;
}

/**
 * Down & distance for a starter's game — shown only while his team has the
 * ball, because "3rd & 7" is meaningless attached to a player on defense.
 */
export function playerDownDistance(game: NflGame | undefined, nflTeam: string): string {
  if (!game || game.state !== 'in' || !nflTeam) return '';
  const s = game.situation;
  if (!s?.possession || s.possession !== nflTeam) return '';
  return s.shortDownDistanceText || s.downDistanceText || '';
}

/** A real, attributed scoring play surfaced in a matchup's ticker. */
export interface LiveMoment {
  /** Stable across polls: one play can credit starters on both franchises. */
  key: string;
  playId: string;
  /** Franchise that started the credited player. */
  fid: string;
  /** MFL player id of the credited starter. */
  playerId: string;
  playerName: string;
  /** Canonical NFL team code of the scoring team. */
  team: string;
  /** ESPN's own summary of the play. */
  text: string;
  /** Real game clock, e.g. "Q1 11:49". Never fabricated. */
  clock: string;
  /** TD / FG / SF …; '' when ESPN omits it. */
  typeAbbrev: string;
}

/** "Q1 11:49" from a play's real period + clock; '' when neither is present. */
export function formatPlayClock(play: Pick<LiveScoringPlay, 'period' | 'clock'>): string {
  const q = play.period > 4 ? 'OT' : play.period > 0 ? `Q${play.period}` : '';
  if (q && play.clock) return `${q} ${play.clock}`;
  return q || play.clock || '';
}

/**
 * Turn the slate's scoring plays into the matchup ticker's rows.
 *
 * DERIVED, NOT ACCUMULATED. `/api/nfl-game-detail` returns every scoring play
 * in the slate on every poll, so recomputing from the current payload is
 * idempotent: a play cannot be emitted twice, and there is no seen-set to keep
 * in sync. The old ticker accumulated instead — it inferred a fantasy "delta"
 * by diffing each starter's points between two 60s polls, which meant a stat
 * correction could invent a scoring event and a point swing that spanned a
 * poll boundary was attributed to the wrong moment in the game.
 *
 * A play credits one row per ROSTERED starter on it, so a QB→WR touchdown
 * shows on both owners' tickers, and a play involving nobody rostered is
 * dropped rather than filling the ticker with league-wide noise.
 */
export function buildMoments(
  plays: readonly LiveScoringPlay[],
  players: Record<string, LivePlayerRow[]>,
  meta: Record<string, PlayerMeta>,
): LiveMoment[] {
  // MFL player id → EVERY franchise starting him this week.
  //
  // The list is not defensive padding. The AFL runs 24 franchises as
  // duplicate-player conferences (registry: `duplicatePlayers`), so one NFL
  // player is routinely started by two teams at once — 85 of 131 starters in a
  // real AFL week. A Map<playerId, fid> silently keeps the LAST franchise
  // written and drops the play from the other owner's ticker, which looks like
  // "his touchdown didn't count" rather than like a bug.
  const ownersOf = new Map<string, string[]>();
  for (const [fid, rows] of Object.entries(players)) {
    for (const row of rows) {
      const list = ownersOf.get(row.id);
      if (list) {
        if (!list.includes(fid)) list.push(fid);
      } else {
        ownersOf.set(row.id, [fid]);
      }
    }
  }
  if (ownersOf.size === 0) return [];

  const out: LiveMoment[] = [];
  const seen = new Set<string>();
  for (const play of plays) {
    for (const playerId of play.playerIds) {
      for (const fid of ownersOf.get(playerId) ?? []) {
        // One row per play per FRANCHISE, not per credited player. A play often
        // credits several athletes (rusher + kicker on a TD), and an owner who
        // starts two of them would otherwise see the identical line twice —
        // that shipped as a visible duplicate: "Derrick Henry 46 Yd Rush (Tyler
        // Loop PAT Failed)" listed twice for the owner who started both. Across
        // DIFFERENT franchises the play still appears once each, which is what
        // we want both for a QB→WR touchdown and for the AFL's duplicate
        // rosters.
        const dedupeKey = `${play.playId}:${fid}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        out.push({
          key: dedupeKey,
          playId: play.playId,
          fid,
          playerId,
          playerName: meta[playerId]?.name ?? '',
          team: play.nflTeam,
          text: play.text,
          clock: formatPlayClock(play),
          typeAbbrev: play.typeAbbrev,
        });
      }
    }
  }
  // Most recent first. The route hands us the slate in chronological order
  // (comparePlaysChronologically), so reversing is enough — and is why this
  // does NOT re-sort on `sequence`, which only orders within a single game.
  return out.reverse();
}

/**
 * The rows one matchup's ticker should render: this matchup's two franchises,
 * newest first, one row per PLAY, capped.
 *
 * The per-play dedupe is not redundant with buildMoments'. That one keys
 * `playId:franchiseId`, which is what lets a QB→WR touchdown reach both
 * owners' boards — but a MATCHUP ticker merges two franchises into one list,
 * and in the AFL both sides can legitimately start the same player
 * (`duplicatePlayers`). The identical line then appears twice in a row, with no
 * team attribution anywhere in the ticker to tell them apart, so the second one
 * carries no information at all. It shipped that way for five of 24 AFL
 * matchups before this: "Courtland Sutton 22 Yd pass from Bo Nix (Wil Lutz
 * Kick)" listed back to back.
 */
export function selectMatchupMoments(
  moments: readonly LiveMoment[],
  homeFid: string,
  awayFid: string,
  limit = 8,
): LiveMoment[] {
  const seenPlays = new Set<string>();
  const out: LiveMoment[] = [];
  for (const m of moments) {
    if (m.fid !== homeFid && m.fid !== awayFid) continue;
    if (seenPlays.has(m.playId)) continue;
    seenPlays.add(m.playId);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

// ── lineup slots ───────────────────────────────────────────────────────────

/**
 * A league's starting requirements, reduced to what the board needs: how many
 * of each position MUST start, and how many starters there are in total.
 * Everything past the required set is flex.
 */
export interface LineupSlotRules {
  /** Position → the minimum that must start there. */
  required: Record<string, number>;
  total: number;
}

/** Display order for a lineup, matching how owners read their own roster. */
const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF', 'FLEX'];

export const FLEX_SLOT = 'FLEX';

/** One starter, paired with the slot he is filling. */
export interface SlottedRow {
  row: LivePlayerRow;
  /** 'QB' | 'RB' | … | 'FLEX' — what the row is labelled with. */
  slot: string;
}

/**
 * Work out which slot each starter is filling, and put them in reading order.
 *
 * MFL tells us WHO is starting but not WHERE — `liveScoring` marks a player
 * `starter` and stops there. So the slot has to be derived: fill each
 * position's required minimum first, and whatever is left over is flex. For
 * both our leagues that is QB/RB/WR/TE/PK/DEF plus three flex, which is
 * exactly how an owner sees his own lineup.
 *
 * Sorting matters as much as labelling here. The matchup detail pairs away[i]
 * against home[i] and prints ONE position label between them, so the two sides
 * have to be in the same order for that label to mean anything — unsorted, the
 * center column was labelling a row whose two players were often at different
 * positions.
 */
export function assignLineupSlots(
  rows: readonly LivePlayerRow[],
  meta: Record<string, PlayerMeta>,
  rules: LineupSlotRules,
): SlottedRow[] {
  const remaining = new Map<string, number>();
  for (const [pos, count] of Object.entries(rules.required ?? {})) {
    remaining.set(pos.toUpperCase(), count);
  }

  const slotted: SlottedRow[] = rows.map((row) => {
    const pos = (meta[row.id]?.position ?? '').toUpperCase();
    const left = remaining.get(pos) ?? 0;
    if (left > 0) {
      remaining.set(pos, left - 1);
      return { row, slot: pos };
    }
    // Past the requirement — flex. A position we have no rule for keeps its
    // own name rather than being mislabelled flex.
    return { row, slot: remaining.has(pos) ? FLEX_SLOT : pos || FLEX_SLOT };
  });

  const rank = (slot: string) => {
    const i = SLOT_ORDER.indexOf(slot);
    return i === -1 ? SLOT_ORDER.length : i;
  };
  // Stable within a slot: preserve the order the feed gave us.
  return slotted
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => rank(a.entry.slot) - rank(b.entry.slot) || a.i - b.i)
    .map(({ entry }) => entry);
}

// ── feed freshness ──

/**
 * Is the board actually tracking anything?
 *
 * A static "LIVE" pill answers that question with an assertion. Owners read it
 * as one — and on a page whose fantasy numbers can legitimately sit at 0.0 for
 * an hour (a preseason slate, a Thursday before kickoff, an MFL feed that has
 * not opened yet) an assertion with no evidence behind it is indistinguishable
 * from a dead page. That was the owner report, 2026-08-21: "I don't see
 * anything that indicates it's tracking anything live."
 *
 * So the pill states the FEED's own state instead, from the poll timestamps
 * the shared store already keeps. Two rules make it honest:
 *
 *  - **"We couldn't reach the feed" outranks "nothing is happening."** Same
 *    split the poll store keeps in `status` vs `data`, carried to the UI: a
 *    failed poll keeps the last good payload, so the scores stay on screen —
 *    but the pill must stop claiming they are current.
 *  - **Never claim freshness we haven't got.** Before the first successful
 *    poll the answer is "Connecting…", not "updated just now" — `fetchedAt`
 *    is 0 there, and treating 0 as a timestamp prints "56 years ago".
 */
export type FeedTone = 'live' | 'idle' | 'error' | 'pending';

export interface FeedSnapshot {
  /** Poll status from the shared store. */
  status: 'idle' | 'loading' | 'ok' | 'error';
  /** epoch ms of the last SUCCESSFUL poll; 0 if none has landed. */
  fetchedAt: number;
}

export interface FeedFreshness {
  tone: FeedTone;
  /** Short state word for the pill. */
  label: string;
  /** Human age of the newest successful poll; '' while pending. */
  age: string;
  /** ms since the newest successful poll; -1 while nothing has landed. */
  ageMs: number;
}

/**
 * Relative age, in the coarsest unit that still reads as motion.
 *
 * Seconds are the point below a minute: the number changes on every tick, so
 * the element visibly proves the page is still working, and it snaps back to
 * "just now" the moment a poll lands.
 */
export function formatFeedAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return '';
  const s = Math.floor(ageMs / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/**
 * @param feeds only the feeds that are actually ENABLED for this render. A
 *   disabled poller never fails and never goes stale, so including one would
 *   pin the pill at "Connecting…" forever (bundled-sample mode does exactly
 *   that). An empty list means there is nothing to report — render no pill.
 * @param anyLive whether a real NFL game is in progress right now.
 */
export function describeFeedFreshness(
  feeds: FeedSnapshot[],
  anyLive: boolean,
  now: number,
): FeedFreshness {
  const loaded = feeds.filter((f) => f.fetchedAt > 0);
  const failing = feeds.some((f) => f.status === 'error');

  if (loaded.length === 0) {
    return failing
      ? { tone: 'error', label: 'Reconnecting', age: '', ageMs: -1 }
      : { tone: 'pending', label: 'Connecting', age: '', ageMs: -1 };
  }

  const newest = Math.max(...loaded.map((f) => f.fetchedAt));
  const ageMs = Math.max(0, now - newest);
  const age = formatFeedAge(ageMs);

  if (failing) return { tone: 'error', label: 'Reconnecting', age, ageMs };
  return anyLive
    ? { tone: 'live', label: 'Live', age, ageMs }
    : { tone: 'idle', label: 'Tracking', age, ageMs };
}
