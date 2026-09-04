/**
 * The Owners' Poll — the content that makes owners care.
 *
 * The GroupMe reveal in owners-poll-pass.mjs is a BROADCAST, and broadcasts
 * only move people who were already going to act. Everything here is the other
 * half: a personal payoff for the owners who voted, and a feed post that
 * reaches the ones who don't read chat.
 *
 * See docs/plans/owners-poll.md, "Turnout levers".
 */

import { leagueUrl } from '../../src/config/leagues-data.mjs';
import { pairwiseAccuracy } from '../../src/utils/owners-poll-accuracy.mjs';

const BALLOT_PATH = '/pecking-order/ballot';
const COLUMN_PATH = '/pecking-order';

/**
 * One push per VOTER, about their own team.
 *
 * Deliberately not sent to non-voters. A "you missed it" push is a nag with no
 * information in it; the absence is the nudge — they watch the chat compare
 * numbers they don't have. It also keeps the promise the ballot page makes
 * ("cast your ballot to see where the room has you") literally true.
 *
 * @param {object} args
 * @param {object} args.league Registry entry.
 * @param {object} args.issue The amended issue, with a CLOSED ownersPoll.
 * @param {Map<string,object>} args.teams Franchise config, for names.
 * @param {object|null} [args.previousIssue] Last week's issue, for accuracy.
 */
export function buildVoterPushes({ league, issue, teams, previousIssue = null }) {
  const poll = issue?.ownersPoll;
  if (!poll || poll.status !== 'closed' || !poll.hasQuorum) return [];

  const name = (fid) => teams.get(fid)?.nameMedium ?? teams.get(fid)?.name ?? fid;
  const consensusRank = new Map((poll.ranked ?? []).map((r) => [r.franchiseId, r]));
  const url = `${COLUMN_PATH}`;

  // Last week's ballots scored against THIS week's column — the first moment
  // an owner's accuracy can be known, which makes the reveal the natural place
  // to tell them.
  const laterRank = Object.fromEntries((issue.rankings ?? []).map((r) => [r.franchiseId, r.rank]));
  const priorBallots = new Map(
    (previousIssue?.ownersPoll?.ballots ?? []).map((b) => [b.franchiseId, b.ranking]),
  );

  return (poll.ballots ?? []).map((ballot) => {
    const fid = ballot.franchiseId;
    const row = consensusRank.get(fid);
    const lines = [];

    if (row) {
      const delta = row.delta;
      lines.push(
        delta === 0
          ? `The room has you ${ordinal(row.rank)} — same as the computer.`
          : `The room has you ${ordinal(row.rank)}, ${Math.abs(delta)} ${
              Math.abs(delta) === 1 ? 'spot' : 'spots'
            } ${delta > 0 ? 'higher' : 'lower'} than the computer.`,
      );
    } else {
      // Unranked is the more interesting message, not a gap to paper over.
      lines.push(`Nobody put you on a ballot this week.`);
    }

    if (ballot.homerIndex != null && ballot.homerIndex > 0) {
      lines.push(`You had yourself ${ballot.homerIndex} higher than they did.`);
    }

    const prior = priorBallots.get(fid);
    if (prior) {
      const acc = pairwiseAccuracy(prior, laterRank);
      if (acc.pct != null) {
        lines.push(`Last week's ballot: ${Math.round(acc.pct * 100)}% accurate.`);
      }
    }

    return {
      franchiseId: fid,
      title: `Owners' Poll — Week ${issue.week}`,
      body: lines.join(' '),
      url,
      // Per-week tag, so a re-run collapses onto the same notification rather
      // than stacking a second copy in the tray.
      tag: `owners-poll-${issue.year}-${issue.week}`,
      teamName: name(fid),
    };
  });
}

/**
 * POST the composed pushes to the site's cron route.
 *
 * Never throws and never fails the close pass: the reveal has already reached
 * GroupMe and the issue is already committed by the time this runs, so a push
 * outage must not turn a successful week into a failed job.
 */
export async function sendVoterPushes({ league, notifications, log = console }) {
  if (notifications.length === 0) return { sent: 0, skipped: 'nothing to send' };

  // The origin comes from the league registry, which is the single source of
  // truth for it — not a workflow variable (CLAUDE.md: configuration lives in
  // code, and never concatenate an origin with a path by hand).
  const base = leagueUrl(league, '');
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.warn?.('  [poll] CRON_SECRET not set — skipping reveal pushes.');
    return { sent: 0, skipped: 'no secret' };
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/cron/owners-poll-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        league: league.slug,
        notifications: notifications.map(({ teamName, ...n }) => n),
      }),
    });
    if (!res.ok) {
      log.warn?.(`  [poll] Reveal push failed: HTTP ${res.status}`);
      return { sent: 0, skipped: `http ${res.status}` };
    }
    const data = await res.json();
    log.log?.(`  [poll] Reveal pushed to ${data.recipients ?? 0} owners (${data.sent ?? 0} devices).`);
    return data;
  } catch (err) {
    log.warn?.(`  [poll] Reveal push failed: ${err.message}`);
    return { sent: 0, skipped: err.message };
  }
}

/**
 * The reveal as a Schefter feed post.
 *
 * GroupMe reaches the owners who read GroupMe. This reaches the rest: the feed
 * is on /news and the homepage, and it is the durable record — a chat message
 * scrolls away, a post is still there in March when someone wants to prove
 * what the room thought.
 *
 * `id` is stable per league-week so a re-run REPLACES rather than duplicates
 * (commit-feed-and-push reconciles by post id).
 */
export function buildRevealFeedPost({
  league,
  issue,
  teams,
  // `= []` alone infers never[], which rejects every real caller. Name the
  // type at the default — same fix the logger contract in owners-poll-pass
  // needed for `console`.
  priorIssues = /** @type {any[]} */ ([]),
}) {
  const poll = issue?.ownersPoll;
  if (!poll || poll.status !== 'closed') return null;

  const name = (fid) => teams.get(fid)?.nameMedium ?? teams.get(fid)?.name ?? fid;
  const id = `sf_owners_poll_${league.slug}_${issue.year}_w${issue.week}`;
  const link = `${COLUMN_PATH}/${issue.year}/${issue.week}`;

  if (!poll.hasQuorum) {
    return {
      id,
      timestamp: new Date().toISOString(),
      type: 'power-ranking',
      category: 'articles',
      tier: 'standard',
      headline: `The Owners' Poll came up short in Week ${issue.week}`,
      body:
        `Only ${poll.ballotsIn} of ${poll.eligibleVoters} owners filed a ballot, short of the ` +
        `${poll.quorum} the poll needs. No consensus this week — the rankings are the numbers alone.`,
      franchiseIds: [],
      link,
      linkLabel: 'See the column',
      league: league.slug,
      authorId: 'claude',
    };
  }

  const top = poll.ranked.slice(0, 3);
  const biggest = [...poll.ranked].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const homer = [...(poll.ballots ?? [])]
    .filter((b) => b.homerIndex != null && b.homerIndex > 0)
    .sort((a, b) => b.homerIndex - a.homerIndex)[0];

  const sentences = [
    `${name(top[0].franchiseId)} tops the Owners' Poll with ${top[0].points} points` +
      (top[0].firstPlaceVotes > 0
        ? ` and ${top[0].firstPlaceVotes} of ${poll.ballotsIn} first-place votes.`
        : '.'),
  ];
  if (biggest && Math.abs(biggest.delta) >= 2) {
    sentences.push(
      `The room and the computer disagree most about ${name(biggest.franchiseId)} — ` +
        `${Math.abs(biggest.delta)} spots ${biggest.delta > 0 ? 'higher' : 'lower'} on the ballots.`,
    );
  }
  if (homer) {
    sentences.push(
      `${name(homer.franchiseId)} ranked themselves ${homer.homerIndex} spots above where everyone else did.`,
    );
  }

  // The callback rides along rather than becoming its own post: it belongs
  // next to the result it is commenting on, and a separate lane would need a
  // cron of its own to say one sentence.
  const callback = buildCallback({ issue, priorIssues, teams });
  if (callback) sentences.push(callback);

  return {
    id,
    timestamp: new Date().toISOString(),
    type: 'power-ranking',
    category: 'articles',
    tier: 'standard',
    headline: `Owners' Poll, Week ${issue.week}: ${name(top[0].franchiseId)} on top`,
    body: sentences.join(' '),
    // Named franchises only, so the post surfaces on their pages. Never the
    // whole league — a post tagged with all 16 is noise on every one of them.
    franchiseIds: Array.from(
      new Set([...top.map((r) => r.franchiseId), biggest?.franchiseId, homer?.franchiseId].filter(Boolean)),
    ),
    link,
    linkLabel: 'Every ballot',
    league: league.slug,
    authorId: 'claude',
  };
}

/**
 * The callback: what the room got badly wrong, resurfaced.
 *
 * This is the thing that turns the poll from a weekly form into a running
 * story, and it only works because ballots are permanent and public. "Three
 * owners left them off in Week 5" is an argument; "the poll is open" is a
 * chore.
 *
 * Looks for the biggest move between an EARLIER week's consensus and THIS
 * week's column, so the subject is a team whose fortunes actually flipped —
 * not merely one the poll happened to rank oddly once.
 *
 * @param {object} args
 * @param {object} args.issue The week just closed (its `rankings` are "now").
 * @param {Array<object>} args.priorIssues Earlier issues, any order.
 * @param {Map<string,object>} args.teams
 * @param {number} [args.minSwing] Spots of movement worth remarking on.
 * @param {number} [args.minWeeksBack] Don't call back to last week; that is
 *   just noise. Something has to have had time to change.
 * @returns {string|null} One sentence, or null when nothing is notable.
 */
export function buildCallback({
  issue,
  priorIssues = /** @type {any[]} */ ([]),
  teams,
  minSwing = 5,
  minWeeksBack = 2,
}) {
  const nowRank = new Map((issue?.rankings ?? []).map((r) => [r.franchiseId, r.rank]));
  if (nowRank.size === 0) return null;
  const name = (fid) => teams.get(fid)?.nameMedium ?? teams.get(fid)?.name ?? fid;

  let best = null;
  for (const prior of priorIssues ?? []) {
    const poll = prior?.ownersPoll;
    if (!poll || poll.status !== 'closed' || !poll.hasQuorum) continue;
    const weeksBack = issue.week - prior.week;
    if (weeksBack < minWeeksBack) continue;

    // Teams nobody ranked are the best material: "left off every ballot" is a
    // sharper line than "had them 6th". They sit at the end of the field.
    const unrankedIds = new Set((poll.unranked ?? []).map((r) => r.franchiseId));
    const fieldSize = (poll.ranked?.length ?? 0) + (poll.unranked?.length ?? 0);

    for (const [fid, then] of pollRanks(poll, fieldSize)) {
      const now = nowRank.get(fid);
      if (now == null) continue;
      const swing = then - now; // positive = the room was too low on them
      if (Math.abs(swing) < minSwing) continue;
      if (!best || Math.abs(swing) > Math.abs(best.swing)) {
        best = { fid, then, now, swing, week: prior.week, wasUnranked: unrankedIds.has(fid), poll };
      }
    }
  }
  if (!best) return null;

  const who = name(best.fid);
  if (best.swing > 0) {
    // The room was too low. The strongest version of this is "nobody ranked
    // them at all", so use it when it is true.
    const left = best.wasUnranked
      ? `Not one owner put ${who} on a Week ${best.week} ballot.`
      : `The room had ${who} ${ordinal(best.then)} in Week ${best.week}.`;
    return `${left} They are ${ordinal(best.now)} now.`;
  }
  return `The room had ${who} ${ordinal(best.then)} in Week ${best.week}. They are ${ordinal(best.now)} now.`;
}

/** Full-field rank per franchise for a closed poll: ranked, then unranked. */
function pollRanks(poll, fieldSize) {
  const out = new Map();
  for (const row of poll.ranked ?? []) out.set(row.franchiseId, row.rank);
  let next = (poll.ranked?.length ?? 0) + 1;
  for (const row of poll.unranked ?? []) out.set(row.franchiseId, next++);
  // A field we cannot size is not worth guessing at.
  return fieldSize > 0 ? out : new Map();
}

/**
 * Insert or replace a post in a feed document, newest first.
 *
 * Replace-by-id rather than append: a re-run of the close pass must not leave
 * two Owners' Poll posts for the same week in the feed.
 */
export function upsertFeedPost(feed, post) {
  const posts = Array.isArray(feed?.posts) ? [...feed.posts] : [];
  const existing = posts.findIndex((p) => p?.id === post.id);
  if (existing >= 0) {
    posts[existing] = { ...posts[existing], ...post };
  } else {
    posts.unshift(post);
  }
  return { ...feed, posts };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
