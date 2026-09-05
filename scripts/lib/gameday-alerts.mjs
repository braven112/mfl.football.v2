/**
 * Game-day push alerts — when a matchup turns over, and when it is done.
 *
 * Pure detection. No clock of its own beyond the `now` it is handed, no I/O,
 * no Redis: the poller feeds it the week's NFL schedule and MFL's live scoring
 * and gets back the alerts to send plus the state to store. That split is what
 * lets the interesting cases (a lead change during the early window, a tie, a
 * matchup that finishes while another is still playing) be tested without a
 * game being played.
 *
 * Two categories come out of here:
 *
 *   scoring-final  Your matchup is over. Fires per matchup, as soon as BOTH
 *                  rosters are done, so a Sunday-only matchup lands Sunday
 *                  night instead of waiting on Monday.
 *   scoring-swing  Your matchup changed hands, once it means something.
 *
 * WHAT MAKES A SWING WORTH A BUZZ. A lead change at 10:30am Pacific, with
 * eleven starters yet to play, is noise — the score has barely begun. So a
 * swing only counts once the week's MAIN SLATE is final: the Sunday-morning
 * window where most of the league's players are playing at once. Before that
 * the number on the screen is not a result. After it, a change of hands is
 * genuinely "you just lost the lead", and it stays true through Sunday night
 * and Monday, which is when the most dramatic ones happen.
 *
 * The main slate is found in the DATA rather than from a weekday and a clock:
 * it is the kickoff time the most games share. That is the Sunday 10am PT
 * window every week of the season, and being derived means it needs no DST
 * handling, survives Thanksgiving and the Saturday slates of Weeks 16-18, and
 * cannot drift out of sync with a schedule change.
 */

/** MFL reports a game that has not kicked off as a full hour remaining. */
const FULL_GAME_SECONDS = 3600;

/** How long after the last kickoff of the day we keep polling for finals. */
const POST_KICKOFF_TAIL_MS = 6 * 60 * 60 * 1000;

/**
 * The Pacific calendar date an instant falls on, as YYYY-MM-DD.
 *
 * Through Intl rather than a fixed offset: the season runs across the November
 * DST change, and a hardcoded -8 puts every September game on the wrong day.
 */
export function ptDateKey(instant, tz = 'America/Los_Angeles') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(instant instanceof Date ? instant : new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Normalize MFL's nflSchedule feed into `{ kickoffMs, secondsRemaining }`.
 *
 * Every number in an MFL feed arrives as a string, including the ones that are
 * meaningfully zero, so each is coerced here once rather than at four call
 * sites where one of them would eventually be compared as `'0' === 0`.
 */
export function scheduleGames(nflSchedule) {
  const raw = nflSchedule?.nflSchedule?.matchup;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((m) => ({
      kickoffMs: Number(m?.kickoff) * 1000,
      secondsRemaining: Number(m?.gameSecondsRemaining ?? FULL_GAME_SECONDS),
    }))
    .filter((g) => Number.isFinite(g.kickoffMs) && g.kickoffMs > 0);
}

/**
 * The week's main slate: the games sharing the single most-common kickoff.
 *
 * Ties break to the EARLIEST kickoff. A tie means two windows are the same
 * size, and the earlier of the two is the one whose completion actually tells
 * us most of the league has played.
 */
export function mainSlate(games) {
  const byKickoff = new Map();
  for (const g of games) {
    if (!byKickoff.has(g.kickoffMs)) byKickoff.set(g.kickoffMs, []);
    byKickoff.get(g.kickoffMs).push(g);
  }
  let best = null;
  for (const [kickoffMs, group] of [...byKickoff.entries()].sort((a, b) => a[0] - b[0])) {
    if (!best || group.length > best.length) best = { kickoffMs, length: group.length, group };
  }
  return best?.group ?? [];
}

/**
 * Has the week's main slate finished?
 *
 * The gate on every swing alert. Fails CLOSED — an unreadable or empty
 * schedule means no swing alerts, because the cost of staying quiet is one
 * missed nicety and the cost of guessing wrong is buzzing sixteen people about
 * a lead change in a game that has not started.
 */
export function mainSlateFinal(games) {
  const slate = mainSlate(games);
  if (slate.length === 0) return false;
  return slate.every((g) => g.secondsRemaining === 0);
}

/**
 * Is there anything to poll for right now?
 *
 * True while a game is scheduled for today in Pacific time, and for a tail
 * after the day's last kickoff so a matchup that ends near midnight still gets
 * its final. Derived from the schedule rather than a list of weekdays, so a
 * Thanksgiving Thursday, a Saturday slate in Week 17 and a Christmas game all
 * work without anyone remembering to add them.
 */
export function isGamedayNow(games, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const today = ptDateKey(nowMs);
  return games.some(
    (g) =>
      ptDateKey(g.kickoffMs) === today ||
      (g.kickoffMs <= nowMs && nowMs - g.kickoffMs <= POST_KICKOFF_TAIL_MS),
  );
}

/**
 * A stable id for a matchup within a week.
 *
 * Sorted, so the same two franchises produce the same key no matter which side
 * MFL lists first — otherwise a feed that reorders its pairings mid-day reads
 * as a brand new matchup and re-sends every alert already sent.
 */
export function matchupKey(pairing) {
  return [pairing.home.id, pairing.away.id].sort().join('-');
}

/** Whichever side is ahead, or null while the score is tied. */
export function leaderOf(pairing) {
  if (pairing.home.score === pairing.away.score) return null;
  return pairing.home.score > pairing.away.score ? pairing.home.id : pairing.away.id;
}

/**
 * Nobody left to play on either side.
 *
 * `playersYetToPlay` is checked as well as the clock because they answer
 * different questions: the clock reaching zero means the games are over,
 * while a starter on a bye or a roster slot MFL is still resolving can leave
 * a lineup that is not actually finished. When MFL omits the field the clock
 * decides alone — that is the older, always-present signal.
 */
export function isFinal(pairing) {
  return [pairing.home, pairing.away].every(
    (side) =>
      side.secondsRemaining === 0 && (side.playersYetToPlay == null || side.playersYetToPlay === 0),
  );
}

/**
 * One side of a matchup as MFL reports it live.
 *
 * @typedef {{id: string, score: number, secondsRemaining: number, playersYetToPlay: number|null}} LiveSide
 */

/**
 * @typedef {{home: LiveSide, away: LiveSide}} LivePairing
 */

/**
 * Something worth telling both owners about.
 *
 * @typedef {{
 *   kind: 'swing'|'final',
 *   key: string,
 *   pairing: LivePairing,
 *   leader?: string,
 *   previousLeader?: string,
 * }} GamedayAlert
 */

/**
 * Compare this poll against the last one and decide what to send.
 *
 * `state` is what the previous run stored, and the returned `nextState`
 * replaces it. Both are flat string maps because that is what a Redis hash
 * gives back; nothing here assumes it was written by this process.
 *
 * @param {object} args
 * @param {Array<LivePairing>} args.pairings Live matchups.
 * @param {Record<string, string>} [args.state] Previous run's state.
 * @param {boolean} [args.swingsAllowed] Has the main slate finished?
 * @returns {{alerts: Array<GamedayAlert>, nextState: Record<string, string>, removed: string[]}}
 */
export function detectGamedayAlerts({ pairings, state = {}, swingsAllowed = false }) {
  const alerts = [];
  const nextState = { ...state };
  /**
   * Fields to DELETE, returned separately because the caller writes state with
   * HSET, which can only add and overwrite. Dropping a key from `nextState`
   * alone leaves it sitting in Redis, so a matchup that ties would keep its
   * pre-tie leader on the server and compare against it on the next poll.
   */
  const removed = [];

  for (const pairing of pairings ?? []) {
    if (!pairing?.home?.id || !pairing?.away?.id) continue;
    const key = matchupKey(pairing);
    const leader = leaderOf(pairing);
    const previousLeader = state[`leader:${key}`] || null;

    // The leader is recorded on EVERY poll, including the ones before swings
    // are allowed. Recording it only once the slate is final would make the
    // first post-slate poll compare against nothing and miss a lead change
    // that happened during the window — the very moment we most want to catch.
    if (leader) {
      nextState[`leader:${key}`] = leader;
    } else {
      delete nextState[`leader:${key}`];
      if (state[`leader:${key}`]) removed.push(`leader:${key}`);
    }

    if (
      swingsAllowed
      && leader
      && previousLeader
      && leader !== previousLeader
      && !state[`swing:${key}`]
    ) {
      // Once per matchup per week. A see-saw finish is the best kind of
      // football and the worst kind of notification: five buzzes in ten
      // minutes is how push permission gets revoked.
      nextState[`swing:${key}`] = leader;
      alerts.push({ kind: 'swing', key, pairing, leader, previousLeader });
    }

    if (isFinal(pairing) && !state[`final:${key}`]) {
      nextState[`final:${key}`] = '1';
      alerts.push({ kind: 'final', key, pairing });
    }
  }

  return { alerts, nextState, removed };
}

/** The two sides of a matchup as `{ self, opponent }` from one franchise's view. */
function sidesFor(pairing, franchiseId) {
  return pairing.home.id === franchiseId
    ? { self: pairing.home, opponent: pairing.away }
    : { self: pairing.away, opponent: pairing.home };
}

const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

/**
 * Turn detected alerts into per-owner notifications.
 *
 * Both owners in a matchup get their own copy, written from their side — an
 * alert that says "you're down" to the owner who is down and "you're up" to
 * the one who is up. A single shared body would have to be neutral, which is
 * the least interesting version of both.
 *
 * @param {object} args
 * @param {Array<GamedayAlert>} args.alerts From detectGamedayAlerts.
 * @param {Map<string, string>|Record<string, string>} [args.teamNames]
 * @param {number|string} args.week
 * @returns {Array<{franchiseId: string, title: string, body: string, url: string, tag: string}>}
 */
export function buildGamedayNotifications({ alerts, teamNames, week }) {
  const nameOf = (id) => {
    if (!teamNames) return 'your opponent';
    const raw = teamNames instanceof Map ? teamNames.get(id) : teamNames[id];
    return (typeof raw === 'string' ? raw : raw?.name) || 'your opponent';
  };

  const out = [];
  for (const alert of alerts ?? []) {
    for (const franchiseId of [alert.pairing.home.id, alert.pairing.away.id]) {
      const { self, opponent } = sidesFor(alert.pairing, franchiseId);
      const versus = `${fmt(self.score)}-${fmt(opponent.score)} vs ${nameOf(opponent.id)}`;

      if (alert.kind === 'final') {
        const won = self.score > opponent.score;
        const tied = self.score === opponent.score;
        out.push({
          franchiseId,
          title: tied ? `Week ${week}: tie` : won ? `Week ${week}: win` : `Week ${week}: loss`,
          body: `Final ${versus}.`,
          url: '/live',
          // Per matchup per week, so a device never stacks two finals for the
          // same game and a re-send can only replace, never duplicate.
          tag: `scoring-final-w${week}-${alert.key}`,
        });
        continue;
      }

      const ahead = alert.leader === franchiseId;
      out.push({
        franchiseId,
        title: ahead ? `You just took the lead` : `You just lost the lead`,
        body: `Week ${week}: ${versus}.`,
        url: '/live',
        tag: `scoring-swing-w${week}-${alert.key}`,
      });
    }
  }
  return out;
}

/**
 * Normalize MFL's liveScoring payload into matchup pairings.
 *
 * MFL nests this two different ways depending on whether the league is in its
 * playoff bracket, and singleton lists arrive unwrapped, so every caller that
 * parsed it inline got one of the three cases wrong. Done once, here.
 */
/** @returns {Array<LivePairing>} */
export function parseLivePairings(liveScoring) {
  const raw = liveScoring?.liveScoring?.matchup;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const pairings = [];
  for (const m of list) {
    const teams = Array.isArray(m?.franchise) ? m.franchise : m?.franchise ? [m.franchise] : [];
    if (teams.length < 2) continue;
    const side = (t) => ({
      id: String(t.id),
      score: Number(t.score) || 0,
      secondsRemaining: Number(t.gameSecondsRemaining) || 0,
      playersYetToPlay: t.playersYetToPlay == null ? null : Number(t.playersYetToPlay) || 0,
    });
    pairings.push({ home: side(teams[0]), away: side(teams[1]) });
  }
  return pairings;
}
