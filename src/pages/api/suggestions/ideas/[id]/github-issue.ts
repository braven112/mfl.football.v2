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
 * - **Idempotent.** An idea that already carries a `githubIssue` is returned
 *   as-is with 200 rather than filed twice. The button is visible to every
 *   admin on a board several people admin, and a double-click is not a reason
 *   to open a duplicate.
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
