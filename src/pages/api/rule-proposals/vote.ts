/**
 * Rule Proposals — vote, open a vote, cancel a vote.
 *
 * POST /api/rule-proposals/vote
 *   { league, proposalId, action: 'vote', choice: 'yes' | 'no' }  any owner
 *   { league, proposalId, action: 'open' }                         commissioner
 *   { league, proposalId, action: 'cancel' }                       commissioner
 *
 * The league comes from the SESSION; the body's `league` is a check, never an
 * input — an owner signed in to one league is refused on the other's page.
 * One ballot per franchise, changeable until the 5-day window closes.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, franchiseIdForLeague, isCommissionerOrAdminForLeague } from '../../../utils/auth';
import { getLeagueBySlug } from '../../../config/leagues';
import { json } from '../../../utils/api-response';
import { findRuleProposal } from '../../../data/rule-proposals';
import { castVote, cancelVote, getVoteState, openVote, votePhase } from '../../../utils/rule-proposal-votes';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Sign in to vote' }, 401);

  let body: { league?: string; proposalId?: string; action?: string; choice?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const league = body.league ? getLeagueBySlug(body.league) : undefined;
  if (!league) return json({ error: 'Unknown league' }, 400);
  const franchiseId = franchiseIdForLeague(user, league.id);
  if (!franchiseId) return json({ error: 'You are not an owner in this league' }, 403);

  const proposal = body.proposalId ? findRuleProposal(league.slug, body.proposalId) : undefined;
  if (!proposal) return json({ error: 'Unknown proposal' }, 404);

  const state = await getVoteState(league.slug, proposal.id);
  const phase = votePhase(state.window);

  if (body.action === 'open' || body.action === 'cancel') {
    if (!isCommissionerOrAdminForLeague(user, league.id)) {
      return json({ error: 'Only a commissioner can do that' }, 403);
    }
    if (body.action === 'open') {
      if (phase !== 'discussion') return json({ error: 'This vote is already open' }, 409);
      const window = await openVote(league.slug, proposal.id, franchiseId);
      return window ? json({ ok: true }) : json({ error: 'Storage unavailable' }, 503);
    }
    const ok = await cancelVote(league.slug, proposal.id);
    return ok ? json({ ok: true }) : json({ error: 'Storage unavailable' }, 503);
  }

  if (body.action !== 'vote') return json({ error: 'Unknown action' }, 400);
  if (body.choice !== 'yes' && body.choice !== 'no') return json({ error: 'Pick Yes or No' }, 400);
  if (phase === 'discussion') return json({ error: 'Voting has not opened yet' }, 409);
  if (phase === 'closed') return json({ error: 'This vote is closed' }, 409);

  const ok = await castVote(league.slug, proposal.id, franchiseId, body.choice);
  return ok ? json({ ok: true }) : json({ error: 'Storage unavailable' }, 503);
};
