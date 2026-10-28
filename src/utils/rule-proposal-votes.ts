/**
 * Rule proposal votes — storage and the constitution's counting rules.
 *
 * TheLeague's constitution ("Rule Changes", /theleague/rules#rule-changes):
 *   - a rule change needs 75% to pass (12 of 16);
 *   - abstentions count as "Yes";
 *   - a poll is final 5 days after it begins.
 * The 100%-to-take-effect-immediately clause only matters for a vote held
 * between Feb 15 and Week 17, and every proposal on the page names the season
 * it targets, so it is printed on the page rather than computed here.
 *
 * One vote per franchise, changeable until the window closes. Votes are a
 * Redis HASH (field = franchiseId) so two owners voting at once cannot
 * overwrite each other; the window lives in its own key. Keys are scoped by
 * registry slug because both leagues have a franchise 0001.
 */

import { getRedis } from './redis-client';

export type VoteChoice = 'yes' | 'no';

export const VOTE_WINDOW_DAYS = 5;
export const PASS_THRESHOLD = 0.75;

export interface VoteWindow {
  openedAt: string;
  openedBy: string;
}

export interface StoredVote {
  choice: VoteChoice;
  at: string;
}

export interface ProposalVoteState {
  window: VoteWindow | null;
  votes: Record<string, StoredVote>;
}

export type VotePhase = 'discussion' | 'open' | 'closed';

export interface VoteTally {
  phase: VotePhase;
  closesAt: Date | null;
  totalFranchises: number;
  yes: number;
  no: number;
  /** Franchises with no ballot — counted as Yes by the constitution. */
  abstain: number;
  /** Yes votes needed to pass: ceil(75% of the league). */
  needed: number;
  /** No votes that would sink it. */
  noToFail: number;
  /** yes + abstain >= needed. While open: "passing right now". */
  passes: boolean;
}

const windowKey = (slug: string, proposalId: string) => `rule-vote:${slug}:${proposalId}:window`;
const votesKey = (slug: string, proposalId: string) => `rule-vote:${slug}:${proposalId}:votes`;

export function closesAtFor(window: VoteWindow): Date {
  return new Date(new Date(window.openedAt).getTime() + VOTE_WINDOW_DAYS * 86_400_000);
}

export function votePhase(window: VoteWindow | null, now: Date = new Date()): VotePhase {
  if (!window) return 'discussion';
  return now.getTime() < closesAtFor(window).getTime() ? 'open' : 'closed';
}

export function tallyVotes(
  state: ProposalVoteState,
  franchiseIds: readonly string[],
  now: Date = new Date(),
): VoteTally {
  const members = new Set(franchiseIds);
  let yes = 0;
  let no = 0;
  for (const [fid, v] of Object.entries(state.votes)) {
    // A ballot from a franchise no longer in the league does not count.
    if (!members.has(fid)) continue;
    if (v.choice === 'yes') yes += 1;
    else if (v.choice === 'no') no += 1;
  }
  const total = members.size;
  const abstain = total - yes - no;
  const needed = Math.ceil(total * PASS_THRESHOLD);
  return {
    phase: votePhase(state.window, now),
    closesAt: state.window ? closesAtFor(state.window) : null,
    totalFranchises: total,
    yes,
    no,
    abstain,
    needed,
    noToFail: total - needed + 1,
    passes: yes + abstain >= needed,
  };
}

export async function getVoteState(slug: string, proposalId: string): Promise<ProposalVoteState> {
  const redis = await getRedis();
  if (!redis) return { window: null, votes: {} };
  const [window, votes] = await Promise.all([
    redis.get<VoteWindow>(windowKey(slug, proposalId)),
    redis.hgetall<StoredVote>(votesKey(slug, proposalId)),
  ]);
  return { window: window ?? null, votes: votes ?? {} };
}

export async function openVote(slug: string, proposalId: string, openedBy: string, now: Date = new Date()): Promise<VoteWindow | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const window: VoteWindow = { openedAt: now.toISOString(), openedBy };
  // nx: opening twice must not restart a running clock.
  await redis.set(windowKey(slug, proposalId), window, { nx: true });
  return (await redis.get<VoteWindow>(windowKey(slug, proposalId))) ?? window;
}

/** Commissioner undo for a vote opened by mistake: clears the window AND every ballot. */
export async function cancelVote(slug: string, proposalId: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  await Promise.all([redis.del(windowKey(slug, proposalId)), redis.del(votesKey(slug, proposalId))]);
  return true;
}

export async function castVote(slug: string, proposalId: string, franchiseId: string, choice: VoteChoice, now: Date = new Date()): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  const vote: StoredVote = { choice, at: now.toISOString() };
  await redis.hset(votesKey(slug, proposalId), { [franchiseId]: vote });
  return true;
}
