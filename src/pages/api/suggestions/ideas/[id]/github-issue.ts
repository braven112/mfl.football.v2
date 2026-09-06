/**
 * Suggestion Box — File an idea as a GitHub issue (admin only)
 *
 * POST /api/suggestions/ideas/{id}/github-issue
 *
 * The handoff the whole Board exists to enable: an owner's suggestion becomes a
 * tracked work item an agent can pick up, without the commissioner retyping it.
 *
 * Two properties worth keeping:
 *
 * - **Idempotent against a repeat click, NOT against a true race.** An idea
 *   that already carries a `githubIssue` is returned as-is with 200 rather
 *   than filed twice, which covers the real case: the same admin clicking
 *   again, or opening the idea later. It is a read-check-write, so two admins
 *   clicking inside the same GitHub round-trip would still open two issues and
 *   the second save would orphan the first.
 *
 *   Left as-is deliberately. The cost of that race is one duplicate issue,
 *   visible and closable in a second; the fix is a lock with a TTL, which
 *   introduces a stuck-lock failure mode on a write path in exchange for a
 *   cosmetic problem. The UI already removes the common case by turning the
 *   button into a link once filed. Revisit if a duplicate ever actually
 *   happens — this comment is here so it is a known trade rather than a
 *   surprise.
 * - **The issue link is saved before it can be lost.** If the GitHub call
 *   succeeds but the Redis write fails, the response still carries the issue
 *   URL and says the link wasn't saved — the issue exists either way, and
 *   silently dropping the URL would leave an orphan nobody can find.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../../../utils/auth';
import { getIdeaById, saveIdea } from '../../../../../utils/suggestions-storage';
import {
  boardScope,
  leagueSlugForSuggestionsScope,
} from '../../../../../utils/suggestions-scope';
import { createGitHubIssue } from '../../../../../utils/github-issues';
import {
  buildIssueBody,
  buildIssueTitle,
  issueLabels,
} from '../../../../../utils/suggestion-issue';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);
  if (!isCommissionerOrAdmin(user)) return json({ error: 'Admin access required' }, 403);

  const scope = boardScope(user);
  const idea = await getIdeaById(scope, params.id!);
  if (!idea) return json({ error: 'Idea not found' }, 404);

  // Already filed — hand back the existing link rather than opening a second
  // issue for the same request.
  if (idea.githubIssue) {
    return json({ idea, githubIssue: idea.githubIssue, alreadyFiled: true });
  }

  const result = await createGitHubIssue({
    title: buildIssueTitle(idea),
    body: buildIssueBody(idea, leagueSlugForSuggestionsScope(scope)),
    labels: issueLabels(idea),
  });

  if (!result.ok) {
    return json({ error: `Couldn't file the issue: ${result.error}` }, result.status);
  }

  idea.githubIssue = {
    number: result.number,
    url: result.url,
    filedAt: new Date().toISOString(),
    filedBy: user.franchiseId,
  };
  // Filing is a commissioner acting on the idea, so the thread should surface
  // as active — same treatment a status change gets.
  idea.lastActivityAt = idea.githubIssue.filedAt;

  const saved = await saveIdea(scope, idea);
  if (!saved) {
    // The issue is real; only the backlink failed to persist. Say so plainly —
    // a 500 here would read as "nothing happened" and invite a second filing.
    return json(
      {
        idea,
        githubIssue: idea.githubIssue,
        warning: 'Issue was created on GitHub but the link could not be saved to the board.',
      },
      207,
    );
  }

  return json({ idea, githubIssue: idea.githubIssue }, 201);
};
