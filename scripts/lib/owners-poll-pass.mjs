/**
 * The Owners' Poll — the open pass, the close pass, and their chat copy.
 *
 * Called by scripts/generate-pecking-order.mjs. Kept out of that file because
 * it already runs to 800 lines and because the poll is ADDITIVE to the column:
 * everything here is written so that a poll failure degrades to "the column
 * publishes without a poll section" rather than taking the column down.
 *
 * See docs/plans/owners-poll.md.
 */

import { leagueUrl } from '../../src/config/leagues-data.mjs';
import {
  resolveOwnersPollWindow,
  windowHours,
  SHORT_WINDOW_HOURS,
} from '../../src/utils/owners-poll-window.mjs';
import { normalizeFranchiseId } from '../../src/utils/franchise-id.mjs';
import {
  tallyOwnersPoll,
  consensusRankMap,
  contrarianIndex,
  homerIndex,
  describeScoring,
} from './owners-poll-math.mjs';
import {
  ownersPollRedis,
  writeWindow,
  readWindow,
  clearWindow,
  countBallots,
  readAllBallots,
} from './owners-poll-redis.mjs';

/**
 * The only logging surface these passes use.
 *
 * Defaulting to `console` itself typed the parameter as the full `Console`,
 * so a test passing a two-method stub failed to typecheck against 20+ methods
 * this code never calls. Naming the real contract is both honest and what lets
 * a caller inject a silent logger.
 *
 * @typedef {{ log?: (...args: any[]) => void, warn?: (...args: any[]) => void }} PollLogger
 */

/** @type {PollLogger} */
const DEFAULT_LOG = { log: (...a) => console.log(...a), warn: (...a) => console.warn(...a) };

/** Where the ballot lives, for every message that links to it. */
export const BALLOT_PATH = '/pecking-order/ballot';

/**
 * Open a ballot alongside a freshly written issue.
 *
 * Returns the `ownersPoll` block to stamp on the issue, or null when the poll
 * can't or shouldn't open. Null is not an error: the caller publishes the
 * column without a poll section, which is the correct degraded state.
 */
export async function openPoll({
  league,
  year,
  week,
  eligibleFranchiseIds,
  firstKickoff = null,
  now = new Date(),
  log = DEFAULT_LOG,
}) {
  const poll = league.ownersPoll;
  if (!poll?.enabled) return null;

  if (eligibleFranchiseIds.length <= poll.slots) {
    log.warn?.(
      `  [poll] ${league.name} has ${eligibleFranchiseIds.length} franchises but ${poll.slots} ballot slots — not opening.`,
    );
    return null;
  }

  const redis = ownersPollRedis();
  if (!redis) {
    // Additive-not-fatal: the column is the product, the poll is a section of
    // it. Failing the whole run over storage would trade a working column for
    // a missing one.
    log.warn?.('  [poll] No Redis credentials — publishing the column without a ballot.');
    return null;
  }

  const window = resolveOwnersPollWindow({
    publishedAt: now,
    closeHourPT: poll.closeHourPT,
    closeWeekday: poll.closeWeekday,
    firstKickoff,
  });
  const hours = windowHours(window);
  if (window.clampedToKickoff) {
    log.log?.(`  [poll] Close pulled back to just before kickoff (${window.closesAt}).`);
  }
  if (hours < SHORT_WINDOW_HOURS) {
    log.warn?.(
      `  [poll] Window is only ${hours.toFixed(1)}h (under ${SHORT_WINDOW_HOURS}h) — a late run?`,
    );
  }

  const record = {
    year,
    week,
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    slots: poll.slots,
    eligibleFranchiseIds,
  };

  try {
    await writeWindow(redis, league.navSlug, record);
  } catch (err) {
    log.warn?.(`  [poll] Could not open the ballot: ${err.message}`);
    return null;
  }

  log.log?.(`  [poll] Ballot open for Week ${week} — closes ${window.closesAt} (${hours.toFixed(1)}h).`);

  return {
    status: 'open',
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    slots: poll.slots,
    quorum: poll.quorum,
    eligibleVoters: eligibleFranchiseIds.length,
    methodology: describeScoring(poll.slots, poll.quorum, eligibleFranchiseIds.length),
  };
}

/**
 * Marks a poll block written by scripts/seed-example-owners-poll.mjs — a
 * worked example whose ballots nobody cast.
 *
 * It exists to be checked, not rendered. A seeded block is a PLACEHOLDER, so
 * the close pass must be able to overwrite it with a real tally; a block
 * WITHOUT this marker is real ballots and neither the seeder nor anything else
 * may clobber it.
 */
export const SYNTHETIC_POLL_SOURCE = 'synthetic';

/**
 * Assemble the `ownersPoll` block a closed week publishes.
 *
 * Pure — no Redis, no clock, no league lookup — so the close pass and
 * scripts/seed-example-owners-poll.mjs produce the SAME shape from the same
 * math. That matters more than the handful of lines it saves: the seeded
 * example's whole claim is that it is the real pipeline over invented input,
 * and a second copy of this assembly would quietly make that false the first
 * time a field is added here.
 *
 * @param {object} args
 * @param {Array<{ franchiseId: string, ranking: string[], submittedAt: string|null, updatedAt: string|null }>} args.ballots
 * @param {{ opensAt: string, closesAt: string, slots: number, eligibleFranchiseIds: string[] }} args.window
 * @param {number} args.quorum
 * @param {Map<string, number>|Record<string, number>} args.compositeRankByFid
 * @returns {{ block: object, tally: object }}
 */
export function buildClosedPollBlock({ ballots, window, quorum, compositeRankByFid }) {
  const tally = tallyOwnersPoll({
    ballots,
    eligibleFranchiseIds: window.eligibleFranchiseIds,
    slots: window.slots,
    quorum,
    compositeRankByFid,
  });

  const consensus = consensusRankMap(tally);
  const voters = ballots.map((ballot) => ({
    franchiseId: ballot.franchiseId,
    ranking: ballot.ranking,
    submittedAt: ballot.submittedAt,
    updatedAt: ballot.updatedAt,
    contrarianIndex: round2(contrarianIndex(ballot.ranking, consensus)),
    // Against the COMPOSITE, not the consensus — the column's own rank, fixed
    // before anyone voted. See homerIndex's note.
    homerIndex: homerIndex({
      franchiseId: ballot.franchiseId,
      ranking: ballot.ranking,
      compositeRankByFid,
    }),
  }));

  const nonVoters = window.eligibleFranchiseIds.filter(
    (fid) => !ballots.some((b) => b.franchiseId === fid),
  );

  const block = {
    status: 'closed',
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    slots: window.slots,
    quorum,
    eligibleVoters: window.eligibleFranchiseIds.length,
    ballotsIn: tally.ballotsIn,
    hasQuorum: tally.hasQuorum,
    methodology: describeScoring(window.slots, quorum, window.eligibleFranchiseIds.length),
    ranked: tally.ranked,
    unranked: tally.unranked,
    // Published in full — every ballot becomes public once its week closes.
    // That is the accountability half of the feature, and it is the reason
    // voting is worth doing.
    ballots: voters,
    // A COUNT of who didn't vote, never a list. The count-only decision
    // (docs/plans/owners-poll.md) is a product rule, not just chat copy: an
    // issue file carrying names would route straight around it.
    nonVoterCount: nonVoters.length,
  };

  return { block, tally };
}

/**
 * Close the ballot and tally it.
 *
 * @returns {{ block, ballotsIn, dropped, hasQuorum }} the `ownersPoll` block to
 *   write over the issue's open one.
 *
 * Unlike the open pass, missing Redis here IS fatal — writing an empty
 * consensus over an issue would erase ballots owners actually cast, and a
 * silent no-op would leave the column advertising a ballot that never resolves.
 */
export async function closePoll({ league, issue, compositeRankByFid, now = new Date(), log = DEFAULT_LOG }) {
  const poll = league.ownersPoll;
  if (!poll?.enabled) return null;

  const redis = ownersPollRedis();
  if (!redis) throw new Error('Owners\' Poll close pass needs Redis credentials.');

  const window = await readWindow(redis, league.navSlug);
  if (!window) {
    log.log?.('  [poll] No open ballot to close.');
    return null;
  }
  if (window.year !== issue.year || window.week !== issue.week) {
    throw new Error(
      `Open ballot is Week ${window.week} (${window.year}) but the issue is Week ${issue.week} (${issue.year}).`,
    );
  }
  if (Date.parse(window.closesAt) > now.getTime()) {
    log.log?.(
      `  [poll] Ballot is still open until ${window.closesAt} — not tallying yet.`,
    );
    return null;
  }

  const { ballots, dropped, stored } = await readAllBallots(
    redis,
    league.navSlug,
    window.year,
    window.week,
    { slots: window.slots, eligibleFranchiseIds: window.eligibleFranchiseIds },
  );
  if (dropped > 0) {
    // Said out loud rather than swallowed: the turnout meter counted these,
    // so a silent drop makes the published poll smaller than owners were told.
    log.warn?.(`  [poll] Dropped ${dropped} of ${stored} stored ballots (no longer valid).`);
  }

  const { block, tally } = buildClosedPollBlock({
    ballots,
    window,
    quorum: poll.quorum,
    compositeRankByFid,
  });

  // The pointer goes LAST, and only once the tally succeeded: clearing it
  // first would close voting on a run that then threw, leaving a week with no
  // ballot and no result.
  await clearWindow(redis, league.navSlug);

  log.log?.(
    `  [poll] Closed Week ${window.week}: ${tally.ballotsIn}/${window.eligibleFranchiseIds.length} ballots, ` +
      `quorum ${tally.hasQuorum ? 'met' : 'NOT met'}.`,
  );

  return { block, ballotsIn: tally.ballotsIn, dropped, hasQuorum: tally.hasQuorum };
}

function round2(x) {
  if (x == null || !Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

// ─── Chat copy ─────────────────────────────────────────────────────

/**
 * The line appended to Tuesday's column announcement.
 *
 * Leads with the disagreement bait rather than the chore. "Cast your ballot"
 * is a task; "the computer says X is #1, disagree?" is an invitation, and the
 * whole feature is built on owners wanting to argue with the machine.
 */
export function buildOpenLine(issue, teams, league) {
  const poll = issue.ownersPoll;
  if (!poll || poll.status !== 'open') return null;
  const top = issue.rankings[0];
  const bottom = issue.rankings[issue.rankings.length - 1];
  const name = (fid) => teams.get(fid)?.nameMedium ?? fid;
  return [
    `🗳️ THE OWNERS' POLL is open — rank your top ${poll.slots}.`,
    `The computer has ${name(top.franchiseId)} #1 and ${name(bottom.franchiseId)} last. Argue with it ▸ ${leagueUrl(league, BALLOT_PATH)}`,
  ].join('\n');
}

/**
 * The reveal — the poll's ONE chat post on the day it closes.
 *
 * GroupMe is capped at a single poll post per Pacific day (see
 * owners-poll-groupme-budget), so the turnout reminder moved to push and this
 * is what the chat gets: a result, which is the only part of the poll that is
 * news rather than admin.
 */
export function buildRevealMessage({ league, issue, teams, callback = null }) {
  const poll = issue.ownersPoll;
  if (!poll || poll.status !== 'closed') return null;
  const name = (fid) => teams.get(fid)?.nameMedium ?? fid;

  if (!poll.hasQuorum) {
    return [
      `🗳️ Owners' Poll — Week ${issue.week}: only ${poll.ballotsIn} of ${poll.eligibleVoters} ballots came in.`,
      `That is short of the ${poll.quorum} needed, so there is no consensus this week and the column runs on the numbers alone.`,
      `Next Tuesday ▸ ${leagueUrl(league, BALLOT_PATH)}`,
    ].join('\n');
  }

  const lines = [`🗳️ THE OWNERS' POLL — Week ${issue.week} (${poll.ballotsIn}/${poll.eligibleVoters} ballots)`];
  poll.ranked.slice(0, 3).forEach((row) => {
    const firsts = row.firstPlaceVotes > 0 ? ` (${row.firstPlaceVotes})` : '';
    lines.push(`${row.rank}. ${name(row.franchiseId)}${firsts} — ${row.points} pts`);
  });

  // The most interesting number in the whole feature: where the room and the
  // machine disagree most.
  const biggest = [...poll.ranked].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  if (biggest && Math.abs(biggest.delta) >= 2) {
    const dir = biggest.delta > 0 ? 'higher' : 'lower';
    lines.push(
      `↕️ Biggest split: the room has ${name(biggest.franchiseId)} ${Math.abs(biggest.delta)} spots ${dir} than the computer.`,
    );
  }

  const homer = [...(poll.ballots ?? [])]
    .filter((b) => b.homerIndex != null)
    .sort((a, b) => b.homerIndex - a.homerIndex)[0];
  if (homer && homer.homerIndex > 0) {
    lines.push(
      `🏠 Homer of the week: ${name(homer.franchiseId)}, ${homer.homerIndex} spots above where the room has them.`,
    );
  }

  // The callback is what makes the poll a running argument rather than a
  // weekly form, so it goes in the chat post, not only the feed.
  if (callback) lines.push(`📼 ${callback}`);

  lines.push(`Every ballot ▸ ${leagueUrl(league, '/pecking-order')}`);
  return lines.join('\n');
}

/**
 * Turnout for the nag, without reading a single ballot.
 *
 * Returns a REASON rather than a bare null, because "we could not read the
 * poll" and "there is no ballot open" are different facts and must not merge —
 * that conflation is the recurring bug class in this repo (see
 * resolveLineupFillState, live-poll-store). A cron that prints "no ballot is
 * open" when it actually has no credentials hides a broken deployment for as
 * long as nobody checks by hand.
 */
export async function readTurnout({ league }) {
  const redis = ownersPollRedis();
  if (!redis) return { ok: false, reason: 'no-credentials' };

  let window;
  try {
    window = await readWindow(redis, league.navSlug);
  } catch (err) {
    return { ok: false, reason: 'read-failed', error: err.message };
  }
  if (!window) return { ok: false, reason: 'no-window' };
  if (Date.parse(window.closesAt) <= Date.now()) return { ok: false, reason: 'already-closed' };

  // Reads the ballots rather than just HLEN, because the nag is now a PUSH to
  // the owners who haven't voted, and that needs to know which ones. This runs
  // server-side in the close/nag cron and never crosses an HTTP boundary — the
  // public /api/owners-poll/turnout endpoint still uses HLEN and still cannot
  // name a voter.
  const { ballots } = await readAllBallots(redis, league.navSlug, window.year, window.week, {
    slots: window.slots,
    eligibleFranchiseIds: window.eligibleFranchiseIds,
  });
  const voted = new Set(ballots.map((b) => b.franchiseId));

  return {
    ok: true,
    week: window.week,
    year: window.year,
    ballotsIn: voted.size,
    eligibleVoters: window.eligibleFranchiseIds.length,
    nonVoters: window.eligibleFranchiseIds.filter((fid) => !voted.has(fid)),
    closesAt: window.closesAt,
  };
}

/** One line explaining why there is no turnout to report. */
export function describeTurnoutFailure(reason, error) {
  switch (reason) {
    case 'no-credentials':
      return 'No Redis credentials — cannot tell whether a ballot is open.';
    case 'read-failed':
      return `Could not read the ballot window: ${error}`;
    case 'already-closed':
      return 'The ballot has already closed.';
    case 'no-window':
    default:
      return 'No ballot is open.';
  }
}

/** Normalize a franchise list once, for callers building eligible sets. */
export function normalizeFranchiseIds(ids) {
  return Array.from(new Set(Array.from(ids ?? [], (id) => normalizeFranchiseId(id)))).filter(Boolean);
}
